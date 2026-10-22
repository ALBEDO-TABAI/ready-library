// 城通网盘 (CTFile) share links → the book inside, fetched in the background.
//
// The share page is a single-page app over a small JSON API (urlapi.ctfile.com/api/v2). This takes the same steps
// it takes for a guest: read the resource, wait out any timer it sets, ask for a download address, and — only if
// the site asks — show you its captcha and send back what you type (nothing here reads a captcha by machine).
// Guests may run one download at a time, so jobs queue, and each uses a single connection.
//
// The treasure chest's files are zips holding one book as EPUB, MOBI and AZW3. The zip's directory is read from
// its tail with an HTTP Range request and only the EPUB's bytes are fetched — about a third of the archive. Other
// archives (or a server that ignores Range) are downloaded whole and unpacked locally (zip here, RAR / 7z with
// bsdtar where the system has it).
import * as zl from 'node:zlib';
import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import * as jobs from '../jobs.mjs';
import { workDir, drop } from '../work.mjs';
import { extOf } from '../bookmeta.mjs';

const API = process.env.CTFILE_API || 'https://urlapi.ctfile.com/api/v2';
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';
const sleep = (ms, signal) => new Promise((res, rej) => {
  const t = setTimeout(res, ms);
  signal?.addEventListener('abort', () => { clearTimeout(t); rej(new Error('已取消')); }, { once: true });
});

/** https://url89.ctfile.com/f/31084289-1375510375-05242f?p=8866 → where it lives, its id and pass code */
export function parseLink(link) {
  let u;
  try { u = new URL(link); } catch { throw new Error('这本书没有可用的网盘链接'); }
  const m = u.pathname.match(/^\/f\/([\w-]+)/);
  if (!m || !/(^|\.)ctfile\.com$/i.test(u.hostname)) throw new Error('不是城通网盘的文件链接');
  return { origin: u.origin, id: m[1], passcode: u.searchParams.get('p') || '', link };
}

const context = (c) => ({ kind: 'file', id: c.id, folder_id: '0', fk: '', passcode: c.passcode, type_id: '0' });

async function call(c, path, { params, body, signal } = {}) {
  const u = new URL(API + path);
  for (const [k, v] of Object.entries(params ?? {})) u.searchParams.set(k, v);
  const res = await fetch(u, {
    method: body ? 'POST' : 'GET',
    headers: { 'user-agent': UA, accept: 'application/json', origin: c.origin, referer: c.link, ...(body ? { 'content-type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined,
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30_000)]) : AbortSignal.timeout(30_000),
  });
  // like the share page, read the JSON whatever the status: the API puts its own code inside
  try { return await res.json(); } catch { throw new Error(`网盘接口返回了看不懂的内容（HTTP ${res.status}）`); }
}

async function resource(c, signal) {
  const r = await call(c, '/resource', { params: context(c), signal });
  if (r.code === 423) throw new Error('网盘提取码不对，这个链接可能换过密码');
  const file = r.data?.file;
  if (r.code !== 200 || !file) throw new Error(r.msg || r.message || '网盘上找不到这个文件，链接可能已经失效');
  if (file.code && file.code !== 200) throw new Error(file.message || file.msg || '这个分享现在打不开');
  const cap = r.data.capabilities ?? {};
  if (cap.download === false || cap.canDownload === false) throw new Error('这个文件现在不允许下载');
  if (cap.vip_required === true) throw new Error('这个文件只有城通会员能下载');
  return file;
}

/** The address of the file itself, or what the site wants first (a wait, a captcha, a login). */
async function address(c, file, answer, signal) {
  const r = await call(c, '/download', {
    signal,
    body: {
      context: context(c), mb: false, app: false, verifycode: String(file.verifycode || ''),
      challenge: answer?.challenge, captcha_answer: answer?.answer,
      original_file: { file_id: file.file_id, userid: file.userid, file_chk: file.file_chk, start_time: file.start_time, wait_seconds: file.wait_seconds },
    },
  });
  return r.data && typeof r.data === 'object' ? { ...r.data, code: r.data.code ?? r.code, message: r.message || r.data.message || r.msg } : r;
}

