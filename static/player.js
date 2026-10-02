// BBX playback: shared timeline player + canvas 3D quad viewer (no external 3D lib).
// Frame: body FLU (x forward, y left, z up), as logged by Betaflight gyro/acc. Motors in BF Quad X order.
const PB = { key: null, d: null, t: 0, playing: false, dirty: true, last: 0,
  speed: store.get("pb.speed", 1), span: store.get("pb.span", 10), follow: store.get("pb.follow", true), hooks: {} };
// Physical scale: the model's motors sit 0.72·√2 = 1.02 units from the centre (wheelbase 2.04 units). The real wheelbase is
// taken from the prop size (≈ 45 mm per inch: 5″ → 225 mm, 7″ → 315 mm), so 1× shake is true size relative to the drawn quad.
const craftInch = () => (typeof S !== "undefined" && S.profile ? S.profile.used.inch : 5);
const wheelbaseMM = () => Math.round(45 * craftInch());
const uPerM = () => 2.036 / (wheelbaseMM() / 1000);
const gainOf = pos => pos < 0.05 ? 0 : 10 ** (pos - 1);           // slider 0…4 → 0, 0.11×…1000× (1 = real)
const posOf = g => g <= 0 ? 0 : Math.log10(g) + 1;
const fmtG = g => g === 0 ? "off" : g < 10 ? `${g.toFixed(g < 1 ? 2 : 1)}×` : `${g.toFixed(0)}×`;
const VDEF = { src: "filt", cam: "heading", pscale: 1, wobble: 1, shake: 1, az: Math.PI + 0.55, el: 0.42, dist: 3.6,
  show: { body: true, props: true, labels: true, thrust: true, grid: true, axes: false, hud: true, acc: false, legend: true } };
const VS = (() => { const s = store.get("viewer2", {}); return { ...VDEF, ...s, show: { ...VDEF.show, ...(s.show || {}) } }; })();
const saveVS = () => store.set("viewer2", { src: VS.src, cam: VS.cam, wobble: VS.wobble, shake: VS.shake, show: VS.show, pscale: VS.pscale });
const MPOS = [[-1, -1], [1, -1], [-1, 1], [1, 1]].map(([x, y]) => [x * 0.72, y * 0.72]);  // M1 RR, M2 FR, M3 RL, M4 FL
const MSPIN = [-1, 1, 1, -1];  // props-in: M1 CW, M2 CCW, M3 CCW, M4 CW (seen from above)
const SPD = ["#2b0b57", "#6a176e", "#a52c60", "#dd513a", "#f98e09", "#f6d746", "#fcffa4"];  // speed ramp (inferno-like)
const lerpHex = (a, b, f) => { const A = parseInt(a.slice(1), 16), B = parseInt(b.slice(1), 16);
  return `rgb(${[16, 8, 0].map(s => Math.round(((A >> s) & 255) * (1 - f) + ((B >> s) & 255) * f)).join(",")})`; };
const spdColor = v => { const x = Math.max(0, Math.min(1, v)) * (SPD.length - 1), i = Math.min(SPD.length - 2, Math.floor(x)); return lerpHex(SPD[i], SPD[i + 1], x - i); };

// ---------- data ----------
async function ensurePB() {
  const key = `${S.file}/${S.sub}`;
  if (PB.key === key && PB.d) return PB.d;
  if (PB.loading === key) return PB.loadingP;
  PB.loading = key;
  PB.loadingP = (async () => {
    const r = await fetch(`/api/${encodeURIComponent(S.file)}/${S.sub}/playback`);
    const names = r.headers.get("X-Channels").split(","), n = +r.headers.get("X-N"), nm = +r.headers.get("X-Motors");
    const buf = new Float32Array(await r.arrayBuffer()), ch = {};
    names.forEach((k, i) => ch[k] = buf.subarray(i * n, (i + 1) * n));
    const d = { n, nm, t: ch.t, ch, dur: ch.t[n - 1] };
    d.fmax = Math.max(50, pct([...Array(nm).keys()].flatMap(m => Array.from(ch[`mHz[${m}]`].filter((_, i) => i % 7 === 0))), 0.995));
    d.gmax = Math.max(100, pct([0, 1, 2].flatMap(a => Array.from(ch[`gyro[${a}]`].filter((_, i) => i % 7 === 0)).map(Math.abs)), 0.995));
    d.q = { filt: attitude(d, "gyro"), raw: attitude(d, "gyroRaw") };
    // wobble (rad, >3 Hz) and shake (m, >8 Hz) are integrated server-side at the full log rate (bbl.py: _band_int)
    d.wob = { filt: [0, 1, 2].map(a => ch[`wob[${a}]`]), raw: [0, 1, 2].map(a => ch[`wobRaw[${a}]`]) };
    d.accHP = [0, 1, 2].map(a => highpass(ch[`acc[${a}]`], Math.round(0.4 * n / d.dur)));
    d.disp = [0, 1, 2].map(a => ch[`disp[${a}]`]);
    d.pos = estimatePath(d);
    PB.d = d; PB.key = key; PB.t = Math.min(PB.t, d.dur); PB.dirty = true; PB.loading = null;
    return d;
  })();
  return PB.loadingP;
}
const pct = (a, p) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor((s.length - 1) * p)] || 0; };
function movavg(x, w) { const n = x.length, o = new Float32Array(n), h = Math.max(1, w >> 1); let s = 0, c = 0;
  for (let i = 0; i < Math.min(n, h); i++) { s += x[i]; c++; }
  for (let i = 0; i < n; i++) { if (i + h < n) { s += x[i + h]; c++; } if (i - h - 1 >= 0) { s -= x[i - h - 1]; c--; } o[i] = s / c; } return o; }
