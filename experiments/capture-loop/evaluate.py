#!/usr/bin/env python3
"""Reproduce the small, selected natural-frame and synthetic-label check."""
import argparse
import json
import platform
from pathlib import Path

import cv2
import numpy as np

from capture import inspect
from probe import inspect as baseline_inspect
from probe import render_capture

ROOT = Path(__file__).resolve().parent


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--output', type=Path, required=True)
    args = ap.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'fixtures' / 'manifest.json').read_text())
    natural, baseline, synthetic = [], [], []
    for sample in manifest['samples']:
        path = ROOT / 'fixtures' / sample['url'].rsplit('/', 1)[-1]
        result = inspect(path, args.output)
        result.update(fixture=path.name, split=sample['split'],
                      expectedAction=sample['expectedAction'],
                      matchesExpectedAction=result['action'] == sample['expectedAction'])
        natural.append(result)
        old = baseline_inspect(path, args.output)
        # The original function uses a synthetic-fixture label; correct it here.
        old.update(fixtureType='natural_video_frame', expectedAction=sample['expectedAction'],
                   matchesExpectedAction=old['action'] == sample['expectedAction'])
        baseline.append(old)
    label = cv2.imread(str(ROOT.parent.parent / 'web' / 'data' / 'scans' / 'synthetic-piece-label.png'))
    good = render_capture(label, [[210, 180], [1120, 120], [1230, 760], [150, 840]])
    cases = [
        ('synthetic-blurred', cv2.GaussianBlur(good, (27, 27), 8), 'request_sharper_capture'),
        ('synthetic-clipped', render_capture(label, [[-110, -25], [1160, 100], [1200, 770], [-70, 960]]), 'request_full_edges'),
        ('synthetic-complete', good, 'prepare_document_review')]
    for name, img, expected in cases:
        path = args.output / (name + '.jpg')
        cv2.imwrite(str(path), img, [cv2.IMWRITE_JPEG_QUALITY, 95])
        result = inspect(path, args.output)
        result.update(fixture=path.name, expectedAction=expected,
                      matchesExpectedAction=result['action'] == expected)
        synthetic.append(result)
    report = {
        'schemaVersion': 2, 'kind': 'selected_capture_examples',
        'environment': {'opencv': cv2.__version__, 'numpy': np.__version__, 'python': platform.python_version()},
        'scope': 'One naturally filmed SmartDoc datasheet, selected frames from one video; three generated captures of one synthetic shipping label.',
        'controller': 'Fixed visual rules; the browser demonstration uses a scripted uploader and reviewer.',
        'sampling': manifest['sampling'],
        'baseline': {'method': 'Original largest Otsu component probe', 'records': baseline},
        'natural': natural, 'synthetic': synthetic,
        'summary': {
            'baselineNaturalMatches': sum(r['matchesExpectedAction'] for r in baseline),
            'naturalMatches': sum(r['matchesExpectedAction'] for r in natural),
            'naturalCount': len(natural),
            'syntheticMatches': sum(r['matchesExpectedAction'] for r in synthetic),
            'syntheticCount': len(synthetic)}}
    (args.output / 'evaluation.json').write_text(json.dumps(report, indent=2) + '\n')
    print(json.dumps(report['summary']))


if __name__ == '__main__':
    main()
