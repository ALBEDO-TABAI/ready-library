// The local API under /api: the library, its files and covers, and the two places to find books.
// Mounted into Vite in development (vite.config.ts) and served by server/index.mjs after a build.
import { createReadStream, createWriteStream, existsSync, statSync, unlinkSync, renameSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { join, basename } from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { FILES, COVERS, CACHE, books, book, addBook, patchBook, removeBook } from './db.mjs';
import { epubMeta, nameMeta, extOf } from './bookmeta.mjs';
import * as treasure from './sources/treasure.mjs';
import * as zlib from './sources/zlib.mjs';
import * as ctfile from './sources/ctfile.mjs';
import * as jobs from './jobs.mjs';
import { workDir, drop, sweep, touch } from './work.mjs';

sweep();

const TYPES = { epub: 'application/epub+zip', pdf: 'application/pdf', txt: 'text/plain; charset=utf-8', mobi: 'application/x-mobipocket-ebook', azw3: 'application/vnd.amazon.ebook', fb2: 'application/x-fictionbook+xml', djvu: 'image/vnd.djvu', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif' };
const READABLE = new Set(['epub', 'pdf', 'txt', 'mobi', 'azw3', 'fb2', 'djvu', 'md']);
const safeId = (s) => /^[A-Za-z0-9]{4,24}$/.test(s);

const send = (res, code, body, type = 'application/json; charset=utf-8') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type.startsWith('application/json') ? JSON.stringify(body) : body);
};
const fail = (res, code, msg) => send(res, code, { error: msg });
async function json(req) {
  let s = '';
  for await (const c of req) { s += c; if (s.length > 2e6) throw new Error('body too large'); }
  return s ? JSON.parse(s) : {};
}

const filePath = (b) => (b?.file ? join(FILES, `${b.id}.${b.file.ext}`) : null);
const coverPath = (id) => {
  for (const e of ['jpg', 'png', 'webp', 'gif']) { const p = join(COVERS, `${id}.${e}`); if (existsSync(p)) return p; }
  return null;
};
function saveCover(id, bytes, type) {
  const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : /gif/.test(type) ? 'gif' : 'jpg';
  const old = coverPath(id); if (old) unlinkSync(old);
  writeFileSync(join(COVERS, `${id}.${ext}`), bytes);
}

