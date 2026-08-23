import { defineConfig } from 'vite';

export default defineConfig({
  // itch.io serves HTML5 uploads from a generated subdirectory/iframe URL.
  // Never emit root-absolute /assets URLs; every bundle reference must stay
  // relative to the uploaded index.html.
  base: './',
  build: {
    assetsDir: 'assets',
    emptyOutDir: true,
    sourcemap: false
  },
  server: {
    host: true,
    port: 5173
  }
});
