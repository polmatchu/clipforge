import type { CaptionChunk, Clip, Sample, Settings } from '../types'

export const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n))
export const clock = (seconds: number) => {
  const s = Math.floor(Math.max(0, seconds))
  return `${Math.floor(s / 60).toString().padStart(2, '0')}:${(s % 60).toString().padStart(2, '0')}`
}
export const safeName = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 65) || 'clip'

export function parseYoutube(input: string): string | null {
  try {
    const url = new URL(input.trim())
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    let id = ''
    if (host === 'youtu.be') id = url.pathname.split('/')[1] || ''
    else if (host === 'youtube.com' || host === 'm.youtube.com' || host === 'youtube-nocookie.com') {
      id = url.searchParams.get('v') || ''
      if (!id) id = url.pathname.match(/^\/(?:shorts|embed|live)\/([^/]+)/)?.[1] || ''
    }
    return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null
  } catch { return null }
}

export function transcriptForRange(chunks: CaptionChunk[], start: number, end: number) {
  return chunks.filter(x => x.end > start && x.start < end).map(x => x.text.trim()).join(' ').trim()
}
const stopwords = new Set('that from this with your what when where which about there their they them have been were going just really think would could should while like into then than also because doing here some those these right yeah okay very much know look want them will dont does didnt even only more most each over after before'.split(' '))
const hookWords = /\b(never|secret|shocking|incredible|finally|actually|mistake|surprise|amazing|important|wait|watch|crazy|worst|best|problem|change|why|how|first|wrong|truth|unexpected|unbelievable|no one|turns out|realized|imagine|instead|here's|risk|moment|insane)\b/i

export function makeMetadata(text: string, index: number, mode: Settings['mode']): { title: string; caption: string } {
  const clean = text.replace(/\s+/g, ' ').replace(/[^\w\s.,?!'’-]/g, '').trim()
  const phrase = clean.split(/[.!?]/).map(x => x.trim()).find(x => x.length >= 12) || clean
  const words = phrase.split(' ').slice(0, 9).join(' ')
  const title = mode === 'split'
    ? `Part ${index + 1} | ${words || 'The full story'}`
    : words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}${/[!?]$/.test(words) ? '' : '…'}` : `Must-watch moment #${index + 1}`
  const terms = (clean.toLowerCase().match(/\b[a-z]{4,}\b/g) || []).filter(x => !stopwords.has(x))
  const freq = new Map<string, number>()
  terms.forEach(x => freq.set(x, (freq.get(x) || 0) + 1))
  const topics = [...freq.entries()].sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => `#${w}`)
  const intro = clean.length > 20 ? clean.slice(0, 140).replace(/\s+\S*$/, '') : 'A highlight from the original video.'
  const caption = `${intro}${clean.length > 140 ? '…' : ''}\n\nWhat do you think? 👇\n\n#shorts #reels #tiktok ${topics.join(' ')}`.trim()
  return { title: title.slice(0, 95), caption }
}

export function parseTranscript(raw: string, duration: number): CaptionChunk[] {
  const t = raw.trim()
  if (!t) return []
  const timestamp = (v: string) => {
    const p = v.replace(',', '.').split(':').map(Number)
    return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p.length === 2 ? p[0] * 60 + p[1] : NaN
  }
  // SRT / VTT blocks; handle optional cue IDs and WebVTT headers.
  const blocks = t.replace(/\r/g, '').split(/\n\s*\n/)
  const parsed: CaptionChunk[] = []
  for (const block of blocks) {
    const lines = block.split('\n')
    const i = lines.findIndex(line => line.includes('-->'))
    if (i < 0) continue
    const match = lines[i].match(/(\d\d?:\d\d(?::\d\d)?[,.]\d+|\d\d?:\d\d(?::\d\d)?)\s*-->\s*(\d\d?:\d\d(?::\d\d)?[,.]\d+|\d\d?:\d\d(?::\d\d)?)/)
    if (!match) continue
    const start = timestamp(match[1]); const end = timestamp(match[2])
    if (Number.isFinite(start) && Number.isFinite(end) && end > start) {
      parsed.push({ start, end, text: lines.slice(i + 1).join(' ').replace(/<[^>]+>/g, '').trim() })
    }
  }
  if (parsed.length) return parsed.filter(x => x.text.length > 0)
  // Plain text can assist ranking/metadata, but is not a synchronized subtitle.
  const sentences = t.match(/[^.!?\n]+[.!?]?/g)?.map(x => x.trim()).filter(Boolean) || [t]
  const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0)
  let at = 0
  return sentences.map(s => {
    const span = duration * (s.split(/\s+/).length / Math.max(1, totalWords))
    const chunk = { start: at, end: Math.min(duration, at + span), text: s }
    at += span
    return chunk
  })
}

