// WebGL2 3D book renderer (hand-written, no libraries).
// Adapted from paper-flipbook by Johnny Wang (github.com/JohnnyWang8802/paper-flipbook), MIT License —
// see licenses/paper-flipbook-LICENSE.txt. Changes for Ready Library: a factory instead of a page global,
// the paper colour and the page stylesheet are set from outside (setLook), blob: images are inlined
// into page rasters, pages can be invalidated, and the WebGL context is released on dispose.
/* eslint-disable */
export function createGLT(P) {
  /* A true 3D book in hand-written WebGL2 (no libraries).
     Every rendered sheet is a 64×88 grid deformed on the GPU: a resting spine hump + low-frequency wrinkle shared by
     each stack, and a turning model in which the sheet rotates about the spine while the part beyond a fold line
     wraps around a cylinder. The fold line tilts with the grab height (±45°), corners sag with gravity, and every turn
     is jittered a little. Stacks have real thickness: every leaf is its own sheet (full-res near the top, low-res edge rings below). A 2048² directional
     shadow map (PCSS-style blocker search + Poisson PCF) lets sheets shadow each other and the desk. */
  let pageCSS = '', rootStyle = '', paper = [0.937, 0.94, 0.94];
  const rad = d => d * Math.PI / 180, cl = (x, a, b) => Math.max(a, Math.min(b, x));
  const sstep = t => { t = cl(t, 0, 1); return t * t * (3 - 2 * t); };
  const gl2 = true; let gl = null, cv = null, ok = false, maxAniso = 0, extAniso = null;
  let deepVAO, deepN = 0, smHi = null, smLo = null, smCur = null, frameNo = 0, progS, progD, gridVAO, gridN = 0, blockVAO = null, blockN = 0, blockBuf = null, groundVAO, shTex, shFB, sampCmp, sampRaw, blankTex, grainTex;
  let cw = 0, ch = 0, mx = 0, my = 0, dpr = 1, bookEl, getS, SM = 2048;
  const GU = P.GU, GV = P.GV;
  const cache = new Map(), pending = new Map();
  let hoverT = null, active = null, suspended = false; const sus = new Set();
  let frameMs = [], blockKey = "", shadowKey = "", lastSheets = null;
  /* ---------- procedural paper fibre (our own: periodic value-noise fbm + wrapped fibre strokes) ----------
     The map is a MULTIPLY map: 1 = untouched paper, darker = fibre speck. The same canvas is used by the
     shader and, as a CSS multiply overlay, by the flat DOM pages, so GL and DOM paper match. */
  function makeGrain(N = 256){
    let seed = 1979; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const H = new Float32Array(N * N);
    const lattice = p => { const a = new Float32Array(p * p); for (let i = 0; i < p * p; i++) a[i] = rnd(); return a; };
    [[8, .5], [16, .26], [32, .14], [64, .1]].forEach(([p, amp]) => {
      const L = lattice(p), s = N / p;
      for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
        const fx = x / s, fy = y / s, ix = Math.floor(fx), iy = Math.floor(fy), tx = sstep(fx - ix), ty = sstep(fy - iy);
        const g = (i, j) => L[((j % p + p) % p) * p + ((i % p + p) % p)];
        H[y * N + x] += amp * ((g(ix, iy) * (1 - tx) + g(ix + 1, iy) * tx) * (1 - ty) + (g(ix, iy + 1) * (1 - tx) + g(ix + 1, iy + 1) * tx) * ty);
      }
    });
    for (let f = 0; f < 520; f++){                       // fibres: short, slightly curved, mostly along the grain direction
      let x = rnd() * N, y = rnd() * N, a = (rnd() - 0.5) * 1.2 + (rnd() < 0.3 ? Math.PI / 2 : 0); const len = 3 + rnd() * 12, w = 0.08 + rnd() * 0.14;
      for (let s = 0; s < len; s += 0.5){ a += (rnd() - 0.5) * 0.15; x += Math.cos(a) * 0.5; y += Math.sin(a) * 0.5;
        const xi = ((Math.round(x) % N) + N) % N, yi = ((Math.round(y) % N) + N) % N; H[yi * N + xi] += w; }
    }
    const can = document.createElement("canvas"); can.width = can.height = N; const g = can.getContext("2d"), im = g.createImageData(N, N);
    let lo = 1e9, hi = -1e9; for (let i = 0; i < N * N; i++){ H[i] += (rnd() - 0.5) * 0.06; lo = Math.min(lo, H[i]); hi = Math.max(hi, H[i]); }
    for (let i = 0; i < N * N; i++){
      const v = 0.62 + 0.36 * (H[i] - lo) / (hi - lo);       // 0.62…0.98, sparse bright peaks
      const pat = Math.min(1, 2 * Math.pow(v, 7)), m = 1 - P.grainK * pat;
      const b = Math.round(255 * m); im.data[4 * i] = im.data[4 * i + 1] = im.data[4 * i + 2] = b; im.data[4 * i + 3] = 255;
    }
    g.putImageData(im, 0, 0); return can;
  }
  let grainCanvas = null;
  function grain(){ return grainCanvas || (grainCanvas = makeGrain()); }
  /* ---------- shaders ---------- */
  const COMMON = `
    uniform float uW, uH, uSpineX; uniform vec2 uOff;
    uniform vec4 uA;   // theta (spine rotation), bend (rad), fold angle, fold start (px)
    uniform vec4 uB;   // dir, rest hump (px), wrinkle (px), wrinkle blend R→L
    uniform vec4 uC;   // base z, floor z right, floor z left, gravity sag
    uniform vec4 uD;   // peel (px), peel row centre v, follow lift (rad), mode (0 sheet, 1 mesh)
    float hsh(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
    float vnoise(vec2 p){ vec2 i = floor(p), f = fract(p), u = f * f * (3.0 - 2.0 * f);
      return mix(mix(hsh(i), hsh(i + vec2(1, 0)), u.x), mix(hsh(i + vec2(0, 1)), hsh(i + vec2(1, 1)), u.x), u.y); }
    float wrk(vec2 uv, float s){ vec2 q = uv * vec2(2.6, 3.4) + vec2(s * 7.31, s * 3.17); return (vnoise(q) * 0.65 + vnoise(q * 2.1 + 5.0) * 0.35) - 0.5; }
    float restProf(float u){
      if (u < 0.12) return sin(u / 0.12 * 1.5707963);
      if (u < 0.55) return 1.0 - 0.18 * smoothstep(0.0, 1.0, (u - 0.12) / 0.43);
      if (u < 0.78) return 0.82 + 0.12 * smoothstep(0.0, 1.0, (u - 0.55) / 0.23);
      return 0.94 - 0.26 * (1.0 - cos((u - 0.78) / 0.22 * 1.5707963));
    }
    vec3 sheetPos(vec2 uv){
      float x = uv.x * uW, y = (0.5 - uv.y) * uH, th = uA.x, dir = uB.x;
      float ct = cos(th), st = sin(th);
      // resting shape (offset along the sheet normal; "up" for a page lying on either side)
      float w = mix(wrk(uv, 1.0), wrk(uv, 2.0), uB.w) * 2.0 * smoothstep(0.0, 0.35, uv.x);
      float pk = max(0.0, 1.0 - 1.6 * abs(uv.y - uD.y));
      float h = (uB.y * restProf(uv.x) + uB.z * w + uD.x * uv.x * uv.x * pk) * ct;
      // fold line rotated by uA.z; beyond it the sheet wraps a cylinder (curling back against the turn)
      float ca = cos(uA.z), sa = sin(uA.z);
      float p = x * ca + y * sa, q = -x * sa + y * ca;
      float beyond = max(0.0, p - uA.w), len = max(uW - uA.w, 1.0);
      float yy = y / (0.5 * uH);
      float ang = beyond / len * uA.y * (1.0 + uC.w * yy * yy) + uD.z * uv.x;
      float sc = abs(ang) < 1e-4 ? 1.0 : sin(ang) / ang, vs = abs(ang) < 1e-4 ? 0.0 : (1.0 - cos(ang)) / ang;
      float p2 = p - beyond + beyond * sc, z2 = -dir * beyond * vs;
      p2 += h * dir * sin(ang) * step(0.0, beyond); z2 += h * cos(ang);
      float x2 = p2 * ca - q * sa, y2 = p2 * sa + q * ca;
      float X = x2 * ct - z2 * st, Z = x2 * st + z2 * ct;
      // the turning leaf may not sink into the page it lies over: the floor follows that page's resting hump and wrinkle
      // (a flat floor let the hump of the page below poke through the leaf near the spine as a column of white teeth)
      float uu = clamp(abs(X) / uW, 0.0, 1.0);
      float fl = (X >= 0.0 ? uC.y : uC.z) + uB.y * restProf(uu) + uB.z * smoothstep(0.0, 0.35, uu) + 0.6;
      float za = Z + uC.x, kk = 0.012 * uW, hk = max(kk - abs(za - fl), 0.0) / kk;
      Z = max(za, fl) + hk * hk * kk * 0.25;                  // smooth max: no crease, so finite-difference normals stay continuous
      // per-sheet jitter grows from 0 at the hinge, so every sheet stays bound to the spine (a flat shift opened a see-through crack there)
      return vec3(uSpineX + X + uOff.x * ct * uv.x, y2 + uOff.y * uv.x, Z);
    }`;
  const VS = `#version 300 es
    precision highp float;
    in vec2 aUV; in vec3 aP; in vec3 aN;
    uniform mat4 uVP, uLVP; uniform float uNOff; uniform vec3 uLdir; ${COMMON}
    out vec2 vUV; out vec3 vN; out vec3 vP; out vec4 vL;
    void main(){
      vec3 p, n;
      if (uD.w < 0.5){
        p = sheetPos(aUV);
        vec3 px = sheetPos(aUV + vec2(0.012, 0.0)), py = sheetPos(aUV + vec2(0.0, 0.009));
        n = normalize(cross(py - p, px - p));
      } else { p = aP; n = aN; }
      vUV = aUV; vN = n; vP = p;
      // normal-offset shadow lookup: step the receiver ~1.5 shadow texels off its surface (towards the light) so steep, near-coplanar
      // paper (the spine hump, a leaf landing) does not self-shadow into speckle/acne
      vL = uLVP * vec4(p + n * sign(dot(n, uLdir) + 1e-4) * uNOff, 1.0);
      gl_Position = uVP * vec4(p, 1.0);
    }`;
  const FS_DEPTH = `#version 300 es
    precision mediump float; out vec4 o; void main(){ o = vec4(1.0); }`;
  const FS = `#version 300 es
    precision highp float; precision highp sampler2DShadow;
    in vec2 vUV; in vec3 vN; in vec3 vP; in vec4 vL; out vec4 o;
    uniform sampler2D uTex, uOther, uGrain, uRaw; uniform sampler2DShadow uShadow;
    uniform vec3 uL, uEye, uGround, uEdge, uPaper; uniform vec4 uLight; uniform vec2 uGrainScale, uRect;
    uniform int uTapsB, uTapsP; uniform float uBias; uniform float uWrap, uAlpha, uShow, uSpecFlat, uFlat, uGrainK, uGutter, uMode, uShStr, uSMs, uLDepth, uStripe;
    const vec2 PD[12] = vec2[](vec2(-0.326,-0.406), vec2(-0.840,-0.074), vec2(-0.696,0.457), vec2(-0.203,0.621), vec2(0.962,-0.195), vec2(0.473,-0.480),
                               vec2(0.519,0.767), vec2(0.185,-0.893), vec2(0.507,0.064), vec2(0.896,0.412), vec2(-0.322,-0.933), vec2(-0.792,-0.598));
    float shadowVis(){
      vec3 s = vL.xyz / vL.w * 0.5 + 0.5;
      if (s.x < 0.0 || s.x > 1.0 || s.y < 0.0 || s.y > 1.0) return 1.0;
      float bias = uBias / uLDepth, d = s.z - bias, tx = 1.0 / 2048.0;
      // blocker search → penumbra grows with the gap between occluder and receiver
      float sum = 0.0, cnt = 0.0;
      for (int i = 0; i < 8; i++){ if (i >= uTapsB) break; float b = texture(uRaw, s.xy + PD[i] * tx * 22.0).r; if (b < d){ sum += b; cnt += 1.0; } }
      if (cnt < 0.5) return 1.0;
      float gap = (d - sum / cnt) * uLDepth;                   // px
      float r = clamp(gap * 0.32, 2.5, 26.0) * tx;           // ≥2.5 texels: no stair-stepped hard edges
      float v = 0.0; for (int i = 0; i < 12; i++){ if (i >= uTapsP) break; v += texture(uShadow, vec3(s.xy + PD[i] * r, d)); }
      return v / float(uTapsP);
    }
    void main(){
      if (uMode > 2.5){                                        // deep stack sheet: only its edge shows; plain paper, edge line, no shadow lookups
        float ed = min((1.0 - vUV.x) * uEdge.x * 2.0 * 594.0 / 846.0, min(vUV.y, 1.0 - vUV.y) * uEdge.x * 2.0);
        vec3 nn = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
        float sh = (uLight.x * mix(uGround.g, 1.0, nn.z * 0.5 + 0.5) + uLight.y * max((dot(nn, uL) + uWrap) / (1.0 + uWrap), 0.0)) / uFlat;
        o = vec4(uPaper * 0.99 * min(sh, 1.05) * (1.0 - 0.14 * exp(-ed / 1.3)), 1.0); return;
      }
      float vis = shadowVis();
      if (uMode > 1.5){                                        // desk: shadow + a soft contact darkening round the book
        vec2 dd = max(abs(vP.xy - vec2(uRect.x, 0.0)) - vec2(uRect.y, uEdge.x), 0.0);
        float a = (1.0 - vis) * 0.17 + 0.10 * exp(-length(dd) / 9.0);
        o = vec4(0.075, 0.062, 0.05, 1.0) * a; return;      // warm shade, matching the warm-grey desk
      }
      vec3 n = normalize(vN) * (gl_FrontFacing ? 1.0 : -1.0);
      vec3 base; float ink = 0.0, pat = 0.0, ao = 1.0;
      if (uMode < 0.5){
        vec2 uv = vec2(gl_FrontFacing ? vUV.x : 1.0 - vUV.x, vUV.y);
        vec4 c = gl_FrontFacing ? texture(uTex, uv) : texture(uOther, uv);
        vec3 ot = gl_FrontFacing ? texture(uOther, vec2(1.0 - uv.x, uv.y)).rgb : texture(uTex, vec2(1.0 - uv.x, uv.y)).rgb;
        float g = texture(uGrain, uv * uGrainScale).r; pat = (1.0 - g) / uGrainK;
        base = c.rgb * mix(vec3(1.0), ot, uShow) * g;
        ink = clamp(1.0 - dot(c.rgb, vec3(0.299, 0.587, 0.114)), 0.0, 1.0);
        ao = 1.0 - uGutter * exp(-vUV.x / 0.035);
        float ed = min((1.0 - vUV.x) * uEdge.x * 2.0 * 594.0 / 846.0, min(vUV.y, 1.0 - vUV.y) * uEdge.x * 2.0);
        ao *= 1.0 - 0.10 * exp(-ed / 1.3);   // the cut edge of each sheet reads as a faint line where it peeks out of the stack
      } else {                                                 // stack edge walls: fine sheet lines
        float l = 0.5 + 0.5 * sin(vP.z * uStripe);
        base = uEdge.yyy * uPaper * (0.9 + 0.1 * l);
      }
      vec3 V = normalize(uEye - vP), H = normalize(uL + V);
      float nl = max((dot(n, uL) + uWrap) / (1.0 + uWrap), 0.0) * mix(1.0, vis, uShStr);
      vec3 hemi = mix(uGround, vec3(1.0), n.z * 0.5 + 0.5);
      vec3 diff = min((uLight.x * hemi + uLight.y * nl) / uFlat, vec3(1.08));
      float r = mix(uLight.w * (1.0 - 0.33 * ink), 1.0, clamp(pat * 0.33, 0.0, 1.0)), a2 = r * r * r * r;
      float nh = max(dot(n, H), 0.0), dn = nh * nh * (a2 - 1.0) + 1.0;
      float F = 0.04 + 0.96 * pow(1.0 - max(dot(H, V), 0.0), 5.0);
      float spec = uLight.z * a2 / (3.14159 * dn * dn) * F * nl * (1.0 + 0.5 * ink) - uSpecFlat;
      vec3 lin = pow(base, vec3(2.2)) * diff * ao + spec;
      o = vec4(pow(max(lin, vec3(0.0)), vec3(1.0 / 2.2)) * uAlpha, uAlpha);
    }`;
  function sh(type, src){ const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; }
  function program(vs, fs){ const p = gl.createProgram(); gl.attachShader(p, sh(gl.VERTEX_SHADER, vs)); gl.attachShader(p, sh(gl.FRAGMENT_SHADER, fs));
    ["aUV", "aP", "aN"].forEach((a, i) => gl.bindAttribLocation(p, i, a)); gl.linkProgram(p); if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}; const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); for (let i = 0; i < n; i++){ const nm = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ""); u[nm] = gl.getUniformLocation(p, nm); }
    return {p, u: new Proxy(u, {get: (o, k) => o[k] ?? null})}; }

  function init(book, getState){
    bookEl = book; getS = getState;
    try {
      cv = document.createElement("canvas"); cv.id = "glturn"; cv.setAttribute("aria-hidden", "true");
      cv.style.cssText = "position:absolute;pointer-events:none;z-index:1500;display:none";
      gl = cv.getContext("webgl2", {alpha: true, premultipliedAlpha: true, antialias: true, preserveDrawingBuffer: true, depth: true});
      if (!gl) return false;                                   // no WebGL2 → the DOM book with the CSS turner
      extAniso = gl.getExtension("EXT_texture_filter_anisotropic"); if (extAniso) maxAniso = gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT);
      progS = program(VS, FS); progD = program(VS, FS_DEPTH);
      // the sheet grid (uv only; position comes from the vertex shader)
      const uv = [], idx = [];
      for (let j = 0; j <= GV; j++) for (let i = 0; i <= GU; i++) uv.push(Math.pow(i / GU, 1.6), j / GV);  // columns crowd towards the spine, where the leaf lifts off the page
      for (let j = 0; j < GV; j++) for (let i = 0; i < GU; i++){ const a = j * (GU + 1) + i, b = a + 1, c = a + GU + 1, d = c + 1; idx.push(a, c, b, b, c, d); }
      gridVAO = gl.createVertexArray(); gl.bindVertexArray(gridVAO);
      const ub = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, ub); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
      const ib = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(idx), gl.STATIC_DRAW); gridN = idx.length;
      gl.vertexAttrib3f(1, 0, 0, 0); gl.vertexAttrib3f(2, 0, 0, 1);
      { const GU2 = P.deepGU, GV2 = P.deepGV, uv2 = [], id2 = [];               // low-res grid for sheets deep in a stack
        for (let j = 0; j <= GV2; j++) for (let i = 0; i <= GU2; i++) uv2.push(i / GU2, j / GV2);
        // only a ring along the outer, head and foot edges: the interior of a deep sheet is always under the sheet above it
        for (let j = 0; j < GV2; j++) for (let i = 0; i < GU2; i++){ if (!(i >= GU2 - 3 || j < 2 || j >= GV2 - 2)) continue; const a = j * (GU2 + 1) + i, b = a + 1, c = a + GU2 + 1, d = c + 1; id2.push(a, c, b, b, c, d); }
        deepVAO = gl.createVertexArray(); gl.bindVertexArray(deepVAO);
        const b1 = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, b1); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(uv2), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        const b2 = gl.createBuffer(); gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b2); gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(id2), gl.STATIC_DRAW); deepN = id2.length; }
      groundVAO = gl.createVertexArray(); gl.bindVertexArray(groundVAO);
      const gb = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, gb); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1e4, -1e4, 0, 1e4, -1e4, 0, -1e4, 1e4, 0, 1e4, 1e4, 0]), gl.STATIC_DRAW);
      gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 0, 0);
      gl.bindVertexArray(null);
      blockVAO = gl.createVertexArray(); blockBuf = gl.createBuffer();
      // shadow map: a depth texture read through two samplers (compare for PCF, raw for the blocker search)
      const mkSM = size => { const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT24, size, size);
        const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.TEXTURE_2D, t, 0);
        gl.drawBuffers([gl.NONE]); gl.readBuffer(gl.NONE); gl.bindFramebuffer(gl.FRAMEBUFFER, null); return {tex: t, fb: f, size, key: ""}; };
      // adaptive shadows: a full-res map once the book is still, a smaller one refreshed every other frame while a leaf moves
      const mxT = gl.getParameter(gl.MAX_TEXTURE_SIZE); smHi = mkSM(Math.min(P.shadowMap, mxT)); smLo = P.shadowLow >= P.shadowMap ? smHi : mkSM(Math.min(P.shadowLow, mxT)); smCur = smHi; SM = smHi.size;
      sampCmp = gl.createSampler(); gl.samplerParameteri(sampCmp, gl.TEXTURE_COMPARE_MODE, gl.COMPARE_REF_TO_TEXTURE); gl.samplerParameteri(sampCmp, gl.TEXTURE_COMPARE_FUNC, gl.LEQUAL);
      sampRaw = gl.createSampler();
      [sampCmp, sampRaw].forEach((s, k) => { gl.samplerParameteri(s, gl.TEXTURE_MIN_FILTER, k ? gl.NEAREST : gl.LINEAR); gl.samplerParameteri(s, gl.TEXTURE_MAG_FILTER, k ? gl.NEAREST : gl.LINEAR);
        gl.samplerParameteri(s, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.samplerParameteri(s, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE); });
      blankTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, blankTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...paper.map(v => Math.round(v * 255)), 255]));
      grainTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, grainTex);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, grain()); gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.REPEAT));
      cv.addEventListener("webglcontextlost", e => { e.preventDefault(); ok = false; show(false); });
      ok = true;
    } catch (e) { console.warn("GL book unavailable; using the DOM book", e); ok = false; }
    return ok;
  }
  function attach(){ if (cv && cv.parentNode !== bookEl) bookEl.appendChild(cv); }
  function show(on){ if (!cv) return; cv.style.display = on ? "block" : "none"; bookEl.classList.toggle("gl3d", !!on); }
  function resize(){
    if (!ok) return; attach();
    const S = getS(), W = S.spread ? 2 * S.pw : S.pw, H = Math.round(S.pw * 846 / 594);
    mx = Math.round(S.pw * 0.5); my = Math.round(H * 0.32); cw = W + 2 * mx; ch = H + 2 * my;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    Object.assign(cv.style, {left: -mx + "px", top: -my + "px", width: cw + "px", height: ch + "px"});
    cv.width = Math.round(cw * dpr); cv.height = Math.round(ch * dpr);
    cache.forEach(c => { gl.deleteTexture(c.front); gl.deleteTexture(c.back); }); cache.clear(); pending.clear();
    blockKey = ""; shadowKey = ""; if (smHi){ smHi.key = ""; smLo.key = ""; } show(false);
  }
  /* ---------- page textures ---------- */
  const isWebKit = /^((?!chrome|chromium|android|crios|fxios).)*safari/i.test(navigator.userAgent);
  // page rasters are expensive (SVG → canvas → texture + mipmaps). Pages on screen are done at once; look-ahead pages wait until
  // no leaf is moving, so their cost never lands inside a turn.
  const quiet = () => new Promise(r => { const t = () => (active || hoverT) ? setTimeout(t, 80) : r(); t(); });
  let rasterChain = Promise.resolve();
  // an SVG image cannot load anything, so pictures in a page travel inside it as data URLs
  const inlined = new Map();
  const dataURL = src => inlined.get(src) || (inlined.set(src, fetch(src).then(r => r.blob()).then(b => new Promise(res => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => res(""); fr.readAsDataURL(b); })).catch(() => "")), inlined.get(src));
  function setLook(o){ if (o.css != null) pageCSS = o.css; if (o.root != null) rootStyle = o.root; if (o.paper) paper = o.paper;
    if (ok && blankTex){ gl.bindTexture(gl.TEXTURE_2D, blankTex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([...paper.map(v => Math.round(v * 255)), 255])); } }
  async function raster(sheet, W, H){
    const c = sheet.cloneNode(true); c.style.transform = "none"; c.style.left = "0px"; c.style.top = "0px"; c.style.visibility = "visible";
    for (const im of c.querySelectorAll("img")){ const s = im.getAttribute("src") || ""; if (s.startsWith("blob:") || s.startsWith("/")) im.setAttribute("src", await dataURL(s)); im.removeAttribute("loading"); }
    const html = new XMLSerializer().serializeToString(c), z = W / 594;
    const root = `${rootStyle};-webkit-font-smoothing:antialiased;width:594px;height:846px;position:relative;margin:0;zoom:${z}`;
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml" class="fo-root" style="${root.replace(/"/g, "'")}"><style><![CDATA[${pageCSS.replace(/]]>/g, "")}]]></style>${html}</div></foreignObject></svg>`;
    const img = new Image(); img.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
    await img.decode();
    let tw = W, th = H;
    if (!gl2){ tw = Math.min(2048, 1 << Math.ceil(Math.log2(W))); th = Math.min(2048, 1 << Math.ceil(Math.log2(H))); }
    const can = document.createElement("canvas"); can.width = tw; can.height = th;
    const g = can.getContext("2d"); g.drawImage(img, 0, 0, tw, th);
    if (isWebKit){ await new Promise(r => requestAnimationFrame(r)); g.clearRect(0, 0, tw, th); g.drawImage(img, 0, 0, tw, th); }  // WebKit paints SVG fonts a frame late
    return can;
  }
  function upload(can){
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, can);
    gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    [gl.TEXTURE_WRAP_S, gl.TEXTURE_WRAP_T].forEach(k => gl.texParameteri(gl.TEXTURE_2D, k, gl.CLAMP_TO_EDGE));
    if (extAniso) gl.texParameterf(gl.TEXTURE_2D, extAniso.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(8, maxAniso));
    return t;
  }
  function prefetch(list){
    if (!ok) return Promise.resolve();
    const S = getS(), k = cl(S.pw * (window.devicePixelRatio || 1) * 1.6 / 594, 1.5, 3.4), W = Math.round(594 * k), H = Math.round(846 * k);
    return Promise.all(list.filter(i => i >= 0 && i < S.leaves.length).map(i => {
      if (cache.has(i)) return Promise.resolve(); if (pending.has(i)) return pending.get(i);
      const lf = S.leaves[i], urgent = statics(null).some(s => s.idx === i);
      const job = async () => { if (!urgent) await quiet(); const a = await raster(lf._front, W, H); if (!urgent) await quiet();
        const b = await raster(lf._back, W, H); if (!urgent) await quiet(); return [a, b]; };
      const run = urgent ? job() : (rasterChain = rasterChain.then(job, job));
      const pr = run.then(([a, b]) => {
        pending.delete(i); if (!ok) return;
        const tx = {front: upload(a), back: upload(b)}; cache.set(i, tx); warm(tx);
        if (cache.size > 10){ const keep = new Set(statics(active || hoverT).map(s => s.idx)); if (active) keep.add(active.idx); if (hoverT) keep.add(hoverT.idx);
          const far = [...cache.keys()].filter(x => !keep.has(x)).sort((x, y) => Math.abs(y - getS().cur) - Math.abs(x - getS().cur))[0];
          if (far != null){ const c = cache.get(far); gl.deleteTexture(c.front); gl.deleteTexture(c.back); cache.delete(far); } }
        idle();
      }).catch(e => { pending.delete(i); console.warn("page raster failed, CSS turner will be used", e); });
      pending.set(i, pr); return pr;
    }));
  }
  // drivers (ANGLE in particular) defer texture uploads and mip builds until first use; touch new textures once while the
  // book is still so that cost never lands on a frame of a turn
  let warmFB = null, warmTex = null;
  function warm(tx){
    if (!warmFB){ warmTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, warmTex); gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 4, 4);
      warmFB = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, warmFB); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, warmTex, 0); }
    gl.bindFramebuffer(gl.FRAMEBUFFER, warmFB); gl.viewport(0, 0, 4, 4); gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.useProgram(progS.p); const u = progS.u; gl.uniform1f(u.uMode, 0); gl.uniform4f(u.uD, 0, 0, 0, 0);
    gl.uniformMatrix4fv(u.uVP, false, new Float32Array([1e-4,0,0,0, 0,1e-4,0,0, 0,0,1e-4,0, 0,0,0,1]));
    gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uOther, 1); gl.uniform1i(u.uGrain, 2); gl.uniform1i(u.uShadow, 3); gl.uniform1i(u.uRaw, 4);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, smCur.tex); gl.bindSampler(3, sampCmp);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, smCur.tex); gl.bindSampler(4, sampRaw);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, grainTex);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx.back); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx.front);
    gl.bindVertexArray(deepVAO); gl.drawElements(gl.TRIANGLES, deepN, gl.UNSIGNED_SHORT, 0);
    gl.bindVertexArray(null); gl.bindSampler(3, null); gl.bindSampler(4, null); gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.flush();
  }
  const has = i => ok && cache.has(i);
  /* ---------- the book state → a list of sheets with their uniforms ---------- */
  // A thousand-page book would stand a hand's breadth tall and its open pages would tilt. Only the top MAXR leaves of
  // each stack are drawn, at paper-flipbook's own spacing (closer sheets z-fight against the coarse deep-sheet mesh);
  // heights count down from the top of each stack, so the open pages stay level however long the book is.
  const thick = () => P.thick * getS().pw;
  const MAXR = () => Math.max(4, Math.round((P.maxStack ?? 1) / P.thick));
  const zR = i => { const S = getS(); return (Math.min(S.leaves.length - S.cur, MAXR()) - (i - S.cur)) * thick(); };   // right stack: top = cur
  const zL = i => { const S = getS(); return (Math.min(S.cur, MAXR()) - (S.cur - 1 - i)) * thick(); };                // left stack: top = cur − 1
  const stackF = d => 0.55 + 0.45 * Math.min(1, d / 10);
  function sheetU(idx, prog, T){
    // prog 0 = lying on the right, 1 = lying on the left
    const S = getS(), n = S.leaves.length, pw = S.pw, dR = n - Math.min(idx, n), dL = idx + 1;
    const turning = T && T.idx === idx;
    const p = turning ? T.p : prog, dir = turning ? T.dir : 1;
    const lf = turning ? (dir > 0 ? p : 1 - p) : prog;          // 0 = lying right … 1 = lying left
    const th = Math.PI * lf;
    const B = turning ? Math.sin(Math.PI * p) * Math.PI * T.arc : 0;
    const fold = turning ? T.fold : 0, fs = (pw * 846 / 594) * 0.5 * Math.sin(Math.abs(fold));
    const amp = P.rest * pw * (lf < 0.5 ? stackF(dR) : stackF(dL)), wr = P.wrinkle * pw;
    const zb = zR(idx) + (zL(idx) - zR(idx)) * sstep(lf);
    const fR = turning ? zR(idx + 1) + 0.3 : -1e5, fL = turning ? (idx > 0 ? zL(idx - 1) + 0.3 : 0.3) : -1e5;
    const sag = turning ? P.sag * Math.sin(Math.PI * p) : 0;
    const peel = turning ? T.peel * pw : 0;
    let follow = 0;
    if (T && !turning && T.p > 0 && T.p < 1 && ((T.dir > 0 && idx === T.idx + 1) || (T.dir < 0 && idx === T.idx - 1)))
      follow = (T.dir > 0 ? -1 : 1) * P.follow * Math.sin(Math.PI * T.p);
    return {idx, A: [th, B, fold, fs], Bv: [dir, amp, wr, sstep(lf)], C: [zb, fR, fL, sag], D: [peel, turning ? T.vg : 0.5, follow, 0], turning};
  }
  function sheets(T){
    const S = getS(), n = S.leaves.length, cur = S.cur, out = [], D = P.depth;
    const idxs = new Set();
    for (let k = 0; k < Math.min(n, MAXR()); k++){ if (cur + k < n) idxs.add(cur + k); if (S.spread && cur - 1 - k >= 0) idxs.add(cur - 1 - k); }
    if (T) idxs.add(T.idx);
    // the top D sheets of each stack (and the turning leaf) are full-res and textured; deeper ones are low-res blank sheets
    const near = i => (T && (T.idx === i || Math.abs(i - T.idx) <= 1)) || (i >= cur ? i - cur < D : cur - 1 - i < D);
    idxs.forEach(i => { const lying = i < cur ? 1 : 0; if (!S.spread && lying && !(T && T.idx === i)) return;
      const s = sheetU(i, lying, T); s.deep = !near(i); if (s.deep && !P.deepSheets) return;
      const h = k => { const x = Math.sin((i + 1) * 12.9898 + k * 78.233) * 43758.5453; return x - Math.floor(x) - 0.5; };
      s.off = s.turning ? [0, 0] : [h(1) * 2 * P.jitter * S.pw / 594, h(2) * 2 * P.jitter * S.pw / 594];
      out.push(s); });
    return out;
  }
  function statics(T){                                        // the pages that must be ready before the GL book is shown
    const S = getS(), n = S.leaves.length, cur = S.cur, out = [];
    if (S.spread && cur - 1 >= 0) out.push({idx: cur - 1}); if (cur < n) out.push({idx: cur});
    if (T){ if (T.dir > 0 && T.idx + 1 < n) out.push({idx: T.idx + 1}); if (T.dir < 0 && T.idx - 1 >= 0 && S.spread) out.push({idx: T.idx - 1}); }
    return out;
  }
  /* stack edge walls (outer edge, head and foot) of everything below the rendered sheets */
  function buildBlocks(){
    const S = getS(), n = S.leaves.length, cur = S.cur, pw = S.pw, H = pw * 846 / 594, W = S.spread ? 2 * pw : pw, sx = S.spread ? pw : 0;
    const key = [n, cur, pw, S.spread].join("|"); if (key === blockKey) return; blockKey = key;
    if (!P.walls){ blockN = 0; return; }                       // optional solid stack walls (off by default)
    const v = [], prof = u => u < 0.12 ? Math.sin(u / 0.12 * Math.PI / 2) : u < 0.55 ? 1 - 0.18 * sstep((u - 0.12) / 0.43) : u < 0.78 ? 0.82 + 0.12 * sstep((u - 0.55) / 0.23) : 0.94 - 0.26 * (1 - Math.cos((u - 0.78) / 0.22 * Math.PI / 2));
    const quad = (a, b, c, d, nn) => { [a, b, c, b, d, c].forEach(p => v.push(p[0], p[1], p[2], nn[0], nn[1], nn[2])); };
    const side = (s, top, d) => {                              // s = +1 right stack, −1 left stack
      if (top <= 0) return; const amp = P.rest * pw * stackF(d), K = 24;
      const zt = u => top + amp * prof(u) * 0.97 + 0.4 * P.wrinkle * pw;
      for (let k = 0; k < K; k++){ const u0 = k / K, u1 = (k + 1) / K, x0 = sx - W / 2 + s * u0 * pw, x1 = sx - W / 2 + s * u1 * pw;
        quad([x0, H / 2, 0], [x1, H / 2, 0], [x0, H / 2, zt(u0)], [x1, H / 2, zt(u1)], [0, 1, 0]);
        quad([x1, -H / 2, 0], [x0, -H / 2, 0], [x1, -H / 2, zt(u1)], [x0, -H / 2, zt(u0)], [0, -1, 0]); }
      const xe = sx - W / 2 + s * pw; quad([xe, -H / 2, 0], [xe, H / 2, 0], [xe, -H / 2, zt(1)], [xe, H / 2, zt(1)], [s, 0, 0]);
    };
    side(1, n - cur > P.depth ? zR(cur + P.depth) : (n - cur > 0 ? zR(n - 1) - thick() : 0), n - cur);
    if (S.spread) side(-1, cur > P.depth ? zL(cur - 1 - P.depth) : (cur > 0 ? zL(0) - thick() : 0), cur);
    const f = new Float32Array(v); blockN = f.length / 6;
    gl.bindVertexArray(blockVAO); gl.bindBuffer(gl.ARRAY_BUFFER, blockBuf); gl.bufferData(gl.ARRAY_BUFFER, f, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 3, gl.FLOAT, false, 24, 0); gl.enableVertexAttribArray(2); gl.vertexAttribPointer(2, 3, gl.FLOAT, false, 24, 12);
    gl.disableVertexAttribArray(0); gl.vertexAttrib2f(0, 0.5, 0.5); gl.bindVertexArray(null);
  }
  /* ---------- matrices ---------- */
  const mul = (a, b) => { const o = new Float32Array(16); for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++){ let s = 0; for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]; o[c * 4 + r] = s; } return o; };
  function camera(){
    const S = getS(), D = P.D * S.pw, f = D / (ch / 2), asp = cw / ch, N = D * 0.25, F = D * 1.6;
    const proj = new Float32Array([f / asp, 0, 0, 0, 0, f, 0, 0, 0, 0, (F + N) / (N - F), -1, 0, 0, 2 * F * N / (N - F), 0]);
    const view = new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, -D, 1]);
    // light: orthographic, looking down −L, fitted round the canvas footprint
    const Ln = Math.hypot(...P.light), l = P.light.map(x => x / Ln);
    let up = [0, 1, 0]; const zx = l, xx = [up[1] * zx[2] - up[2] * zx[1], up[2] * zx[0] - up[0] * zx[2], up[0] * zx[1] - up[1] * zx[0]], xn = Math.hypot(...xx); xx.forEach((v, i) => xx[i] = v / xn);
    const yy = [zx[1] * xx[2] - zx[2] * xx[1], zx[2] * xx[0] - zx[0] * xx[2], zx[0] * xx[1] - zx[1] * xx[0]];
    const lv = new Float32Array([xx[0], yy[0], zx[0], 0, xx[1], yy[1], zx[1], 0, xx[2], yy[2], zx[2], 0, 0, 0, 0, 1]);
    let lo = [1e9, 1e9, 1e9], hi = [-1e9, -1e9, -1e9];
    for (const X of [-cw / 2, cw / 2]) for (const Y of [-ch / 2, ch / 2]) for (const Z of [0, S.pw * 1.1]){
      const p = [X * xx[0] + Y * xx[1] + Z * xx[2], X * yy[0] + Y * yy[1] + Z * yy[2], X * zx[0] + Y * zx[1] + Z * zx[2]];
      for (let k = 0; k < 3; k++){ lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); }
    }
    lo[2] -= 10; hi[2] += 10;
    const lp = new Float32Array([2 / (hi[0] - lo[0]), 0, 0, 0, 0, 2 / (hi[1] - lo[1]), 0, 0, 0, 0, -2 / (hi[2] - lo[2]), 0,
      -(hi[0] + lo[0]) / (hi[0] - lo[0]), -(hi[1] + lo[1]) / (hi[1] - lo[1]), -(-lo[2] - hi[2]) / (hi[2] - lo[2]) * -1, 1]);
    // ortho z: view-space z ∈ [lo, hi] (light looks along −zx, so nearer = larger z) → depth 0 near
    lp[10] = -2 / (hi[2] - lo[2]); lp[14] = (hi[2] + lo[2]) / (hi[2] - lo[2]);
    return {vp: mul(proj, view), lvp: mul(lp, lv), l, D, texel: Math.max(hi[0] - lo[0], hi[1] - lo[1]) / SM, ldepth: hi[2] - lo[2], halfH: S.pw * 846 / 594 / 2};
  }
  /* ---------- drawing ---------- */
  function setSheet(pr, s){ const u = pr.u; gl.uniform2f(u.uOff, s.off ? s.off[0] : 0, s.off ? s.off[1] : 0); gl.uniform4fv(u.uA, s.A); gl.uniform4fv(u.uB, s.Bv); gl.uniform4fv(u.uC, s.C); gl.uniform4f(u.uD, s.D[0], s.D[1], s.D[2], 0); }
  function setMesh(pr){ gl.uniform4f(pr.u.uD, 0, 0, 0, 1); }
  function common(pr, cam){
    const S = getS(), u = pr.u;
    gl.uniformMatrix4fv(u.uVP, false, cam.vp); gl.uniformMatrix4fv(u.uLVP, false, cam.lvp);
    gl.uniform1f(u.uW, S.pw); gl.uniform1f(u.uH, S.pw * 846 / 594); gl.uniform1f(u.uSpineX, (S.spread ? S.pw : 0) - (S.spread ? S.pw : S.pw / 2));
  }
  function render(T){
    if (!ok) return;
    const t0 = performance.now(), S = getS();
    const list = sheets(T), cam = camera(); buildBlocks();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    // 1 · shadow map (only when something changed)
    const skey = JSON.stringify(list.map(s => [s.idx, s.A, s.C[0], s.D])) + cw + "|" + blockKey;
    const moving = !!T; frameNo++;
    const sm = moving ? smLo : smHi;
    // a still book always gets an exact full-res map; a moving one refreshes its small map every other frame
    const due = sm.key !== skey && (!moving || sm.key === "" || smCur !== smLo || frameNo % 2 === 0 || !P.shadowSkip);
    if (due){
      sm.key = skey; smCur = sm; SM = sm.size;
      gl.bindFramebuffer(gl.FRAMEBUFFER, sm.fb); gl.viewport(0, 0, SM, SM); gl.clearDepth(1); gl.clear(gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LESS); gl.disable(gl.BLEND); gl.disable(gl.CULL_FACE);
      gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(1.5, 2.0);
      gl.useProgram(progD.p); common(progD, {vp: cam.lvp, lvp: cam.lvp});
      gl.bindVertexArray(gridVAO); list.forEach(s => { if (s.deep) return; setSheet(progD, s); gl.drawElements(gl.TRIANGLES, gridN, gl.UNSIGNED_SHORT, 0); });
      if (blockN){ setMesh(progD); gl.bindVertexArray(blockVAO); gl.drawArrays(gl.TRIANGLES, 0, blockN); }
      gl.disable(gl.POLYGON_OFFSET_FILL); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    else if (sm.key === skey){ smCur = sm; SM = sm.size; }
    // 2 · the scene
    show(true);
    gl.viewport(0, 0, cv.width, cv.height); gl.clearColor(0, 0, 0, 0); gl.clearDepth(1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const pr = progS, u = pr.u; gl.useProgram(pr.p); common(pr, cam); gl.uniform1f(u.uNOff, P.nOff * cam.texel); gl.uniform1f(u.uBias, P.shBias); gl.uniform3fv(u.uLdir, cam.l);
    const flat = P.kh + P.kd * (cam.l[2] + P.wrap) / (1 + P.wrap), Hx = cam.l[0], Hy = cam.l[1], Hz = cam.l[2] + 1, Hn = Math.hypot(Hx, Hy, Hz), nh = Hz / Hn;
    const a2 = Math.pow(P.rough, 4), dd = nh * nh * (a2 - 1) + 1, Fr = 0.04 + 0.96 * Math.pow(1 - nh, 5);
    gl.uniform3fv(u.uL, cam.l); gl.uniform3f(u.uEye, 0, 0, cam.D); gl.uniform3fv(u.uGround, P.ground);
    gl.uniform4f(u.uLight, P.kh, P.kd, P.ks, P.rough); gl.uniform1f(u.uFlat, flat); gl.uniform1f(u.uSpecFlat, P.ks * a2 / (Math.PI * dd * dd) * Fr * cam.l[2]);
    gl.uniform1f(u.uWrap, P.wrap); gl.uniform1i(u.uTapsB, moving ? P.tapsMove[0] : 8); gl.uniform1i(u.uTapsP, moving ? P.tapsMove[1] : 12); gl.uniform1f(u.uShow, P.show); gl.uniform1f(u.uGrainK, P.grainK); gl.uniform1f(u.uGutter, P.gutter); gl.uniform1f(u.uShStr, P.shadow);
    gl.uniform1f(u.uSMs, SM); gl.uniform1f(u.uLDepth, cam.ldepth); gl.uniform1f(u.uStripe, Math.PI / (thick() * 1.5));
    const ph = S.pw * 846 / 594; gl.uniform2f(u.uGrainScale, P.grainTiles, P.grainTiles * ph / S.pw);
    const nL = S.leaves.length, rc = !S.spread ? [0, S.pw / 2] : S.cur === 0 ? [S.pw / 2, S.pw / 2] : S.cur >= nL ? [-S.pw / 2, S.pw / 2] : [0, S.pw];
    gl.uniform2f(u.uRect, rc[0], rc[1]); gl.uniform3f(u.uEdge, ph / 2, 0.882, 0); gl.uniform3fv(u.uPaper, paper);
    gl.uniform1i(u.uTex, 0); gl.uniform1i(u.uOther, 1); gl.uniform1i(u.uGrain, 2); gl.uniform1i(u.uShadow, 3); gl.uniform1i(u.uRaw, 4);
    gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, grainTex);
    gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, smCur.tex); gl.bindSampler(3, sampCmp);
    gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, smCur.tex); gl.bindSampler(4, sampRaw);
    gl.activeTexture(gl.TEXTURE0);
    gl.enable(gl.BLEND); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    // desk shadow first (no depth write), then opaque sheets and stack walls, then a fading leaf (single-page view)
    gl.disable(gl.DEPTH_TEST); gl.uniform1f(u.uMode, 2); gl.uniform1f(u.uAlpha, 1); setMesh(pr); gl.bindVertexArray(groundVAO); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.DEPTH_TEST); gl.depthFunc(gl.LEQUAL); gl.depthMask(true);
    if (blockN){ gl.uniform1f(u.uMode, 1); gl.bindVertexArray(blockVAO); gl.drawArrays(gl.TRIANGLES, 0, blockN); }
    gl.uniform1f(u.uMode, 0); gl.bindVertexArray(gridVAO);
    const fadeOf = s => (!S.spread && s.turning) ? (T.dir > 0 ? cl(1 - (T.p - 0.55) / 0.4, 0, 1) : cl((T.p - 0.05) / 0.4, 0, 1)) : 1;
    const ordered = list.slice().sort((a, b) => fadeOf(b) - fadeOf(a));
    gl.bindVertexArray(gridVAO);
    ordered.forEach(s => {
      const a = fadeOf(s); if (a <= 0 || s.deep) return;
      const tx = cache.get(s.idx);
      gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, tx ? tx.back : blankTex); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tx ? tx.front : blankTex);
      gl.uniform1f(u.uAlpha, a); gl.depthMask(a >= 1); setSheet(pr, s); gl.drawElements(gl.TRIANGLES, gridN, gl.UNSIGNED_SHORT, 0);
    });
    // deep sheets last: the top sheets already fill the depth buffer, so only their peeking edges cost fragments
    gl.depthMask(true); gl.uniform1f(u.uMode, 3); gl.uniform1f(u.uAlpha, 1);
    gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, blankTex); gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, blankTex);
    gl.bindVertexArray(deepVAO); list.forEach(s => { if (!s.deep) return; setSheet(pr, s); gl.drawElements(gl.TRIANGLES, deepN, gl.UNSIGNED_SHORT, 0); });
    gl.bindVertexArray(null); gl.bindSampler(3, null); gl.bindSampler(4, null);
    frameMs.push(performance.now() - t0); if (frameMs.length > 240) frameMs.shift();
  }
  function idle(){
    if (!ok || active || hoverT) return;
    const st = statics(null);
    if (suspended || !st.length || !st.every(s => cache.has(s.idx))){ show(false); return; }
    render(null);
  }
  function suspend(on, why = "x"){ if (on) sus.add(why); else sus.delete(why); suspended = sus.size > 0; if (!ok) return; if (suspended && !active && !hoverT) show(false); else if (!suspended) idle(); }

  /* ---------- turning: progress p ∈ [0,1] from the leaf's start side ---------- */
  function newTurn(lf, idx, dir, vg){
    const g = cl(vg ?? 0.3, 0, 1), jit = (Math.random() * 2 - 1);
    const fold = cl(-(0.5 - g) * 2 * rad(P.foldMax) * 0.85 * (dir > 0 ? 1 : 1) + jit * rad(P.foldJitter), -rad(P.foldMax), rad(P.foldMax));
    return {gl: true, lf, idx, dir, vg: g, p: 0, v: 0, fold, arc: P.arc * (1 - Math.random() * P.arcJitter), peel: 0, lastT: null, theta: dir > 0 ? 0 : 180};
  }
  function begin(lf, idx, dir, vg){
    if (!has(idx)) return null;
    if (hoverT && hoverT.idx === idx && hoverT.dir === dir){ const T = hoverT; hoverT = null; T.hover = false; T.lastT = null; active = T; return T; }
    if (hoverT) endHover(true);
    active = newTurn(lf, idx, dir, vg); return active;
  }
  function end(T){ if (active === T) active = null; if (!hoverT) show(false); }
  const ease = t => 0.5 * (1 - Math.cos(Math.PI * cl(t, 0, 1)));
  const clickDuration = scale => P.flipTime * scale;
  function poseClick(T, t, scale = 1){
    const d = clickDuration(scale), k = cl(t / d, 0, 1), p0 = T.p0 ?? (T.p0 = T.p);
    T.p = p0 + (1 - p0) * ease(k); T.peel = P.peel * Math.sin(Math.PI * Math.min(1, k / 0.45)) * (1 - k);
    T.theta = T.dir > 0 ? 180 * T.p : 180 - 180 * T.p; render(T); return t >= d;
  }
  function playClick(T, scale = 1){ return new Promise(res => { const t0 = performance.now(); const step = now => { if (poseClick(T, (now - t0) / 1000, scale)) res(); else requestAnimationFrame(step); }; requestAnimationFrame(step); }); }
  /* drag: progress follows the pointer (smoothed); velocity is tracked for the release */
  function pose(T, theta, now){
    now = now ?? performance.now(); const dt = T.lastT == null ? 1 / 60 : cl((now - T.lastT) / 1000, 0.001, 0.05);
    const tgt = cl(T.dir > 0 ? theta / 180 : 1 - theta / 180, 0, 1), p0 = T.p;
    T.p += (tgt - T.p) * (1 - Math.exp(-dt / P.dragSmooth)); T.v = 0.6 * (T.v || 0) + 0.4 * (T.p - p0) / dt; T.lastT = now;
    T.peel += (P.peel * 0.6 * (1 - sstep(T.p / 0.3)) - T.peel) * (1 - Math.exp(-dt / 0.08));
    T.theta = T.dir > 0 ? 180 * T.p : 180 - 180 * T.p; render(T);
  }
  /* release: cubic Hermite from the current progress with the hand's velocity as launch speed; fall time ∝ √distance */
  function playRelease(T, to){
    const target = T.dir > 0 ? to / 180 : 1 - to / 180, from = T.p, dist = Math.max(Math.abs(target - from), 0.001);
    const dur = P.fallTime * Math.pow(dist, 0.5), launch = cl((T.v || 0) * Math.sign(target - from) * dur / dist, 0, 2);
    return new Promise(res => { const t0 = performance.now();
      const step = now => { const k = cl((now - t0) / 1000 / dur, 0, 1), k2 = k * k, k3 = k2 * k, h = (k3 - 2 * k2 + k) * launch + (3 * k2 - 2 * k3);
        T.p = from + (target - from) * h; T.peel *= 0.9; T.theta = T.dir > 0 ? 180 * T.p : 180 - 180 * T.p; render(T);
        if (k >= 1) res(); else requestAnimationFrame(step); };
      requestAnimationFrame(step); });
  }
  /* video keyframes [[t, angle, …]] → progress; pure function of t */
  function poseTrack(T, keys, t){
    let a = keys[keys.length - 1][1];
    for (let i = 0; i < keys.length - 1; i++) if (t <= keys[i + 1][0]){ const k = (t - keys[i][0]) / Math.max(1e-6, keys[i + 1][0] - keys[i][0]); a = keys[i][1] + (keys[i + 1][1] - keys[i][1]) * cl(k, 0, 1); break; }
    T.p = cl(a / 180, 0, 1); T.peel = 0; render(T);
  }
  /* desktop hover: the corner under the cursor lifts and the sheet rises a little from the spine */
  let hoverRAF = 0;
  function hover(lf, idx, dir, amount, vg){
    if (!ok || active) return;
    if (hoverT && (hoverT.idx !== idx || hoverT.dir !== dir)) endHover(true);
    if (!hoverT){ if (amount <= 0 || !has(idx)) return; hoverT = newTurn(lf, idx, dir, vg); hoverT.hover = true; hoverT.arc *= 0.5; lf.style.visibility = "hidden"; }
    hoverT.amt = cl(amount, 0, 1); hoverT.vg += (cl(vg, 0, 1) - hoverT.vg) * 0.5;
    if (!hoverRAF){ let last = performance.now(); const step = now => {
      const T = hoverT; if (!T){ hoverRAF = 0; return; }
      const dt = cl((now - last) / 1000, 0.001, 0.05), k = 1 - Math.exp(-dt / 0.09); last = now;
      T.p += (P.hoverP * T.amt - T.p) * k; T.peel += (P.peel * 0.8 * T.amt - T.peel) * k; render(T);
      if (T.amt === 0 && T.p < 0.002 && T.peel < 0.002){ endHover(true); hoverRAF = 0; return; }
      hoverRAF = requestAnimationFrame(step); };
      hoverRAF = requestAnimationFrame(step); }
  }
  function endHover(now){
    const T = hoverT; if (!T) return;
    if (!now){ T.amt = 0; return; }
    hoverT = null; T.lf.style.visibility = ""; if (!active){ show(false); idle(); }
  }
  /** Forget page textures (all, or some leaves), so they are rastered again — after a highlight, a theme change. */
  function invalidate(list){
    if (!ok) return; const keys = list ? list.filter(i => cache.has(i)) : [...cache.keys()];
    keys.forEach(i => { const c = cache.get(i); gl.deleteTexture(c.front); gl.deleteTexture(c.back); cache.delete(i); }); pending.clear();
    if (smHi){ smHi.key = ""; smLo.key = ""; }
  }
  function dispose(){
    if (hoverRAF) cancelAnimationFrame(hoverRAF); hoverT = null; active = null;
    if (gl){ cache.forEach(c => { gl.deleteTexture(c.front); gl.deleteTexture(c.back); }); cache.clear(); gl.getExtension("WEBGL_lose_context")?.loseContext(); }
    cv?.remove(); ok = false;
  }
  return { init, attach, resize, prefetch, has, begin, end, pose, poseClick, playClick, playRelease, poseTrack, clickDuration, hover, endHover, idle, suspend, grain, P,
           setLook, invalidate, dispose, raster,
           get ok(){ return ok; }, get hovering(){ return !!hoverT; }, get frameMs(){ return frameMs.slice(); } };
}

/** The renderer's constants, as paper-flipbook ships them (build.py GL_PARAMS). */
export const GL_PARAMS = {"GU": 64, "GV": 88, "D": 3.0, "light": [-0.5, 0.4, 0.77], "kh": 0.45, "kd": 0.65, "ks": 0.9, "rough": 0.5, "ground": [0.63, 0.68, 0.69], "shadow": 0.85, "shadowMap": 2048, "show": 0.015, "maxStack": 0.045, "grainK": 0.075, "grainTiles": 1.46, "gutter": 0.12, "rest": 0.024, "wrinkle": 0.010, "thick": 0.0016, "depth": 1, "flipTime": 0.85, "tScale": 1.0, "arc": 0.88, "arcJitter": 0.2, "foldMax": 45, "foldJitter": 6, "sag": 0.35, "follow": 0.02, "peel": 0.05, "hoverP": 0.03, "dragSmooth": 0.05, "fallTime": 0.9, "hoverPeel": 24, "wrap": 0.25, "shadowLow": 2048, "deepGU": 24, "deepGV": 32, "jitter": 1.0, "shadowSkip": false, "deepSheets": true, "tapsMove": [8, 12], "nOff": 1.5, "shBias": 1.6};
