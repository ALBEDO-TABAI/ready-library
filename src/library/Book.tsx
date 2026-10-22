import { memo, useState } from 'react';
import { lookOf, TOPIC, type Look, type ShelfBook } from '../lib/topics';

/** The surname, or the first name in a list, short enough for the foot of a spine. */
const byline = (a: string) => {
  const first = a.split(/[/,，、&;]| and /)[0].trim();
  if (/[㐀-鿿]/.test(first)) return first.replace(/^[[［【(（][^\]］】)）]*[\]］】)）]\s*/, '').replace(/\s+/g, '').slice(0, 6);
  return first.split(/\s+/).slice(-1)[0] || first;
};
const isCJK = (s: string) => /[㐀-鿿]/.test(s);

/** A book seen end-on: cloth, the title running down it, the author at the foot. */
export const Spine = memo(function Spine({ book, look = lookOf(book) }: { book: ShelfBook; look?: Look }) {
  const { w, h, color, fg, style } = look;
  const by = byline(book.author);
  const cjk = isCJK(book.title);
  const bySize = Math.min(11, w * 0.24, (w - 10) / Math.max(1, by.length * (isCJK(by) ? 1 : 0.56)));
  const narrow = w < 40 || bySize < 8;
  const room = h - (style === 'label' ? 92 : style === 'bands' ? 96 : 70) - (narrow ? 0 : 28);
  const per = cjk ? 1.04 : style === 'sans' ? 0.54 : 0.5;
  const chars = book.title.length;
  const base = Math.max(11, Math.min(cjk ? 17 : 16, w * (cjk ? 0.4 : 0.36)));
  const size = Math.max(9, Math.min(base, room / Math.max(1, chars * per)));
  const reading = book.pct > 0 && book.pct < 1;
  return (
    <div className={`spine ${narrow ? 'is-narrow' : ''} ${book.wish ? 'is-wish' : ''}`} data-style={style} data-light={look.light || undefined} data-cjk={cjk || undefined}
      style={{ width: w, height: h, background: color, color: fg, ['--fg' as string]: fg }}>
      {reading && <span className="spine-ribbon" aria-hidden />}
      {style === 'bands' && <><span className="spine-bands top" /><span className="spine-bands bottom" /></>}
      {style === 'foil' && <span className="spine-orn">{book.favorite ? '★' : '◆'}</span>}
      {style === 'sans' && <span className="spine-no">{(book.ext || 'wish').slice(0, 4)}</span>}
      <span className={`spine-title-wrap ${style === 'label' ? 'is-label' : ''}`}>
        <span className="spine-title" style={{ fontSize: size }}>{book.title}</span>
      </span>
      {!narrow && by && <span className="spine-author" style={{ fontSize: bySize }}>{by}</span>}
    </div>
  );
});

/**
 * The front of a book. A real cover when we have one (from the EPUB or Z-Library), printed on the cloth;
 * otherwise a typeset one in the Ready manner: a hairline frame, a mono kicker, the title large.
 */
export const Cover = memo(function Cover({ book, look = lookOf(book), src }: { book: ShelfBook; look?: Look; src?: string }) {
  const [broken, setBroken] = useState(false);
  const t = TOPIC[book.topic];
  const img = src ?? book.cover;
  if (img && !broken) {
    return (
      <div className="cover has-art" style={{ background: look.color }}>
        <img src={img} alt="" draggable={false} decoding="async" loading="lazy" onError={() => setBroken(true)} />
        <span className="cover-hinge" aria-hidden />
        {book.wish && <span className="cover-wish">待取回</span>}
      </div>
    );
  }
  const cjk = isCJK(book.title);
  return (
    <div className="cover" data-light={look.light || undefined} style={{ background: look.color, color: look.fg }}>
      <div className="cover-kicker">
        <span>{t.en}</span>
        <span>{book.year ?? (book.ext ? book.ext.toUpperCase() : 'Nº ' + String(book.id.charCodeAt(0) * 7 % 900 + 100))}</span>
      </div>
      <div className="cover-mid" aria-hidden>
        <span className="cover-rule" />
        <span className="cover-dot" />
      </div>
      <div className="cover-type">
        <p className={`cover-title ${cjk ? 'is-cjk' : ''}`} style={{ fontSize: `${Math.max(8.5, Math.min(cjk ? 13 : 14, 150 / Math.max(4, book.title.length)))}cqw` }}>{book.title}</p>
        <p className="cover-author">{book.author}</p>
      </div>
      <span className="cover-hinge" aria-hidden />
      {book.wish && <span className="cover-wish">待取回</span>}
    </div>
  );
});
