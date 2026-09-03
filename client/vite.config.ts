import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
  },
  optimizeDeps: {
    // The shared workspace package ships CommonJS output; Vite doesn't
    // pre-bundle symlinked monorepo packages by default, so without this its
    // named exports (e.g. detectGarmentType) fail to resolve as ESM imports.
    include: ['@ai-agent-storefront/shared'],
  },
});
