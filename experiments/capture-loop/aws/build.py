#!/usr/bin/env python3
"""Build a Python 3.13 / x86_64 Lambda ZIP from pinned manylinux wheels."""
import argparse
import json
import os
import shutil
import subprocess
import sys
import zipfile
from pathlib import Path

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', type=Path, required=True, help='Temporary build directory')
args = parser.parse_args()
root = Path(__file__).resolve().parent
output = args.output.resolve()
output.mkdir(parents=True, exist_ok=True)
stage = output / 'package'
if stage.exists():
    shutil.rmtree(stage)
stage.mkdir()
env = dict(os.environ, UV_CACHE_DIR=str(output / 'uv-cache'),
           TMPDIR=str(output), UV_LINK_MODE='copy')
subprocess.run([
    'uv', 'pip', 'install', '--python', sys.executable,
    '--python-version', '3.13', '--python-platform', 'x86_64-manylinux_2_28',
    '--only-binary', ':all:', '--target', str(stage),
    '--requirements', str(root.parent / 'requirements.txt'),
], env=env, check=True)
for source in (root / 'handler.py', root.parent / 'capture.py'):
    shutil.copy2(source, stage / source.name)
for folder in stage.rglob('__pycache__'):
    shutil.rmtree(folder)
files = sorted(path for path in stage.rglob('*') if path.is_file())
unpacked_bytes = sum(path.stat().st_size for path in files)
if unpacked_bytes >= 250 * 1024 * 1024:
    raise SystemExit(f'Package exceeds the Lambda uncompressed size limit: {unpacked_bytes}')
artifact = output / 'capture-measure.zip'
with zipfile.ZipFile(artifact, 'w', zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
    for path in files:
        archive.write(path, path.relative_to(stage))
report = {
    'runtime': 'python3.13', 'architecture': 'x86_64',
    'platform': 'Amazon Linux 2023; manylinux_2_28-compatible wheels',
    'zip': str(artifact), 'zipBytes': artifact.stat().st_size,
    'uncompressedBytes': unpacked_bytes, 'uncompressedLimitBytes': 250 * 1024 * 1024,
    'files': len(files),
    'wheelMetadata': {p.parent.name: p.read_text() for p in stage.glob('*.dist-info/WHEEL')},
    'upload': 'private S3 staging' if artifact.stat().st_size > 50 * 1024 * 1024 else 'direct or S3',
}
(output / 'build.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2))