async function captcha(c, type, signal) {
  const r = await call(c, '/captcha', { params: { type }, signal });
  if (!r.data?.challenge || !r.data?.image_url) throw new Error(r.msg || '网盘的验证码加载不出来');
  const res = await fetch(new URL(r.data.image_url, API + '/'), { headers: { 'user-agent': UA, referer: c.link }, signal });
  const type2 = res.headers.get('content-type') || 'image/png';
  const img = `data:${type2};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`;
  return { challenge: r.data.challenge, image: img };
}

/** The share page reports a download's start and end the same way (it credits the uploader); so do we, truthfully. */
function audit(c, a, payload) {
  if (!a?.url) return;
  fetch(new URL(a.url, API + '/'), {
    method: 'POST', headers: { 'user-agent': UA, 'content-type': 'application/json', origin: c.origin, referer: c.link },
    body: JSON.stringify({ ...(a.params ?? {}), ...payload, client_ts: Date.now() }), signal: AbortSignal.timeout(15_000),
  }).catch(() => {});
}

/* ---------- reading a file a byte range at a time ---------- */

class NoRange extends Error {}

/** Ranges of the remote file, on one connection at a time, resumed after a dropped connection. */
function remote(src, j, signal) {
  return {
    size: src.size,
    async read(start, end) {
      const parts = [];
      let got = 0, tries = 0;
      while (start + got <= end) {
        try {
          const res = await fetch(src.url, { headers: { 'user-agent': UA, referer: src.referer, range: `bytes=${start + got}-${end}` }, signal });
          if (res.status === 200) { await res.body?.cancel(); throw new NoRange('server ignores Range'); }
          if (res.status !== 206) {
            await res.body?.cancel();
            if ([401, 403, 404, 410].includes(res.status) && tries++ < 2) { src.url = await src.refresh(); continue; }
            throw new Error(`下载服务器返回 HTTP ${res.status}`);
          }
          for await (const chunk of res.body) { parts.push(chunk); got += chunk.length; tick(j, chunk.length); }
        } catch (e) {
          if (signal.aborted) throw new Error('已取消');
          if (e instanceof NoRange || /HTTP \d/.test(e.message)) throw e;
          if (++tries > 5) throw new Error(`下载断了：${e.message}`);
          j.line = '连接断了，正在接着下…';
          await sleep(1500 * tries, signal);
        }
      }
      return Buffer.concat(parts).subarray(0, end - start + 1);
    },
  };
}
const memory = (buf) => ({ size: buf.length, async read(start, end) { return buf.subarray(start, end + 1); } });

/* ---------- zip, from its directory inwards ---------- */

const utf8 = new TextDecoder('utf-8', { fatal: true }), gbk = new TextDecoder('gb18030');
const nameOf = (bytes, flags) => {
  if (flags & 0x800) return Buffer.from(bytes).toString('utf8');
  try { return utf8.decode(bytes); } catch { return gbk.decode(bytes); }
};

async function zipEntries(rd) {
  const tailLen = Math.min(rd.size, 65_557 + 22);
  const tail = await rd.read(rd.size - tailLen, rd.size - 1);
  let e = -1;
  for (let i = tail.length - 22; i >= 0; i--) if (tail.readUInt32LE(i) === 0x06054b50) { e = i; break; }
  if (e < 0) throw new Error('压缩包坏了（找不到目录）');
  const n = tail.readUInt16LE(e + 10), cdSize = tail.readUInt32LE(e + 12), cdOff = tail.readUInt32LE(e + 16);
  if (n === 0xffff || cdOff === 0xffffffff) throw new NoRange('zip64');
  const base = rd.size - tailLen;
  const cd = cdOff >= base ? tail.subarray(cdOff - base, cdOff - base + cdSize) : await rd.read(cdOff, cdOff + cdSize - 1);
  const out = [];
  for (let p = 0, k = 0; k < n && p + 46 <= cd.length; k++) {
    if (cd.readUInt32LE(p) !== 0x02014b50) break;
    const flags = cd.readUInt16LE(p + 8), method = cd.readUInt16LE(p + 10), crc = cd.readUInt32LE(p + 16);
    const csz = cd.readUInt32LE(p + 20), usz = cd.readUInt32LE(p + 24), fl = cd.readUInt16LE(p + 28), el = cd.readUInt16LE(p + 30), cl = cd.readUInt16LE(p + 32);
    const lho = cd.readUInt32LE(p + 42);
    out.push({ name: nameOf(cd.subarray(p + 46, p + 46 + fl), flags), flags, method, crc, csz, usz, lho, extra: el });
    p += 46 + fl + el + cl;
  }
  return out;
}

