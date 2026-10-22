// Downloads run as jobs the page polls, whatever the source. A job is a plain object (sent to the page as is);
// anything that must not be sent — an abort controller, a pending captcha — lives in `inner` beside it.
import { newId } from './db.mjs';

const all = new Map();
const inner = new Map();

export function create(fields) {
  const j = { id: newId(), state: 'running', stage: '', pct: 0, line: '', error: '', startedAt: Date.now(), ...fields };
  all.set(j.id, j);
  inner.set(j.id, { ctl: new AbortController() });
  return j;
}
export const get = (id) => all.get(id) ?? null;
export const list = () => [...all.values()];
export const own = (id) => inner.get(id) ?? null;

/** A finished job stays a while, so a page that reloads still learns how it ended. */
export function finish(j, patch) {
  Object.assign(j, patch, { finishedAt: Date.now() });
  setTimeout(() => { all.delete(j.id); inner.delete(j.id); }, 10 * 60_000).unref();
}

export function cancel(id) {
  const j = all.get(id), o = inner.get(id);
  if (!j || j.state !== 'running') return false;
  o?.ctl.abort();
  o?.captcha?.reject(new Error('已取消'));
  // still waiting its turn: done now, not when the queue reaches it
  if (j.stage === 'queued') finish(j, { state: 'error', error: '已取消' });
  return true;
}
