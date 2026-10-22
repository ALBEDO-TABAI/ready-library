'use strict';
const { mkdtempSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const profile = mkdtempSync(path.join(tmpdir(), 'Ready Desktop 中文 & '));
const env = { ...process.env, RL_USER_DATA: profile, RL_HIDDEN: '1' };
if (process.argv.includes('--packaged')) env.RL_SMOKE_RESOURCES = path.resolve(__dirname, '../dist/win-unpacked/resources');
delete env.READY_LIBRARY_DATA;
delete env.ELECTRON_RUN_AS_NODE;
try {
  for (const mode of ['create', 'restore']) {
    const result = spawnSync(require('electron'), [path.join(__dirname, 'smoke.cjs'), mode], { env, stdio: 'inherit', windowsHide: true, timeout: 90_000 });
    if (result.error) throw result.error;
    if (result.status !== 0) throw new Error(`Desktop ${mode} failed (${result.status})`);
  }
} finally {
  rmSync(profile, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
}
