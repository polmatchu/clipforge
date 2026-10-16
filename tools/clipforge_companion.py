#!/usr/bin/env python3
"""ClipForge local YouTube import companion.

Run on your own computer, not on GitHub Pages. It downloads only user-supplied
YouTube video links and serves the resulting MP4 to the trusted ClipForge UI.
Requires: python -m pip install -U yt-dlp. Optional: FFmpeg for higher quality.
"""

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
from urllib.parse import urlsplit

VIDEO_ID = re.compile(r"^[A-Za-z0-9_-]{11}$")
MAX_BYTES = 1_500_000_000  # Limit disk/bandwidth and browser memory usage.
MAX_REQUEST = 4096


def youtube_id(value: str) -> str | None:
    """Avoid SSRF: accept known YouTube link types and reduce them to an ID."""
    try:
        url = urlsplit(value.strip())
        if url.scheme != "https" or url.username or url.password or url.port:
            return None
        host = (url.hostname or "").lower().removeprefix("www.")
        if host == "youtu.be":
            identifier = url.path.strip("/").split("/")[0]
        elif host in {"youtube.com", "m.youtube.com", "music.youtube.com"}:
            if url.path == "/watch":
                from urllib.parse import parse_qs
                identifier = parse_qs(url.query).get("v", [""])[0]
            else:
                m = re.fullmatch(r"/(?:shorts|live|embed)/([A-Za-z0-9_-]{11})/?", url.path)
                identifier = m.group(1) if m else ""
        else:
            return None
        return identifier if VIDEO_ID.fullmatch(identifier) else None
    except (ValueError, TypeError):
        return None