function highpass(x, w) { const m = movavg(x, w); return x.map((v, i) => v - m[i]); }
// Mahony complementary filter: gyro integration + gentle accelerometer levelling (gated to ~1 g, low rates)
function attitude(d, g) {
  const { n, t, ch } = d, q = new Float32Array(4 * n), D = Math.PI / 180;
  let w = 1, x = 0, y = 0, z = 0;
  for (let i = 0; i < n; i++) {
    const dt = i ? Math.min(0.05, Math.max(0, t[i] - t[i - 1])) : 0;
    let wx = ch[`${g}[0]`][i] * D, wy = ch[`${g}[1]`][i] * D, wz = ch[`${g}[2]`][i] * D;
    const ax = ch["acc[0]"][i], ay = ch["acc[1]"][i], az = ch["acc[2]"][i], an = Math.hypot(ax, ay, az);
    if (an > 0.85 && an < 1.15 && Math.hypot(wx, wy, wz) < 3) {
      const vx = 2 * (x * z - w * y), vy = 2 * (y * z + w * x), vz = 1 - 2 * (x * x + y * y), k = 0.3 / an;
      wx += k * (ay * vz - az * vy); wy += k * (az * vx - ax * vz); wz += k * (ax * vy - ay * vx);
    }
    const h = 0.5 * dt, nw = w + h * (-x * wx - y * wy - z * wz), nx = x + h * (w * wx + y * wz - z * wy),
          ny = y + h * (w * wy - x * wz + z * wx), nz = z + h * (w * wz + x * wy - y * wx), nn = Math.hypot(nw, nx, ny, nz);
    w = nw / nn; x = nx / nn; y = ny / nn; z = nz / nn;
    q[4 * i] = w; q[4 * i + 1] = x; q[4 * i + 2] = y; q[4 * i + 3] = z;
  }
  return q;
}
// approximate flight path (m, world frame): accelerometer rotated to the world, gravity removed, integrated twice with
// leaky integrators (velocity forgets over ~3 s, position over ~10 s). No GPS/baro in the log, so this shows the shape of
// the motion (loops, dives, punch-outs), not where the quad really went.
function estimatePath(d) {
  const { n, ch } = d, fs = n / d.dur, q = d.q.filt, lv = Math.exp(-1 / (3 * fs)), lp = Math.exp(-1 / (10 * fs)), dt = 1 / fs;
  const P = [new Float32Array(n), new Float32Array(n), new Float32Array(n)], v = [0, 0, 0], p = [0, 0, 0];
  let zmin = 0;
  for (let i = 0; i < n; i++) {
    const a = qrot(q, 4 * i, [ch["acc[0]"][i], ch["acc[1]"][i], ch["acc[2]"][i]]);
    a[2] -= 1;
    for (let k = 0; k < 3; k++) { v[k] = v[k] * lv + a[k] * 9.81 * dt; p[k] = p[k] * lp + v[k] * dt; P[k][i] = p[k]; }
    zmin = Math.min(zmin, p[2]);
  }
  d.groundZ = zmin - 1.5;
  return P;
}
function idxAt(t) { const T = PB.d.t; let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; T[m] < t ? lo = m + 1 : hi = m; } return lo; }

