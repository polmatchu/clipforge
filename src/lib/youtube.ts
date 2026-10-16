/** Official Google Identity Services OAuth token model + YouTube Data API v3.
 * No refresh tokens, client secrets, or passwords are stored in the browser.
 * The user supplies their own public OAuth WEB client ID with the GitHub Pages origin whitelisted.
 */
export interface GoogleAccess { token: string; expiresAt: number }
export type YouTubeVisibility = 'public' | 'unlisted' | 'private' | 'scheduled'

export function connectYouTube(clientId: string): Promise<GoogleAccess> {
  const google = (window as any).google
  if (!google?.accounts?.oauth2?.initTokenClient) {
    return Promise.reject(new Error('Google OAuth library is not loaded. Check your connection, then reload the page.'))
  }
  if (!/^\d+[-a-zA-Z0-9_]+\.apps\.googleusercontent\.com$/.test(clientId.trim())) {
    return Promise.reject(new Error('Enter a Google OAuth 2.0 Web application client ID, not a client secret.'))
  }
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: clientId.trim(),
      scope: 'https://www.googleapis.com/auth/youtube.upload',
      callback: (r: { access_token?: string; expires_in?: number; error?: string; error_description?: string }) => {
        if (r.error || !r.access_token) return reject(new Error(r.error_description || r.error || 'Google authorization was not completed.'))
        resolve({ token: r.access_token, expiresAt: Date.now() + (Number(r.expires_in) || 3500) * 1000 })
      },
      error_callback: (r: { type?: string }) => reject(new Error(`OAuth dialog failed: ${r.type || 'unknown'}`)),
    })
    // Initiated by the real button click to satisfy OAuth popup gesture requirements.
    client.requestAccessToken({ prompt: 'consent' })
  })
}

export async function uploadYouTube(
  file: File,
  access: GoogleAccess,
  data: { title: string; description: string; visibility: YouTubeVisibility; scheduledAt?: string },
  onProgress?: (n: number) => void,
): Promise<string> {
  if (Date.now() > access.expiresAt - 60_000) throw new Error('Your YouTube session has expired. Connect again before uploading.')
  if (!file.type.startsWith('video/') && !/\.(mp4|mov|webm)$/i.test(file.name)) throw new Error('Please select an exported video file.')
  const title = data.title.trim()
  if (!title || title.length > 100) throw new Error('YouTube titles must be between 1 and 100 characters.')
  let publishAt: string | undefined
  if (data.visibility === 'scheduled') {
    const dt = data.scheduledAt ? new Date(data.scheduledAt) : null
    if (!dt || !Number.isFinite(dt.getTime()) || dt.getTime() < Date.now() + 60000) {
      throw new Error('Choose a scheduled time at least one minute in the future.')
    }
    publishAt = dt.toISOString()
  }
  const body = {
    snippet: { title, description: data.description.trim(), categoryId: '22' },
    status: {
      privacyStatus: data.visibility === 'scheduled' ? 'private' : data.visibility,
      selfDeclaredMadeForKids: false,
      ...(publishAt ? { publishAt } : {}),
    },
  }
  // Step 1: create resumable upload. Do not set forbidden Content-Length header from JS.
  const response = await fetch('https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${access.token}`,
      'Content-Type': 'application/json; charset=UTF-8',
      'X-Upload-Content-Length': String(file.size),
      'X-Upload-Content-Type': file.type || 'video/mp4',
    },
    body: JSON.stringify(body),
  })
  if (!response.ok) {
    const message = await response.text()
    throw new Error(`YouTube rejected upload initialization (${response.status}): ${message.slice(0, 300)}`)
  }
  const location = response.headers.get('Location')
  if (!location || !location.startsWith('https://www.googleapis.com/')) {
    throw new Error('The YouTube resumable session Location header was not available. Check browser CORS restrictions and your Google Cloud configuration.')
  }
  // Step 2: stream the actual media with a same-origin XHR request to Google's upload URL.
  // Note: XHR progress reports upload bytes; YouTube processing/transcoding continues afterward.
  const id = await new Promise<string>((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('PUT', location)
    xhr.setRequestHeader('Authorization', `Bearer ${access.token}`)
    xhr.setRequestHeader('Content-Type', file.type || 'video/mp4')
    xhr.upload.onprogress = event => { if (event.lengthComputable) onProgress?.(event.loaded / event.total) }
    xhr.onerror = () => reject(new Error('Network error during YouTube video upload. Check YouTube Studio before retrying to avoid duplicates.'))
    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) return reject(new Error(`YouTube returned HTTP ${xhr.status}: ${xhr.responseText.slice(0, 300)}`))
      try {
        const data = JSON.parse(xhr.responseText) as { id?: string }
        if (!data.id) throw new Error('No YouTube video ID was returned')
        resolve(data.id)
      } catch(e) { reject(e) }
    }
    xhr.send(file)
  })
  onProgress?.(1)
  return `https://www.youtube.com/watch?v=${encodeURIComponent(id)}`
}
