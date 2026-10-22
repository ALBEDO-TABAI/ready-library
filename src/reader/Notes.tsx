import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { Highlight, Marker } from '../lib/api';
import { Icon } from '../ui/Icon';
import { MARKERS, markerColor } from './marks';

export type Box = { left: number; top: number; right: number; bottom: number };
export type LensState = {
  at: Box;
  /** a fresh selection (not yet a highlight) … */
  draft?: { chapter: number; from: number; to: number; text: string };
  /** … or a highlight already on the page */
  id?: string;
  noting?: boolean;
};

/**
 * The popover over a selection or a highlight: marker colours and the red pen, a note, copy, remove.
 * Writing a note turns it into a small writing desk; clicking away keeps what was written, the way paper would.
 */
export function Lens({ state, hl, marker, onMark, onNote, onCopy, onRemove, onClose, onWrite }: {
  state: LensState;
  hl?: Highlight;
  marker: Marker;
  onMark: (m: Marker) => void;
  onNote: (text: string) => void;
  onCopy: () => void;
  onRemove: () => void;
  onClose: (why: 'outside' | 'done') => void;
  onWrite: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const area = useRef<HTMLTextAreaElement>(null);
  const [pos, setPos] = useState<{ x: number; y: number; below: boolean } | null>(null);
  const [draft, setDraft] = useState(hl?.note ?? '');
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const noting = !!state.noting;

  useLayoutEffect(() => {
    const el = ref.current!;
    const w = el.offsetWidth, h = el.offsetHeight, cx = (state.at.left + state.at.right) / 2;
    const below = state.at.top - h - 14 < 70;
    setPos({ x: Math.max(12, Math.min(innerWidth - w - 12, cx - w / 2)), y: below ? Math.min(innerHeight - h - 12, state.at.bottom + 12) : state.at.top - h - 12, below });
  }, [state.at, noting, hl?.note]);
  useEffect(() => { if (noting) { setDraft(hl?.note ?? ''); requestAnimationFrame(() => { area.current?.focus(); area.current?.setSelectionRange(9e9, 9e9); }); } }, [noting, hl?.id]);

  // a press anywhere else closes it (keeping a note being written)
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (ref.current?.contains(e.target as Node)) return;
      if (noting && draftRef.current.trim() !== (hl?.note ?? '').trim()) onNote(draftRef.current);
      onClose('outside');
    };
    document.addEventListener('pointerdown', down, true);
    return () => document.removeEventListener('pointerdown', down, true);
  }, [noting, hl?.note, onNote, onClose]);

  const current = hl?.color;
  return (
    <div ref={ref} className={`lg strong rd-lens rd-ui ${noting ? 'noting' : ''} ${pos?.below ? 'below' : ''}`} style={pos ? { left: pos.x, top: pos.y } : { visibility: 'hidden', left: 0, top: 0 }}
      role="dialog" aria-label={noting ? '写批注' : '划线'} onKeyDown={(e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); onClose('done'); } }}>
      {!noting ? (
        <>
          <div className="lens-row">
            <span className="lens-sw" role="group" aria-label="划线颜色">
              {MARKERS.map((m) => (
                <button key={m.key} type="button" className={`sw ${m.key}`} aria-pressed={current === m.key} title={m.label} style={{ ['--mk' as string]: m.color }} onClick={() => onMark(m.key)}>
                  {m.key === 'pen' ? <i className="pen" /> : <i />}
                </button>
              ))}
            </span>
            <span className="vsep" />
            <button type="button" className="lens-btn" onClick={onWrite}><Icon name="note" size={15} />{hl?.note ? '改批注' : '批注'}</button>
            <button type="button" className="lens-btn icon tip up" data-tip="复制" onClick={onCopy} aria-label="复制"><Icon name="copy" size={15} /></button>
            {hl && <button type="button" className="lens-btn icon tip up" data-tip="擦掉" onClick={onRemove} aria-label="擦掉划线"><Icon name="trash" size={15} /></button>}
          </div>
          {hl?.note && <button type="button" className="lens-note" onClick={onWrite}>{hl.note}</button>}
        </>
      ) : (
        <div className="lens-write">
          <p className="lens-q" style={{ ['--mk' as string]: markerColor(hl?.color ?? marker) }}>{(hl?.text ?? state.draft?.text ?? '').slice(0, 120)}</p>
          <textarea ref={area} value={draft} onChange={(e) => setDraft(e.target.value)} rows={4} placeholder="在页边写点什么…" spellCheck={false}
            onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); onNote(draft); onClose('done'); } if (e.key === 'Escape') { e.preventDefault(); onClose('done'); } }} />
          <div className="lens-row end">
            <span className="caption"><kbd>⌘</kbd><kbd>↵</kbd> 保存 · <kbd>Esc</kbd> 不保存</span>
            <button type="button" className="btn sm solid" onClick={() => { onNote(draft); onClose('done'); }}>保存</button>
          </div>
        </div>
      )}
    </div>
  );
}

