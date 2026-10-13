// Live charts under the splash viewer: motor outputs, PID terms and a scrolling spectrogram of the simulated gyro. They are drawn straight on
// canvases (Plotly is far too slow to redraw several times a frame) but with the analyzer's look: same surface, grid and axis colours, motor and
// axis colours, tick fonts and the colour map chosen in the Spectrogram tab. Scales are fixed so nothing jumps around. Needs app.js globals.
//
// The flight is simulated at 250 Hz, which cannot show motor noise, so the spectrogram runs its own 2 kHz gyro signal made from the
// flight: the real (filtered) rate, a harmonic series at every motor's current speed (phase-integrated, so the lines follow
// the throttle), a frame resonance that stays put, and a noise floor. It is then analysed with a real FFT, like the analyzer does.
const LIVE = (() => {
  const WIN = 4, HIST = 6, FS = 2000, N = 512, HOP = 0.04, FMAX = 400, NB = Math.round(FMAX / (FS / N)) + 1, ROWS = Math.round(HIST / HOP), ZMIN = -14, ZMAX = 38, PIDR = 150;
  const MC = ["--roll", "--pitch", "--yaw", "--s4"], PIDN = ["P", "I", "D", "F"], AXN = ["Roll", "Pitch", "Yaw"];
  const hann = Float32Array.from({ length: N }, (_, i) => 0.5 - 0.5 * Math.cos(2 * Math.PI * i / (N - 1)));
  const fft = (re, im) => {       // in-place radix-2
    const n = re.length;
    for (let i = 1, j = 0; i < n; i++) { let b = n >> 1; for (; j & b; b >>= 1) j ^= b; j ^= b; if (i < j) { [re[i], re[j]] = [re[j], re[i]]; [im[i], im[j]] = [im[j], im[i]]; } }
    for (let len = 2; len <= n; len <<= 1) { const a = -2 * Math.PI / len, wr = Math.cos(a), wi = Math.sin(a);
      for (let i = 0; i < n; i += len) { let cr = 1, ci = 0; for (let k = 0; k < len / 2; k++) { const u = i + k, v = u + len / 2, xr = re[v] * cr - im[v] * ci, xi = re[v] * ci + im[v] * cr;
        re[v] = re[u] - xr; im[v] = im[u] - xi; re[u] += xr; im[u] += xi; const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t; } } }
  };
  let st = null;
  const parseCol = c => { c = c.trim(); let m = /^#([0-9a-f]{6})$/i.exec(c); if (m) { const v = parseInt(m[1], 16); return [v >> 16, (v >> 8) & 255, v & 255]; }
    m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(c); if (m) return m.slice(1).map(h => parseInt(h + h, 16)); m = /rgba?\(([^)]+)\)/.exec(c); if (m) return m[1].split(",").slice(0, 3).map(Number); return [136, 136, 136]; };

  function start(host, o = {}) {
    stop();
    host.innerHTML = `<div class="lv"><canvas id="lvMot"></canvas></div><div class="lv"><canvas id="lvPid"></canvas><span class="seg lvax" id="lvAx">${AXN.map((n, k) => `<button data-v="${k}">${n}</button>`).join("")}</span></div><div class="lv"><canvas id="lvSpec"></canvas></div>`;
    st = { host, axis: store.get("demo.lvax", 1), d: null, lastT: -1, ring: new Float32Array(N), rp: 0, filled: 0, phase: [0, 0, 0, 0], res: [0, 0], z: [], mf: [], hopT: 0, last: 0, theme: "", noiseLP: 0, dirty: true,
           img: document.createElement("canvas"), lut: null, pal: null, ...o };
    st.img.width = NB; st.img.height = ROWS; st.imgCtx = st.img.getContext("2d"); st.imgData = st.imgCtx.createImageData(NB, ROWS);
    [...$("lvAx").children].forEach(b => b.classList.toggle("on", +b.dataset.v === st.axis));
    $("lvAx").onclick = e => { const v = e.target.dataset.v; if (v === undefined) return; st.axis = +v; store.set("demo.lvax", st.axis); [...$("lvAx").children].forEach(b => b.classList.toggle("on", +b.dataset.v === st.axis)); st.d = null; };
  }
  function stop() { st = null; }

  // colours and the colour map, re-read only when the theme or the map changes
  function palette() {
    const th = (document.documentElement.dataset.theme || "") + "|" + S.cmap; if (st.pal && st.palKey === th) return st.pal; st.palKey = th;
    const p = { surface: css("--surface"), ink: css("--ink"), ink2: css("--ink2"), grid: css("--grid"), axis: css("--axis"), accent: css("--accent"), series: MC.map(css) };
    let stops = cmap(S.cmap); if (typeof stops === "string") stops = cmap("BBX");
    const cols = stops.map(([pos, c]) => [pos, parseCol(c)]); st.lut = new Uint8ClampedArray(256 * 3);
    for (let i = 0; i < 256; i++) { const t = i / 255; let k = 0; while (k < cols.length - 2 && t > cols[k + 1][0]) k++; const [p0, c0] = cols[k], [p1, c1] = cols[k + 1], f = Math.max(0, Math.min(1, (t - p0) / ((p1 - p0) || 1))); for (let c = 0; c < 3; c++) st.lut[i * 3 + c] = c0[c] + (c1[c] - c0[c]) * f; }
    st.dirty = true; return (st.pal = p);
  }

  // one frame of an axis-and-grid plot area; returns helpers to map data to pixels
  const M = { l: 36, r: 8, t: 22, b: 30 };
  function frame(cv, title, keys, xr, yr, xt, yt, xlab, ylab) {
    const dpr = Math.min(devicePixelRatio || 1, 2), w = cv.clientWidth, h = cv.clientHeight;
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); st.dirty = true; }
    const c = cv.getContext("2d"), p = st.pal; c.setTransform(dpr, 0, 0, dpr, 0, 0); c.fillStyle = p.surface; c.fillRect(0, 0, w, h);
    const x0 = M.l, x1 = w - M.r, y0 = M.t, y1 = h - M.b, X = v => x0 + (v - xr[0]) / (xr[1] - xr[0]) * (x1 - x0), Y = v => y1 - (v - yr[0]) / (yr[1] - yr[0]) * (y1 - y0);
    c.font = "10px system-ui, -apple-system, Segoe UI, sans-serif"; c.textBaseline = "middle"; c.lineWidth = 1;
    for (const v of yt) { const y = Math.round(Y(v)) + 0.5; c.strokeStyle = v === 0 && yr[0] < 0 ? p.axis : p.grid; c.beginPath(); c.moveTo(x0, y); c.lineTo(x1, y); c.stroke(); c.fillStyle = p.ink2; c.textAlign = "right"; c.fillText(String(v).replace("-", "−"), x0 - 4, y); }
    c.textBaseline = "top"; c.textAlign = "center";
    for (const v of xt) { const x = Math.round(X(v)) + 0.5; c.strokeStyle = p.grid; c.beginPath(); c.moveTo(x, y0); c.lineTo(x, y1); c.stroke(); c.fillStyle = p.ink2; c.fillText(String(v).replace("-", "−"), x, y1 + 3); }
    c.strokeStyle = p.axis; c.strokeRect(x0 + 0.5, y0 + 0.5, x1 - x0, y1 - y0);
    c.fillStyle = p.ink2; c.textAlign = "right"; c.fillText(xlab, x1, y1 + 16); c.save(); c.translate(9, (y0 + y1) / 2); c.rotate(-Math.PI / 2); c.textAlign = "center"; c.textBaseline = "middle"; c.fillText(ylab, 0, 0); c.restore();
    c.textAlign = "left"; c.textBaseline = "middle"; c.font = "11px system-ui, -apple-system, Segoe UI, sans-serif"; c.fillStyle = p.ink; c.fillText(title, x0, 10); let tx = x0 + c.measureText(title).width + 10;
    keys.forEach(([n, col]) => { c.fillStyle = col; c.fillRect(tx, 6, 7, 7); c.fillStyle = p.ink2; c.fillText(n, tx + 10, 10); tx += 10 + c.measureText(n).width + 8; });
    return { c, X, Y, x0, x1, y0, y1, w, h };
  }
  const lines = (f, xs, ys, col, lw) => { const c = f.c; c.save(); c.beginPath(); c.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); c.clip(); c.strokeStyle = col; c.lineWidth = lw; c.lineJoin = "round"; c.beginPath();
    for (let i = 0; i < xs.length; i++) { const x = f.X(xs[i]), y = f.Y(ys[i]); i ? c.lineTo(x, y) : c.moveTo(x, y); } c.stroke(); c.restore(); };

  function resetSignal() { st.ring.fill(0); st.rp = 0; st.filled = 0; st.phase.fill(0); st.res.fill(0); st.hopT = 0; st.noiseLP = 0; st.z = Array.from({ length: ROWS }, () => new Float32Array(NB).fill(ZMIN)); st.mf = new Array(ROWS).fill(null); st.dirty = true; }

  // one hop of the 2 kHz gyro: from log time t0 to t1
  function synth(d, t0, t1, ax) {
    const n = d.n, dt = d.t[1] - d.t[0], ch = d.ch, g = ch[`gyro[${ax}]`], thr = ch.thr, nS = Math.max(1, Math.round((t1 - t0) * FS)), hz = [0, 1, 2, 3].map(m => ch[`mHz[${m}]`]);
    for (let s = 0; s < nS; s++) {
      const tau = t0 + (s + 1) * (t1 - t0) / nS, i = Math.max(0, Math.min(n - 1, Math.round(tau / dt))), th = Math.max(0.03, thr[i] / 100);
      let x = g[i] * 0.4;   // the real rate: the low-frequency body of the spectrum (stick moves, wind, trick rates)
      for (let m = 0; m < 4; m++) { st.phase[m] += 2 * Math.PI * hz[m][i] / FS;
        const A = 14 * th * th * (0.8 + 0.1 * m);   // °/s at the fundamental, growing with throttle; a little different per motor (balance)
        x += A * Math.sin(st.phase[m]) + 0.55 * A * Math.sin(2 * st.phase[m] + 0.7) + 0.2 * A * Math.sin(3 * st.phase[m] + 1.9); }
      const w = (Math.random() - 0.5) * 2 * (0.25 + 1.2 * th);   // broadband floor, rising with throttle
      st.noiseLP += (w - st.noiseLP) * 0.55; x += st.noiseLP;
      const e = (Math.random() - 0.5) * 2 * 0.6 * th, w0 = 2 * Math.PI * 182 / FS;       // frame resonance: a lightly damped 182 Hz mode kicked by the noise
      const r1 = 1.9 * Math.cos(w0) * 0.992 * st.res[0] - 0.984 * st.res[1] + e * 0.25; st.res[1] = st.res[0]; st.res[0] = r1; x += 4.0 * r1;
      st.ring[st.rp] = x; st.rp = (st.rp + 1) % N; st.filled = Math.min(N, st.filled + 1);
    }
  }
  const re = new Float32Array(N), im = new Float32Array(N);
  function column(d, t) {
    for (let k = 0; k < N; k++) { re[k] = st.ring[(st.rp + k) % N] * hann[k]; im[k] = 0; }
    fft(re, im); const row = new Float32Array(NB);
    for (let k = 0; k < NB; k++) row[k] = 20 * Math.log10(Math.hypot(re[k], im[k]) / (N / 4) + 1e-6) + 6;
    st.z.shift(); st.z.push(row); st.dirty = true;
    const i = Math.max(0, Math.min(d.n - 1, Math.round(t / (d.t[1] - d.t[0])))); st.mf.shift(); st.mf.push([0, 1, 2, 3].reduce((a, m) => a + d.ch[`mHz[${m}]`][i], 0) / 4);
  }

  function update(t, d) {
    if (!st || !d || !$("lvMot")) return;
    const p = palette(), ax = st.axis;
    if (st.d !== d || t < st.lastT - 0.2 || t - st.lastT > 1) { st.d = d; resetSignal(); st.lastT = t; st.hopT = t; }
    let guard = 0;   // generate the gyro up to now, one FFT column per hop of flight time
    while (st.hopT + HOP <= t && guard++ < 40) { synth(d, st.hopT, st.hopT + HOP, ax); st.hopT += HOP; if (st.filled >= N) column(d, st.hopT); }
    st.lastT = t;
    const now = performance.now(); if (now - st.last < 30 && !st.dirty) return; st.last = now;
    const dt = d.t[1] - d.t[0], i1 = Math.min(d.n - 1, Math.round(t / dt)), i0 = Math.max(0, i1 - Math.round(WIN / dt)), xs = [];
    for (let i = i0; i <= i1; i++) xs.push(d.t[i] - t);   // every sample, always the same ones: a stride that shifted with the window made the traces change as they scrolled
    const pick = a => { const r = []; for (let i = i0; i <= i1; i++) r.push(a[i]); return r; }, XT = [-4, -3, -2, -1, 0];
    // the spans where a trick is being flown, shaded behind the traces so the data lines up with what the quad does
    const bands = f => { const c = f.c, tk = d.trick; if (!tk) return; c.save(); c.beginPath(); c.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); c.clip(); c.font = "600 9px system-ui, sans-serif"; c.textBaseline = "top"; c.textAlign = "left";
      for (let i = i0; i <= i1; i++) { const k = tk.idx[i]; if (k < 0 || (i > i0 && tk.idx[i - 1] === k)) continue; let j = i; while (j < i1 && tk.idx[j + 1] === k) j++;
        const xa = f.X(d.t[i] - t), xb = f.X(d.t[j] - t); c.fillStyle = p.accent; c.globalAlpha = 0.13; c.fillRect(xa, f.y0, Math.max(1, xb - xa), f.y1 - f.y0); c.globalAlpha = 0.9; c.fillRect(xa, f.y0, 1, f.y1 - f.y0);
        if (xb - xa > 30) { c.fillStyle = p.ink2; c.fillText(tk.names[k], xa + 3, f.y0 + 2); } }
      c.restore(); };
    // motors
    let f = frame($("lvMot"), "Motors (%)", [0, 1, 2, 3].map(m => [`M${m + 1}`, p.series[m]]), [-WIN, 0], [0, 100], XT, [0, 50, 100], "s", "%");
    bands(f); for (let m = 0; m < 4; m++) lines(f, xs, pick(d.ch[`m%[${m}]`]), p.series[m], 1.3);
    // PID terms of the chosen axis
    f = frame($("lvPid"), `PID · ${AXN[ax].toLowerCase()}`, PIDN.map((n, j) => [n, p.series[j]]), [-WIN, 0], [-PIDR, PIDR], XT, [-PIDR, 0, PIDR], "s", "");
    bands(f); ["P", "I", "D", "F"].forEach((k, j) => lines(f, xs, pick(d.ch[`pid${k}[${ax}]`]), p.series[j], 1.2));
    // spectrogram: newest row at the top, like time running up the analyzer's spectrogram
    f = frame($("lvSpec"), "Gyro spectrogram (dB)", [], [0, FMAX], [-HIST, 0], [0, 100, 200, 300, 400], [-6, -4, -2, 0], "Hz", "s ago");
    if (st.dirty) { const px = st.imgData.data; for (let r = 0; r < ROWS; r++) { const row = st.z[ROWS - 1 - r]; for (let k = 0; k < NB; k++) { const i = Math.max(0, Math.min(255, Math.round((row[k] - ZMIN) / (ZMAX - ZMIN) * 255))), o = (r * NB + k) * 4; px[o] = st.lut[i * 3]; px[o + 1] = st.lut[i * 3 + 1]; px[o + 2] = st.lut[i * 3 + 2]; px[o + 3] = 255; } }
      st.imgCtx.putImageData(st.imgData, 0, 0); st.dirty = false; }
    f.c.imageSmoothingEnabled = true; f.c.drawImage(st.img, f.x0 + 1, f.y0 + 1, f.x1 - f.x0 - 1, f.y1 - f.y0 - 1);
    f.c.save(); f.c.beginPath(); f.c.rect(f.x0, f.y0, f.x1 - f.x0, f.y1 - f.y0); f.c.clip(); f.c.strokeStyle = p.ink; f.c.globalAlpha = 0.7; f.c.lineWidth = 1; f.c.setLineDash([2, 3]);
    for (let h = 1; h <= 3; h++) { f.c.beginPath(); let pen = false; for (let r = 0; r < ROWS; r++) { const mf = st.mf[r]; if (mf == null || mf * h > FMAX) { pen = false; continue; } const x = f.X(mf * h), y = f.Y(-(ROWS - 1 - r) * HOP); pen ? f.c.lineTo(x, y) : f.c.moveTo(x, y); pen = true; } f.c.stroke(); }
    f.c.restore();
    st.dirty = false;
  }
  // a new flight that carries on from the old one (same history, shifted clock): keep the plots running, just move the time base
  const rebase = (d, off) => { if (!st) return; st.d = d; st.lastT -= off; st.hopT -= off; };
  return { start, stop, update, rebase };
})();
