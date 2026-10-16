export type Mode = 'highlights' | 'split'
export type Framing = 'crop' | 'pad'
export type Platform = 'YouTube' | 'TikTok' | 'Instagram'
export type View = 'studio' | 'clips' | 'planner' | 'channels' | 'guide'
export interface CaptionChunk { start: number; end: number; text: string }
export interface Sample { time: number; motion: number }
export interface Clip {
  id: string
  start: number
  end: number
  score: number
  headline: string
  caption: string
  reason: string
  segments: CaptionChunk[]
}
export interface Plan {
  id: string
  clipId: string
  title: string
  caption: string
  platform: Platform
  date: string
  filename: string
}
export interface Settings {
  mode: Mode
  count: number
  length: number
  subtitles: boolean
  framing: Framing
  resolution: 'fast' | 'hd'
  reviewLowScores: boolean
}
export const defaults: Settings = {
  mode: 'highlights', count: 4, length: 35, subtitles: true,
  framing: 'crop', resolution: 'fast', reviewLowScores: true,
}
