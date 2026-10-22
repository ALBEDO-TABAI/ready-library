import { fmtChars, lookOf, type ShelfBook, type Topic } from '../lib/topics';
import { Cover } from './Book';

const total = (books: ShelfBook[]) => fmtChars(books.reduce((n, b) => n + b.chars, 0));

/** Every topic as a card: its cloth as a field of colour, its name set large, its books standing in a row. */
export function TopicGrid({ topics, onPick }: { topics: { topic: Topic; books: ShelfBook[] }[]; onPick: (t: Topic) => void }) {
  return (
    <div className="topic-grid">
      {topics.map(({ topic: t, books }, i) => (
        <button key={t.key} type="button" className="topic-card" onClick={() => onPick(t)}
          style={{ ['--c' as string]: t.shades[0], ['--c-deep' as string]: t.shades[2], ['--c-pale' as string]: t.shades[3], ['--i' as string]: i }}>
          <div className="topic-card-field" aria-hidden>
            <span className="topic-card-en">{t.en}</span>
            <span className="topic-card-no mono">{String(i + 1).padStart(2, '0')}</span>
          </div>
          <div className="topic-card-body">
            <h3>{t.name}</h3>
            <p className="caption"><b>{books.length}</b> 本<i className="dot" />{books.filter((b) => b.pct > 0 && b.pct < 1).length} 本在读{total(books) && <><i className="dot" />{total(books)}</>}</p>
          </div>
          <div className="mini-shelf" aria-hidden>
            {books.slice(0, 16).map((b, j) => {
              const l = lookOf(b);
              return <span key={b.id} className="mini-spine" style={{ width: Math.round(l.w * 0.36), height: Math.round(l.h * 0.27), background: l.color, ['--j' as string]: j }} />;
            })}
          </div>
        </button>
      ))}
    </div>
  );
}

/** One topic, its books face-out, like the table at the front of a bookshop. */
export function TopicPage({ topic: t, books, onOpen, onBack }: { topic: Topic; books: ShelfBook[]; onOpen: (b: ShelfBook, el: HTMLElement) => void; onBack: () => void }) {
  return (
    <div style={{ ['--c' as string]: t.shades[0], ['--c-pale' as string]: t.shades[3] }}>
      <header className="topic-head">
        <button type="button" className="btn ghost sm topic-back" onClick={onBack}>← 全部分类</button>
        <p className="caption"><span>{t.en.toUpperCase()}</span><i className="dot" /><b>{books.length}</b> 本{total(books) && <><i className="dot" />{total(books)}</>}</p>
        <h2 className="topic-name">{t.name}</h2>
        <p className="topic-blurb">{t.blurb}</p>
      </header>
      <ul className="face-out">
        {books.map((b, i) => (
          <li key={b.id} style={{ ['--i' as string]: i }}>
            <button type="button" className="face-btn" aria-label={`${b.title}，${b.author}`} onClick={(e) => onOpen(b, e.currentTarget.querySelector('.face-cover') as HTMLElement)}>
              <div className="face-cover">
                <Cover book={b} />
                {b.pct > 0 && b.pct < 1 && <span className="face-ribbon" aria-hidden />}
              </div>
            </button>
            <p className="face-title">{b.title}</p>
            <p className="caption face-meta">
              <span>{b.author || '佚名'}</span>
              {b.pct > 0 && <><i className="dot" /><b>{b.pct >= 1 ? '读完' : `${Math.round(b.pct * 100)}%`}</b></>}
              {b.wish && <><i className="dot" /><span>待取回</span></>}
            </p>
          </li>
        ))}
        {!books.length && <li className="empty-note">这一层还是空的。</li>}
      </ul>
    </div>
  );
}