async function zipEntry(rd, e) {
  if (e.flags & 1) throw new Error('压缩包里的文件加了密码');
  if (e.method !== 0 && e.method !== 8) throw new NoRange(`zip method ${e.method}`);
  const slack = 30 + 1024 + e.extra;
  let buf = await rd.read(e.lho, Math.min(rd.size - 1, e.lho + slack + e.csz - 1));
  if (buf.readUInt32LE(0) !== 0x04034b50) throw new Error('压缩包坏了（文件头不对）');
  const start = 30 + buf.readUInt16LE(26) + buf.readUInt16LE(28);
  if (start + e.csz > buf.length) buf = Buffer.concat([buf, await rd.read(e.lho + buf.length, e.lho + start + e.csz - 1)]);
  const raw = buf.subarray(start, start + e.csz);
  const data = e.method === 8 ? zl.inflateRawSync(raw) : Buffer.from(raw);
  if (typeof zl.crc32 === 'function' && (zl.crc32(data) >>> 0) !== e.crc >>> 0) throw new Error(`${basename(e.name)} 解压后校验不对`);
  return data;
}

/* ---------- which file in an archive is the book ---------- */

const RANK = { epub: 0, azw3: 1, mobi: 2, pdf: 3, fb2: 4, txt: 5 };
const ARCHIVE = new Set(['zip', 'rar', '7z']);
const junk = (name) => /(^|\/)(__MACOSX|\.)|(^|\/)(免责声明|说明|readme|read me|更多|下载|关注)[^/]*\.txt$/i.test(name);
/** The best format present; every file in it (a set of volumes is several books). A .txt counts only when it is book-sized. */
export function pickBooks(files) {
  const cands = files.filter((f) => !f.name.endsWith('/') && !junk(f.name) && extOf(f.name) in RANK && (extOf(f.name) !== 'txt' || f.usz > 40_000));
  if (!cands.length) return [];
  const best = Math.min(...cands.map((f) => RANK[extOf(f.name)]));
  return cands.filter((f) => RANK[extOf(f.name)] === best).sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true })).slice(0, 30);
}

async function fromZip(rd, j, depth = 0) {
  const entries = await zipEntries(rd);
  const picked = pickBooks(entries);
  if (!picked.length) {
    // a zip holding an archive: open that one too
    const inner = entries.filter((f) => ARCHIVE.has(extOf(f.name)) && !junk(f.name)).sort((a, b) => b.usz - a.usz)[0];
    if (!inner || depth > 1) throw new Error('压缩包里没有电子书文件');
    j.total = (j.bytes ?? 0) + inner.csz;
    const buf = await zipEntry(rd, inner);
    if (extOf(inner.name) === 'zip') return fromZip(memory(buf), j, depth + 1);
    return unpackElsewhere(buf, inner.name, j);
  }
  // what is left to fetch: the chosen files and their headers
  j.total = (j.bytes ?? 0) + picked.reduce((n, f) => n + f.csz + 30 + 1024 + f.extra, 0);
  const out = [];
  for (const f of picked) {
    j.line = picked.length > 1 ? `下载第 ${out.length + 1}/${picked.length} 本：${basename(f.name)}` : `下载 ${basename(f.name)}`;
    out.push({ name: basename(f.name), bytes: await zipEntry(rd, f) });
  }
  return out;
}

/** RAR, 7z and friends: through bsdtar (libarchive), which macOS and Windows 10+ ship as `tar`. */
async function unpackElsewhere(buf, name, j) {
  const dir = workDir('unpack');
  try {
    const arc = join(dir, `archive.${extOf(name) || 'bin'}`);
    writeFileSync(arc, buf);
    j.stage = 'unpacking'; j.line = `解压 ${name}`;
    const out = join(dir, 'out');
    mkdirSync(out);
    let ok = false;
    for (const bin of ['bsdtar', 'tar']) {
      ok = await new Promise((res) => {
        const p = spawn(bin, ['-xf', arc, '-C', out], { stdio: 'ignore' });
        p.on('error', () => res(false)); p.on('close', (code) => res(code === 0));
      });
      if (ok) break;
    }
    if (!ok) throw new Error(`解不开 .${extOf(name)} 压缩包（系统里没有 bsdtar）。可以点「去网盘手动下载」`);
    const files = [];
    const walk = (d, rel = '') => { for (const f of readdirSync(d, { withFileTypes: true })) { const p = join(d, f.name), r = rel ? `${rel}/${f.name}` : f.name; if (f.isDirectory()) walk(p, r); else files.push({ name: r, usz: statSync(p).size, path: p }); } };
    walk(out);
    const picked = pickBooks(files);
    if (!picked.length) throw new Error('压缩包里没有电子书文件');
    return picked.map((f) => ({ name: basename(f.name), bytes: readFileSync(f.path) }));
  } finally {
    drop(dir);   // the archive and everything unpacked from it; only the chosen books were read out
  }
}

