#!/usr/bin/env python3
"""Compare the current rule policy with saved native actions on recorded AWS observations."""
import argparse
import json
from pathlib import Path

from capture import rule_policy

ROOT = Path(__file__).resolve().parent
SESSIONS = ('agent-loop.json', 'parcel-cloud-loop.json',
            'hosted-cloud-loop.json', 'demo-cloud-loop.json')


CATEGORIES = {
    'prepare_document_review': 'review',
    'request_sharper_capture': 'recapture',
    'request_full_edges': 'recapture',
    'request_document_view': 'recapture',
}


def category(action):
    return CATEGORIES[action]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args()
    records, sources = [], set()
    for filename in SESSIONS:
        session = json.loads((ROOT / 'evidence' / filename).read_text())
        for index, capture in enumerate(session['captures']):
            observation = capture['analysis']
            rule_action, _ = rule_policy(observation)
            native_action = observation['action']
            source_id = capture['source']['sha256']
            sources.add(source_id)
            records.append({
                'session': filename, 'captureIndex': index,
                'sourceName': capture['source']['name'], 'sourceSha256': source_id,
                'geometry': observation['geometry'], 'metrics': observation['metrics'],
                'currentRuleAction': rule_action,
                'nativeTool': observation['agent']['tool'],
                'nativeAction': native_action,
                'exactActionMatch': rule_action == native_action,
                'actionCategoryMatch': category(rule_action) == category(native_action),
            })
    result = {
        'schemaVersion': 1, 'kind': 'recorded_controller_comparison',
        'scope': 'Four scripted sessions reuse four source images. The comparison covers saved actions on these selected observations.',
        'method': 'Apply the current capture.rule_policy to each recorded AWS observation; compare its action with the native action saved in that capture.',
        'sourcePathBase': 'experiments/capture-loop/evidence/',
        'categoryDefinition': CATEGORIES,
        'summary': {
            'sessions': len(SESSIONS), 'photoExecutions': len(records),
            'distinctSourceImages': len(sources),
            'actionCategoryMatches': sum(r['actionCategoryMatch'] for r in records),
            'exactActionMatches': sum(r['exactActionMatch'] for r in records),
        },
        'records': records,
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result['summary']))


if __name__ == '__main__':
    main()
