/**
 * Chapters → printed pages. Each chapter's blocks are poured into a page-sized box; a paragraph that runs off
 * the bottom is cut at the last character whose line still fits (found by binary search on range rects, after a
 * single layout), so a page ends exactly where its last line ends. The second half carries on, unindented, on
 * the next page. Headings never end a page. Every page remembers where it starts (chapter + character), so a
 * reading position survives a change of type size or window.
 */
import type { LoadedBook } from './book';

export const PAGE_W = 594, PAGE_H = 846, BODY_H = 682;
export type PageKind = 'cover' | 'plate' | 'title' | 'toc' | 'text' | 'end' | 'blank' | 'back';
export type Page = { kind: PageKind; chapter: number; start: number; html: string; opens?: boolean; tocFrom?: number };
export type Layout = { pages: Page[]; chapterPage: number[]; idPage: Map<string, number>; firstText: number; tocRows: number };
export type Typo = { size: number; lead: number; font: 'song' | 'hei' | 'kai'; paper: 'white' | 'cream' | 'night' };

const CJK: Record<Typo['font'], string> = {
  song: "'Songti SC', 'STSong', 'Noto Serif CJK SC', 'Source Han Serif SC', 'SimSun'",
  hei: "'PingFang SC', 'Hiragino Sans GB', 'Noto Sans CJK SC', 'Microsoft YaHei'",
  kai: "'Kaiti SC', 'STKaiti', 'KaiTi', 'Noto Serif CJK SC'",
};
const LATIN: Record<Typo['font'], string> = {
  song: "'Iowan Old Style', 'Charter', 'Palatino', Georgia",
  hei: "-apple-system, 'Helvetica Neue', 'Segoe UI', Arial",
  kai: "'Iowan Old Style', 'Palatino', Georgia",
};
/** System faces only (a page raster can't load web fonts). A Chinese book keeps its CJK face first, so quotes and
 *  punctuation stay full-width; a Latin book puts a Latin face first and lets CJK fall through. */
export const fontStack = (f: Typo['font'], latin: boolean) => `${latin ? `${LATIN[f]}, ${CJK[f]}` : `${CJK[f]}, ${LATIN[f]}`}, ${f === 'hei' ? 'sans-serif' : 'serif'}`;
export const PAPERS: Record<Typo['paper'], { pp: string; pp2: string; pi: string }> = {
  white: { pp: '#fbfaf7', pp2: '#f0eee9', pi: '#18181a' },
  cream: { pp: '#f5efe2', pp2: '#ebe2cf', pi: '#2b241b' },
  night: { pp: '#202022', pp2: '#2a2a2d', pi: '#c9c4ba' },
};

const BLOCKY = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'TABLE', 'FIGURE', 'PRE', 'HR', 'BLOCKQUOTE', 'DL', 'CENTER', 'ADDRESS', 'DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'FIGCAPTION']);
const CONTAINER = new Set(['DIV', 'SECTION', 'ARTICLE', 'ASIDE', 'HEADER', 'FOOTER', 'MAIN', 'NAV', 'CENTER', 'BLOCKQUOTE', 'FIGURE']);
const UNSPLIT = new Set(['TABLE', 'PRE', 'HR', 'FIGURE']);
const nonWs = (s: string | null) => (s ? s.replace(/\s+/g, '').length : 0);

function flatten(node: ParentNode, out: HTMLElement[]) {
  let inline: Node[] = [];
  const flush = () => {
    if (inline.some((n) => (n.textContent ?? '').trim() || (n as Element).querySelector?.('img') || (n as Element).tagName === 'IMG')) {
      const p = document.createElement('p');
      p.append(...inline);
      out.push(p);
    }
    inline = [];
  };
  for (const n of [...node.childNodes]) {
    if (n.nodeType === 1) {
      const el = n as HTMLElement;
      const hasBlock = [...el.children].some((c) => BLOCKY.has(c.tagName));
      if (CONTAINER.has(el.tagName) && hasBlock && el.tagName !== 'BLOCKQUOTE') { flush(); flatten(el, out); continue; }
      if (BLOCKY.has(el.tagName)) { flush(); out.push(el.tagName === 'DIV' || el.tagName === 'SECTION' ? retag(el) : el); continue; }
      if (el.tagName === 'BR') { flush(); continue; }
      if (el.tagName === 'IMG') { flush(); const p = document.createElement('p'); p.append(el); out.push(p); continue; }
      inline.push(n);
    } else if (n.nodeType === 3) inline.push(n);
  }
  flush();
  for (let i = 0; i < out.length; i++) {
    const el = out[i];
    // a paragraph that is only a picture is a figure: centred, as large as the page allows
    if (el.tagName === 'P' && !(el.textContent ?? '').trim() && el.querySelector('img')) el.classList.add('pg-fig');
    // a "heading" that is a long run of sentence is body text a converter mislabelled
    const t = (el.textContent ?? '').trim();
    if (/^H[1-6]$/.test(el.tagName) && t.length > 28 && /[，。,;；]/.test(t)) out[i] = retag(el);
  }
}
const TERMINAL = /[。！？!?…」』”’）)】》.;；:：—~～]\s*$/;
/**
 * Hard-wrapped text (a TXT converted line by line, common for Chinese ebooks) arrives as one <p> per printed
 * line. When most lines stop mid-sentence, a line that doesn't end a sentence is joined to the next.
 */
