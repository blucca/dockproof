"""Private synchronous Lambda tool for the capture agent's OpenCV measurements."""
import base64
import binascii
import os
import platform
import re
import tempfile
from pathlib import Path

from capture import measure

MAX_IMAGE_BYTES = 4_000_000


def lambda_handler(event, context):
    encoded = event.get('imageBase64')
    if not isinstance(encoded, str) or len(encoded) > 4 * ((MAX_IMAGE_BYTES + 2) // 3):
        raise ValueError('Send imageBase64 containing a JPEG or PNG of up to 4,000,000 bytes.')
    try:
        source = base64.b64decode(encoded, validate=True)
    except (ValueError, binascii.Error) as exc:
        raise ValueError('imageBase64 must use standard base64 encoding.') from exc
    if not source or len(source) > MAX_IMAGE_BYTES:
        raise ValueError('Use a JPEG or PNG of 1 to 4,000,000 bytes.')
    name = Path(str(event.get('filename', 'capture.png'))).name
    name = re.sub(r'[^a-zA-Z0-9_.-]', '-', name)[-120:]
    if Path(name).suffix.lower() not in ('.png', '.jpg', '.jpeg'):
        raise ValueError('filename must end in .jpg, .jpeg or .png.')
    with tempfile.TemporaryDirectory(prefix='capture-', dir='/tmp') as directory:
        path = Path(directory) / name
        path.write_bytes(source)
        observation = measure(path, directory)
        response = {'observation': observation, 'execution': {
            'service': 'aws-lambda', 'region': os.environ.get('AWS_REGION'),
            'runtime': platform.python_version(), 'architecture': platform.machine(),
            'requestId': context.aws_request_id,
        }}
        view = observation.get('perspectiveView')
        if view:
            response['perspectiveJpegBase64'] = base64.b64encode(
                (Path(directory) / view['file']).read_bytes()).decode('ascii')
        return response
