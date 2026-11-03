import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// base './' makes the build work from any sub-path (GitHub Pages, /app/ on the CRM, a CDN).
export default defineConfig({
  plugins: [react()],
  base: './',
  server: { port: 5173 },
  build: { outDir: 'dist', sourcemap: false, chunkSizeWarningLimit: 900 },
});
