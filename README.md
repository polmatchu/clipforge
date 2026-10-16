# ✦ ClipForge — free, local-first short-form video studio

A new, independent, MIT-licensed app inspired by short-form clipping workflows. **Not a copy of Ssemble's code, branding, or proprietary assets.** Build and host the UI with GitHub Pages; run media processing and optional AI locally in your browser.

> **MVP / experimental software:** This is a source-code prototype. The source was syntax checked, but full npm-build / browser end-to-end verification was not possible in the artifact environment. Check the first export on your actual operating system and browser before relying on it.

## Features

| Tool | Status | Notes |
| --- | --- | --- |
| YouTube links | **Preview/reference** | Paste regular, Shorts or youtu.be links. Bring the original video file separately (see legal note). |
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

GitHub Pages offers static web hosting, **not background jobs, hidden secrets, persistent compute, server-side OAuth token exchange or video storage**. GitHub publishes usage limits: <https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits>.

## Recommended workflow

1. **Own the source or have explicit permission.** Paste a YouTube URL to reference and preview it. In YouTube Studio, download your **own** original if you no longer have the source file; otherwise supply your licensed original file. **You cannot simply paste an arbitrary YouTube link and rip its media inside this browser app.**
2. Upload the source video into ClipForge (it stays on your machine).
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

Except for the referenced public CDN/model/font requests, source video bytes and transcripts are processed on the device. The app currently stores **planner entries and preferences** in browser localStorage, so deleting browser data removes them. Video data is not persisted across reloads.

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
