import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, proxied, type TreasureHit, type TreasureStatus, type ZlibHit, type ZlibStatus } from '../lib/api';
import { useStore } from '../lib/store';
import { TOPIC, topicFor } from '../lib/topics';
import { Icon } from '../ui/Icon';
import { LSeg } from '../ui/controls';
import { JobLine } from './JobView';

type Src = 'all' | 'treasure' | 'zlib';
type Lane<T> = { q: string; items: T[]; page: number; pages: number; total?: number; loading: boolean; error: string };
const empty = <T,>(): Lane<T> => ({ q: '', items: [], page: 1, pages: 1, loading: false, error: '' });

/**
 * Finding a book: one query, two places. The treasure chest's index is local, so it answers as you type;
 * Z-Library goes through your zlib CLI over the network, so it answers when you press Enter.
 */
export function FindSheet() {
  const close = useStore((s) => s.closeFind);
  const initial = useStore((s) => s.findQuery);
  const books = useStore((s) => s.books);
  const jobs = useStore((s) => s.jobs);
  const S = useStore.getState;
  const [q, setQ] = useState(initial);
  const [src, setSrc] = useState<Src>(() => { try { return (localStorage.getItem('rl:src') as Src) || 'all'; } catch { return 'all'; } });
  const [ext, setExt] = useState<'epub' | '' | 'pdf'>('epub');
  const [cat, setCat] = useState('');
  const [status, setStatus] = useState<{ treasure: TreasureStatus; zlib: ZlibStatus } | null>(null);
  const [cats, setCats] = useState<{ name: string; count: number }[]>([]);
  const [tc, setTc] = useState<Lane<TreasureHit>>(empty);
  const [zl, setZl] = useState<Lane<ZlibHit>>(empty);
  const [feed, setFeed] = useState<ZlibHit[]>([]);
  const [adding, setAdding] = useState<Set<string>>(new Set());
  const inputRef = useRef<HTMLInputElement>(null);
  const tSeq = useRef(0), zSeq = useRef(0);

  useEffect(() => { try { localStorage.setItem('rl:src', src); } catch {} }, [src]);
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
    document.body.classList.add('lock-scroll');
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); close(); } };
    addEventListener('keydown', onKey);
    return () => { removeEventListener('keydown', onKey); document.body.classList.remove('lock-scroll'); };
  }, [close]);

  const refreshStatus = useCallback(async (force = false) => {
    try { const s = await api.sources(force); setStatus(s); return s; } catch { return null; }
  }, []);
  useEffect(() => {
    refreshStatus().then((s) => {
      if (s?.zlib.loggedIn) api.zlibFeed('popular').then((r) => setFeed(r.books.slice(0, 12))).catch(() => {});
    });
    api.categories().then((r) => setCats(r.categories)).catch(() => {}).finally(() => refreshStatus());
  }, [refreshStatus]);

  const runTreasure = useCallback(async (query: string, c: string, page = 1) => {
    const seq = ++tSeq.current;
    setTc((l) => ({ ...l, loading: true, error: '' }));
    try {
      const r = await api.treasure(query, c, page);
      if (seq !== tSeq.current) return;
      setTc((l) => ({ q: query, items: page > 1 ? [...l.items, ...r.books] : r.books, page: r.page, pages: r.pages, total: r.total, loading: false, error: '' }));
      if (!status?.treasure.ready) refreshStatus();
    } catch (e) {
      if (seq === tSeq.current) setTc((l) => ({ ...l, loading: false, error: (e as Error).message }));
    }
  }, [refreshStatus, status?.treasure.ready]);

  const runZlib = useCallback(async (query: string, page = 1) => {
    if (!query.trim()) return;
    const seq = ++zSeq.current;
    setZl((l) => ({ ...l, q: query, loading: true, error: '', ...(page === 1 ? { items: [] } : {}) }));
    try {
      const r = await api.zlib(query, page, ext);
      if (seq !== zSeq.current) return;
      setZl((l) => ({ q: query, items: page > 1 ? [...l.items, ...r.books] : r.books, page: r.page, pages: r.pages, loading: false, error: '' }));
    } catch (e) {
      if (seq !== zSeq.current) return;
      setZl((l) => ({ ...l, loading: false, error: (e as Error).message }));
      if ((e as { status?: number }).status === 401) refreshStatus(true);
    }
  }, [ext, refreshStatus]);

  // the local index answers as you type
  useEffect(() => {
    if (src === 'zlib') return;
    if (!q.trim() && !cat) { setTc(empty()); return; }
    const t = setTimeout(() => runTreasure(q.trim(), cat), 140);
    return () => clearTimeout(t);
  }, [q, cat, src, runTreasure]);
  // Z-Library: on open with a query (from "find this on Z-Library"), and whenever the format changes
  useEffect(() => { if (q.trim() && src !== 'treasure' && status?.zlib.loggedIn) runZlib(q.trim()); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [ext, status?.zlib.loggedIn]);

  const submit = () => { if (src !== 'treasure') runZlib(q.trim()); if (src !== 'zlib') runTreasure(q.trim(), cat); };

  const onShelf = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of books) { if (b.sourceUrl) m.set(b.sourceUrl, b.id); if (b.sourceRef) m.set(b.sourceRef, b.id); }
    return m;
  }, [books]);

  const fetchTreasure = async (h: TreasureHit) => {
    setAdding((s) => new Set(s).add(h.id));
    try { await S().fetchTreasure({ hit: h }); }
    finally { setAdding((s) => { const n = new Set(s); n.delete(h.id); return n; }); }
  };
  const downloadZlib = (h: ZlibHit) => {
    S().download(h.ref, h.title, {
      title: h.title, author: h.author, year: h.year, publisher: h.publisher, language: h.language, description: h.description, cover: h.cover,
      topic: topicFor({ categories: h.categories, title: h.title }), tags: h.categories ? h.categories.split(/[,\\/]/).map((s) => s.trim()).filter(Boolean).slice(0, 4) : [],
    }, onShelf.get(h.ref));
  };
  const busyRef = (ref: string) => Object.values(jobs).find((j) => j.ref === ref && j.state === 'running');
  const busyLink = (link: string) => Object.values(jobs).find((j) => j.link === link && j.state === 'running');

  const tStat = status?.treasure, zStat = status?.zlib;
  const showT = src !== 'zlib', showZ = src !== 'treasure';

  return (
    <>
      <div className="scrim" onClick={close} />
      <section className="lg strong find" data-refract="30" role="dialog" aria-modal aria-label="找书">
        <header className="find-q">
          <Icon name="search" size={20} />
          <input ref={inputRef} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }}
            placeholder="书名、作者、ISBN，或者一个分类…" aria-label="找书" spellCheck={false} />
          {q && <button type="button" className="icon-btn" onClick={() => { setQ(''); inputRef.current?.focus(); }} aria-label="清除"><Icon name="x" size={16} /></button>}
          <button type="button" className="btn solid find-go" onClick={submit}>搜索 <kbd>↵</kbd></button>
          <button type="button" className="icon-btn" onClick={close} aria-label="关闭"><Icon name="x" size={18} /></button>
        </header>
        <div className="find-bar">
          <LSeg value={src} onChange={setSrc} className="boxed sm" options={[
            { v: 'all', l: '全部来源' },
            { v: 'treasure', l: <><i className={`src-led ${tStat?.ready || tStat?.cached ? 'on' : tStat?.error ? 'bad' : ''}`} />电子书宝库</> },
            { v: 'zlib', l: <><i className={`src-led ${zStat?.loggedIn ? 'on' : zStat?.installed ? 'warn' : 'bad'}`} />Z-Library</> },
          ]} />
          {showZ && <LSeg value={ext} onChange={setExt} className="boxed sm" options={[{ v: 'epub', l: 'EPUB' }, { v: '', l: '任意格式' }, { v: 'pdf', l: 'PDF' }]} />}
          <span className="grow" />
          <p className="caption">
            {tStat && <><span>宝库 <b>{tStat.count ? tStat.count.toLocaleString() : tStat.cached ? '已缓存' : '未下载'}</b></span><i className="dot" /></>}
            {zStat && <span>zlib <b>{zStat.loggedIn ? '已登录' : zStat.installed ? '未登录' : '未安装'}</b>{zStat.quota ? ` · 今日剩 ${zStat.quota.remaining}` : ''}</span>}
          </p>
        </div>

        <div className={`find-body ${showT && showZ ? 'two' : ''}`}>
          {showT && (
            <div className="lane">
              <div className="lane-h">
                <h3>电子书宝库</h3>
                <span className="caption">{tc.total != null && (tc.q || cat) ? <><b>{tc.total}</b> 本{cat && <> · 分类「{cat}」</>}</> : 'jbiaojerry/ebook-treasure-chest · EPUB / MOBI / AZW3'}</span>
                {cat && <button type="button" className="btn ghost sm" onClick={() => setCat('')}>清除分类</button>}
              </div>
              {!tc.q && !cat && (
                <div className="cats">
                  {tStat && !tStat.ready && !tStat.cached && !cats.length && <p className="lane-note">{tStat.error ? `索引下载失败：${tStat.error}` : '第一次使用会下载约 7 MB 的书目索引，之后都在本地搜索。'}</p>}
                  {cats.slice(0, 40).map((c) => (
                    <button key={c.name} type="button" className="chip" onClick={() => setCat(c.name)}>{c.name}<span className="n">{c.count}</span></button>
                  ))}
                </div>
              )}
              {tc.error && <p className="lane-note bad">{tc.error} <button type="button" className="btn sm" onClick={() => api.refreshTreasure().then(() => runTreasure(q.trim(), cat)).catch((e) => setTc((l) => ({ ...l, error: e.message })))}>重试</button></p>}
              <ul className="t-list">
                {tc.items.map((h, i) => {
                  const shelf = onShelf.get(h.link);
                  const have = shelf && books.find((b) => b.id === shelf)?.file;
                  const job = busyLink(h.link);
                  const topic = TOPIC[topicFor({ cats: h.cats, title: h.title })];
                  return (
                    <li key={h.id} className={`t-row ${job ? 'has-job' : ''}`} style={{ ['--i' as string]: Math.min(i, 20), ['--c' as string]: topic.shades[0] }}>
                      <i className="t-spine" aria-hidden />
                      <div className="t-main">
                        <b className="t-title">{h.title}</b>
                        <span className="t-meta">{h.author || '佚名'}<i className="dot" />{h.cats.slice(0, 3).join(' · ')}<i className="dot" /><span className="mono">{h.formats.join('/').toUpperCase()}</span></span>
                        {job && <JobLine job={job} compact />}
                      </div>
                      <div className="t-act">
                        {have ? <span className="tag acc">已在书架</span>
                          : job ? null
                          : <button type="button" className="btn sm solid tip up" data-tip="后台下载、解压，挑出 EPUB 放上书架" disabled={adding.has(h.id)} onClick={() => fetchTreasure(h)}>{adding.has(h.id) ? <span className="spinner" /> : <Icon name="download" size={14} />}取回</button>}
                        <a className="icon-btn tip up" data-tip="打开网盘下载页" href={h.link} target="_blank" rel="noreferrer"><Icon name="external-link" size={15} /></a>
                        <button type="button" className="icon-btn tip up" data-tip="在 Z-Library 找这本" onClick={() => { const qq = `${h.title} ${h.author.split(/[/·・]/)[0]}`.trim(); setQ(qq); setSrc(src === 'treasure' ? 'all' : src); runZlib(qq); }}><Icon name="search" size={15} /></button>
                      </div>
                    </li>
                  );
                })}
              </ul>
              {tc.loading && <div className="lane-loading"><span className="spinner" />{tStat?.ready || tStat?.cached ? '搜索中…' : '正在下载书目索引…'}</div>}
              {!tc.loading && (tc.q || cat) && !tc.items.length && !tc.error && <p className="lane-note">宝库里没有这本。试试 Z-Library，或者换个关键词。</p>}
              {tc.page < tc.pages && !tc.loading && <button type="button" className="btn ghost wide-more" onClick={() => runTreasure(tc.q, cat, tc.page + 1)}>再看 {Math.min(30, (tc.total ?? 0) - tc.items.length)} 本</button>}
            </div>
          )}

          {showZ && (
            <div className="lane">
              <div className="lane-h">
                <h3>Z-Library</h3>
                <span className="caption">{zStat?.loggedIn ? (zl.q ? <>“{zl.q}”{zl.items.length ? <> · 第 {zl.page}/{zl.pages} 页</> : null}</> : '按回车搜索 · 通过本机的 zlib 命令行') : 'heartleo/zlib · 需要本机安装并登录'}</span>
              </div>
              {zStat && !zStat.loggedIn && <ZlibSetup st={zStat} onRecheck={() => refreshStatus(true)} />}
              {zStat?.loggedIn && (
                <>
                  {zl.error && <p className="lane-note bad">{zl.error}</p>}
                  {!zl.q && !zl.loading && feed.length > 0 && <p className="lbl lane-sub">这周热门</p>}
                  <ul className="z-grid">
                    {(zl.q ? zl.items : feed).map((h, i) => {
                      const shelf = onShelf.get(h.ref);
                      const job = busyRef(h.ref);
                      const have = shelf && books.find((b) => b.id === shelf)?.file;
                      return (
                        <li key={h.id + i} className="z-card" style={{ ['--i' as string]: Math.min(i, 20) }}>
                          <div className="z-cover">
                            {h.cover ? <img src={proxied(h.cover)} alt="" loading="lazy" onError={(e) => ((e.target as HTMLImageElement).style.display = 'none')} /> : null}
                            <span className="z-ext mono">{h.ext.toUpperCase() || '—'}</span>
                          </div>
                          <div className="z-main">
                            <b className="z-title" title={h.title}>{h.title}</b>
                            <span className="z-meta">{h.author || '佚名'}</span>
                            <span className="caption">{h.year && <span>{h.year}</span>}{h.size && <><i className="dot" /><span>{h.size}</span></>}{h.language && <><i className="dot" /><span>{h.language}</span></>}</span>
                            <div className="z-act">
                              {have ? <span className="tag acc">已在书架</span>
                                : job ? <span className="z-prog"><span className="job-bar"><i style={{ width: `${job.pct}%` }} /></span><span className="mono">{job.pct}%</span></span>
                                : <button type="button" className="btn sm solid" onClick={() => downloadZlib(h)}><Icon name="download" size={14} />下载上架</button>}
                            </div>
                          </div>
                        </li>
                      );
                    })}
                  </ul>
                  {zl.loading && <div className="lane-loading"><span className="spinner" />正在问 Z-Library…</div>}
                  {!zl.loading && zl.q && !zl.items.length && !zl.error && <p className="lane-note">没有找到{ext ? ` ${ext.toUpperCase()} 格式的` : ''}结果。{ext && <button type="button" className="btn sm" onClick={() => setExt('')}>不限格式</button>}</p>}
                  {!zl.q && !zl.loading && !feed.length && <p className="lane-note">输入书名后按回车。结果带封面、年份和文件大小，下载完会自动放上书架。</p>}
                  {zl.q && zl.page < zl.pages && !zl.loading && <button type="button" className="btn ghost wide-more" onClick={() => runZlib(zl.q, zl.page + 1)}>下一页</button>}
                </>
              )}
            </div>
          )}
        </div>
        <footer className="find-foot caption">
          <span>宝库的书在城通网盘上：点「取回」会在后台下载、解压，挑出 EPUB 放上书架。网盘给访客限速，一本书通常要几分钟。</span>
          <span className="grow" />
          <span>请只下载你有权阅读的书</span>
        </footer>
      </section>
    </>
  );
}

