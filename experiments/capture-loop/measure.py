#!/usr/bin/env python3
"""The capture agent's OpenCV tool: numeric observations and a derived view."""
import argparse
import json
from pathlib import Path

from capture import measure

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--source', type=Path, required=True)
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
args.output.mkdir(parents=True, exist_ok=True)
print(json.dumps(measure(args.source, args.output)))
