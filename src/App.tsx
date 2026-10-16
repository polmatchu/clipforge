import { useEffect, useMemo, useRef, useState } from 'react'
import JSZip from 'jszip'
import {
  Aperture, ArrowDownToLine, ArrowRight, BadgeCheck, CalendarClock, Captions, Check,
  CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clapperboard, Clock3,
  CloudOff, Copy, Download, ExternalLink, Eye, FileText, Film, FolderOpen, Github,
  Headphones, Info, Instagram, Layers3, LayoutDashboard, Link2, ListVideo, LoaderCircle,
  MonitorPlay, MoreHorizontal, MousePointer2, Music2, Pause, Play, Plus, RotateCcw,
  Scissors, Search, Settings2, ShieldCheck, Sparkles, Trash2, TrendingUp, Upload,
  WandSparkles, Youtube, Zap, type LucideIcon,
} from 'lucide-react'
import type { CaptionChunk, Clip, Plan, Platform, Sample, Settings, View } from './types'
import { defaults } from './types'
import { clock, clipSrt, generateClips, makeMetadata, parseTranscript, parseYoutube, safeName, sampleScenes, transcriptForRange } from './lib/highlights'
import { extractAudio, renderClip, rewriteMetadata, whisperTranscribe } from './lib/engine'
import { connectYouTube, uploadYouTube, type GoogleAccess, type YouTubeVisibility } from './lib/youtube'
import './styles.css'

