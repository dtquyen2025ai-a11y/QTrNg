// Bản dùng thử offline (một trang, không cần máy chủ): VITE_DEMO=1 vite build -c vite.demo.config.ts
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

export default defineConfig({
  root: 'client',
  publicDir: false,
  base: './',
  build: {
    outDir: '../dist-demo',
    emptyOutDir: true,
    chunkSizeWarningLimit: 2000,
    assetsInlineLimit: 1_000_000,
    rollupOptions: {
      input: resolve(import.meta.dirname, 'client/index.html'),
      output: { inlineDynamicImports: true },
    },
  },
});
