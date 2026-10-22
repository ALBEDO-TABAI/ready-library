// Ready Library — desktop shell (Electron), built like Ready Poster Printer's.
// Serves the built web app and its local API from rl://app/: a fixed origin (so the settings kept in localStorage
// persist between launches) and no network port at all. The API is the same server/api.mjs `npm start` runs, bundled
// into one file and answered in-process. The library lives in the platform's application data folder.
'use strict';
const { app, BrowserWindow, Menu, protocol, shell, dialog, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { Readable, PassThrough } = require('node:stream');
const { pathToFileURL } = require('node:url');

const SCHEME = 'rl';
const ORIGIN = `${SCHEME}://app`;
const REPO = 'https://github.com/ALBEDO-TABAI/ready-library';
const WEB_ROOT = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(__dirname, '..', 'dist');
const SERVER = app.isPackaged ? path.join(process.resourcesPath, 'server', 'server.mjs') : path.join(__dirname, 'app', 'server.mjs');
const LICENSES = app.isPackaged ? path.join(process.resourcesPath, 'licenses') : path.join(__dirname, '..', 'licenses');

if (process.env.RL_USER_DATA) app.setPath('userData', process.env.RL_USER_DATA); // an isolated profile for checks
const LIBRARY = () => process.env.READY_LIBRARY_DATA || path.join(app.getPath('userData'), 'library');
const isMac = process.platform === 'darwin';
if (process.platform === 'win32') app.setAppUserModelId('io.github.albedo-tabai.ready-library');

// An app opened from Finder gets a bare PATH: add Homebrew's, so the zlib CLI is found where Terminal finds it
if (isMac) process.env.PATH = [...new Set([...(process.env.PATH || '').split(path.delimiter), '/opt/homebrew/bin', '/usr/local/bin', '/usr/bin', '/bin'])].filter(Boolean).join(path.delimiter);

const zh = () => (app.getPreferredSystemLanguages()[0] || app.getLocale() || '').toLowerCase().startsWith('zh');
const L = (z, e) => (zh() ? z : e);

protocol.registerSchemesAsPrivileged([
  { scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true, codeCache: true } },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf', '.otf': 'font/otf', '.txt': 'text/plain; charset=utf-8', '.wasm': 'application/wasm',
};

/* ---------- the API: server/api.mjs's Node-style handle(req, res), answered as a fetch Response ---------- */
let api = null;
function callApi(request) {
  const url = new URL(request.url);
  // the request body as the Buffer stream a Node http request would be
  const body = request.body ? Readable.from((async function* () { for await (const c of request.body) yield Buffer.from(c); })()) : Readable.from([]);
  const req = Object.assign(body, { url: url.pathname + url.search, method: request.method, headers: Object.fromEntries(request.headers) });
  return new Promise((resolve, reject) => {
    const res = new PassThrough();
    let status = 200, sent = false;
    const headers = {};
    const answer = () => { if (!sent) { sent = true; resolve(new Response(Readable.toWeb(res), { status, headers })); } };
    res.writeHead = (code, h = {}) => { status = code; for (const [k, v] of Object.entries(h)) headers[k] = String(v); answer(); return res; };
    res.setHeader = (k, v) => { headers[k] = String(v); };
    res.once('finish', answer);
    Promise.resolve(api.handle(req, res)).catch(reject);
  });
}

async function serveStatic(p) {
  const file = path.normalize(path.join(WEB_ROOT, p === '/' || p === '' ? 'index.html' : p));
  if (file !== WEB_ROOT && !file.startsWith(WEB_ROOT + path.sep)) return new Response('forbidden', { status: 403 });
  try {
    const target = fs.statSync(file).isDirectory() ? path.join(file, 'index.html') : file;
    return new Response(await fs.promises.readFile(target), { status: 200, headers: { 'Content-Type': MIME[path.extname(target).toLowerCase()] || 'application/octet-stream' } });
  } catch {
    return new Response('not found', { status: 404 });
  }
}

async function handle(request) {
  const url = new URL(request.url);
  if (url.host !== 'app') return new Response('not found', { status: 404 });
  let p;
  try { p = decodeURIComponent(url.pathname); } catch { return new Response('bad request', { status: 400 }); }
  if (p.startsWith('/api/')) {
    try { return await callApi(request); } catch (e) { return new Response(JSON.stringify({ error: String((e && e.message) || e) }), { status: 500, headers: { 'Content-Type': 'application/json' } }); }
  }
  return serveStatic(p);
}

/* ---------- window ---------- */
const STATE = () => path.join(app.getPath('userData'), 'window-state.json');
function loadBounds() {
  try { return JSON.parse(fs.readFileSync(STATE(), 'utf8')); } catch { return null; }
}
function saveBounds(win) {
  try { fs.writeFileSync(STATE(), JSON.stringify({ ...win.getNormalBounds(), maximized: win.isMaximized() })); } catch { /* read-only home */ }
}

const isInternal = (u) => u.startsWith(ORIGIN + '/') || u === ORIGIN;
function openOutside(u) {
  if (/^(https?|mailto):/i.test(u)) shell.openExternal(u);
}

let win = null;
function createWindow() {
  const { screen } = require('electron');
  const wa = screen.getPrimaryDisplay().workAreaSize;
  const saved = loadBounds();
  const visible = saved && screen.getAllDisplays().some((d) => {
    const b = d.workArea; return saved.x < b.x + b.width - 80 && saved.x + saved.width > b.x + 80 && saved.y >= b.y - 20 && saved.y < b.y + b.height - 80;
  });
  win = new BrowserWindow({
    width: visible ? saved.width : Math.min(1560, Math.round(wa.width * 0.9)),
    height: visible ? saved.height : Math.min(980, Math.round(wa.height * 0.9)),
    ...(visible ? { x: saved.x, y: saved.y } : { center: true }),
    minWidth: 900, minHeight: 620,
    title: 'Ready Library',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0b0b0d' : '#ebebee', // --stage, so the start screen has no white flash
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  if (visible && saved.maximized) win.maximize();
  if (!process.env.RL_HIDDEN) win.once('ready-to-show', () => win.show()); // RL_HIDDEN: driven by checks, never on screen
  win.on('close', () => saveBounds(win));
  win.on('closed', () => { win = null; });

  const wc = win.webContents;
  // links to the network drive, GitHub, Z-Library open in the default browser
  wc.setWindowOpenHandler(({ url }) => { openOutside(url); return { action: 'deny' }; });
  // a book dropped outside the drop zone must not navigate the window to the file
  wc.on('will-navigate', (e, url) => { if (!isInternal(url)) { e.preventDefault(); openOutside(url); } });
  win.loadURL(ORIGIN + '/');
}

/* ---------- menu ---------- */
function buildMenu() {
  const go = (hash) => () => { const w = BrowserWindow.getFocusedWindow() || win; if (w) w.loadURL(ORIGIN + '/' + hash); else createWindow(); };
  const tpl = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: L('关于 Ready Library', 'About Ready Library') },
        { type: 'separator' },
        { role: 'services', label: L('服务', 'Services') },
        { type: 'separator' },
        { role: 'hide', label: L('隐藏 Ready Library', 'Hide Ready Library') },
        { role: 'hideOthers', label: L('隐藏其他', 'Hide Others') },
        { role: 'unhide', label: L('全部显示', 'Show All') },
        { type: 'separator' },
        { role: 'quit', label: L('退出 Ready Library', 'Quit Ready Library') },
      ],
    }] : []),
    {
      label: L('文件', 'File'),
      submenu: [
        { label: isMac ? L('在访达中显示书库文件夹', 'Show Library Folder in Finder') : L('打开书库文件夹', 'Open Library Folder'), click: () => { fs.mkdirSync(LIBRARY(), { recursive: true }); shell.openPath(LIBRARY()); } },
        { type: 'separator' },
        { role: 'close', label: L('关闭窗口', 'Close Window') },
        ...(!isMac ? [{ role: 'quit', label: L('退出 Ready Library', 'Quit Ready Library') }] : []),
      ],
    },
    {
      label: L('编辑', 'Edit'),
      submenu: [
        { role: 'undo', label: L('撤销', 'Undo') },
        { role: 'redo', label: L('重做', 'Redo') },
        { type: 'separator' },
        { role: 'cut', label: L('剪切', 'Cut') },
        { role: 'copy', label: L('拷贝', 'Copy') },
        { role: 'paste', label: L('粘贴', 'Paste') },
        { role: 'pasteAndMatchStyle', label: L('粘贴并匹配样式', 'Paste and Match Style') },
        { role: 'delete', label: L('删除', 'Delete') },
        { role: 'selectAll', label: L('全选', 'Select All') },
      ],
    },
    {
      label: L('前往', 'Go'),
      submenu: [
        { label: L('书架', 'Shelf'), accelerator: 'CmdOrCtrl+1', click: go('#/') },
      ],
    },
    {
      label: L('显示', 'View'),
      submenu: [
        { role: 'reload', label: L('重新载入', 'Reload') },
        { role: 'toggleDevTools', label: L('开发者工具', 'Developer Tools') },
        { type: 'separator' },
        { role: 'resetZoom', label: L('实际大小', 'Actual Size') },
        { role: 'zoomIn', label: L('放大', 'Zoom In') },
        { role: 'zoomOut', label: L('缩小', 'Zoom Out') },
        { type: 'separator' },
        { role: 'togglefullscreen', label: L('进入全屏幕', 'Toggle Full Screen') },
      ],
    },
    {
      role: 'window', label: L('窗口', 'Window'),
      submenu: [
        { role: 'minimize', label: L('最小化', 'Minimize') },
        { role: 'zoom', label: L('缩放', 'Zoom') },
        ...(isMac ? [{ type: 'separator' }, { role: 'front', label: L('前置全部窗口', 'Bring All to Front') }] : []),
      ],
    },
    {
      role: 'help', label: L('帮助', 'Help'),
      submenu: [
        ...(!isMac ? [{ role: 'about', label: L('关于 Ready Library', 'About Ready Library') }] : []),
        { label: L('项目主页（GitHub）', 'Project page (GitHub)'), click: () => shell.openExternal(REPO) },
        { type: 'separator' },
        { label: L('许可证与字体、代码来源', 'Licences and credits'), click: () => shell.openPath(LICENSES) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(tpl));
}

/* ---------- lifecycle ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) return createWindow();
    if (win.isMinimized()) win.restore();
    win.focus();
  });

  app.whenReady().then(async () => {
    app.setAboutPanelOptions({
      applicationName: 'Ready Library',
      applicationVersion: app.getVersion(),
      version: `Electron ${process.versions.electron}`,
      copyright: '© ALBEDO-TABAI',
      website: REPO,
      iconPath: app.isPackaged ? undefined : path.join(__dirname, 'build', 'icon.png'),
    });
    if (!app.isPackaged && app.dock) app.dock.setIcon(path.join(__dirname, 'build', 'icon.png'));
    buildMenu();
    if (!fs.existsSync(path.join(WEB_ROOT, 'index.html')) || !fs.existsSync(SERVER)) {
      dialog.showErrorBox('Ready Library', `Missing the built app (${WEB_ROOT}) or its server (${SERVER}). Run npm run build first.`);
      app.quit();
      return;
    }
    // the library's folder must be known before the server's modules load (they read it once)
    process.env.READY_LIBRARY_DATA = LIBRARY();
    api = await import(pathToFileURL(SERVER).href);
    protocol.handle(SCHEME, handle);
    createWindow();
    app.on('activate', () => { if (!win) createWindow(); });
  });

  app.on('window-all-closed', () => app.quit());
}
