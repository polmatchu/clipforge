# ✦ ClipForge — free, local-first short-form video studio

A new, independent, MIT-licensed app inspired by short-form clipping workflows. **Not a copy of Ssemble's code, branding, or proprietary assets.** Build and host the UI with GitHub Pages; run media processing and optional AI locally in your browser.

> **MVP / experimental software:** This is a source-code prototype. The source was syntax checked, but full npm-build / browser end-to-end verification was not possible in the artifact environment. Check the first export on your actual operating system and browser before relying on it.

## Features

| Tool | Status | Notes |
| --- | --- | --- |
| YouTube links | **Automatic local import (new)** | Paste a URL and click Import. Requires running the free local Python companion; it retrieves and prepares an MP4 automatically. No manual source-video download or upload. |
| Local video upload | **Implemented** | Uses browser `File` APIs, not a remote server. |
| Automatic smart clip candidates | **Implemented, heuristic** | Samples visual scene activity; if a transcript is available, also scores speech density, hooks and emphatic language. Not an AI model that understands all visuals. |
| Sequential parts | **Implemented** | Cut from start to finish into adjacent segments (up to 80 in the UI). |
| English speech transcription | **Experimental** | On-device Whisper tiny via Transformers.js; the first use downloads model weights. UI limits this to 15-minute sources. |
| Captions toggle | **Implemented / experimental** | Burns timed captions with FFmpeg `drawtext` when transcript cues exist; also downloads `.srt`. Timing within Whisper chunks is estimated, not word-for-word aligned. |
| Vertical video exports | **Experimental** | Single-thread FFmpeg.wasm: 9:16 center crop or letterboxing, 540×960 or 720×1280, H.264 MP4/AAC. Long/big clips may exhaust browser RAM. |
| Batch export | **Implemented** | ZIP of MP4s, SRTs, text posts, and JSON manifest. Download the manifest separately for native rendering. |
| Captions / titles | **Implemented** | Editable rule-generated copy; optional experimental on-device Qwen rewrite, no API keys. |
| Clip quality review | **Implemented, heuristic** | Review low-score clips, override batch exclusion, edit exact start/end points. Scores **are not** virality probabilities. |
| Local content planner | **Implemented** | Stores upload reminders in localStorage; downloads `.ics` events and copies text. |
| Direct YouTube upload & schedule | **Experimental** | Official Google browser OAuth + YouTube resumable upload. Bring your own Google Cloud OAuth Web Client ID. Uses YouTube `publishAt` scheduling; no tokens saved. |
| Direct TikTok / Instagram posting | **Not implemented** | Requires provider approvals, OAuth and (for some flows) a secure backend. Official upload buttons are provided. |
| Auto-post while site closed | **Not implemented** | Requires a remote scheduler and credential/storage strategy, or locally running software. |
| Licensed sound effects / music | **None added** | Only original audio, which **still may be copyrighted**. |

## YouTube link import without manual downloads

**Your website stays on free GitHub Pages**, but GitHub Pages cannot run a downloader. A **one-time free local companion** running on your PC makes the paste-a-link feature work end to end. The video is automatically fetched and delivered into the editor; you do **not** need to download the video yourself or select an MP4 manually.

### Windows (easiest)

