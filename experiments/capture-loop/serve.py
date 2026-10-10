#!/usr/bin/env python3
"""A local capture workstation, with an optional isolated HTTPS trial."""
import argparse
import copy
import hashlib
import json
import logging
from logging.handlers import RotatingFileHandler
import math
import mimetypes
import os
import re
import secrets
import shutil
import signal
import subprocess
import sys
import threading
import uuid
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http.cookies import CookieError, SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

ROOT = Path(__file__).resolve().parent
MAX_BYTES = 8 * 1024 * 1024
COOKIE_NAME = '__Host-capture_session'
TOKEN_PATTERN = re.compile(r'^[A-Za-z0-9_-]{43}$')
CHILD_TIMEOUT = 90
CLEANUP_SECONDS = 60


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
    return datetime.now(timezone.utc)


def iso(value):
    return value.astimezone(timezone.utc).isoformat()


def timestamp(value):
    try:
        parsed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        if parsed.tzinfo is None:
            raise ValueError()
        return parsed.astimezone(timezone.utc)
    except (ValueError, AttributeError) as error:
        raise argparse.ArgumentTypeError('Use an ISO timestamp with a timezone.') from error


def public_origin(value):
    parsed = urlparse(value)
    if (parsed.scheme != 'https' or not parsed.hostname or parsed.username or parsed.password
            or parsed.path not in ('', '/') or parsed.query or parsed.fragment):
        raise argparse.ArgumentTypeError('Use the HTTPS origin, for example https://capture.example.com.')
    try:
        port = parsed.port
    except ValueError as error:
        raise argparse.ArgumentTypeError('Use a valid HTTPS port.') from error
    host = parsed.hostname.lower()
    if ':' in host:
        host = '[' + host + ']'
    return 'https://' + host + (f':{port}' if port and port != 443 else '')


def atomic_json(path, value):
    pending = path.with_name(path.name + '.pending')
    with pending.open('w') as handle:
        os.chmod(pending, 0o600)
        json.dump(value, handle, indent=2)
        handle.write('\n')
        handle.flush()
        os.fsync(handle.fileno())
    pending.replace(path)


class RequestError(Exception):
    def __init__(self, message, status=400, code=None):
        super().__init__(message)
        self.status, self.code = status, code