async function fetchImage(url) {
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000), headers: { 'user-agent': 'Mozilla/5.0 (ready-library)', accept: 'image/*' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const type = res.headers.get('content-type') || '';
  if (!/^image\//.test(type)) throw new Error('not an image');
  return { bytes: Buffer.from(await res.arrayBuffer()), type };
}

/**
 * A file now in the library folder: read what it says about itself and file it under `rec` (a new book, or the
 * wish-list entry it was fetched for). Metadata the source already gave us (a zlib result) wins over the file's.
 */
function ingest(tmp, name, { attach, meta = {}, retitle = false } = {}) {
  const ext = extOf(name) || 'bin';
  if (!READABLE.has(ext)) { unlinkSync(tmp); throw new Error(`不支持的格式：.${ext}`); }
  /** @type {Record<string, any>} */
  let found = { ...nameMeta(basename(name)) };
  let cover = null;
  if (ext === 'epub') {
    try { const m = epubMeta(readFileSync(tmp)); cover = m.cover; found = { ...found, ...Object.fromEntries(Object.entries(m).filter(([, v]) => v)) }; }
    catch (e) { console.warn('[import] epub metadata:', e.message); }
  }
  const size = statSync(tmp).size;
  let b = attach ? book(attach) : null;
  const fields = {
    title: meta.title || found.title || '未命名',
    author: meta.author || found.author || '',
    year: meta.year || found.year,
    publisher: meta.publisher || found.publisher || '',
    language: meta.language || found.language || '',
    description: meta.description || found.description || '',
    file: { name: basename(name), ext, size },
    status: 'ready',
  };
  if (b) {
    // keep the shelf's own title (the user may have renamed it); only fill what is missing
    patchBook(b.id, { ...fields, title: (!retitle && b.title) || fields.title, author: (!retitle && b.author) || fields.author }, { trusted: true });
  } else {
    b = addBook({ ...fields, source: meta.source || 'local', sourceRef: meta.sourceRef, sourceUrl: meta.sourceUrl, topic: meta.topic, tags: meta.tags?.length ? meta.tags : (found.subjects ?? []) });
  }
  const old = filePath(book(b.id));
  renameSync(tmp, join(FILES, `${b.id}.${ext}`));
  if (old && old !== join(FILES, `${b.id}.${ext}`) && existsSync(old)) unlinkSync(old);
  if (cover && !coverPath(b.id)) { saveCover(b.id, cover.bytes, cover.type); patchBook(b.id, { cover: 'file' }, { trusted: true }); }
  return book(b.id);
}

/** A remote cover becomes the book's own, so the shelf never depends on a mirror being up. */
async function adoptCover(id, url) {
  if (!url || coverPath(id)) return;
  try { const { bytes, type } = await fetchImage(url); saveCover(id, bytes, type); patchBook(id, { cover: 'file' }, { trusted: true }); }
  catch (e) { console.warn('[cover]', url, e.message); }
}

function reveal(p, open) {
  const plat = process.platform;
  const [cmd, args] = plat === 'darwin' ? ['open', open ? [p] : ['-R', p]] : plat === 'win32' ? ['explorer', open ? [p] : ['/select,', p]] : ['xdg-open', [open ? p : join(p, '..')]];
  spawn(cmd, args, { detached: true, stdio: 'ignore' }).unref();
}

function serveFile(req, res, p, type) {
  const size = statSync(p).size;
  const range = req.headers.range?.match(/bytes=(\d*)-(\d*)/);
  if (range) {
    const start = range[1] ? +range[1] : 0, end = range[2] ? Math.min(+range[2], size - 1) : size - 1;
    res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
    return createReadStream(p, { start, end }).pipe(res);
  }
  res.writeHead(200, { 'content-type': type, 'content-length': size, 'accept-ranges': 'bytes', 'cache-control': 'private, max-age=60' });
  createReadStream(p).pipe(res);
}

export async function handle(req, res) {
  const url = new URL(req.url, 'http://local');
  const path = url.pathname.replace(/^\/api/, '');
  const q = Object.fromEntries(url.searchParams);
  const M = req.method;
  try {
    /* ---------- the library ---------- */
    if (path === '/library' && M === 'GET') return send(res, 200, { books: books() });

    let m = path.match(/^\/books\/([^/]+)(\/[a-z]+)?$/);
    if (m) {
      const [, id, sub] = m;
      if (!safeId(id)) return fail(res, 400, 'bad id');
      const b = book(id);
      if (!b) return fail(res, 404, '这本书不在书架上');
      if (!sub && M === 'PATCH') return send(res, 200, { book: patchBook(id, await json(req)) });
      if (!sub && M === 'DELETE') {
        const fp = filePath(b); if (fp && existsSync(fp) && q.keepFile !== '1') unlinkSync(fp);
        const cp = coverPath(id); if (cp) unlinkSync(cp);
        removeBook(id);
        return send(res, 200, { ok: true });
      }
      if (sub === '/file' && M === 'GET') {
        const fp = filePath(b);
        if (!fp || !existsSync(fp)) return fail(res, 404, '还没有这本书的文件');
        return serveFile(req, res, fp, TYPES[b.file.ext] || 'application/octet-stream');
      }
      if (sub === '/cover' && M === 'GET') {
        const cp = coverPath(id);
        if (!cp) return fail(res, 404, 'no cover');
        return serveFile(req, res, cp, TYPES[extOf(cp)] || 'image/jpeg');
      }
      if (sub === '/cover' && M === 'PUT') {
        const chunks = []; for await (const c of req) chunks.push(c);
        saveCover(id, Buffer.concat(chunks), req.headers['content-type'] || 'image/jpeg');
        return send(res, 200, { book: patchBook(id, { cover: 'file' }, { trusted: true }) });
      }
      if (sub === '/reveal' && M === 'POST') {
        const fp = filePath(b);
        if (!fp || !existsSync(fp)) return fail(res, 404, '还没有这本书的文件');
        reveal(fp, q.open === '1');
        return send(res, 200, { ok: true });
      }
    }

    /* A file dropped on the page or picked from disk: the body is the file itself. */
    if (path === '/import' && M === 'PUT') {
      const name = String(q.name || 'book.epub').slice(0, 240);
      if (q.attach && !safeId(q.attach)) return fail(res, 400, 'bad id');
      // the upload lands in its own folder; ingest moves it into the library, and the folder goes either way
      // (an upload cut off halfway, or a file that turns out not to be a book, leaves nothing behind)
      const dir = workDir('import');
      try {
        const tmp = join(dir, 'upload');
        await pipeline(req, createWriteStream(tmp));
        return send(res, 200, { book: ingest(tmp, name, { attach: q.attach }) });
      } finally { drop(dir); }
    }

    /* A search result put on the shelf before its file is here (a wish), or with a cover to fetch. */
    if (path === '/books' && M === 'POST') {
      const r = await json(req);
      const dup = books().find((b) => (r.sourceRef && b.sourceRef === r.sourceRef) || (r.sourceUrl && b.sourceUrl === r.sourceUrl));
      if (dup) return send(res, 200, { book: dup, existed: true });
      const b = addBook({
        title: String(r.title || '未命名').slice(0, 300), author: String(r.author || '').slice(0, 200), year: r.year, publisher: r.publisher || '',
        language: r.language || '', description: String(r.description || '').slice(0, 2000), topic: r.topic, tags: r.tags ?? [], formats: r.formats,
        source: r.source, sourceRef: r.sourceRef, sourceUrl: r.sourceUrl, status: 'wish',
      });
      if (r.cover) await adoptCover(b.id, r.cover);
      return send(res, 200, { book: book(b.id) });
    }

    /* ---------- finding books ---------- */
    if (path === '/sources' && M === 'GET') {
      // warm: read the index from its disk cache now (never from the network), so its size is known and search is quick
      if (q.warm === '1' && treasure.status().cached && !treasure.status().ready) await treasure.load().catch(() => {});
      return send(res, 200, { treasure: treasure.status(), zlib: await zlib.status(q.force === '1') });
    }
    if (path === '/search' && M === 'GET') {
      const page = Math.max(1, Number(q.page) || 1);
      if (q.src === 'zlib') {
        if (!q.q?.trim()) return fail(res, 400, '请输入书名、作者或 ISBN');
        try { return send(res, 200, await zlib.search({ q: q.q.trim(), page, ext: q.ext || '', lang: q.lang || '' })); }
        catch (e) { return fail(res, e.code === 3 ? 401 : 502, e.message); }
      }
      try { return send(res, 200, await treasure.search({ q: q.q || '', cat: q.cat || '', page })); }
      catch (e) { return fail(res, 502, e.message); }
    }
    if (path === '/treasure/categories' && M === 'GET') {
      try { return send(res, 200, { categories: await treasure.categories(Number(q.limit) || 48) }); }
      catch (e) { return fail(res, 502, e.message); }
    }
    if (path === '/treasure/refresh' && M === 'POST') {
      try { await treasure.load(true); return send(res, 200, treasure.status()); }
      catch (e) { return fail(res, 502, e.message); }
    }
    if (path === '/zlib/feed' && M === 'GET') {
      try { return send(res, 200, await zlib.feed(q.kind)); }
      catch (e) { return fail(res, e.code === 3 ? 401 : 502, e.message); }
    }
    if (path === '/zlib/download' && M === 'POST') {
      const r = await json(req);
      if (!/^[\w]+:[\w]+$|^\d+$/.test(String(r.ref || ''))) return fail(res, 400, 'bad zlib reference');
      if (r.attach && !safeId(r.attach)) return fail(res, 400, 'bad id');
      // zlib downloads into a folder of the job's own, which goes when the job ends (zlib.download drops it)
      const dir = workDir('zlib');
      const meta = { ...(r.meta ?? {}), source: 'zlib', sourceRef: r.ref };
      const j = zlib.download(r.ref, dir, { title: meta.title, attach: r.attach }, async (out) => {
        const got = out.path && existsSync(out.path) ? out.path : join(dir, readdirSync(dir).find((f) => !f.startsWith('.')) ?? '');
        if (!existsSync(got) || statSync(got).isDirectory()) throw new Error('下载完成但找不到文件');
        const existing = r.attach || books().find((b) => b.sourceRef === r.ref)?.id;
        const b = ingest(got, basename(got), { attach: existing, meta });
        if (meta.cover) await adoptCover(b.id, meta.cover);
        return book(b.id);
      });
      return send(res, 200, { job: j });
    }
    /* A treasure-chest book fetched for you: a wish entry first (or the one already there), then the file. */
    if (path === '/treasure/fetch' && M === 'POST') {
      const r = await json(req);
      let b = r.id ? (safeId(r.id) ? book(r.id) : null) : null;
      if (r.id && !b) return fail(res, 404, '这本书不在书架上');
      if (!b) {
        const h = r.hit ?? {};
        if (!h.link) return fail(res, 400, 'missing link');
        b = books().find((x) => x.sourceUrl === h.link) ?? addBook({
          title: String(h.title || '未命名').slice(0, 300), author: String(h.author || '').slice(0, 200), topic: h.topic, tags: h.cats ?? [], formats: h.formats,
          source: 'treasure', sourceRef: h.id, sourceUrl: h.link, status: 'wish',
        });
      }
      if (!b.sourceUrl) return fail(res, 400, '这本书没有网盘链接');
      const link = b.sourceUrl, first = b.id;
      try {
        const j = ctfile.fetchBook(link, { title: b.title, attach: first }, (files) => {
          // one file: it becomes the book on the shelf. Several (a set of volumes): each its own book, named by itself.
          // A volume that can't be shelved doesn't stop the others (its file goes with the job's folder).
          const base = book(first), made = [], errors = [];
          files.forEach((f, i) => {
            try {
              made.push(ingest(f.path, f.name, {
                attach: !made.length && base && !base.file ? first : undefined,
                retitle: files.length > 1,
                meta: { source: 'treasure', sourceUrl: !made.length ? link : undefined, sourceRef: !made.length ? base?.sourceRef : `${base?.sourceRef ?? link}#${i + 1}`, topic: base?.topic, tags: base?.tags },
              }));
            } catch (e) { errors.push(`${f.name}：${e.message}`); }
          });
          if (!made.length) throw new Error(errors[0] || '没有可以上架的文件');
          if (errors.length) console.warn('[treasure] some volumes were not shelved:', errors.join('; '));
          return { ...made[0], more: made.length - 1 };
        });
        return send(res, 200, { job: j, book: book(first) });
      } catch (e) { return fail(res, 400, e.message); }
    }

    if (path === '/jobs' && M === 'GET') return send(res, 200, { jobs: jobs.list() });
    m = path.match(/^\/jobs\/(\w+)(\/[a-z]+)?$/);
    if (m) {
      const [, id, sub] = m;
      const j = jobs.get(id);
      if (!j) return fail(res, 404, 'no such job');
      if (!sub && M === 'GET') return send(res, 200, { job: j });
      if (sub === '/answer' && M === 'POST') {
        const r = await json(req);
        if (!String(r.answer ?? '').trim()) return fail(res, 400, '请输入验证码');
        return ctfile.answer(id, r.answer) ? send(res, 200, { job: j }) : fail(res, 409, '这个任务现在不需要验证码');
      }
      if (sub === '/captcha' && M === 'POST') {
        try { return (await ctfile.refreshCaptcha(id)) ? send(res, 200, { job: j }) : fail(res, 409, '这个任务现在不需要验证码'); }
        catch (e) { return fail(res, 502, e.message); }
      }
      if (sub === '/cancel' && M === 'POST') return send(res, 200, { ok: jobs.cancel(id) });
    }

    /* Remote covers in search results, fetched once and kept. */
    if (path === '/cover' && M === 'GET') {
      const u = String(q.u || '');
      if (!/^https?:\/\//.test(u)) return fail(res, 400, 'bad url');
      const key = createHash('sha1').update(u).digest('hex').slice(0, 20);
      const hit = readdirSync(CACHE).find((f) => f.startsWith(`cv-${key}.`));
      if (hit) { touch(join(CACHE, hit)); return serveFile(req, res, join(CACHE, hit), TYPES[extOf(hit)] || 'image/jpeg'); }
      try {
        const { bytes, type } = await fetchImage(u);
        const ext = /png/.test(type) ? 'png' : /webp/.test(type) ? 'webp' : 'jpg';
        writeFileSync(join(CACHE, `cv-${key}.${ext}`), bytes);
        res.writeHead(200, { 'content-type': type, 'cache-control': 'private, max-age=86400' });
        return res.end(bytes);
      } catch (e) { return fail(res, 502, e.message); }
    }

    return fail(res, 404, 'not found');
  } catch (e) {
    console.error('[api]', M, path, e);
    return fail(res, 500, e.message || String(e));
  }
}
