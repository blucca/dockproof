#!/usr/bin/env python3
"""A local, single-case capture workstation. All state lives in --state."""
import argparse
import json
import mimetypes
import os
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from capture import inspect

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 8 * 1024 * 1024
LOCK = threading.Lock()


def sample_catalog():
    """Present licensed examples and map their public URLs to retained assets."""
    fixture_manifest = ROOT / 'fixtures' / 'manifest.json'
    catalog = json.loads(fixture_manifest.read_text()) if fixture_manifest.exists() else {'samples': []}
    files = {sample['url']: ROOT / 'fixtures' / sample['url'].rsplit('/', 1)[-1]
             for sample in catalog['samples']}
    catalog['parcelSamples'] = []
    domain_manifest = ROOT / 'domain' / 'manifest.json'
    if domain_manifest.exists():
        for sample in json.loads(domain_manifest.read_text())['samples']:
            if sample['file'] in ('small-parcel.jpg', 'package-label-reuse.jpg'):
                url = '/samples/domain/' + sample['file']
                catalog['parcelSamples'].append({**sample, 'id': Path(sample['file']).stem,
                                                  'url': url, 'kind': 'natural_parcel_photo'})
                files[url] = ROOT / 'domain' / 'images' / sample['file']
    return catalog, files


def now():
    return datetime.now(timezone.utc).isoformat()


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--port', type=int, default=18627)
    ap.add_argument('--state', type=Path, required=True)
    ap.add_argument('--controller', choices=['rules', 'agent'], default='rules')
    args = ap.parse_args()
    args.state.mkdir(parents=True, exist_ok=True)
    artifacts = args.state / 'files'
    artifacts.mkdir(exist_ok=True)
    state_file = args.state / 'session.json'
    state = json.loads(state_file.read_text()) if state_file.exists() else {
        'schemaVersion': 1, 'id': str(uuid.uuid4()), 'createdAt': now(),
        'captures': [], 'review': None, 'reviews': [],
        'execution': 'local_OpenCV5_with_rule_based_requests'}
    state['execution'] = ('local_OpenCV5_with_native_model_tools' if args.controller == 'agent'
                          else 'local_OpenCV5_with_rule_based_requests')
    if args.controller == 'agent' and os.environ.get('CAPTURE_MEASURE_FUNCTION'):
        state['execution'] = 'AWS_Lambda_OpenCV5_with_native_model_tools'
    max_bytes = 4_000_000 if state['execution'].startswith('AWS_Lambda') else MAX_BYTES
    state['maxImageBytes'] = max_bytes
    samples, sample_files = sample_catalog()

    def persist():
        pending = args.state / 'session.pending.json'
        pending.write_text(json.dumps(state, indent=2) + '\n')
        pending.replace(state_file)

    persist()

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, fmt, *values):
            pass

        def respond(self, value, status=200):
            body = json.dumps(value).encode()
            self.send_response(status)
            self.send_header('Content-Type', 'application/json; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_GET(self):
            route = unquote(urlparse(self.path).path)
            if route in ('/api/session', '/api/export'):
                with LOCK:
                    return self.respond(state)
            if route == '/api/samples':
                return self.respond(samples)
            if route.startswith('/files/'):
                with LOCK:
                    allowed = {c['source']['file'] for c in state['captures']}
                    allowed.update(c['analysis']['derived']['file'] for c in state['captures'] if 'derived' in c['analysis'])
                filename = route.removeprefix('/files/')
                target = artifacts / filename if filename in allowed else None
            elif route.startswith('/samples/'):
                target = sample_files.get(route)
            else:
                target = ROOT / 'web' / (route.lstrip('/') or 'index.html')
                if not target.resolve().is_relative_to((ROOT / 'web').resolve()):
                    target = None
            if target is None or not target.is_file():
                return self.respond({'error': 'File path unavailable.'}, 404)
            body = target.read_bytes()
            self.send_response(200)
            self.send_header('Content-Type', mimetypes.guess_type(target.name)[0] or 'application/octet-stream')
            self.send_header('Content-Length', str(len(body)))
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Cache-Control', 'no-store')
            self.end_headers()
            self.wfile.write(body)

        def do_POST(self):
            # Local UI and loopback API are the supported execution surface.
            origin = self.headers.get('Origin')
            host = self.headers.get('Host', '')
            if host not in (f'127.0.0.1:{args.port}', f'localhost:{args.port}'):
                return self.respond({'error': 'Open the local workstation URL.'}, 403)
            if origin and origin not in (f'http://127.0.0.1:{args.port}', f'http://localhost:{args.port}'):
                return self.respond({'error': 'Use the local workstation page for this action.'}, 403)
            try:
                size = int(self.headers.get('Content-Length', '0'))
                if size < 1 or size > max_bytes:
                    raise ValueError(f'Choose a JPEG or PNG up to {max_bytes:,} bytes.')
                body = self.rfile.read(size)
                route = urlparse(self.path)
                with LOCK:
                    if route.path == '/api/capture':
                        params = parse_qs(route.query)
                        previous = state['captures'][-1]['id'] if state['captures'] else None
                        supplied = params.get('replaces', [None])[0]
                        if supplied != previous:
                            return self.respond({'error': 'A newer capture is ready. Reload this page and continue from it.'}, 409)
                        extension = 'jpg' if body.startswith(b'\xff\xd8\xff') else 'png' if body.startswith(b'\x89PNG\r\n\x1a\n') else None
                        if extension is None:
                            raise ValueError('Choose a JPEG or PNG photograph.')
                        capture_id = uuid.uuid4().hex
                        original = artifacts / (capture_id + '.' + extension)
                        original.write_bytes(body)
                        try:
                            agent_trace = None
                            if args.controller == 'agent':
                                command = [os.environ.get('CAPTURE_NODE', 'node'), '--use-env-proxy',
                                           str(ROOT / 'agent.mjs'), '--source', str(original),
                                           '--output', str(artifacts), '--capture-id', capture_id]
                                if state['captures']:
                                    prior = state['captures'][-1]
                                    context_file = args.state / 'agent-context.json'
                                    context_file.write_text(json.dumps({
                                        'captureId': prior['id'], 'action': prior['analysis']['action'],
                                        'instruction': prior['analysis']['request']}))
                                    command += ['--previous', str(context_file)]
                                env = {**os.environ, 'CAPTURE_PYTHON': sys.executable}
                                completed = subprocess.run(command, capture_output=True, text=True,
                                                           check=True, timeout=540, env=env)
                                result = json.loads(completed.stdout)
                                analysis, agent_trace = result['analysis'], result['trace']
                            else:
                                analysis = inspect(original, artifacts)
                        except subprocess.CalledProcessError as error:
                            raise ValueError(error.stderr.strip() or 'Agent execution failed. Check the configured provider and credit budget.') from error
                        except Exception:
                            original.unlink(missing_ok=True)
                            raise
                        if 'derived' in analysis:
                            analysis['derived']['url'] = '/files/' + analysis['derived']['file']
                        record = {
                            'id': capture_id, 'capturedAt': now(), 'previousCaptureId': previous,
                            'source': {'file': original.name, 'name': params.get('name', ['photo.' + extension])[0][:160],
                                       'sha256': analysis['sourceSha256'], 'width': analysis['inputPx'][0], 'height': analysis['inputPx'][1],
                                       'url': '/files/' + original.name}, 'analysis': analysis}
                        if agent_trace:
                            record['agentTrace'] = agent_trace
                        state['captures'].append(record)
                        state['review'] = None
                        persist()
                        return self.respond(record)
                    if route.path == '/api/review':
                        values = json.loads(body)
                        current = state['captures'][-1] if state['captures'] else None
                        if current is None or values.get('captureId') != current['id']:
                            raise ValueError('Review the latest capture shown on this page.')
                        if current['analysis']['action'] != 'prepare_document_review':
                            raise ValueError('Complete the capture request before recording a checked field.')
                        if values.get('confirmed') is not True:
                            raise ValueError('Compare the original and review view, then select the confirmation box.')
                        fields = {key: str(values.get(key, '')).strip()[:limit] for key, limit in [('field', 120), ('value', 400), ('reviewer', 100)]}
                        if not all(fields.values()):
                            raise ValueError('Enter a field, its printed value, and the reviewer name or role.')
                        review = {**fields, 'captureId': current['id'], 'sourceSha256': current['source']['sha256'],
                                  'derivedSha256': current['analysis']['derived']['sha256'],
                                  'confirmed': True, 'reviewedAt': now()}
                        state['review'] = review
                        state['reviews'].append(review)
                        persist()
                        return self.respond(review)
                    return self.respond({'error': 'API route unavailable.'}, 404)
            except (ValueError, TypeError, KeyError) as error:
                return self.respond({'error': str(error)}, 400)
            except Exception:
                return self.respond({'error': 'Photo processing failed. Retry with a smaller JPEG or PNG.'}, 500)

    server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    print(json.dumps({'url': f'http://127.0.0.1:{args.port}', 'state': str(args.state), 'opencv': '5',
                      'scope': 'local_single_case', 'controller': args.controller}), flush=True)
    server.serve_forever()


if __name__ == '__main__':
    main()