function unwrap(blocks: HTMLElement[]): HTMLElement[] {
  const ps = blocks.filter((b) => b.tagName === 'P' && !b.classList.contains('pg-fig') && (b.textContent ?? '').trim().length > 12);
  if (ps.length < 8) return blocks;
  const open = ps.filter((b) => !TERMINAL.test(b.textContent ?? '')).length;
  if (open / ps.length < 0.3) return blocks;
  const out: HTMLElement[] = [];
  for (const b of blocks) {
    const prev = out[out.length - 1];
    if (prev && prev.tagName === 'P' && b.tagName === 'P' && !prev.classList.contains('pg-fig') && !b.classList.contains('pg-fig')
      && (prev.textContent ?? '').trim() && !TERMINAL.test(prev.textContent ?? '') && (b.textContent ?? '').trim()) {
      const first = b.firstChild;
      if (first?.nodeType === 3) first.textContent = (first.textContent ?? '').replace(/^\s+/, '');
      prev.append(...b.childNodes);
      continue;
    }
    out.push(b);
  }
  return out;
}

/** A leaf <div> of text reads as a paragraph. */
function retag(el: HTMLElement) {
  const p = document.createElement('p');
  for (const a of [...el.attributes]) p.setAttribute(a.name, a.value);
  p.append(...el.childNodes);
  return p;
}

function textNodes(el: Node) {
  const out: Text[] = [];
  const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n as Text);
  return out;
}
function locate(nodes: Text[], i: number): [Text, number] {
  for (const n of nodes) { if (i < n.length) return [n, i]; i -= n.length; }
  const last = nodes[nodes.length - 1];
  return [last, last.length];
}

/** The index just after the last character of `el` whose line ends above `limit`, or 0 if none does. */
function splitPoint(el: HTMLElement, limit: number): number {
  const nodes = textNodes(el);
  const total = nodes.reduce((n, t) => n + t.length, 0);
  if (!total) return 0;
  const r = document.createRange();
  const bottomOf = (i: number): number => {
    for (let k = i; k >= 0; k--) {
      const [n, o] = locate(nodes, k);
      if (o >= n.length) continue;
      r.setStart(n, o); r.setEnd(n, o + 1);
      const rects = r.getClientRects();
      if (rects.length) return rects[rects.length - 1].bottom;
    }
    return Infinity;
  };
  let lo = 0, hi = total - 1, best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bottomOf(mid) <= limit + 0.5) { best = mid; lo = mid + 1; } else hi = mid - 1;
  }
  let at = best + 1;
  if (at <= 0 || at >= total) return 0;
  // Latin: don't cut a word in two; step back to the space the line broke at
  const text = nodes.map((n) => n.data).join('');
  if (/\w/.test(text[at - 1]) && /\w/.test(text[at] ?? '')) {
    const sp = text.lastIndexOf(' ', at);
    if (sp > 0 && at - sp < 40) at = sp + 1;
  }
  return at;
}
function cut(el: HTMLElement, at: number): [HTMLElement, HTMLElement] {
  const nodes = textNodes(el);
  const [n, o] = locate(nodes, at);
  const r1 = document.createRange(); r1.setStart(el, 0); r1.setEnd(n, o);
  const r2 = document.createRange(); r2.setStart(n, o); r2.setEnd(el, el.childNodes.length);
  const a = el.cloneNode(false) as HTMLElement, b = el.cloneNode(false) as HTMLElement;
  a.append(r1.cloneContents()); b.append(r2.cloneContents());
  b.removeAttribute('id');
  return [a, b];
}

