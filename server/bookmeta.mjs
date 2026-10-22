// What a book file says about itself: title, author and cover from an EPUB's package document,
// or a best guess from the file name for everything else.
import { unzipSync, strFromU8 } from 'fflate';
import { posix } from 'node:path';

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export const unxml = (s = '') =>
  s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => (e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m))
    .replace(/\s+/g, ' ')
    .trim();

const attr = (tag, name) => tag.match(new RegExp(`\\s${name}\\s*=\\s*"([^"]*)"|\\s${name}\\s*=\\s*'([^']*)'`, 'i'))?.slice(1).find((x) => x != null);
const dc = (opf, name) => {
  const m = opf.match(new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'i'));
  return m ? unxml(m[1]) : '';
};
const dcAll = (opf, name) => [...opf.matchAll(new RegExp(`<dc:${name}\\b[^>]*>([\\s\\S]*?)</dc:${name}>`, 'gi'))].map((m) => unxml(m[1])).filter(Boolean);

function one(buf, path) {
  const got = unzipSync(buf, { filter: (f) => f.name === path });
  return got[path] ?? null;
}

/** EPUB → { title, author, language, year, publisher, description, cover: { bytes, type } | null } */
export function epubMeta(buf) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const container = one(u8, 'META-INF/container.xml');
  if (!container) throw new Error('not an epub (no container.xml)');
  const opfPath = attr(strFromU8(container).match(/<rootfile\b[^>]*>/i)?.[0] ?? '', 'full-path');
  if (!opfPath) throw new Error('epub without a package document');
  const opfRaw = one(u8, opfPath);
  if (!opfRaw) throw new Error('package document missing');
  const opf = strFromU8(opfRaw);
  const base = posix.dirname(opfPath);

  const items = [...opf.matchAll(/<item\b[^>]*>/gi)].map((m) => ({ id: attr(m[0], 'id'), href: attr(m[0], 'href'), type: attr(m[0], 'media-type') || '', props: attr(m[0], 'properties') || '' }));
  const coverId = attr(opf.match(/<meta\b[^>]*name\s*=\s*["']cover["'][^>]*>/i)?.[0] ?? '', 'content');
  const img = (i) => i && /^image\//.test(i.type);
  let ci = items.find((i) => /\bcover-image\b/.test(i.props)) || items.find((i) => i.id === coverId && img(i)) || items.find((i) => img(i) && /cover/i.test(`${i.id} ${i.href}`));
  let cover = null;
  if (img(ci)) {
    const p = posix.normalize(posix.join(base, decodeURIComponent(ci.href)));
    const bytes = one(u8, p);
    if (bytes && bytes.length > 512) cover = { bytes, type: ci.type };
  }
  const date = dc(opf, 'date');
  return {
    title: dc(opf, 'title'),
    author: dcAll(opf, 'creator').slice(0, 3).join(' / '),
    language: dc(opf, 'language'),
    year: Number(date.match(/\b(1[5-9]\d\d|20\d\d)\b/)?.[1]) || undefined,
    publisher: dc(opf, 'publisher'),
    description: dc(opf, 'description').slice(0, 1200),
    subjects: dcAll(opf, 'subject').flatMap((x) => x.split(/\s+--\s+|[;；]/)).map((x) => x.trim()).filter(Boolean).slice(0, 6),
    cover,
  };
}

/** "三体 (刘慈欣) (Z-Library).epub" → { title: "三体", author: "刘慈欣" } */
export function nameMeta(file) {
  let s = file.replace(/\.[a-z0-9]{2,5}$/i, '').replace(/[_]+/g, ' ');
  s = s.replace(/\s*[([（【]\s*(z-?lib(rary)?(\.\w+)?|1lib|libgen|anna'?s archive)\s*[)\]）】]\s*/gi, ' ').trim();
  const by = s.match(/^(.*?)\s*[([（【]([^()[\]（）【】]{1,40})[)\]）】]\s*$/);
  if (by) return { title: by[1].trim(), author: by[2].trim() };
  const dash = s.match(/^(.+?)\s+[-–—]\s+(.+)$/);
  if (dash) return { title: dash[1].trim(), author: dash[2].trim() };
  return { title: s.trim(), author: '' };
}

export const extOf = (name = '') => (name.match(/\.([a-z0-9]{2,5})$/i)?.[1] ?? '').toLowerCase();
