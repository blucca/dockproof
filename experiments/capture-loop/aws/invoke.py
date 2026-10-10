#!/usr/bin/env python3
"""Drop-in measure.py adapter using a private synchronous AWS Lambda invocation."""
import argparse
import base64
import binascii
import json
import os
import shlex
import subprocess
import tempfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
function = os.environ.get('CAPTURE_MEASURE_FUNCTION')
if not function:
    parser.error('Set CAPTURE_MEASURE_FUNCTION to the deployed Lambda name or ARN.')
size = args.source.stat().st_size
if size < 1 or size > 4_000_000:
    parser.error(f'Image size is {size} bytes. Use a JPEG or PNG of 1 to 4,000,000 bytes.')
args.output.mkdir(parents=True, exist_ok=True)
event = {'filename': args.source.name,
         'imageBase64': base64.b64encode(args.source.read_bytes()).decode('ascii')}
encoded = json.dumps(event).encode('utf-8')
if len(encoded) > 6 * 1024 * 1024:
    parser.error('Encoded image exceeds the synchronous Lambda request limit of 6 MiB.')
with tempfile.TemporaryDirectory(prefix='lambda-invoke-', dir=args.output) as directory:
    request, response = Path(directory) / 'request.json', Path(directory) / 'response.json'
    request.write_bytes(encoded)
    command = shlex.split(os.environ.get('CAPTURE_AWS_CLI', 'aws')) + [
        '--no-cli-pager', 'lambda', 'invoke', '--function-name', function,
        '--invocation-type', 'RequestResponse', '--cli-binary-format', 'raw-in-base64-out',
        '--payload', 'fileb://' + str(request.resolve()), '--output', 'json', str(response),
    ]
    result = subprocess.run(command, capture_output=True, text=True,
                            env=dict(os.environ, AWS_PAGER=''), timeout=90)
    if result.returncode:
        raise SystemExit(f'AWS Lambda invocation failed: {result.stderr.strip()}')
    metadata = json.loads(result.stdout)
    payload = json.loads(response.read_text())
    if metadata.get('FunctionError'):
        raise SystemExit(f'Lambda {metadata["FunctionError"]}: {payload.get("errorMessage", payload)}')
    if metadata.get('StatusCode') != 200:
        raise SystemExit(f'AWS Lambda invocation returned: {metadata}')
    observation = payload['observation']
    view = observation.get('perspectiveView')
    if view:
        filename = view['file']
        if Path(filename).name != filename or Path(filename).suffix.lower() != '.jpg':
            raise SystemExit('Lambda perspective view filename validation failed.')
        try:
            jpeg = base64.b64decode(payload['perspectiveJpegBase64'], validate=True)
        except (KeyError, ValueError, binascii.Error) as exc:
            raise SystemExit('Lambda perspective image decoding failed.') from exc
        (args.output / filename).write_bytes(jpeg)
    observation['execution'] = payload['execution']
    print(json.dumps(observation))
