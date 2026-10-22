import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { groupOf, lookOf, type ShelfBook, type Sort } from '../lib/topics';
import { Spine } from './Book';

const PAD = 26;          // inset at each end of a shelf
const GAP = 3;           // between two spines
const RUN_GAP = 34;      // between two runs (topics, months…)
const AREA = 266;        // the height a book stands in
const GLASS = 14;        // the shelf pane
const PITCH = AREA + GLASS + 50;

type Pos = { x: number; y: number; row: number };
type Label = { key: string; label: string; color?: string; x: number; row: number; count: number; w: number };

const labelW = (label: string, count: number) => 22 + label.length * 13 + String(count).length * 7;

/**
 * Where every book stands: left to right along a pane, a gap between runs, a new shelf when one is full,
 * and each run's name centred under it. Books are positioned absolutely, so a new sort or filter slides
 * every book to its new place instead of the shelf reflowing.
 */
function arrange(books: ShelfBook[], width: number, sort: Sort) {
  const pos = new Map<string, Pos>();
  const labels: Label[] = [];
  const ends: number[] = [];
  const right = Math.max(220, width) - PAD;
  type Run = { g: ReturnType<typeof groupOf>; books: ShelfBook[] };
  const runs: Run[] = [];
  for (const b of books) {
    const g = groupOf(b, sort);
    const last = runs.at(-1);
    if (last && last.g?.key === g?.key) last.books.push(b);
    else runs.push({ g, books: [b] });
  }
  let row = 0, x = PAD, edge = PAD, labelEdge = -Infinity, started = false;
  const wrap = () => { ends[row] = edge; row++; x = PAD; edge = PAD; labelEdge = -Infinity; started = false; };
  for (const run of runs) {
    const ws = run.books.map((b) => lookOf(b).w);
    const lw = run.g ? labelW(run.g.label, run.books.length) : 0;
    if (started) {
      x = Math.max(edge + RUN_GAP, labelEdge + 14);
      if (x + ws[0] > right) wrap();
    }
    const segRow = row, segStart = x;
    let segEnd = -1;
    run.books.forEach((b, i) => {
      if (started && x + ws[i] > right) { if (segEnd < 0) segEnd = edge; wrap(); }
      pos.set(b.id, { x, y: row * PITCH + AREA - lookOf(b).h, row });
      edge = x + ws[i];
      x = edge + GAP;
      started = true;
    });
    if (segEnd < 0) segEnd = edge;
    if (run.g) {
      const prev = labels.at(-1)?.row === segRow ? labels.at(-1)! : null;
      let left = (segStart + segEnd) / 2 - lw / 2;
      if (prev) left = Math.max(left, prev.x + prev.w + 12);
      left = Math.max(4, Math.min(width - lw - 4, left));
      labels.push({ key: run.g.key, label: run.g.label, color: run.g.color, x: left, row: segRow, count: run.books.length, w: lw });
      if (row === segRow) labelEdge = left + lw;
    }
  }
  ends[row] = edge;
  return { pos, labels, rows: row + 1, ends };
}

