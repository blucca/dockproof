"""Focused HTTP contracts for the isolated trial; image checks use bundled parcel photos.

CAPTURE_TEST_ROOT selects the directory for disposable test state.
Run with the same Python/OpenCV environment as serve.py.
"""
import http.client
import importlib.util
import json
import os
from pathlib import Path
import tempfile
import threading
import time
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('capture_serve', ROOT / 'serve.py')
serve = importlib.util.module_from_spec(spec)
spec.loader.exec_module(serve)
PUBLIC = 'https://capture.example.test'
GLS = (ROOT / 'domain/images/small-parcel.jpg').read_bytes()
CROPPED = (ROOT / 'domain/images/package-label-reuse.jpg').read_bytes()


class Browser:
    def __init__(self, test):
        self.test, self.cookie = test, None

    def request(self, method, path, body=None, host='capture.example.test', origin=PUBLIC, headers=None):
        request_headers = {'Host': host}
        if self.cookie:
            request_headers['Cookie'] = self.cookie
        if method == 'POST' and origin is not None:
            request_headers['Origin'] = origin
        if headers:
            request_headers.update(headers)
        if isinstance(body, dict):
            body = json.dumps(body).encode()
            request_headers['Content-Type'] = 'application/json'
        connection = http.client.HTTPConnection('127.0.0.1', self.test.port, timeout=15)
        try:
            connection.request(method, path, body=body, headers=request_headers)
            response = connection.getresponse()
            data = response.read()
            result_headers = dict(response.getheaders())
            if response.getheader('Set-Cookie'):
                self.cookie = response.getheader('Set-Cookie').split(';', 1)[0]
            if response.getheader('Content-Type', '').startswith('application/json'):
                data = json.loads(data)
            return response.status, data, result_headers
        finally:
            connection.close()

    def session(self):
        status, state, headers = self.request('GET', '/api/session')
        self.test.assertEqual(status, 200)
        return state, headers

    def capture(self, body, previous=None):
        return self.request('POST', '/api/capture' + ('?replaces=' + previous if previous else ''), body)


