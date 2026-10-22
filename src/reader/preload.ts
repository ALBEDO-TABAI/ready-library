// The book you are about to read, read ahead: while its open copy is in your hands on the shelf, the file is
// fetched and its chapters parsed, so the reader only has to set the pages.
import { fileUrl, type BookRec } from '../lib/api';
import { loadBook, type LoadedBook } from './book';

export const PAGED = new Set(['epub', 'txt', 'md']);
const ahead = new Map<string, { p: Promise<LoadedBook>; t: ReturnType<typeof setTimeout> }>();
const keyOf = (r: BookRec) => `${r.id}:${r.file?.size ?? 0}`;

export function readAhead(rec: BookRec) {
  const ext = rec.file?.ext, k = keyOf(rec);
  if (!ext || !PAGED.has(ext) || ahead.has(k)) return;
  const p = fetch(fileUrl(rec)).then((r) => { if (!r.ok) throw new Error(`读不到文件（HTTP ${r.status}）`); return r.arrayBuffer(); }).then((b) => loadBook(b, ext, rec.title));
  p.catch(() => drop(k));
  ahead.set(k, { p, t: setTimeout(() => drop(k), 120_000) });
}

/** The read-ahead copy, handed over once: the reader owns its picture URLs from then on. */
export function take(rec: BookRec): Promise<LoadedBook> | null {
  const k = keyOf(rec), e = ahead.get(k);
  if (!e) return null;
  ahead.delete(k); clearTimeout(e.t);
  return e.p;
}

function drop(k: string) {
  const e = ahead.get(k);
  if (!e) return;
  ahead.delete(k); clearTimeout(e.t);
  e.p.then((b) => b.urls.forEach((u) => URL.revokeObjectURL(u))).catch(() => {});
}
