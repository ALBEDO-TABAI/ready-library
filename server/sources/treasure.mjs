// ebook-treasure-chest (github.com/jbiaojerry/ebook-treasure-chest): ~24k Chinese ebooks, each a title,
// an author, a category and a CTFile share link with EPUB / MOBI / AZW3 inside. The index is one JSON file;
// it is fetched once from the first mirror that answers, kept in data/cache, and searched here in memory.
import { readFileSync, writeFileSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE } from '../db.mjs';

const FILE = join(CACHE, 'treasure-all-books.json');
const MIRRORS = [
  'https://jbiaojerry.github.io/ebook-treasure-chest/all-books.json',
  'https://cdn.jsdelivr.net/gh/jbiaojerry/ebook-treasure-chest@main/docs/all-books.json',
  'https://raw.githubusercontent.com/jbiaojerry/ebook-treasure-chest/main/docs/all-books.json',
];

let index = null; // { books, byCat, updatedAt, from }
let loading = null;
let lastError = '';

/** Full-width → half-width, lower case, no spaces or the separators authors are written with. */
export const norm = (s = '') =>
  s.normalize('NFKC').toLowerCase().replace(/[\s·・•．.,，、:：;；'"“”‘’《》〈〉<>()（）[\]【】{}「」『』!?！？\-—_/\\|]+/g, '');

function build(raw, from, updatedAt) {
  const byLink = new Map();
  for (const r of raw) {
    if (!r || !r.title || !r.link) continue;
    const hit = byLink.get(r.link);
    if (hit) {
      if (r.category && !hit.cats.includes(r.category)) hit.cats.push(r.category);
      continue;
    }
    byLink.set(r.link, {
      id: 'tc:' + (r.link.match(/\/f\/([\w-]+)/)?.[1] ?? byLink.size),
      title: String(r.title).trim(),
      author: String(r.author || '').trim(),
      cats: r.category ? [r.category] : [],
      link: r.link,
      formats: Array.isArray(r.formats) && r.formats.length ? r.formats : ['epub', 'mobi', 'azw3'],
      language: r.language || 'ZH',
    });
  }
  const books = [...byLink.values()];
  for (const b of books) {
    b._t = norm(b.title);
    b._a = norm(b.author);
    b._c = b.cats.map(norm).join(' ');
  }
  const byCat = new Map();
  for (const b of books) for (const c of b.cats) byCat.set(c, (byCat.get(c) ?? 0) + 1);
  return { books, byCat, updatedAt, from };
}

async function download() {
  const errs = [];
  for (const url of MIRRORS) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(45_000), headers: { 'user-agent': 'ready-library' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const raw = JSON.parse(text);
      if (!Array.isArray(raw) || raw.length < 100) throw new Error('unexpected index shape');
      writeFileSync(FILE, text);
      return { raw, from: url };
    } catch (e) {
      errs.push(`${new URL(url).host}: ${e.message}`);
    }
  }
  throw new Error('无法下载宝库索引 — ' + errs.join('; '));
}

/** The index, from memory, the disk cache, or the network (in that order). `fresh` skips the cache. */
export function load(fresh = false) {
  if (index && !fresh) return Promise.resolve(index);
  if (loading) return loading;
  loading = (async () => {
    try {
      if (!fresh && existsSync(FILE)) {
        index = build(JSON.parse(readFileSync(FILE, 'utf8')), 'cache', statSync(FILE).mtimeMs);
      } else {
        const { raw, from } = await download();
        index = build(raw, from, Date.now());
      }
      lastError = '';
      return index;
    } catch (e) {
      lastError = e.message;
      throw e;
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function status() {
  return {
    ready: Boolean(index),
    loading: Boolean(loading),
    cached: existsSync(FILE),
    count: index?.books.length ?? 0,
    updatedAt: index?.updatedAt ?? (existsSync(FILE) ? statSync(FILE).mtimeMs : 0),
    error: lastError,
  };
}

export async function categories(limit = 60) {
  const { byCat } = await load();
  return [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([name, count]) => ({ name, count }));
}

const pub = ({ _t, _a, _c, ...b }) => b;

/**
 * Every word must match the title, the author or a category. Exact titles first, then titles that start with
 * the query, then titles that contain it, then author and category matches; shorter titles win ties.
 */
export async function search({ q = '', cat = '', page = 1, size = 30 }) {
  const { books } = await load();
  const words = q.split(/\s+/).map(norm).filter(Boolean);
  const nc = norm(cat);
  const whole = norm(q);
  let hits = [];
  for (const b of books) {
    if (nc && !b.cats.some((c) => norm(c) === nc)) continue;
    if (!words.length) { hits.push([0, b]); continue; }
    let s = 0, ok = true;
    for (const w of words) {
      if (b._t.includes(w)) s += b._t === w ? 100 : b._t.startsWith(w) ? 60 : 40;
      else if (b._a.includes(w)) s += b._a === w ? 50 : 30;
      else if (b._c.includes(w)) s += 10;
      else { ok = false; break; }
    }
    if (!ok) continue;
    if (whole && b._t === whole) s += 200;
    hits.push([s - b.title.length * 0.2, b]);
  }
  hits.sort((a, b) => b[0] - a[0]);
  const total = hits.length;
  hits = hits.slice((page - 1) * size, page * size);
  return { books: hits.map(([, b]) => pub(b)), page, total, pages: Math.max(1, Math.ceil(total / size)) };
}
