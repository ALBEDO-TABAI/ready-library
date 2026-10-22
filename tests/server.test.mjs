import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { request } from 'node:http';
import { epub } from './fixtures.mjs';

const data = mkdtempSync(join(tmpdir(), 'Ready 中文 & 空格 '));
let child, base;
async function start() {
  child = spawn(process.execPath, ['server/index.mjs'], { env: { ...process.env, PORT: '0', READY_LIBRARY_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  base = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Server did not start: ' + log)), 10_000);
    child.stdout.on('data', (s) => { log += s; const m = log.match(/http:\/\/127\.0\.0\.1:(\d+)/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('error', reject);
    child.stderr.on('data', (s) => { log += s; });
  });
}
async function stop() { const ended = once(child, 'exit'); child.kill(); await ended; }
before(start);
after(async () => { if (child.exitCode === null) await stop(); rmSync(data, { recursive: true, force: true }); });
async function upload(name, body, attach = '') {
  const r = await fetch(`${base}/api/import?name=${encodeURIComponent(name)}&attach=${attach}`, { method: 'PUT', body });
  assert.equal(r.status, 200);
  return (await r.json()).book;
}

test('Chinese paths, replacement, saved reading state and restart', async () => {
  const b = await upload('中文 & 空格.txt', '第一章\r\n你好 Windows\r\n');
  await fetch(`${base}/api/books/${b.id}`, { method: 'PATCH', body: JSON.stringify({ bookmarks: [{ chapter: 0, offset: 3 }], progress: { chapter: 0, offset: 3, pct: 0.5 } }) });
  await upload('替换.md', '# 第二章', b.id);
  assert.equal(existsSync(join(data, 'files', b.id + '.txt')), false, 'replaced format must not leave its old file');
  assert.equal(readFileSync(join(data, 'files', b.id + '.md'), 'utf8'), '# 第二章');
  await new Promise((r) => setTimeout(r, 300));
  await stop(); await start();
  const saved = (await (await fetch(base + '/api/library')).json()).books[0];
  assert.equal(saved.title, b.title);
  assert.equal(saved.bookmarks[0].offset, 3);
  assert.equal(saved.progress.pct, 0.5);
});

test('PDF byte ranges include suffixes and reject invalid ranges without crashing', async () => {
  const b = await upload('范围.pdf', '0123456789');
  const url = `${base}/api/books/${b.id}/file`;
  for (const [range, expected] of [['bytes=2-4', '234'], ['bytes=-3', '789'], ['bytes=8-', '89']]) {
    const r = await fetch(url, { headers: { range } });
    assert.equal(r.status, 206); assert.equal(await r.text(), expected);
  }
  for (const range of ['bytes=20-', 'bytes=8-2', 'bytes=-0']) {
    const r = await fetch(url, { headers: { range } });
    assert.equal(r.status, 416); assert.equal(r.headers.get('content-range'), 'bytes */10');
  }
  assert.equal((await fetch(base + '/api/library')).status, 200);
});

test('Windows static asset caching and malformed URLs', async () => {
  const html = await (await fetch(base)).text();
  const asset = html.match(/src="(\/assets\/[^\"]+)"/)[1];
  assert.match((await fetch(base + asset)).headers.get('cache-control'), /immutable/);
  assert.equal((await fetch(base + '/%ZZ')).status, 400);
  assert.equal((await fetch(base)).status, 200);
  const worker = readdirSync('dist/assets').find((f) => f.startsWith('pdf.worker') && f.endsWith('.mjs'));
  assert.ok(worker, 'PDF worker must be bundled locally');
  assert.match((await fetch(base + '/assets/' + worker)).headers.get('content-type'), /javascript/);
  assert.equal((await fetch(base + '/pdfjs/standard_fonts/LiberationSans-Regular.ttf')).status, 200);
});

test('Chinese notes survive UTF-8 split across request chunks', async () => {
  const b = await upload('分段.txt', '内容');
  const bytes = Buffer.from(JSON.stringify({ title: '中文批注' }));
  const cut = bytes.indexOf(Buffer.from('中')) + 1;
  const saved = await new Promise((resolve, reject) => {
    const req = request(`${base}/api/books/${b.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' } }, async (res) => {
      let s = ''; for await (const c of res) s += c; resolve(JSON.parse(s).book);
    });
    req.on('error', reject); req.write(bytes.subarray(0, cut));
    setTimeout(() => req.end(bytes.subarray(cut)), 30);
  });
  assert.equal(saved.title, '中文批注');
});

test('EPUB metadata and deletion preserve the original Chinese title', async () => {
  const b = await upload('中文 文件.epub', epub());
  assert.equal(b.title, 'Windows 阅读验证'); assert.equal(b.author, 'Ready Library');
  assert.equal((await fetch(`${base}/api/books/${b.id}`, { method: 'DELETE' })).status, 200);
  assert.equal(existsSync(join(data, 'files', b.id + '.epub')), false);
});

test('a file locked by a Windows reader does not change book metadata on failed replacement', { skip: process.platform !== 'win32' }, async () => {
  const b = await upload('原书.txt', 'original');
  const locker = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$f = [IO.File]::Open($env:READY_TEST_LOCK, 'Open', 'ReadWrite', 'None'); Write-Output 'locked'; [Console]::ReadLine() | Out-Null; $f.Dispose()"], { windowsHide: true, env: { ...process.env, READY_TEST_LOCK: join(data, 'files', b.id + '.txt') } });
  try {
    await once(locker.stdout, 'data');
    const r = await fetch(`${base}/api/import?name=changed.txt&attach=${b.id}`, { method: 'PUT', body: 'replacement' });
    assert.equal(r.status, 500);
    const saved = (await (await fetch(base + '/api/library')).json()).books.find((x) => x.id === b.id);
    assert.equal(saved.file.size, b.file.size); assert.equal(saved.file.name, b.file.name);
  } finally { const ended = once(locker, 'exit'); locker.stdin.end('\n'); await ended; }
  assert.equal(readFileSync(join(data, 'files', b.id + '.txt'), 'utf8'), 'original');
});
