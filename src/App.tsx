import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore } from './lib/store';
import { Library } from './library/Library';
import { FindSheet } from './find/FindSheet';
import { Splash, type SplashStage, type SplashStat } from './ui/Splash';
import { api, coverUrl } from './lib/api';
import { TOPICS } from './lib/topics';
import { MARKERS } from './reader/marks';
import G from './ui/glass/glass';

const Reader = lazy(() => import('./reader/Reader'));
const BOOKISH = /\.(epub|txt|pdf|mobi|azw3|md)$/i;
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export default function App() {
  const route = useStore((s) => s.route);
  const finding = useStore((s) => s.finding);
  const toasts = useStore((s) => s.toasts);
  const handoff = useStore((s) => s.handoff);
  const [dragging, setDragging] = useState(false);
  // Going to read, the shelf stays a moment, fading, under whatever carries you into the book (the open book grows
  // into the reader's place), and goes once the reader's pages are drawn. Coming back, it is a fresh shelf.
  const [shelf, setShelf] = useState(route.name === 'library');
  const [shelfKey, setShelfKey] = useState(0);
  // the shelf starts to fade only once the reader is mounted underneath it, never onto an empty screen
  const [readerUp, setReaderUp] = useState(false);
  const was = useRef(route.name);
  useEffect(() => {
    if (route.name === 'library') { if (was.current === 'read') setShelfKey((k) => k + 1); setShelf(true); setReaderUp(false); }
    was.current = route.name;
  }, [route.name]);
  const waiting = !!handoff && !(handoff.ready && handoff.placed);
  useEffect(() => {
    if (route.name !== 'read' || !shelf || !readerUp) return;
    if (waiting) {
      // never hold the shelf forever (a huge book still being set): the reader shows its own progress then
      const t = setTimeout(() => { useStore.getState().handoffReady(); useStore.getState().handoffPlaced(); }, 9000);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => setShelf(false), handoff ? 520 : 420);
    return () => clearTimeout(t);
  }, [route.name, shelf, waiting, handoff, readerUp]);

  // The start screen stays up until the shelf, the type and the first covers are ready (and two seconds at least);
  // meanwhile the shelf is built beneath it, its entrance held until the screen lifts.
  const [splash, setSplash] = useState(true);
  const [stage, setStage] = useState<SplashStage>('start');
  const [loaded, setLoaded] = useState(false);
  const [titles, setTitles] = useState<number | 'none' | null>(null);
  const hydrated = useStore((s) => s.hydrated);
  const shelved = useStore((s) => s.books.length);
  useEffect(() => {
    let live = true;
    document.documentElement.dataset.waking = '';
    G.auto(); G.refract();
    (async () => {
      await useStore.getState().hydrate();
      if (!live) return;
      setStage('shelf');
      await Promise.race([document.fonts.ready, wait(1500)]);
      if (!live) return;
      setStage('type');
      const covers = useStore.getState().books.map((b) => coverUrl(b)).filter((u): u is string => !!u).slice(0, 30);
      await Promise.race([Promise.all(covers.map((u) => { const im = new Image(); im.src = u; return im.decode().catch(() => {}); })), wait(2500)]);
      if (!live) return;
      setStage('covers');
      setLoaded(true);
    })();
    // the index is read from its disk cache (never downloaded here), so its size is known and search is warm
    api.sources(false, true).then((s) => { if (live) setTitles(s.treasure.count || 'none'); }).catch(() => { if (live) setTitles('none'); });
    return () => { live = false; };
  }, []);
  const statsOn = hydrated && titles !== null;
  const on = (n: number) => (statsOn ? n : null);
  const stats: SplashStat[] = [
    titles === 'none' ? [on(2), '个书源', 'Sources'] : [on(titles ?? 0), '本宝库书目', 'Titles indexed'],
    [on(TOPICS.filter((t) => t.key !== 'unsorted').length), '个分类', 'Topics'],
    [on(MARKERS.length), '支划线笔', 'Highlighters'],
    [on(shelved), '本在你的书架上', 'On your shelf'],
  ];

  // Drop books anywhere. Dropped on an open "待取回" book, the file is attached to it (handled there); here it is a new book.
  useEffect(() => {
    let depth = 0;
    const has = (e: DragEvent) => [...(e.dataTransfer?.types ?? [])].includes('Files');
    const enter = (e: DragEvent) => { if (!has(e)) return; e.preventDefault(); depth++; setDragging(true); };
    const leave = (e: DragEvent) => { if (!has(e)) return; depth = Math.max(0, depth - 1); if (!depth) setDragging(false); };
    const over = (e: DragEvent) => { if (has(e)) e.preventDefault(); };
    const drop = (e: DragEvent) => {
      if (!has(e)) return;
      e.preventDefault(); depth = 0; setDragging(false);
      const files = [...(e.dataTransfer?.files ?? [])].filter((f) => BOOKISH.test(f.name));
      if (!files.length) return useStore.getState().toast({ text: '只认 EPUB、TXT、PDF、MOBI、AZW3 文件', kind: 'bad' });
      const wish = files.length === 1 ? document.querySelector<HTMLElement>('.ob-stage')?.dataset.wish : undefined;
      useStore.getState().importFiles(files, wish || undefined);
    };
    addEventListener('dragenter', enter); addEventListener('dragleave', leave); addEventListener('dragover', over); addEventListener('drop', drop);
    return () => { removeEventListener('dragenter', enter); removeEventListener('dragleave', leave); removeEventListener('dragover', over); removeEventListener('drop', drop); };
  }, []);

  return (
    <>
      {route.name === 'read' && <Suspense fallback={<div className="stage"><div className="dots" /></div>}><Reader key={route.id} id={route.id} onUp={() => setReaderUp(true)} /></Suspense>}
      {(route.name === 'library' || shelf) && <Library key={shelfKey} leaving={route.name === 'read' && readerUp} />}
      {finding && <FindSheet />}
      {dragging && <div className="dropzone"><div><b>放上书架</b><p>EPUB · TXT · PDF · MOBI · AZW3</p></div></div>}
      {splash && (
        <Splash stage={stage} ready={loaded} stats={stats} statsOn={statsOn}
          onLeave={() => { delete document.documentElement.dataset.waking; useStore.setState({ awake: true }); }}
          onDone={() => setSplash(false)} />
      )}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`lg strong toast ${t.kind ?? ''}`}>
            <i className="led" /><span>{t.text}</span>
            {t.action && <button type="button" className="btn sm solid" onClick={() => { t.action!.run(); useStore.getState().dismiss(t.id); }}>{t.action.label}</button>}
            <button type="button" className="icon-btn" style={{ width: 28, height: 28 }} onClick={() => useStore.getState().dismiss(t.id)} aria-label="关闭">×</button>
          </div>
        ))}
      </div>
    </>
  );
}
