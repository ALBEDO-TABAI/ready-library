import { useEffect, useRef, useState } from 'react';
import { getDocument, GlobalWorkerOptions, PasswordResponses } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { EventBus, PDFViewer, PDFLinkService, PDFFindController } from 'pdfjs-dist/web/pdf_viewer.mjs';
import 'pdfjs-dist/web/pdf_viewer.css';
import { api, fileUrl, type BookRec } from '../lib/api';
import { useStore } from '../lib/store';

GlobalWorkerOptions.workerSrc = workerUrl;

export default function PdfReader({ rec }: { rec: BookRec }) {
  const container = useRef<HTMLDivElement>(null), viewer = useRef<HTMLDivElement>(null);
  const pdf = useRef<PDFViewer | null>(null), bus = useRef<EventBus | null>(null);
  const unlock = useRef<((password: string) => void) | null>(null);
  const [page, setPage] = useState(1), [count, setCount] = useState(0);
  const [error, setError] = useState(''), [query, setQuery] = useState('');
  const [password, setPassword] = useState(''), [passwordHint, setPasswordHint] = useState('');

  useEffect(() => {
    let live = true, save: ReturnType<typeof setTimeout> | undefined;
    let lastPage = 0;
    const eventBus = new EventBus();
    const links = new PDFLinkService({ eventBus, externalLinkTarget: 2 });
    const find = new PDFFindController({ eventBus, linkService: links });
    const instance = new PDFViewer({ container: container.current!, viewer: viewer.current!, eventBus, linkService: links, findController: find });
    pdf.current = instance; bus.current = eventBus; links.setViewer(instance);
    const flush = () => {
      clearTimeout(save);
      if (lastPage && instance.pagesCount) useStore.getState().patch(rec.id, { progress: { chapter: 0, offset: lastPage - 1, pct: lastPage / instance.pagesCount, at: Date.now() } });
    };
    eventBus.on('pagesinit', () => {
      instance.currentScaleValue = 'auto';
      instance.currentPageNumber = Math.min(instance.pagesCount, Math.max(1, (rec.progress?.offset ?? 0) + 1));
      setCount(instance.pagesCount); setPage(instance.currentPageNumber);
    });
    eventBus.on('pagechanging', ({ pageNumber }: { pageNumber: number }) => {
      setPage(pageNumber); lastPage = pageNumber; clearTimeout(save); save = setTimeout(flush, 400);
    });
    eventBus.on('pagerendered', ({ error }: { error?: Error }) => { if (error && live) setError(error.message); });
    const task = getDocument({ url: fileUrl(rec), cMapUrl: '/pdfjs/cmaps/', cMapPacked: true, standardFontDataUrl: '/pdfjs/standard_fonts/', wasmUrl: '/pdfjs/wasm/', isEvalSupported: false });
    task.onPassword = (update: (password: string) => void, reason: number) => {
      if (!live) return;
      unlock.current = update;
      setPasswordHint(reason === PasswordResponses.INCORRECT_PASSWORD ? '密码不正确，请重新输入' : '这份 PDF 需要密码');
    };
    task.promise.then((doc) => {
      if (!live) return;
      instance.setDocument(doc); links.setDocument(doc);
      useStore.getState().patch(rec.id, { openedAt: Date.now() });
    }).catch((e) => { if (live) setError(e.message || '无法读取 PDF'); });
    return () => {
      live = false; flush(); pdf.current = null; bus.current = null; unlock.current = null;
      // PDF.js allows null at runtime to cancel rendering and detach its scroll listeners.
      instance.setDocument(null as never); links.setDocument(null as never);
      void task.destroy();
    };
  }, [rec.id]);

  const search = () => bus.current?.dispatch('find', { type: 'again', query, highlightAll: true, findPrevious: false });
  return <div className="rd-pdf">
    <div className="pdf-toolbar">
      <button className="btn sm" disabled={page <= 1 || !count} onClick={() => { if (pdf.current) pdf.current.currentPageNumber = page - 1; }}>上一页</button>
      <span className="mono">{page} / {count || '…'}</span>
      <button className="btn sm" disabled={page >= count} onClick={() => { if (pdf.current) pdf.current.currentPageNumber = page + 1; }}>下一页</button>
      <button className="btn sm" disabled={!count} onClick={() => { if (pdf.current) pdf.current.currentScale = Math.max(0.25, pdf.current.currentScale / 1.2); }} aria-label="缩小 PDF">−</button>
      <button className="btn sm" disabled={!count} onClick={() => { if (pdf.current) pdf.current.currentScale = Math.min(5, pdf.current.currentScale * 1.2); }} aria-label="放大 PDF">+</button>
      <button className="btn sm" disabled={!count} onClick={() => { if (pdf.current) pdf.current.currentScaleValue = 'page-width'; }}>适合宽度</button>
      <input aria-label="在 PDF 中查找" placeholder="查找文字…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') search(); }} />
      <button className="btn sm" disabled={!count || !query} onClick={search}>查找</button>
      <button className="btn sm" onClick={() => api.reveal(rec.id, true).catch((e) => useStore.getState().toast({ text: e.message, kind: 'bad' }))}>用系统阅读器打开</button>
    </div>
    <div className="pdf-area">
      <div ref={container} className="pdf-scroll"><div ref={viewer} className="pdfViewer" /></div>
      {(!count || error || passwordHint) && <div className="pdf-message" role="status">
        {error ? <p>{error}</p> : passwordHint ? <form onSubmit={(e) => { e.preventDefault(); unlock.current?.(password); setPassword(''); setPasswordHint(''); }}>
          <p>{passwordHint}</p><input type="password" aria-label="PDF 密码" autoComplete="off" value={password} onChange={(e) => setPassword(e.target.value)} /><button className="btn sm" type="submit">打开</button>
        </form> : <p>正在打开 PDF…</p>}
      </div>}
    </div>
  </div>;
}
