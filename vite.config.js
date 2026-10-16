import { defineConfig } from 'vite';
export default defineConfig({
  // Custom domain at the site root: https://golf-card-game.app.imkyu.com/
  base: '/',
  server: { host: '0.0.0.0', port: 5173 },
  preview: { host: '0.0.0.0', port: 5173, allowedHosts: ['.trycloudflare.com', 'localhost'] },
  build: { chunkSizeWarningLimit: 900 },
});
