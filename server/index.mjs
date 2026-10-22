// `npm start`: the built app (dist/) and the API on one local port. Listens on 127.0.0.1 only —
// the library, your files and your zlib session stay on this machine.
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { join, extname, resolve, relative, isAbsolute } from 'node:path';
import { handle } from './api.mjs';
import { DATA } from './db.mjs';
import { openPath } from './platform.mjs';

const DIST = join(import.meta.dirname, '..', 'dist');
const PORT = Number(process.env.PORT || 5190);
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.wasm': 'application/wasm', '.css': 'text/css', '.svg': 'image/svg+xml', '.woff2': 'font/woff2', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json', '.ico': 'image/x-icon' };

if (!existsSync(join(DIST, 'index.html'))) {
  console.error('dist/ is missing — run `npm run build` first (or `npm run dev` while developing).');
  process.exit(1);
}

const server = createServer((req, res) => {
  if (req.url.startsWith('/api/')) return handle(req, res);
  let p;
  try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); }
  catch { res.writeHead(400); return res.end('Bad URL'); }
  let f = resolve(DIST, '.' + p);
  const rel = relative(DIST, f);
  if (rel.startsWith('..') || isAbsolute(rel) || p.includes('\\') || p.includes('\0')) { res.writeHead(403); return res.end('Forbidden'); }
  if (!existsSync(f) || statSync(f).isDirectory()) f = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': MIME[extname(f)] || 'application/octet-stream', 'cache-control': relative(DIST, f).replaceAll('\\', '/').startsWith('assets/') ? 'public, max-age=31536000, immutable' : 'no-cache' });
  createReadStream(f).pipe(res);
}).listen(PORT, HOST, () => {
  console.log(`Ready Library → http://${HOST}:${server.address().port}`);
  console.log(`library folder: ${DATA}`);
  if (process.argv.includes('--open')) openPath(`http://${HOST}:${server.address().port}`).catch((e) => console.error(e.message));
}).on('error', (e) => {
  console.error(e.code === 'EADDRINUSE' ? `端口 ${PORT} 已被占用。若书架已经打开，请使用原窗口；否则设置 PORT 后重试。` : e.message);
  process.exitCode = 1;
});
