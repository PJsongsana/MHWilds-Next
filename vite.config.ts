import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
// @ts-expect-error plain JS module
import { startBridge } from './bridge/server.js';

// `npm run dev` also starts the bridge, so one command connects UI ↔ game. BRIDGE=off to skip.
const bridge = (): Plugin => ({
  name: 'hunt-bridge',
  apply: 'serve',
  configureServer() {
    if (process.env.BRIDGE !== 'off' && !process.env.VITEST) startBridge();
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), bridge()],
  server: { host: '127.0.0.1', port: 5173 },
});
