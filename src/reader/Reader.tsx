import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api, coverUrl, fileUrl, type BookRec, type Bookmark, type Highlight, type Marker } from '../lib/api';
import { hash, lookOf, TOPIC } from '../lib/topics';
import { shelfBook } from '../library/Library';
import { Icon } from '../ui/Icon';
import { LSeg } from '../ui/controls';
import G from '../ui/glass/glass';
import { loadBook, type LoadedBook, type TocItem } from './book';
import { fontStack, PAPERS, paginate, type Layout, type Page, type Typo } from './paginate';
import { createFlipbook } from './flipbook.js';
import { anchorOf, chapterText, pagesOf, paintMarks, sliceNonWs } from './marks';
import { Lens, MarginNotes, NotesList, type Box, type LensState, type MarginItem } from './Notes';
import { PAGED, take } from './preload';
import pageCss from './page.css?raw';

type Flip = ReturnType<typeof createFlipbook>;
type View = { a: number; b: number; count: number; spread: boolean; atStart: boolean; atEnd: boolean };
type Pos = { chapter: number; offset: number };
type Panel = 'toc' | 'marks' | 'notes' | 'type' | null;

const TYPO_KEY = 'rl:typo', MARK_KEY = 'rl:marker';
const defaultTypo = (): Typo => {
  const dark = document.documentElement.dataset.theme === 'dark';
  try { const t = JSON.parse(localStorage.getItem(TYPO_KEY) || ''); if (t?.size) return t; } catch {}
  return { size: 18, lead: 1.8, font: 'song', paper: dark ? 'night' : 'cream' };
};
const uid = () => Math.random().toString(36).slice(2, 10);
const boxOf = (rs: DOMRect[]): Box | null => (rs.length ? { left: Math.min(...rs.map((r) => r.left)), top: Math.min(...rs.map((r) => r.top)), right: Math.max(...rs.map((r) => r.right)), bottom: Math.max(...rs.map((r) => r.bottom)) } : null);

/* The page stylesheet lives in the document for the DOM pages, and travels inside every WebGL page raster
   with the mono face inlined (an SVG image can't fetch fonts). */
