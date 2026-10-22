import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import G from './glass/glass';

/** Ready's liquid segmented control: the thumb stretches toward the target, then the tail catches up. */
export function LSeg<T extends string>({ value, options, onChange, className = '', id }: {
  value: T; options: { v: T; l: ReactNode; title?: string }[]; onChange: (v: T) => void; className?: string; id?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const first = useRef(true);
  useLayoutEffect(() => {
    const seg = ref.current; if (!seg) return;
    if (first.current) {
      first.current = false;
      const h = requestAnimationFrame(() => setTimeout(() => G.place(seg, seg.querySelector(':scope > button.on'), false), 0));
      return () => cancelAnimationFrame(h);
    }
    G.place(seg, seg.querySelector(':scope > button.on'), true);
  }, [value, options.length]);
  useEffect(() => {
    const seg = ref.current; if (!seg) return;
    const re = () => G.place(seg, seg.querySelector(':scope > button.on'), false);
    const ro = new ResizeObserver(re); ro.observe(seg);
    document.fonts?.ready.then(re);
    return () => ro.disconnect();
  }, []);
  return (
    <div ref={ref} className={'seg ' + className} id={id} role="radiogroup">
      <span className="seg-thumb" />
      {options.map((o) => (
        <button key={o.v} type="button" role="radio" aria-checked={o.v === value} title={o.title} className={o.v === value ? 'on' : ''} onClick={() => o.v !== value && onChange(o.v)}>{o.l}</button>
      ))}
    </div>
  );
}
