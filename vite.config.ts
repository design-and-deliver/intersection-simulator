import { defineConfig } from 'vite';

// GitHub Pages serves at /<repo-name>/, so assets need a base path that matches.
// Local dev (pnpm dev) uses the default '/' because BASE_PATH is unset there.
const base = process.env['BASE_PATH'] ?? '/';

export default defineConfig({
  root: '.',
  base,
  server: { port: 5173, strictPort: false },
  build: { target: 'es2022' },
});
