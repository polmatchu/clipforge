import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Relative base works on localhost, custom domains, and /repo-name/ GitHub Pages URLs.
export default defineConfig({
  plugins: [react()],
  base: './',
  optimizeDeps: { exclude: ['@ffmpeg/ffmpeg', '@huggingface/transformers'] },
  build: { target: 'esnext', chunkSizeWarningLimit: 3000 },
})
