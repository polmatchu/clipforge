import { pipeline } from '@huggingface/transformers'

let transcriber: any = null
self.onmessage = async (event: MessageEvent<{ id: number; audio: Float32Array; language: 'en' | 'auto' }>) => {
  const { id, audio, language } = event.data
  try {
    if (!transcriber) {
      self.postMessage({ id, kind: 'status', message: 'Downloading free Whisper model (first use only)…' })
      const gpu = typeof navigator !== 'undefined' && 'gpu' in navigator
      transcriber = await pipeline('automatic-speech-recognition',
        language === 'en' ? 'onnx-community/whisper-tiny.en' : 'onnx-community/whisper-tiny',
        { device: gpu ? 'webgpu' : 'wasm' })
    }
    self.postMessage({ id, kind: 'status', message: 'Transcribing on your device…' })
    const result = await (transcriber as any)(audio, {
      return_timestamps: true,
      chunk_length_s: 25,
      stride_length_s: 5,
    }) as { text: string; chunks?: Array<{ text: string; timestamp: [number, number | null] }> }
    const chunks = (result.chunks || []).map(c => ({
      start: Number(c.timestamp[0]) || 0,
      end: Number(c.timestamp[1]) || Number(c.timestamp[0]) + 3 || 3,
      text: c.text.trim(),
    })).filter(c => c.text && c.end > c.start)
    self.postMessage({ id, kind: 'done', chunks, text: result.text })
  } catch (err) {
    self.postMessage({ id, kind: 'error', message: err instanceof Error ? err.message : String(err) })
  }
}
