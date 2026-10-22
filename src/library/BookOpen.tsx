import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { fmtChars, hash, lookOf, TOPIC, TOPICS, type ShelfBook, type TopicKey } from '../lib/topics';
import type { BookRec, Job } from '../lib/api';
import { JobLine } from '../find/JobView';
import { Icon } from '../ui/Icon';
import { Cover, Spine } from './Book';
import { useStore } from '../lib/store';

export type Origin = { el: HTMLElement; kind: 'spine' | 'cover' };

const ASPECT = 1.42;
const EASE_IO = 'cubic-bezier(0.5, 0, 0.18, 1)';
type Geo = { W: number; H: number; D: number; wide: boolean; vw: number; vh: number };

function measure(b: ShelfBook): Geo {
  const vw = innerWidth, vh = innerHeight, wide = vw >= 820;
  const W = Math.round(wide ? Math.min(340, (vw - 140) / 2, (vh - 120) / ASPECT) : Math.min(vw - 40, 340, (vh - 140) / ASPECT));
  const H = Math.round(W * ASPECT), look = lookOf(b);
  return { W, H, D: Math.max(16, Math.round((look.w * H) / look.h)), wide, vw, vh };
}
const T = (x: number, y: number, s: number, z: number, ry: number, rx = 0, rz = 0) =>
  `translate3d(${x}px, ${y}px, 0) scale3d(${s}, ${s}, ${s}) translateZ(${z}px) rotateY(${ry}deg) rotateX(${rx}deg) rotateZ(${rz}deg)`;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const span = (u: number, a: number, b: number) => clamp01((u - a) / (b - a));
const smoother = (x: number) => { x = clamp01(x); return x * x * x * (x * (x * 6 - 15) + 10); };
const bump = (u: number, a: number, b: number) => Math.sin(Math.PI * span(u, a, b));
/** cubic-bezier(x1, y1, x2, y2) as a function of time */
function bezier(x1: number, y1: number, x2: number, y2: number) {
  const cx = 3 * x1, bx = 3 * (x2 - x1) - cx, ax = 1 - cx - bx, cy = 3 * y1, by = 3 * (y2 - y1) - cy, ay = 1 - cy - by;
  const X = (t: number) => ((ax * t + bx) * t + cx) * t, Y = (t: number) => ((ay * t + by) * t + cy) * t, dX = (t: number) => (3 * ax * t + 2 * bx) * t + cx;
  return (x: number) => { let t = x; for (let i = 0; i < 8; i++) { const e = X(t) - x, d = dX(t); if (Math.abs(e) < 1e-5 || !d) break; t = clamp01(t - e / d); } return Y(t); };
}
/** gathers speed off the shelf, glides into your hands */
const FLY = bezier(0.42, 0, 0.2, 1);

/**
 * From where it stood to your hands, as one motion: every channel (travel, the pull towards you, the turn to face
 * you, the tilt) eases on its own stretch of a single timeline, so the book never stops halfway. Spine-first off a
 * shelf (tipped out at the top), or face-first off a table.
 */
function flight(g: Geo, o: Origin, reverse = false): Keyframe[] {
  const r = o.el.getBoundingClientRect();
  const dx = r.left + r.width / 2 - g.vw / 2, dy = r.top + r.height / 2 - g.vh / 2;
  const spine = o.kind === 'spine', k = spine ? r.height / g.H : r.width / g.W;
  // it lands half a book right of centre, so that with the cover opened to the left the spread is centred:
  // one path to that spot, rather than a flight to the middle and then a second slide sideways
  const end = endX(g);
  const pose = (u: number) => {
    // travel and size follow the timeline's own easing; only the turns get their own stretch of it
    const x = lerp(dx, end, u), y = lerp(dy, 0, u) - (spine ? 34 : 26) * bump(u, 0, 1);
    const s = lerp(k, 1, u);
    if (!spine) return T(x, y, s, -g.D / 2 + 60 * bump(u, 0, 0.85), -14 * bump(u, 0.05, 0.95), 7 * bump(u, 0, 0.85), -2 * bump(u, 0.05, 0.95));
    const turn = smoother(span(u, 0.08, 0.9));
    // pulled off the shelf towards you first, turning to face you on the way, tipped out at the top
    return T(x, y, s, lerp(-g.W / 2, -g.D / 2, turn) + 90 * bump(u, 0, 0.72), 90 * (1 - turn), -9 * bump(u, 0, 0.78), -1.6 * bump(u, 0.1, 0.96));
  };
  const n = 48;
  return Array.from({ length: n + 1 }, (_, i) => { const t = i / n, e = FLY(t); return { offset: t, transform: pose(reverse ? 1 - e : e) }; });
}

