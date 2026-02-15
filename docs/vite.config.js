import { resolve } from 'path';
import { defineConfig } from 'vite';
import tailwindcss from '@tailwindcss/vite';

export default defineConfig({
  plugins: [tailwindcss()],
  base: '/the-accurate-syncer/',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        legal: resolve(__dirname, 'legal.html'),
      },
    },
  },
});