export function splitForSubtitles(chunks: CaptionChunk[], start: number, end: number): CaptionChunk[] {
  const out: CaptionChunk[] = []
  for (const c of chunks) {
    const from = Math.max(start, c.start)
    const to = Math.min(end, c.end)
    if (to <= from) continue
    const words = c.text.trim().split(/\s+/).filter(Boolean)
    // Whisper timestamps are segment-level, not precise forced word alignment.
    const groupSize = 5
    const count = Math.ceil(words.length / groupSize)
    for (let i = 0; i < count; i++) {
      const t0 = from + (to - from) * i / count
      const t1 = from + (to - from) * (i + 1) / count
      out.push({ start: t0 - start, end: t1 - start, text: words.slice(i * groupSize, (i + 1) * groupSize).join(' ') })
    }
  }
  return out
}

export async function sampleScenes(videoUrl: string, duration: number, notify?: (progress: number) => void): Promise<Sample[]> {
  const video = document.createElement('video')
  video.src = videoUrl
  video.muted = true
  video.preload = 'auto'
  video.playsInline = true
  await new Promise<void>((resolve, reject) => {
    if (video.readyState >= 1) return resolve()
    video.onloadedmetadata = () => resolve()
    video.onerror = () => reject(new Error('Could not decode the selected video in this browser.'))
  })
  const canvas = document.createElement('canvas')
  canvas.width = 64; canvas.height = 36
  const ctx = canvas.getContext('2d', { willReadFrequently: true })
  if (!ctx) return []
  const samples: Sample[] = []
  let previous: Uint8ClampedArray | null = null
  const step = Math.max(1.5, duration / 85)
  const count = Math.min(90, Math.ceil(duration / step))
  for (let i = 0; i < count; i++) {
    const time = clamp(i * step + 0.1, 0, Math.max(0, duration - 0.1))
    try {
      await new Promise<void>((resolve, reject) => {
        const timeout = window.setTimeout(() => { video.removeEventListener('seeked', done); reject(new Error('Seek timeout')) }, 4500)
        function done() { window.clearTimeout(timeout); resolve() }
        video.addEventListener('seeked', done, { once: true })
        video.currentTime = time
        if (Math.abs(video.currentTime - time) > 0.2 && i === 0) { /* seeked event will fire */ }
      })
      ctx.drawImage(video, 0, 0, 64, 36)
      const next = ctx.getImageData(0, 0, 64, 36).data
      let diff = 0
      if (previous) {
        for (let p = 0; p < next.length; p += 16) {
          diff += Math.abs(next[p] - previous[p]) + Math.abs(next[p + 1] - previous[p + 1]) + Math.abs(next[p + 2] - previous[p + 2])
        }
        diff /= (next.length / 16) * 765
      }
      samples.push({ time, motion: clamp(diff * 5.5, 0, 1) })
      previous = new Uint8ClampedArray(next)
    } catch { samples.push({ time, motion: 0 }) }
    notify?.((i + 1) / count)
  }
  video.removeAttribute('src'); video.load()
  return samples
}