class CaptureService:
    def __init__(self, args):
        self.args = args
        self.port = args.port
        self.lock = threading.RLock()
        self.capture_gate = threading.Lock()
        self.active_key = None
        self.worker = None
        self.stop_cleanup = threading.Event()
        self.cleanup_thread = None
        self.root = args.state.resolve()
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.sessions = self.root / 'sessions'
        self.quota_file = self.root / 'quota.json'
        self.quota = {'schemaVersion': 1, 'totalAttempts': 0, 'sessionAttempts': {}}
        self.logger = logging.getLogger('capture.' + uuid.uuid4().hex)
        self.logger.setLevel(logging.INFO)
        self.logger.propagate = False
        log = RotatingFileHandler(self.root / 'service.log', maxBytes=1_048_576, backupCount=2)
        os.chmod(self.root / 'service.log', 0o600)
        log.setFormatter(logging.Formatter('%(asctime)s %(levelname)s %(message)s'))
        self.logger.addHandler(log)
        self.execution = ('local_OpenCV5_with_native_model_tools' if args.controller == 'agent'
                          else 'local_OpenCV5_with_rule_based_requests')
        if args.controller == 'agent' and os.environ.get('CAPTURE_MEASURE_FUNCTION'):
            self.execution = 'AWS_Lambda_OpenCV5_with_native_model_tools'
        self.max_bytes = 4_000_000 if self.execution.startswith('AWS_Lambda') else MAX_BYTES
        self.scope = 'hosted_browser_session' if args.hosted else 'local_single_case'
        self.samples, self.sample_files = sample_catalog()
        if args.hosted:
            os.chmod(self.root, 0o700)
            self.sessions.mkdir(exist_ok=True, mode=0o700)
            if self.quota_file.exists():
                self.quota = json.loads(self.quota_file.read_text())
                if (type(self.quota.get('totalAttempts')) is not int
                        or self.quota['totalAttempts'] < 0
                        or not isinstance(self.quota.get('sessionAttempts'), dict)
                        or any(type(count) is not int or count < 0
                               for count in self.quota['sessionAttempts'].values())):
                    raise ValueError('The persisted capture quota needs operator review.')
            else:
                atomic_json(self.quota_file, self.quota)
            self.cleanup_expired()
        else:
            path = self.root / 'session.json'
            state = json.loads(path.read_text()) if path.exists() else self.new_state()
            state['execution'] = self.execution
            state['maxImageBytes'] = self.max_bytes
            state.setdefault('reviews', [])
            (self.root / 'files').mkdir(exist_ok=True)
            atomic_json(path, state)

    def new_state(self):
        created = now()
        state = {'schemaVersion': 1, 'id': str(uuid.uuid4()), 'createdAt': iso(created),
                 'captures': [], 'review': None, 'reviews': [],
                 'execution': self.execution, 'maxImageBytes': self.max_bytes}
        if self.args.hosted:
            state['expiresAt'] = iso(created + timedelta(hours=self.args.session_hours))
        return state

    def directory(self, key):
        return self.sessions / key if self.args.hosted else self.root

    def read_state(self, key):
        path = self.directory(key) / 'session.json'
        if not path.exists():
            raise RequestError('This session has expired. Reload to start a fresh session.', 410, 'session_expired')
        state = json.loads(path.read_text())
        if self.args.hosted and timestamp(state['expiresAt']) <= now():
            self.cleanup_expired()
            raise RequestError('This session has expired. Reload to start a fresh session.', 410, 'session_expired')
        state['execution'] = self.execution
        state['maxImageBytes'] = self.max_bytes
        return state

    @staticmethod
    def cookie_key(raw_cookie):
        cookie = SimpleCookie()
        try:
            cookie.load(raw_cookie or '')
        except CookieError:
            return None
        token = cookie[COOKIE_NAME].value if COOKIE_NAME in cookie else ''
        return hashlib.sha256(token.encode()).hexdigest() if TOKEN_PATTERN.fullmatch(token) else None

    def session(self, raw_cookie, create=False):
        with self.lock:
            self.cleanup_expired()
            if not self.args.hosted:
                return 'local', self.read_state('local'), None
            key = self.cookie_key(raw_cookie)
            if key and (self.directory(key) / 'session.json').is_file():
                return key, self.read_state(key), None
            if not create:
                message = ('This session has expired. Reload to start a fresh session.' if key else
                           'Open or reload the capture station before uploading.')
                raise RequestError(message, 410 if key else 409, 'session_expired' if key else 'session_required')
            token = secrets.token_urlsafe(32)
            key = hashlib.sha256(token.encode()).hexdigest()
            directory = self.directory(key)
            directory.mkdir(mode=0o700)
            (directory / 'files').mkdir(mode=0o700)
            state = self.new_state()
            atomic_json(directory / 'session.json', state)
            expires = timestamp(state['expiresAt'])
            cookie = SimpleCookie()
            cookie[COOKIE_NAME] = token
            item = cookie[COOKIE_NAME]
            item['path'], item['secure'], item['httponly'], item['samesite'] = '/', True, True, 'Lax'
            item['max-age'] = str(max(1, int(self.args.session_hours * 3600)))
            item['expires'] = format_datetime(expires, usegmt=True)
            return key, state, item.OutputString()

    def capture_status(self, key, state, include_busy=True):
        if self.args.hosted:
            if timestamp(state['expiresAt']) <= now():
                return 'session_expired'
            if self.args.expires_at <= now():
                return 'trial_closed'
            if self.quota['sessionAttempts'].get(key, 0) >= self.args.max_session_captures:
                return 'session_limit'
            if self.quota['totalAttempts'] >= self.args.max_total_captures:
                return 'service_limit'
        if include_busy and self.capture_gate.locked():
            return 'busy'
        return 'ready'

    def public_state(self, key, state=None):
        with self.lock:
            state = copy.deepcopy(state if state is not None else self.read_state(key))
            status = self.capture_status(key, state)
            state.update(scope=self.scope, captureReady=status == 'ready', captureStatus=status)
            if self.args.hosted:
                used = self.quota['sessionAttempts'].get(key, 0)
                state.update(trialExpiresAt=iso(self.args.expires_at),
                             sessionHours=(timestamp(state['expiresAt']) - timestamp(state['createdAt'])).total_seconds() / 3600,
                             captureAllowance={'limit': self.args.max_session_captures, 'used': used,
                                               'remaining': max(0, self.args.max_session_captures - used)})
            return state

    def health(self):
        with self.lock:
            self.cleanup_expired()
            readiness = 'busy' if self.capture_gate.locked() else 'ready'
            if self.args.hosted:
                if self.quota['totalAttempts'] >= self.args.max_total_captures:
                    readiness = 'paused'
                if self.args.expires_at <= now():
                    readiness = 'expired'
            return {'scope': self.scope, 'readiness': readiness,
                    'expiresAt': iso(self.args.expires_at) if self.args.hosted else None,
                    'sessionHours': self.args.session_hours if self.args.hosted else None,
                    'maxImageBytes': self.max_bytes, 'controller': self.args.controller}

    def stop_worker(self):
        if self.worker is not None and self.worker.poll() is None:
            try:
                os.killpg(self.worker.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.worker.wait(timeout=5)

    def cleanup_expired(self):
        if not self.args.hosted:
            return
        with self.lock:
            for directory in self.sessions.iterdir():
                path = directory / 'session.json'
                if not directory.is_dir() or not path.is_file():
                    continue
                state = json.loads(path.read_text())
                if timestamp(state['expiresAt']) <= now():
                    if self.active_key == directory.name:
                        self.stop_worker()
                    shutil.rmtree(directory)

    def start_background_cleanup(self):
        def run():
            while not self.stop_cleanup.wait(CLEANUP_SECONDS):
                try:
                    self.cleanup_expired()
                except Exception:
                    self.logger.exception('Session cleanup failed')
        if self.args.hosted:
            self.cleanup_thread = threading.Thread(target=run, name='capture-session-cleanup', daemon=True)
            self.cleanup_thread.start()

    def close(self):
        self.stop_cleanup.set()
        if self.cleanup_thread:
            self.cleanup_thread.join(timeout=6)
        with self.lock:
            self.stop_worker()
        for handler in list(self.logger.handlers):
            handler.close()
            self.logger.removeHandler(handler)

    def reserve_capture(self, key, previous):
        with self.lock:
            state = self.read_state(key)
            current = state['captures'][-1]['id'] if state['captures'] else None
            if previous != current:
                raise RequestError('A newer capture is ready. Reload this page and continue from it.', 409, 'stale_capture')
            status = self.capture_status(key, state, include_busy=False)
            failures = {
                'trial_closed': ('This trial has closed. You can still review and export this session.', 410),
                'session_expired': ('This session has expired. Reload to start a fresh session.', 410),
                'session_limit': ('This session has used its photo attempts. Review or export your saved captures.', 429),
                'service_limit': ('Photo processing is paused for this trial. Your saved session remains available.', 429),
            }
            if status in failures:
                raise RequestError(*failures[status], code=status)
            if self.args.hosted:
                # Both counters share one atomic ledger. An interrupted or failed attempt remains charged.
                updated = copy.deepcopy(self.quota)
                updated['totalAttempts'] += 1
                updated['sessionAttempts'][key] = updated['sessionAttempts'].get(key, 0) + 1
                atomic_json(self.quota_file, updated)
                self.quota = updated
            self.active_key = key
            return state

    def process_photo(self, key, original, artifacts, capture_id, prior):
        directory = self.directory(key)
        env = {**os.environ, 'CAPTURE_PYTHON': sys.executable}
        if env.get('PYTHONPATH'):
            env['PYTHONPATH'] = os.pathsep.join(str(Path(entry).resolve())
                                              for entry in env['PYTHONPATH'].split(os.pathsep))
        if self.args.controller == 'agent':
            command = [os.environ.get('CAPTURE_NODE', 'node'), '--use-env-proxy',
                       str(ROOT / 'agent.mjs'), '--source', str(original),
                       '--output', str(artifacts), '--capture-id', capture_id]
            if prior:
                context_file = directory / 'agent-context.json'
                atomic_json(context_file, {'captureId': prior['id'], 'action': prior['analysis']['action'],
                                           'instruction': prior['analysis']['request']})
                command += ['--previous', str(context_file)]
            if self.args.hosted:
                env['CAPTURE_PROVIDER_LOG_DIR'] = str(directory / 'provider-logs')
        else:
            command = [sys.executable, '-B', '-c',
                       'import json,sys; from capture import inspect; '
                       'print(json.dumps({"analysis": inspect(sys.argv[1], sys.argv[2])}))',
                       str(original), str(artifacts)]
        with self.lock:
            self.read_state(key)
            process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                                       text=True, env=env, cwd=ROOT, start_new_session=True)
            self.worker = process
        try:
            stdout, stderr = process.communicate(timeout=CHILD_TIMEOUT)
        except subprocess.TimeoutExpired:
            with self.lock:
                self.stop_worker()
            stdout, stderr = process.communicate()
            self.logger.error('Capture %s timed out. stderr=%s', capture_id, stderr)
            raise RequestError('Photo processing timed out. Please try again.', 504, 'processing_timeout')
        if process.returncode:
            self.logger.error('Capture %s failed (%s). stderr=%s', capture_id, process.returncode, stderr)
            raise RequestError('Photo processing failed. Try a smaller JPEG or PNG.', 502, 'processing_failed')
        return json.loads(stdout)

    @staticmethod
    def visitor_trace(trace):
        # Recovered tool errors can contain subprocess paths. Keep those details in private logs.
        trace = copy.deepcopy(trace)
        for message in trace.get('messages', []):
            if message.get('role') == 'tool':
                try:
                    value = json.loads(message.get('content', ''))
                    if isinstance(value, dict) and 'error' in value:
                        message['content'] = json.dumps({'error': 'Image measurement paused for this tool call.'})
                except (TypeError, ValueError):
                    message['content'] = json.dumps({'error': 'Image measurement paused for this tool call.'})
        trace.pop('error', None)
        return trace

    def capture(self, key, body, params):
        extension = 'jpg' if body.startswith(b'\xff\xd8\xff') else 'png' if body.startswith(b'\x89PNG\r\n\x1a\n') else None
        if extension is None:
            raise RequestError('Choose a JPEG or PNG photograph.')
        previous = params.get('replaces', [None])[0]
        state = self.reserve_capture(key, previous)
        capture_id = uuid.uuid4().hex
        artifacts = self.directory(key) / 'files'
        original = artifacts / (capture_id + '.' + extension)
        try:
            with self.lock:
                self.read_state(key)
                original.write_bytes(body)
                os.chmod(original, 0o600)
            result = self.process_photo(key, original, artifacts, capture_id,
                                        state['captures'][-1] if state['captures'] else None)
            analysis = result['analysis']
            if 'derived' in analysis:
                filename = analysis['derived']['file']
                if filename != capture_id + '-rectified.jpg' or not (artifacts / filename).is_file():
                    raise ValueError('Invalid derived capture file.')
                analysis['derived']['url'] = '/files/' + filename
            record = {
                'id': capture_id, 'capturedAt': iso(now()), 'previousCaptureId': previous,
                'source': {'file': original.name, 'name': params.get('name', ['photo.' + extension])[0][:160],
                           'sha256': analysis['sourceSha256'], 'width': analysis['inputPx'][0], 'height': analysis['inputPx'][1],
                           'url': '/files/' + original.name}, 'analysis': analysis}
            if result.get('trace'):
                record['agentTrace'] = self.visitor_trace(result['trace']) if self.args.hosted else result['trace']
            with self.lock:
                state = self.read_state(key)
                state['captures'].append(record)
                state['review'] = None
                atomic_json(self.directory(key) / 'session.json', state)
            return record
        except Exception:
            for path in artifacts.glob(capture_id + '*'):
                path.unlink(missing_ok=True)
            raise
        finally:
            with self.lock:
                self.active_key = None
                self.worker = None

    def review(self, key, values):
        if not isinstance(values, dict):
            raise RequestError('Send the field-review form as a JSON object.')
        with self.lock:
            state = self.read_state(key)
            current = state['captures'][-1] if state['captures'] else None
            if current is None or values.get('captureId') != current['id']:
                raise RequestError('Review the latest capture shown on this page.', 409, 'stale_capture')
            if current['analysis']['action'] != 'prepare_document_review':
                raise RequestError('Complete the capture request before recording a checked field.')
            if values.get('confirmed') is not True:
                raise RequestError('Compare the original and review view, then select the confirmation box.')
            fields = {key: str(values.get(key, '')).strip()[:limit] for key, limit in [('field', 120), ('value', 400), ('reviewer', 100)]}
            if not all(fields.values()):
                raise RequestError('Enter a field, its printed value, and the reviewer name or role.')
            review = {**fields, 'captureId': current['id'], 'sourceSha256': current['source']['sha256'],
                      'derivedSha256': current['analysis']['derived']['sha256'],
                      'confirmed': True, 'reviewedAt': iso(now())}
            state['review'] = review
            state['reviews'].append(review)
            atomic_json(self.directory(key) / 'session.json', state)
            return review

    def reset(self, key):
        with self.lock:
            state = self.read_state(key)
            if self.active_key == key:
                raise RequestError('This photo is processing. Reset after it finishes.', 409, 'busy')
            directory = self.directory(key)
            for name in ('files', 'provider-logs'):
                path = directory / name
                if path.exists():
                    shutil.rmtree(path)
            (directory / 'agent-context.json').unlink(missing_ok=True)
            (directory / 'files').mkdir(mode=0o700)
            state.update(captures=[], review=None, reviews=[], resetAt=iso(now()))
            atomic_json(directory / 'session.json', state)
            return self.public_state(key, state)


