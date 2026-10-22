// `npm start`: the built app (dist/) and the API on one local port. Listens on 127.0.0.1 only —
// the library, your files and your zlib session stay on this machine.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, normalize } from 'node:path';
import { handle } from './api.mjs';
import { DATA } from './db.mjs';

const DIST = join(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 5190);
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon' };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first (or `npm run dev` while developing).');
  process.exit(1);
}

createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handle(req, res);
  let p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^(\.\.[/\\])+/, '');
  let f = join(DIST, p);
  if (!f.startsWith(DIST) || !existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': f.includes('/assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(f).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`Ready Library → http://${HOST}:${PORT}`);
  console.log(`library folder: ${DATA}`);
});
