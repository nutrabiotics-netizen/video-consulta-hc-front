import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  define: {
    // amazon-chime-sdk-js usa `global` (Node); en el navegador no existe
    global: 'globalThis',
  },
  server: {
    port: 5173,
    proxy: {
      // API puede ir a Vercel; WebSocket NO funciona en Vercel (serverless). En dev, WS a backend local.
      '/api': {
        target: process.env.VITE_DEV_API_TARGET || 'http://localhost:6000',
        changeOrigin: true,
      },
      '/ws': {
        target: process.env.VITE_DEV_WS_TARGET || 'http://localhost:6000',
        ws: true,
      },
    },
  },
});
