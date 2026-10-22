import { useEffect, useRef, useState } from 'react';
import type { Job } from '../lib/api';
import { useStore } from '../lib/store';
import { Icon } from '../ui/Icon';

const kb = (n: number) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const eta = (s: number) => (s < 60 ? `${Math.max(1, Math.round(s))} 秒` : s < 3600 ? `${Math.round(s / 60)} 分钟` : `${(s / 3600).toFixed(1)} 小时`);

/** What a job is doing, in a few words: 排队中 · 等 3 秒 · 34% · 31 KB/s · 还要 4 分钟 */
export function jobText(j: Job, short = false): string {
  switch (j.stage) {
    case 'queued': return short ? '排队中' : '排队中 · 网盘一次只能下一本';
    case 'resolving': return '连接网盘…';
    case 'waiting': return `网盘要求等 ${j.wait ?? ''} 秒`;
    case 'captcha': return '需要你输入验证码';
    case 'unpacking': return '解压、上架…';
    case 'downloading': {
      const left = j.speed && j.total && j.bytes != null ? (j.total - j.bytes) / j.speed : 0;
      return [`${j.pct}%`, !short && j.speed ? `${kb(j.speed)}/s` : '', left > 3 ? `还要 ${eta(left)}` : ''].filter(Boolean).join(' · ');
    }
    default: return j.src === 'zlib' ? `${j.pct}%` : j.line;
  }
}

/** The site asked for a captcha: its picture, a box for what it says, another picture if it is unreadable. */
export function Captcha({ job, autoFocus = true }: { job: Job; autoFocus?: boolean }) {
  const [v, setV] = useState('');
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { setV(''); setBusy(false); if (autoFocus) ref.current?.focus({ preventScroll: true }); }, [job.captcha, autoFocus]);
  const S = useStore.getState;
  const send = async () => { if (!v.trim() || busy) return; setBusy(true); await S().answerCaptcha(job.id, v.trim()); };
  return (
    <div className="cap-box" onClick={(e) => e.stopPropagation()}>
      <button type="button" className="cap-img tip up" data-tip="看不清？换一张" onClick={() => S().newCaptcha(job.id)}>
        {job.captcha ? <img src={job.captcha} alt="验证码" /> : <span className="spinner" />}
      </button>
      <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} onKeyDown={(e) => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); send(); } }}
        maxLength={8} placeholder="图中的字符" aria-label="验证码" spellCheck={false} autoComplete="off" />
      <button type="button" className="btn sm solid" disabled={!v.trim() || busy} onClick={send}>{busy ? <span className="spinner" /> : '确定'}</button>
    </div>
  );
}

/** One running download: the bar, what it is doing, and a way to stop it. */
export function JobLine({ job, title, compact = false }: { job: Job; title?: string; compact?: boolean }) {
  const S = useStore.getState;
  const indeterminate = job.stage !== 'downloading' && job.src === 'treasure';
  return (
    <div className={`jl ${compact ? 'compact' : ''}`} data-stage={job.stage}>
      <div className="jl-row">
        {title && <span className="jl-t">{title}</span>}
        <span className="jl-bar" data-busy={indeterminate || undefined}><i style={{ width: `${indeterminate ? 30 : Math.max(2, job.pct)}%` }} /></span>
        <span className="mono jl-s">{jobText(job, compact)}</span>
        <button type="button" className="icon-btn jl-x tip up" data-tip="停止取回" onClick={(e) => { e.stopPropagation(); S().cancelJob(job.id); }} aria-label="停止取回"><Icon name="x" size={13} /></button>
      </div>
      {job.stage === 'captcha' && <Captcha job={job} autoFocus={!compact} />}
    </div>
  );
}
