/**
 * A book file → chapters of clean HTML. EPUBs are unzipped in the page (fflate), their XHTML sanitised
 * (DOMPurify) and stripped of the publisher's CSS so our own typography sets them; images become blob URLs,
 * links inside the book become `data-href="<chapter>#<id>"`. Plain text is split on chapter headings.
 */
import { unzipSync, strFromU8 } from 'fflate';
import DOMPurify from 'dompurify';

export type Chapter = { title: string; html: string; file: string };
export type TocItem = { label: string; chapter: number; anchor?: string; depth: number };
export type LoadedBook = { chapters: Chapter[]; toc: TocItem[]; lang: string; urls: string[]; chars: number };

const dir = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/') + 1) : '');
function resolve(base: string, href: string) {
  const out: string[] = [];
  for (const seg of (dir(base) + href).split('/')) {
    if (seg === '..') out.pop();
    else if (seg && seg !== '.') out.push(seg);
  }
  return out.join('/');
}
const parseXml = (s: string) => new DOMParser().parseFromString(s, 'application/xml');
function parseDoc(s: string) {
  const x = new DOMParser().parseFromString(s, 'application/xhtml+xml');
  return x.getElementsByTagName('parsererror').length ? new DOMParser().parseFromString(s, 'text/html') : x;
}
/** A line that is a chapter heading: 第十二回 …, 第三章 …, Chapter IV, 序, 楔子, 尾声… */
const HEAD = /^\s*(第[零〇一二三四五六七八九十百千万两\d]+[章回节卷集部篇幕][^\n]{0,36}|(?:chapter|part|book)\s+[\divxlc]+\b[^\n]{0,60}|序[章言]?|楔子|引子|尾声|后记|後記|前言|自序)\s*$/i;
const byLocal = (root: Document | Element, name: string) => [...root.getElementsByTagNameNS('*', name)];

const PURIFY = {
  FORBID_TAGS: ['style', 'script', 'link', 'meta', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'audio', 'video', 'source', 'title', 'head'],
  FORBID_ATTR: ['style', 'class', 'width', 'height', 'align', 'bgcolor', 'color', 'face', 'size', 'onerror', 'onload'],
  ADD_ATTR: ['data-href', 'epub:type'],
  // pictures are blob: URLs made from the book's own files; the default list would strip them
  ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|blob|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
};

export async function loadBook(buf: ArrayBuffer, ext: string, title: string): Promise<LoadedBook> {
  if (ext === 'epub') return loadEpub(new Uint8Array(buf));
  return loadText(buf, ext, title);
}

/* ---------------- EPUB ---------------- */

