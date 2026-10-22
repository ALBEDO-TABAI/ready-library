// The page's side of server/api.mjs.
import type { TopicKey } from './topics';

export type Progress = { pct: number; chapter: number; offset: number; at: number };
export type Bookmark = { chapter: number; offset: number; label: string; at: number };
export type Marker = 'yellow' | 'green' | 'blue' | 'pink' | 'pen';
/** A passage you marked: chapter + offsets in non-space characters (so it survives any type size), its words, a note. */
export type Highlight = { id: string; chapter: number; from: number; to: number; text: string; color: Marker; note?: string; at: number };

export type BookRec = {
  id: string;
  title: string;
  author: string;
  year?: number;
  publisher?: string;
  language?: string;
  description?: string;
  topic?: TopicKey;
  tags: string[];
  favorite?: boolean;
  source: 'local' | 'zlib' | 'treasure';
  sourceRef?: string;
  sourceUrl?: string;
  formats?: string[];
  file?: { name: string; ext: string; size: number };
  cover?: 'file';
  status: 'ready' | 'wish' | 'error';
  addedAt: number;
  openedAt?: number;
  finishedAt?: number;
  words?: number;
  progress?: Progress;
  bookmarks?: Bookmark[];
  highlights?: Highlight[];
};

export type TreasureHit = { id: string; title: string; author: string; cats: string[]; link: string; formats: string[]; language: string };
export type ZlibHit = {
  id: string; ref: string; title: string; author: string; year?: number; publisher: string; language: string; ext: string; size: string;
  cover: string; description: string; isbn: string; pages: string; categories: string; rating: string; url: string;
};
export type ZlibStatus = { installed: boolean; loggedIn: boolean; version?: string; quota?: { remaining: number; allowed: number; reset: string } | null; error: string };
export type TreasureStatus = { ready: boolean; loading: boolean; cached: boolean; count: number; updatedAt: number; error: string };
export type JobStage = '' | 'queued' | 'resolving' | 'waiting' | 'captcha' | 'downloading' | 'unpacking' | 'done';
/** A download running on the server: zlib's CLI, or a treasure-chest book fetched from CTFile. */
export type Job = {
  id: string; src: 'zlib' | 'treasure'; ref?: string; link?: string; title: string; attach?: string;
  state: 'running' | 'done' | 'error'; stage: JobStage; pct: number; line: string; error: string;
  /** the book on the shelf when it is done; `more` counts the other volumes of a set */
  book?: BookRec & { more?: number };
  captcha?: string; wait?: number; bytes?: number; total?: number; speed?: number; file?: string;
};

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch('/api' + path, init);
  const j = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw Object.assign(new Error(j.error || `HTTP ${res.status}`), { status: res.status });
  return j as T;
}
const body = (method: string, data: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(data) });

export const api = {
  library: () => call<{ books: BookRec[] }>('/library'),
  patch: (id: string, patch: Partial<BookRec>) => call<{ book: BookRec }>(`/books/${id}`, body('PATCH', patch)),
  remove: (id: string) => call<{ ok: true }>(`/books/${id}`, { method: 'DELETE' }),
  add: (rec: Partial<BookRec> & { cover?: string; topic?: TopicKey }) => call<{ book: BookRec; existed?: boolean }>('/books', body('POST', rec)),
  importFile: (file: File, attach?: string) =>
    call<{ book: BookRec }>(`/import?name=${encodeURIComponent(file.name)}${attach ? `&attach=${attach}` : ''}`, { method: 'PUT', body: file }),
  reveal: (id: string, open = false) => call<{ ok: true }>(`/books/${id}/reveal${open ? '?open=1' : ''}`, { method: 'POST' }),
  putCover: (id: string, blob: Blob) => call<{ book: BookRec }>(`/books/${id}/cover`, { method: 'PUT', body: blob, headers: { 'content-type': blob.type || 'image/jpeg' } }),
  sources: (force = false) => call<{ treasure: TreasureStatus; zlib: ZlibStatus }>(`/sources${force ? '?force=1' : ''}`),
  treasure: (q: string, cat = '', page = 1) => call<{ books: TreasureHit[]; total: number; page: number; pages: number }>(`/search?src=treasure&q=${encodeURIComponent(q)}&cat=${encodeURIComponent(cat)}&page=${page}`),
  categories: () => call<{ categories: { name: string; count: number }[] }>('/treasure/categories'),
  refreshTreasure: () => call<TreasureStatus>('/treasure/refresh', { method: 'POST' }),
  zlib: (q: string, page = 1, ext = '') => call<{ books: ZlibHit[]; page: number; pages: number }>(`/search?src=zlib&q=${encodeURIComponent(q)}&page=${page}&ext=${ext}`),
  zlibFeed: (kind: 'popular' | 'recommended') => call<{ books: ZlibHit[] }>(`/zlib/feed?kind=${kind}`),
  zlibDownload: (ref: string, meta: Record<string, unknown>, attach?: string) => call<{ job: Job }>('/zlib/download', body('POST', { ref, meta, attach })),
  job: (id: string) => call<{ job: Job }>(`/jobs/${id}`),
  jobs: () => call<{ jobs: Job[] }>('/jobs'),
  treasureFetch: (arg: { id: string } | { hit: TreasureHit & { topic?: TopicKey } }) => call<{ job: Job; book: BookRec }>('/treasure/fetch', body('POST', arg)),
  answer: (id: string, answer: string) => call<{ job: Job }>(`/jobs/${id}/answer`, body('POST', { answer })),
  newCaptcha: (id: string) => call<{ job: Job }>(`/jobs/${id}/captcha`, { method: 'POST' }),
  cancelJob: (id: string) => call<{ ok: boolean }>(`/jobs/${id}/cancel`, { method: 'POST' }),
};

export const fileUrl = (b: Pick<BookRec, 'id'>) => `/api/books/${b.id}/file`;
export const coverUrl = (b: Pick<BookRec, 'id' | 'cover'>, v = '') => (b.cover === 'file' ? `/api/books/${b.id}/cover${v ? `?v=${v}` : ''}` : undefined);
export const proxied = (u: string) => (u ? `/api/cover?u=${encodeURIComponent(u)}` : '');