const endX = (g: Geo) => (g.wide ? g.W / 2 : 0);

/** Where the reader will lay the open spread (the same sums as its flipbook), so the open book can grow into it. */
function readerSpread() {
  let single = false;
  try { single = localStorage.getItem('rl:single') === '1'; } catch {}
  const W = innerWidth, H = innerHeight - 76 - 92, ratio = 594 / 846;
  const spread = !single && W >= 820 && W > H * 0.95;
  const pw = Math.max(160, Math.floor(spread ? Math.min((W - 72) / 2, (H - 24) * ratio) * 0.92 : Math.min(W - 20, (H - 16) * ratio)));
  return { ph: Math.round(pw / ratio), cy: 76 + H / 2, spread };
}

export function BookOpen({ book, rec, origin, onClose, onRead, onTopic, onFavorite, onRename, onRemove, onAttach, onFindZlib, onReveal, onFetch, job, lastError }: {
  book: ShelfBook;
  rec: BookRec;
  origin: Origin;
  onClose: () => void;
  onRead: () => void;
  onTopic: (t: TopicKey) => void;
  onFavorite: () => void;
  onRename: (title: string) => void;
  onRemove: () => void;
  onAttach: (f: File) => void;
  onFindZlib: () => void;
  onReveal: (open: boolean) => void;
  onFetch: () => void;
  job?: Job | null;
  lastError?: string;
}) {
  const [g] = useState(() => measure(book));
  const [first] = useState(() => (g.wide && !matchMedia('(prefers-reduced-motion: reduce)').matches ? (flight(g, origin)[0].transform as string) : undefined));
  const [phase, setPhase] = useState<'in' | 'open' | 'out' | 'leaving' | 'gone'>('in');
  const handoff = useStore((s) => (s.handoff?.id === book.id ? s.handoff : null));
  const [renaming, setRenaming] = useState(false);
  const worldRef = useRef<HTMLDivElement>(null), bookRef = useRef<HTMLDivElement>(null), coverRef = useRef<HTMLDivElement>(null), mainRef = useRef<HTMLButtonElement | HTMLAnchorElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const closing = useRef(false);
  const look = lookOf(book), t = TOPIC[book.topic];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const coverZ = `translateZ(${g.D / 2}px)`;

  useLayoutEffect(() => { const el = origin.el; el.style.visibility = 'hidden'; return () => { el.style.visibility = ''; }; }, [origin.el]);

  useLayoutEffect(() => {
    const b = bookRef.current!, c = coverRef.current!;
    if (reduce || !g.wide) {
      b.style.transform = T(endX(g), 0, 1, -g.D / 2, 0);
      c.style.transform = `${coverZ} rotateY(-180deg)`;
      setPhase('open');
      return;
    }
    const spine = origin.kind === 'spine', dur = spine ? 900 : 720;
    const fly = b.animate(flight(g, origin), { duration: dur, easing: 'linear', fill: 'forwards' });
    // the cover starts to swing open while the book is still gliding in, so the two read as one movement
    const delay = Math.round(dur * 0.36);
    c.animate([{ transform: `${coverZ} rotateY(0deg)` }, { transform: `${coverZ} rotateY(-180deg)` }], { duration: 780, delay, easing: 'cubic-bezier(0.4, 0, 0.2, 1)', fill: 'forwards' });
    const t1 = setTimeout(() => setPhase('open'), delay + 380);
    return () => { clearTimeout(t1); fly.cancel(); };
    // once, on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const close = useCallback(async () => {
    if (closing.current) return;
    closing.current = true;
    setPhase('out');
    const b = bookRef.current!, c = coverRef.current!;
    if (reduce || !g.wide) return onClose();
    c.getAnimations().forEach((a) => a.commitStyles?.());
    c.animate([{ transform: `${coverZ} rotateY(-180deg)` }, { transform: `${coverZ} rotateY(0deg)` }], { duration: 620, easing: EASE_IO, fill: 'forwards' });
    // back along the same path, setting off while the cover is still closing
    await b.animate(flight(measure(book), origin, true), { duration: origin.kind === 'spine' ? 840 : 680, delay: 260, easing: 'linear', fill: 'forwards' }).finished.catch(() => {});
    onClose();
  }, [book, coverZ, onClose, origin, reduce, g.wide]);

  // the reader is drawn and this book has grown into its place: step aside
  useEffect(() => { if (handoff?.ready && handoff.placed) setPhase('gone'); }, [handoff?.ready, handoff?.placed]);
  // while you look at it, the book is read ahead (and the reader itself fetched), so opening it doesn't wait
  useEffect(() => {
    if (phase !== 'open' || book.wish) return;
    const t = setTimeout(() => { import('../reader/Reader'); import('../reader/preload').then((m) => m.readAhead(rec)); }, 120);
    return () => clearTimeout(t);
  }, [phase, book.wish, rec]);

  useEffect(() => { if (phase === 'open') mainRef.current?.focus({ preventScroll: true }); }, [phase]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !renaming) { e.preventDefault(); close(); } };
    addEventListener('keydown', onKey);
    document.body.classList.add('lock-scroll');
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('lock-scroll'); };
  }, [close, renaming]);

  /** Into the reader: the open book grows to where its pages will lie while the reader sets them underneath. */
  const read = () => {
    if (closing.current) return;
    closing.current = true;
    setPhase('leaving');
    const w = worldRef.current!, R = readerSpread(), k = R.ph / g.H;
    const dx = R.spread || !g.wide ? 0 : -(g.W / 2) * k, dy = R.cy - innerHeight / 2;
    onRead();
    if (reduce) { useStore.getState().handoffPlaced(); return; }
    w.animate([{ transform: 'none' }, { transform: `translate(${dx}px, ${dy}px) scale(${k})` }], { duration: 720, easing: EASE_IO, fill: 'forwards' })
      .finished.then(() => useStore.getState().handoffPlaced()).catch(() => {});
  };
  const reading = book.pct > 0 && book.pct < 1;
  const plateNo = String((hash(book.id) % 900) + 100).padStart(3, '0');
  const shelved = new Date(rec.addedAt).toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric' });
  const ext = rec.file?.ext;
  const inApp = ext === 'epub' || ext === 'txt' || ext === 'pdf' || ext === 'md';
  const size = rec.file ? `${(rec.file.size / 1048576).toFixed(rec.file.size > 1048576 * 10 ? 0 : 1)} MB` : '';
  const source = rec.source === 'zlib' ? 'Z-Library' : rec.source === 'treasure' ? '电子书宝库' : '本地导入';

  return createPortal(
    <div className="ob-stage" data-phase={phase} data-wish={book.wish ? book.id : undefined} role="dialog" aria-modal aria-label={book.title}>
      <div className="ob-backdrop" onClick={close} />
      <div ref={worldRef} className="ob-world">
        <div className="ob-shift">
          <div ref={bookRef} className="ob-book" style={{ width: g.W, height: g.H, marginLeft: -g.W / 2, marginTop: -g.H / 2, transform: first }}>
            <div className="ob-face ob-back" style={{ transform: `rotateY(180deg) translateZ(${g.D / 2}px)`, background: look.color }} />
            <div className="ob-face ob-spine" style={{ width: g.D, left: (g.W - g.D) / 2, transform: `rotateY(-90deg) translateZ(${g.W / 2}px)` }}>
              <div style={{ transform: `scale(${g.H / look.h})`, transformOrigin: '0 0', width: look.w, height: look.h }}><Spine book={book} look={look} /></div>
            </div>
            <div className="ob-face ob-edge" style={{ width: g.D - 6, height: g.H - 8, top: 4, left: (g.W - g.D + 6) / 2, transform: `rotateY(90deg) translateZ(${g.W / 2 - 4}px)` }} />
            <div className="ob-face ob-edge is-top" style={{ width: g.W - 6, height: g.D - 6, left: 2, top: (g.H - g.D + 6) / 2, transform: `rotateX(90deg) translateZ(${g.H / 2 - 4}px)` }} />
            <div className="ob-face ob-edge is-top" style={{ width: g.W - 6, height: g.D - 6, left: 2, top: (g.H - g.D + 6) / 2, transform: `rotateX(-90deg) translateZ(${g.H / 2 - 4}px)` }} />
            <div className="ob-face ob-board" style={{ transform: `translateZ(${g.D / 2 - 6}px)`, background: look.color }} />

            {/* the first page: what it is, how far you are, the way in */}
            <div className="ob-face ob-page" style={{ width: g.W - 9, height: g.H - 12, top: 6, left: 1, transform: `translateZ(${g.D / 2 - 2}px)` }}>
              <div className="ob-page-in">
                <div className="ob-kicker">
                  <label className="ob-chip" style={{ ['--c' as string]: t.shades[0] }} title="挪到另一层">
                    <i className="ob-chip-sw" />
                    <span>{t.name}</span>
                    <Icon name="chevron-down" size={12} />
                    <select value={book.topic} onChange={(e) => onTopic(e.target.value as TopicKey)} aria-label="分类">
                      {TOPICS.map((x) => <option key={x.key} value={x.key}>{x.name}</option>)}
                    </select>
                  </label>
                  <span className="ob-tools">
                    <button type="button" className="ob-icon" aria-pressed={book.favorite} title={book.favorite ? '取消收藏' : '收藏'} onClick={onFavorite}><Icon name="star" size={15} fill={book.favorite} /></button>
                    <button type="button" className="ob-icon" title="改书名" onClick={() => setRenaming(true)}><Icon name="pen-line" size={14} /></button>
                    {rec.file && <button type="button" className="ob-icon" title="在访达中显示" onClick={() => onReveal(false)}><Icon name="folder-open" size={14} /></button>}
                    <button type="button" className="ob-icon" title="从书架拿下" onClick={onRemove}><Icon name="trash" size={14} /></button>
                  </span>
                </div>
                {renaming ? <TitleField title={book.title} onDone={(v) => { setRenaming(false); if (v && v !== book.title) onRename(v); }} />
                  : <h2 className="ob-title"><button type="button" className="ob-title-btn" onClick={() => setRenaming(true)}>{book.title}</button></h2>}
                <p className="ob-author">{book.author || '佚名'}</p>
                <p className="caption ob-caption">
                  <span>{source}</span>
                  {book.year && <><i className="dot" /><span>{book.year}</span></>}
                  {ext && <><i className="dot" /><b>{ext.toUpperCase()}</b><span>{size}</span></>}
                  {!ext && rec.formats?.length ? <><i className="dot" /><span>{rec.formats.join(' / ').toUpperCase()}</span></> : null}
                  {book.chars > 0 && rec.words && <><i className="dot" /><span>{fmtChars(book.chars)}</span></>}
                </p>
                {rec.description && <p className="ob-dek">{rec.description}</p>}
                {rec.tags.length > 0 && <p className="ob-tags">{rec.tags.slice(0, 5).map((x) => <span key={x}>{x}</span>)}</p>}

                <div className="ob-progress">
                  {book.wish ? (
                    job ? <JobLine job={job} />
                      : <span className={lastError ? 'ob-err' : ''}>{rec.source === 'treasure'
                        ? (lastError ? `上次没取回来：${lastError}` : '还在城通网盘上。点「自动取回」，下载、解压、挑出 EPUB 都在后台完成。')
                        : '文件还没到。'}</span>
                  ) : (
                    <><span className="ob-bar" aria-hidden><span style={{ width: `${Math.round(book.pct * 100)}%` }} /></span>
                      <span>{book.pct >= 1 ? '读完了' : reading ? `读到 ${Math.round(book.pct * 100)}%` : '还没开始'}{rec.bookmarks?.length ? ` · ${rec.bookmarks.length} 个书签` : ''}{rec.highlights?.length ? ` · ${rec.highlights.length} 条划线` : ''}</span></>
                  )}
                </div>
                <div className="ob-actions">
                  {!book.wish && (inApp
                    ? <button ref={mainRef as React.Ref<HTMLButtonElement>} type="button" onClick={read} className="ob-read"><i className="led" />{book.pct >= 1 ? '再读一遍' : reading ? '接着读' : '开始阅读'}<Icon name="arrow-right" size={16} /></button>
                    : <button ref={mainRef as React.Ref<HTMLButtonElement>} type="button" onClick={() => onReveal(true)} className="ob-read"><i className="led" />用默认阅读器打开 {ext?.toUpperCase()}<Icon name="external-link" size={15} /></button>)}
                  {book.wish && rec.source === 'treasure' && rec.sourceUrl && !job && (
                    <button ref={mainRef as React.Ref<HTMLButtonElement>} type="button" className="ob-read" onClick={onFetch}><i className="led" />{lastError ? '再试一次' : '自动取回 EPUB'}<Icon name="download" size={16} /></button>
                  )}
                  {book.wish && (
                    <div className="ob-row">
                      {rec.source === 'treasure' && rec.sourceUrl && <a className="btn sm" href={rec.sourceUrl} target="_blank" rel="noreferrer"><Icon name="external-link" size={14} />去网盘手动下载</a>}
                      <button type="button" className="btn sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={14} />导入文件</button>
                      <button type="button" className="btn sm" onClick={onFindZlib}><Icon name="search" size={14} />在 Z-Library 找</button>
                      <input ref={fileRef} type="file" hidden accept=".epub,.txt,.pdf,.mobi,.azw3,.md" onChange={(e) => { const f = e.target.files?.[0]; if (f) onAttach(f); e.target.value = ''; }} />
                    </div>
                  )}
                  <div className="ob-sub">
                    {rec.source === 'zlib' && rec.sourceRef ? <span className="mono">zlib · {rec.sourceRef.split(':')[0]}</span> : <span />}
                    <button type="button" onClick={close} className="ob-link">放回去 <kbd>Esc</kbd></button>
                  </div>
                </div>
              </div>
            </div>

            {/* the front board: the cover outside, a bookplate inside */}
            <div ref={coverRef} className="ob-cover" style={{ transform: `${coverZ} rotateY(0deg)` }}>
              <div className="ob-face ob-cover-front"><Cover book={book} look={look} /></div>
              <div className="ob-face ob-cover-inside" style={{ ['--c' as string]: look.color, ['--c2' as string]: t.shades[3] }}>
                <div className="ex-libris">
                  <p className="ex-no mono">EX LIBRIS · Nº {plateNo}</p>
                  <div className="ex-mark" aria-hidden><span /><span /><span /><i /></div>
                  <p className="ex-head">Ready Library 藏书</p>
                  <p className="ex-name">{t.name}<em> · {t.en}</em></p>
                  <span className="ex-rule" aria-hidden />
                  <p className="ex-meta mono">{shelved} 上架</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

function TitleField({ title, onDone }: { title: string; onDone: (t: string | null) => void }) {
  const ref = useRef<HTMLTextAreaElement>(null);
  const done = useRef(false);
  const finish = (v: string | null) => { if (done.current) return; done.current = true; onDone(v === null ? null : v.replace(/\s+/g, ' ').trim().slice(0, 300)); };
  useLayoutEffect(() => { ref.current!.focus({ preventScroll: true }); ref.current!.select(); }, []);
  return (
    <textarea ref={ref} className="ob-title ob-title-field" defaultValue={title} rows={1} aria-label="书名" spellCheck={false}
      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); finish(e.currentTarget.value); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(null); } }}
      onBlur={(e) => finish(e.currentTarget.value)} />
  );
}
