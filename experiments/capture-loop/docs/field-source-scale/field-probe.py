"""Selected field-source-pixel probe. Run from repository root with --output.
Uses the capture loop's OpenCV 5 / NumPy environment.
"""
import argparse, importlib.util, json
from pathlib import Path
import cv2
import numpy as np

def draw(canvas, words, xy, scale=.58, color=(42,41,35), thickness=1):
    cv2.putText(canvas,words,xy,cv2.FONT_HERSHEY_SIMPLEX,scale,color,thickness,cv2.LINE_AA)

def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--capture-dir',default='experiments/capture-loop')
    p.add_argument('--output',required=True)
    args=p.parse_args();cap=Path(args.capture_dir);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
    spec=importlib.util.spec_from_file_location('capture',cap/'capture.py')
    capture=importlib.util.module_from_spec(spec);spec.loader.exec_module(capture)
    sample=next(s for s in json.loads((cap/'domain/manifest.json').read_text())['samples'] if s['file']=='bell-mailing-labels.jpg')
    source=cv2.imread(str(cap/'domain/images'/sample['file']))
    if source is None or list(source.shape[:2]) != [960,1280]:
        raise ValueError('Use the existing 1280 x 960 official Bell Labs thumbnail.')
    quad=np.array([[263,810],[429,792],[432,819],[266,837]],np.float32)
    panel=np.full((1190,1200,3),(246,249,251),np.uint8)
    draw(panel,'Field detail at source scale',(28,47),1.05,thickness=2)
    draw(panel,'One real photograph. Three selected raster sizes. Human field confirmation.',(28,80),.60)
    records=[]
    for i,width in enumerate((1280,640,480)):
        img=cv2.resize(source,(width,width*3//4),interpolation=cv2.INTER_AREA)
        path=out/f'bell-input-{width}.png';cv2.imwrite(str(path),img)
        observed=capture.measure(path,out);action=capture.rule_policy(observed)[0]
        q=quad*(width/1280);ow=round(np.linalg.norm(q[1]-q[0]));oh=round(np.linalg.norm(q[3]-q[0]))
        matrix=cv2.getPerspectiveTransform(q,np.array([[0,0],[ow-1,0],[ow-1,oh-1],[0,oh-1]],np.float32))
        field=cv2.warpPerspective(img,matrix,(ow,oh))
        field_name=f'bell-field-native-{width}.png';cv2.imwrite(str(out/field_name),field)
        x0,y0=np.floor(q.min(axis=0)).astype(int);x1,y1=np.ceil(q.max(axis=0)).astype(int)+1
        raw_name=f'bell-field-source-box-{width}.png';cv2.imwrite(str(out/raw_name),img[y0:y1,x0:x1])
        gray=cv2.cvtColor(field,cv2.COLOR_BGR2GRAY)
        _,binary=cv2.threshold(gray,0,255,cv2.THRESH_BINARY_INV+cv2.THRESH_OTSU)
        _,_,stats,_=cv2.connectedComponentsWithStats(binary)
        heights=[int(s[3]) for s in stats[1:] if s[4]>=2 and s[2]<ow*.13 and oh*.3<=s[3]<oh*.97]
        glyph_height=float(np.median(heights));raw_focus=round(float(cv2.Laplacian(gray,cv2.CV_64F).var()),3)
        records.append({'sourceInput':path.name,'inputWidthPx':width,
            'transformation':'identity-sized decoded source, PNG encoding' if width==1280 else '1280px official JPEG thumbnail -> cv2.resize INTER_AREA -> PNG encoding',
            'pageObservation':observed,'pageRuleAction':action,
            'field':{'name':'Printed form code','referenceValue':'E-1242-5 (9-91)',
                'sourceQuadPx':q.tolist(),'sourceBoxPx':[int(x0),int(y0),int(x1-x0),int(y1-y0)],
                'sourceBoxImage':raw_name,'nativeScaleDeskewedImage':field_name,
                'nativeScaleDeskewedSizePx':[ow,oh],'deskewHomography':matrix.tolist(),
                'candidateGlyphHeightsPx':heights,'medianCandidateGlyphHeightPx':glyph_height,
                'nativeScaleLaplacianVariance':raw_focus}})
        y=110+i*345
        draw(panel,f'{width}px input | page focus {observed["metrics"]["laplacianVariance"]:.3f} | REVIEW',(28,y+22),.57,thickness=2)
        mini=cv2.resize(img,(400,300),interpolation=cv2.INTER_AREA)
        cv2.polylines(mini,[np.round(q*(400/width)).astype(np.int32)],True,(55,65,220),2,cv2.LINE_AA)
        panel[y+32:y+332,28:428]=mini
        draw(panel,f'Native-scale deskewed field: {ow} x {oh}px',(470,y+50),.61,thickness=2)
        panel[y+70:y+70+oh,470:470+ow]=field
        draw(panel,f'Estimated glyph height: {glyph_height:.0f}px',(470,y+127),.62,thickness=2)
        draw(panel,'Same field enlarged for review (nearest-neighbor)',(470,y+164),.53)
        enlarged=cv2.resize(field,(650,round(650*oh/ow)),interpolation=cv2.INTER_NEAREST)
        panel[y+177:y+177+enlarged.shape[0],470:1120]=enlarged
        draw(panel,f'Local native-scale Laplacian: {raw_focus:.3f}',(470,y+318),.55)
    draw(panel,'Photo: Jonathan Schilling, CC BY-SA 4.0. Crops/resizing/deskewing are derived views.',(28,1172),.52)
    cv2.imwrite(str(out/'field-comparison.png'),panel)
    result={'kind':'selected_field_source_pixel_development_probe','opencv':cv2.__version__,
        'scope':'One natural source photograph; three selected raster sizes. Measurements and visible crop comparison.',
        'source':sample['source'],'sourceInputPx':[1280,960],
        'fieldSelection':'Hand-selected quadrilateral around the printed bottom-left code, in 1280px-thumbnail coordinates.',
        'glyphMethod':'Native-footprint deskew via linear perspective interpolation; grayscale Otsu; connected components with area >=2, width <13% crop width and height 30–97% crop height; median candidate height.',
        'focusInterpretation':'Whole-page threshold 50 applies to capture.py page-normalized measurement. Field native-scale Laplacian is a scale-dependent diagnostic.',
        'records':records}
    (out/'field-study.json').write_text(json.dumps(result,indent=2)+'\n')
    print(json.dumps([{'width':r['inputWidthPx'],'pageFocus':r['pageObservation']['metrics']['laplacianVariance'],
        'glyphHeight':r['field']['medianCandidateGlyphHeightPx'],'action':r['pageRuleAction']} for r in records],indent=2))

if __name__=='__main__':
    main()
