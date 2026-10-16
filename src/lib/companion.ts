/** Local companion: the static GitHub Pages app never runs server-side code. */
const BASE = 'http://127.0.0.1:8765'

interface Job {
  id: string
  status: 'queued' | 'connecting' | 'downloading' | 'processing' | 'ready' | 'error'
  progress: number
  title: string
  error: string
  size?: number
}

async function request(path: string, options?: RequestInit): Promise<Response> {
  const response = await fetch(`${BASE}${path}`, { cache: 'no-store', ...options })
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: `Local importer returned ${response.status}` }))
    throw new Error(error.error || `Local importer returned ${response.status}`)
  }
  return response
}

export async function importYouTube(url: string, onProgress: (status: string, progress: number) => void): Promise<File> {
  try {
    const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(3000), cache: 'no-store' })
    if (!response.ok || (await response.json()).service !== 'clipforge-companion') {
      throw new Error('Local importer is not available.')
    }
  } catch {
    throw new Error('COMPANION_OFFLINE')
  }
  const started = await request('/api/import', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  })
  const { id } = await started.json() as { id: string }
  const deadline = Date.now() + 45 * 60 * 1000
  let job: Job
  do {
    if (Date.now() >= deadline) throw new Error('Import timed out. Restart the local companion and try again.')
    await new Promise(resolve => setTimeout(resolve, 1000))
    const response = await request(`/api/jobs/${id}`)
    job = await response.json() as Job
    onProgress(job.status, job.progress)
    if (job.status === 'error') throw new Error(job.error || 'Could not import that YouTube video.')
  } while (job.status !== 'ready')
  onProgress('transferring', 0.98)
  const video = await request(`/api/jobs/${id}/video`)
  const blob = await video.blob()
  if (!blob.size) throw new Error('The importer returned an empty video.')
  return new File([blob], `youtube-${id.slice(0, 8)}.mp4`, { type: 'video/mp4' })
}
