/**
 * Highlights on printed pages. A highlight is anchored like a reading position: a chapter and offsets counted in
 * non-space characters, which every layout of the chapter shares — so marks survive a new type size, typeface or
 * window. Painting one onto a page splits text nodes and wraps the pieces in <mark>; nothing else changes.
 */
import type { Highlight, Marker } from '../lib/api';
import type { Layout, Page } from './paginate';

export const MARKERS: { key: Marker; color: string; label: string }[] = [
  { key: 'yellow', color: '#f2c94c', label: '黄' },
  { key: 'green', color: '#8fd17c', label: '绿' },
  { key: 'blue', color: '#86b8f2', label: '蓝' },
  { key: 'pink', color: '#f39cbc', label: '粉' },
  { key: 'pen', color: '#ff5a1f', label: '红笔划线' },
];
export const markerColor = (m: Marker) => MARKERS.find((x) => x.key === m)?.color ?? '#f2c94c';

const nonWs = (s: string | null) => (s ? s.replace(/\s+/g, '').length : 0);
const WS = /\s/;
function textNodes(el: Node) {
  const out: Text[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}
/** Index in `s` of its k-th non-space character (k from 0), or s.length. */
function nth(s: string, k: number) {
  for (let i = 0; i < s.length; i++) if (!WS.test(s[i]) && k-- === 0) return i;
  return s.length;
}
/** The words between two offsets of a text, counted the same way. */
export function sliceNonWs(s: string, from: number, to: number) { return s.slice(nth(s, from), nth(s, Math.max(from, to - 1)) + 1); }

/** Paint the highlights that touch this page onto its text flow (`start` = the page's first offset in its chapter). */
export function paintMarks(flow: HTMLElement, start: number, list: Highlight[], active?: string | null) {
  if (!list.length) return;
  const end = start + nonWs(flow.textContent);
  for (const h of list) {
    const a = Math.max(h.from, start) - start, b = Math.min(h.to, end) - start;
    if (b <= a) continue;
    const pieces: [Text, number, number][] = [];
    let c = 0;
    for (const t of textNodes(flow)) {
      const n = nonWs(t.data);
      if (n && c + n > a && c < b) {
        const i = nth(t.data, Math.max(a, c) - c), j = nth(t.data, Math.min(b, c + n) - c - 1) + 1;
        if (j > i) pieces.push([t, i, j]);
      }
      c += n;
      if (c >= b) break;
    }
    pieces.forEach(([t, i, j], k) => {
      const mid = i > 0 ? t.splitText(i) : t;
      if (j - i < mid.length) mid.splitText(j - i);
      const m = document.createElement('mark');
      m.className = `hl${h.id === active ? ' is-hot' : ''}`;
      m.dataset.hl = h.id; m.dataset.c = h.color;
      if (h.note) m.dataset.note = '1';
      if (k === 0 && h.from >= start) m.dataset.start = '1';
      if (k === pieces.length - 1 && h.to <= end) m.dataset.end = '1';
      mid.replaceWith(m);
      m.appendChild(mid);
    });
  }
}

/** Where page `i` ends in its chapter (the next page's start, or the end of the chapter). */
export const pageEnd = (L: Layout, i: number) => {
  const p = L.pages[i], q = L.pages[i + 1];
  return q && q.kind === 'text' && q.chapter === p.chapter ? q.start : Infinity;
};
/** The pages a highlight is painted on. */
export function pagesOf(L: Layout, h: Pick<Highlight, 'chapter' | 'from' | 'to'>) {
  const out: number[] = [];
  for (let i = L.chapterPage[h.chapter] ?? 0; i < L.pages.length; i++) {
    const p = L.pages[i];
    if (p.kind !== 'text') { if (p.chapter > h.chapter) break; continue; }
    if (p.chapter !== h.chapter) { if (p.chapter > h.chapter) break; continue; }
    if (p.start >= h.to) break;
    if (pageEnd(L, i) > h.from) out.push(i);
  }
  return out;
}

/** A chapter's text as the pages print it (the offsets above count into this). */
const texts = new WeakMap<Layout, Map<number, string>>();
export function chapterText(L: Layout, chapter: number) {
  let m = texts.get(L);
  if (!m) texts.set(L, (m = new Map()));
  let s = m.get(chapter);
  if (s == null) {
    const tpl = document.createElement('template');
    tpl.innerHTML = L.pages.filter((p) => p.kind === 'text' && p.chapter === chapter).map((p: Page) => `<div>${p.html}</div>`).join('');
    s = tpl.content.textContent ?? '';
    m.set(chapter, s);
  }
  return s;
}

type Point = { pi: number; chapter: number; at: number; flow: HTMLElement };
function point(node: Node, offset: number, L: Layout): Point | null {
  const el = node.nodeType === 1 ? (node as Element) : node.parentElement;
  const sheet = el?.closest<HTMLElement>('.sheet[data-pi]');
  const flow = sheet?.querySelector<HTMLElement>('.pg-flow');
  if (!sheet || !flow) return null;
  const pi = +sheet.dataset.pi!, pg = L.pages[pi];
  if (!pg || pg.kind !== 'text') return null;
  let n: number;
  if (flow.contains(node)) {
    const r = document.createRange();
    r.setStart(flow, 0);
    try { r.setEnd(node, offset); } catch { return null; }
    n = nonWs(r.toString());
  } else n = flow.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_PRECEDING ? 0 : nonWs(flow.textContent);
  return { pi, chapter: pg.chapter, at: pg.start + n, flow };
}

/** The live selection as a highlight's anchor and words, or null when it isn't in the text of a page. */
export function anchorOf(sel: Selection, L: Layout): { chapter: number; from: number; to: number; text: string } | null {
  if (!sel.rangeCount || sel.isCollapsed) return null;
  const r = sel.getRangeAt(0);
  const a = point(r.startContainer, r.startOffset, L);
  let b = point(r.endContainer, r.endOffset, L);
  if (!a) return null;
  // across a chapter's end: up to the end of the page it began on
  if (!b || b.chapter !== a.chapter) b = { ...a, at: L.pages[a.pi].start + nonWs(a.flow.textContent) };
  if (b.at <= a.at) return null;
  const text = sliceNonWs(chapterText(L, a.chapter), a.at, b.at).replace(/\s+/g, ' ').trim();
  return text ? { chapter: a.chapter, from: a.at, to: b.at, text: text.slice(0, 4000) } : null;
}
