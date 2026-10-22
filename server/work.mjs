// Where downloads, unpacking and imports happen: one folder per task under data/cache/work/, named after the process
// that owns it. A task moves what reaches the shelf out of its folder (a rename, never a copy) and the folder is then
// removed however the task ended — shelved, failed, cancelled — taking every other format, partial download and
// unpacked extra with it. At start, folders whose process is gone (the app quit or crashed mid-download) are swept,
// along with the loose temp files older versions left in data/cache/, and cover thumbnails nobody has shown in a month.
import { mkdirSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE, newId } from './db.mjs';

export const WORK = join(CACHE, 'work');
mkdirSync(WORK, { recursive: true });

/** A fresh folder for one task. */
export function workDir(tag) {
  const dir = join(WORK, `${process.pid}-${tag}-${newId()}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Remove a task's folder (and whatever is still in it). */
export function drop(dir) {
  try { rmSync(dir, { recursive: true, force: true }); } catch (e) { console.warn('[work] could not remove', dir, e.message); }
}

const alive = (pid) => {
  if (pid === process.pid) return true;
  try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; }
};
const HOUR = 3600_000, MONTH = 30 * 24 * HOUR;

/** Cover thumbnails are kept while they are being shown; a hit refreshes the clock. */
export function touch(file) {
  const now = new Date();
  try { utimesSync(file, now, now); } catch {}
}

/** Clear what earlier runs left behind. Returns what was removed, for the log. */
export function sweep() {
  const gone = { work: 0, loose: 0, covers: 0 };
  const now = Date.now();
  for (const f of readdirSync(WORK)) {
    const pid = Number(f.split('-')[0]);
    if (Number.isInteger(pid) && alive(pid)) continue;   // a task of a process still running: not ours to clear
    drop(join(WORK, f)); gone.work++;
  }
  for (const f of readdirSync(CACHE)) {
    const p = join(CACHE, f);
    let st;
    try { st = statSync(p); } catch { continue; }
    // older versions put their temp files straight into data/cache (up- uploads, dl- zlib downloads, x- unpacking)
    if (/^(up|dl|x)-/.test(f) && now - st.mtimeMs > HOUR) { drop(p); gone.loose++; }
    else if (/^cv-/.test(f) && now - st.mtimeMs > MONTH) { drop(p); gone.covers++; }
  }
  if (gone.work || gone.loose || gone.covers) console.log(`[work] cleared ${gone.work} unfinished task folder(s), ${gone.loose} old temp file(s), ${gone.covers} unused cover thumbnail(s)`);
  return gone;
}
