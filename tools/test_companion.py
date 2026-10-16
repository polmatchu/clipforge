"""Network-free tests for the local import companion."""
import http.client
import json
import tempfile
import threading
import time
import types
import unittest
from pathlib import Path
from unittest.mock import patch

from clipforge_companion import Store, ThreadingHTTPServer, build_handler, youtube_id


class ImportTests(unittest.TestCase):
    def test_accepted_urls(self):
        for url in (
            'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtu.be/dQw4w9WgXcQ?t=4',
            'https://www.youtube.com/shorts/dQw4w9WgXcQ',
        ):
            self.assertEqual(youtube_id(url), 'dQw4w9WgXcQ')

    def test_unsafe_urls_are_rejected(self):
        for url in (
            'http://youtube.com/watch?v=dQw4w9WgXcQ',
            'https://youtube.com.evil.test/watch?v=dQw4w9WgXcQ',
            'https://youtube.com@evil.test/watch?v=dQw4w9WgXcQ',
            'https://localhost/watch?v=dQw4w9WgXcQ',
            'https://youtube.com:444/watch?v=dQw4w9WgXcQ',
            'file:///etc/passwd',
        ):
            self.assertIsNone(youtube_id(url))

    def test_mock_download_produces_a_browser_file(self):
        class FakeYDL:
            def __init__(self, options):
                self.options = options
            def __enter__(self): return self
            def __exit__(self, *args): return False
            def extract_info(self, url, download):
                self.assert_source(url, download)
                Path(self.options['outtmpl'].replace('%(ext)s', 'mp4')).write_bytes(b'fake mp4 bytes')
                for hook in self.options['progress_hooks']:
                    hook({'status':'finished'})
                return {'title':'Video title'}
            def assert_source(self, url, download):
                assert url == 'https://www.youtube.com/watch?v=dQw4w9WgXcQ'
                assert download
        with tempfile.TemporaryDirectory() as td:
            store = Store(Path(td))
            with patch.dict('sys.modules', {'yt_dlp':types.SimpleNamespace(YoutubeDL=FakeYDL)}):
                job_id = store.start('dQw4w9WgXcQ')
                self.assertIsNotNone(job_id)
                for _ in range(100):
                    if store.read(job_id)['status'] in ('ready', 'error'): break
                    time.sleep(0.01)
                self.assertEqual(store.read(job_id)['status'], 'ready')
                self.assertEqual(store.read(job_id)['size'], len(b'fake mp4 bytes'))

    def test_cors_rejects_untrusted_websites(self):
        with tempfile.TemporaryDirectory() as td:
            server = ThreadingHTTPServer(('127.0.0.1', 0), build_handler(Store(Path(td)), {'https://polmatchu.github.io'}))
            thread = threading.Thread(target=server.serve_forever, daemon=True)
            thread.start()
            try:
                for origin, code in [('https://evil.example', 403), ('https://polmatchu.github.io', 200)]:
                    conn = http.client.HTTPConnection('127.0.0.1', server.server_port, timeout=2)
                    conn.request('GET', '/health', headers={'Host':'127.0.0.1:8765', 'Origin':origin})
                    resp = conn.getresponse()
                    self.assertEqual(resp.status, code)
                    if code == 200:
                        self.assertEqual(json.loads(resp.read())['service'], 'clipforge-companion')
                    else:
                        resp.read()
                    conn.close()
            finally:
                server.shutdown()
                server.server_close()


if __name__ == '__main__':
    unittest.main()
