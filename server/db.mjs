// The library on disk: one JSON file of book records, the book files and their covers beside it.
// Everything lives under DATA (default ./data), so the whole library can be moved or backed up as one folder.
import { mkdirSync, readFileSync, writeFileSync, renameSync, existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { randomBytes } from 'node:crypto';

export const DATA = resolve(process.env.READY_LIBRARY_DATA || join(import.meta.dirname, '..', 'data'));
export const FILES = join(DATA, 'files');
export const COVERS = join(DATA, 'covers');
export const CACHE = join(DATA, 'cache');
for (const d of [DATA, FILES, COVERS, CACHE]) mkdirSync(d, { recursive: true });

const DB = join(DATA, 'library.json');
let state = { version: 1, books: [] };
if (existsSync(DB)) {
  try { state = JSON.parse(readFileSync(DB, 'utf8')); } catch (e) { console.warn('[library] library.json unreadable, starting empty:', e.message); }
}

let saveT = null;
/** Writes are coalesced and atomic (temp file + rename), so a crash never leaves half a library. */
function save() {
  clearTimeout(saveT);
  saveT = setTimeout(() => {
    const tmp = DB + '.tmp';
    writeFileSync(tmp, JSON.stringify(state, null, 1));
    renameSync(tmp, DB);
  }, 150);
}

export const newId = () => randomBytes(6).toString('base64url').replace(/[-_]/g, 'x');

export const books = () => state.books;
export const book = (id) => state.books.find((b) => b.id === id) ?? null;

export function addBook(rec) {
  const b = { id: newId(), addedAt: Date.now(), tags: [], status: 'ready', ...rec };
  state.books.push(b);
  save();
  return b;
}

/** Only these fields can be changed from the page; files, covers and sources are the server's. */
const EDITABLE = new Set(['title', 'author', 'topic', 'favorite', 'tags', 'progress', 'openedAt', 'finishedAt', 'words', 'pages', 'notes', 'bookmarks', 'highlights']);
export function patchBook(id, patch, { trusted = false } = {}) {
  const b = book(id);
  if (!b) return null;
  for (const [k, v] of Object.entries(patch)) if (trusted || EDITABLE.has(k)) b[k] = v;
  save();
  return b;
}

export function removeBook(id) {
  const i = state.books.findIndex((b) => b.id === id);
  if (i < 0) return null;
  const [b] = state.books.splice(i, 1);
  save();
  return b;
}
