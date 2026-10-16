#!/usr/bin/env python3
"""Free ClipForge local companion. Runs on your PC, not GitHub Pages."""
from __future__ import annotations
import argparse
import atexit
import json
import re
import shutil
import tempfile
import threading
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit, parse_qs

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_BYTES = 1_500_000_000

def youtube_id(value: str) -> str | None:
    """Reduce an approved YouTube URL to an ID; no arbitrary URL fetching."""
    try:
        u = urlsplit(value.strip())
        if u.scheme != "https" or u.username or u.password or u.port:
            return None
        host = (u.hostname or "").lower().removeprefix("www.")
        if host == "youtu.be":
            identifier = u.path.strip("/").split("/")[0]
        elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
            if u.path == "/watch":
                identifier = parse_qs(u.query).get("v", [""])[0]
            else:
                match = re.fullmatch(r"/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})/?", u.path)
                identifier = match.group(1) if match else ""
        else:
            return None
        return identifier if VIDEO_ID.fullmatch(identifier) else None
    except (ValueError, TypeError):
        return None

class Store:
    def __init__(self, root: Path):
        self.root = root
        self.jobs: dict[str, dict] = {}
        self.lock = threading.Lock()
        self.gate = threading.BoundedSemaphore(1)

    def read(self, job_id: str) -> dict | None:
        with self.lock:
            job = self.jobs.get(job_id)
            return {k: v for k, v in job.items() if k != "file"} if job else None

    def update(self, job_id: str, **data):
        with self.lock:
            self.jobs[job_id].update(data)

    def start(self, identifier: str) -> str | None:
        if not self.gate.acquire(blocking=False):
            return None
        job_id = uuid.uuid4().hex
        with self.lock:
            self.jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "title": "", "error": ""}
        threading.Thread(target=self._run, args=(job_id, identifier), daemon=True).start()
        return job_id

    def _run(self, job_id: str, identifier: str):
        try:
            try:
                import yt_dlp
            except ImportError as exc:
                raise RuntimeError("yt-dlp missing. Run: python -m pip install -U yt-dlp") from exc
            folder = self.root / job_id
            folder.mkdir(parents=True, exist_ok=True)
            ffmpeg = shutil.which("ffmpeg") is not None
            fmt = ("bv*[vcodec^=avc1][height<=1080]+ba[ext=m4a]/"
                   "best[ext=mp4][acodec!=none][vcodec!=none]"
                   if ffmpeg else "best[ext=mp4][acodec!=none][vcodec!=none]")

            def on_progress(p):
                if p.get("status") == "downloading":
                    total = p.get("total_bytes") or p.get("total_bytes_estimate") or 0
                    value = min(.96, .96 * p.get("downloaded_bytes", 0) / total) if total else 0
                    self.update(job_id, status="downloading", progress=round(value, 3))
                elif p.get("status") == "finished":
                    self.update(job_id, status="processing", progress=.96)

            self.update(job_id, status="connecting", progress=.01)
            options = {
                "format": fmt, "outtmpl": str(folder / "source.%(ext)s"),
                "merge_output_format": "mp4", "noplaylist": True, "quiet": True,
                "no_warnings": True, "max_filesize": MAX_BYTES,
                "progress_hooks": [on_progress], "retries": 3,
                "fragment_retries": 3, "socket_timeout": 25,
            }
            with yt_dlp.YoutubeDL(options) as ydl:
                info = ydl.extract_info(f"https://www.youtube.com/watch?v={identifier}", download=True)
            mp4s = list(folder.glob("*.mp4"))
            if not mp4s:
                raise RuntimeError("No compatible MP4 was produced. Install FFmpeg and retry.")
            result = max(mp4s, key=lambda p: p.stat().st_size)
            if result.stat().st_size > MAX_BYTES:
                raise RuntimeError("Video exceeds the 1.5 GB import limit.")
            self.update(job_id, status="ready", progress=1, title=(info or {}).get("title", ""),
                        size=result.stat().st_size, file=result)
        except Exception as exc:
            self.update(job_id, status="error", progress=0, error=str(exc)[:400])
        finally:
            self.gate.release()

def make_handler(store: Store, origins: set[str]):
    class Handler(BaseHTTPRequestHandler):
        def allowed(self):
            return (self.headers.get("Host") in {"localhost:8765", "127.0.0.1:8765"}
                    and self.headers.get("Origin") in origins)

        def end_headers(self):
            origin = self.headers.get("Origin", "")
            if origin in origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def send_json(self, code, data):
            body = json.dumps(data).encode()
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Unauthorized origin."})
            self.send_response(204)
            self.end_headers()

        def do_POST(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Unauthorized origin."})
            if self.path != "/api/import":
                return self.send_json(404, {"error": "Not found."})
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= 4096:
                    raise ValueError("Invalid request size.")
                data = json.loads(self.rfile.read(length))
                identifier = youtube_id(data.get("url", ""))
                if not identifier:
                    raise ValueError("Enter a valid HTTPS YouTube video URL.")
            except (ValueError, TypeError) as exc:
                return self.send_json(400, {"error": str(exc)})
            job_id = store.start(identifier)
            if job_id is None:
                return self.send_json(429, {"error": "A video is already importing."})
            self.send_json(202, {"id": job_id})

        def do_GET(self):
            if not self.allowed():
                return self.send_json(403, {"error": "Unauthorized origin."})
            if self.path == "/health":
                return self.send_json(200, {"ok": True, "service": "clipforge-companion", "version": 1})
            match = re.fullmatch(r"/api/jobs/([0-9a-f]{32})(/video)?", self.path)
            if not match:
                return self.send_json(404, {"error": "Not found."})
            job_id, video = match.groups()
            job = store.read(job_id)
            if job is None:
                return self.send_json(404, {"error": "Unknown job."})
            if not video:
                return self.send_json(200, job)
            if job["status"] != "ready":
                return self.send_json(409, {"error": "Video is not ready."})
            with store.lock:
                file = store.jobs[job_id]["file"]
            try:
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(file.stat().st_size))
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with file.open("rb") as handle:
                    shutil.copyfileobj(handle, self.wfile, length=1024 * 1024)
            except (BrokenPipeError, ConnectionResetError, ConnectionAbortedError):
                pass

        def log_message(self, fmt, *args):
            pass

    return Handler

def main():
    p = argparse.ArgumentParser(description="ClipForge free local YouTube importer")
    p.add_argument("--origin", action="append", default=[], help="Extra trusted origin for forks")
    args = p.parse_args()
    origins = {"https://polmatchu.github.io", "http://localhost:5173", "http://127.0.0.1:5173", *args.origin}
    root = Path(tempfile.mkdtemp(prefix="clipforge-import-"))
    atexit.register(lambda: shutil.rmtree(root, ignore_errors=True))
    server = ThreadingHTTPServer(("127.0.0.1", 8765), make_handler(Store(root), origins))
    print("ClipForge ready at http://127.0.0.1:8765", flush=True)
    print("Leave this window open while importing. Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()

if __name__ == "__main__":
    main()