export function Shelf({ books, shown, sort, openId, fresh, onOpen, onLabel }: {
  books: ShelfBook[];
  shown: Set<string>;
  sort: Sort;
  openId: string | null;
  fresh: Set<string>;
  onOpen: (b: ShelfBook, el: HTMLElement) => void;
  onLabel?: (key: string) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [entering, setEntering] = useState(true);
  useLayoutEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el);
    setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // the books drop in once the start screen has lifted, not unseen beneath it
  const awake = useStore((s) => s.awake);
  useEffect(() => {
    if (!awake) return;
    const t = setTimeout(() => setEntering(false), 1800);
    return () => clearTimeout(t);
  }, [awake]);

  const visible = useMemo(() => books.filter((b) => shown.has(b.id)), [books, shown]);
  const { pos, labels, rows, ends } = useMemo(() => arrange(visible, width, sort), [visible, width, sort]);

  // A book filtered out stays where it stood while it fades; one coming back appears in place, without sliding.
  const last = useRef(new Map<string, Pos>());
  const wasOut = useRef(new Set<string>());
  const placed = books.map((b) => {
    const p = pos.get(b.id);
    const out = !p;
    const at = p ?? last.current.get(b.id) ?? { x: PAD, y: AREA - lookOf(b).h, row: 0 };
    const jump = !out && (wasOut.current.has(b.id) || !last.current.has(b.id));
    return { b, at, out, jump };
  });
  useLayoutEffect(() => {
    for (const p of placed) if (!p.out) last.current.set(p.b.id, p.at);
    wasOut.current = new Set(placed.filter((p) => p.out).map((p) => p.b.id));
  });
  const order = new Map(visible.map((b, i) => [b.id, i]));

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    const btns = visible.map((b) => ref.current?.querySelector<HTMLElement>(`[data-book="${b.id}"]`)).filter(Boolean) as HTMLElement[];
    const i = btns.indexOf(document.activeElement as HTMLElement);
    if (i < 0) return;
    e.preventDefault();
    btns[Math.max(0, Math.min(btns.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)))]?.focus();
  };

  return (
    <div ref={ref} className={`bookcase ${entering ? 'is-entering' : ''}`} style={{ height: rows * PITCH - 16 }} onKeyDown={onKeyDown}>
      {Array.from({ length: Math.max(rows, 1) }, (_, r) => (
        <div key={r} className="pane" style={{ transform: `translateY(${r * PITCH + AREA}px)`, ['--i' as string]: r }} aria-hidden>
          <span className="pane-top" /><span className="pane-face" /><i className="bracket l" /><i className="bracket r" />
        </div>
      ))}
      {labels.map((l) => {
        const style = { transform: `translate(${l.x}px, ${l.row * PITCH + AREA + GLASS + 10}px)`, ['--c' as string]: l.color };
        const body = <>{l.color && <i className="pane-sw" />}{l.label}<span className="pane-n">{l.count}</span></>;
        return onLabel
          ? <button key={`${sort}-${l.key}`} type="button" className="pane-label" style={style} onClick={() => onLabel(l.key)}>{body}</button>
          : <div key={`${sort}-${l.key}`} className="pane-label" style={style}>{body}</div>;
      })}
      {Array.from({ length: rows }, (_, r) => (
        <div key={`end-${r}`} className="bookend" style={{ transform: `translate(${(ends[r] ?? PAD) + 3}px, ${r * PITCH + AREA - 58}px)` }} aria-hidden>
          <svg viewBox="0 0 26 58" width="26" height="58"><path d="M2 58V20C2 9 9 2 20 2h4v56z" fill="currentColor" /><path d="M2 58V20C2 9 9 2 20 2h4v56z" fill="url(#be-shade)" /></svg>
        </div>
      ))}
      <svg width="0" height="0" style={{ position: 'absolute' }} aria-hidden>
        <defs><linearGradient id="be-shade" x1="0" x2="1"><stop offset="0" stopColor="#fff" stopOpacity=".25" /><stop offset=".5" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".2" /></linearGradient></defs>
      </svg>
      {width > 0 && placed.map(({ b, at, out, jump }) => {
        const i = order.get(b.id) ?? 0;
        return (
          <div key={b.id} className="bk-x" data-jump={jump || undefined} style={{ transform: `translateX(${at.x}px)`, transitionDelay: jump ? '0ms' : `${Math.min(i, 40) * 9}ms` }}>
            <div className="bk-y" data-jump={jump || undefined} style={{ transform: `translateY(${at.y}px)`, transitionDelay: jump ? '0ms' : `${Math.min(i, 40) * 9}ms` }}>
              <div className="bk-in" data-out={out || undefined} data-fresh={fresh.has(b.id) || undefined} style={{ ['--i' as string]: i }}>
                <button type="button" data-book={b.id} className="bk" data-open={openId === b.id || undefined} tabIndex={out ? -1 : 0} aria-hidden={out || undefined}
                  aria-label={`${b.title}，${b.author}`} title={`${b.title}${b.author ? ' · ' + b.author : ''}${b.pct > 0 && b.pct < 1 ? ` · 读到 ${Math.round(b.pct * 100)}%` : ''}${b.wish ? ' · 待取回' : ''}`}
                  onClick={(e) => onOpen(b, e.currentTarget.querySelector('.spine') as HTMLElement)}
                  onPointerEnter={() => { if (b.cover) new Image().src = b.cover; }}>
                  <Spine book={b} />
                </button>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