// ---------- player bar ----------
function mountPlayer(opts = {}) {
  const el = $("player"); el.hidden = false;
  const sl = (id, min, max, step, val) => `<input id="${id}" type="range" min="${min}" max="${max}" step="${step}" value="${val}">`;
  const seg = (id, opts_, cur, tip) => `<span class="seg" id="${id}"${tip ? ` data-tip="${tip}"` : ""}>${opts_.map(([v, t]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;
  el.innerHTML = `<div class="pbrow">
    <div class="pbl"><span id="pbTime" class="pbtime">–</span>
      <label class="ctl"><span>Speed</span>${sl("pbSpeed", -4, 3, 0.05, Math.log2(PB.speed))}<b id="pbSpeedV"></b></label>
      <label class="ctl"><span>Zoom</span>${sl("pbZoom", -1, 9, 0.05, Math.log2(PB.span))}<b id="pbZoomV"></b></label></div>
    <div class="pbc"><button id="pbBack" class="btn sm pbstep" title="Back 1 s (←: 0.2 s, Shift+←: 5 s)">−1s</button>
      <button id="pbPlay" class="pbbtn ${PB.playing ? "playing" : ""}" title="Play / pause (Space)">${PB.playing ? "❚❚" : "▶"}</button>
      <button id="pbFwd" class="btn sm pbstep" title="Forward 1 s (→: 0.2 s, Shift+→: 5 s)">+1s</button></div>
    <div class="pbr">${seg("ovmode", [["nav", "Navigate"], ["sel", "Select range"]], S.ovMode === "sel" ? "sel" : "nav")}
      <button id="pbFit" class="btn sm" title="Zoom out to the whole flight (all time charts)">⤢ Reset zoom</button>
      <button id="pbVid" class="btn sm" title="Load a flight video (DVR / action cam) and show it behind the charts">🎬 Video</button>
      <span class="hint" id="ovhint">${S.ovMode === "sel" ? "drag to select · double-click clears" : "drag to scrub · wheel zooms"}</span></div></div>
    <canvas id="pbStrip"></canvas>`;
  $("pbPlay").onclick = togglePlay;
  $("pbBack").onclick = () => seek(PB.t - 1); $("pbFwd").onclick = () => seek(PB.t + 1);
  $("pbSpeed").oninput = e => { PB.speed = 2 ** +e.target.value; store.set("pb.speed", PB.speed); labels(); };
  $("pbZoom").oninput = e => { PB.span = 2 ** +e.target.value; store.set("pb.span", PB.span); labels(); PB.dirty = true; };
  $("pbZoom").onchange = () => typeof stripSync === "function" && stripSync(false);
  $("pbVid").onclick = () => typeof openVideoPanel === "function" && openVideoPanel();
  $("ovmode").onclick = e => { const v = e.target.dataset.v; if (!v) return; S.ovMode = v; store.set("ovMode", v);
    [...$("ovmode").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); $("pbStrip").classList.toggle("sel", v === "sel");
    $("ovhint").textContent = v === "sel" ? "drag to select · double-click clears" : "drag to scrub · wheel zooms"; };
  $("pbFit").onclick = () => { if (!PB.d) return; PB.playing = false; syncPlayBtn(); PB.span = PB.d.dur; $("pbZoom").value = Math.log2(PB.span); store.set("pb.span", PB.span); labels();
    if (typeof syncView === "function") syncView(null, {}); PB.dirty = true; };
  const cv = $("pbStrip"); cv.classList.toggle("sel", S.ovMode === "sel");
  const tAt = e => { const b = cv.getBoundingClientRect(); return PB.t + ((e.clientX - b.left) / b.width - 0.5) * PB.span; };
  let drag = null;
  cv.onpointerdown = e => { if (e.button !== 0) return; cv.setPointerCapture(e.pointerId);
    if (S.ovMode === "sel") { const t = tAt(e); drag = { sel: true, t0: t }; PB.sel = [t, t]; PB.dirty = true; return; }
    drag = { x: e.clientX, t: PB.t, was: PB.playing }; PB.playing = false; syncPlayBtn(); cv.classList.add("grab"); };
  cv.onpointermove = e => { if (!drag) return;
    if (drag.sel) { PB.sel = [drag.t0, tAt(e)]; PB.dirty = true; return; }
    seek(drag.t - (e.clientX - drag.x) * PB.span / cv.clientWidth); if (typeof stripSync === "function") stripSync(true); };
  cv.onpointerup = cv.onpointercancel = () => {
    if (drag && drag.sel) { const [a, b] = PB.sel.slice().sort((x, y) => x - y), D = PB.d ? PB.d.dur : 1e9; PB.sel = null; PB.dirty = true; drag = null;
      if (b - a > 0.2) setRange([+Math.max(0, a).toFixed(3), +Math.min(D, b).toFixed(3)]); return; }
    if (drag) { PB.playing = drag.was; PB.last = performance.now(); if (typeof stripSync === "function") stripSync(false); } drag = null; cv.classList.remove("grab"); syncPlayBtn(); };
  cv.ondblclick = () => { if (S.ovMode === "sel" && S.range) setRange(null); };
  cv.onwheel = e => { e.preventDefault(); PB.span = Math.min(512, Math.max(0.5, PB.span * 1.15 ** Math.sign(e.deltaY))); $("pbZoom").value = Math.log2(PB.span); store.set("pb.span", PB.span); labels(); PB.dirty = true; if (typeof stripSync === "function") stripSync(false); };
  labels(); PB.dirty = true;
}
function labels() { if (!$("pbSpeedV")) return; $("pbSpeedV").textContent = PB.speed >= 1 ? `${PB.speed.toFixed(PB.speed < 2 ? 2 : 1)}×` : `${PB.speed.toFixed(2)}×`;
  $("pbZoomV").textContent = PB.span < 10 ? `${PB.span.toFixed(1)} s` : `${PB.span.toFixed(0)} s`; }
function unmountPlayer() { $("player").hidden = true; $("player").innerHTML = ""; PB.playing = false; }
function togglePlay() { if (!PB.d) return; if (PB.t >= PB.d.dur - 0.01) PB.t = 0; PB.playing = !PB.playing; PB.last = performance.now(); syncPlayBtn(); }
const syncPlayBtn = () => { const b = $("pbPlay"); if (!b) return; b.textContent = PB.playing ? "❚❚" : "▶"; b.classList.toggle("playing", PB.playing); b.title = PB.playing ? "Pause (space)" : "Play (space)"; };
function seek(t) { if (!PB.d) return; PB.t = Math.max(0, Math.min(PB.d.dur, t)); PB.dirty = true; }

function drawStrip() {
  const cv = $("pbStrip"); if (!cv || !PB.d) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const d = PB.d, t0 = PB.t - PB.span / 2, t1 = PB.t + PB.span / 2, X = t => (t - t0) / (t1 - t0) * W;
  const i0 = Math.max(0, idxAt(t0) - 1), i1 = Math.min(d.n - 1, idxAt(t1) + 1), step = Math.max(1, Math.floor((i1 - i0) / (W * 2)));
  c.fillStyle = css("--strip"); c.fillRect(0, 0, W, H);
  if (S.range) { c.fillStyle = rgba(css("--accent"), .13); c.fillRect(X(S.range[0]), 0, X(S.range[1]) - X(S.range[0]), H);
    c.strokeStyle = rgba(css("--accent"), .8); c.lineWidth = 1; c.strokeRect(X(S.range[0]) + .5, .5, X(S.range[1]) - X(S.range[0]) - 1, H - 1); }
  if (PB.sel) { const a = Math.min(...PB.sel), b = Math.max(...PB.sel); c.fillStyle = rgba(css("--warning"), .25); c.fillRect(X(a), 0, X(b) - X(a), H);
    c.fillStyle = css("--ink"); c.font = "600 11px system-ui"; c.fillText(`${a.toFixed(1)}–${b.toFixed(1)} s`, X(a) + 4, H - 6); }
  // throttle area (bottom half) + gyro lines (full height)
  c.beginPath(); c.moveTo(X(d.t[i0]), H);
  for (let i = i0; i <= i1; i += step) c.lineTo(X(d.t[i]), H - d.ch.thr[i] / 100 * H * 0.9);
  c.lineTo(X(d.t[i1]), H); c.closePath();
  // throttle: neutral grey (the theme's ink), gradient fill + crisp edge, so the coloured gyro traces stay the stars
  const ink = css("--ink"), thc = ink.length === 7 ? ink : "#ffffff";
  const gr = c.createLinearGradient(0, H * 0.1, 0, H); gr.addColorStop(0, rgba(thc, .30)); gr.addColorStop(1, rgba(thc, .06));
  c.fillStyle = gr; c.fill();
  c.beginPath(); for (let i = i0; i <= i1; i += step) { const x = X(d.t[i]), y = H - d.ch.thr[i] / 100 * H * 0.9; i === i0 ? c.moveTo(x, y) : c.lineTo(x, y); }
  c.strokeStyle = rgba(thc, .75); c.lineWidth = 1.6; c.stroke();
  c.fillStyle = rgba(thc, .8); c.font = "600 10px system-ui"; c.fillText("throttle", 6, H - 16);
  const g = "gyro";   // filtered gyro only: a reference trace on top of the throttle
  [0, 1, 2].forEach(a => { c.beginPath(); c.strokeStyle = axc(a); c.lineWidth = 1.2;
    for (let i = i0; i <= i1; i += step) { const x = X(d.t[i]), y = H * 0.65 - d.ch[`${g}[${a}]`][i] / d.gmax * H * 0.42; /* zero at 35 % from the bottom: the top is under the controls */ i === i0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); });
  // ticks
  const st = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 30, 60, 120].find(s => s > PB.span / 8) || 120;
  c.fillStyle = css("--ink2"); c.font = "10px system-ui"; c.strokeStyle = css("--ink2"); c.lineWidth = 1;
  for (let tt = Math.ceil(t0 / st) * st; tt <= t1; tt += st) { const x = X(tt); c.beginPath(); c.moveTo(x, H); c.lineTo(x, H - 5); c.stroke(); c.fillText(`${+tt.toFixed(1)}s`, x + 2, H - 4); }
  c.strokeStyle = css("--accent"); c.lineWidth = 2.5; c.beginPath(); c.moveTo(W / 2, 0); c.lineTo(W / 2, H); c.stroke();
  c.fillStyle = css("--accent"); c.beginPath(); c.moveTo(W / 2 - 6, 0); c.lineTo(W / 2 + 6, 0); c.lineTo(W / 2, 7); c.closePath(); c.fill();
  $("pbTime").textContent = `${PB.t.toFixed(2)} / ${d.dur.toFixed(1)} s`;
}

// ---------- 3D viewer ----------
function mountViewer() {
  const el = $("viewer"); el.hidden = false;
  const seg = (id, opts, cur) => `<span class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;
  const SH = [["body", "Body & arms"], ["props", "Props"], ["labels", "Motor labels"], ["thrust", "Thrust bars"], ["grid", "Ground grid"], ["axes", "Body axes"],
              ["hud", "Rate HUD"], ["acc", "Shake vector"], ["legend", "Speed legend"]];
  el.innerHTML = `<div class="viewer"><canvas id="v3d" aria-label="Animated 3D quad attitude"></canvas>
    <div class="vpanel">
      <div class="vrow"><span data-tip="v_src">Rotation from</span>${seg("vsrc", [["filt", "Filtered gyro"], ["raw", "Raw gyro"]], VS.src)}</div>
      <div class="vrow"><span data-tip="v_cam">Camera</span>${seg("vcam", [["heading", "Follow heading"], ["world", "World"], ["chase", "3rd person"], ["flight", "Flight path"]], VS.cam)}<button id="vreset" class="btn sm ghost">Reset view</button></div>
      <label class="vrow"><span data-tip="v_wobble">Wobble <b id="vwobV">${fmtG(VS.wobble)}</b></span><input id="vwob" type="range" min="0" max="4" step="0.01" value="${posOf(VS.wobble)}"></label>
      <label class="vrow"><span data-tip="v_shake">Shake <b id="vshkV">${fmtG(VS.shake)}</b></span><input id="vshk" type="range" min="0" max="4" step="0.01" value="${posOf(VS.shake)}"></label>
      <label class="vrow" id="vpsRow"><span data-tip="v_path">Path scale <b id="vpsV">${VS.pscale.toFixed(2)}×</b></span><input id="vps" type="range" min="0.05" max="2" step="0.05" value="${VS.pscale}"></label>
      <div class="vrow"><span class="hint" id="vscale">1× = true size on a ${craftInch()}″ (${wheelbaseMM()} mm) quad</span><button id="vreal" class="btn sm ghost" data-tip="v_real">1× real</button></div>
      <div class="vrow col"><span data-tip="v_show">Show</span><span class="chips" id="vshow">${SH.map(([k, l]) => chip(k, l, VS.show[k])).join("")}</span></div>
      <div class="hint">drag to turn the view · scroll to zoom · double-click resets</div>
    </div></div>`;
  $("vsrc").onclick = e => { const v = e.target.dataset.v; if (v) { VS.src = v; saveVS(); for (const id of ["vsrc", "pbsrc"]) if ($(id)) [...$(id).children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); PB.dirty = true; } };
  $("vcam").onclick = e => { const v = e.target.dataset.v; if (v) { VS.cam = v; saveVS(); [...$("vcam").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); PB.dirty = true; } };
  const snap = g => Math.abs(g - 1) < 0.06 ? 1 : g;  // magnetic 1× detent
  $("vwob").oninput = e => { VS.wobble = snap(gainOf(+e.target.value)); $("vwobV").textContent = fmtG(VS.wobble); saveVS(); PB.dirty = true; };
  $("vshk").oninput = e => { VS.shake = snap(gainOf(+e.target.value)); $("vshkV").textContent = fmtG(VS.shake); saveVS(); PB.dirty = true; };
  $("vreal").onclick = () => { VS.wobble = VS.shake = 1; $("vwob").value = $("vshk").value = 1; $("vwobV").textContent = $("vshkV").textContent = "1.0×"; saveVS(); PB.dirty = true; };
  $("vshow").onclick = e => { const b = e.target.closest(".chip"); if (!b) return; const k = b.dataset.k; VS.show[k] = !VS.show[k]; b.classList.toggle("on", VS.show[k]); saveVS(); PB.dirty = true; };
  $("vps").oninput = e => { VS.pscale = +e.target.value; $("vpsV").textContent = VS.pscale.toFixed(2) + "×"; saveVS(); PB.dirty = true; };
  const resetCam = () => { VS.az = VDEF.az; VS.el = VDEF.el; VS.dist = VDEF.dist; PB.dirty = true; };
  $("vreset").onclick = resetCam;
  const cv = $("v3d"); let drag = null;
  cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, az: VS.az, el: VS.el }; cv.setPointerCapture(e.pointerId); };
  cv.onpointermove = e => { if (!drag) return; VS.az = drag.az - (e.clientX - drag.x) * 0.01; VS.el = Math.max(-1.2, Math.min(1.45, drag.el + (e.clientY - drag.y) * 0.01)); PB.dirty = true; };
  cv.onpointerup = cv.onpointercancel = () => drag = null;
  cv.onwheel = e => { e.preventDefault(); VS.dist = Math.max(2, Math.min(12, VS.dist * 1.1 ** Math.sign(e.deltaY))); PB.dirty = true; };
  cv.ondblclick = resetCam;
  PB.blade = [0, 0, 0, 0];
}
function unmountViewer() { $("viewer").hidden = true; $("viewer").innerHTML = ""; }