class HostedContracts(unittest.TestCase):
    def setUp(self):
        root = Path(os.environ.get('CAPTURE_TEST_ROOT', Path.cwd() / 'temp' / 'hosted-tests'))
        root.mkdir(parents=True, exist_ok=True)
        self.storage = tempfile.TemporaryDirectory(prefix='capture-', dir=root)
        self.args = serve.arguments(['--port', '0', '--state', self.storage.name,
                                     '--hosted', '--public-origin', PUBLIC,
                                     '--expires-at', '2099-01-01T00:00:00Z'])
        self.cleanup_patch = patch.object(serve, 'CLEANUP_SECONDS', .05)
        self.cleanup_patch.start()
        self.start()

    def start(self):
        self.server = serve.create_server(self.args)
        self.service = self.server.capture_service
        self.port = self.server.server_port
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()

    def stop(self):
        self.server.shutdown()
        self.server.server_close()
        self.service.close()
        self.thread.join(timeout=2)

    def tearDown(self):
        self.stop()
        self.cleanup_patch.stop()
        self.storage.cleanup()

    def test_isolation_boundaries_responsive_reads_and_capture_lineage(self):
        a, b = Browser(self), Browser(self)
        first, headers = a.session()
        second, _ = b.session()
        self.assertNotEqual(first['id'], second['id'])
        self.assertEqual(first['captureAllowance'], {'limit': 6, 'used': 0, 'remaining': 6})
        for attribute in ('HttpOnly', 'SameSite=Lax', 'Secure', 'Path=/', 'Max-Age=86400'):
            self.assertIn(attribute, headers['Set-Cookie'])
        self.assertNotIn(a.cookie.split('=', 1)[1], json.dumps(first))
        self.assertNotIn('Set-Cookie', a.session()[1])  # Reading preserves the absolute expiry.
        self.assertEqual(a.request('GET', '/api/session', host='other.example')[0], 403)
        self.assertEqual(a.request('POST', '/api/reset', {}, origin='https://other.example')[0], 403)
        self.assertEqual(a.request('POST', '/api/reset', {}, origin=None,
                                   headers={'Sec-Fetch-Site': 'cross-site'})[0], 403)
        self.assertEqual(a.request('POST', '/api/reset', {}, origin=f'http://127.0.0.1:{self.port}')[0], 403)
        self.assertEqual(a.request('GET', '/api/health', host=f'127.0.0.1:{self.port}')[0], 200)

        # Hold the processing phase, then exercise another browser and GET while it runs.
        began, release = threading.Event(), threading.Event()
        original = self.service.process_photo
        uploaded = []

        def delayed(*args):
            began.set()
            if not release.wait(8):
                raise RuntimeError('Test capture release timed out')
            return original(*args)

        with patch.object(self.service, 'process_photo', delayed):
            worker = threading.Thread(target=lambda: uploaded.append(a.capture(GLS)), daemon=True)
            worker.start()
            try:
                self.assertTrue(began.wait(3))
                started = time.monotonic()
                self.assertEqual(b.capture(b'\x89PNG\r\n\x1a\n')[0], 429)
                busy, _ = a.session()
                self.assertEqual(busy['captureStatus'], 'busy')
                self.assertLess(time.monotonic() - started, 1.0)
                self.assertEqual(a.request('POST', '/api/reset', {})[0], 409)
            finally:
                release.set()
                worker.join(timeout=12)
        self.assertFalse(worker.is_alive())
        self.assertEqual(uploaded[0][0], 200)
        record = uploaded[0][1]
        self.assertEqual(record['analysis']['action'], 'prepare_document_review')
        source = record['source']['url']
        derived = record['analysis']['derived']['url']
        self.assertEqual(a.request('GET', source)[1], GLS)
        self.assertEqual(a.request('GET', derived)[0], 200)
        self.assertEqual(b.request('GET', source)[0], 404)
        self.assertEqual(b.request('GET', derived)[0], 404)
        self.assertEqual(b.request('GET', '/api/export')[1]['captures'], [])
        review = {'captureId': record['id'], 'confirmed': True, 'field': 'Date',
                  'value': '12.08.2010', 'reviewer': 'scripted contract check'}
        self.assertEqual(b.request('POST', '/api/review', review)[0], 409)
        self.assertEqual(a.request('POST', '/api/review', review)[0], 200)
        self.assertEqual(a.session()[0]['review']['value'], '12.08.2010')
        self.assertEqual(a.capture(CROPPED)[0], 409)
        self.assertEqual(a.session()[0]['captureAllowance']['used'], 1)
        status, next_record, _ = a.capture(CROPPED, record['id'])
        self.assertEqual(status, 200)
        self.assertEqual(next_record['previousCaptureId'], record['id'])
        session, _ = a.session()
        self.assertIsNone(session['review'])
        self.assertEqual(len(session['reviews']), 1)
        self.assertEqual(a.request('POST', '/api/review', review)[0], 409)
        self.assertEqual(a.request('GET', source)[0], 200)
        self.assertEqual(b.session()[0]['captureAllowance']['used'], 0)

    def test_attempt_ledger_survives_failure_reset_and_restart(self):
        self.args.max_session_captures, self.args.max_total_captures = 2, 3
        a = Browser(self)
        before, _ = a.session()
        status, record, _ = a.capture(GLS)
        self.assertEqual(status, 200)
        failed, error, _ = a.capture(b'\x89PNG\r\n\x1a\ninvalid image', record['id'])
        self.assertEqual(failed, 502)
        self.assertEqual(error['code'], 'processing_failed')
        self.assertNotIn(self.storage.name, error['error'])
        self.assertEqual(a.session()[0]['captureAllowance']['used'], 2)
        status, cleared, _ = a.request('POST', '/api/reset', {})
        self.assertEqual(status, 200)
        self.assertEqual(cleared['id'], before['id'])
        self.assertEqual(cleared['expiresAt'], before['expiresAt'])
        self.assertEqual(cleared['captures'], [])
        self.assertEqual(cleared['captureAllowance']['remaining'], 0)
        self.assertEqual(a.request('GET', record['source']['url'])[0], 404)
        directory = self.service.directory(self.service.cookie_key(a.cookie))
        self.assertEqual(list((directory / 'files').iterdir()), [])
        self.stop()
        self.start()
        self.assertEqual(a.session()[0]['captureAllowance']['used'], 2)
        self.assertEqual(a.capture(GLS)[1]['code'], 'session_limit')
        b = Browser(self)
        b.session()
        self.assertEqual(b.capture(CROPPED)[0], 200)
        self.assertEqual(self.service.quota['totalAttempts'], 3)
        c = Browser(self)
        c.session()
        self.assertEqual(c.capture(GLS)[1]['code'], 'service_limit')
        health = c.request('GET', '/api/health')[1]
        self.assertEqual(health['readiness'], 'paused')
        self.assertNotIn('totalAttempts', json.dumps(health))
        self.assertNotIn('maxTotal', json.dumps(health))

    def test_trial_expiry_keeps_export_and_session_ttl_deletes_data(self):
        a = Browser(self)
        a.session()
        status, record, _ = a.capture(GLS)
        self.assertEqual(status, 200)
        self.args.expires_at = serve.now() - serve.timedelta(seconds=1)
        self.assertEqual(a.capture(CROPPED, record['id'])[1]['code'], 'trial_closed')
        exported = a.request('GET', '/api/export')[1]
        self.assertEqual(exported['captures'][0]['id'], record['id'])
        self.assertEqual(exported['captureStatus'], 'trial_closed')
        self.assertEqual(a.request('GET', record['source']['url'])[0], 200)
        self.assertEqual(a.request('POST', '/api/review', {
            'captureId': record['id'], 'confirmed': True, 'field': 'Date',
            'value': '12.08.2010', 'reviewer': 'scripted expiry check'})[0], 200)
        # Stop the timer to establish that a request performs the first cleanup.
        self.service.stop_cleanup.set()
        self.service.cleanup_thread.join(timeout=1)
        key = self.service.cookie_key(a.cookie)
        directory = self.service.directory(key)
        state = json.loads((directory / 'session.json').read_text())
        state['expiresAt'] = serve.iso(serve.now() - serve.timedelta(seconds=1))
        serve.atomic_json(directory / 'session.json', state)
        self.assertEqual(a.request('GET', record['source']['url'])[0], 404)
        self.assertFalse(directory.exists())
        self.assertEqual(self.service.quota['totalAttempts'], 1)
        b = Browser(self)
        b.session()
        directory = self.service.directory(self.service.cookie_key(b.cookie))
        state = json.loads((directory / 'session.json').read_text())
        state['expiresAt'] = serve.iso(serve.now() - serve.timedelta(seconds=1))
        serve.atomic_json(directory / 'session.json', state)
        self.service.stop_cleanup.clear()
        self.service.start_background_cleanup()
        time.sleep(.2)
        self.assertFalse(directory.exists())

    def test_default_local_mode_keeps_one_case(self):
        self.stop()
        self.args = serve.arguments(['--port', '0', '--state', str(Path(self.storage.name) / 'local')])
        self.start()
        a, b = Browser(self), Browser(self)
        host = f'127.0.0.1:{self.port}'
        first = a.request('GET', '/api/session', host=host)
        second = b.request('GET', '/api/session', host=host)
        self.assertEqual(first[0], 200)
        self.assertEqual(first[1]['scope'], 'local_single_case')
        self.assertEqual(first[1]['id'], second[1]['id'])
        self.assertNotIn('Set-Cookie', first[2])
        self.assertNotIn('captureAllowance', first[1])
        self.assertEqual(a.request('POST', '/api/reset', {}, host=host, origin='http://' + host)[0], 200)


if __name__ == '__main__':
    unittest.main()
