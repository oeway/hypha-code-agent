import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    port: 3000,
    open: true,
    fs: {
      strict: false  // Allow serving files from outside root
    }
  },
  build: {
    outDir: 'dist',
    sourcemap: true,
    rollupOptions: {
      output: {
        manualChunks: undefined
      }
    }
  },
  optimizeDeps: {
    exclude: ['web-python-kernel']  // Don't optimize web-python-kernel to preserve worker URLs
  },
  worker: {
    format: 'es'  // Use ES module format for workers
  }
});
