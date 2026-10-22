import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { mkdtempSync, readFileSync, rmSync, mkdirSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { zipSync } from 'fflate';
import { epub } from './fixtures.mjs';

const data = mkdtempSync(join(tmpdir(), 'Ready 下载 中文 & '));
process.env.READY_LIBRARY_DATA = data;
let server, base, ct, jobs, zlib;
const bookBytes = epub();
const archives = {
  zip: Buffer.from(zipSync({ '目录/中文 & 空格?问号.epub': bookBytes, '目录/中文.mobi': Buffer.from('unused') })),
  '7z': readFileSync(new URL('./fixtures/books.7z', import.meta.url)),
};
const waitUntil = async (fn) => {
  for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error('Timed out waiting for download');
};
before(async () => {
  server = createServer(async (req, res) => {
    const u = new URL(req.url, 'http://local');
    if (u.pathname.startsWith('/archive/')) {
      const bytes = archives[u.pathname.split('/').pop()];
      const range = req.headers.range?.match(/bytes=(\d+)-(\d+)/);
      if (range) { const start = +range[1], end = Math.min(+range[2], bytes.length - 1); res.writeHead(206, { 'content-range': `bytes ${start}-${end}/${bytes.length}` }); return res.end(bytes.subarray(start, end + 1)); }
      return res.end(bytes);
    }
    res.setHeader('content-type', 'application/json');
    if (u.pathname === '/resource') {
      const ext = u.searchParams.get('id');
      return res.end(JSON.stringify({ code: 200, data: { file: { file_name: `中文.${ext}`, file_size_bytes: archives[ext]?.length || 1, wait_seconds: ext === 'wait' ? 5 : 0, start_time: Date.now() / 1000 } } }));
    }
    let body = ''; for await (const c of req) body += c;
    const ext = JSON.parse(body).context.id;
    res.end(JSON.stringify({ code: 200, data: { downurl: `${base}/archive/${ext}`, file_size: archives[ext].length } }));
  }).listen(0, '127.0.0.1');
  await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  process.env.CTFILE_API = base;
  ct = await import('../server/sources/ctfile.mjs'); jobs = await import('../server/jobs.mjs'); zlib = await import('../server/sources/zlib.mjs');
});
after(async () => { server.closeAllConnections(); await new Promise((r) => server.close(r)); rmSync(data, { recursive: true, force: true }); });

for (const ext of ['zip', '7z']) test(`download and unpack ${ext} in a Chinese Windows path`, { skip: ext === '7z' && process.platform !== 'win32' }, async () => {
  let imported;
  const j = ct.fetchBook(`https://test.ctfile.com/f/${ext}`, {}, (files) => {
    imported = files.map((f) => ({ name: f.name, bytes: readFileSync(f.path) }));
    return { title: 'test' };
  });
  await waitUntil(() => j.state !== 'running');
  assert.equal(j.state, 'done', j.error); assert.equal(imported.length, 1); assert.match(imported[0].name, /\.epub$/);
  if (ext === 'zip') assert.deepEqual(imported[0].bytes, bookBytes);
  else assert.equal(imported[0].bytes.subarray(0, 2).toString(), 'PK');
  assert.deepEqual(readdirSync(join(data, 'cache/work')), [], 'archives and unused formats must be removed');
});

test('cancel active and queued downloads without importing', async () => {
  const imported = () => assert.fail('cancelled book must not be imported');
  const j = ct.fetchBook('https://test.ctfile.com/f/wait', {}, imported);
  const queued = ct.fetchBook('https://test.ctfile.com/f/zip', {}, imported);
  assert.equal(jobs.cancel(queued.id), true);
  await waitUntil(() => j.stage === 'waiting');
  assert.equal(jobs.cancel(j.id), true);
  await waitUntil(() => j.state !== 'running');
  assert.equal(j.error, '已取消'); assert.equal(queued.error, '已取消');
});

test('zlib reports a missing Windows executable without crashing', async () => {
  process.env.ZLIB_BIN = join(data, 'missing.exe');
  const st = await zlib.status(true);
  assert.equal(st.installed, false); assert.equal(st.platform, process.platform); assert.match(st.error, /没有找到/);
});

test('zlib preserves split UTF-8 output and reports login status', async () => {
  process.env.ZLIB_BIN = process.execPath;
  process.env.NODE_OPTIONS = `--import=${new URL('./fixtures/fake-zlib.mjs', import.meta.url).href}`;
  const st = await zlib.status(true);
  assert.equal(st.loggedIn, true, st.error); assert.equal(st.quota.remaining, 5);
  assert.equal((await zlib.search({ q: '中文' })).books[0].title, '中文检索');
  process.env.FAKE_ZLIB_MODE = 'unauthorized';
  assert.equal((await zlib.status(true)).loggedIn, false);
  delete process.env.FAKE_ZLIB_MODE;
});

test('zlib downloads to a path with spaces and cancellation stops the child', async () => {
  const dir = join(data, '中文 & 下载'); mkdirSync(dir);
  const j = zlib.download('42:hash', dir, {}, (out) => { assert.equal(readFileSync(out.path, 'utf8'), '第一章\r\n测试下载'); return { title: '中文' }; });
  await waitUntil(() => j.state !== 'running'); assert.equal(j.state, 'done', j.error);
  await waitUntil(() => !existsSync(dir));
  mkdirSync(dir);
  process.env.FAKE_ZLIB_MODE = 'slow';
  const slow = zlib.download('42:slow', dir, {}, () => assert.fail('cancelled download imported'));
  await waitUntil(() => existsSync(join(dir, 'started')));
  const pid = Number(readFileSync(join(dir, 'started'), 'utf8'));
  jobs.cancel(slow.id);
  await waitUntil(() => slow.state !== 'running');
  assert.equal(slow.error, '已取消');
  assert.throws(() => process.kill(pid, 0));
  await waitUntil(() => !existsSync(dir));
});
