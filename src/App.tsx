import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useStore } from './lib/store';
import { Library } from './library/Library';
import { FindSheet } from './find/FindSheet';
import G from './ui/glass/glass';

const Reader = lazy(() => import('./reader/Reader'));
const BOOKISH = /\.(epub|txt|pdf|mobi|azw3|md)$/i;

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

  useEffect(() => { useStore.getState().hydrate(); G.auto(); G.refract(); }, []);

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
