"""Replay selected controlled and natural two-view field cases with OpenCV 5."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from capture import inspect, sha
from field import inspect_field
from detail import register_detail
import cv2


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', required=True, help='Directory for generated crops and results')
    args = parser.parse_args()
    out = Path(args.output)
    out.mkdir(parents=True, exist_ok=True)
    source = Path(__file__).parent
    sample = json.loads((source / 'manifest.json').read_text())
    context = source / sample['context']['file']
    high = cv2.imread(str(ROOT / 'docs/field-source-scale/bell-input-1280.png'))
    missing = out / 'bell-missing-target.png'
    cv2.imwrite(str(missing), high[200:650, 200:1000])
    cases = [
        ('controlled_detail', 'controlled_same_photograph', context, source / 'bell-detail.png',
         sample['box'], 'Printed form code', 'E-1242-5 (9-91)'),
        ('same_raster', 'controlled_same_photograph', context, context,
         sample['box'], 'Printed form code', 'E-1242-5 (9-91)'),
        ('missing_target', 'controlled_same_photograph', context, missing,
         sample['box'], 'Printed form code', 'E-1242-5 (9-91)'),
        ('unrelated_photo', 'independent_source_rejection_control', context, ROOT / 'domain/images/small-parcel.jpg',
         sample['box'], 'Printed form code', 'E-1242-5 (9-91)'),
        ('natural_new_view', 'two_natural_frames_of_one_physical_sheet',
         ROOT / 'fixtures/datasheet001-frame-0022.png', source / 'datasheet001-frame-0072.png',
         [.11071, .51789, .78164, .04335], 'Power Dissipation', '300 mW'),
    ]
    results = []
    for name, scope, context, detail, box, field, reference in cases:
        analysis = inspect(context, out)
        inspection = inspect_field(context, analysis, box, out / (name + '-context-field.png'))
        inspection.update(field=field, sourceSha256=sha(context))
        measured = register_detail(context, detail, inspection, out / (name + '-detail-field.png'))
        results.append({'case': name, 'scope': scope, 'contextFile': context.name,
                        'detailFile': detail.name, 'field': field, 'referenceValue': reference,
                        'contextAnalysis': analysis, 'inspection': inspection, 'detailAnalysis': measured})
    record = {'kind': 'selected_paired_field_development_replay', 'opencv': cv2.__version__,
              'samplingUnits': ['One Bell Labs photograph at controlled scales/crops',
                                'One unrelated GLS photograph for rejection',
                                'One SmartDoc video: natural frames 22 and 72'],
              'independentParticipantReadings': 0,
              'scope': 'Fixed selected cases exercise mapping, target coverage and supplied-raster sampling. A reviewer confirms document identity and field readability.',
              'cases': results}
    (out / 'pair-results.json').write_text(json.dumps(record, indent=2) + '\n')
    print(json.dumps([{'case': x['case'], 'status': x['detailAnalysis']['status'],
                       'reason': x['detailAnalysis']['reason'],
                       'linearScaleRatio': x['detailAnalysis']['comparison']['linearScaleRatio']}
                      for x in results], indent=2))


if __name__ == '__main__':
    main()