// quaternion / vector helpers
const qrot = (q, i, v) => { const w = q[i], x = q[i + 1], y = q[i + 2], z = q[i + 3];
  return [(1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2],
          2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2],
          2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2]]; };
// position at log time t (linear between samples), scaled to model units
function posInterp(d, t, s, on) { if (!on || !d.pos) return [0, 0, 0];
  const T = d.t, j = Math.max(1, Math.min(d.n - 1, idxAt(t))), f = Math.max(0, Math.min(1, (t - T[j - 1]) / ((T[j] - T[j - 1]) || 1)));
  return [0, 1, 2].map(k => (d.pos[k][j - 1] + (d.pos[k][j] - d.pos[k][j - 1]) * f) * s); }
// attitude at log time t: normalised lerp between the two neighbouring samples (sign-aligned)
function quatAt(Q, d, t, i) { const j = Math.max(1, Math.min(d.n - 1, i)), T = d.t, f = Math.max(0, Math.min(1, (t - T[j - 1]) / ((T[j] - T[j - 1]) || 1)));
  const a = 4 * (j - 1), b = 4 * j, sg = Q[a] * Q[b] + Q[a + 1] * Q[b + 1] + Q[a + 2] * Q[b + 2] + Q[a + 3] * Q[b + 3] < 0 ? -1 : 1;
  const r = [0, 1, 2, 3].map(k => Q[a + k] * (1 - f) + sg * Q[b + k] * f), n = Math.hypot(...r) || 1; return r.map(v => v / n); }