export type MarginItem = { h: Highlight; side: 'l' | 'r'; y: number; edge: number; x: number; w: number };

/**
 * Notes in the margins of the desk, beside the page and level with their passage, the way Gloss keeps them
 * beside an article. Each sits as close to its line as the ones above it allow, with a hairline back to the page.
 */
export function MarginNotes({ items, hidden, active, onOpen }: { items: MarginItem[]; hidden: boolean; active?: string | null; onOpen: (h: Highlight, el: HTMLElement) => void }) {
  const els = useRef(new Map<string, HTMLElement>());
  const [hs, setHs] = useState<Record<string, number>>({});
  useLayoutEffect(() => {
    const next: Record<string, number> = {};
    for (const it of items) next[it.h.id] = els.current.get(it.h.id)?.offsetHeight ?? 60;
    if (items.some((it) => next[it.h.id] !== hs[it.h.id])) setHs(next);
  });
  const tops: Record<string, number> = {};
  for (const side of ['l', 'r'] as const) {
    const list = items.filter((i) => i.side === side).sort((a, b) => a.y - b.y);
    let floor = 72;
    for (const it of list) { const t = Math.max(floor, it.y - 16); tops[it.h.id] = t; floor = t + (hs[it.h.id] ?? 60) + 10; }
    // too low for the window: settle upwards from the bottom
    let ceil = innerHeight - 100;
    for (let k = list.length - 1; k >= 0; k--) { const it = list[k], h = hs[it.h.id] ?? 60; if (tops[it.h.id] + h > ceil) tops[it.h.id] = Math.max(72, ceil - h); ceil = tops[it.h.id] - 10; }
  }
  return (
    <div className={`mn ${hidden ? 'is-hidden' : ''}`} aria-label="页边批注">
      <svg className="mn-leads" width="100%" height="100%" aria-hidden>
        {items.map((it) => {
          const t = tops[it.h.id] ?? it.y, y1 = t + 15, x1 = it.side === 'r' ? it.x - 2 : it.x + it.w + 2, x0 = it.edge, k = (x1 - x0) * 0.5;
          return <g key={it.h.id} className={active === it.h.id ? 'on' : ''}><path d={`M ${x0} ${it.y} C ${x0 + k} ${it.y}, ${x1 - k} ${y1}, ${x1} ${y1}`} /><circle cx={x0} cy={it.y} r={2.4} style={{ fill: markerColor(it.h.color) }} /></g>;
        })}
      </svg>
      {items.map((it, i) => (
        <button key={it.h.id} ref={(el) => { if (el) els.current.set(it.h.id, el); else els.current.delete(it.h.id); }} type="button"
          className={`mn-card rd-ui ${it.side} ${active === it.h.id ? 'on' : ''}`} style={{ left: it.x, width: it.w, top: tops[it.h.id] ?? it.y, ['--mk' as string]: markerColor(it.h.color), ['--i' as string]: i }}
          onClick={(e) => onOpen(it.h, e.currentTarget)}>
          <span className="mn-q">{it.h.text}</span>
          <span className="mn-t">{it.h.note}</span>
        </button>
      ))}
    </div>
  );
}

/** Every highlight in the book, in reading order, for the side panel. */
export function NotesList({ list, pageOf, chapterOf, onGo, onExport }: { list: Highlight[]; pageOf: (h: Highlight) => number; chapterOf: (h: Highlight) => string; onGo: (h: Highlight) => void; onExport: () => void }) {
  if (!list.length) return <p className="rd-empty">还没有划线。<br />在书页上拖选一段文字，就能划线、写批注。</p>;
  let last = '';
  return (
    <div className="nl">
      {list.map((h) => {
        const ch = chapterOf(h), head = ch !== last ? ch : '';
        last = ch;
        return (
          <div key={h.id}>
            {head && <p className="nl-ch">{head}</p>}
            <button type="button" className="nl-item" style={{ ['--mk' as string]: markerColor(h.color) }} onClick={() => onGo(h)}>
              <span className={`nl-q ${h.color === 'pen' ? 'pen' : ''}`}>{h.text}</span>
              {h.note && <span className="nl-n">{h.note}</span>}
              <span className="nl-p mono">{String(pageOf(h)).padStart(3, '0')}</span>
            </button>
          </div>
        );
      })}
      <button type="button" className="btn ghost sm nl-export" onClick={onExport}><Icon name="copy" size={14} />复制全部笔记（Markdown）</button>
    </div>
  );
}