let rasterCss: Promise<string> | null = null;
function pageStyles() {
  if (!document.getElementById('rl-page-css')) {
    const s = document.createElement('style'); s.id = 'rl-page-css'; s.textContent = pageCss; document.head.appendChild(s);
  }
  rasterCss ??= fetch('/ui-fonts/GeistMono.woff2').then((r) => r.arrayBuffer()).then((b) => {
    let bin = ''; const u = new Uint8Array(b);
    for (let i = 0; i < u.length; i += 0x8000) bin += String.fromCharCode(...u.subarray(i, i + 0x8000));
    return `@font-face{font-family:'RL Mono';src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');font-weight:100 900}\n${pageCss}`;
  }).catch(() => pageCss);
  return rasterCss;
}
const rgb = (hex: string) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255); };
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** The file of a book, parsed: the copy read ahead while it lay open on the shelf, or fetched now. Kept per book
 *  so a remounted effect (React's dev double run) picks up the same load instead of starting another. */
const loading = new Map<string, Promise<LoadedBook>>();
function bookFile(rec: BookRec, ext: string) {
  const k = `${rec.id}:${rec.file?.size ?? 0}`;
  let p = loading.get(k);
  if (!p) {
    p = take(rec) ?? fetch(fileUrl(rec)).then((r) => { if (!r.ok) throw new Error(`读不到文件（HTTP ${r.status}）`); return r.arrayBuffer(); }).then((b) => loadBook(b, ext, rec.title));
    loading.set(k, p);
    p.finally(() => setTimeout(() => loading.delete(k), 1000));
  }
  return p;
}

export default function Reader({ id, onUp }: { id: string; onUp?: () => void }) {
  const rec = useStore((s) => s.books.find((b) => b.id === id));
  const hydrated = useStore((s) => s.hydrated);
  const handoff = useStore((s) => (s.handoff?.id === id ? s.handoff : null));
  const S = useStore.getState;
  const [typo, setTypo] = useState<Typo>(defaultTypo);
  const [single, setSingle] = useState(() => { try { return localStorage.getItem('rl:single') === '1'; } catch { return false; } });
  const [book, setBook] = useState<LoadedBook | null>(null);
  const [layout, setLayout] = useState<Layout | null>(null);
  const [phase, setPhase] = useState<'loading' | 'setting' | 'ready' | 'error' | 'pdf' | 'external'>('loading');
  const [progress, setProgress] = useState(0);
  const [error, setError] = useState('');
  const [view, setView] = useState<View | null>(null);
  const [panel, setPanel] = useState<Panel>(null);
  const [hover, setHover] = useState<{ x: number; label: string } | null>(null);
  const [shown, setShown] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [turning, setTurning] = useState(false);
  const [lens, setLens] = useState<LensState | null>(null);
  const [marker, setMarker] = useState<Marker>(() => { try { return (localStorage.getItem(MARK_KEY) as Marker) || 'yellow'; } catch { return 'yellow'; } });
  const [margin, setMargin] = useState<MarginItem[]>([]);
  const [tick, setTick] = useState(0);
  const stageRef = useRef<HTMLDivElement>(null), bookRef = useRef<HTMLDivElement>(null);
  const flipRef = useRef<Flip | null>(null);
  const posRef = useRef<Pos | null>(rec?.progress ? { chapter: rec.progress.chapter, offset: rec.progress.offset } : null);
  const pending = useRef<Partial<BookRec> | null>(null), saveT = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hls = useMemo(() => rec?.highlights ?? [], [rec?.highlights]);
  const hlRef = useRef<Highlight[]>(hls);
  hlRef.current = hls;
  const swallowAt = useRef(0), handed = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { onUp?.(); }, []);
  useEffect(() => { try { localStorage.setItem(TYPO_KEY, JSON.stringify(typo)); } catch {} }, [typo]);
  useEffect(() => { try { localStorage.setItem('rl:single', single ? '1' : '0'); } catch {} }, [single]);
  useEffect(() => { try { localStorage.setItem(MARK_KEY, marker); } catch {} }, [marker]);

  /** The reading position is saved a moment after the pages settle; leaving saves it at once. */
  const flush = useCallback(() => { clearTimeout(saveT.current); if (pending.current) { S().patch(id, pending.current); pending.current = null; } }, [S, id]);
  useEffect(() => flush, [flush]);
  /** The open book on the shelf (if you came from one) can step aside now. */
  const handOver = useCallback(() => { if (!handed.current) { handed.current = true; S().handoffReady(); } }, [S]);

  // 1 · the file → chapters
  useEffect(() => {
    if (!rec) return;
    const ext = rec.file?.ext;
    if (!ext) { setPhase('error'); setError('这本书的文件还没到。回书架打开它，可以自动取回或者导入文件。'); return; }
    if (ext === 'pdf') { setPhase('pdf'); return; }
    if (!PAGED.has(ext)) { setPhase('external'); return; }
    let live = true;
    S().patch(rec.id, { openedAt: Date.now() });
    bookFile(rec, ext).then((loaded) => {
      if (!live) return;
      if (!loaded.chapters.length) throw new Error('这本书里没有找到可以排版的正文。');
      setBook(loaded);
      if (loaded.chars && Math.abs((rec.words ?? 0) - loaded.chars) > 100) S().patch(rec.id, { words: loaded.chars });
    }).catch((e) => { if (live) { setPhase('error'); setError((e as Error).message); } });
    return () => { live = false; };
    // the file, once
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rec?.id, rec?.file?.ext]);
  useEffect(() => () => { book?.urls.forEach((u) => URL.revokeObjectURL(u)); }, [book]);
  useEffect(() => { if (phase === 'error' || phase === 'pdf' || phase === 'external') handOver(); }, [phase, handOver]);

  const latin = !!book && !/^zh|^ja|^ko/i.test(book.lang) && !/[㐀-鿿]/.test(book.chapters[0]?.html.slice(0, 3000) ?? '');
  const tocItems: TocItem[] = useMemo(() => {
    if (!book) return [];
    const t = book.toc.filter((x) => x.depth <= 1);
    return t.length ? t : book.chapters.map((c, i) => ({ label: c.title || `第 ${i + 1} 章`, chapter: i, depth: 0 }));
  }, [book]);

  // 2 · chapters → pages (again whenever the type changes; the reading position is kept)
  useEffect(() => {
    if (!book) return;
    const ctl = new AbortController();
    setPhase('setting'); setProgress(0);
    const t0 = performance.now();
    pageStyles().then(() => paginate(book, typo, { latin, tocRows: tocItems.length, onProgress: setProgress, signal: ctl.signal }))
      .then((l) => {
        console.info(`[reader] ${l.pages.length} pages in ${Math.round(performance.now() - t0)} ms`);
        setLayout(l); setPhase('ready');
      })
      .catch((e) => { if ((e as Error).name !== 'AbortError') { setPhase('error'); setError((e as Error).message); } });
    return () => ctl.abort();
    // typography only; paper colour does not change the layout
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book, typo.size, typo.lead, typo.font, latin, tocItems.length]);

  /** The contents entry a page falls under, found by page number: one file can hold dozens of chapters. */
  const titleAt = useMemo(() => {
    const at = layout ? tocItems.map((t) => ({ label: t.label, p: t.anchor ? layout.idPage.get(`${t.chapter}#${t.anchor}`) ?? layout.chapterPage[t.chapter] : layout.chapterPage[t.chapter] })).filter((x) => x.p != null).sort((a, b) => a.p - b.p) : [];
    return (i: number) => { let best = ''; for (const x of at) { if (x.p <= i) best = x.label; else break; } return best; };
  }, [layout, tocItems]);
  const look = rec ? lookOf(shelfBook(rec)) : null;
  const paper = PAPERS[typo.paper];
  const pageOf = useCallback((p: Pos) => {
    if (!layout) return 1;
    let best = layout.chapterPage[p.chapter] ?? layout.firstText;
    for (let i = best; i < layout.pages.length; i++) {
      const pg = layout.pages[i];
      if (pg.kind !== 'text' || pg.chapter !== p.chapter) { if (pg.chapter > p.chapter) break; continue; }
      if (pg.start <= p.offset) best = i; else break;
    }
    return best + 1;
  }, [layout]);

  /* ---------- highlights ---------- */
  const closeLens = useCallback((why?: 'outside' | 'done') => {
    // a press that only closed the popover must not also turn the page
    if (why === 'outside') swallowAt.current = performance.now();
    setLens(null);
    getSelection()?.removeAllRanges();
    flipRef.current?.selecting(false);
  }, []);
  const markBox = (hid: string, el?: Element | null) => {
    const sheet = (el ?? bookRef.current?.querySelector(`.leaf mark[data-hl="${hid}"]`))?.closest('.sheet');
    return boxOf([...(sheet?.querySelectorAll(`mark[data-hl="${hid}"]`) ?? [])].flatMap((m) => [...m.getClientRects()]));
  };
  const openMark = (hid: string, el?: Element | null, noting = false) => { const at = markBox(hid, el); if (at) setLens({ at, id: hid, noting }); };
  /** Highlights changed: saved with the book, and the pages they touch are printed again. */
  const saveHls = (list: Highlight[], touched: Highlight[]) => {
    if (!rec) return;
    const sorted = [...list].sort((a, b) => a.chapter - b.chapter || a.from - b.from);
    hlRef.current = sorted;
    S().patch(rec.id, { highlights: sorted });
    if (layout) flipRef.current?.repaint([...new Set(touched.flatMap((h) => pagesOf(layout, h)))]);
    setTick((t) => t + 1);
  };
  /** A new highlight; one that overlaps others absorbs them (and keeps their notes). */
  const create = (d: NonNullable<LensState['draft']>, color: Marker) => {
    const over = hlRef.current.filter((x) => x.chapter === d.chapter && x.from < d.to && x.to > d.from);
    let h: Highlight = { id: uid(), chapter: d.chapter, from: d.from, to: d.to, text: d.text, color, at: Date.now() };
    if (over.length && layout) {
      const from = Math.min(h.from, ...over.map((o) => o.from)), to = Math.max(h.to, ...over.map((o) => o.to));
      const note = over.map((o) => o.note).filter(Boolean).join('\n\n') || undefined;
      h = { ...h, from, to, note, text: sliceNonWs(chapterText(layout, d.chapter), from, to).replace(/\s+/g, ' ').trim().slice(0, 4000) };
    }
    saveHls([...hlRef.current.filter((x) => !over.includes(x)), h], [h, ...over]);
    return h;
  };
  const lensHl = lens?.id ? hls.find((h) => h.id === lens.id) : undefined;
  const pick = (color: Marker) => {
    setMarker(color);
    if (lensHl) saveHls(hlRef.current.map((x) => (x.id === lensHl.id ? { ...x, color } : x)), [lensHl]);
    else if (lens?.draft) create(lens.draft, color);
    closeLens('done');
  };
  const write = () => {
    if (lens?.draft) {
      const h = create(lens.draft, marker);
      getSelection()?.removeAllRanges();
      requestAnimationFrame(() => openMark(h.id, null, true));
    } else if (lens?.id) setLens({ ...lens, noting: true });
  };
  const note = (text: string) => {
    const h = lens?.id ? hlRef.current.find((x) => x.id === lens.id) : undefined;
    const v = text.trim() || undefined;
    if (h && (h.note ?? undefined) !== v) saveHls(hlRef.current.map((x) => (x.id === h.id ? { ...x, note: v } : x)), [h]);
  };
  const copy = () => {
    const text = lensHl?.text ?? lens?.draft?.text ?? '';
    navigator.clipboard?.writeText(`${text}\n——${rec?.author ? `${rec.author}《` : '《'}${rec?.title}》`).then(() => S().toast({ text: '已复制', kind: 'ok' }, 1600)).catch(() => {});
    closeLens('done');
  };
  const erase = () => { if (lensHl) saveHls(hlRef.current.filter((x) => x.id !== lensHl.id), [lensHl]); closeLens('done'); };

  // 3 · pages → the paper book
  useEffect(() => {
    if (!layout || !book || !rec || !stageRef.current || !bookRef.current) return;
    let flip: Flip | null = null, live = true;
    const textPages = layout.pages.filter((p) => p.kind === 'text').length || 1;
    const sheetOf = (i: number) => renderSheet(i, layout, book, rec, typo, latin, tocItems, look?.color ?? '#3c3f8f', look?.fg ?? '#f6efe2', hlRef.current, titleAt);
    pageStyles().then((css) => {
      if (!live) return;
      // a book not started opens where its text does (a chapter opening on a right-hand page)
      const start = posRef.current ? pageOf(posRef.current) : layout.firstText + 1;
      flip = createFlipbook({
        stage: stageRef.current!, book: bookRef.current!, count: layout.pages.length, single,
        page: sheetOf,
        blank: () => { const d = document.createElement('div'); d.className = 'sheet'; d.style.cssText = `--pp:${paper.pp};--pi:${paper.pi}`; return d; },
        look: { css, root: `font-family:${fontStack(typo.font, latin)}`, paper: rgb(paper.pp) },
        // dark paper: less sheen and fibre, or the lighting model reads it as wet card
        params: typo.paper === 'night' ? { ks: 0.22, grainK: 0.03, show: 0, gutter: 0.18 } : undefined,
        startPage: start,
        selectable: true,
        onSelect: (sel) => {
          const a = anchorOf(sel, layout);
          if (!a) { sel.removeAllRanges(); flip?.selecting(false); return; }
          swallowAt.current = 0;
          const at = boxOf([...sel.getRangeAt(0).getClientRects()].filter((r) => r.width > 1));
          if (at) setLens({ at, draft: a });
        },
        onMark: (hid, el) => openMark(hid, el),
        onBusy: (b) => { setTurning(b); if (b) { setLens(null); getSelection()?.removeAllRanges(); flip?.selecting(false); } },
        clickGuard: () => { const s = performance.now() - swallowAt.current < 700; swallowAt.current = 0; return s; },
        onChange: (v: View) => {
          setView(v);
          // the reading position is the first text page in view
          const idx = [v.a - 1, v.b - 1].map((i) => layout.pages[i]).find((p) => p?.kind === 'text');
          if (!idx) return;
          posRef.current = { chapter: idx.chapter, offset: idx.start };
          const n = layout.pages.slice(0, v.b).filter((p) => p.kind === 'text').length;
          const pct = Math.min(1, n / textPages);
          pending.current = { progress: { pct: pct >= 0.995 ? 1 : pct, chapter: idx.chapter, offset: idx.start, at: Date.now() }, ...(pct >= 0.995 && !rec.finishedAt ? { finishedAt: Date.now() } : {}) };
          clearTimeout(saveT.current);
          saveT.current = setTimeout(flush, 600);
        },
      });
      flipRef.current = flip;
      // shown once the open spread's pages are drawn, so it fades in whole instead of popping from DOM to GL
      flip.ready.then(() => { if (live) { setShown(true); handOver(); } });
      if (import.meta.env.DEV) (window as unknown as { __flip: Flip }).__flip = flip;
    });
    return () => { live = false; flip?.dispose(); flipRef.current = null; setLens(null); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, typo.paper, single]);

  useEffect(() => {
    const T = rec ? TOPIC[shelfBook(rec).topic] : null;
    G.setAmbient?.(T ? T.shades[0] : '#c8beb4');
  }, [rec]);

  /* notes in the margins: where their passages are on the open spread, with room beside the page for them */
  const measure = useCallback(() => {
    const L = layout, v = view, el = bookRef.current;
    const noted = hlRef.current.filter((h) => h.note);
    if (!L || !v || !el || !noted.length) return setMargin((m) => (m.length ? [] : m));
    const items: MarginItem[] = [], seen = new Set<string>();
    for (const pi of new Set([v.a - 1, v.b - 1])) {
      const pg = L.pages[pi];
      if (pg?.kind !== 'text') continue;
      const sheet = el.querySelector<HTMLElement>(`.leaf .sheet[data-pi="${pi}"]`);
      if (!sheet) continue;
      const pr = sheet.getBoundingClientRect();
      const side = v.spread && pi % 2 === 1 ? 'l' : 'r';
      const w = Math.min(250, side === 'r' ? innerWidth - pr.right - 44 : pr.left - 44);
      if (w < 150) continue;
      const x = side === 'r' ? pr.right + 26 : pr.left - 26 - w;
      for (const h of noted) {
        if (h.chapter !== pg.chapter || seen.has(h.id)) continue;
        const m = sheet.querySelector<HTMLElement>(`mark[data-hl="${h.id}"]`);
        if (!m) continue;
        seen.add(h.id);
        const r = m.getClientRects()[0] ?? m.getBoundingClientRect();
        items.push({ h, side, y: r.top + r.height / 2, edge: side === 'r' ? pr.right : pr.left, x, w });
      }
    }
    setMargin(items);
  }, [layout, view]);
  useEffect(() => {
    if (turning) return;
    measure();
    const t = setTimeout(measure, 760); // after the book slides (opening from the cover, closing at the end)
    return () => clearTimeout(t);
  }, [measure, turning, tick, hls, panel]);
  useEffect(() => { const f = () => setTick((t) => t + 1); addEventListener('resize', f); return () => removeEventListener('resize', f); }, []);

  // keys: T contents, B bookmark, N notes, Esc closes the popover or a panel, or goes back to the shelf
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.target as HTMLElement).closest?.('input, textarea, select')) return;
      if (e.key === 'Escape') { e.preventDefault(); if (lens) closeLens('done'); else if (panel) setPanel(null); else back(); }
      else if (e.metaKey || e.ctrlKey || e.altKey) return;
      else if (e.key === 't') setPanel((p) => (p === 'toc' ? null : 'toc'));
      else if (e.key === 'n') setPanel((p) => (p === 'notes' ? null : 'notes'));
      else if (e.key === 'b') toggleMark();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  const back = () => { flush(); setLeaving(true); setTimeout(() => S().go({ name: 'library' }), 220); };
  const marks = rec?.bookmarks ?? [];
  const curPage = view ? (layout?.pages[view.a - 1]?.kind === 'text' ? view.a : view.b) : 0;
  const curMark = posRef.current && marks.find((m) => layout && pageOf(m) >= (view?.a ?? 0) && pageOf(m) <= (view?.b ?? 0));
  const toggleMark = () => {
    if (!rec || !layout || !view || !posRef.current) return;
    if (curMark) return void S().patch(rec.id, { bookmarks: marks.filter((m) => m !== curMark) });
    const pg = layout.pages[curPage - 1];
    const label = (pg?.html ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, '').slice(0, 30) || `第 ${curPage} 页`;
    const m: Bookmark = { ...posRef.current, label, at: Date.now() };
    S().patch(rec.id, { bookmarks: [...marks, m].sort((a, b) => a.chapter - b.chapter || a.offset - b.offset) });
    S().toast({ text: '书签已夹好', kind: 'ok' }, 1800);
  };

  const chapterTitle = view && layout?.pages[view.b - 1]?.kind === 'text' ? titleAt(view.b - 1) : '';
  const tocPage = (t: TocItem) => (layout ? (t.anchor ? layout.idPage.get(`${t.chapter}#${t.anchor}`) ?? layout.chapterPage[t.chapter] : layout.chapterPage[t.chapter]) + 1 : 1);
  const hlPage = (h: Highlight) => (layout ? (pagesOf(layout, h)[0] ?? layout.chapterPage[h.chapter] ?? 0) + 1 : 1);
  const hlChapter = (h: Highlight) => titleAt(hlPage(h) - 1) || book?.chapters[h.chapter]?.title || '正文前';
  const go = (p: number) => { flipRef.current?.gotoPage(p); };
  const count = view?.count ?? layout?.pages.length ?? 0;
  const pctNow = count ? Math.round(((view?.b ?? 1) / count) * 100) : 0;
  const exportNotes = () => {
    if (!rec) return;
    const out = [`# 《${rec.title}》${rec.author ? ` · ${rec.author}` : ''}`, ''];
    let ch = '';
    for (const h of hls) {
      const c = hlChapter(h);
      if (c !== ch) { out.push(`## ${c}`, ''); ch = c; }
      out.push(`> ${h.text}`, '');
      if (h.note) out.push(h.note, '');
    }
    navigator.clipboard?.writeText(out.join('\n')).then(() => S().toast({ text: `${hls.length} 条笔记已复制为 Markdown`, kind: 'ok' }, 2400)).catch(() => {});
  };

  if (!rec) {
    return (
      <div className="reader">
        <div className="stage"><div className="dots" /></div>
        <div className="rd-error"><div className="lg strong">{hydrated ? <><h2>书架上没有这本书</h2><p>它可能已经被拿下书架了。</p><div className="row"><button type="button" className="btn solid" onClick={back}>回到书架</button></div></> : <span className="spinner" />}</div></div>
      </div>
    );
  }
  const cover = coverUrl(rec);
  // on screen: drawn, and (coming from an open book) that book has grown into its place
  const visible = shown && (!handoff || handoff.placed);
  const sidePanel = panel === 'toc' || panel === 'marks' || panel === 'notes';

  return (
    <div className={`reader ${leaving ? 'is-leaving' : ''}`} style={{ ['--paper-face' as string]: paper.pp, ['--paper-edge' as string]: paper.pp2 }}>
      <div className="stage" aria-hidden>
        <div className="aura">{cover && <img src={cover} alt="" className="on" />}</div>
        <div className="dots" />
        <div className="vignette" />
      </div>

      <header className="top rd-ui">
        <div className="lg cap" data-refract="28" data-mat="clear">
          <button type="button" className="icon-btn tip" data-tip="回到书架 · Esc" onClick={back}><Icon name="arrow-left" size={18} /></button>
          <span className="vsep" />
          <div className="rd-title"><b>{rec.title}</b><span>{chapterTitle || rec.author || ' '}</span></div>
        </div>
        <div className="grow" />
        {phase === 'ready' && (
          <div className="lg cap" data-refract="28" data-mat="clear">
            <button type="button" className={`icon-btn tip ${panel === 'toc' || panel === 'marks' ? 'on' : ''}`} data-tip="目录 · T" onClick={() => setPanel(panel === 'toc' ? null : 'toc')}><Icon name="list" size={18} /></button>
            <button type="button" className={`icon-btn tip ${panel === 'notes' ? 'on' : ''}`} data-tip="笔记 · N" onClick={() => setPanel(panel === 'notes' ? null : 'notes')}><Icon name="highlighter" size={17} />{hls.length > 0 && <span className="rd-count mono">{hls.length}</span>}</button>
            <button type="button" className={`icon-btn tip ${curMark ? 'rd-mark-on' : ''}`} data-tip={curMark ? '取下书签 · B' : '夹一张书签 · B'} onClick={toggleMark}><Icon name="bookmark" size={17} fill={!!curMark} /></button>
            <button type="button" className={`icon-btn tip ${panel === 'type' ? 'on' : ''}`} data-tip="排版" onClick={() => setPanel(panel === 'type' ? null : 'type')}><Icon name="type-size" size={18} /></button>
          </div>
        )}
      </header>

      {(phase === 'ready' || phase === 'setting') && (
        <div className={`rd-stage ${visible ? 'is-in' : ''} ${handoff ? 'handoff' : ''}`} ref={stageRef}>
          <div className="rd-book" ref={bookRef} />
          {phase === 'setting' && (
            <div className="rd-setting slim">
              <p className="caption"><span className="spinner" /><span>正在排版 <b>{Math.round(progress * 100)}%</b></span></p>
            </div>
          )}
        </div>
      )}
      {phase === 'loading' && !handoff && <div className="rd-setting slim"><p className="caption"><span className="spinner" />打开书…</p></div>}
      {phase === 'pdf' && <div className="rd-pdf"><iframe src={fileUrl(rec)} title={rec.title} /></div>}
      {(phase === 'error' || phase === 'external') && (
        <div className="rd-error">
          <div className="lg strong">
            <h2>{phase === 'external' ? `${rec.file?.ext.toUpperCase()} 要用别的阅读器打开` : '这本书打不开'}</h2>
            <p>{phase === 'external' ? '书页翻动目前支持 EPUB 和 TXT（PDF 用浏览器自带的阅读器）。可以用系统默认的阅读器打开它，或者在 Z-Library 找一个 EPUB 版本。' : error}</p>
            <div className="row">
              {rec.file && <button type="button" className="btn solid" onClick={() => api.reveal(rec.id, true).catch((e) => S().toast({ text: e.message, kind: 'bad' }))}><Icon name="external-link" size={14} />用默认阅读器打开</button>}
              {phase === 'external' && <button type="button" className="btn" onClick={() => { S().go({ name: 'library' }); S().openFind(rec.title); }}><Icon name="search" size={14} />找 EPUB 版本</button>}
              <button type="button" className="btn ghost" onClick={back}>回到书架</button>
            </div>
          </div>
        </div>
      )}

      {phase === 'ready' && visible && <MarginNotes items={margin} hidden={turning} active={lens?.id} onOpen={(h, el) => openMark(h.id, bookRef.current?.querySelector(`.leaf mark[data-hl="${h.id}"]`) ?? el, true)} />}

      {phase === 'ready' && view && (
        <div className="rd-dock rd-ui">
          <button type="button" className="lg rd-nav" data-refract="26" disabled={view.atStart} onClick={() => flipRef.current?.prev()} aria-label="上一页"><Icon name="chevron-left" size={20} /></button>
          <div className="lg rd-track" data-refract="26">
            <span className="rd-ind"><b>{String(view.a).padStart(3, '0')}</b>{view.b !== view.a ? `–${String(view.b).padStart(3, '0')}` : ''} / {count}</span>
            <div className="rd-bar"
              onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); go(Math.round(1 + ((e.clientX - r.left) / r.width) * (count - 1))); }}
              onPointerMove={(e) => {
                if (!layout) return;
                const r = e.currentTarget.getBoundingClientRect(); const f = (e.clientX - r.left) / r.width;
                const p = layout.pages[Math.max(0, Math.min(count - 1, Math.round(f * (count - 1))))];
                const label = p?.kind === 'text' ? titleAt(Math.max(0, Math.min(count - 1, Math.round(f * (count - 1))))) : p?.kind === 'toc' ? '目录' : '';
                setHover(label ? { x: e.clientX - r.left, label } : null);
              }}
              onPointerLeave={() => setHover(null)}>
              <span className="done" style={{ width: `${((view.a - 1) / Math.max(1, count - 1)) * 100}%` }} />
              {layout && layout.chapterPage.length <= 160 && layout.chapterPage.map((p, i) => (i > 0 ? <i key={i} style={{ left: `${(p / Math.max(1, count - 1)) * 100}%` }} /> : null))}
              {layout && hls.length <= 400 && hls.map((h) => <i key={h.id} className="hl-tick" style={{ left: `${((hlPage(h) - 1) / Math.max(1, count - 1)) * 100}%` }} />)}
              <span className="pos" style={{ left: `${((view.a - 1) / Math.max(1, count - 1)) * 100}%`, width: `${Math.max(0.6, ((view.b - view.a + 1) / count) * 100)}%` }} />
              {hover && <span className="hover" style={{ left: hover.x }}>{hover.label}</span>}
            </div>
            <span className="rd-pct">{pctNow}%</span>
          </div>
          <button type="button" className="lg rd-nav" data-refract="26" disabled={view.atEnd} onClick={() => flipRef.current?.next()} aria-label="下一页"><Icon name="chevron-right" size={20} /></button>
        </div>
      )}

      {sidePanel && layout && (
        <aside className="lg strong rd-panel left rd-ui" data-refract="26">
          <div className="rd-panel-h">
            <h3>{panel === 'toc' ? '目录' : panel === 'marks' ? '书签' : '笔记'}</h3>
            <LSeg value={panel} onChange={(v) => setPanel(v)} className="boxed sm" options={[{ v: 'toc', l: '目录' }, { v: 'marks', l: `书签 ${marks.length}` }, { v: 'notes', l: `笔记 ${hls.length}` }]} />
            <button type="button" className="icon-btn" onClick={() => setPanel(null)} aria-label="关闭"><Icon name="x" size={16} /></button>
          </div>
          <div className="rd-toc">
            {panel === 'toc' && tocItems.map((t, i) => {
              const p = tocPage(t);
              const on = view ? p <= view.b && (i === tocItems.length - 1 || tocPage(tocItems[i + 1]) > view.b) : false;
              return <button key={i} type="button" className={`${on ? 'on' : ''} d${Math.min(1, t.depth)}`} onClick={() => { go(p); }}><span className="tt">{t.label}</span><span className="pn">{p}</span></button>;
            })}
            {panel === 'marks' && (marks.length ? marks.map((m, i) => (
              <button key={i} type="button" onClick={() => go(pageOf(m))}><span className="tt">{m.label}</span><span className="pn">{pageOf(m)}</span></button>
            )) : <p className="rd-empty">还没有书签。读到想回来的地方，按 B 或者点上面的书签。</p>)}
            {panel === 'notes' && <NotesList list={hls} pageOf={hlPage} chapterOf={hlChapter} onGo={(h) => go(hlPage(h))} onExport={exportNotes} />}
          </div>
        </aside>
      )}

      {panel === 'type' && (
        <aside className="lg strong rd-panel right rd-ui" data-refract="26">
          <div className="rd-panel-h"><h3>排版</h3><button type="button" className="icon-btn" style={{ marginLeft: 'auto' }} onClick={() => setPanel(null)} aria-label="关闭"><Icon name="x" size={16} /></button></div>
          <div className="rd-set">
            <div className="row"><span>字号</span>
              <span className="rd-step"><button type="button" onClick={() => setTypo((t) => ({ ...t, size: Math.max(13, t.size - 1) }))} aria-label="小一号"><Icon name="minus" size={14} /></button><b>{typo.size}</b><button type="button" onClick={() => setTypo((t) => ({ ...t, size: Math.min(30, t.size + 1) }))} aria-label="大一号"><Icon name="plus" size={14} /></button></span>
            </div>
            <div className="row"><span>行距</span>
              <LSeg value={String(typo.lead)} onChange={(v) => setTypo((t) => ({ ...t, lead: +v }))} className="boxed sm" options={[{ v: '1.6', l: '紧凑' }, { v: '1.8', l: '适中' }, { v: '2.05', l: '宽松' }]} />
            </div>
            <div className="row"><span>字体</span>
              <LSeg value={typo.font} onChange={(v) => setTypo((t) => ({ ...t, font: v }))} className="boxed sm" options={[{ v: 'song', l: '宋体' }, { v: 'hei', l: '黑体' }, { v: 'kai', l: '楷体' }]} />
            </div>
            <div className="row"><span>纸张</span>
              <span className="paper-sw">
                {(Object.keys(PAPERS) as Typo['paper'][]).map((k) => (
                  <button key={k} type="button" aria-pressed={typo.paper === k} title={{ white: '白纸', cream: '米黄', night: '夜间' }[k]} style={{ background: PAPERS[k].pp }} onClick={() => setTypo((t) => ({ ...t, paper: k }))}>
                    <span style={{ color: PAPERS[k].pi }}>文</span>
                  </button>
                ))}
              </span>
            </div>
            <div className="row"><span>版式</span>
              <LSeg value={single ? 'single' : 'auto'} onChange={(v) => setSingle(v === 'single')} className="boxed sm" options={[{ v: 'auto', l: '双页' }, { v: 'single', l: '单页' }]} />
            </div>
            <p className="caption" style={{ whiteSpace: 'normal' }}>
              {flipRef.current?.gl ? <><i className="ledg" />WebGL 纸张翻页</> : <><i className="ledg warn" />CSS 翻页（没有 WebGL2）</>}
              <i className="dot" /><span>拖动页角、点左右两半或用 ← → 翻页；在正文上拖选文字可以划线</span>
            </p>
          </div>
        </aside>
      )}

      {lens && <Lens key={`${lens.id ?? 'new'}:${lens.noting ? 1 : 0}`} state={lens} hl={lensHl} marker={marker} onMark={pick} onNote={note} onCopy={copy} onRemove={erase} onClose={closeLens} onWrite={write} />}
    </div>
  );
}

