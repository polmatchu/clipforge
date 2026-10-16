#!/usr/bin/env sh
set -eu
cd "$(dirname "$0")"
python3 -m pip install --user --upgrade yt-dlp
python3 tools/clipforge_companion.py
