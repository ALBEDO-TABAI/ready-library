import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';

const system32 = () => join(process.env.SystemRoot || 'C:\\Windows', 'System32');

export function zlibBin() {
  if (process.env.ZLIB_BIN) return process.env.ZLIB_BIN;
  if (process.platform === 'win32' && process.env.LOCALAPPDATA) {
    const link = join(process.env.LOCALAPPDATA, 'Microsoft', 'WinGet', 'Links', 'zlib.exe');
    if (existsSync(link)) return link;
  }
  return 'zlib';
}

export function archiveTools(archive, out) {
  const bins = process.platform === 'win32'
    ? [join(system32(), 'tar.exe'), 'bsdtar'] : ['bsdtar', 'tar'];
  const tools = bins.map((bin) => [bin, ['-xf', archive, '-C', out]]);
  if (process.platform === 'win32') {
    for (const root of [process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      const bin = join(root, '7-Zip', '7z.exe');
      if (existsSync(bin)) tools.push([bin, ['x', '-y', `-o${out}`, archive]]);
    }
    tools.push(['7z.exe', ['x', '-y', `-o${out}`, archive]]);
  }
  return tools;
}

/** File names are arguments/environment values, never interpolated into shell code. */
export function openPath(path, open = true) {
  let bin, args;
  if (process.platform === 'win32') {
    bin = join(system32(), 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    const script = open
      ? "try { Start-Process -FilePath $env:READY_LIBRARY_OPEN_PATH -ErrorAction Stop } catch { exit 1 }"
      : "try { Start-Process -FilePath (Join-Path $env:SystemRoot 'explorer.exe') -ArgumentList ('/select,\"' + $env:READY_LIBRARY_OPEN_PATH + '\"') -ErrorAction Stop } catch { exit 1 }";
    args = ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(script, 'utf16le').toString('base64')];
  } else {
    bin = process.platform === 'darwin' ? 'open' : 'xdg-open';
    args = process.platform === 'darwin' ? (open ? [path] : ['-R', path]) : [open ? path : dirname(path)];
  }
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { windowsHide: true, stdio: 'ignore', env: { ...process.env, READY_LIBRARY_OPEN_PATH: path } });
    child.once('error', () => reject(new Error('无法启动系统阅读器或文件管理器，请检查系统默认应用设置')));
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error('无法打开文件，请先在 Windows 设置中为这种文件选择默认阅读器')));
  });
}