def find_ffmpeg(root: Path) -> str | None:
    """Use FFmpeg on PATH or the free executable bundled with imageio-ffmpeg."""
    executable = shutil.which("ffmpeg")
    if executable:
        return str(Path(executable).parent)
    try:
        import imageio_ffmpeg
        bundled = Path(imageio_ffmpeg.get_ffmpeg_exe())
        target_dir = root / "ffmpeg-bin"
        target = target_dir / ("ffmpeg.exe" if __import__("os").name == "nt" else "ffmpeg")
        if not target.is_file():
            target_dir.mkdir(parents=True, exist_ok=True)
            shutil.copy2(bundled, target)
            if __import__("os").name != "nt":
                target.chmod(0o755)
        return str(target_dir)
    except (ImportError, OSError, RuntimeError):
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
            if job is None:
                return None
            return {key: value for key, value in job.items() if key != "file"}

    def update(self, job_id: str, **data):
        with self.lock:
            self.jobs[job_id].update(data)

    def start(self, identifier: str) -> str | None:
        if not self.gate.acquire(blocking=False):
            return None
        job_id = uuid.uuid4().hex
        with self.lock:
            self.jobs[job_id] = {"id": job_id, "status": "queued", "progress": 0, "title": "", "error": ""}
        thread = threading.Thread(target=self._run, args=(job_id, identifier), daemon=True)
        thread.start()
        return job_id

    def _run(self, job_id: str, identifier: str):
        try:
            try:
                import yt_dlp
            except ImportError as exc:
                raise RuntimeError("yt-dlp is missing. Run: python -m pip install -U yt-dlp") from exc
            # yt-dlp's YouTube extractor requires a supported JS runtime.
            # Deno is enabled automatically. Without it, require Node 22+.
            runtime = shutil.which("deno")
            if not runtime:
                node = shutil.which("node")
                if node:
                    import subprocess
                    try:
                        version = subprocess.check_output([node, "--version"], text=True, timeout=5).strip()
                        major = int(version.lstrip("v").split(".")[0])
                        if major >= 22:
                            runtime = "node"
                    except (ValueError, OSError, subprocess.SubprocessError):
                        pass
            if not runtime:
                raise RuntimeError(
                    "YouTube import needs Deno 2.3+ (recommended) or Node 22+. "
                    "Install Deno from https://deno.com and restart start_companion.bat."
                )
            from importlib.metadata import PackageNotFoundError, version
            try:
                version("yt-dlp-ejs")
            except PackageNotFoundError as exc:
                raise RuntimeError(
                    'The yt-dlp EJS solver is missing. Run: python -m pip install -U "yt-dlp[default]"'
                ) from exc
            directory = self.root / job_id
            directory.mkdir(parents=True, exist_ok=True)
            ffmpeg_location = find_ffmpeg(self.root)
            ffmpeg = ffmpeg_location is not None
            # Prefer the best actual video stream (any codec/resolution),
            # adding audio if necessary. The MP4 conversion happens afterwards.
            # Without FFmpeg, use a single combined audio+video stream.
            fmt = "bv*+ba/b" if ffmpeg else "b"

            def progress_hook(info):
                if info.get("status") == "downloading":
                    total = info.get("total_bytes") or info.get("total_bytes_estimate") or 0
                    downloaded = info.get("downloaded_bytes", 0)
                    pct = min(0.96, 0.96 * downloaded / total) if total else 0
                    self.update(job_id, status="downloading", progress=round(pct, 3))
                elif info.get("status") == "finished":
                    self.update(job_id, status="processing", progress=0.96)

            self.update(job_id, status="connecting", progress=0.01)
            options = {
                "format": fmt,
                **({"js_runtimes": {"node": {}}} if runtime == "node" else {}),
                "outtmpl": str(directory / "source.%(ext)s"),
                "merge_output_format": "mp4",
                **({"ffmpeg_location": ffmpeg_location} if ffmpeg else {}),
                **({"recodevideo": "mp4"} if ffmpeg else {}),
                "noplaylist": True,
                "quiet": True,
                "no_warnings": False,
                "max_filesize": MAX_BYTES,
                "progress_hooks": [progress_hook],
                "retries": 3,
                "fragment_retries": 3,
                "socket_timeout": 25,
                "windowsfilenames": True,
            }
            video_url = f"https://www.youtube.com/watch?v={identifier}"
            try:
                with yt_dlp.YoutubeDL(options) as ydl:
                    info = ydl.extract_info(video_url, download=True)
            except yt_dlp.utils.DownloadError as exc:
                if "Requested format is not available" not in str(exc):
                    raise
                # Diagnose without choosing/downloading a format. A missing
                # stream is different from our own format expression failing.
                probe = dict(options)
                probe.update({
                    "format": None,
                    "skip_download": True,
                    "ignore_no_formats_error": True,
                    "progress_hooks": [],
                })
                try:
                    with yt_dlp.YoutubeDL(probe) as ydl:
                        metadata = ydl.extract_info(video_url, download=False)
                    formats = (metadata or {}).get("formats") or []
                    playable = [
                        item for item in formats
                        if item.get("vcodec") not in (None, "none")
                        and item.get("protocol") != "mhtml"
                    ]
                except Exception:
                    playable = []
                if playable:
                    samples = ", ".join(
                        str(item.get("format_id") or "?") for item in playable[-6:]
                    )
                    raise RuntimeError(
                        f"YouTube provided {len(playable)} video format(s), but download "
                        f"selection failed (format IDs: {samples}). Please send the "
                        "output of: py -3 -m yt_dlp -v -F <YouTube URL>"
                    ) from exc
                raise RuntimeError(
                    "YouTube returned no usable video streams to yt-dlp for this URL. "
                    "This can be a YouTube access/challenge restriction rather than an MP4 "
                    "setting. Please run: py -3 -m yt_dlp -v -F <YouTube URL>"
                ) from exc
            mp4s = list(directory.glob("*.mp4"))
            if not mp4s:
                raise RuntimeError("No MP4 was produced. Install FFmpeg (and ensure it's on PATH), then retry.")
            result = max(mp4s, key=lambda p: p.stat().st_size)
            if result.stat().st_size > MAX_BYTES:
                raise RuntimeError("This video is larger than the 1.5 GB local import limit.")
            title = (info or {}).get("title") or f"YouTube {identifier}"
            self.update(job_id, status="ready", progress=1, title=title, size=result.stat().st_size, file=result)
        except Exception as exc:
            # Errors are shown to the user, not silent failures.
            self.update(job_id, status="error", error=str(exc)[:400], progress=0)
        finally:
            self.gate.release()


