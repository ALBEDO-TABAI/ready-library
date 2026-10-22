// Start screen, in the same form as Ready Poster Printer's: the name, what it is in a line, a few true numbers and
// the repo, with the loading bar as the rule between them.
import { useEffect, useRef, useState } from 'react';
import { APP_AUTHOR, APP_REPO, APP_VERSION } from '../lib/config';

export type SplashStage = 'start' | 'shelf' | 'type' | 'covers';
export type SplashStat = [number | null, string, string];

/** The bar fills over FILL_MS but never runs ahead of loading: each stage caps it. */
const STAGE: Record<SplashStage, number> = { start: 0.15, shelf: 0.45, type: 0.7, covers: 0.9 };
const FILL_MS = 2000, HOLD_MS = 250, FADE_MS = 380;
const ease = (t: number) => (t >= 1 ? 1 : 0.5 - Math.cos(Math.PI * Math.max(0, t)) / 2);

/** A number that arrives while the splash is up counts up to itself instead of popping in. */
function Count({ n }: { n: number | null }) {
  const [v, setV] = useState(n ?? 0);
  const from = useRef(n ?? 0);
  useEffect(() => {
    if (n == null) return;
    const a = from.current, t0 = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / 900), e = 1 - Math.pow(1 - k, 3);
      setV(Math.round(a + (n - a) * e));
      if (k < 1) raf = requestAnimationFrame(tick); else from.current = n;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [n]);
  return <>{n == null ? '—' : v}</>;
}

/**
 * `stats` are shown (and count up) once `statsOn`: they are this library's own numbers, read while it loads.
 * `stage` is how far loading has got and `ready` says it is done: the bar fills to the end, holds, and the splash
 * fades (`onLeave` as it starts to, `onDone` when it has gone).
 */
export function Splash({ stage, ready, stats, statsOn, onLeave, onDone }: { stage: SplashStage; ready: boolean; stats: SplashStat[]; statsOn: boolean; onLeave?: () => void; onDone?: () => void }) {
  const bar = useRef<HTMLElement>(null);
  const live = useRef({ stage, ready, onLeave, onDone });
  live.current = { stage, ready, onLeave, onDone };
  const [out, setOut] = useState(false);
  useEffect(() => {
    let raf = 0, p = 0, full = 0, timer = 0;
    const t0 = performance.now();
    let last = t0;
    const tick = (now: number) => {
      const { stage: s, ready: r } = live.current;
      const goal = Math.min(r ? 1 : STAGE[s], ease((now - t0) / FILL_MS));
      p += (goal - p) * Math.min(1, (now - last) / 90);
      last = now;
      if (goal === 1 && p > 0.997) p = 1;
      if (bar.current) bar.current.style.transform = `scaleX(${p})`;
      if (p === 1 && !full) full = now;
      if (full && now - full >= HOLD_MS) {
        setOut(true);
        live.current.onLeave?.();
        timer = window.setTimeout(() => live.current.onDone?.(), FADE_MS);
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); clearTimeout(timer); };
  }, []);
  return (
    <div className={'splash' + (out ? ' out' : '')} role="status" aria-label="Ready Library">
      <div className="sp-art">
        <p className="sp-kicker">Personal ebook library · Paper-turning reader · v{APP_VERSION}</p>
        <h1>Ready <i>Library</i></h1>
        <p className="sp-zh">随手一搜，就是一本像纸一样翻页的书。</p>
        <p className="sp-en">One search, and you’ve got a book that turns like paper.</p>
        <div className="load-bar"><i ref={bar} /></div>
        <ul className={'sp-stats' + (statsOn ? ' on' : '')}>
          {stats.map(([n, zh, en]) => <li key={en}><b><Count n={n} /></b><span>{zh}</span><small>{en}</small></li>)}
        </ul>
        <p className="sp-repo">github.com/{APP_REPO}</p>
        <p className="sp-credit">Created by {APP_AUTHOR}</p>
      </div>
    </div>
  );
}