1. Install **Python 3.10+** from [python.org](https://www.python.org/downloads/) if it is not already installed; select **Add Python to PATH** during setup.
2. Download the [ClipForge repository ZIP](https://github.com/polmatchu/clipforge/archive/refs/heads/main.zip) **once**, and extract it on your PC. This is the app's helper code, **not a YouTube video**.
3. Double-click **`start_companion.bat`** in the extracted folder. The first launch automatically installs/updates the free `yt-dlp` tool. Leave this terminal window open.
4. Open **<https://polmatchu.github.io/clipforge/>**, paste a YouTube video link and click the **arrow**. ClipForge fetches the video automatically and shows it in the editor.

For higher-quality video+audio merging, optionally install [FFmpeg](https://ffmpeg.org/download.html) on your PATH. Without FFmpeg, the helper chooses a compatible combined MP4 stream where available, which may have lower resolution.

### macOS / Linux

Run in a terminal from the extracted repo folder:

```sh
python3 -m pip install -U yt-dlp
python3 tools/clipforge_companion.py
```

On systems that restrict global Python packages, use a virtual environment first (or a package manager such as `pipx`). The optional `start_companion.sh` provides the equivalent two commands if user-level pip installs are permitted.

**How it works:** The companion listens **only** on `127.0.0.1:8765`, accepts requests only from `https://polmatchu.github.io` and the local Vite development server, validates YouTube URLs and does not expose your filesystem. It creates a temporary local MP4 that the app automatically loads into your browser; downloaded temporary videos are removed when the companion exits. For a fork hosted on a different GitHub Pages account, launch with `--origin https://YOUR-USERNAME.github.io`. Keep the helper window open when importing.

**Limitations:** GitHub Pages by itself still cannot do URL-to-video processing. Both the website and companion must be available while importing. This method does not bypass YouTube availability, copyright protections, DRM, account login restrictions, age restrictions, or rate limits. Some videos may require permission or may not offer browser-compatible formats. Import only videos you own or have permission to download and repurpose, and comply with platform terms. The client sends the selected YouTube link only to your own local companion and that helper contacts YouTube directly. Your video is not uploaded to a third-party ClipForge server. Modern browsers may ask for permission to connect to a local service; approve it for the ClipForge website if prompted.

If the page shows **Import needs attention**, start the companion, ensure Windows Firewall or antivirus is not blocking Python's local loopback connection, and retry. The helper requires an internet connection to access YouTube. If you use another computer, start the companion **on the same computer as your browser**.

## Run locally

Requires Node.js 20+ (22 recommended) and a modern Chromium browser. Chrome or Edge with WebGPU works best for AI.

```bash
npm install
npm run dev
```

Open the address printed in your terminal (typically `http://localhost:5173/`). For a production bundle:

```bash
npm run build
npm run preview
```

## Publish free using GitHub Pages

1. Create a **new GitHub repository** (e.g. `clipforge`) and push **everything in this project**, including `.github/workflows/deploy.yml`. Don't upload your actual source videos to Git.
2. In the repo, open **Settings → Pages**; for **Build and deployment → Source**, select **GitHub Actions**.
3. Push to the `main` branch. The workflow installs dependencies, builds Vite with relative assets, and publishes `dist/`.
4. Your site will appear at `https://YOUR-USERNAME.github.io/YOUR-REPOSITORY/`. No custom domain is necessary.
5. If the deployment fails, check the **Actions** tab for the specific error. Rebuilds require access to the npm registry. Runtime model downloads also require internet access on the first use.

GitHub Pages offers static web hosting, **not background jobs, hidden secrets, persistent compute, server-side OAuth token exchange or video storage**. Pasted YouTube URLs use the optional companion described above, running on your computer. GitHub publishes usage limits: <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>.

## Recommended workflow

1. **Own the source or have explicit permission.** Start the free local companion and paste the YouTube link: the helper fetches the source automatically. Or import a local video file as before.
2. Wait for the video to appear in the ClipForge editor. It stays on your device (the helper makes a temporary source file that is cleaned up when stopped).
3. For talking-head footage: run **Transcribe with Whisper**, or import an SRT/VTT with timestamps. The exact speech recognition and timings can be wrong; review carefully.
4. Set `Smart highlights` or `Split into parts`, adjust clip length and desired quantity, and run generation.
5. In **My clips**, inspect each candidate, play and edit start/end timestamps, refine titles and descriptions, and optionally use on-device Qwen to rewrite copy.
6. Export a single MP4 or the ZIP batch (MP4/SRT/caption/JSON). Preview exports locally before uploading.
7. Add a post to the **Content planner**, download the calendar reminder, then use the official TikTok/Instagram upload pages. **Alternatively, configure Google OAuth in Channels to upload directly to YouTube (experimental), including YouTube-native scheduled publishing.** The local planner does not publish automatically.

### Native FFmpeg fallback for large source files

Browser FFmpeg runs in a WebAssembly sandbox and is memory-constrained. The included `tools/render_bundle.py` can re-render already-selected clip ranges from the original source on your own computer using native FFmpeg:

```bash
# Install FFmpeg separately; make sure `ffmpeg -version` works.
# Click **Manifest** in My clips to download `upload-manifest.json`, without rendering the videos.
python tools/render_bundle.py "/path/to/your-original-video.mp4" upload-manifest.json --out finished --resolution 720 --burn-captions
```

This uses Python 3.10+ standard library (no paid service), native `ffmpeg`, and the `upload-manifest.json`. For burned-in captions, extract each matching `.srt` from an exported ZIP to the same folder as the manifest; native FFmpeg needs `libass`. To avoid burning captions, omit `--burn-captions`. It never pulls from YouTube or uploads files. For a more convenient subtitle workflow, pass the complete ZIP instead of the standalone JSON.

## Model licenses and browser networking

- FFmpeg.wasm, loaded lazily from jsDelivr CDN: <https://github.com/ffmpegwasm/ffmpeg.wasm>. Check the build's underlying GPL/LGPL codec/license obligations for redistribution, particularly H.264 / x264. Hosted WASM binary is not committed into this repo.
- Whisper speech recognition (`onnx-community/whisper-tiny.en`) from Hugging Face via `@huggingface/transformers`; the browser downloads free weights when first used. <https://huggingface.co/onnx-community/whisper-tiny.en>.
- Optional small Qwen text generation model (`onnx-community/Qwen2.5-0.5B-Instruct`) from Hugging Face. It can download hundreds of MB, and may not fit low-memory devices. <https://huggingface.co/onnx-community/Qwen2.5-0.5B-Instruct>.
- Open-licensed **Anton** font fetched at export time from Google Fonts to burn captions; source: <https://github.com/google/fonts/tree/main/ofl/anton>. Font is **not** bundled in the repository.

Except for the referenced public CDN/model/font requests and optional YouTube retrieval by the local companion, source video bytes and transcripts are processed on the device. The app currently stores **planner entries and preferences** in browser localStorage, so deleting browser data removes them. Video data is not persisted across reloads.

## Why can't I just link all my accounts?

A public static page has nowhere safe to store refresh tokens or OAuth client secrets. **Google allows a short-lived access token in a browser** (no client secret needed), which is why ClipForge supports an *optional experimental YouTube browser uploader*. For other providers and unattended posting, separate approved developer apps and secure token storage are normally required. Specifically:

- **YouTube Data API**: In Channels, enter your Google Cloud **Web application OAuth Client ID**, with `YouTube Data API v3` enabled, a consent screen configured, and your exact page origin in Authorized JavaScript origins (`https://YOUR-USERNAME.github.io`). Google Identity Services requests `youtube.upload` access and uses resumable `videos.insert`; access tokens stay **only in React memory**. Upload now or schedule via `privacyStatus=private` + `publishAt` (Google handles the eventual publication). Developer setup, quotas, account restrictions, and OAuth verification/testing requirements still apply. Documentation: <https://developers.google.com/identity/oauth2/web/guides/use-token-model> and <https://developers.google.com/youtube/data/guides/using_resumable_upload_protocol>.
- **TikTok Content Posting API**: developer registration plus `video.publish` scope; posts from unaudited apps have private-view restrictions. Documentation: <https://developers.tiktok.com/docs/en/content-posting-api-get-started>.
- **Instagram Content Publishing**: professional account and corresponding Meta authorization / publishing prerequisites. Media hosting/transfer and Graph API configuration are involved. Documentation: <https://developers.facebook.com/docs/instagram-platform/content-publishing/>.

No service can promise that all uploads avoid moderation, rights claims, or removal. Only upload footage, music, voices and visuals you have rights to use; observe platform community policies and avoid watermarks and deceptive metadata.

## Roadmap (not implemented yet)

- **Speaker-aware auto-reframing** (face detection + face tracking; crop follows the current speaker).
- **A/B thumbnails and first-3-second hooks**, with manual review before publishing.
- **Silence and dead-air pruning** as an additional highlight signal.
- **Multi-language speech recognition, subtitle translation and localization.**
- **Offline persistence of local projects** (File System Access API / IndexedDB), with consent.
- **Post-publishing analytics** from authorized official platform APIs (watch time, completion rate, shares), calibrating future recommendations against actual results rather than generic scores.
- **Real scheduled publishing** through a user-managed secure backend or a locally running desktop companion, after official OAuth, account, and platform audits.
- **Browser-side manual editing timeline** with drag handles and waveform previews.

## Privacy / security

The app does **not** request your social-media password. The Google OAuth **client ID** is public configuration; it may persist in localStorage, but OAuth **access tokens** are in memory only and never saved. Do not paste OAuth client secrets or platform access tokens into localStorage or commit them into public repos. This demo is for personal content you own or can legally repurpose. Review generated captions and titles for accuracy. No added music means zero *newly* introduced sound-effect licenses, **not** immunity from claims against the original audio or footage.

## License

MIT for the custom ClipForge source code. Dependencies, models, fonts and encoders carry their **own** licenses and terms. See linked upstream licenses before redistribution.
