// Renders an HTML file to a PNG with this package's own Electron (no other browser needed):
//   electron scripts/render.cjs <in.html> <out.png> <width> <height> [scale] [transparent]
// Used by make-icon.mjs and make-dmg-background.mjs.
'use strict';
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');

const [inp, out, w, h, scale = '1', transparent = '0'] = process.argv.slice(2);
app.dock?.hide();
app.whenReady().then(async () => {
  const k = Number(scale), W = Math.round(Number(w) * k), H = Math.round(Number(h) * k);
  const win = new BrowserWindow({ show: false, width: W, height: H, useContentSize: true, transparent: transparent === '1', backgroundColor: '#00000000', webPreferences: { offscreen: true } });
  let last = null;
  win.webContents.on('paint', (_e, _dirty, image) => { last = image; });
  win.webContents.setFrameRate(30);
  await win.loadFile(inp);
  await win.webContents.executeJavaScript(`document.documentElement.style.zoom = ${k}; document.fonts.ready.then(() => new Promise((r) => setTimeout(r, 400)))`);
  win.webContents.invalidate();
  await new Promise((r) => setTimeout(r, 300));
  if (!last) throw new Error('nothing painted');
  fs.writeFileSync(out, last.toPNG());
  app.quit();
});