const saved = <T,>(key: string, fallback: T): T => {
  try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback } catch { return fallback }
}
const platformUrls: Record<Platform, string> = {
  YouTube: 'https://studio.youtube.com/',
  TikTok: 'https://www.tiktok.com/upload',
  Instagram: 'https://www.instagram.com/',
}
function useToast() {
  const [message, setMessage] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  function toast(text: string) {
    setMessage(text)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setMessage(''), 3800)
  }
  return { message, toast }
}
function download(data: Blob | string, name: string, mime = 'text/plain') {
  const blob = typeof data === 'string' ? new Blob([data], { type: mime }) : data
  const link = document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = name
  document.body.appendChild(link); link.click(); link.remove()
  setTimeout(() => URL.revokeObjectURL(link.href), 1200)
}
function toIcs(p: Plan) {
  const escape = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;')
  const date = new Date(p.date)
  const timestamp = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '')
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//ClipForge//Upload Reminder//EN\r\nBEGIN:VEVENT\r\nUID:${p.id}@clipforge.local\r\nDTSTAMP:${timestamp(new Date())}\r\nDTSTART:${timestamp(date)}\r\nDTEND:${timestamp(new Date(date.getTime() + 30 * 60 * 1000))}\r\nSUMMARY:${escape(`Post ${p.filename} to ${p.platform}`)}\r\nDESCRIPTION:${escape(`Manually upload ${p.filename} to ${p.platform}.\\n${p.title}\\n${p.caption}`)}\r\nBEGIN:VALARM\r\nTRIGGER:-PT15M\r\nACTION:DISPLAY\r\nDESCRIPTION:Prepare your upload\r\nEND:VALARM\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`
}
const defaultSchedule = () => {
  const d = new Date(Date.now() + 86400000)
  d.setHours(18, 0, 0, 0)
  const local = new Date(d.getTime() - d.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}
const NavItem = ({ icon: Icon, title, active, onClick, badge }: { icon: LucideIcon; title: string; active: boolean; onClick: () => void; badge?: number }) => <button className={`nav-item ${active ? 'active' : ''}`} onClick={onClick}><Icon size={18}/><span>{title}</span>{badge ? <span className="nav-counter">{badge}</span> : null}</button>
const Toggle = ({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) => <button role="switch" aria-checked={checked} aria-label="Toggle setting" className={`toggle ${checked ? 'on' : ''}`} onClick={() => onChange(!checked)}><span/></button>
const SectionTitle = ({ eyebrow, title, description, trailing }: { eyebrow?: string; title: string; description?: string; trailing?: React.ReactNode }) => <div className="section-top"><div>{eyebrow && <span className="eyebrow">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>{trailing}</div>
function FeatureTag({icon:Icon,label}: {icon:LucideIcon; label:string}) { return <span className="feature-tag"><Icon size={13}/>{label}</span> }
function scoreClass(score: number) { return score >= 64 ? 'score-high' : score >= 44 ? 'score-mid' : 'score-low' }

export default function App() {
  const [view, setView] = useState<View>('studio')
  const [settings, setSettings] = useState<Settings>(() => saved('clipforge.settings', defaults))
  const [plans, setPlans] = useState<Plan[]>(() => saved('clipforge.plans', []))
  const [youtubeUrl, setYoutubeUrl] = useState('')
  const [file, setFile] = useState<File | null>(null)
  const [videoUrl, setVideoUrl] = useState('')
  const [duration, setDuration] = useState(0)
  const [transcript, setTranscript] = useState<CaptionChunk[]>([])
  const [transcriptRaw, setTranscriptRaw] = useState('')
  const [transcriptOpen, setTranscriptOpen] = useState(false)
  const [samples, setSamples] = useState<Sample[]>([])
  const [clips, setClips] = useState<Clip[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState(0)
  const [activity, setActivity] = useState('')
  const [showLow, setShowLow] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [scheduleClip, setScheduleClip] = useState<Clip | null>(null)
  const [schedulePlatform, setSchedulePlatform] = useState<Platform>('YouTube')
  const [scheduleDate, setScheduleDate] = useState(defaultSchedule)
  const [copyIndicator, setCopyIndicator] = useState('')
  const [youtubeClientId, setYoutubeClientId] = useState(() => saved<string>('clipforge.youtubeClientId', ''))
  const [youtubeAccess, setYoutubeAccess] = useState<GoogleAccess | null>(null)
  const [youtubeFile, setYoutubeFile] = useState<File | null>(null)
  const [youtubeTitle, setYoutubeTitle] = useState('')
  const [youtubeCaption, setYoutubeCaption] = useState('')
  const [youtubeVisibility, setYoutubeVisibility] = useState<YouTubeVisibility>('private')
  const [youtubeSchedule, setYoutubeSchedule] = useState(defaultSchedule)
  const [youtubeRights, setYoutubeRights] = useState(false)
  const [youtubeUploadProgress, setYoutubeUploadProgress] = useState(0)
  const [youtubeUploadUrl, setYoutubeUploadUrl] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const { message, toast } = useToast()
  const sourceId = parseYoutube(youtubeUrl)
  const selected = clips.find(c => c.id === selectedId) || clips[0] || null
  const flagged = clips.filter(c => c.score < 36).length
  const accepted = clips.filter(c => !settings.reviewLowScores || showLow || c.score >= 36)

  useEffect(() => { localStorage.setItem('clipforge.settings', JSON.stringify(settings)) }, [settings])
  useEffect(() => { localStorage.setItem('clipforge.plans', JSON.stringify(plans)) }, [plans])
  useEffect(() => { localStorage.setItem('clipforge.youtubeClientId', JSON.stringify(youtubeClientId)) }, [youtubeClientId])
  useEffect(() => () => { if (videoUrl) URL.revokeObjectURL(videoUrl) }, [videoUrl])
  const setOption = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(prev => ({ ...prev, [key]: value }))
  const durationLabel = duration ? clock(duration) : '—'
  const liveClip = (c: Clip): Clip => ({ ...c, segments: transcript.filter(x => x.end > c.start && x.start < c.end) })
  const manifestFor = (items: Clip[]) => items.map(clip => ({ filename: clipFileName(clip), title: clip.headline, caption: clip.caption, start: clip.start, end: clip.end, score: clip.score }))
  const exportManifest = () => { download(JSON.stringify(manifestFor(accepted), null, 2), 'upload-manifest.json', 'application/json'); toast('Manifest saved for the native FFmpeg renderer.') }
  const hasTranscript = transcript.length > 0

  function loadFile(value: File | undefined) {
    if (!value) return
    if (!value.type.startsWith('video/') && !/\.(mp4|mov|m4v|webm|mkv)$/i.test(value.name)) { toast('Choose a supported video file.'); return }
    const source = URL.createObjectURL(value)
    setFile(value); setVideoUrl(source); setDuration(0); setTranscript([]); setTranscriptRaw('')
    setSamples([]); setClips([]); setSelectedId(null); setShowLow(false); setProgress(0)
    toast(`Loaded ${value.name}`)
    setView('studio')
  }
  function updateClip(id: string, patch: Partial<Clip>) { setClips(prev => prev.map(c => c.id === id ? { ...c, ...patch } : c)) }
  function generate() {
    if (!file || !duration) { toast('Choose a video before generating clips.'); return }
    if (settings.mode === 'split' && Math.ceil(duration / settings.length) > 80) { toast('More than 80 parts: choose a larger part size or use the local renderer.'); return }
    const generated = generateClips(duration, samples, transcript, settings)
    setClips(generated); setSelectedId(generated[0]?.id ?? null)
    setView('clips'); toast(`${generated.length} ${settings.mode === 'split' ? 'sequential parts' : 'highlight candidates'} created.`)
  }
  async function analyze() {
    if (!file || !videoUrl || !duration) { toast('Import a playable video first.'); return }
    try {
      setBusy(true); setProgress(0); setActivity('Scanning visual changes…')
      const result = await sampleScenes(videoUrl, duration, setProgress)
      setSamples(result)
      const generated = generateClips(duration, result, transcript, settings)
      setClips(generated); setSelectedId(generated[0]?.id || null); setView('clips')
      toast('Visual scan complete. Review and adjust the suggestions.')
    } catch (e) { toast(e instanceof Error ? e.message : 'Analysis failed') }
    finally { setBusy(false); setProgress(0); setActivity('') }
  }
  async function transcribe() {
    if (!file) { toast('Choose a video file first.'); return }
    if (duration > 900) { toast('Browser Whisper is limited to 15 minutes here. Import an SRT for longer videos.'); return }
    try {
      setBusy(true); setProgress(0); setActivity('Preparing audio…')
      const audio = await extractAudio(file, setActivity)
      const result = await whisperTranscribe(audio, setActivity)
      if (!result.length) { toast('Whisper did not detect any speech.'); return }
      setTranscript(result)
      setTranscriptRaw('')
      setClips(prev => prev.map((c, i) => {
        const words = transcriptForRange(result, c.start, c.end)
        const meta = makeMetadata(words, i, settings.mode)
        return { ...c, segments: result.filter(s => s.end > c.start && s.start < c.end), headline: meta.title, caption: meta.caption }
      }))
      toast(`Transcribed ${result.length} speech segments. Regenerate clips to re-rank with speech cues.`)
    } catch(e) { toast(e instanceof Error ? e.message : 'On-device transcription failed') }
    finally { setBusy(false); setActivity('') }
  }
  function importTranscript() {
    if (!transcriptRaw.trim() || !duration) { toast('Paste a transcript and load a video first.'); return }
    const parsed = parseTranscript(transcriptRaw, duration)
    setTranscript(parsed)
    setClips(prev => prev.map((c, i) => {
      const meta = makeMetadata(transcriptForRange(parsed, c.start, c.end), i, settings.mode)
      return { ...c, segments: parsed.filter(s => s.end > c.start && s.start < c.end), headline: meta.title, caption: meta.caption }
    }))
    setTranscriptOpen(false)
    toast(`Imported ${parsed.length} transcript segments.`)
  }
  async function useAiCopy(clip: Clip) {
    const text = transcriptForRange(transcript, clip.start, clip.end)
    if (text.length < 30) { toast('Transcribe or import the speech before AI rewriting.'); return }
    try {
      setBusy(true); setActivity('Loading local copywriting model…')
      const generated = await rewriteMetadata(text, setActivity)
      updateClip(clip.id, { headline: generated.title, caption: generated.caption })
      toast('Local AI copywriting finished. Review for accuracy.')
    } catch(e) { toast(e instanceof Error ? e.message : 'AI copywriting failed') }
    finally { setBusy(false); setActivity('') }
  }
  async function copy(text: string, label: string) {
    try { await navigator.clipboard.writeText(text); setCopyIndicator(label); toast(`${label} copied to clipboard!`); setTimeout(() => setCopyIndicator(''), 1400) }
    catch { toast('Clipboard access unavailable. Select and copy from the text field.') }
  }
  async function exportOne(clip: Clip): Promise<Blob | null> {
    if (!file) { toast('Reload your original video before exporting.'); return null }
    try {
      setBusy(true); setProgress(0)
      const blob = await renderClip(file, liveClip(clip), settings, setActivity, setProgress)
      return blob
    } catch (e) { toast(e instanceof Error ? e.message : 'Export failed'); return null }
    finally { setBusy(false); setProgress(0); setActivity('') }
  }
  const clipFileName = (clip: Clip) => `${safeName(clip.headline)}-${clock(clip.start).replace(':', '-')}.mp4`
  async function exportSelected(clip: Clip) {
    const blob = await exportOne(clip)
    if (blob) { download(blob, clipFileName(clip)); toast('MP4 exported. Ready for review and upload.') }
  }
  async function exportAll() {
    if (!file || !accepted.length) { toast('No clips are available to export.'); return }
    const zip = new JSZip(), manifest = []
    try {
      setBusy(true); setProgress(0)
      for (let i = 0; i < accepted.length; i++) {
        const clip = accepted[i]
        const name = clipFileName(clip)
        setActivity(`Exporting clip ${i + 1}/${accepted.length}: ${clock(clip.start)} – ${clock(clip.end)}`)
        const blob = await renderClip(file, liveClip(clip), settings, setActivity, n => setProgress((i + n) / accepted.length))
        zip.file(name, blob)
        zip.file(name.replace('.mp4', '.srt'), clipSrt(liveClip(clip)))
        zip.file(name.replace('.mp4', '.txt'), `${clip.headline}\n\n${clip.caption}\n`)
        manifest.push({ filename: name, title: clip.headline, caption: clip.caption, start: clip.start, end: clip.end, score: clip.score })
      }
      zip.file('upload-manifest.json', JSON.stringify(manifest, null, 2))
      setActivity('Packaging clips and captions…')
      download(await zip.generateAsync({ type: 'blob' }), 'clipforge-export.zip')
      toast(`${accepted.length} clips exported in a ZIP.`)
    } catch(e) { toast(e instanceof Error ? e.message : 'Batch export failed') }
    finally { setBusy(false); setActivity(''); setProgress(0) }
  }
  function addPlan() {
    if (!scheduleClip || !scheduleDate) return
    const dt = new Date(scheduleDate)
    if (Number.isNaN(dt.getTime())) { toast('Enter a valid scheduled date.'); return }
    const plan: Plan = { id: crypto.randomUUID(), clipId: scheduleClip.id, platform: schedulePlatform,
      date: dt.toISOString(), title: scheduleClip.headline, caption: scheduleClip.caption, filename: clipFileName(scheduleClip) }
    setPlans(prev => [...prev, plan].sort((a, b) => a.date.localeCompare(b.date)))
    setScheduleClip(null); toast('Reminder added to your local planner. It will not auto-publish.')
  }
  function connectYoutubeAccount() {
    setActivity('')
    connectYouTube(youtubeClientId).then(access => {
      setYoutubeAccess(access)
      toast('Google authorized YouTube uploads for this browser session.')
    }).catch(e => toast(e instanceof Error ? e.message : 'Google authorization failed'))
  }
  async function uploadYoutubeFile() {
    if (!youtubeFile || !youtubeAccess || !youtubeRights) {
      toast('Connect YouTube, select an exported MP4, and confirm rights first.')
      return
    }
    try {
      setBusy(true); setActivity('Uploading directly to YouTube…'); setYoutubeUploadProgress(0)
      const url = await uploadYouTube(youtubeFile, youtubeAccess, {
        title: youtubeTitle, description: youtubeCaption,
        visibility: youtubeVisibility, scheduledAt: youtubeSchedule,
      }, n => setYoutubeUploadProgress(n))
      setYoutubeUploadUrl(url)
      toast('YouTube received the video. Check processing status in YouTube Studio.')
    } catch(e) { toast(e instanceof Error ? e.message : 'YouTube upload failed') }
    finally { setBusy(false); setActivity(''); setYoutubeUploadProgress(0) }
  }
  function seekTo(clip: Clip) {
    setSelectedId(clip.id)
    if (videoRef.current) { videoRef.current.currentTime = clip.start; videoRef.current.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }
  }
  const transcriptWords = useMemo(() => transcript.reduce((sum, s) => sum + s.text.split(/\s+/).length, 0), [transcript])

  return <div className="shell">
    <aside className="sidebar">
      <div className="brand"><div className="brand-icon"><Scissors size={21} strokeWidth={2.8}/></div><div className="brand-name">clipforge<span className="brand-period">.</span></div><span className="brand-beta">BETA</span></div>
      <div className="workspace-tag"><div className="workspace-avatar">M</div><div className="workspace-text"><strong>My workspace</strong><span>Personal studio</span></div><ChevronDown size={15}/></div>
      <div className="sidebar-section-label">WORKSPACE</div>
      <nav className="nav-list">
        <NavItem icon={LayoutDashboard} title="Studio" active={view === 'studio'} onClick={() => setView('studio')}/>
        <NavItem icon={Clapperboard} title="My clips" active={view === 'clips'} onClick={() => setView('clips')} badge={clips.length}/>
        <NavItem icon={CalendarClock} title="Content planner" active={view === 'planner'} onClick={() => setView('planner')} badge={plans.length}/>
        <NavItem icon={Layers3} title="Channels" active={view === 'channels'} onClick={() => setView('channels')}/>
      </nav>
      <div className="sidebar-section-label second-label">RESOURCES</div>
      <nav className="nav-list"><NavItem icon={CircleHelp} title="Setup & guide" active={view === 'guide'} onClick={() => setView('guide')}/></nav>
      <div className="sidebar-grow"/>
      <div className="free-card"><div className="free-icon"><Zap size={16} fill="currentColor"/></div><strong>100% local. 100% yours.</strong><p>Unlimited exports. No subscription. No watermarks.</p><div className="free-status"><span className="green-dot"/> Free forever*</div></div>
      <div className="sidebar-bottom"><div className="user-circle">CF</div><div><strong>Your studio</strong><span>Local device</span></div><CloudOff size={16}/></div>
    </aside>

    <main className="main">
      <header className="topbar"><div className="breadcrumb"><span>Workspace</span><ChevronRight size={14}/><strong>{({studio:'Studio',clips:'My clips',planner:'Content planner',channels:'Channels',guide:'Help center'} as Record<View,string>)[view]}</strong></div><div className="top-actions"><span className="privacy"><span className="green-dot"/> Local-first</span><a className="top-help" href="https://github.com/new" target="_blank" rel="noreferrer"><Github size={17}/> Publish on GitHub <ExternalLink size={13}/></a><div className="top-avatar">CF</div></div></header>
      <div className="page-content">
        {view === 'studio' && <>
          <div className="hero"><div className="hero-grid"/><div className="hero-copy"><div className="hero-pill"><Sparkles size={13}/> THE CREATOR'S SHORT-FORM STUDIO <span>✦</span></div><h1>One long video.<br/><span>Endless possibilities.</span></h1><p>Find the moments worth sharing. Turn them into scroll-stopping Shorts, Reels and TikToks — without paid AI tools.</p><div className="hero-features"><FeatureTag icon={WandSparkles} label="Smart moments"/><FeatureTag icon={Captions} label="Auto captions"/><FeatureTag icon={ShieldCheck} label="Private by design"/></div></div><div className="hero-visual" aria-hidden="true"><div className="floating-card top-float"><span className="float-dot"/><span>Finding standout moments</span><span className="float-percent">92%</span></div><div className="phone-mock"><div className="phone-video"><div className="phone-orb"/><div className="phone-text">CREATE<br/><span>MORE.</span></div><div className="phone-subtitle">This is the moment.</div></div></div><div className="floating-card bottom-float"><TrendingUp size={16}/><span>Make every moment count</span><span>↗</span></div></div></div>
          <SectionTitle eyebrow="01 / IMPORT" title="Start with your content" description="Bring your own video. Everything is processed in your browser, on your device." trailing={<span className="micro-label"><ShieldCheck size={14}/> Your videos stay local</span>}/>
          <div className="import-grid"><div className="panel link-panel"><div className="panel-heading"><span className="panel-icon purple"><Link2 size={19}/></span><div><strong>Paste a YouTube link</strong><p>Reference the original video</p></div></div><div className="input-row"><input value={youtubeUrl} onChange={e=>setYoutubeUrl(e.target.value)} placeholder="https://youtube.com/watch?v=..." aria-label="YouTube URL"/><button aria-label="Show YouTube preview" className="input-apply" onClick={() => sourceId ? toast('YouTube video linked. Now add your authorized source file.') : toast('Enter a valid YouTube video link.')}><ArrowRight size={18}/></button></div>{youtubeUrl && !sourceId ? <p className="input-warning">Enter a valid YouTube watch, Shorts, or youtu.be link.</p> : sourceId ? <div className="youtube-preview"><iframe title="YouTube video preview" src={`https://www.youtube-nocookie.com/embed/${sourceId}`} allow="accelerometer; encrypted-media; gyroscope; picture-in-picture" allowFullScreen/><p><Info size={13}/> A link previews the source; an authorized local file is still required for editing. <a href="https://studio.youtube.com/" target="_blank" rel="noreferrer">Get your own upload ↗</a></p></div> : <p className="fine-print"><Info size={13}/> YouTube cannot provide downloadable video files through a static web app.</p>}</div>
            <div className={`panel drop-panel ${dragging ? 'dragging' : ''}`} onDragOver={e=>{e.preventDefault();setDragging(true)}} onDragLeave={()=>setDragging(false)} onDrop={e=>{e.preventDefault();setDragging(false);loadFile(e.dataTransfer.files[0])}}><div className="panel-heading"><span className="panel-icon teal"><Upload size={19}/></span><div><strong>Upload a video file</strong><p>MP4, MOV, WebM and more</p></div></div><button className="drop-zone" onClick={()=>inputRef.current?.click()}><span className="drop-file-icon"><FolderOpen size={23}/></span><strong>{file ? file.name : 'Click to browse or drag & drop'}</strong><span>{file ? `${(file.size / 1024 / 1024).toFixed(1)} MB · ${durationLabel}` : 'Local file — never sent to our servers'}</span></button><input ref={inputRef} type="file" accept="video/*,.mkv" hidden onChange={e=>loadFile(e.target.files?.[0])}/></div></div>
          {file && <div className="panel source-panel"><div className="source-preview"><video ref={videoRef} src={videoUrl} controls preload="metadata" onLoadedMetadata={e=>{const d=e.currentTarget.duration;setDuration(Number.isFinite(d)?d:0)}}/><span className="source-overlay-tag"><span className="green-dot"/> SOURCE READY</span></div><div className="source-details"><span className="eyebrow">YOUR VIDEO</span><h3 title={file.name}>{file.name}</h3><div className="source-stats"><div><span>DURATION</span><strong>{durationLabel}</strong></div><div><span>FILE SIZE</span><strong>{(file.size / (1024 * 1024)).toFixed(1)} MB</strong></div><div><span>TRANSCRIPT</span><strong>{hasTranscript ? `${transcriptWords} words` : 'Not added'}</strong></div></div><div className="source-buttons"><button disabled={busy || !duration} className="btn light" onClick={transcribe}><Headphones size={16}/>{hasTranscript ? 'Transcribe again' : 'Transcribe with Whisper'}</button><button className="btn outline" disabled={busy} onClick={()=>setTranscriptOpen(x=>!x)}><FileText size={16}/> Paste SRT / transcript</button></div><p className="tiny-tip"><Info size={14}/> Whisper runs on your device; first run downloads a free model. For best accuracy, check its subtitles before publishing. {file.size > 300*1024*1024 ? "Large file: consider the Manifest download and native FFmpeg renderer to avoid browser memory limits." : ""}</p></div></div>}
          {file && transcriptOpen && <div className="panel transcript-panel"><div className="panel-heading"><span className="panel-icon purple"><FileText size={19}/></span><div><strong>Import your transcript</strong><p>Use SRT/VTT with timestamps for accurate synced captions, or plain text for approximate timing.</p></div></div><textarea rows={6} value={transcriptRaw} onChange={e=>setTranscriptRaw(e.target.value)} placeholder={'1\n00:00:01,000 --> 00:00:03,500\nThis is the opening line...'} /><div className="transcript-actions"><button className="btn outline" onClick={()=>setTranscriptOpen(false)}>Cancel</button><button className="btn primary" onClick={importTranscript}>Import transcript <ArrowRight size={15}/></button></div></div>}
          <SectionTitle eyebrow="02 / CREATE" title="Set your creative direction" description="Choose how ClipForge should turn your footage into ready-to-post videos."/>
          <div className="creation-grid"><div className="panel settings-card"><div className="settings-head"><span className="panel-icon purple"><Settings2 size={19}/></span><strong>Generation settings</strong></div><span className="input-label">Creation mode</span><div className="mode-switch"><button className={`mode-choice ${settings.mode === 'highlights' ? 'selected' : ''}`} onClick={()=>setOption('mode','highlights')}><Sparkles size={16}/><span><strong>Smart highlights</strong><small>Pick engaging segments</small></span></button><button className={`mode-choice ${settings.mode === 'split' ? 'selected' : ''}`} onClick={()=>setOption('mode','split')}><Scissors size={16}/><span><strong>Split into parts</strong><small>Keep the entire story</small></span></button></div>
            {settings.mode === 'highlights' && <div className="setting-line"><div className="setting-label"><span>Number of clips</span><strong>{settings.count}</strong></div><input className="range" type="range" min={1} max={8} value={settings.count} onChange={e=>setOption('count',Number(e.target.value))}/><div className="range-numbers"><span>1 clip</span><span>8 clips</span></div></div>}
            <div className="field-row"><label><span className="input-label">Clip duration / part size</span><select value={settings.length} onChange={e=>setOption('length',Number(e.target.value))}><option value={15}>15 seconds</option><option value={30}>30 seconds</option><option value={35}>35 seconds</option><option value={45}>45 seconds</option><option value={60}>60 seconds</option><option value={90}>90 seconds</option></select></label><label><span className="input-label">Video quality</span><select value={settings.resolution} onChange={e=>setOption('resolution',e.target.value as Settings['resolution'])}><option value="fast">Fast · 540p</option><option value="hd">HD · 720p</option></select></label></div>
            <span className="input-label">9:16 framing</span><div className="framing-options"><button className={settings.framing === 'crop' ? 'selected' : ''} onClick={()=>setOption('framing','crop')}><MonitorPlay size={15}/> Center crop</button><button className={settings.framing === 'pad' ? 'selected' : ''} onClick={()=>setOption('framing','pad')}><Layers3 size={15}/> Fit with bars</button></div>
          </div><div className="panel enhancements-card"><div className="settings-head"><span className="panel-icon teal"><WandSparkles size={19}/></span><strong>Smart enhancements</strong></div><div className="enhancement-row"><span className="enhancement-icon"><Captions size={20}/></span><div><strong>Burn-in subtitles</strong><p>Sync visible captions from your transcript</p></div><Toggle checked={settings.subtitles} onChange={v=>setOption('subtitles',v)}/></div><div className="enhancement-row"><span className="enhancement-icon"><ShieldCheck size={20}/></span><div><strong>Flag low-potential clips</strong><p>Review clips scoring below 36/100</p></div><Toggle checked={settings.reviewLowScores} onChange={v=>setOption('reviewLowScores',v)}/></div><div className="enhancement-row disabled-feature"><span className="enhancement-icon"><Music2 size={20}/></span><div><strong>Copyright-safe audio</strong><p>Original audio only; no unlicensed music added</p></div><span className="status-tag">SAFE DEFAULT</span></div><div className="callout-soft"><Info size={16}/><span>Highlights use scene-change and transcript heuristics, not a guarantee of viral performance.</span></div></div></div>
          <div className="generate-bar"><div><span className="generate-spark"><Sparkles size={18}/></span><div><strong>Ready to find your best moments?</strong><p>{settings.mode === 'split' ? `Create consecutive ${settings.length}s parts without skipping footage.` : hasTranscript ? 'Analyze visuals and dialogue for more useful suggestions.' : 'Scan visual activity now; add a transcript to improve ranking.'}</p></div></div><button className="btn primary big" disabled={!file || !duration || busy} onClick={settings.mode === 'split' ? generate : analyze}>{busy ? <LoaderCircle className="spin" size={18}/> : <Zap size={18} fill="currentColor"/>}{busy ? 'Processing…' : settings.mode === 'split' ? 'Split into parts' : 'Generate smart clips'}<ArrowRight size={18}/></button></div>
        </>}

        {view === 'clips' && <><div className="page-header"><div><span className="eyebrow">YOUR CREATIONS</span><h1>Ready to make an impact<span className="purple-text">.</span></h1><p>Fine-tune, caption, and export your strongest moments.</p></div><div className="page-header-actions"><button className="btn outline" onClick={()=>setView('studio')}><ChevronLeft size={16}/> Back to studio</button><button className="btn outline" disabled={!accepted.length} onClick={exportManifest}><FileText size={16}/> Manifest</button><button className="btn primary" disabled={!accepted.length || busy || !file} onClick={exportAll}><Download size={17}/> Export {accepted.length ? `${accepted.length} ` : ''}as ZIP</button></div></div>
          {clips.length ? <><div className="stat-cards"><div className="stat-card"><div className="stat-icon purple"><Film size={19}/></div><div><span>Clips generated</span><strong>{clips.length}</strong></div></div><div className="stat-card"><div className="stat-icon teal"><TrendingUp size={19}/></div><div><span>Highest heuristic score</span><strong>{Math.max(...clips.map(c=>c.score))}<small>/100</small></strong></div></div><div className="stat-card"><div className="stat-icon orange"><Captions size={19}/></div><div><span>Subtitle availability</span><strong className="stat-text">{hasTranscript ? 'Transcript ready' : 'Add transcript'}</strong></div></div><div className="stat-card"><div className="stat-icon blue"><Clock3 size={19}/></div><div><span>Combined runtime</span><strong>{clock(clips.reduce((sum,c)=>sum+c.end-c.start,0))}</strong></div></div></div>
          {flagged > 0 && settings.reviewLowScores && <div className="review-alert"><div><Info size={19}/><span><strong>{flagged} clip{flagged!==1?'s':''} flagged for review.</strong> Lower activity or fewer verbal hooks were detected. This is not a reliable prediction of performance.</span></div><button className="text-action" onClick={()=>setShowLow(x=>!x)}>{showLow ? 'Hide from batch export' : 'Include in batch export'} <ArrowRight size={15}/></button></div>}
          <div className="clips-layout"><div className="panel clips-list"><div className="list-header"><div><strong>Generated clips</strong><span>{clips.length} suggestions</span></div><button title="Regenerate" onClick={generate}><RotateCcw size={16}/></button></div><div className="clip-scroll">{clips.map((c, i)=><button key={c.id} onClick={()=>seekTo(c)} className={`clip-row ${selected?.id === c.id ? 'selected' : ''}`}><div className="clip-index"><Play size={13} fill="currentColor"/></div><div className="clip-row-data"><strong>{c.headline}</strong><span><Clock3 size={12}/>{clock(c.start)}–{clock(c.end)} · {clock(c.end-c.start)}</span></div><span className={`score-pill ${scoreClass(c.score)}`}>{c.score}</span></button>)}</div><div className="list-footer"><Sparkles size={14}/> Scores are heuristics, not probabilities.</div></div>
          {selected && <div className="editor-column"><div className="panel preview-editor"><div className="editor-title"><div><span className="eyebrow">CLIP PREVIEW</span><h3>Preview & edit</h3></div><span className={`score-pill ${scoreClass(selected.score)}`}><TrendingUp size={13}/>{selected.score}/100</span></div><div className="editor-preview"><video ref={videoRef} src={videoUrl} controls playsInline onTimeUpdate={e=>{if(e.currentTarget.currentTime >= selected.end && !e.currentTarget.paused) e.currentTarget.pause()}}/><div className="preview-caption-placeholder">{settings.subtitles && hasTranscript ? <span>Subtitles will be burned into your exported MP4</span> : null}</div></div><div className="editor-timings"><label><span>Start (seconds)</span><input type="number" min={0} max={Math.max(0, selected.end-0.5)} step={0.1} value={selected.start} onChange={e=>updateClip(selected.id,{start:Math.max(0,Math.min(Number(e.target.value),selected.end-.5))})}/></label><span className="time-divider">→</span><label><span>End (seconds)</span><input type="number" min={selected.start+0.5} max={duration} step={0.1} value={selected.end} onChange={e=>updateClip(selected.id,{end:Math.min(duration,Math.max(Number(e.target.value),selected.start+.5))})}/></label><div className="duration-pill">{clock(selected.end - selected.start)}</div></div><div className="reason"><Sparkles size={15}/><span>{selected.reason}</span></div></div>
          <div className="panel copy-editor"><div className="copy-heading"><strong><FileText size={17}/> Upload copy</strong><button className="text-action" disabled={busy || !hasTranscript} onClick={()=>useAiCopy(selected)}><WandSparkles size={15}/> AI rewrite</button></div><label className="input-label" htmlFor="clip-title">Title / hook</label><div className="copy-input"><input id="clip-title" value={selected.headline} maxLength={100} onChange={e=>updateClip(selected.id,{headline:e.target.value})}/><button aria-label="Copy title" onClick={()=>copy(selected.headline,'Title')}>{copyIndicator === 'Title' ? <Check size={16}/> : <Copy size={16}/>}</button></div><label className="input-label" htmlFor="clip-caption">Platform caption</label><div className="copy-textarea"><textarea id="clip-caption" rows={5} value={selected.caption} onChange={e=>updateClip(selected.id,{caption:e.target.value})}/><button onClick={()=>copy(selected.caption,'Caption')}><Copy size={14}/> Copy caption</button></div><div className="copy-actions"><button className="btn outline" onClick={()=>download(clipSrt(liveClip(selected)),`${safeName(selected.headline)}.srt`)}><Captions size={15}/> Download SRT</button><button className="btn outline" onClick={()=>{setScheduleClip(selected);setView('planner')}}><CalendarClock size={15}/> Add to planner</button><button className="btn primary" disabled={busy || !file} onClick={()=>exportSelected(selected)}><Download size={16}/> Export MP4</button></div></div></div>}</div>
          </> : <div className="empty-state panel"><div className="empty-icon"><Clapperboard size={28}/></div><h2>No clips yet</h2><p>Import a source video, choose a mode, and generate your first batch of clips.</p><button className="btn primary" onClick={()=>setView('studio')}>Go to studio <ArrowRight size={16}/></button></div>}
        </>}

        {view === 'planner' && <><div className="page-header"><div><span className="eyebrow">PLAN AHEAD</span><h1>Your content calendar<span className="purple-text">.</span></h1><p>Keep track of what to post, where, and when.</p></div><button className="btn outline" onClick={()=>setView('clips')}><Plus size={16}/> Add from clips</button></div><div className="notice-banner"><CalendarClock size={19}/><div><strong>Manual reminder planner</strong><p>This is a local planning tool, not background auto-posting. Download an .ics reminder, then upload the exported MP4 yourself. Nothing happens when this page is closed.</p></div></div>
          {scheduleClip && <div className="panel schedule-form"><div className="schedule-heading"><div><span className="eyebrow">SCHEDULE A REMINDER</span><h3>{scheduleClip.headline}</h3></div><button className="close-small" onClick={()=>setScheduleClip(null)}>✕</button></div><div className="field-row"><label><span className="input-label">Platform</span><select value={schedulePlatform} onChange={e=>setSchedulePlatform(e.target.value as Platform)}><option>YouTube</option><option>TikTok</option><option>Instagram</option></select></label><label><span className="input-label">When to post (your timezone)</span><input type="datetime-local" value={scheduleDate} onChange={e=>setScheduleDate(e.target.value)}/></label></div><button className="btn primary" onClick={addPlan}><CalendarClock size={16}/> Add reminder</button></div>}
          <div className="planner-layout"><div className="panel planner-main"><div className="list-header"><div><strong>Upcoming posts</strong><span>{plans.length} planned</span></div><CalendarClock size={17}/></div>{plans.length ? plans.map(p=><div className="planned-row" key={p.id}><div className="planned-date"><strong>{new Date(p.date).getDate()}</strong><span>{new Date(p.date).toLocaleString(undefined,{month:'short'})}</span></div><div className="planned-info"><strong>{p.title}</strong><div><span>{p.platform}</span><span>·</span><span>{new Date(p.date).toLocaleString(undefined,{weekday:'short',hour:'numeric',minute:'2-digit'})}</span></div><small>{p.filename}</small></div><div className="plan-tools"><button title="Copy post text" onClick={()=>copy(`${p.title}\n\n${p.caption}`,'Post text')}><Copy size={17}/></button><button title="Download calendar reminder" onClick={()=>download(toIcs(p),`${safeName(p.title)}.ics`,'text/calendar')}><CalendarClock size={17}/></button><a title={`Open ${p.platform} uploader`} href={platformUrls[p.platform]} target="_blank" rel="noreferrer"><ExternalLink size={17}/></a><button title="Delete reminder" onClick={()=>setPlans(x=>x.filter(y=>y.id!==p.id))}><Trash2 size={17}/></button></div></div>) : <div className="planner-empty"><CalendarClock size={32}/><h3>No posts planned yet</h3><p>Open My clips, choose a clip, then add it to the content planner.</p><button className="btn outline" onClick={()=>setView('clips')}>Browse clips <ArrowRight size={15}/></button></div>}</div><div className="panel planner-sidebar"><div className="settings-head"><span className="panel-icon teal"><TrendingUp size={18}/></span><strong>Posting checklist</strong></div><div className="checklist-item"><CheckCircle2 size={17}/> Export your final MP4</div><div className="checklist-item"><CheckCircle2 size={17}/> Check subtitles & audio</div><div className="checklist-item"><CheckCircle2 size={17}/> Verify rights and consent</div><div className="checklist-item"><CheckCircle2 size={17}/> Adapt your caption per platform</div><div className="checklist-item"><CheckCircle2 size={17}/> Use original / licensed music</div><div className="fine-print-block">Publishing APIs need developer registration, OAuth, secure token handling, and sometimes platform approval.</div></div></div>
        </>}

        {view === 'channels' && <><div className="page-header"><div><span className="eyebrow">DISTRIBUTE EVERYWHERE</span><h1>Publishing channels<span className="purple-text">.</span></h1><p>Export once, publish on the platforms that matter to you.</p></div></div><div className="notice-banner"><ShieldCheck size={20}/><div><strong>Account security comes first</strong><p>ClipForge only supports optional short-lived Google authorization for direct YouTube uploads (with your own developer app). TikTok and Instagram remain manual; we never store OAuth access tokens.</p></div></div><div className="channel-grid"><Channel icon={Youtube} name="YouTube Shorts" color="youtube" url={platformUrls.YouTube} text="Upload from YouTube Studio. Set title, description, thumbnail and visibility."/><Channel icon={Music2} name="TikTok" color="tiktok" url={platformUrls.TikTok} text="Use the official TikTok uploader and select your audience and music rights."/><Channel icon={Instagram} name="Instagram Reels" color="instagram" url={platformUrls.Instagram} text="Publish via Instagram. Professional accounts can use eligible official APIs."/></div>
          <div className="panel youtube-direct-panel">
            <div className="youtube-direct-heading"><div className="channel-icon youtube"><Youtube size={24}/></div><div><span className="eyebrow">OPTIONAL INTEGRATION · EXPERIMENTAL</span><h3>Upload to YouTube directly</h3><p>Connect your personal Google Cloud OAuth client and upload a finished video, immediately or with YouTube's native publish scheduling.</p></div></div>
            <div className="youtube-connect-row"><label><span className="input-label">Google OAuth 2.0 Web Client ID (public identifier, not a secret)</span><input value={youtubeClientId} placeholder="123456789-abc123.apps.googleusercontent.com" onChange={e=>setYoutubeClientId(e.target.value)}/></label><button className="btn outline" onClick={connectYoutubeAccount}><Youtube size={15}/>{youtubeAccess && youtubeAccess.expiresAt>Date.now()?'Reconnect YouTube':'Connect YouTube'}</button></div>
            <p className="fine-print"><Info size={13}/> Create a Google Cloud OAuth Web application, enable YouTube Data API v3, add this site's origin to Authorized JavaScript origins and your Google account to consent-screen testers (if testing). Tokens stay in memory, not localStorage. <a className="inline-doc" href="https://developers.google.com/identity/oauth2/web/guides/use-token-model" target="_blank" rel="noreferrer">Setup guide ↗</a></p>
            {youtubeAccess && youtubeAccess.expiresAt>Date.now() && <div className="connected-status"><CheckCircle2 size={15}/> Authorized to request YouTube uploads · session expires automatically</div>}
            <div className="youtube-upload-form">{selected && <button className="btn outline use-clip-copy" onClick={()=>{setYoutubeTitle(selected.headline);setYoutubeCaption(selected.caption);toast('Selected clip title and caption loaded.') }}><Copy size={15}/> Use selected clip title & caption</button>}<label className="yt-file-field"><span className="input-label">Finished video file</span><input type="file" accept="video/mp4,video/webm,video/quicktime,.mp4,.mov" onChange={e=>{const f=e.target.files?.[0]||null;setYoutubeFile(f);setYoutubeUploadUrl('');if(f&&!youtubeTitle)setYoutubeTitle(f.name.replace(/\.[^.]+$/,''))}}/></label><div className="field-row"><label><span className="input-label">YouTube title</span><input maxLength={100} value={youtubeTitle} onChange={e=>setYoutubeTitle(e.target.value)} placeholder="Title for your Short"/></label><label><span className="input-label">Visibility / publish schedule</span><select value={youtubeVisibility} onChange={e=>setYoutubeVisibility(e.target.value as YouTubeVisibility)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public now</option><option value="scheduled">Schedule to go public</option></select></label></div>
            {youtubeVisibility==='scheduled' && <label className="yt-date"><span className="input-label">YouTube publish date & time (your timezone)</span><input type="datetime-local" value={youtubeSchedule} onChange={e=>setYoutubeSchedule(e.target.value)}/></label>}
            <label><span className="input-label">Description / caption</span><textarea rows={4} value={youtubeCaption} onChange={e=>setYoutubeCaption(e.target.value)} placeholder="Description, call to action, hashtags…"/></label>
            <label className="yt-consent"><input type="checkbox" checked={youtubeRights} onChange={e=>setYoutubeRights(e.target.checked)}/> I have rights to publish this video and its original audio, and I have reviewed the metadata.</label>
            <div className="yt-footer"><span>Google/YouTube API quotas and developer eligibility apply. No upload can be guaranteed to remain public.</span><button className="btn primary" disabled={!youtubeAccess || youtubeAccess.expiresAt<=Date.now() || !youtubeFile || !youtubeRights || !youtubeTitle.trim() || busy} onClick={uploadYoutubeFile}><Upload size={16}/>{youtubeVisibility==='scheduled'?'Upload & schedule on YouTube':'Upload to YouTube'}</button></div>
            {youtubeUploadProgress>0 && <div className="yt-progress"><div style={{width:`${youtubeUploadProgress*100}%`}}/></div>}
            {youtubeUploadUrl && <a href={youtubeUploadUrl} target="_blank" rel="noreferrer" className="yt-result"><CheckCircle2 size={15}/> View uploaded video in YouTube <ExternalLink size={14}/></a>}
          </div></div>
          <SectionTitle eyebrow="YOUR WORKFLOW" title="From clip to published post" description="A dependable path to multichannel publishing without unsafe account automation."/><div className="workflow-grid"><div className="panel workflow-card"><span>01</span><div className="workflow-icon"><Scissors size={22}/></div><h3>Create</h3><p>Make 9:16 clips with titles, transcripts and optional burned-in captions.</p></div><div className="panel workflow-card"><span>02</span><div className="workflow-icon"><Download size={22}/></div><h3>Export</h3><p>Save H.264/AAC MP4s, sidecar SRT files, and an upload manifest.</p></div><div className="panel workflow-card"><span>03</span><div className="workflow-icon"><CalendarClock size={22}/></div><h3>Plan & post</h3><p>Create calendar reminders and manually publish via official platform tools.</p></div></div></>}

        {view === 'guide' && <><div className="page-header"><div><span className="eyebrow">KNOW BEFORE YOU CREATE</span><h1>Build a better workflow<span className="purple-text">.</span></h1><p>ClipForge runs on your own hardware — no recurring hosting bill.</p></div></div><div className="guide-grid"><div className="panel guide-card"><span className="panel-icon purple"><Github size={22}/></span><h3>Deploy to GitHub Pages</h3><p>Upload the repository, enable Settings → Pages → GitHub Actions, then push to main. The included workflow builds and deploys the static site.</p><a href="https://docs.github.com/en/pages" target="_blank" rel="noreferrer">GitHub Pages documentation <ExternalLink size={14}/></a></div><div className="panel guide-card"><span className="panel-icon teal"><Headphones size={22}/></span><h3>Free on-device AI</h3><p>Whisper tiny provides English speech transcription. An optional Qwen 0.5B model rewrites titles and captions. Models download from Hugging Face and use your local CPU or GPU.</p><a href="https://huggingface.co/docs/transformers.js" target="_blank" rel="noreferrer">Model documentation <ExternalLink size={14}/></a></div><div className="panel guide-card"><span className="panel-icon orange"><ShieldCheck size={22}/></span><h3>Copyright & safety</h3><p>Only use footage you own or have permission to repurpose. Audio is retained from the source; no sound effects, music, or watermarks are added. Upload acceptance cannot be guaranteed.</p><a href="https://support.google.com/youtube/answer/2797466" target="_blank" rel="noreferrer">Copyright basics <ExternalLink size={14}/></a></div><div className="panel guide-card"><span className="panel-icon blue"><CalendarClock size={22}/></span><h3>What isn't automatic?</h3><p>Direct YouTube downloading and remote processing are not supported. YouTube uploads use optional Google OAuth; TikTok/Instagram remain manual. Use source files and manual platform uploads.</p><a href="https://developers.tiktok.com/products/content-posting-api/" target="_blank" rel="noreferrer">Official TikTok API <ExternalLink size={14}/></a></div></div><div className="panel guide-tips"><div><span className="eyebrow">IDEAS FOR FUTURE VERSIONS</span><h3>Tools worth adding next</h3></div><div className="tips-grid"><div><MousePointer2 size={18}/><strong>Face tracking</strong><span>Reframe active speakers automatically with local computer vision.</span></div><div><Eye size={18}/><strong>Retention testing</strong><span>Compare hooks and opening-frame variants before publishing.</span></div><div><Search size={18}/><strong>Keyword research</strong><span>Use platform trends and your real performance analytics.</span></div><div><BadgeCheck size={18}/><strong>Quality checks</strong><span>Detect clipping, black frames, silent clips, and obscured subtitles.</span></div></div></div></>}
      </div>
    </main>
    {busy && <div className="busy-overlay"><div className="busy-modal"><div className="busy-symbol"><LoaderCircle className="spin" size={30}/></div><h3>Working on your video</h3><p>{activity || 'Preparing…'}</p><div className="busy-track"><div style={{width: `${Math.round(progress*100)}%`}}/></div><small>{progress > 0 ? `${Math.round(progress*100)}%` : 'Processing locally · keep this tab open'}</small></div></div>}
    {message && <div className="toast"><CheckCircle2 size={17}/>{message}</div>}
  </div>
}

function Channel({icon: Icon, name, color, url, text}: {icon: LucideIcon;name: string;color: string;url:string;text:string}) {
  return <div className="panel channel-card"><div className={`channel-icon ${color}`}><Icon size={26}/></div><div className="channel-status"><span className="grey-dot"/> MANUAL EXPORT</div><h3>{name}</h3><p>{text}</p><a href={url} target="_blank" rel="noreferrer" className="btn outline">Open uploader <ExternalLink size={15}/></a></div>
}
