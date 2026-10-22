// Renders build/background.tiff (660×480 @1x + @2x) for the DMG window, in the same layout as Ready Poster Printer's,
// with this package's Electron. Run: node scripts/make-dmg-background.mjs
// Icon slots must match package.json → build.dmg.contents (app at 170,206 · Applications at 490,206).
// Finder's window frame takes the image size including its title bar, and a path bar may cover the bottom, so all
// text stays above y ≈ 410 and the rest is margin.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonts = join(root, '..', 'public/ui-fonts');
const font = (f) => `data:font/woff2;base64,${readFileSync(join(fonts, f)).toString('base64')}`;

const html = `<!doctype html><meta charset="utf-8"><style>
@font-face { font-family: 'RL Serif'; src: url(${font('InstrumentSerif.woff2')}); }
@font-face { font-family: 'RL Serif'; font-style: italic; src: url(${font('InstrumentSerifItalic.woff2')}); }
@font-face { font-family: 'Inter'; src: url(${font('Inter.woff2')}); font-weight: 100 900; }
* { margin: 0; box-sizing: border-box; }
html, body { width: 660px; height: 480px; overflow: hidden; }
body { position: relative; background: #f3f3f5; color: #0b0b0e; font-family: 'Inter', 'PingFang SC', sans-serif; -webkit-font-smoothing: antialiased; }
.grid { position: absolute; inset: 0 30px; display: grid; grid-template-columns: repeat(12, 1fr); column-gap: 12px; }
.grid i { border-left: 1px solid rgba(11,11,14,.045); border-right: 1px solid rgba(11,11,14,.045); }
.brand { position: absolute; top: 40px; left: 0; right: 0; text-align: center; font: 34px/1 'RL Serif', serif; letter-spacing: -.01em; }
.brand i { font-style: italic; }
.brand b { display: inline-block; width: 13px; height: 13px; border-radius: 50%; background: #ff5a1f; margin-right: 12px; vertical-align: 4px; }
.slogan { position: absolute; top: 86px; left: 0; right: 0; text-align: center; font-size: 11px; letter-spacing: .32em; padding-left: .32em; color: rgba(11,11,14,.46); }
.arrow { position: absolute; top: 205px; left: 262px; width: 136px; height: 1.5px; background: rgba(11,11,14,.3); }
.arrow::after { content: ''; position: absolute; right: -1px; top: -4.5px; width: 9px; height: 9px; border-top: 1.5px solid rgba(11,11,14,.3); border-right: 1.5px solid rgba(11,11,14,.3); transform: rotate(45deg); }
.arrow::before { content: ''; position: absolute; left: -4px; top: -3.5px; width: 8.5px; height: 8.5px; border-radius: 50%; background: #ff5a1f; }
.steps { position: absolute; left: 60px; right: 60px; top: 318px; border-top: 1px solid rgba(11,11,14,.1); padding-top: 14px; font-size: 11.5px; line-height: 1.75; color: rgba(11,11,14,.72); }
.steps p span { display: inline-block; width: 18px; color: #ff5a1f; font-weight: 600; }
.steps em { font-style: normal; color: #0b0b0e; font-weight: 500; }
.steps .en { margin-top: 4px; font-size: 10px; line-height: 1.5; color: rgba(11,11,14,.42); }
</style>
<div class="grid">${'<i></i>'.repeat(12)}</div>
<div class="brand"><b></b>Ready <i>Library</i></div>
<div class="slogan">架上取书 · 纸上翻页</div>
<div class="arrow"></div>
<div class="steps">
  <p><span>1</span>把左边的图标拖进右边的<em>「应用程序」</em>文件夹</p>
  <p><span>2</span>第一次打开如被拦下：打开<em>系统设置 → 隐私与安全性</em>，往下找到提示，点<em>「仍要打开」</em></p>
  <p class="en">Drag the app to Applications. Blocked on first launch? System Settings → Privacy &amp; Security → Open Anyway.</p>
</div>`;

const work = mkdtempSync(join(tmpdir(), 'rl-dmgbg-'));
const page = join(work, 'bg.html');
writeFileSync(page, html);
const electron = join(root, 'node_modules/.bin/electron');
for (const scale of [1, 2]) execFileSync(electron, [join(root, 'scripts/render.cjs'), page, join(work, scale === 1 ? 'bg.png' : 'bg@2x.png'), '660', '480', String(scale)], { stdio: 'inherit' });
execFileSync('tiffutil', ['-cathidpicheck', join(work, 'bg.png'), join(work, 'bg@2x.png'), '-out', join(root, 'build/background.tiff')]);
execFileSync('cp', [join(work, 'bg@2x.png'), join(root, 'build/background-preview.png')]);
rmSync(work, { recursive: true, force: true });
console.log('wrote build/background.tiff');