// rotate v by the smallest rotation that takes world-up (0,0,1) to unit vector u (Rodrigues)
function tiltTo(v, u) { const ax = [-u[1], u[0], 0], s = Math.hypot(ax[0], ax[1]), c = u[2]; if (s < 1e-6) return v;
  const k = [ax[0] / s, ax[1] / s, 0], kv = k[0] * v[0] + k[1] * v[1], cr = [k[1] * v[2], -k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
  return [0, 1, 2].map(j => v[j] * c + cr[j] * s + k[j] * kv * (1 - c)); }
const smallRot = (a, v) => [v[0] + a[1] * v[2] - a[2] * v[1], v[1] + a[2] * v[0] - a[0] * v[2], v[2] + a[0] * v[1] - a[1] * v[0]];  // v + a×v

// o: { src, cam, wobble, shake, show, az, el, dist, blade:[4], spin:bool, dt, hudText:bool }
function drawViewer(cv = $("v3d"), t = PB.t, o = null) {
  if (!cv || !PB.d) return;
  if (!o) o = Object.assign(VS, { blade: PB.blade || (PB.blade = [0, 0, 0, 0]), spin: PB.playing, dt: (PB.frameDt || 0) * PB.speed, dtReal: PB.frameDt, hudText: true });
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0);
  c.fillStyle = css("--page"); c.fillRect(0, 0, W, H);
  const d = PB.d, i = idxAt(t), wob = d.wob[o.src], sh = o.show, qi = 0, q = quatAt(d.q[o.src], d, t, i);
  // cameras: "world" = fixed camera, rotation only · "heading" = rotation only, view turns with the quad's heading
  //          "chase" = 3rd person behind the quad, spring-lagged, quad moves through space · "flight" = fixed direction, quad moves, trail
  const fx = qrot(q, qi, [1, 0, 0]), heading = Math.atan2(fx[1], fx[0]);
  const psi = o.cam === "heading" ? heading : 0, cp = Math.cos(-psi), sp = Math.sin(-psi);
  const yawFix = v => psi ? [cp * v[0] - sp * v[1], sp * v[0] + cp * v[1], v[2]] : v;
  const moving = (o.cam === "chase" || o.cam === "flight") && d.pos;
  const pS = uPerM() * (o.pscale ?? 1) * (o.cam === "flight" ? 0.35 : 1);          // metres → model units (flight view: scaled down)
  const posAt = k => moving ? [d.pos[0][k] * pS, d.pos[1][k] * pS, d.pos[2][k] * pS] : [0, 0, 0];
  const pw = moving ? posInterp(d, t, pS, true) : [0, 0, 0];   // interpolated: smooth in slow motion
  const wa = [0, 1, 2].map(a => wob[a][i] * (o.wobble - 1));  // attitude already holds 1× of it: 0 = smoothed, 1 = real, >1 exaggerated
  const soft = x => 1.2 * Math.tanh(x / 1.2);  // keeps huge (high-gain) jolts on screen; <2% effect below 0.3 units (~50 mm at 1×)
  const shk = qrot(q, qi, [0, 1, 2].map(a => soft(d.disp[a][i] * uPerM() * o.shake)));
  const body = v => { const r = qrot(q, qi, o.wobble !== 1 ? smallRot(wa, v) : v); return yawFix([r[0] + shk[0] + pw[0], r[1] + shk[1] + pw[1], r[2] + shk[2] + pw[2]]); };
  const realMM = Math.hypot(d.disp[0][i], d.disp[1][i], d.disp[2][i]) * 1000, realDeg = Math.hypot(wob[0][i], wob[1][i], wob[2][i]) * 180 / Math.PI;
  // camera: eye E looking at target T
  const sph = (az, el, r) => [r * Math.cos(el) * Math.cos(az), r * Math.cos(el) * Math.sin(az), r * Math.sin(el)];
  let E, T;
  const cs = o.camS || (o.camS = {}), dtc = Math.min(0.1, Math.max(0.001, o.dtReal ?? 0.016));
  // critically damped spring with velocity feed-forward: follows smoothly, lags only on changes (turns, jolts), never drifts behind
  const spring = (key, goal, w) => { let st = cs[key];
    if (!st || st.cam !== o.cam || Math.hypot(goal[0] - st.x[0], goal[1] - st.x[1], goal[2] - st.x[2]) > 400 || Math.abs(t - st.t) > 1) st = cs[key] = { x: goal.slice(), v: [0, 0, 0], g: goal.slice(), cam: o.cam, t };
    // runs in log time (like the chase camera): in slow motion the goal moves slower per real second, and integrating with
    // real-time steps while feeding forward log-time velocity made the camera run ahead of the quad
    const dts = Math.abs(t - st.t);
    if (dts < 1e-6) return st.x;                       // paused: hold
    const h = Math.min(0.1, dts), gv = [0, 1, 2].map(a => (goal[a] - st.g[a]) / dts);
    const nsub = Math.max(1, Math.ceil(h / 0.01)), hs = h / nsub;   // sub-steps keep the spring stable at any frame rate
    for (let k = 0; k < nsub; k++) for (let a = 0; a < 3; a++) {
      const g_ = st.g[a] + (goal[a] - st.g[a]) * (k + 1) / nsub, acc = w * w * (g_ - st.x[a]) + 2 * w * (gv[a] - st.v[a]); st.v[a] += acc * hs; st.x[a] += st.v[a] * hs; }
    st.g = goal.slice(); st.t = t;
    return st.x; };
  let U = [0, 0, 1];   // camera up vector (world up, except the chase camera which banks a little with the quad)
  if (o.cam === "chase") {
    // 3rd-person chase: sits well behind and above, stays close to level. All smoothing runs in log time, so it is the
    // same at any playback speed and frame rate, and a seek or a big jump re-initialises it.
    const dtl = t - (cs.ct ?? -1e9), zb = qrot(q, qi, [0, 0, 1]);
    const tp = posInterp(d, t, pS, moving);                       // sub-sample position: no stair-steps in slow motion
    if (!(dtl >= 0 && dtl < 0.5)) { cs.yaw = heading; cs.up = [0, 0, 1]; }
    else if (dtl > 0) {
      // heading: only trusted while the nose points somewhere horizontal and the quad is upright, so flips, rolls and
      // vertical punches do not swing the camera round (a backflip points the nose backwards half-way through)
      const hz_ = Math.hypot(fx[0], fx[1]), conf = Math.min(1, hz_ / 0.5) * Math.max(0, Math.min(1, zb[2] * 2.5));
      let dy = heading - cs.yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
      const step = dy * (1 - Math.exp(-dtl * conf / 0.5)), mx = 2.6 * dtl;          // ≤ 150 °/s: yaw spins don't whip the camera round
      cs.yaw += Math.max(-mx, Math.min(mx, step));
      // camera tilt: a quarter of the way towards the quad's up axis, low-passed. Never flips (|0.78·Z + 0.22·zb| ≥ 0.56),
      // so a roll or flip shows as a ~15° bank/nod that eases back
      const k = 0.22, goal = [k * zb[0], k * zb[1], 1 - k + k * zb[2]], a = 1 - Math.exp(-dtl / 0.18);
      cs.up = cs.up.map((v, j) => v + (goal[j] - v) * a);
    }
    cs.ct = t;
    const un = Math.hypot(...cs.up); U = cs.up.map(v => v / un);
    const az = cs.yaw + Math.PI + (o.az - VDEF.az), el = 0.26 + (o.el - (o.el0 ?? VDEF.el)), R = o.dist * 2.1;
    let off = [Math.cos(az) * R * Math.cos(el), Math.sin(az) * R * Math.cos(el), R * Math.sin(el)];
    off = tiltTo(off, U);                                          // follow the bank / nod a little
    // rigid offset from the (smooth, integrated) path: constant distance, the quad never runs into the lens
    T = tp; E = [T[0] + off[0], T[1] + off[1], T[2] + off[2]];
    cs.E = E; cs.T = T; cs.U = U;   // last camera pose (inspection / tests)
  } else if (o.cam === "flight") {
    // locked on the (sub-sample interpolated) position: a lagging spring let the quad drift off-centre in turns,
    // and more so in slow motion; the trail already shows the motion
    T = moving ? posInterp(d, t, pS, true) : pw; const off = sph(o.az, o.el, o.dist * 3.2); E = [T[0] + off[0], T[1] + off[1], T[2] + off[2]];
    cs.tgt = { x: T };
  } else { T = [0, 0, 0]; E = sph(o.az, o.el, o.dist); }
  const Cv = [E[0] - T[0], E[1] - T[1], E[2] - T[2]], C = E;
  const n = Math.hypot(...Cv), f = Cv.map(v => -v / n), rr = (() => { const r = [f[1] * U[2] - f[2] * U[1], f[2] * U[0] - f[0] * U[2], f[0] * U[1] - f[1] * U[0]], l = Math.hypot(...r) || 1; return r.map(v => v / l); })();
  const u = [rr[1] * f[2] - rr[2] * f[1], rr[2] * f[0] - rr[0] * f[2], rr[0] * f[1] - rr[1] * f[0]], FL = Math.min(W, H) * 1.05;
  const P = p => { const v = [p[0] - C[0], p[1] - C[1], p[2] - C[2]], zc = v[0] * f[0] + v[1] * f[1] + v[2] * f[2];
    return [W / 2 + FL * (v[0] * rr[0] + v[1] * rr[1] + v[2] * rr[2]) / zc, H * 0.52 - FL * (v[0] * u[0] + v[1] * u[1] + v[2] * u[2]) / zc, zc]; };
  const ink = css("--ink"), ink2 = css("--ink2"), axis = css("--axis");
  // ground grid: around the camera target so it looks endless when the quad travels
  const line3 = (a, b) => {   // 3D segment with near-plane clipping
    let A = P(a), B = P(b); const zn = 0.15;
    if (A[2] < zn && B[2] < zn) return;
    if (A[2] < zn || B[2] < zn) { const ta = (zn - A[2]) / (B[2] - A[2]), m = [0, 1, 2].map(k => a[k] + (b[k] - a[k]) * ta); if (A[2] < zn) A = P(m); else B = P(m); }
    c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); };
  if (sh.grid) { c.lineWidth = 1; c.strokeStyle = css("--grid");
    const gs = moving ? pS * 2 : 0.6, N_ = moving ? 16 : 5, gz = moving ? (d.groundZ ?? -3) * pS : -1.2, cx = Math.round(T[0] / gs) * gs, cy = Math.round(T[1] / gs) * gs, R_ = gs * N_;
    for (let k = -N_; k <= N_; k++) { line3(yawFix([cx + k * gs, cy - R_, gz]), yawFix([cx + k * gs, cy + R_, gz])); line3(yawFix([cx - R_, cy + k * gs, gz]), yawFix([cx + R_, cy + k * gs, gz])); }
    if (o.cam === "world") { const N = P([3.2, 0, -1.2]); if (N[2] > .1) { c.fillStyle = css("--muted"); c.font = "11px system-ui"; c.fillText("N (start heading)", N[0] - 40, N[1]); } } }
  // flight path trail (last ~4 s) and shadow on the ground
  if (moving) {
    const fsd = d.n / d.dur, k0 = Math.max(0, i - Math.round(4 * fsd)), st_ = Math.max(1, Math.round(fsd / 60));
    c.lineWidth = 2; let prev = null;
    for (let k = k0; k <= i; k += st_) { const Pp = P(posAt(k)); if (Pp[2] > 0.1 && prev) { c.strokeStyle = rgba(css("--accent"), 0.1 + 0.6 * (k - k0) / Math.max(1, i - k0)); c.beginPath(); c.moveTo(prev[0], prev[1]); c.lineTo(Pp[0], Pp[1]); c.stroke(); } prev = Pp[2] > 0.1 ? Pp : null; }
    const gz = (d.groundZ ?? -3) * pS, Sh = P([pw[0], pw[1], gz]);
    if (Sh[2] > 0.1) { c.fillStyle = "rgba(0,0,0,0.25)"; c.beginPath(); c.ellipse(Sh[0], Sh[1], Math.max(3, 60 / Sh[2]), Math.max(1.5, 22 / Sh[2]), 0, 0, 7); c.fill(); }
  }
  const items = [];  // [depth, drawFn]
  const hz = [...Array(d.nm).keys()].map(m => d.ch[`mHz[${m}]`][i]), mp = [...Array(d.nm).keys()].map(m => d.ch[`m%[${m}]`][i]);
  // air particles (splash only): shed below each prop with the rotor's swirl, blown along the body's −z at a speed that follows
  // prop speed, then they slow down and break up: a curl-noise eddy field plus a random walk that grows with age spreads them
  // into a widening, swirling wake instead of straight streaks. Runs in log time, so slow motion slows them too.
  if (o.particles) {
    // Air particles: each prop pushes air out along the body's −z (its thrust axis). The jet speed at the disc follows
    // momentum theory, v ∝ √thrust, so a punch-out blasts air out ~2× faster than hover and a throttle chop barely does.
    // Particles inherit the quad's own velocity (they leave a moving rotor), carry the rotor swirl, then the still air
    // takes over: linear + quadratic drag relative to the air brakes the jet, curl-noise eddies and an age-growing random
    // walk mix it, so the wake slows, widens and breaks up. No gravity: it is air, not dust. Log time, so slow-mo slows it.
    const PS = o.parts || (o.parts = []), dtp = Math.max(0, Math.min(0.1, o.dt || 0)), zb = qrot(q, qi, [0, 0, 1]), LIFE = 1.6;
    const gauss = () => { let u = 0; for (let k = 0; k < 4; k++) u += Math.random(); return (u - 2) * 1.73; };
    const fsd = d.n / d.dur, i0 = Math.max(0, i - 1), i1 = Math.min(d.n - 1, i + 1), pa = posAt(i0), pb = posAt(i1);
    const vq = [0, 1, 2].map(k => (pb[k] - pa[k]) * fsd / Math.max(1, i1 - i0));          // quad velocity, model units/s
    const KV = 14;                                                                       // jet speed at full thrust (units/s)
    const thrustOf = m => Math.max(0, Math.min(1, (mp[m] ?? 0) / 100)) ** 1.4;           // thrust ~ command^1.4 (normalised)
    const step = (pt, h, T_) => {
      const [x, y, z] = pt.p, sc = 0.9, A = 0.8 * Math.min(1, pt.age * 2.5) * (0.3 + pt.th);   // eddies grow in as the jet breaks up
      const eddy = [Math.sin(sc * 1.7 * y + T_ * 1.3 + pt.ph) - Math.sin(sc * 1.3 * z + T_ * 0.9),
                    Math.sin(sc * 1.5 * z + T_ * 1.1 + pt.ph) - Math.sin(sc * 1.9 * x + T_ * 1.5),
                    Math.sin(sc * 1.6 * x + T_ * 0.7) - Math.sin(sc * 1.4 * y + T_ * 1.2 + pt.ph)];
      const sp = Math.hypot(...pt.v), dr = Math.exp(-h * (1.4 + 0.22 * sp)), sig = (0.3 + 2.4 * pt.age) * Math.sqrt(h);
      for (let a = 0; a < 3; a++) { pt.v[a] = pt.v[a] * dr + A * eddy[a] * h * 6 + gauss() * sig; pt.p[a] += pt.v[a] * h; }
    };
    if (dtp > 0) {
      const T_ = (o.ptime = (o.ptime || 0) + dtp);
      for (let k = PS.length - 1; k >= 0; k--) { const pt = PS[k]; pt.age += dtp; if (pt.age > LIFE) { PS.splice(k, 1); continue; } step(pt, dtp, T_); }
      MPOS.slice(0, d.nm).forEach(([x, y], m) => {
        const th = thrustOf(m), nNew = Math.floor((60 + 520 * th) * dtp + Math.random());   // more air moved at higher thrust
        for (let k = 0; k < nNew && PS.length < 1800; k++) {
          const a = Math.random() * 2 * Math.PI, r = 0.12 + Math.random() * 0.3, jet = KV * Math.sqrt(th) * (0.8 + Math.random() * 0.4);
          const sw = MSPIN[m] * 0.4 * jet, tg = qrot(q, qi, [-Math.sin(a) * sw, Math.cos(a) * sw, 0]);   // rotor swirl, tangential
          const pt = { p: body([x + r * Math.cos(a), y + r * Math.sin(a), -0.02]), age: 0, th, ph: Math.random() * 6.28,
                       v: [0, 1, 2].map(c => vq[c] - zb[c] * jet + tg[c] + (Math.random() - .5) * .25) };
          // born somewhere inside this frame: back-date it so a fast quad leaves a continuous wake, not clumps
          const f = Math.random() * dtp; for (let c = 0; c < 3; c++) pt.p[c] -= vq[c] * f;
          pt.age = f; step(pt, f, T_); PS.push(pt);
        } });
    }
    // bright, glowing specks: additive blending so dense wash reads as a light streak, fading with age
    const light = document.documentElement.dataset.theme === "light";
    c.save(); c.globalCompositeOperation = light ? "source-over" : "lighter";
    for (const pt of PS) { const Q = P(pt.p); if (Q[2] < 0.15) continue; const life = 1 - pt.age / LIFE;
      const rr = Math.max(1.3, Math.min(9, 16 / Q[2])) * (0.55 + 0.45 * life + 0.5 * (1 - life));   // puffs widen a little as they diffuse
      c.globalAlpha = Math.max(0, life * life * 0.85);
      c.fillStyle = light ? "#1c5cab" : life > 0.6 ? "#e8f6ff" : "#7cc4ff";
      c.beginPath(); c.arc(Q[0], Q[1], rr, 0, 7); c.fill();
      if (!light && rr > 2) { c.globalAlpha = Math.max(0, life * life * 0.2); c.beginPath(); c.arc(Q[0], Q[1], rr * 2.4, 0, 7); c.fill(); } }
    c.restore();
  }
  if (o.spin) o.blade.forEach((a, m) => o.blade[m] = a + MSPIN[m] * hz[m] * 0.02 * o.dt * 2 * Math.PI);
  const ctr = P(body([0, 0, 0]));
  if (sh.body) {
    MPOS.forEach(([x, y]) => { const A = ctr, B = P(body([x, y, 0])); items.push([(A[2] + B[2]) / 2, () => { c.strokeStyle = axis; c.lineWidth = Math.max(3, 40 / B[2]); c.lineCap = "round"; c.beginPath(); c.moveTo(A[0], A[1]); c.lineTo(B[0], B[1]); c.stroke(); }]); });
    const plate = [[0.32, 0.16, 0.05], [0.32, -0.16, 0.05], [-0.3, -0.16, 0.05], [-0.3, 0.16, 0.05]].map(p => P(body(p)));
    items.push([ctr[2] - 0.01, () => { c.fillStyle = css("--surface"); c.strokeStyle = ink2; c.lineWidth = 1.5; c.beginPath(); plate.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); c.stroke(); }]);
    const nose = [[0.5, 0, 0.06], [0.3, 0.09, 0.06], [0.3, -0.09, 0.06]].map(p => P(body(p)));
    items.push([ctr[2] - 0.02, () => { c.fillStyle = css("--accent"); c.beginPath(); nose.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); }]);
  }
  MPOS.slice(0, d.nm).forEach(([x, y], m) => {
    const col = spdColor(hz[m] / d.fmax), M = P(body([x, y, 0.04]));
    if (sh.props) {
      const ring = [...Array(28).keys()].map(k => { const a = k / 28 * 2 * Math.PI; return P(body([x + 0.42 * Math.cos(a), y + 0.42 * Math.sin(a), 0.08])); });
      const bl = [0, Math.PI].map(ph => P(body([x + 0.4 * Math.cos(o.blade[m] + ph), y + 0.4 * Math.sin(o.blade[m] + ph), 0.085])));
      items.push([M[2] - 0.05, () => { c.fillStyle = col.replace("rgb", "rgba").replace(")", ",0.22)"); c.strokeStyle = col; c.lineWidth = 1.5; c.beginPath(); ring.forEach((p, k) => k ? c.lineTo(p[0], p[1]) : c.moveTo(p[0], p[1])); c.closePath(); c.fill(); c.stroke();
        c.strokeStyle = ink; c.lineWidth = 2; c.globalAlpha = 0.6; c.beginPath(); c.moveTo(bl[0][0], bl[0][1]); c.lineTo(bl[1][0], bl[1][1]); c.stroke(); c.globalAlpha = 1; }]);
    }
    items.push([M[2] - 0.06, () => { c.fillStyle = col; c.strokeStyle = ink; c.lineWidth = 1; c.beginPath(); c.arc(M[0], M[1], Math.max(4, 70 / M[2]), 0, 7); c.fill(); c.stroke(); }]);
    if (sh.thrust) { const T = P(body([x, y, 0.1 + mp[m] / 100 * 1.1])), B = P(body([x, y, 0.1]));
      items.push([M[2] - 0.07, () => { c.strokeStyle = col; c.lineWidth = 4; c.beginPath(); c.moveTo(B[0], B[1]); c.lineTo(T[0], T[1]); c.stroke(); }]); }
    if (sh.labels) items.push([-1e9, () => { c.font = "600 12px system-ui"; c.fillStyle = ink; c.textAlign = "center"; c.fillText(`M${m + 1}`, M[0], M[1] - 16);
      c.font = "11px system-ui"; c.fillStyle = ink2; c.fillText(`${hz[m].toFixed(0)} Hz · ${mp[m].toFixed(0)}%`, M[0], M[1] + 24); c.textAlign = "left"; }]);
  });
  if (sh.axes) [[1, 0, 0], [0, 1, 0], [0, 0, 1]].forEach((v, a) => { const E = P(body(v.map(x => x * 0.7))); items.push([E[2], () => { c.strokeStyle = axc(a); c.lineWidth = 2.5; c.beginPath(); c.moveTo(ctr[0], ctr[1]); c.lineTo(E[0], E[1]); c.stroke();
    c.fillStyle = axc(a); c.font = "11px system-ui"; c.fillText(AX[a].toLowerCase(), E[0] + 4, E[1]); }]); });
  if (sh.acc) { const a = [0, 1, 2].map(k => d.accHP[k][i]), E = P(body(a.map(v => v * 0.6)));
    items.push([-1e8, () => { c.strokeStyle = css("--serious"); c.lineWidth = 2.5; c.beginPath(); c.moveTo(ctr[0], ctr[1]); c.lineTo(E[0], E[1]); c.stroke(); c.beginPath(); c.arc(E[0], E[1], 3, 0, 7); c.fillStyle = css("--serious"); c.fill(); }]); }
  items.sort((a, b) => b[0] - a[0]).forEach(([, fn]) => fn());
  // 2D overlays
  c.font = "12px system-ui"; c.fillStyle = ink2;
  if (o.hudText) c.fillText(`t ${t.toFixed(2)} s · throttle ${d.ch.thr[i].toFixed(0)}% · ${o.src === "raw" ? "raw" : "filtered"} gyro`, 12, 20);
  c.fillStyle = css("--muted"); c.font = "11px system-ui";
  if (o.hudText) c.fillText(`vibration shake ${realMM < 0.1 ? (realMM * 1000).toFixed(0) + " µm" : realMM.toFixed(2) + " mm"} (shown ${fmtG(o.shake)}) · wobble ${realDeg.toFixed(2)}° (shown ${fmtG(o.wobble)}) · ${craftInch()}″ quad, ${wheelbaseMM()} mm`, 12, 38);
  if (sh.hud) { const g = o.src === "raw" ? "gyroRaw" : "gyro", bw = Math.min(220, W * 0.35), x0 = 12, y0 = H - 72, R = d.gmax;
    [0, 1, 2].forEach(a => { const y = y0 + a * 22, gv = d.ch[`${g}[${a}]`][i], sv = d.ch[`sp[${a}]`][i], X = v => x0 + 44 + bw / 2 + Math.max(-1, Math.min(1, v / R)) * bw / 2;
      c.fillStyle = ink2; c.font = "11px system-ui"; c.fillText(AX[a], x0, y + 4);
      c.fillStyle = css("--grid"); c.fillRect(x0 + 44, y - 4, bw, 8);
      c.fillStyle = axc(a); const g0 = X(0), g1 = X(gv); c.fillRect(Math.min(g0, g1), y - 4, Math.abs(g1 - g0), 8);
      c.fillStyle = ink; c.fillRect(X(sv) - 1, y - 8, 2, 16);
      c.fillStyle = ink2; c.fillText(`${gv.toFixed(0)} / ${sv.toFixed(0)} °/s`, x0 + 52 + bw, y + 4); });
    c.fillStyle = css("--muted"); c.font = "10px system-ui"; c.fillText("bar = gyro, tick = setpoint", x0 + 44, y0 - 12); }
  if (sh.legend) { const lw = 120, x0 = W - lw - 16, y0 = W < 760 ? 46 : 14, gr = c.createLinearGradient(x0, 0, x0 + lw, 0);
    SPD.forEach((s, k) => gr.addColorStop(k / (SPD.length - 1), s)); c.fillStyle = gr; c.fillRect(x0, y0 + 14, lw, 8);
    c.fillStyle = ink2; c.font = "10px system-ui"; c.fillText("motor speed", x0, y0 + 8); c.fillText("0", x0, y0 + 34); c.textAlign = "right"; c.fillText(`${d.fmax.toFixed(0)} Hz`, x0 + lw, y0 + 34); c.textAlign = "left"; }
}

