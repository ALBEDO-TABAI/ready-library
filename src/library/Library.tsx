import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from '../lib/store';
import { api, coverUrl, type BookRec } from '../lib/api';
import { lengthOf, sortBooks, SORTS, TOPIC, TOPICS, topicFor, type ShelfBook, type Sort, type Topic, type TopicKey } from '../lib/topics';
import { Icon } from '../ui/Icon';
import { LSeg } from '../ui/controls';
import { Logo, Wordmark } from '../ui/Logo';
import { BookOpen, type Origin } from './BookOpen';
import { JobLine } from '../find/JobView';
import { Shelf } from './Shelf';
import { TopicGrid, TopicPage } from './Topics';
import G from '../ui/glass/glass';

type View = 'shelf' | 'topics';
type Tag = 'reading' | 'favorite' | 'finished' | 'wish';
const TAGS: { key: Tag; label: string; test: (b: ShelfBook) => boolean }[] = [
  { key: 'reading', label: '在读', test: (b) => b.pct > 0 && b.pct < 1 },
  { key: 'favorite', label: '收藏', test: (b) => b.favorite },
  { key: 'finished', label: '读完', test: (b) => b.pct >= 1 },
  { key: 'wish', label: '待取回', test: (b) => b.wish },
];

export const shelfBook = (x: BookRec): ShelfBook => ({
  id: x.id,
  title: x.title,
  author: x.author,
  year: x.year,
  topic: x.topic ?? topicFor({ cats: x.tags, title: x.title }),
  chars: lengthOf(x),
  added: x.addedAt,
  opened: x.openedAt,
  pct: x.progress?.pct ?? 0,
  favorite: Boolean(x.favorite),
  wish: x.status === 'wish' || !x.file,
  ext: x.file?.ext,
  cover: coverUrl(x),
});