/* ---------- one page, as a sheet of paper ---------- */
function renderSheet(i: number, L: Layout, book: LoadedBook, rec: BookRec, typo: Typo, latin: boolean, toc: TocItem[], cloth: string, clothFg: string, hls: Highlight[], titleAt: (i: number) => string): HTMLElement {
  const p: Page = L.pages[i];
  const paper = PAPERS[typo.paper];
  const d = document.createElement('div');
  const recto = i % 2 === 0;
  d.className = `sheet ${recto ? 'recto' : 'verso'} ${latin ? 'latin' : ''}`;
  d.dataset.pi = String(i);
  d.style.cssText = `--fs:${typo.size}px;--lh:${typo.lead};--pf:${fontStack(typo.font, latin)};--pp:${paper.pp};--pp2:${paper.pp2};--pi:${paper.pi};--cc:${cloth};--cf:${clothFg};--mka:${typo.paper === 'night' ? '34%' : '46%'}`;
  const no = String((hash(rec.id) % 900) + 100);
  const cover = coverUrl(rec);
  const folio = (n: number) => `<div class="pg-foot"><span>${String(n).padStart(3, '0')}</span><span class="dotx"></span></div>`;
  const goto = (html: string) => html.replace(/data-href="(-?\d+)#([^"]*)"/g, (_, c, a) => {
    const pg = (a && L.idPage.get(`${c}#${a}`)) ?? L.chapterPage[+c];
    return pg != null ? `data-goto="${pg + 1}"` : '';
  });
  switch (p.kind) {
    case 'cover':
      d.innerHTML = cover
        ? `<div class="pg-cover"><img src="${cover}" alt=""></div>`
        : `<div class="pg-cover type"><div class="k"><span>Ready Library</span><span>Nº ${no}</span></div><div class="m"><i></i><b></b></div><div class="t">${esc(rec.title)}</div><div class="a">${esc(rec.author || '')}</div></div>`;
      break;
    case 'plate':
      d.innerHTML = `<div class="pg-plate"><div class="ex"><p class="no">EX LIBRIS · Nº ${no}</p><div class="mk"><span></span><span></span><span></span><i></i></div><p class="h">Ready Library 藏书</p><p class="n">${esc(rec.title.slice(0, 18))}</p><span class="r" style="display:block"></span><p class="d">${new Date(rec.addedAt).toLocaleDateString('zh-CN')} 上架</p></div></div>`;
      break;
    case 'title':
      d.innerHTML = `<div class="pg-title"><p class="k">READY LIBRARY · Nº ${no}</p><p class="t">${esc(rec.title)}</p><p class="a">${esc(rec.author || '')}</p><span class="r"></span><p class="p">${[rec.publisher, rec.year, `${book.chapters.length} 章`, book.chars ? `${Math.round(book.chars / 1000)}k 字` : ''].filter(Boolean).map((x) => esc(String(x))).join('<br>')}</p></div>`;
      break;
    case 'toc': {
      const rows = toc.slice(p.tocFrom ?? 0, (p.tocFrom ?? 0) + 22).map((t) => {
        const pg = (t.anchor ? L.idPage.get(`${t.chapter}#${t.anchor}`) ?? L.chapterPage[t.chapter] : L.chapterPage[t.chapter]) + 1;
        return `<div class="toc-row d${Math.min(1, t.depth)}" data-goto="${pg}"><span class="tt">${esc(t.label)}</span><i></i><b>${String(pg).padStart(3, '0')}</b></div>`;
      }).join('');
      d.innerHTML = `<div class="pg-body pg-toc"><div class="pg-flow">${p.tocFrom ? '' : '<h2>目录</h2>'}${rows}</div></div>${folio(i + 1)}`;
      break;
    }
    case 'text': {
      d.innerHTML = `<div class="pg-head"><span>${recto ? esc(titleAt(i) || book.chapters[p.chapter]?.title || '') : esc(rec.title)}</span><span>${recto ? '' : esc(rec.author || '')}</span></div>`
        + `<div class="pg-body"><div class="pg-flow ${p.opens ? 'opens' : ''}">${goto(p.html)}</div></div>${folio(i + 1)}`;
      if (p.opens) d.querySelector('.pg-head')!.innerHTML = '';
      const mine = hls.filter((h) => h.chapter === p.chapter);
      if (mine.length) paintMarks(d.querySelector<HTMLElement>('.pg-flow')!, p.start, mine);
      break;
    }
    case 'end':
      d.innerHTML = `<div class="pg-end"><p class="fin">完</p><span class="r"></span><p>${esc(rec.title)}<br>READY LIBRARY · Nº ${no}</p></div>`;
      break;
    case 'back':
      d.innerHTML = `<div class="pg-back"><span class="bm">READY LIBRARY</span></div>`;
      break;
    default:
      d.innerHTML = '<div class="pg-blank"></div>';
  }
  return d;
}
