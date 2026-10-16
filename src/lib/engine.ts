import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { CaptionChunk, Clip, Settings } from '../types'
import { splitForSubtitles } from './highlights'

let engine: FFmpeg | null = null
let loaded = false
let fontLoaded = false
let currentProgress: ((n: number) => void) | undefined
let sourceFileName: string | null = null
let sourceFile: File | null = null

export async function getEngine(notify?: (text: string) => void, progress?: (pct: number) => void) {
  currentProgress = progress
  if (!engine) {
    engine = new FFmpeg()
    engine.on('progress', ({ progress: n }) => currentProgress?.(Math.max(0, Math.min(1, n))))
  }
  if (!loaded) {
    notify?.('Loading FFmpeg engine (~31 MB on first use)…')
    const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
    await engine.load({
      coreURL: await toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    loaded = true
  }
  return engine
}
async function prepareFile(file: File, notify?: (text: string) => void, progress?: (n: number) => void) {
  const ff = await getEngine(notify, progress)
  if (sourceFile !== file) {
    notify?.('Copying source video into local video engine…')
    if (sourceFileName) { try { await ff.deleteFile(sourceFileName) } catch { /* ignore */ } }
    sourceFileName = `source.${(file.name.split('.').pop() || 'mp4').toLowerCase().replace(/[^a-z0-9]/g, '')}`
    await ff.writeFile(sourceFileName, await fetchFile(file))
    sourceFile = file
  }
  return { ff, name: sourceFileName! }
}

export async function extractAudio(file: File, notify?: (text: string) => void): Promise<Float32Array> {
  const { ff, name } = await prepareFile(file, notify)
  notify?.('Extracting 16 kHz mono audio for private transcription…')
  const result = await ff.exec(['-i', name, '-vn', '-ac', '1', '-ar', '16000', '-c:a', 'pcm_f32le', '-f', 'f32le', '-y', 'speech.raw'])
  if (result !== 0) throw new Error('Audio decoding failed. This video may not contain a supported audio track.')
  const bytes = await ff.readFile('speech.raw') as Uint8Array
  const buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
  await ff.deleteFile('speech.raw')
  return new Float32Array(buffer)
}

async function ensureSubtitleFont(ff: FFmpeg) {
  if (fontLoaded) return
  // Google Fonts / Anton SIL Open Font License — loaded at runtime, not bundled.
  const url = 'https://raw.githubusercontent.com/google/fonts/main/ofl/anton/Anton-Regular.ttf'
  try {
    await ff.writeFile('caption-font.ttf', await fetchFile(url))
    fontLoaded = true
  } catch { throw new Error('Could not load the free subtitle font. Check your connection, or disable subtitles and retry.') }
}

export async function renderClip(file: File, clip: Clip, settings: Settings,
  notify?: (text: string) => void, onProgress?: (n: number) => void): Promise<Blob> {
  if (clip.end <= clip.start) throw new Error('Clip end must be after the start.')
  const { ff, name } = await prepareFile(file, notify, onProgress)
  const width = settings.resolution === 'hd' ? 720 : 540
  const height = Math.round(width * 16 / 9)
  const size = `${width}:${height}`
  const base = settings.framing === 'crop'
    ? `scale=${size}:force_original_aspect_ratio=increase,crop=${size}`
    : `scale=${size}:force_original_aspect_ratio=decrease,pad=${size}:(ow-iw)/2:(oh-ih)/2:black`
  const filters = [`${base},setsar=1,fps=30,format=yuv420p,setpts=PTS-STARTPTS`]
  const subs: CaptionChunk[] = settings.subtitles ? splitForSubtitles(clip.segments, clip.start, clip.end) : []
  if (settings.subtitles && subs.length === 0) notify?.('No synchronized transcript; video exports without burned-in captions.')
  if (subs.length) {
    await ensureSubtitleFont(ff)
    for (let i = 0; i < Math.min(subs.length, 65); i++) {
      const c = subs[i]
      const fname = `subtitle-${i}.txt`
      await ff.writeFile(fname, new TextEncoder().encode(c.text.toUpperCase()))
      const start = Math.max(0, c.start).toFixed(2), end = Math.max(0.1, c.end).toFixed(2)
      // Draw text through FFmpeg's drawtext filter, using real Whisper transcript cues.
      filters.push(`drawtext=fontfile=/caption-font.ttf:textfile=${fname}:fontcolor=white:fontsize=${Math.round(width * 0.067)}:borderw=3:bordercolor=black:x=(w-text_w)/2:y=h*0.74:enable='between(t\\,${start}\\,${end})'`)
    }
  }
  notify?.('Encoding 9:16 H.264/AAC MP4 locally…')
  const code = await ff.exec([
    '-ss', clip.start.toFixed(2), '-i', name, '-t', (clip.end - clip.start).toFixed(2),
    '-vf', filters.join(','), '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '27',
    '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart', '-y', 'result.mp4',
  ])
  if (code !== 0) throw new Error('Video export failed. Try Fast quality, a shorter clip, or disable burned-in subtitles.')
  const bytes = await ff.readFile('result.mp4') as Uint8Array
  const blob = new Blob([new Uint8Array(bytes)], { type: 'video/mp4' })
  await ff.deleteFile('result.mp4')
  for (let i = 0; i < Math.min(subs.length, 65); i++) { try { await ff.deleteFile(`subtitle-${i}.txt`) } catch { /* ignore */ } }
  return blob
}

export async function whisperTranscribe(audio: Float32Array, notify?: (text: string) => void): Promise<CaptionChunk[]> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/transcribe.worker.ts', import.meta.url), { type: 'module' })
    const id = Date.now()
    worker.onmessage = (event: MessageEvent<{id: number; kind: string; message?: string; chunks?: CaptionChunk[]; text?: string}>) => {
      if (event.data.id !== id) return
      if (event.data.kind === 'status') notify?.(event.data.message || 'Transcribing…')
      if (event.data.kind === 'done') {
        const chunks = event.data.chunks || []
        if (!chunks.length && event.data.text) chunks.push({ start: 0, end: audio.length / 16000, text: event.data.text })
        worker.terminate(); resolve(chunks)
      }
      if (event.data.kind === 'error') { worker.terminate(); reject(new Error(event.data.message || 'Whisper failed')) }
    }
    worker.onerror = (e) => { worker.terminate(); reject(new Error(e.message || 'Transcription worker failed')) }
    worker.postMessage({ id, audio, language: 'en' }, [audio.buffer])
  })
}