def handler_for(service):
    class Handler(BaseHTTPRequestHandler):
        def setup(self):
            super().setup()
            self.connection.settimeout(25)

        def log_message(self, fmt, *values):
            pass

        def headers_for(self, status, content_type, size, cookie=None):
            self.send_response(status)
            self.send_header('Content-Type', content_type)
            self.send_header('Content-Length', str(size))
            self.send_header('Cache-Control', 'no-store')
            self.send_header('X-Content-Type-Options', 'nosniff')
            self.send_header('Referrer-Policy', 'no-referrer')
            self.send_header('Content-Security-Policy', "frame-ancestors 'none'")
            if cookie:
                self.send_header('Set-Cookie', cookie)
            if status == 429:
                self.send_header('Retry-After', '5')
            self.end_headers()

        def respond(self, value, status=200, cookie=None):
            body = json.dumps(value).encode()
            self.headers_for(status, 'application/json; charset=utf-8', len(body), cookie)
            self.wfile.write(body)

        def boundary(self):
            local_origins = {f'127.0.0.1:{service.port}': f'http://127.0.0.1:{service.port}',
                             f'localhost:{service.port}': f'http://localhost:{service.port}'}
            allowed = dict(local_origins)
            if service.args.hosted:
                allowed[urlparse(service.args.public_origin).netloc] = service.args.public_origin
            hosts = self.headers.get_all('Host', [])
            host = hosts[0].lower() if len(hosts) == 1 else ''
            expected_origin = allowed.get(host)
            origins = self.headers.get_all('Origin', [])
            if not expected_origin or len(origins) > 1 or (origins and origins[0] != expected_origin):
                raise RequestError('Use the capture station page for this request.', 403, 'origin_rejected')
            if self.command == 'POST' and self.headers.get('Sec-Fetch-Site') == 'cross-site':
                raise RequestError('Use the capture station page for this action.', 403, 'origin_rejected')
            service.cleanup_expired()

        def route_error(self, error):
            if isinstance(error, RequestError):
                value = {'error': str(error)}
                if error.code:
                    value['code'] = error.code
                return self.respond(value, error.status)
            if isinstance(error, (BrokenPipeError, ConnectionResetError)):
                return
            service.logger.exception('Request failed: %s', self.command)
            return self.respond({'error': 'The capture station paused this request. Please reload and try again.'}, 500)

        def do_GET(self):
            try:
                self.boundary()
                route = unquote(urlparse(self.path).path)
                if route == '/api/health':
                    return self.respond(service.health())
                if route in ('/api/session', '/api/export'):
                    key, state, cookie = service.session(self.headers.get('Cookie'), create=True)
                    return self.respond(service.public_state(key, state), cookie=cookie)
                if route == '/api/samples':
                    return self.respond(service.samples)
                if route.startswith('/files/'):
                    try:
                        key, state, _ = service.session(self.headers.get('Cookie'))
                    except RequestError:
                        return self.respond({'error': 'This image is unavailable in this session.'}, 404)
                    filename = route.removeprefix('/files/')
                    with service.lock:
                        state = service.read_state(key)
                        allowed = {c['source']['file'] for c in state['captures']}
                        allowed.update(c['analysis']['derived']['file'] for c in state['captures'] if 'derived' in c['analysis'])
                        target = service.directory(key) / 'files' / filename if filename in allowed else None
                        body = target.read_bytes() if target is not None and target.is_file() else None
                else:
                    if route.startswith('/samples/'):
                        target = service.sample_files.get(route)
                    else:
                        target = ROOT / 'web' / (route.lstrip('/') or 'index.html')
                        if not target.resolve().is_relative_to((ROOT / 'web').resolve()):
                            target = None
                    body = target.read_bytes() if target is not None and target.is_file() else None
                if body is None:
                    return self.respond({'error': 'This file is unavailable.'}, 404)
                self.headers_for(200, mimetypes.guess_type(target.name)[0] or 'application/octet-stream', len(body))
                self.wfile.write(body)
            except Exception as error:
                self.route_error(error)

        def read_body(self, allow_empty=False):
            if self.headers.get('Transfer-Encoding'):
                raise RequestError('Send the photo with its content length.', 400)
            lengths = self.headers.get_all('Content-Length', [])
            if len(lengths) > 1:
                raise RequestError('Send one content length.')
            try:
                size = int(lengths[0]) if len(lengths) == 1 else 0
            except ValueError:
                raise RequestError('Send a valid content length.')
            if size < (0 if allow_empty else 1) or size > service.max_bytes:
                raise RequestError(f'Choose a JPEG or PNG up to {service.max_bytes:,} bytes.', 413)
            body = self.rfile.read(size)
            if len(body) != size:
                raise RequestError('The upload was interrupted. Please try again.')
            return body

        def do_POST(self):
            owns_gate = False
            try:
                self.boundary()
                route = urlparse(self.path)
                if route.path not in ('/api/capture', '/api/review', '/api/reset'):
                    raise RequestError('This API route is unavailable.', 404)
                if route.path == '/api/capture':
                    owns_gate = service.capture_gate.acquire(blocking=False)
                    if not owns_gate:
                        raise RequestError('A photo is processing. Please try again shortly.', 429, 'busy')
                key, _, _ = service.session(self.headers.get('Cookie'))
                body = self.read_body(allow_empty=route.path == '/api/reset')
                if route.path == '/api/reset':
                    return self.respond(service.reset(key))
                if route.path == '/api/capture':
                    record = service.capture(key, body, parse_qs(route.query))
                    service.capture_gate.release()
                    owns_gate = False
                    return self.respond(record)
                try:
                    values = json.loads(body)
                except (ValueError, UnicodeDecodeError):
                    raise RequestError('Send the field-review form as valid JSON.')
                return self.respond(service.review(key, values))
            except Exception as error:
                self.route_error(error)
            finally:
                if owns_gate:
                    service.capture_gate.release()

    return Handler