function windowScore(start: number, end: number, samples: Sample[], chunks: CaptionChunk[]) {
  const selected = samples.filter(s => s.time >= start && s.time < end)
  const motion = selected.length ? selected.reduce((sum, s) => sum + s.motion, 0) / selected.length : 0
  const peaks = selected.filter(x => x.motion > 0.43).length / Math.max(1, selected.length)
  const relevant = chunks.filter(x => x.start < end && x.end > start)
  const speechDuration = relevant.reduce((n, x) => n + Math.max(0, Math.min(x.end, end) - Math.max(x.start, start)), 0)
  const speech = clamp(speechDuration / Math.max(1, end - start), 0, 1)
  const txt = relevant.map(x => x.text).join(' ')
  const hooks = (txt.match(new RegExp(hookWords.source, 'ig')) || []).length
  const emphasis = (txt.match(/[!?]/g) || []).length
  const hookScore = clamp((hooks * 0.15 + emphasis * 0.06), 0, 1)
  // Heuristic, not a statistical probability of virality.
  const combined = 0.32 * motion + 0.18 * peaks + 0.23 * speech + 0.27 * hookScore
  const score = Math.round(clamp(22 + combined * 85, 12, 96))
  const reason = hooks ? 'Strong hook language and visual activity' : peaks > 0.23 ? 'Frequent visual changes and active moments' : speech > 0.65 ? 'Dense spoken segment with few pauses' : 'Visual activity detected — review the hook'
  return { score, reason }
}

export function generateClips(duration: number, samples: Sample[], transcript: CaptionChunk[], settings: Settings): Clip[] {
  if (!Number.isFinite(duration) || duration <= 0) return []
  const length = Math.min(settings.length, duration)
  let ranges: Array<[number, number]> = []
  if (settings.mode === 'split') {
    // Preserve the full video, dividing it into consecutive parts (count acts as an upper bound).
    const parts = Math.ceil(duration / settings.length)
    for (let i = 0; i < parts; i++) ranges.push([i * settings.length, Math.min(duration, (i + 1) * settings.length)])
  } else {
    const candidates: Array<{ start: number; end: number; score: number }> = []
    const step = Math.max(2, Math.min(6, length / 6))
    for (let start = 0; start <= duration - length + 0.01; start += step) {
      const { score } = windowScore(start, start + length, samples, transcript)
      candidates.push({ start, end: start + length, score })
    }
    if (!candidates.length) candidates.push({ start: 0, end: duration, score: 20 })
    candidates.sort((a, b) => b.score - a.score)
    for (const candidate of candidates) {
      if (ranges.length >= settings.count) break
      if (!ranges.some(([s, e]) => Math.max(s, candidate.start) < Math.min(e, candidate.end) - length * 0.12)) ranges.push([candidate.start, candidate.end])
    }
    ranges.sort((a, b) => a[0] - b[0])
  }
  return ranges.map(([start, end], i) => {
    const { score, reason } = windowScore(start, end, samples, transcript)
    const txt = transcriptForRange(transcript, start, end)
    const metadata = makeMetadata(txt, i, settings.mode)
    return {
      id: crypto.randomUUID(), start: Math.round(start * 10) / 10, end: Math.round(end * 10) / 10,
      score, headline: metadata.title, caption: metadata.caption,
      reason: settings.mode === 'split' ? 'Sequential part — no content removed' : reason,
      segments: transcript.filter(x => x.start < end && x.end > start),
    }
  })
}

const subtitleTime = (seconds: number) => {
  const whole = Math.floor(seconds), ms = Math.floor((seconds - whole) * 1000)
  return `${Math.floor(whole / 3600).toString().padStart(2, '0')}:${Math.floor((whole / 60) % 60).toString().padStart(2, '0')}:${(whole % 60).toString().padStart(2, '0')},${ms.toString().padStart(3, '0')}`
}
export function clipSrt(clip: Clip): string {
  return splitForSubtitles(clip.segments, clip.start, clip.end)
    .map((c, i) => `${i + 1}\n${subtitleTime(c.start)} --> ${subtitleTime(c.end)}\n${c.text}\n`).join('\n')
}