export async function paginate(book: LoadedBook, typo: Typo, opts: { latin: boolean; tocRows: number; onProgress?: (p: number) => void; signal?: AbortSignal }): Promise<Layout> {
  const host = document.createElement('div');
  host.className = `sheet measure ${opts.latin ? 'latin' : ''}`;
  host.style.cssText = `position:fixed;left:-20000px;top:0;visibility:hidden;contain:layout style;--fs:${typo.size}px;--lh:${typo.lead};--pf:${fontStack(typo.font, opts.latin)}`;
  host.innerHTML = '<div class="pg-body"><div class="pg-flow"></div></div>';
  document.body.appendChild(host);
  const flow = host.querySelector('.pg-flow') as HTMLElement;

  const pages: Page[] = [];
  const idPage = new Map<string, number>();
  const chapterPage: number[] = [];
  // front matter: cover, bookplate, title page, contents (as many pages as the rows need)
  pages.push({ kind: 'cover', chapter: -1, start: 0, html: '' }, { kind: 'plate', chapter: -1, start: 0, html: '' }, { kind: 'title', chapter: -1, start: 0, html: '' });
  const ROWS = 22;
  for (let r = 0; r < opts.tocRows; r += ROWS) pages.push({ kind: 'toc', chapter: -1, start: 0, html: '', tocFrom: r });
  if (pages.length % 2) pages.push({ kind: 'blank', chapter: -1, start: 0, html: '' });
  const firstText = pages.length;

  const totalChars = Math.max(1, book.chars);
  let t0 = performance.now();
  try {
    for (let ci = 0; ci < book.chapters.length; ci++) {
      const tpl = document.createElement('template');
      tpl.innerHTML = book.chapters[ci].html;
      const flat: HTMLElement[] = [];
      flatten(tpl.content, flat);
      const blocks = unwrap(flat);
      if (!blocks.length) { chapterPage[ci] = pages.length; continue; }
      // pictures must be decoded before they can be measured
      const imgs = blocks.flatMap((b) => [...b.querySelectorAll('img')]);
      if (imgs.length) await Promise.all(imgs.map((im) => (im as HTMLImageElement).decode().catch(() => {})));

      chapterPage[ci] = pages.length;
      let chars = 0, pageStart = 0, opens = true;
      flow.classList.add('opens');
      const close = () => {
        if (!flow.childElementCount) return;
        for (const el of flow.querySelectorAll('[id]')) idPage.set(`${ci}#${el.id}`, pages.length);
        pages.push({ kind: 'text', chapter: ci, start: pageStart, html: flow.innerHTML, opens });
        flow.textContent = '';
        flow.classList.remove('opens');
        opens = false;
        pageStart = chars;
      };
      const flowTop = () => flow.getBoundingClientRect().top;
      for (const block of blocks) {
        let el = block.cloneNode(true) as HTMLElement;
        // a chapter heading found inside a file starts a fresh page, set as an opening
        if (el.dataset.break && flow.childElementCount) { close(); opens = true; flow.classList.add('opens'); }
        for (let guard = 0; guard < 400; guard++) {
          flow.appendChild(el);
          const top = flowTop();
          if (el.getBoundingClientRect().bottom - top <= BODY_H + 0.5) { chars += nonWs(el.textContent); break; }
          // it runs off the page: cut it where its last whole line ends
          const at = UNSPLIT.has(el.tagName) || el.classList.contains('pg-fig') ? 0 : splitPoint(el, top + BODY_H);
          if (at > 0) {
            const [a, b] = cut(el, at);
            a.classList.add('split-head');
            el.replaceWith(a);
            if (a.getBoundingClientRect().bottom - top <= BODY_H + 0.5) {
              chars += nonWs(a.textContent);
              close();
              el = b;
              el.classList.add('cont');
              el.classList.remove('split-head');
              continue;
            }
            a.remove();
          } else el.remove();
          if (!flow.childElementCount) {
            // taller than a whole page (a big table or picture): it gets a page to itself, clipped
            el.classList.add('pg-tall');
            flow.appendChild(el);
            chars += nonWs(el.textContent);
            close();
            break;
          }
          // a heading never ends a page; it moves down with what follows it
          const last = flow.lastElementChild as HTMLElement | null;
          if (last && /^H[1-6]$/.test(last.tagName) && flow.childElementCount > 1) {
            last.remove();
            const hc = nonWs(last.textContent);
            chars -= hc;
            close();
            flow.appendChild(last);
            chars += hc;
          } else close();
        }
        if (performance.now() - t0 > 14) {
          opts.onProgress?.(Math.min(0.99, (chapterProgress(ci, book) + chars / totalChars)));
          await new Promise((r) => setTimeout(r, 0));
          if (opts.signal?.aborted) throw new DOMException('aborted', 'AbortError');
          t0 = performance.now();
        }
      }
      close();
      flow.classList.remove('opens');
    }
  } finally {
    host.remove();
  }
  pages.push({ kind: 'end', chapter: -1, start: 0, html: '' });
  if (pages.length % 2 === 0) pages.push({ kind: 'blank', chapter: -1, start: 0, html: '' });
  pages.push({ kind: 'back', chapter: -1, start: 0, html: '' });
  opts.onProgress?.(1);
  return { pages, chapterPage, idPage, firstText, tocRows: opts.tocRows };
}

/** Characters in the chapters before `ci`, as a share of the book, for the progress bar while laying out. */
const before = new WeakMap<LoadedBook, number[]>();
function chapterProgress(ci: number, book: LoadedBook) {
  let acc = before.get(book);
  if (!acc) {
    acc = [];
    let s = 0;
    for (const c of book.chapters) { acc.push(s); s += nonWs(c.html.replace(/<[^>]+>/g, '')); }
    acc = acc.map((x) => x / Math.max(1, s));
    before.set(book, acc);
  }
  return acc[ci] ?? 0;
}