let writer: any = null
export async function rewriteMetadata(sourceText: string, notify?: (text: string) => void): Promise<{title: string; caption: string}> {
  const { pipeline } = await import('@huggingface/transformers')
  if (!writer) {
    notify?.('Loading Qwen 0.5B on-device model (large one-time download)…')
    writer = await pipeline('text-generation', 'onnx-community/Qwen2.5-0.5B-Instruct', {
      device: 'gpu' in navigator ? 'webgpu' : 'wasm',
      dtype: 'q4',
    } as any)
  }
  notify?.('Writing title and caption locally…')
  const prompt = `Generate a punchy, accurate short-video title and social caption grounded ONLY in the transcript. Do not invent facts. No clickbait false claims. Return exactly two lines, 'TITLE: ...' and 'CAPTION: ...'. The caption should include a call to action and 2 relevant hashtags. TRANSCRIPT: ${sourceText.slice(0, 1100)}`
  const response = await writer([{ role: 'system', content: 'You help video creators write high-retention, accurate short video metadata.' }, { role: 'user', content: prompt }], { max_new_tokens: 160, do_sample: false, return_full_text: false })
  const generated = response?.[0]?.generated_text
  const content: string = Array.isArray(generated)
    ? String(generated[generated.length - 1]?.content || '')
    : String(generated || '')
  // Prefer lines from the generated response, not examples embedded in the prompt.
  const lines = content.replace(/\\n/g, '\n').split(/\r?\n/)
  const titleLine = lines.find(line => /^\s*TITLE\s*:/i.test(line))
  const captionLine = lines.find(line => /^\s*CAPTION\s*:/i.test(line))
  if (!titleLine || !captionLine) throw new Error('Local model returned an unexpected format. Edit the generated fields manually.')
  return { title: titleLine.replace(/^\s*TITLE\s*:\s*/i, '').trim().slice(0, 100), caption: captionLine.replace(/^\s*CAPTION\s*:\s*/i, '').trim() }

}
