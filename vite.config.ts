import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// LightBridge frontend build. Served to the Tauri webview only.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'chrome120',
    sourcemap: false,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
