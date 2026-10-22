import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

/** The local API (server/api.mjs) mounted on the dev server, so `npm run dev` is the whole app. */
function api(): Plugin {
  return {
    name: 'ready-library-api',
    async configureServer(server) {
      // @ts-expect-error plain ESM module without types
      const { handle } = await import('./server/api.mjs');
      server.middlewares.use((req, res, next) => (req.url?.startsWith('/api/') ? handle(req, res) : next()));
    },
  };
}

export default defineConfig({
  plugins: [react(), api()],
  server: { host: '127.0.0.1', port: 5190 },
});