def create_server(args):
    service = CaptureService(args)
    server = ThreadingHTTPServer(('127.0.0.1', args.port), handler_for(service))
    service.port = server.server_port
    server.capture_service = service
    service.start_background_cleanup()
    return server


def arguments(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--port', type=int, default=18627)
    ap.add_argument('--state', type=Path, required=True)
    ap.add_argument('--controller', choices=['rules', 'agent'], default='rules')
    ap.add_argument('--hosted', action='store_true')
    ap.add_argument('--public-origin', type=public_origin)
    ap.add_argument('--expires-at', type=timestamp)
    ap.add_argument('--session-hours', type=float, default=24)
    ap.add_argument('--max-session-captures', type=int, default=6)
    ap.add_argument('--max-total-captures', type=int, default=40)
    args = ap.parse_args(argv)
    if args.hosted and (not args.public_origin or not args.expires_at):
        ap.error('Hosted mode requires --public-origin and --expires-at.')
    if (not math.isfinite(args.session_hours) or args.session_hours <= 0
            or args.max_session_captures < 1 or args.max_total_captures < 1):
        ap.error('Session duration and capture limits must be positive.')
    return args


def main():
    args = arguments()
    if args.hosted:
        os.umask(0o077)
    server = create_server(args)
    service = server.capture_service
    print(json.dumps({'url': args.public_origin if args.hosted else f'http://127.0.0.1:{service.port}',
                      'state': str(service.root), 'opencv': '5', 'scope': service.scope,
                      'controller': args.controller}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        service.close()


if __name__ == '__main__':
    main()
