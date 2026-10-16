#!/usr/bin/env python3
"""ClipForge native-render alternative for long clips / low-memory browsers.

Usage:
  python tools/render_bundle.py SOURCE_VIDEO clipforge-export.zip --out rendered
  python tools/render_bundle.py SOURCE_VIDEO ./clipforge-export/ --resolution 720

Requires only Python 3.10+ and an installed FFmpeg (with optional libass for captions).
Works entirely locally. Never downloads copyrighted source media or uploads anything.
"""

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path


def main():
    p = argparse.ArgumentParser(description="Render a ClipForge export manifest with native FFmpeg")
    p.add_argument("source", type=Path, help="Path to the authorized original video")
    p.add_argument("bundle", type=Path, help="ClipForge ZIP, extracted folder, or JSON manifest")
    p.add_argument("--out", type=Path, default=Path("clipforge-native-output"))
    p.add_argument("--resolution", type=int, choices=[540, 720, 1080], default=720)
    p.add_argument("--framing", choices=["crop", "pad"], default="crop")
    p.add_argument("--burn-captions", action="store_true", help="Burn companion SRT subtitles into the video (requires FFmpeg libass)")
    args = p.parse_args()

    if not shutil.which("ffmpeg"):
        p.error("FFmpeg is not on PATH. Install FFmpeg first: https://ffmpeg.org/download.html")
    if not args.source.is_file():
        p.error(f"No video source found: {args.source}")
    if not args.bundle.exists():
        p.error(f"No export bundle found: {args.bundle}")

    args.out.mkdir(parents=True, exist_ok=True)
    video = str(args.source.resolve())
    width, height = args.resolution, args.resolution * 16 // 9
    scale = (
        f"scale={width}:{height}:force_original_aspect_ratio=increase,crop={width}:{height}"
        if args.framing == "crop"
        else f"scale={width}:{height}:force_original_aspect_ratio=decrease,"
             f"pad={width}:{height}:(ow-iw)/2:(oh-ih)/2:black"
    )
    with tempfile.TemporaryDirectory(prefix="clipforge_") as tmp:
        temp = Path(tmp)
        if args.bundle.suffix.lower() == ".zip":
            with zipfile.ZipFile(args.bundle) as z:
                # Read only metadata and SRT sidecars. Do not extract arbitrary ZIP paths.
                manifest = json.loads(z.read("upload-manifest.json"))
                subs = {name: z.read(name) for name in z.namelist() if name.endswith(".srt") and "/" not in name}
        elif args.bundle.is_dir():
            manifest = json.loads((args.bundle / "upload-manifest.json").read_text("utf-8"))
            subs = {f.name: f.read_bytes() for f in args.bundle.glob("*.srt")}
        else:
            manifest = json.loads(args.bundle.read_text("utf-8"))
            subs = {f.name: f.read_bytes() for f in args.bundle.parent.glob("*.srt")}

        if not isinstance(manifest, list) or not manifest:
            p.error("Manifest contains no clips")
        for i, item in enumerate(manifest, 1):
            name = Path(str(item.get("filename", ""))).name
            if not name.endswith(".mp4"):
                p.error(f"Invalid filename for item {i}")
            start = float(item["start"])
            end = float(item["end"])
            if start < 0 or end <= start:
                p.error(f"Invalid timestamps for {name}")
            vf = f"{scale},setsar=1,fps=30,format=yuv420p"
            subtitle = subs.get(name[:-4] + ".srt")
            if args.burn_captions and subtitle:
                (temp / "current.srt").write_bytes(subtitle)
                # Relative SRT path avoids platform-specific drive-letter escaping.
                vf += ",subtitles=current.srt:force_style='FontName=Arial,FontSize=20,"
                vf += "BorderStyle=3,Outline=2,Shadow=0,Alignment=2,MarginV=190'"
            output = args.out / name
            cmd = ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-ss", f"{start:.3f}",
                   "-i", video, "-t", f"{end-start:.3f}", "-vf", vf,
                   "-c:v", "libx264", "-preset", "fast", "-crf", "23",
                   "-c:a", "aac", "-b:a", "128k", "-ar", "48000", "-movflags", "+faststart", str(output.resolve())]
            print(f"[{i}/{len(manifest)}] Rendering {output.name}", flush=True)
            result = subprocess.run(cmd, cwd=temp, check=False)
            if result.returncode:
                print(f"FAILED: {output.name} (FFmpeg exit {result.returncode})", file=sys.stderr)
                return 1
            (args.out / (name[:-4] + ".txt")).write_text(
                str(item.get("title", "")) + "\n\n" + str(item.get("caption", "")) + "\n", encoding="utf-8"
            )
            if subtitle:
                (args.out / (name[:-4] + ".srt")).write_bytes(subtitle)
    print(f"Finished. Output folder: {args.out.resolve()}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