/* ---------- jobs ---------- */

function tick(j, n) {
  const now = Date.now(), o = jobs.own(j.id);
  j.bytes = (j.bytes ?? 0) + n;
  o.t ??= now; o.b ??= 0;
  if (now - o.t >= 1000) { const v = ((j.bytes - o.b) * 1000) / (now - o.t); j.speed = Math.round(j.speed ? j.speed * 0.6 + v * 0.4 : v); o.t = now; o.b = j.bytes; }
  if (j.total) j.pct = Math.min(99, Math.floor((j.bytes / j.total) * 100));
}

async function countdown(j, seconds, signal) {
  j.stage = 'waiting';
  for (let s = Math.ceil(seconds); s > 0; s--) { j.wait = s; j.line = `网盘要求等 ${s} 秒`; await sleep(1000, signal); }
  j.wait = 0;
}

/** The page shows the picture; a person types what it says (POST /jobs/:id/answer). */
async function ask(j, c, type, signal, again) {
  let cap = await captcha(c, type, signal);
  j.stage = 'captcha'; j.captcha = cap.image; j.line = again ? '验证码不对，换了一张，再试一次' : '网盘要一个验证码';
  const o = jobs.own(j.id);
  try {
    const answer = await new Promise((resolve, reject) => {
      const t = setTimeout(() => reject(new Error('验证码等太久了，任务已停下')), 15 * 60_000);
      o.captcha = {
        resolve: (a) => { clearTimeout(t); resolve(a); },
        reject: (e) => { clearTimeout(t); reject(e); },
        refresh: async () => { cap = await captcha(c, type, signal); j.captcha = cap.image; },
      };
    });
    return { challenge: cap.challenge, answer };
  } finally { o.captcha = null; j.captcha = undefined; }
}
export function answer(id, text) { const o = jobs.own(id); if (!o?.captcha) return false; o.captcha.resolve(String(text).trim().slice(0, 16)); return true; }
export async function refreshCaptcha(id) { const o = jobs.own(id); if (!o?.captcha) return false; await o.captcha.refresh(); return true; }