function ZlibSetup({ st, onRecheck }: { st: ZlibStatus; onRecheck: () => Promise<unknown> }) {
  const [busy, setBusy] = useState(false);
  const steps = st.installed
    ? [['找一个能连上的镜像', 'zlib doctor'], ['用你的账号登录（密码只在终端里输入）', 'zlib login --domain https://<上一步的域名>']]
    : [['安装 zlib 命令行（macOS / Linux）', 'brew install heartleo/tap/zlib'], ['找一个能连上的镜像', 'zlib doctor'], ['登录你的 Z-Library 账号', 'zlib login --domain https://<上一步的域名>']];
  return (
    <div className="setup">
      <p className="setup-why"><i className={`src-led ${st.installed ? 'warn' : 'bad'}`} />{st.error || '还没有连上 Z-Library。'}</p>
      <ol>
        {steps.map(([what, cmd], i) => (
          <li key={i}><span className="setup-n mono">{String(i + 1).padStart(2, '0')}</span><div><p>{what}</p><code onClick={() => navigator.clipboard?.writeText(cmd)} title="点一下复制">{cmd}</code></div></li>
        ))}
      </ol>
      <div className="setup-row">
        <button type="button" className="btn" disabled={busy} onClick={async () => { setBusy(true); await onRecheck(); setBusy(false); }}>{busy ? <span className="spinner" /> : <Icon name="refresh-cw" size={14} />}重新检测</button>
        <a className="btn ghost" href="https://github.com/heartleo/zlib/blob/main/README.zh.md" target="_blank" rel="noreferrer">zlib 说明 <Icon name="arrow-up-right" size={13} /></a>
      </div>
      <p className="setup-note">Ready Library 只调用你本机的 zlib 命令（search / download 的 JSON 模式），不保存账号和密码。</p>
    </div>
  );
}
