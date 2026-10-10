#!/usr/bin/env python3
"""Measure the four selected domain examples with the local capture implementation."""
import argparse
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent
sys.path.insert(0, str(ROOT.parent))
from capture import measure, rule_policy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)
    manifest = json.loads((ROOT / 'manifest.json').read_text())
    records = []
    for sample in manifest['samples']:
        observation = measure(ROOT / sample['url'], args.output)
        action, request = rule_policy(observation)
        # Source URLs and license attribution identify these research fixtures.
        observation.pop('sourceSha256', None)
        if 'perspectiveView' in observation:
            observation['perspectiveView'].pop('sha256', None)
        records.append({
            'file': sample['file'], 'role': sample['role'],
            'expectedAction': sample['expectedAction'], 'action': action,
            'matchesExpectedAction': action == sample['expectedAction'],
            'request': request, 'observation': observation})
    result = {
        'kind': 'selected_domain_development_check',
        'implementation': 'Local capture.py with bounded convex-hull repair.',
        'cloudDeployment': 'Existing AWS Lambda remains on the prior measurement version.',
        'sampling': manifest['sampling'], 'records': records,
        'summary': {'matches': sum(r['matchesExpectedAction'] for r in records),
                    'count': len(records)}}
    (args.output / 'evaluation.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary']))
    return 0 if all(r['matchesExpectedAction'] for r in records) else 1


if __name__ == '__main__':
    raise SystemExit(main())