def build_handler(store: Store, allowed_origins: set[str]):
    class Handler(BaseHTTPRequestHandler):
        def end_headers(self):
            origin = self.headers.get("Origin", "")
            if origin in allowed_origins:
                self.send_header("Access-Control-Allow-Origin", origin)
                self.send_header("Vary", "Origin")
                self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
                self.send_header("Access-Control-Allow-Headers", "Content-Type")
                self.send_header("Access-Control-Allow-Private-Network", "true")
            self.send_header("X-Content-Type-Options", "nosniff")
            super().end_headers()

        def authorized(self):
            host = self.headers.get("Host", "")
            origin = self.headers.get("Origin", "")
            return host in {"127.0.0.1:8765", "localhost:8765"} and origin in allowed_origins

        def respond(self, code: int, payload: dict):
            body = json.dumps(payload).encode("utf-8")
            self.send_response(code)
            self.send_header("Content-Type", "application/json; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def do_OPTIONS(self):
            if not self.authorized():
                self.respond(403, {"error": "This website is not allowed to use the ClipForge companion."})
                return
            self.send_response(204)
            self.end_headers()

        def do_POST(self):
            if not self.authorized():
                self.respond(403, {"error": "Unauthorized site origin."})
                return
            if self.path != "/api/import":
                self.respond(404, {"error": "Not found."})
                return
            try:
                length = int(self.headers.get("Content-Length", "0"))
                if not 0 < length <= MAX_REQUEST:
                    raise ValueError("Invalid request size.")
                body = json.loads(self.rfile.read(length))
                identifier = youtube_id(body.get("url", ""))
                if not identifier:
                    raise ValueError("Paste a valid HTTPS YouTube watch, Shorts, or youtu.be link.")
            except (ValueError, KeyError, TypeError, json.JSONDecodeError) as exc:
                self.respond(400, {"error": str(exc)})
                return
            job_id = store.start(identifier)
            if job_id is None:
                self.respond(429, {"error": "A video is already importing. Wait until it finishes."})
            else:
                self.respond(202, {"id": job_id})

        def do_GET(self):
            if not self.authorized():
                self.respond(403, {"error": "Unauthorized site origin."})
                return
            if self.path == "/health":
                self.respond(200, {"ok": True, "service": "clipforge-companion", "version": 1})
                return
            m = re.fullmatch(r"/api/jobs/([0-9a-f]{32})(/video)?", self.path)
            if not m:
                self.respond(404, {"error": "Not found."})
                return
            job_id, suffix = m.groups()
            job = store.read(job_id)
            if job is None:
                self.respond(404, {"error": "Unknown import job."})
                return
            if not suffix:
                self.respond(200, job)
                return
            if job["status"] != "ready":
                self.respond(409, {"error": "Video is not ready."})
                return
            with store.lock:
                path = store.jobs[job_id]["file"]
            try:
                self.send_response(200)
                self.send_header("Content-Type", "video/mp4")
                self.send_header("Content-Length", str(path.stat().st_size))
                self.send_header("Content-Disposition", f'attachment; filename="youtube-{job_id[:8]}.mp4"')
                self.send_header("Cache-Control", "no-store")
                self.end_headers()
                with path.open("rb") as f:
                    shutil.copyfileobj(f, self.wfile, length=1024 * 1024)
            except (ConnectionAbortedError, BrokenPipeError, ConnectionResetError):
                pass

        def log_message(self, format, *args):
            # Avoid logging YouTube URLs, unnecessary for this local service.
            pass

    return Handler


def main():
    parser = argparse.ArgumentParser(description="ClipForge local YouTube importer")
    parser.add_argument("--origin", action="append", default=[], help="Extra exact trusted web origin for forks, e.g. https://yourname.github.io")
    args = parser.parse_args()
    allow = {"https://polmatchu.github.io", "http://localhost:5173", "http://127.0.0.1:5173", *args.origin}
    workspace = Path(tempfile.mkdtemp(prefix="clipforge-import-"))
    atexit.register(lambda: shutil.rmtree(workspace, ignore_errors=True))
    server = ThreadingHTTPServer(("127.0.0.1", 8765), build_handler(Store(workspace), allow))
    print("ClipForge importer ready on http://127.0.0.1:8765", flush=True)
    print("Approved websites:", ", ".join(sorted(allow)), flush=True)
    print("Keep this window open while importing. Press Ctrl+C to stop.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
