// The paper book: leaves, the turn, and every way to make one (click a half, drag a corner, hover to lift it,
// keys, jumps). Adapted from paper-flipbook by Johnny Wang (github.com/JohnnyWang8802/paper-flipbook), MIT
// License — see licenses/paper-flipbook-LICENSE.txt. Changes for Ready Library: an instance per reader instead
// of a page global; pages are built lazily (a book can have a thousand of them) and only the leaves near the
// open spread are laid out; the stage size comes from its element; state changes are reported to React.
/* eslint-disable */
import { createGLT, GL_PARAMS } from './glturn.js';

const PW = 594, PH = 846;
const el = (tag, cls) => { const e = document.createElement(tag); if (cls) e.className = cls; return e; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const ease = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

/**
 * @param {{ stage: HTMLElement, book: HTMLElement, count: number, page: (i: number) => HTMLElement, blank: () => HTMLElement,
 *           look: { css: string, root: string, paper: number[] }, onChange: (s: object) => void, startPage?: number, single?: boolean }} o
 */
export function createFlipbook(o) {
  const { stage, book } = o;
  const GLT = createGLT({ ...GL_PARAMS, ...(o.params || {}) });
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const S = { spread: true, pw: PW, k: 1, cur: 0, leaves: [], busy: false, queue: 0, count: o.count, forceSingle: !!o.single };
  let disposed = false;

  function nLeaves() { return S.leaves.length; }
  function pageOfState() { return S.spread ? (S.cur === 0 ? 1 : 2 * S.cur) : S.cur + 1; }
  function stateOfPage(p) { return S.spread ? Math.floor(p / 2) : p - 1; }

  /** A leaf whose faces are filled only when it comes near the open spread. */
  function makeLeaf(i, frontIdx, backIdx) {
    const lf = el('div', 'leaf');
    const f = el('div', 'face front'), b = el('div', 'face back');
    lf.append(f, b);
    // every leaf builds its own page elements (cheap: one page of HTML), so nothing is ever shared between
    // the leaves of an old layout and a new one while a raster job is still holding on to them
    const fill = () => {
      if (!f.firstChild) f.appendChild(frontIdx != null ? o.page(frontIdx) : o.blank());
      if (!b.firstChild) b.appendChild(backIdx != null ? o.page(backIdx) : o.blank());
    };
    Object.defineProperty(lf, '_front', { get() { fill(); return f.firstChild; } });
    Object.defineProperty(lf, '_back', { get() { fill(); return b.firstChild; } });
    lf._fill = fill;
    lf._empty = () => { f.textContent = ''; b.textContent = ''; };
    return lf;
  }

  const FIT = 0.92;
  function layout(keepPage) {
    const W = stage.clientWidth, H = stage.clientHeight;
    const spread = !S.forceSingle && W >= 820 && W > H * 0.95;
    const ratio = PW / PH;
    let pw = spread ? Math.min((W - 72) / 2, (H - 24) * ratio) * FIT : Math.min(W - 20, (H - 16) * ratio);
    pw = Math.max(160, Math.floor(pw));
    S.spread = spread; S.pw = pw; S.k = pw / PW;
    const ph = Math.round(pw / ratio);
    book.style.setProperty('--pw', pw + 'px');
    book.style.setProperty('--ph', ph + 'px');
    book.style.setProperty('--k', S.k);
    book.classList.toggle('single', !spread);
    GLT.endHover(true);
    for (const lf of S.leaves) lf._empty();
    book.innerHTML = '<div class="block l"></div><div class="block r"></div><div class="cast"></div>';
    S.leaves = [];
    const N = S.count;
    if (spread) {
      for (let i = 0; i < Math.ceil(N / 2); i++) {
        const lf = makeLeaf(i, 2 * i, 2 * i + 1 < N ? 2 * i + 1 : null); lf.style.left = pw + 'px';
        book.appendChild(lf); S.leaves.push(lf);
      }
    } else {
      for (let i = 0; i < N; i++) {
        const lf = makeLeaf(i, i, null); lf.style.left = '0px';
        book.appendChild(lf); S.leaves.push(lf);
      }
    }
    S.cur = Math.max(0, Math.min(nLeaves(), stateOfPage(keepPage || 1)));
    if (!spread && S.cur >= nLeaves()) S.cur = nLeaves() - 1;
    GLT.resize();
    settle(true);
  }
  function glPrefetch() { if (GLT.ok) { const c = S.cur; GLT.prefetch(S.spread ? [c, c - 1, c + 1, c - 2, c + 2, c - 3] : [c, c - 1, c + 1, c + 2]); } }
  function settle(instant) {
    const n = nLeaves();
    S.leaves.forEach((lf, i) => {
      const flipped = i < S.cur;
      // far leaves are not laid out at all (display:none); near ones are filled and shown
      const near = S.spread ? (i >= S.cur - 3 && i <= S.cur + 2) : (i >= S.cur - 1 && i <= S.cur + 2);
      const keep = S.spread ? (i >= S.cur - 6 && i <= S.cur + 6) : (i >= S.cur - 4 && i <= S.cur + 5);
      if (keep) lf._fill(); else lf._empty();
      lf.style.display = keep ? '' : 'none';
      lf.style.transform = `rotateY(${flipped ? -180 : 0}deg)`;
      lf.children[0].style.visibility = flipped ? 'hidden' : '';
      lf.children[1].style.visibility = flipped ? '' : 'hidden';
      // stacked within each pile counting from its top (the open pages), so the numbers stay small however long the
      // book: the GL canvas (z 1500), the CSS turner (1000) and the cast shadow (900) always lie above the pages.
      // (Counting over the whole book put a 1500-leaf book's pages above the canvas, and the turning page behind them.)
      lf.style.zIndex = Math.max(1, 500 - (flipped ? S.cur - 1 - i : i - S.cur));
      const shown = S.spread ? (i >= S.cur - 2 && i <= S.cur + 1) : (i >= S.cur && i <= S.cur + 1);
      lf.style.visibility = shown && near ? 'visible' : 'hidden';
    });
    let tx = 0;
    if (S.spread) { if (S.cur === 0) tx = -S.pw / 2; else if (S.cur === n) tx = S.pw / 2; }
    if (instant) { book.style.transition = 'none'; book.style.transform = `translateX(${tx}px)`; book.offsetWidth; book.style.transition = ''; }
    else book.style.transform = `translateX(${tx}px)`;
    const bl = book.querySelector('.block.l'), br = book.querySelector('.block.r');
    if (S.spread) {
      const left = S.cur, right = n - S.cur;
      bl.style.display = left ? '' : 'none'; br.style.display = right ? '' : 'none';
      bl.style.width = (S.pw + Math.min(6, left * 0.25)) + 'px'; br.style.width = (S.pw + Math.min(6, right * 0.25)) + 'px';
    } else { bl.style.display = 'none'; br.style.width = S.pw + 'px'; }
    report();
    glPrefetch();
    if (GLT.ok) GLT.idle();
  }

  /* turner: the turning leaf, cut into hinged strips so it can curl (no WebGL, or the page picture isn't ready) */
  const K = 12;
  function buildTurner(lf) {
    const sw = S.pw / K;
    const root = el('div', 'turner');
    root.style.left = (S.spread ? S.pw : 0) + 'px'; root.style.zIndex = 1000;
    let parent = root; const strips = [];
    for (let k = 0; k < K; k++) {
      const st = k === 0 ? root : el('div', 'strip');
      st.style.width = sw + 'px';
      if (k > 0) { st.style.left = sw + 'px'; parent.appendChild(st); }
      const ff = el('div', 'sface front'); ff.style.width = (sw + 0.75) + 'px';
      const fc = el('div', 'clip'); fc.style.left = (-k * sw) + 'px'; fc.appendChild(lf._front.cloneNode(true)); ff.appendChild(fc);
      const fsh = el('div', 'shade'); ff.appendChild(fsh);
      const bf = el('div', 'sface back'); bf.style.width = (sw + 0.75) + 'px'; bf.style.left = '-0.75px';
      const bc = el('div', 'clip'); bc.style.left = (-(S.pw - (k + 1) * sw)) + 'px'; bc.appendChild(lf._back.cloneNode(true)); bf.appendChild(bc);
      const bsh = el('div', 'shade'); bf.appendChild(bsh);
      st.append(ff, bf);
      strips.push({ el: st, fsh, bsh, ff, bf });
      parent = st;
    }
    book.appendChild(root);
    return { root, strips };
  }
  function poseTurner(T, theta, dir) {
    if (T.gl) { GLT.pose(T, theta); return; }
    const bend = 30 * Math.sin(Math.PI * theta / 180);
    let prev = 0; const ang = [];
    for (let k = 0; k < K; k++) { const t = k / (K - 1); ang.push(clamp(theta + dir * bend * t * t, 0, 180)); }
    ang.forEach((a, k) => {
      const rel = a - prev; prev = a;
      T.strips[k].el.style.transform = `rotateY(${-rel}deg)`;
      T.strips[k].ff.style.visibility = a < 90 ? '' : 'hidden';
      T.strips[k].bf.style.visibility = a < 90 ? 'hidden' : '';
    });
    const shadeF = a => 0.30 * (1 - Math.cos(a * Math.PI / 180)) / 2;
    const shadeB = a => 0.24 * (1 + Math.cos(a * Math.PI / 180)) / 2;
    ang.forEach((a, k) => {
      const a0 = (ang[k - 1] ?? a + (a - (ang[k + 1] ?? a))), a1 = ang[k + 1] ?? a;
      const s0 = (a0 + a) / 2, s1 = (a + a1) / 2;
      const spec = Math.max(0, Math.sin((a1 - a0) * Math.PI / 90)) * 0.10;
      T.strips[k].fsh.style.background = `linear-gradient(90deg, rgba(20,18,12,${shadeF(s0).toFixed(3)}), rgba(20,18,12,${shadeF(s1).toFixed(3)})), linear-gradient(90deg, transparent 40%, rgba(255,255,255,${spec.toFixed(3)}))`;
      T.strips[k].bsh.style.background = `linear-gradient(270deg, rgba(20,18,12,${shadeB(s0).toFixed(3)}), rgba(20,18,12,${shadeB(s1).toFixed(3)}))`;
    });
    const cast = book.querySelector('.cast');
    const edge = ang.reduce((acc, a) => acc + (S.pw / K) * Math.cos(a * Math.PI / 180), 0);
    const spine = S.spread ? S.pw : 0;
    const strength = (0.28 * Math.sin(theta * Math.PI / 180)).toFixed(3);
    cast.style.display = 'block';
    if (edge >= 0) {
      cast.style.left = (spine + edge) + 'px'; cast.style.width = Math.max(0, S.pw - edge) + 'px';
      cast.style.background = `linear-gradient(90deg, rgba(20,18,12,${strength}), rgba(20,18,12,0) ${Math.min(90, S.pw * 0.18)}px)`;
    } else if (S.spread) {
      cast.style.left = '0px'; cast.style.width = Math.max(0, S.pw + edge) + 'px';
      cast.style.background = `linear-gradient(270deg, rgba(20,18,12,${strength}), rgba(20,18,12,0) ${Math.min(90, S.pw * 0.18)}px)`;
    } else cast.style.display = 'none';
    if (!S.spread) T.root.style.opacity = theta > 100 ? Math.max(0, 1 - (theta - 100) / 70) : 1;
  }

  function beginTurn(dir, vg) {
    if (dir > 0 && S.cur >= (S.spread ? nLeaves() : nLeaves() - 1)) return null;
    if (dir < 0 && S.cur <= 0) return null;
    const idx = dir > 0 ? S.cur : S.cur - 1;
    const lf = S.leaves[idx];
    const under = dir > 0 ? S.leaves[idx + 1] : S.leaves[idx - 1];
    if (under) { under._fill(); under.style.display = ''; under.style.visibility = 'visible'; }
    lf._fill(); lf.style.display = '';
    if (!S.spread && dir < 0) lf.style.visibility = 'hidden';
    let T = reduced ? null : GLT.begin(lf, idx, dir, vg);
    if (!T) { GLT.suspend(true, 'css'); T = buildTurner(lf); T.css = true; }
    lf.style.visibility = 'hidden';
    T.lf = lf; T.idx = idx; T.dir = dir;
    if (S.spread) {
      const n = nLeaves(), nc = S.cur + dir;
      book.style.transform = `translateX(${nc === 0 ? -S.pw / 2 : nc === n ? S.pw / 2 : 0}px)`;
    }
    return T;
  }
  function animateTurn(T, from, to, ms) {
    return new Promise(res => {
      const t0 = performance.now();
      const step = now => {
        const t = clamp((now - t0) / ms, 0, 1);
        poseTurner(T, from + (to - from) * ease(t), T.dir);
        if (t < 1) requestAnimationFrame(step); else res();
      };
      requestAnimationFrame(step);
    });
  }
  function endTurn(T, completed) {
    if (T.gl) GLT.end(T); else { T.root.remove(); book.querySelector('.cast').style.display = 'none'; }
    T.lf.style.visibility = 'visible';
    if (completed) S.cur += T.dir;
    if (T.css) GLT.suspend(false, 'css');
    settle(false);
  }
  async function turn(dir, ms = 760, vg) {
    if (S.busy || disposed) return false;
    const T = beginTurn(dir, vg); if (!T) return false;
    S.busy = true; o.onBusy?.(true);
    const from = dir > 0 ? 0 : 180, to = dir > 0 ? 180 : 0;
    if (T.gl) await GLT.playClick(T, ms / 760 * GLT.P.tScale); else await animateTurn(T, from, to, reduced ? 1 : ms);
    endTurn(T, true);
    S.busy = false; o.onBusy?.(false);
    return true;
  }
  async function gotoPage(p) {
    p = clamp(p, 1, S.count);
    const target = clamp(stateOfPage(p), 0, S.spread ? nLeaves() : nLeaves() - 1);
    if (target === S.cur || S.busy) return;
    const dir = target > S.cur ? 1 : -1;
    if (Math.abs(target - S.cur) > 4) { S.cur = target - dir * 4; settle(true); }
    while (S.cur !== target) { if (!(await turn(dir, 300))) break; }
  }

  /* ---------- input ---------- */
  async function step(dir, vg) {
    if (S.busy) { S.queue = Math.sign(S.queue) === -dir ? 0 : Math.max(-2, Math.min(2, S.queue + dir)); return; }
    await turn(dir, 760, vg);
    while (S.queue && !S.busy) { const d = Math.sign(S.queue); S.queue -= d; if (!(await turn(d, 520))) { S.queue = 0; break; } }
  }
  const next = vg => step(1, vg), prev = vg => step(-1, vg);
  function onKey(e) {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.target.closest && e.target.closest('input, textarea, select, [contenteditable], button, .rd-panel')) return;
    if (['ArrowRight', 'PageDown'].includes(e.key) || (e.key === ' ' && !e.shiftKey)) { e.preventDefault(); next(); }
    else if (['ArrowLeft', 'PageUp'].includes(e.key) || (e.key === ' ' && e.shiftKey)) { e.preventDefault(); prev(); }
    else if (e.key === 'Home') { e.preventDefault(); gotoPage(1); }
    else if (e.key === 'End') { e.preventDefault(); gotoPage(S.count); }
  }
  let drag = null, sel = null;
  /** A click in the book: on a highlight it opens it; otherwise the half it lands on turns. */
  function click(e, target, vg) {
    if (o.clickGuard?.()) return;
    const g = target.closest && target.closest('[data-goto]');
    if (g) { gotoPage(+g.dataset.goto); return; }
    const m = o.onMark && target.closest && target.closest('mark.hl');
    if (m) { o.onMark(m.dataset.hl, m, e); return; }
    const r = book.getBoundingClientRect();
    if (S.spread) (e.clientX >= r.left + S.pw ? next : prev)(vg);
    else (e.clientX - r.left < S.pw * 0.33 ? prev : next)(vg);
  }
  function down(e) {
    if (S.busy || e.button > 0) return;
    if (e.target.closest && e.target.closest('.rd-ui')) return;
    const r = book.getBoundingClientRect();
    // the text column selects (a click there still turns the page); everywhere else, and a lifted corner, grabs the paper
    if (o.selectable && e.pointerType === 'mouse' && !GLT.hovering && e.target.closest && e.target.closest('.pg-flow') && !e.target.closest('[data-goto]')) {
      sel = { x0: e.clientX, y0: e.clientY, t0: performance.now(), target: e.target, moved: false, vg: clamp((e.clientY - r.top) / r.height, 0, 1) };
      return;
    }
    const spineX = r.left + (S.spread ? S.pw : 0);
    drag = { x0: e.clientX, y0: e.clientY, t0: performance.now(), spineX, T: null, theta: 0, hist: [[performance.now(), e.clientX]],
      side: S.spread ? (e.clientX >= spineX ? 1 : -1) : 0, target: e.target, vg: clamp((e.clientY - r.top) / r.height, 0, 1),
      inBook: e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom, id: e.pointerId };
  }
  function move(e) {
    if (sel) {
      // a selection is being drawn: show the DOM pages (where the selection is) instead of the GL picture of them
      if (!sel.moved && Math.hypot(e.clientX - sel.x0, e.clientY - sel.y0) > 4) { sel.moved = true; GLT.suspend(true, 'select'); }
      return;
    }
    if (!drag) {
      const r = book.getBoundingClientRect(); const spineX = r.left + (S.spread ? S.pw : 0);
      const inside = e.clientX > r.left && e.clientX < r.right && e.clientY > r.top && e.clientY < r.bottom;
      if (e.pointerType === 'mouse' && !S.busy && GLT.ok && !reduced) hoverPeel(e, r);
      const t = e.target.closest ? e.target : null;
      stage.style.cursor = t && t.closest('[data-goto]') ? 'pointer'
        : o.selectable && t && !GLT.hovering && t.closest('.pg-flow') ? (t.closest('mark.hl') ? 'pointer' : 'text')
        : inside ? (S.spread ? (e.clientX >= spineX ? 'e-resize' : 'w-resize') : (e.clientX - r.left < S.pw * 0.33 ? 'w-resize' : 'e-resize')) : 'default';
      return;
    }
    const dx = e.clientX - drag.x0;
    drag.hist.push([performance.now(), e.clientX]); if (drag.hist.length > 6) drag.hist.shift();
    if (!drag.T) {
      if (Math.abs(dx) < 8 || !drag.inBook) return;
      const dir = S.spread ? (drag.side > 0 ? 1 : -1) : (dx < 0 ? 1 : -1);
      if ((dir > 0 && dx > 0) || (dir < 0 && dx < 0)) return;
      drag.T = beginTurn(dir, drag.vg); if (!drag.T) { drag = null; return; }
      try { stage.setPointerCapture(drag.id); } catch {}
      S.busy = true; o.onBusy?.(true);
    }
    const d = Math.abs(dx) * (S.spread ? 1 : 2);
    const th = Math.acos(clamp(1 - d / S.pw, -1, 1)) * 180 / Math.PI;
    drag.theta = drag.T.dir > 0 ? th : 180 - th;
    poseTurner(drag.T, drag.theta, drag.T.dir);
  }
  function hoverPeel(e, r) {
    const zone = S.pw * 0.16, y = clamp((e.clientY - r.top) / r.height, 0, 1);
    let dir = 0, d = 1e9;
    const inY = e.clientY > r.top - 10 && e.clientY < r.bottom + 10;
    if (inY && e.clientX <= r.right + 6 && (S.spread ? S.cur < nLeaves() : S.cur < nLeaves() - 1)) { d = r.right - e.clientX; if (d < zone) dir = 1; }
    if (!dir && inY && S.spread && S.cur > 0 && e.clientX >= r.left - 6) { d = e.clientX - r.left; if (d < zone) dir = -1; }
    if (!dir) { if (GLT.hovering) GLT.endHover(false); return; }
    const idx = dir > 0 ? S.cur : S.cur - 1, amt = Math.pow(1 - clamp(d, 0, zone) / zone, 1.4);
    S.leaves[idx]._fill();
    GLT.hover(S.leaves[idx], idx, dir, amt, y);
  }
  async function release(e) {
    if (sel) {
      const s = sel; sel = null;
      const selection = getSelection(), picked = selection && !selection.isCollapsed && selection.toString().trim();
      if (s.moved && picked) { o.onSelect?.(selection, e); return; }
      if (s.moved) { GLT.suspend(false, 'select'); return; }
      if (performance.now() - s.t0 < 600) click(e, s.target, s.vg);
      return;
    }
    if (!drag) return;
    const d = drag; drag = null;
    if (!d.T) {
      if (performance.now() - d.t0 < 600 && Math.abs(e.clientX - d.x0) < 8 && Math.abs(e.clientY - d.y0) < 8) {
        if (!d.inBook && !(d.target.closest && d.target.closest('[data-goto]'))) { o.clickGuard?.(); return; }
        click(e, d.target, d.vg);
      }
      return;
    }
    const now = performance.now(); d.hist.push([now, e.clientX]);
    const h = d.hist.filter(x => now - x[0] < 120), v = h.length > 1 ? (h[h.length - 1][1] - h[0][1]) / Math.max(16, h[h.length - 1][0] - h[0][0]) : 0;
    const progress = d.T.dir > 0 ? d.theta / 180 : 1 - d.theta / 180;
    const flick = d.T.dir > 0 ? v < -0.35 : v > 0.35;
    const complete = progress > (S.spread ? 0.5 : 0.25) || flick;
    const to = complete ? (d.T.dir > 0 ? 180 : 0) : (d.T.dir > 0 ? 0 : 180);
    if (d.T.gl) await GLT.playRelease(d.T, to); else await animateTurn(d.T, d.theta, to, 160 + 420 * Math.abs(to - d.theta) / 180);
    endTurn(d.T, complete);
    S.busy = false; o.onBusy?.(false);
  }
  const leave = () => GLT.endHover(false);

  function report() {
    const N = S.count; let a, b;
    if (S.spread) { a = S.cur === 0 ? 1 : 2 * S.cur; b = S.cur === 0 ? 1 : Math.min(N, 2 * S.cur + 1); if (S.cur === nLeaves()) b = a = N; }
    else a = b = S.cur + 1;
    o.onChange?.({ a, b, count: N, spread: S.spread, cur: S.cur, atStart: S.cur === 0, atEnd: S.spread ? S.cur >= nLeaves() : S.cur >= nLeaves() - 1 });
  }

  /* ---------- boot ---------- */
  GLT.init(book, () => S);
  GLT.setLook(o.look);
  book.style.setProperty('--grain', `url(${GLT.grain().toDataURL()})`);
  stage.addEventListener('pointerdown', down);
  stage.addEventListener('pointermove', move);
  stage.addEventListener('pointerup', release);
  stage.addEventListener('pointercancel', release);
  stage.addEventListener('pointerleave', leave);
  addEventListener('keydown', onKey);
  let rt, size = '';
  const ro = new ResizeObserver(() => {
    const now = stage.clientWidth + 'x' + stage.clientHeight;
    if (now === size) return;
    clearTimeout(rt); rt = setTimeout(() => { if (!S.busy && !disposed) { size = stage.clientWidth + 'x' + stage.clientHeight; layout(pageOfState()); } }, 120);
  });
  ro.observe(stage);
  size = stage.clientWidth + 'x' + stage.clientHeight;
  layout(o.startPage || 1);
  // the open spread's pictures are ready (or there is no GL): the book can be shown without a pop from DOM to GL
  const ready = !GLT.ok ? Promise.resolve() : Promise.race([
    GLT.prefetch(S.spread ? [S.cur - 1, S.cur] : [S.cur]).then(() => new Promise((r) => requestAnimationFrame(() => r()))),
    new Promise((r) => setTimeout(r, 2500)),
  ]);

  return {
    get state() { return S; },
    get gl() { return GLT.ok; },
    get frameMs() { return GLT.frameMs; },
    get glt() { return GLT; },
    next, prev, gotoPage, ready,
    page: () => pageOfState(),
    /** Rebuild some pages (their highlights changed): the DOM at once, the GL pictures of their leaves next. */
    repaint(list) {
      const leaves = new Set();
      for (const i of list) {
        const li = S.spread ? Math.floor(i / 2) : i, lf = S.leaves[li];
        if (!lf) continue;
        const f = lf.children[S.spread ? i % 2 : 0];
        if (f.firstChild) f.replaceChildren(o.page(i));
        leaves.add(li);
      }
      GLT.invalidate([...leaves]); glPrefetch(); GLT.idle();
    },
    /** While a selection or its popover is open, the DOM pages show (the selection lives there). */
    selecting(on) { GLT.suspend(!!on, 'select'); },
    /** Re-show (and re-raster) pages after their content or the paper changed. */
    refresh(look) { if (look) GLT.setLook(look); GLT.invalidate(); layout(pageOfState()); },
    setSingle(on) { S.forceSingle = !!on; layout(pageOfState()); },
    suspendGL(on) { GLT.suspend(on, 'ui'); },
    dispose() {
      disposed = true; ro.disconnect(); clearTimeout(rt);
      stage.removeEventListener('pointerdown', down); stage.removeEventListener('pointermove', move);
      stage.removeEventListener('pointerup', release); stage.removeEventListener('pointercancel', release); stage.removeEventListener('pointerleave', leave);
      removeEventListener('keydown', onKey);
      GLT.dispose(); book.textContent = '';
    },
  };
}