// ---------- loop ----------
function frame(now) {
  requestAnimationFrame(frame);   // re-arm first: an error below never stops playback
  PB.frameDt = Math.min(2, (now - (PB.last || now)) / 1000); PB.last = now;   // real time, even when heavy charts slow the frame rate
  if (PB.playing && PB.d) { PB.t += PB.frameDt * PB.speed; if (PB.t >= PB.d.dur) { PB.t = PB.d.dur; PB.playing = false; syncPlayBtn(); } PB.dirty = true; }
  if (PB.dirty && PB.d) { PB.dirty = false; if (!$("player").hidden) drawStrip(); if (!$("viewer").hidden && !S.demo) drawViewer(); for (const fn of Object.values(PB.hooks)) try { fn(PB.t, now); } catch (e) { console.error(e); } }
}
requestAnimationFrame(frame);
addEventListener("keydown", e => { if (e.target.closest("input,select,textarea") || $("player").hidden) return;
  if (e.code === "Space") { e.preventDefault(); togglePlay(); } else if (e.code === "ArrowRight") seek(PB.t + (e.shiftKey ? 5 : 0.2)); else if (e.code === "ArrowLeft") seek(PB.t - (e.shiftKey ? 5 : 0.2)); });

// ---------- dock resize: drag the grip on the dock's top edge ----------
(() => {
  const g = $("dockGrip"), set = h => { document.documentElement.style.setProperty("--striph", h + "px"); PB.dirty = true; };
  let h0 = store.get("pb.h", 56); set(h0);
  let drag = null;
  g.onpointerdown = e => { drag = { y: e.clientY, h: h0, mh: parseFloat($("main").style.height) || $("main").offsetHeight }; g.setPointerCapture(e.pointerId); g.classList.add("on"); };
  g.onpointermove = e => { if (!drag) return; h0 = Math.round(Math.max(32, Math.min(Math.min(420, innerHeight * 0.6), drag.h - (e.clientY - drag.y)))); set(h0);
    if ($("main").style.display !== "none") $("main").style.height = Math.max(220, drag.mh - (h0 - drag.h)) + "px"; };
  const end = () => { if (!drag) return; drag = null; g.classList.remove("on"); store.set("pb.h", h0); if ($("main").layout) Plotly.Plots.resize("main"); };
  g.onpointerup = g.onpointercancel = end;
  g.ondblclick = () => { h0 = 56; set(h0); store.set("pb.h", h0); if (S.meta) render(); };
})();
