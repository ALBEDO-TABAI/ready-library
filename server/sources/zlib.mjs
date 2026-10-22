// Z-Library through heartleo/zlib (github.com/heartleo/zlib), the CLI you install and log in to yourself.
// We only ever run its non-interactive JSON commands, with arguments passed as an array (never through a
// shell), and branch on its documented exit codes: 3 = not logged in, 4 = network / mirror, 130 = cancelled.
import { spawn } from 'node:child_process';
import * as jobs from '../jobs.mjs';

const BIN = process.env.ZLIB_BIN || 'zlib';

function run(args, { timeout = 60_000, onErr } = {}) {
  return new Promise((resolve) => {
    let out = '', err = '';
    let child;
    try {
      child = spawn(BIN, args, { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, NO_COLOR: '1' } });
    } catch (e) {
      return resolve({ code: -1, out, err: e.message, missing: true });
    }
    const t = setTimeout(() => child.kill('SIGTERM'), timeout);
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => { err += d; onErr?.(String(d)); });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, out, err: e.message, missing: e.code === 'ENOENT' }); });
    child.on('close', (code) => { clearTimeout(t); resolve({ code, out, err }); });
  });
}

const reason = (r) =>
  r.missing ? '没有找到 zlib 命令行工具' :
  r.code === 3 ? '还没有登录 Z-Library（在终端运行 zlib login）' :
  r.code === 4 ? '连不上 Z-Library 镜像（在终端运行 zlib doctor 找可用域名）' :
  (r.err.trim().split('\n').pop() || `zlib 退出码 ${r.code}`);

let cached = null, cachedAt = 0;
/** Installed? Logged in? Cached for a minute, since `profile` is a network call. */
export async function status(force = false) {
  if (cached && !force && Date.now() - cachedAt < 60_000) return cached;
  const v = await run(['version'], { timeout: 8000 });
  if (v.code !== 0) {
    cached = { installed: false, loggedIn: false, error: reason(v) };
  } else {
    const version = v.out.trim().split('\n')[0];
    const p = await run(['profile', '--json'], { timeout: 20_000 });
    let quota = null;
    if (p.code === 0) {
      try {
        const j = JSON.parse(p.out);
        if (j.quota_known) quota = { remaining: j.daily_remaining, allowed: j.daily_allowed, reset: j.daily_reset };
      } catch {}
    }
    cached = { installed: true, version, loggedIn: p.code === 0, quota, error: p.code === 0 ? '' : reason(p) };
  }
  cachedAt = Date.now();
  return cached;
}

const yearOf = (y) => (Number(y) > 1000 ? Number(y) : undefined);
/** One result as the page sees it; `ref` is the full id:hash that `download` takes. */
const shape = (b) => ({
  id: 'zl:' + b.id,
  ref: b.id,
  title: b.name,
  author: (b.authors ?? []).join(' / '),
  year: yearOf(b.year),
  publisher: b.publisher || '',
  language: b.language || '',
  ext: (b.extension || '').toLowerCase(),
  size: b.size || '',
  cover: b.cover || '',
  description: b.description || '',
  isbn: b.isbn_13 || b.isbn || '',
  pages: b.pages || '',
  categories: b.categories || '',
  rating: b.rating || '',
  url: b.url || '',
});

export async function search({ q, page = 1, ext = '', lang = '' }) {
  const args = ['search', q, '--json', '--count', '24', '--page', String(page)];
  for (const e of ext.split(',').filter(Boolean)) args.push('--ext', e);
  for (const l of lang.split(',').filter(Boolean)) args.push('--language', l);
  const r = await run(args, { timeout: 45_000 });
  if (r.code !== 0) { if (r.code === 3) cached = null; throw Object.assign(new Error(reason(r)), { code: r.code }); }
  const j = JSON.parse(r.out);
  return { books: (j.books ?? []).map(shape), page: j.page ?? page, pages: j.total_pages ?? 1 };
}

export async function feed(kind) {
  const r = await run([kind === 'recommended' ? 'recommended' : 'most-popular', '--json'], { timeout: 45_000 });
  if (r.code !== 0) throw Object.assign(new Error(reason(r)), { code: r.code });
  const j = JSON.parse(r.out);
  return { books: (Array.isArray(j) ? j : j.books ?? []).map(shape) };
}

/* ---------- downloads run as jobs the page polls ---------- */
export function download(ref, dir, { title, attach } = {}, onDone) {
  const j = jobs.create({ src: 'zlib', ref, title, attach, line: '开始下载…' });
  run(['download', ref, '--dir', dir, '--json'], {
    timeout: 30 * 60_000,
    onErr: (s) => {
      for (const line of s.split('\n')) {
        const m = line.match(/(\d+)%/);
        if (m) j.pct = Math.max(j.pct, Number(m[1]));
        if (line.trim()) j.line = line.trim();
      }
    },
  }).then(async (r) => {
    if (r.code !== 0) return jobs.finish(j, { state: 'error', error: reason(r) });
    try {
      const result = JSON.parse(r.out.trim().split('\n').pop());
      jobs.finish(j, { pct: 100, book: await onDone(result), state: 'done' });
    } catch (e) {
      jobs.finish(j, { state: 'error', error: e.message });
    }
  });
  return j;
}
