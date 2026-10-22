// build/icon.svg -> build/icon.png (1024) and build/icon.icns, rendered by this package's Electron, resized with sips
// and packed with iconutil (both ship with macOS). Run: node scripts/make-icon.mjs
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const electron = join(root, 'node_modules/.bin/electron');
const work = mkdtempSync(join(tmpdir(), 'rl-icon-'));
const page = join(work, 'icon.html');
writeFileSync(page, `<!doctype html><style>html,body{margin:0;background:transparent}img{display:block}</style><img src="${join(root, 'build/icon.svg')}" width="1024" height="1024">`);
const master = join(root, 'build/icon.png');
execFileSync(electron, [join(root, 'scripts/render.cjs'), page, master, '1024', '1024', '1', '1'], { stdio: 'inherit' });
const set = join(work, 'icon.iconset');
execFileSync('mkdir', ['-p', set]);
for (const base of [16, 32, 128, 256, 512]) {
  for (const k of [1, 2]) {
    const px = base * k;
    execFileSync('sips', ['-z', String(px), String(px), master, '--out', join(set, `icon_${base}x${base}${k === 2 ? '@2x' : ''}.png`)], { stdio: 'ignore' });
  }
}
execFileSync('iconutil', ['-c', 'icns', set, '-o', join(root, 'build/icon.icns')]);
rmSync(work, { recursive: true, force: true });
console.log('wrote build/icon.png and build/icon.icns');