export function Library({ leaving = false }: { leaving?: boolean }) {
  const books = useStore((s) => s.books);
  const hydrated = useStore((s) => s.hydrated);
  const theme = useStore((s) => s.theme);
  const jobs = useStore((s) => s.jobs);
  const jobErrors = useStore((s) => s.jobErrors);
  const S = useStore.getState;

  const [view, setView] = useState<View>('shelf');
  const [topic, setTopic] = useState<TopicKey | null>(null);
  const [only, setOnly] = useState<TopicKey | null>(null);
  const [tag, setTag] = useState<Tag | null>(null);
  const [sort, setSort] = useState<Sort>(() => { try { return (localStorage.getItem('rl:sort') as Sort) || 'topic'; } catch { return 'topic'; } });
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<{ id: string; origin: Origin } | null>(null);
  const [fresh, setFresh] = useState<Set<string>>(() => new Set());
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const known = useRef<Set<string> | null>(null);

  useEffect(() => { try { localStorage.setItem('rl:sort', sort); } catch {} }, [sort]);
  // the reader's code, fetched while you browse, so opening a book never waits for it
  useEffect(() => { const t = setTimeout(() => import('../reader/Reader'), 1500); return () => clearTimeout(t); }, []);

  // Anything that lands on the shelf while you look (an import, a finished download) drops in from above.
  useEffect(() => {
    if (!hydrated) return;
    const ids = new Set(books.map((b) => b.id));
    if (!known.current) { known.current = ids; return; }
    const added = [...ids].filter((id) => !known.current!.has(id));
    known.current = ids;
    if (!added.length) return;
    setFresh((f) => new Set([...f, ...added]));
    for (const id of added) setTimeout(() => setFresh((f) => { const n = new Set(f); n.delete(id); return n; }), 2600);
  }, [hydrated, books]);

  const all = useMemo(() => books.map(shelfBook), [books]);
  const sorted = useMemo(() => sortBooks(all, sort), [all, sort]);
  const match = useCallback((b: ShelfBook) => {
    const words = q.toLowerCase().trim().split(/\s+/).filter(Boolean);
    const t = tag ? TAGS.find((x) => x.key === tag)! : null;
    return (!t || t.test(b)) && words.every((w) => `${b.title} ${b.author} ${TOPIC[b.topic].name} ${b.year ?? ''}`.toLowerCase().includes(w));
  }, [q, tag]);
  const shown = useMemo(() => new Set(sorted.filter((b) => (!only || b.topic === only) && match(b)).map((b) => b.id)), [sorted, only, match]);
  const topics = useMemo(() => TOPICS.map((t) => ({ topic: t, books: all.filter((b) => b.topic === t.key).sort((a, b) => b.added - a.added) })).filter((x) => x.books.length), [all]);
  const stats = useMemo(() => ({
    count: all.length,
    topics: topics.filter((t) => t.topic.key !== 'unsorted').length,
    reading: all.filter((b) => b.pct > 0 && b.pct < 1).length,
    read: all.filter((b) => b.pct >= 1).length,
    wish: all.filter((b) => b.wish).length,
  }), [all, topics]);

  /** The book you were last in, for the "continue" card and the colour of the room. */
  const current = useMemo(() => [...books].filter((b) => b.openedAt && b.file && (b.progress?.pct ?? 0) < 1).sort((a, b) => (b.openedAt ?? 0) - (a.openedAt ?? 0))[0], [books]);
  const aura = current ? coverUrl(current) : undefined;
  useEffect(() => {
    const T = current ? TOPIC[shelfBook(current).topic] : null;
    G.setAmbient?.(T ? T.shades[0] : '#c8beb4');
  }, [current]);

  const go = useCallback((to: { view: View; topic?: TopicKey | null }) => {
    startTransition(() => { setView(to.view); setTopic(to.topic ?? null); setQ(''); if (to.view === 'shelf') setTag(null); });
    scrollTo({ top: 0, behavior: 'instant' as ScrollBehavior });
  }, []);

  // "/" searches the shelf, ⌘F / F finds new books, R pulls one at random, Esc steps out of a topic.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (leaving || open || S().finding || (e.target as HTMLElement).closest?.('input, textarea, select, [contenteditable]')) return;
      if (e.key === '/') { e.preventDefault(); searchRef.current?.focus(); }
      else if ((e.key === 'f' && (e.metaKey || e.ctrlKey)) || (e.key === 'f' && !e.metaKey && !e.ctrlKey && !e.altKey)) { e.preventDefault(); S().openFind(); }
      else if (e.key === 'r' && !e.metaKey && !e.ctrlKey) pickOne();
      else if (e.key === 'Escape' && topic) go({ view: 'topics' });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  });

  /** Ready's "draw one", for a library: a book you have and haven't finished, taken down at random. */
  const pickOne = () => {
    const pool = sorted.filter((b) => shown.has(b.id) && b.pct < 1);
    const b = pool[Math.floor(Math.random() * pool.length)];
    if (!b) return;
    if (view !== 'shelf' || topic) { go({ view: 'shelf' }); setTimeout(() => pickOne(), 900); return; }
    const el = document.querySelector<HTMLElement>(`[data-book="${b.id}"] .spine`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    setTimeout(() => setOpen({ id: b.id, origin: { el, kind: 'spine' } }), 420);
  };

  const openRec = open ? books.find((b) => b.id === open.id) : null;
  const openBook = openRec ? shelfBook(openRec) : null;
  const T = topic ? TOPIC[topic] : null;
  const topicBooks = useMemo(() => (topic ? all.filter((b) => b.topic === topic).sort((a, b) => b.added - a.added).filter(match) : []), [topic, all, match]);
  const jobFor = (id: string) => Object.values(jobs).find((j) => j.attach === id && j.state === 'running') ?? null;
  const running = Object.values(jobs).filter((j) => j.state === 'running');

  return (
    <div className={`library ${leaving ? 'is-leaving' : ''}`}>
      <div className="stage" aria-hidden>
        <div className="aura">{aura && <img src={aura} alt="" className="on" />}</div>
        <div className="dots" />
        <div className="vignette" />
      </div>

      <header className="top">
        <div className="lg cap" data-refract="28" data-mat="clear">
          <button type="button" className="brand" onClick={() => go({ view: 'shelf' })}><Logo /><Wordmark /></button>
          <span className="vsep" />
          <LSeg value={topic ? 'topics' : view} onChange={(v) => go({ view: v })} options={[{ v: 'shelf', l: <><Icon name="books" size={15} />书架</> }, { v: 'topics', l: <><Icon name="layout-grid" size={15} />分类</> }]} />
        </div>
        <div className="grow" />
        <label className="lg cap qbox" data-refract="28" data-mat="clear">
          <Icon name="search" size={16} />
          <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder={T ? `在「${T.name}」里找` : '在书架上找…'} aria-label="在书架上找" />
          {q ? <button type="button" className="icon-btn" style={{ width: 26, height: 26 }} onClick={() => setQ('')} aria-label="清除"><Icon name="x" size={14} /></button> : <kbd>/</kbd>}
        </label>
        <div className="lg cap" data-refract="28" data-mat="clear">
          <button type="button" className="icon-btn tip" data-tip="导入文件" onClick={() => fileRef.current?.click()}><Icon name="upload" size={17} /></button>
          <button type="button" className="icon-btn tip" data-tip="明暗" onClick={() => S().setTheme(theme === 'dark' ? 'light' : 'dark')}><Icon name={theme === 'dark' ? 'sun' : 'moon'} size={17} /></button>
        </div>
        <input ref={fileRef} type="file" hidden multiple accept=".epub,.txt,.pdf,.mobi,.azw3,.md" onChange={(e) => { const fs = [...(e.target.files ?? [])]; if (fs.length) S().importFiles(fs); e.target.value = ''; }} />
      </header>

      <main className="lib-main">
        {!T && (
          <section className="lib-hero">
            <div className="lib-hero-l">
              <p className="caption">
                <i className={`ledg ${hydrated ? '' : 'off'}`} />
                <span>Nº {String(stats.count).padStart(3, '0')}</span><i className="dot" />
                <span>{stats.topics} 个分类</span><i className="dot" />
                <span>{stats.reading} 本在读</span>
                {stats.read > 0 && <><i className="dot" /><span>{stats.read} 本读完</span></>}
                {stats.wish > 0 && <><i className="dot" /><span>{stats.wish} 本待取回</span></>}
              </p>
              <h1 className="lib-title">我的<em>藏书</em></h1>
            </div>
            {current && (
              <button type="button" className="lg continue" data-refract="22" onClick={() => S().go({ name: 'read', id: current.id })}
                onPointerEnter={() => { import('../reader/Reader'); import('../reader/preload').then((m) => m.readAhead(current)); }}>
                <span className="continue-cover">{coverUrl(current) ? <img src={coverUrl(current)} alt="" /> : <i style={{ background: TOPIC[shelfBook(current).topic].shades[0] }} />}</span>
                <span className="continue-txt">
                  <span className="lbl">接着读</span>
                  <b>{current.title}</b>
                  <span className="continue-bar"><i style={{ width: `${Math.round((current.progress?.pct ?? 0) * 100)}%` }} /></span>
                  <span className="mono continue-pct">{Math.round((current.progress?.pct ?? 0) * 100)}%</span>
                </span>
              </button>
            )}
          </section>
        )}

        {view === 'shelf' && !T && all.length > 0 && (
          <div className="lib-chips no-scrollbar" role="group" aria-label="筛选">
            <button type="button" className="chip" aria-pressed={!only && !tag} onClick={() => { setOnly(null); setTag(null); }}>全部 <span className="n">{all.length}</span></button>
            {topics.map(({ topic: t, books: bs }) => (
              <button key={t.key} type="button" className="chip" aria-pressed={only === t.key} onClick={() => setOnly(only === t.key ? null : t.key)}>
                <i className="sw" style={{ background: t.shades[0] }} />{t.name} <span className="n">{bs.length}</span>
              </button>
            ))}
            <span className="chip-sep" />
            {TAGS.map((t) => { const n = all.filter(t.test).length; return n ? <button key={t.key} type="button" className="chip" aria-pressed={tag === t.key} onClick={() => setTag(tag === t.key ? null : t.key)}>{t.label} <span className="n">{n}</span></button> : null; })}
          </div>
        )}

        <div className="lib-screen" key={topic ? `t-${topic}` : view}>
          {T ? (
            <TopicPage topic={T} books={topicBooks} onBack={() => go({ view: 'topics' })} onOpen={(b, el) => setOpen({ id: b.id, origin: { el, kind: 'cover' } })} />
          ) : view === 'shelf' ? (
            <>
              {hydrated && all.length > 0 && (
                <Shelf books={sorted} shown={shown} sort={sort} openId={open?.id ?? null} fresh={fresh}
                  onOpen={(b, el) => setOpen({ id: b.id, origin: { el, kind: 'spine' } })}
                  onLabel={sort === 'topic' ? (k) => go({ view: 'topics', topic: k as TopicKey }) : undefined} />
              )}
              {hydrated && all.length > 0 && shown.size === 0 && <p className="empty-note">书架上没有{q ? `和「${q}」相关的书` : '符合条件的书'}。<button type="button" className="btn sm" onClick={() => S().openFind(q)}>去找找这本</button></p>}
              {hydrated && all.length === 0 && <Starter onFind={() => S().openFind()} onImport={() => fileRef.current?.click()} />}
              {hydrated && all.length > 0 && <p className="lib-hint mono">点书脊把书取下来 · ← → 沿着书架走 · R 随手抽一本 · F 找新书</p>}
            </>
          ) : (
            <TopicGrid topics={topics} onPick={(t: Topic) => go({ view: 'topics', topic: t.key })} />
          )}
        </div>
      </main>

      <div className="dock" id="dock">
        {view === 'shelf' && !T && all.length > 1 && (
          <div className="lg cap" data-refract="26" data-mat="clear">
            <LSeg value={sort} onChange={setSort} options={SORTS.map((s) => ({ v: s.key, l: s.label }))} />
          </div>
        )}
        <button type="button" className="lg ink draw" data-refract="30" onClick={() => S().openFind()}>
          <i className="led" />找书<span className="kbd">F</span>
        </button>
        {all.length > 1 && (
          <div className="lg cap" data-refract="26" data-mat="clear">
            <button type="button" className="remix tip up" data-tip="随手抽一本 · R" onClick={pickOne}><Icon name="dice-5" size={16} />抽一本</button>
          </div>
        )}
      </div>

      {running.length > 0 && (
        <div className="lg jobs" data-refract="22">
          {running.map((j) => <JobLine key={j.id} job={j} title={j.title} compact />)}
        </div>
      )}

      {open && openBook && openRec && (
        <BookOpen
          key={open.id}
          book={openBook}
          rec={openRec}
          origin={open.origin}
          job={jobFor(open.id)}
          lastError={jobErrors[open.id]}
          onFetch={() => S().fetchTreasure({ id: openRec.id })}
          onRead={() => S().go({ name: 'read', id: openRec.id }, { handoff: true })}
          onTopic={(t) => S().patch(openRec.id, { topic: t })}
          onFavorite={() => S().patch(openRec.id, { favorite: !openRec.favorite })}
          onRename={(title) => S().patch(openRec.id, { title })}
          onRemove={() => {
            const id = openRec.id, title = openRec.title;
            setOpen(null);
            S().remove(id);
            S().toast({ text: `《${title}》已从书架拿下${openRec.file ? '，文件也一并删除了' : ''}` });
          }}
          onAttach={(f) => S().importFiles([f], openRec.id)}
          onFindZlib={() => { setOpen(null); S().openFind(`${openRec.title}${openRec.author ? ' ' + openRec.author.split(/[/,，]/)[0] : ''}`); }}
          onReveal={(o) => api.reveal(openRec.id, o).catch((e: Error) => S().toast({ text: e.message, kind: 'bad' }))}
          onClose={() => { const id = open.id; setOpen(null); requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-book="${id}"]`)?.focus({ preventScroll: true })); }}
        />
      )}
    </div>
  );
}

function Starter({ onFind, onImport }: { onFind: () => void; onImport: () => void }) {
  return (
    <section className="starter">
      <div className="starter-fan" aria-hidden>
        {['#a8432f', '#3c3f8f', '#2f6b4f', '#a8801f', '#5e4b7a'].map((c, i) => <span key={c} style={{ background: c, ['--k' as string]: i - 2 }} />)}
      </div>
      <h2>书架还是空的</h2>
      <p>从两万多本书的索引里找一本，或者把手边的 EPUB、TXT、PDF 拖进这个窗口。</p>
      <div className="starter-row">
        <button type="button" className="lg ink draw sm" onClick={onFind}><i className="led" />找书</button>
        <button type="button" className="btn" onClick={onImport}><Icon name="upload" size={15} />导入文件</button>
      </div>
      <p className="caption starter-src"><span>电子书宝库</span><i className="dot" /><span>Z-Library（zlib 命令行）</span><i className="dot" /><span>本地文件</span></p>
    </section>
  );
}
