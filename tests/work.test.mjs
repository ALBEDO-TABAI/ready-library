import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, utimesSync, rmSync, readdirSync } from 'node:fs';
import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const data = mkdtempSync(join(tmpdir(), 'Ready 清理 中文 & '));
process.env.READY_LIBRARY_DATA = data;
const { WORK, workDir, drop, sweep, touch } = await import('../server/work.mjs');
after(() => rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 }));

test('startup cleanup preserves active jobs, books and recently used covers', () => {
  const cache = join(data, 'cache');
  const active = workDir('active');
  writeFileSync(join(active, 'partial'), 'in use');
  const dead = spawnSync(process.execPath, ['-e', ''], { windowsHide: true }).pid;
  const abandoned = join(WORK, `${dead}-import-old`);
  mkdirSync(abandoned); writeFileSync(join(abandoned, 'partial'), 'unfinished');
  const old = new Date(Date.now() - 32 * 86400_000);
  for (const name of ['up-old', 'dl-old', 'x-old', 'cv-old.jpg', 'cv-used.jpg']) {
    const file = join(cache, name); writeFileSync(file, 'old'); utimesSync(file, old, old);
  }
  touch(join(cache, 'cv-used.jpg'));
  writeFileSync(join(cache, 'up-recent'), 'new');
  writeFileSync(join(cache, 'index.json'), 'cached index');
  const book = join(data, 'files', 'kept.epub'); writeFileSync(book, 'book');
  assert.deepEqual(sweep(), { work: 1, loose: 3, covers: 1 });
  assert.ok(!existsSync(abandoned)); assert.ok(existsSync(active)); assert.ok(existsSync(book));
  for (const file of ['up-recent', 'cv-used.jpg', 'index.json']) assert.ok(existsSync(join(cache, file)));
  drop(active); assert.deepEqual(readdirSync(WORK), []);
});

test('Windows cleanup retries a temporarily locked download file', { skip: process.platform !== 'win32' }, async () => {
  const dir = workDir('locked'), file = join(dir, 'download.part');
  writeFileSync(file, 'partial');
  const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$f = [IO.File]::Open($env:READY_LOCK_FILE, 'Open', 'ReadWrite', 'None'); Write-Output 'locked'; Start-Sleep -Milliseconds 250; $f.Dispose()"], { windowsHide: true, env: { ...process.env, READY_LOCK_FILE: file } });
  const ended = once(child, 'exit');
  await once(child.stdout, 'data');
  drop(dir);
  await ended;
  assert.equal(existsSync(dir), false, 'transient Windows file locks must not leave a download folder');
});