function loadEpub(u8: Uint8Array): LoadedBook {
  const files = unzipSync(u8);
  const get = (p: string) => files[p] ?? files[decodeURIComponent(p)] ?? null;
  const container = get('META-INF/container.xml');
  if (!container) throw new Error('这不是一个有效的 EPUB（缺少 container.xml）');
  const opfPath = parseXml(strFromU8(container)).querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath || !get(opfPath)) throw new Error('EPUB 缺少目录文件（OPF）');
  const opf = parseXml(strFromU8(get(opfPath)!));
  const lang = byLocal(opf, 'language')[0]?.textContent?.trim() || '';

  const manifest = new Map<string, { href: string; type: string; props: string }>();
  for (const it of byLocal(opf, 'item')) manifest.set(it.getAttribute('id') || '', { href: resolve(opfPath, it.getAttribute('href') || ''), type: it.getAttribute('media-type') || '', props: it.getAttribute('properties') || '' });
  const spineEl = byLocal(opf, 'spine')[0];
  const spine = byLocal(opf, 'itemref').map((r) => manifest.get(r.getAttribute('idref') || '')).filter((m): m is NonNullable<typeof m> => !!m && /x?html|xml/.test(m.type) && !/\bnav\b/.test(m.props));
  const chapterOf = new Map(spine.map((m, i) => [m.href, i]));

  // blob URLs for images, made the first time a chapter asks for one
  const urls = new Map<string, string>();
  const imageUrl = (p: string) => {
    if (urls.has(p)) return urls.get(p)!;
    const bytes = get(p);
    if (!bytes) return '';
    const type = [...manifest.values()].find((m) => m.href === p)?.type || (/\.png$/i.test(p) ? 'image/png' : /\.gif$/i.test(p) ? 'image/gif' : /\.svg$/i.test(p) ? 'image/svg+xml' : /\.webp$/i.test(p) ? 'image/webp' : 'image/jpeg');
    const u = URL.createObjectURL(new Blob([bytes.slice()], { type }));
    urls.set(p, u);
    return u;
  };

  // the table of contents: EPUB 3 nav, else EPUB 2 NCX
  const toc: TocItem[] = [];
  const pushToc = (label: string, href: string, base: string, depth: number) => {
    const [file, anchor] = resolve(base, href).split('#');
    const chapter = chapterOf.get(file);
    if (chapter != null && label.trim()) toc.push({ label: label.replace(/\s+/g, ' ').trim(), chapter, anchor: anchor || undefined, depth });
  };
  const nav = [...manifest.values()].find((m) => /\bnav\b/.test(m.props));
  if (nav && get(nav.href)) {
    const doc = parseDoc(strFromU8(get(nav.href)!));
    const navs = byLocal(doc, 'nav');
    const tocNav = navs.find((n) => /toc/.test(n.getAttribute('epub:type') || n.getAttributeNS('http://www.idpf.org/2007/ops', 'type') || '')) || navs[0];
    const walk = (ol: Element, depth: number) => {
      for (const li of [...ol.children].filter((c) => c.localName === 'li')) {
        const a = [...li.children].find((c) => c.localName === 'a' || c.localName === 'span');
        if (a?.getAttribute('href')) pushToc(a.textContent || '', a.getAttribute('href')!, nav.href, depth);
        const sub = [...li.children].find((c) => c.localName === 'ol');
        if (sub) walk(sub, depth + 1);
      }
    };
    const ol = tocNav && [...tocNav.children].find((c) => c.localName === 'ol');
    if (ol) walk(ol, 0);
  }
  if (!toc.length) {
    const ncxItem = manifest.get(spineEl?.getAttribute('toc') || '') || [...manifest.values()].find((m) => /ncx/.test(m.type));
    if (ncxItem && get(ncxItem.href)) {
      const ncx = parseXml(strFromU8(get(ncxItem.href)!));
      const walk = (parent: Element, depth: number) => {
        for (const np of [...parent.children].filter((c) => c.localName === 'navPoint')) {
          const label = byLocal(np, 'text')[0]?.textContent || '';
          const src = [...np.children].find((c) => c.localName === 'content')?.getAttribute('src') || '';
          if (src) pushToc(label, src, ncxItem.href, depth);
          walk(np, depth + 1);
        }
      };
      const map = byLocal(ncx, 'navMap')[0];
      if (map) walk(map, 0);
    }
  }

  // A contents list that misses the chapters (common in converted books: one file, every 回 a paragraph)
  // is rebuilt from the chapter headings found in the text, and each of those starts a new page.
  const thin = toc.filter((t) => !/gutenberg|license/i.test(t.label)).length < 3;
  const found: TocItem[] = [];
  let hn = 0;
  let chars = 0;
  const chapters: Chapter[] = spine.map((m, i) => {
    const raw = get(m.href);
    if (!raw) return { title: '', html: '', file: m.href };
    const doc = parseDoc(strFromU8(raw));
    const body = doc.querySelector('body') || byLocal(doc, 'body')[0];
    if (!body) return { title: '', html: '', file: m.href };
    // an SVG-wrapped picture (common for covers) becomes a plain image
    for (const svg of byLocal(body, 'svg')) {
      const im = byLocal(svg, 'image')[0];
      const href = im?.getAttribute('xlink:href') || im?.getAttributeNS('http://www.w3.org/1999/xlink', 'href') || im?.getAttribute('href');
      if (href) { const img = doc.createElementNS('http://www.w3.org/1999/xhtml', 'img'); img.setAttribute('src', href); svg.replaceWith(img); }
    }
    const pictured = byLocal(body, 'img').length > 0;
    for (const img of byLocal(body, 'img')) {
      let src = img.getAttribute('src') || '';
      if (src && !/^(https?:|data:)/.test(src)) src = imageUrl(resolve(m.href, src.split('#')[0]));
      // a picture whose file isn't in the book would print as an empty box (or a whole blank page)
      if (!src) { img.remove(); continue; }
      img.setAttribute('src', src);
      img.setAttribute('alt', img.getAttribute('alt') || '');
    }
    if (thin) {
      for (const el of [...body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, div')]) {
        const t = (el.textContent || '').replace(/\s+/g, ' ').trim();
        if (t.length > 44 || !HEAD.test(t)) continue;
        if (el.querySelector('p, div, h1, h2, h3')) continue;
        const h = doc.createElementNS('http://www.w3.org/1999/xhtml', 'h2');
        h.setAttribute('id', el.getAttribute('id') || `rl-h-${hn++}`);
        h.setAttribute('data-break', '1');
        h.append(...el.childNodes);
        el.replaceWith(h);
        found.push({ label: t.replace(/\s+/g, ' '), chapter: i, anchor: h.getAttribute('id')!, depth: 0 });
      }
    }
    for (const a of byLocal(body, 'a')) {
      const href = a.getAttribute('href') || '';
      if (!href) continue;
      if (/^[a-z]+:/i.test(href)) { a.setAttribute('target', '_blank'); a.setAttribute('rel', 'noreferrer'); continue; }
      const [file, anchor] = (href.startsWith('#') ? m.href + href : resolve(m.href, href)).split('#');
      const ci = chapterOf.get(file);
      a.removeAttribute('href');
      if (ci != null) a.setAttribute('data-href', `${ci}#${anchor || ''}`);
    }
    const ser = new XMLSerializer();
    const inner = [...body.childNodes].map((n) => ser.serializeToString(n)).join('');
    const html = DOMPurify.sanitize(inner, PURIFY) as string;
    chars += (body.textContent || '').replace(/\s+/g, '').length;
    const heading = body.querySelector('h1, h2, h3')?.textContent?.trim();
    const t = toc.find((x) => x.chapter === i && !x.anchor)?.label || toc.find((x) => x.chapter === i)?.label || heading || '';
    return { title: t, html, file: m.href, pictured };
  // which chapters are kept must not change between versions: reading positions, bookmarks and highlights
  // are stored by chapter number. A chapter that had a picture stays, even if the picture's file is missing.
  }).filter((c) => c.html.replace(/<[^>]+>/g, '').trim() || c.pictured);
  if (thin && found.length >= 3) toc.splice(0, toc.length, ...found, ...toc.filter((t) => /gutenberg|license/i.test(t.label)));
  // chapters dropped above shift indices; rebuild the toc against what remains
  const kept = new Map(chapters.map((c, i) => [c.file, i]));
  const fixed = toc.flatMap((t) => { const f = spine[t.chapter]?.href; const c = f != null ? kept.get(f) : undefined; return c == null ? [] : [{ ...t, chapter: c }]; });
  for (const c of chapters) c.html = c.html.replace(/data-href="(\d+)#/g, (_, n) => { const f = spine[+n]?.href; const k = f != null ? kept.get(f) : undefined; return `data-href="${k ?? -1}#`; });
  return { chapters, toc: fixed, lang, urls: [...urls.values()], chars };
}

/* ---------------- plain text ---------------- */

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function loadText(buf: ArrayBuffer, ext: string, title: string): LoadedBook {
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); }
  catch { text = new TextDecoder('gb18030').decode(buf); }
  text = text.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
  const lines = text.split('\n');
  const chapters: Chapter[] = [];
  let cur: { title: string; paras: string[] } = { title, paras: [] };
  const flush = () => { if (cur.paras.length) chapters.push({ title: cur.title, html: (cur.title ? `<h2 data-break="1">${esc(cur.title)}</h2>` : '') + cur.paras.join(''), file: `t${chapters.length}` }); };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.length < 40 && HEAD.test(line)) { flush(); cur = { title: line, paras: [] }; continue; }
    if (ext === 'md' && /^#{1,3}\s/.test(line)) { flush(); cur = { title: line.replace(/^#+\s*/, ''), paras: [] }; continue; }
    cur.paras.push(`<p>${esc(line)}</p>`);
  }
  flush();
  // a text without chapter headings still gets parts, so the contents and progress mean something
  if (chapters.length === 1 && chapters[0].html.length > 60000) {
    const paras = chapters[0].html.split('</p>').filter(Boolean).map((p) => p + '</p>');
    chapters.length = 0;
    let buf2: string[] = [], n = 0;
    for (const p of paras) { buf2.push(p); n += p.length; if (n > 24000) { chapters.push({ title: `第 ${chapters.length + 1} 部分`, html: buf2.join(''), file: `t${chapters.length}` }); buf2 = []; n = 0; } }
    if (buf2.length) chapters.push({ title: `第 ${chapters.length + 1} 部分`, html: buf2.join(''), file: `t${chapters.length}` });
  }
  const toc = chapters.map((c, i) => ({ label: c.title || `第 ${i + 1} 部分`, chapter: i, depth: 0 }));
  const chars = text.replace(/\s+/g, '').length;
  return { chapters, toc, lang: /[㐀-鿿]/.test(text.slice(0, 2000)) ? 'zh' : 'en', urls: [], chars };
}
