#!/usr/bin/env python3
"""A controlled OpenCV 5 probe: image evidence selects the next capture action."""
import argparse
import hashlib
import json
import time
from pathlib import Path

import cv2
import numpy as np

cv2.setNumThreads(2)


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def ordered_quad(points):
    p = np.asarray(points, dtype=np.float32).reshape(4, 2)
    sums = p.sum(axis=1)
    diffs = p[:, 1] - p[:, 0]
    return np.array([p[sums.argmin()], p[diffs.argmin()],
                     p[sums.argmax()], p[diffs.argmax()]], dtype=np.float32)


def inspect(path, out):
    start = time.perf_counter()
    img = cv2.imread(str(path))
    if img is None:
        raise ValueError('Image decode failed')
    h, w = img.shape[:2]
    gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
    smooth = cv2.GaussianBlur(gray, (5, 5), 0)
    _, mask = cv2.threshold(smooth, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    candidates = [c for c in contours if cv2.contourArea(c) > w * h * .12]
    record = {'source': path.name, 'sourceSha256': sha(path), 'opencv': cv2.__version__,
              'inputPx': [w, h], 'fixtureType': 'controlled_synthetic_capture'}
    if len(candidates) == 0:
        record.update(action='request_document_view', request='Place the full label against a contrasting background.')
        return record
    contour = max(candidates, key=cv2.contourArea)
    polygon = cv2.approxPolyDP(contour, .025 * cv2.arcLength(contour, True), True)
    x, y, bw, bh = cv2.boundingRect(contour)
    touches = x <= 5 or y <= 5 or x + bw >= w - 5 or y + bh >= h - 5
    record['metrics'] = {'polygonCorners': len(polygon), 'touchesFrame': touches,
                         'documentAreaRatio': round(cv2.contourArea(contour) / (w * h), 4)}
    if touches or len(polygon) != 4 or not cv2.isContourConvex(polygon):
        record.update(action='request_full_edges', request='Move back until all four label edges fit inside the frame.')
    else:
        quad = ordered_quad(polygon)
        top, right, bottom, left = [np.linalg.norm(quad[(i + 1) % 4] - quad[i]) for i in range(4)]
        ow = 1000
        oh = max(1, round(ow * max(left, right) / max(top, bottom)))
        matrix = cv2.getPerspectiveTransform(quad, np.array([[0, 0], [ow-1, 0], [ow-1, oh-1], [0, oh-1]], dtype=np.float32))
        rectified = cv2.warpPerspective(img, matrix, (ow, oh))
        rectgray = cv2.cvtColor(rectified, cv2.COLOR_BGR2GRAY)
        margin = max(8, round(min(ow, oh) * .04))
        roi = rectgray[margin:-margin, margin:-margin]
        focus = float(cv2.Laplacian(roi, cv2.CV_64F).var())
        record['metrics']['laplacianVariance'] = round(focus, 3)
        record['metrics']['focusThreshold'] = 50.0
        record['documentQuadPx'] = quad.tolist()
        if focus < 50:
            record.update(action='request_sharper_capture', request='Hold the camera steady and focus on the printed weight and shipment number.')
        else:
            derived = out / (path.stem + '-rectified.jpg')
            cv2.imwrite(str(derived), rectified, [cv2.IMWRITE_JPEG_QUALITY, 95])
            record.update(action='prepare_document_review', request='Compare the printed weight and shipment number with the retained original.')
            record['derived'] = {'file': derived.name, 'sha256': sha(derived),
                                 'operations': ['perspective_rectification', 'JPEG_encode_quality_95'],
                                 'homography': matrix.tolist(), 'sizePx': [ow, oh]}
    record['elapsedMs'] = round((time.perf_counter() - start) * 1000, 2)
    return record


def render_capture(label, corners):
    h, w = label.shape[:2]
    target = np.asarray(corners, dtype=np.float32)
    matrix = cv2.getPerspectiveTransform(np.array([[0, 0], [w-1, 0], [w-1, h-1], [0, h-1]], dtype=np.float32), target)
    canvas = cv2.warpPerspective(label, matrix, (1400, 1000), borderMode=cv2.BORDER_CONSTANT, borderValue=(72, 65, 60))
    return canvas


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', type=Path, required=True)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    label = cv2.imread(str(args.source))
    if label is None:
        raise ValueError('Synthetic source decode failed')
    good = render_capture(label, [[210, 180], [1120, 120], [1230, 760], [150, 840]])
    blurred = cv2.GaussianBlur(good, (27, 27), 8)
    clipped = render_capture(label, [[-110, -25], [1160, 100], [1200, 770], [-70, 960]])
    cases = [('01-blurred', blurred, 'request_sharper_capture'),
             ('02-clipped', clipped, 'request_full_edges'),
             ('03-complete', good, 'prepare_document_review')]
    records = []
    for name, img, expected in cases:
        path = args.output / (name + '.jpg')
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        record = inspect(path, args.output)
        record['expectedProbeAction'] = expected
        record['matchesProbeExpectation'] = record['action'] == expected
        records.append(record)
    report = {'schemaVersion': 1, 'kind': 'controlled_capture_feasibility_probe',
              'source': str(args.source), 'sourceSha256': sha(args.source),
              'role': 'Scripted uploader following image-quality requests',
              'scope': 'One synthetic label, contrasted flat background, three generated captures',
              'thresholdBasis': 'Fixed feasibility threshold; field calibration is a product work item',
              'records': records, 'allProbeActionsMatch': all(r['matchesProbeExpectation'] for r in records)}
    (args.output / 'probe.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report, indent=2))


if __name__ == '__main__':
    main()
