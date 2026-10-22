import { create } from 'zustand';
import { api, type BookRec, type Job, type TreasureHit } from './api';
import { topicFor, type TopicKey } from './topics';

export type Toast = { id: number; text: string; kind?: 'ok' | 'bad'; action?: { label: string; run: () => void } };
export type Route = { name: 'library' } | { name: 'read'; id: string };

const routeOf = (hash: string): Route => {
  const m = hash.match(/^#\/read\/([A-Za-z0-9]+)/);
  return m ? { name: 'read', id: m[1] } : { name: 'library' };
};

type State = {
  hydrated: boolean;
  /** the start screen has lifted (the shelf plays its entrance then) */
  awake: boolean;
  books: BookRec[];
  route: Route;
  theme: 'light' | 'dark';
  finding: boolean;
  findQuery: string;
  jobs: Record<string, Job>;
  /** why the last fetch of a book failed, shown on the book until it is fetched */
  jobErrors: Record<string, string>;
  toasts: Toast[];
  /** "Start reading" from an open book: it stays on screen, grown to where the reader's pages will be, until they are ready. */
  handoff: { id: string; ready: boolean; placed: boolean } | null;
  /** how the reader was entered when it was by ↑ ↓ from another book's cover: open at the cover, coming from that side */
  browse: { id: string; dir: 1 | -1 } | null;

  hydrate: () => Promise<void>;
  go: (r: Route, opts?: { handoff?: boolean; browse?: 1 | -1 }) => void;
  /** the reader's pages are drawn */
  handoffReady: () => void;
  /** the open book has grown into the reader's place */
  handoffPlaced: () => void;
  setTheme: (t: 'light' | 'dark') => void;
  openFind: (q?: string) => void;
  closeFind: () => void;
  toast: (t: Omit<Toast, 'id'>, ms?: number) => void;
  dismiss: (id: number) => void;

  patch: (id: string, patch: Partial<BookRec>) => Promise<void>;
  remove: (id: string) => Promise<void>;
  upsert: (b: BookRec) => void;
  importFiles: (files: File[], attach?: string) => Promise<BookRec[]>;
  download: (ref: string, title: string, meta: Record<string, unknown>, attach?: string) => Promise<void>;
  /** A treasure-chest book: onto the shelf, then fetched, unpacked and attached in the background. */
  fetchTreasure: (arg: { id: string } | { hit: TreasureHit }) => Promise<void>;
  track: (job: Job) => void;
  answerCaptcha: (id: string, answer: string) => Promise<void>;
  newCaptcha: (id: string) => Promise<void>;
  cancelJob: (id: string) => Promise<void>;
};

let toastN = 0;
const tracking = new Set<string>();
const THEME_KEY = 'rl:theme';
const initialTheme = (): 'light' | 'dark' => {
  try { const t = localStorage.getItem(THEME_KEY); if (t === 'light' || t === 'dark') return t; } catch {}
  return matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
};

/** Books saved before they had a topic get one from what we know about them, and keep it. */
const withTopic = (b: BookRec): BookRec => (b.topic ? b : { ...b, topic: topicFor({ cats: b.tags, title: b.title }) as TopicKey });

export const useStore = create<State>((set, get) => ({
  hydrated: false,
  awake: false,
  books: [],
  route: routeOf(location.hash),
  theme: initialTheme(),
  finding: false,
  findQuery: '',
  jobs: {},
  jobErrors: {},
  toasts: [],
  handoff: null,
  browse: null,

  hydrate: async () => {
    try {
      const { books } = await api.library();
      set({ books: books.map(withTopic), hydrated: true });
      // downloads that were running before a reload carry on in the background; keep showing them
      api.jobs().then(({ jobs }) => jobs.filter((j) => j.state === 'running').forEach((j) => get().track(j))).catch(() => {});
    } catch (e) {
      set({ hydrated: true });
      get().toast({ text: `读不到书架：${(e as Error).message}`, kind: 'bad' }, 8000);
    }
  },
  go: (r, opts) => {
    const hash = r.name === 'read' ? `#/read/${r.id}` : '#/';
    // browsing from book to book replaces the history entry: Back still goes to the shelf
    if (location.hash !== hash) (opts?.browse ? history.replaceState : history.pushState).call(history, null, '', hash);
    set({
      route: r,
      handoff: r.name === 'read' && opts?.handoff ? { id: r.id, ready: false, placed: false } : null,
      browse: r.name === 'read' && opts?.browse ? { id: r.id, dir: opts.browse } : null,
    });
  },
  handoffReady: () => { const h = get().handoff; if (h && !h.ready) set({ handoff: { ...h, ready: true } }); },
  handoffPlaced: () => { const h = get().handoff; if (h && !h.placed) set({ handoff: { ...h, placed: true } }); },
  setTheme: (t) => {
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem(THEME_KEY, t); } catch {}
    set({ theme: t });
  },
  openFind: (q) => set({ finding: true, findQuery: q ?? get().findQuery }),
  closeFind: () => set({ finding: false }),
  toast: (t, ms = 4200) => {
    const id = ++toastN;
    set((s) => ({ toasts: [...s.toasts, { ...t, id }].slice(-4) }));
    setTimeout(() => get().dismiss(id), ms);
  },
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  upsert: (b) => set((s) => {
    const nb = withTopic(b);
    const i = s.books.findIndex((x) => x.id === b.id);
    return { books: i < 0 ? [...s.books, nb] : s.books.map((x) => (x.id === b.id ? { ...x, ...nb } : x)) };
  }),
  patch: async (id, patch) => {
    set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, ...patch } : b)) }));
    try { await api.patch(id, patch); } catch (e) { get().toast({ text: `没保存上：${(e as Error).message}`, kind: 'bad' }); }
  },
  remove: async (id) => {
    const before = get().books;
    set({ books: before.filter((b) => b.id !== id) });
    try { await api.remove(id); } catch (e) { set({ books: before }); get().toast({ text: `没能拿下书架：${(e as Error).message}`, kind: 'bad' }); }
  },
  importFiles: async (files, attach) => {
    const out: BookRec[] = [];
    for (const f of files) {
      try {
        const { book } = await api.importFile(f, attach);
        get().upsert(book);
        out.push(book);
      } catch (e) {
        get().toast({ text: `${f.name}：${(e as Error).message}`, kind: 'bad' }, 7000);
      }
    }
    if (out.length) get().toast({ text: out.length === 1 ? `《${out[0].title}》上架了` : `${out.length} 本书上架了`, kind: 'ok' });
    return out;
  },
  download: async (ref, title, meta, attach) => {
    try {
      const { job } = await api.zlibDownload(ref, meta, attach);
      get().track({ ...job, title, attach });
    } catch (e) {
      get().toast({ text: `没能开始下载：${(e as Error).message}`, kind: 'bad' }, 8000);
    }
  },
  fetchTreasure: async (arg) => {
    try {
      const hit = 'hit' in arg ? { ...arg.hit, topic: topicFor({ cats: arg.hit.cats, title: arg.hit.title }) as TopicKey } : undefined;
      const { job, book } = await api.treasureFetch(hit ? { hit } : (arg as { id: string }));
      get().upsert(book);
      get().track(job);
    } catch (e) {
      get().toast({ text: `没能开始取回：${(e as Error).message}`, kind: 'bad' }, 8000);
    }
  },
  track: (job) => {
    // the same link fetched twice gets the job already running; it is polled once
    if (tracking.has(job.id)) return;
    tracking.add(job.id);
    set((s) => ({ jobs: { ...s.jobs, [job.id]: { ...s.jobs[job.id], ...job } } }));
    const poll = async () => {
      try {
        const { job: j } = await api.job(job.id);
        set((s) => ({ jobs: { ...s.jobs, [j.id]: { ...s.jobs[j.id], ...j } } }));
        if (j.state === 'running') return void setTimeout(poll, j.stage === 'downloading' ? 900 : 600);
        tracking.delete(j.id);
        const label = j.title || j.book?.title || '';
        if (j.attach) set((s) => { const { [j.attach!]: _, ...rest } = s.jobErrors; return { jobErrors: j.state === 'error' && j.error !== '已取消' ? { ...rest, [j.attach!]: j.error } : rest }; });
        if (j.state === 'done' && j.book) {
          const { more = 0, ...b } = j.book;
          get().upsert(b);
          // the other volumes of a set arrived as books of their own
          if (more > 0) api.library().then(({ books }) => set({ books: books.map(withTopic) })).catch(() => {});
          get().toast({ text: more ? `《${b.title}》等 ${more + 1} 本已上架` : `《${b.title}》已${j.src === 'treasure' ? '取回' : '下载'}上架`, kind: 'ok', action: { label: '去读', run: () => get().go({ name: 'read', id: b.id }) } }, 7000);
        } else if (j.error === '已取消') get().toast({ text: `已停止取回《${label}》` }, 3000);
        else get().toast({ text: `《${label}》没${j.src === 'treasure' ? '取回来' : '下载成功'}：${j.error}`, kind: 'bad', action: j.link ? { label: '去网盘', run: () => window.open(j.link, '_blank', 'noopener') } : undefined }, 10000);
        // the finished job lingers a moment (the shelf shows it landing), then goes
        setTimeout(() => set((s) => { const { [j.id]: _, ...rest } = s.jobs; return { jobs: rest }; }), j.state === 'error' ? 1500 : 4000);
      } catch { setTimeout(poll, 1500); }
    };
    setTimeout(poll, 500);
  },
  answerCaptcha: async (id, answer) => {
    try {
      await api.answer(id, answer);
      set((s) => (s.jobs[id] ? { jobs: { ...s.jobs, [id]: { ...s.jobs[id], captcha: undefined, stage: 'resolving', line: '核对验证码…' } } } : {}));
    } catch (e) { get().toast({ text: (e as Error).message, kind: 'bad' }); }
  },
  newCaptcha: async (id) => {
    try { const { job } = await api.newCaptcha(id); set((s) => ({ jobs: { ...s.jobs, [id]: { ...s.jobs[id], ...job } } })); }
    catch (e) { get().toast({ text: (e as Error).message, kind: 'bad' }); }
  },
  cancelJob: async (id) => { try { await api.cancelJob(id); } catch (e) { get().toast({ text: (e as Error).message, kind: 'bad' }); } },
}));

window.addEventListener('popstate', () => useStore.setState({ route: routeOf(location.hash), handoff: null, browse: null }));
document.documentElement.dataset.theme = useStore.getState().theme;