async function run(j, c, onBooks) {
  const signal = jobs.own(j.id).ctl.signal;
  j.stage = 'resolving'; j.line = '打开网盘链接…';
  const file = await resource(c, signal);
  j.file = file.file_name; j.size = Number(file.file_size_bytes) || 0;
  const left = Math.ceil((Number(file.wait_seconds) || 0) - Math.max(0, Date.now() / 1000 - (Number(file.start_time) || 0)));
  if (left > 0 && left < 600) await countdown(j, left, signal);

  let ans = null, got = null, asked = 0, waited = 0;
  for (let i = 0; i < 24 && !got; i++) {
    j.stage = 'resolving'; j.line = '向网盘要下载地址…';
    const r = await address(c, file, ans, signal);
    if (r.code === 200 && /^https?:\/\//.test(r.downurl || '')) got = r;
    else if (r.code === 218 && waited++ < 8) await countdown(j, Math.min(600, Number(r.remaining_seconds) || 5), signal);
    else if (r.code === 219) throw new Error('城通网盘要求登录才能下载这个文件，可以点「去网盘手动下载」');
    else if ((r.code === 217 || r.requires_captcha) && asked < 6) ans = await ask(j, c, r.challenge_type || 'download', signal, asked++ > 0);
    else if (r.code === 217 || r.requires_captcha) throw new Error('验证码错了太多次，任务已停下');
    else throw new Error(r.message || r.msg || `网盘拒绝了下载（${r.code}）`);
  }
  if (!got) throw new Error('网盘一直没给下载地址，稍后再试');

  const size = Number(got.file_size) || j.size;
  const src = {
    url: got.downurl, size, referer: c.origin + '/',
    refresh: async () => { const r = await address(c, file, null, signal); if (r.code !== 200 || !r.downurl) throw new Error('下载地址过期了，重新取回一次'); return r.downurl; },
  };
  const t0 = Date.now();
  audit(c, got.audit, { file_name: got.file_name || j.file, total_bytes: size, bytes_downloaded: 0, downloaded_bytes: 0, progress: 0, duration: 0, event: 'start', status: 'start', speed: 0 });
  j.stage = 'downloading'; j.bytes = 0; j.total = size; j.line = '下载中…';
  const ext = extOf(j.file || '');
  let books;
  const whole = async () => {
    // no ranges (or an archive we must open locally): the whole file, then unpack
    j.bytes = 0; j.total = size; j.line = `下载 ${j.file}`;
    const buf = await wholeFile(src, j, signal);
    if (ext === 'zip') return fromZip(memory(buf), j);
    if (ARCHIVE.has(ext)) return unpackElsewhere(buf, j.file, j);
    return [{ name: j.file, bytes: buf }];
  };
  try {
    books = ext === 'zip' ? await fromZip(remote(src, j, signal), j) : await whole();
  } catch (e) {
    if (!(e instanceof NoRange)) throw e;
    books = await whole();
  }
  audit(c, got.audit, { file_name: got.file_name || j.file, total_bytes: size, bytes_downloaded: j.bytes, downloaded_bytes: j.bytes, progress: Math.min(100, (j.bytes / Math.max(1, size)) * 100), duration: Math.max(1, Math.floor((Date.now() - t0) / 1000)), event: 'complete', status: 'completed', speed: j.speed || 0 });

  j.stage = 'unpacking'; j.line = books.length > 1 ? `${books.length} 本，正在上架` : '正在上架';
  // the chosen books are written into the job's folder; shelving moves them into the library, the folder goes after
  const dir = workDir('ctfile');
  try {
    const files = books.map((b, i) => { const p = join(dir, `${i}-${basename(b.name)}`); writeFileSync(p, b.bytes); return { name: b.name, path: p }; });
    return onBooks(files);
  } finally { drop(dir); }
}

async function wholeFile(src, j, signal) {
  const parts = [];
  let got = 0;
  for (let tries = 0; ;) {
    try {
      const res = await fetch(src.url, { headers: { 'user-agent': UA, referer: src.referer, ...(got ? { range: `bytes=${got}-` } : {}) }, signal });
      if (res.status !== 200 && res.status !== 206) {
        await res.body?.cancel();
        if ([401, 403, 404, 410].includes(res.status) && tries < 2) src.url = await src.refresh();
        throw new Error(`HTTP ${res.status}`);
      }
      // asked to resume and sent the whole file again: start over
      if (got && res.status === 200) { j.bytes -= got; got = 0; parts.length = 0; }
      for await (const chunk of res.body) { parts.push(chunk); got += chunk.length; tick(j, chunk.length); }
      if (!src.size || got >= src.size) break;
    } catch (e) {
      if (signal.aborted) throw new Error('已取消');
      if (++tries > 5) throw new Error(`下载断了：${e.message}`);
      j.line = '连接断了，正在接着下…';
      await sleep(1500 * tries, signal);
    }
  }
  return Buffer.concat(parts);
}

// guests get one download at a time: jobs wait their turn
let queue = Promise.resolve();
/** Fetch the book behind a share link; `onBooks([{ name, path }])` puts the files on the shelf and returns the book. */
export function fetchBook(link, { title, attach }, onBooks) {
  const live = jobs.list().find((x) => x.src === 'treasure' && x.link === link && x.state === 'running');
  if (live) return live;
  const c = parseLink(link);
  const j = jobs.create({ src: 'treasure', link, title, attach, stage: 'queued', line: '排队中（网盘一次只能下一本）' });
  queue = queue.then(async () => {
    if (j.state !== 'running') return;
    try {
      const b = await run(j, c, onBooks);
      jobs.finish(j, { state: 'done', stage: 'done', pct: 100, line: '已上架', book: b });
    } catch (e) {
      jobs.finish(j, { state: 'error', error: jobs.own(j.id)?.ctl.signal.aborted ? '已取消' : e.message || String(e) });
    } finally { j.captcha = undefined; }
  });
  return j;
}
