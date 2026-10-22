// Build without a Unix shell or Windows .cmd shims (including paths containing &).
'use strict';
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { build } = require('esbuild');
const root = path.resolve(__dirname, '../..');
for (const args of [
  [require.resolve('electron/install.js')],
  ['scripts/pdf-assets.mjs'],
  [require.resolve('typescript/bin/tsc'), '-b'],
  [path.join(root, 'node_modules/vite/bin/vite.js'), 'build'],
]) execFileSync(process.execPath, args, { cwd: root, stdio: 'inherit', windowsHide: true });
build({ entryPoints: [path.join(root, 'server/api.mjs')], bundle: true, platform: 'node', format: 'esm', target: 'node22', logLevel: 'warning', outfile: path.join(root, 'desktop/app/server.mjs') }).catch(() => { process.exitCode = 1; });
