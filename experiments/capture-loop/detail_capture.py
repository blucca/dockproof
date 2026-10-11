"""Local deterministic next step for the paired-field detail experiment."""
import argparse
import json
from pathlib import Path

from detail import register_detail


def inspect_detail(source, context, inspection, output):
    observation = register_detail(context, source, inspection,
                                  Path(output) / (Path(source).stem + '-field.png'))
    ready = observation['status'] == 'matched'
    return {**observation, 'controller': 'rule_based_detail_requests',
            'action': 'prepare_detail_review' if ready else 'request_field_detail',
            'request': ('Compare this target in both retained originals and crops. '
                        'Read the value, judge its readability, and confirm your review.'
                        if ready else observation['request'])}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--source', required=True)
    parser.add_argument('--context', required=True)
    parser.add_argument('--inspection', required=True)
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    result = inspect_detail(args.source, args.context,
                            json.loads(Path(args.inspection).read_text()), args.output)
    print(json.dumps({'analysis': result}))
