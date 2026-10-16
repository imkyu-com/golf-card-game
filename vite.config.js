import { defineConfig } from 'vite';
export default defineConfig({
  // Project site on GitHub Pages: https://kenysai.github.io/golf-card-game/
  base: '/golf-card-game/',
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: ['.trycloudflare.com', 'localhost'] },
  build: { chunkSizeWarningLimit: 900 },
});
