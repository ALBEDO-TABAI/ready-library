// Exercise the actual Electron protocol and renderer in an isolated, hidden app.
'use strict';
const assert = require('node:assert/strict');
const { app, BrowserWindow, Menu, net } = require('electron');
const { once } = require('node:events');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const originalPath = process.env.PATH;
if (process.env.RL_SMOKE_RESOURCES) {
  Object.defineProperty(app, 'isPackaged', { value: true });
  Object.defineProperty(process, 'resourcesPath', { value: process.env.RL_SMOKE_RESOURCES });
  require(path.join(process.resourcesPath, 'app.asar/main.cjs'));
} else require('../main.cjs');
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, message) {
  for (let i = 0; i < 150; i++) { if (await check()) return; await delay(100); }
  throw new Error(message);
}
const json = async (route, options) => {
  const response = await net.fetch('rl://app' + route, options);
  assert.equal(response.status, 200, await response.clone().text());
  return response.json();
};
const timeout = setTimeout(() => { console.error('Desktop test timed out'); app.exit(1); }, 60_000);
(async () => {
  const [win] = await once(app, 'browser-window-created').then((args) => [args[1]]);
  await once(win.webContents, 'did-finish-load');
  if (process.platform === 'win32') assert.equal(process.env.PATH, originalPath, 'Windows PATH must retain drive letters and semicolons');
  const roles = Menu.getApplicationMenu().items.flatMap((item) => item.submenu?.items.map((x) => x.role) || []);
  assert.ok(roles.includes('quit')); assert.ok(roles.includes('about'));
  if (process.platform !== 'darwin') assert.ok(!roles.includes('services') && !roles.includes('hideOthers'));
  assert.equal(win.webContents.getURL(), 'rl://app/');
  assert.equal(BrowserWindow.getAllWindows().length, 1);
  const fixtures = await import('../../tests/fixtures.mjs');
  let books = (await json('/api/library')).books;
  if (process.argv.includes('create')) {
    assert.equal(books.length, 0);
    for (const [name, body] of [['桌面中文.epub', fixtures.epub()], ['桌面 PDF.pdf', fixtures.pdf()]]) {
      await json('/api/import?name=' + encodeURIComponent(name), { method: 'PUT', body });
    }
    books = (await json('/api/library')).books;
    await json('/api/books/' + books[0].id, { method: 'PATCH', body: JSON.stringify({ highlights: [{ id: 'desktop-note', chapter: 0, from: 0, to: 2, text: '中文', note: '桌面重启保留批注', color: 'yellow', at: Date.now() }] }) });
  } else {
    assert.equal(books.length, 2);
    assert.equal(books[0].highlights[0].note, '桌面重启保留批注');
    assert.equal(readFileSync(path.join(process.env.RL_USER_DATA, 'library/library.json'), 'utf8').includes('桌面重启保留批注'), true);
  }
  const pdf = books.find((book) => book.file.ext === 'pdf');
  const range = await net.fetch(`rl://app/api/books/${pdf.id}/file`, { headers: { range: 'bytes=0-7' } });
  assert.equal(range.status, 206); assert.equal(await range.text(), '%PDF-1.4');
  const font = await net.fetch('rl://app/pdfjs/standard_fonts/LiberationSans-Regular.ttf');
  assert.equal(font.status, 200); assert.ok((await font.arrayBuffer()).byteLength > 1000);
  await win.loadURL(`rl://app/#/read/${pdf.id}`);
  await until(() => win.webContents.executeJavaScript("document.querySelector('.pdfViewer .textLayer')?.textContent.includes('Windows PDF test') && document.querySelector('.pdfViewer canvas')?.width > 0"), 'PDF did not render through the desktop protocol');
  const epub = books.find((book) => book.file.ext === 'epub');
  await win.loadURL(`rl://app/#/read/${epub.id}`);
  await until(() => win.webContents.executeJavaScript("!!document.querySelector('.rd-stage.is-in .sheet')"), 'EPUB did not render through the desktop protocol');
  console.log('Desktop passed: PATH, menu, protocol, import, Chinese notes, PDF, EPUB, ' + (process.argv.includes('create') ? 'creation' : 'restart persistence'));
  clearTimeout(timeout); app.quit();
})().catch((error) => { console.error(error); clearTimeout(timeout); app.exit(1); });
