// Idle screen before a log is opened: a quad flies a procedurally generated freestyle run through 3D space.
// Rigid-body physics: body rates from a trick script (or an attitude controller while cruising), thrust along the body
// z axis, gravity and quadratic drag → velocity → position. Motor speeds follow thrust + mixing, the frame vibrates
// in proportion to throttle. Same data layout as a real log, so the real viewer draws it.
function makeDemo(seed = Date.now() % 100000, dur = 150) {
  let s_ = seed; const rnd = () => (s_ = (s_ * 16807) % 2147483647) / 2147483647;
  const fs = 250, dt = 1 / fs, n = Math.round(dur * fs), D = Math.PI / 180, g = 9.81, TMAX = 4.2 * g, CD = 0.035;
  const pulse = (deg, T) => u => deg / T * (1 - Math.cos(2 * Math.PI * u));   // raised-cosine rate profile, integrates to deg
  // trick library: list of [duration s, roll(u), pitch(u), yaw(u), throttle 0..1 | "hold"]
  const TR = {
    "roll": () => [[0.25, null, null, null, 0.45], [0.55, pulse(rnd() < .5 ? 360 : -360, 0.55), null, null, 0.35], [0.2, null, null, null, 0.55]],
    "double roll": () => [[0.2, null, null, null, 0.5], [0.9, pulse(720, 0.9), null, null, 0.35]],
    "backflip": () => [[0.2, null, null, null, 0.08], [0.55, null, pulse(-360, 0.55), null, 0.12], [0.45, null, null, null, 0.85]],
    "frontflip": () => [[0.2, null, null, null, 0.08], [0.6, null, pulse(360, 0.6), null, 0.12], [0.45, null, null, null, 0.85]],
    "power loop": () => [[0.4, null, null, null, 0.8], [2.0, null, pulse(-360, 2.0), null, 0.72], [0.3, null, null, null, 0.45]],
    "split-S": () => [[0.3, null, null, null, 0.3], [0.45, pulse(180, 0.45), null, null, 0.2], [1.2, null, pulse(-180, 1.2), null, 0.65]],
    "matty flip": () => [[0.3, null, null, null, 0.6], [0.8, null, pulse(360, 0.8), null, u => u > 0.35 && u < 0.7 ? 0.85 : 0.2]],
    "yaw spin": () => [[1.0, null, null, pulse(rnd() < .5 ? 540 : -540, 1.0), "hold"]],
    "inverted yaw spin": () => [[0.4, pulse(180, 0.4), null, null, 0.15], [0.7, null, null, pulse(360, 0.7), 0.05], [0.4, pulse(180, 0.4), null, null, 0.4], [0.4, null, null, null, 0.9]],
    "rewind": () => [[0.35, pulse(180, 0.35), null, null, 0.2], [0.5, null, null, pulse(180, 0.5), 0.1], [0.35, pulse(-180, 0.35), null, null, 0.8]],
    "barrel roll": () => [[1.1, pulse(360, 1.1), pulse(-60, 1.1), null, 0.55]],
    "juicy flick": () => [[0.35, null, pulse(-120, 0.35), null, 0.25], [0.35, null, pulse(120, 0.35), null, 0.7]],
    "triple roll": () => [[0.2, null, null, null, 0.55], [1.2, pulse(rnd() < .5 ? 1080 : -1080, 1.2), null, null, 0.4], [0.25, null, null, null, 0.6]],
    "double flip": () => [[0.2, null, null, null, 0.1], [0.95, null, pulse(-720, 0.95), null, 0.1], [0.5, null, null, null, 0.85]],
    "trippy spin": () => [[0.2, null, null, null, 0.3], [1.4, null, pulse(-360, 1.4), pulse(720, 1.4), 0.25], [0.4, null, null, null, 0.8]],
    "tornado": () => [[1.6, pulse(720, 1.6), null, pulse(360, 1.6), 0.6]],
    "power dive": () => [[0.25, null, null, null, 0.05], [0.4, pulse(180, 0.4), null, null, 0.05], [0.6, null, pulse(-120, 0.6), null, 0.05], [0.9, null, null, null, 0.05],
                         [0.4, pulse(-180, 0.4), null, null, 0.3], [0.6, null, null, null, 0.95]],
    "knife edge": () => [[0.3, pulse(90, 0.3), null, null, 0.55], [0.9, null, null, pulse(rnd() < .5 ? 90 : -90, 0.9), 0.75], [0.3, pulse(-90, 0.3), null, null, 0.55]],
    "rubik's cube": () => [[0.4, pulse(360, 0.4), null, null, 0.3], [0.4, null, pulse(-360, 0.4), null, 0.3], [0.4, pulse(-360, 0.4), null, null, 0.3], [0.4, null, pulse(360, 0.4), null, 0.6]],
    "sbang": () => [[0.3, null, null, null, 0.9], [0.5, null, pulse(-180, 0.5), null, 0.15], [0.3, pulse(180, 0.3), null, null, 0.4], [0.35, null, null, null, 0.9]],
    "stall tumble": () => [[0.3, null, null, null, 0.85], [1.1, pulse(160, 1.1), pulse(-220, 1.1), pulse(120, 1.1), 0.02], [0.5, null, null, null, 0.9]],
  };
  const names = Object.keys(TR);
  // quaternion helpers
  const qmul = (a, b) => [a[0] * b[0] - a[1] * b[1] - a[2] * b[2] - a[3] * b[3], a[0] * b[1] + a[1] * b[0] + a[2] * b[3] - a[3] * b[2],
                          a[0] * b[2] - a[1] * b[3] + a[2] * b[0] + a[3] * b[1], a[0] * b[3] + a[1] * b[2] - a[2] * b[1] + a[3] * b[0]];
  const rot = (q, v) => { const [w, x, y, z] = q; return [(1 - 2 * (y * y + z * z)) * v[0] + 2 * (x * y - w * z) * v[1] + 2 * (x * z + w * y) * v[2],
    2 * (x * y + w * z) * v[0] + (1 - 2 * (x * x + z * z)) * v[1] + 2 * (y * z - w * x) * v[2], 2 * (x * z - w * y) * v[0] + 2 * (y * z + w * x) * v[1] + (1 - 2 * (x * x + y * y)) * v[2]]; };
  const ch = {}, mk = k => (ch[k] = new Float32Array(n));
  ["t", "thr"].forEach(mk); for (let a = 0; a < 3; a++) ["gyro", "gyroRaw", "sp", "acc", "wob", "wobRaw", "disp"].forEach(k => mk(`${k}[${a}]`));
  for (let m = 0; m < 4; m++) { mk(`m%[${m}]`); mk(`mHz[${m}]`); }
  const qa = new Float32Array(4 * n), pos = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  const GROUND = -9, CLEAR = 2.5;   // ground plane (m below the start height) and the clearance every trick must keep
  // ---- one physics step and the cruise autopilot, shared by the real run and the look-ahead ----
  const cruise = (st, zRef) => {        // level wings, ~28° nose-down, steer home, hold zRef (climbs harder when low)
    const home = Math.hypot(st.p[0], st.p[1]), hd = Math.atan2(st.v[1], st.v[0]), wantYaw = home > 45 ? Math.atan2(-st.p[1], -st.p[0]) : hd;
    const zb = rot(st.q, [0, 0, 1]), fwd = rot(st.q, [1, 0, 0]), yawNow = Math.atan2(fwd[1], fwd[0]);
    let dy = wantYaw - yawNow; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    const low = st.p[2] < zRef - 2, tilt = (low ? 12 : 28) * D;   // when well below the target height, pitch up and climb
    const tq = [Math.cos(yawNow) * Math.sin(tilt), Math.sin(yawNow) * Math.sin(tilt), Math.cos(tilt)];
    const e = rot([st.q[0], -st.q[1], -st.q[2], -st.q[3]], [zb[1] * tq[2] - zb[2] * tq[1], zb[2] * tq[0] - zb[0] * tq[2], zb[0] * tq[1] - zb[1] * tq[0]]);
    const inv = zb[2] < 0 ? 1 : 0;
    return [Math.max(-600, Math.min(600, 900 * e[0] + inv * 400)), Math.max(-600, Math.min(600, 900 * e[1])), Math.max(-300, Math.min(300, 250 * dy))];
  };
  const hold = (st, zRef) => { const zb = rot(st.q, [0, 0, 1]), up = Math.max(0.25, zb[2]), need = (g + 1.6 * (zRef - st.p[2]) - 1.2 * st.v[2]) / (TMAX * up);
    return Math.max(0.05, Math.min(0.95, zb[2] > 0.2 ? need : 0.15)); };
  const phys = (st, rates, thr) => {
    st.thrS += (thr - st.thrS) * 0.12;
    const w = rates.map(r => r * D), h = 0.5 * dt, dq = qmul(st.q, [0, w[0], w[1], w[2]]);
    st.q = st.q.map((c, k) => c + h * dq[k]); const qn = Math.hypot(...st.q); st.q = st.q.map(c => c / qn);
    const zB = rot(st.q, [0, 0, 1]), sp_ = Math.hypot(...st.v), acc = [0, 1, 2].map(k => TMAX * st.thrS * zB[k] - (k === 2 ? g : 0) - CD * sp_ * st.v[k]);
    for (let k = 0; k < 3; k++) { st.v[k] += acc[k] * dt; st.p[k] += st.v[k] * dt; }
    return acc;
  };
  const planStep = (st, pl, zRef) => {   // one step of a trick script; returns [rates, thr] and advances the script
    const [T, r, pt, y, th] = pl.seg[0], u = pl.tk / T;
    const rates = [r ? r(u) : 0, pt ? pt(u) : 0, y ? y(u) : 0];
    const thr = th === "hold" ? hold(st, zRef) : typeof th === "function" ? th(u) : th;
    pl.tk += dt; if (pl.tk >= T) { pl.seg.shift(); pl.tk = 0; }
    return [rates, thr];
  };
  // look-ahead: fly the trick + 1.5 s of recovery on a copy of the state; lowest height reached
  const lowest = (st, seg, zRef) => {
    const c = { q: st.q.slice(), v: st.v.slice(), p: st.p.slice(), thrS: st.thrS }, pl = { seg: seg.slice(), tk: 0 };
    let zmin = c.p[2];
    while (pl.seg.length) { const [r, t] = planStep(c, pl, zRef); phys(c, r, t); zmin = Math.min(zmin, c.p[2]); }
    for (let k = 0; k < 1.5 * fs; k++) { phys(c, cruise(c, zRef), hold(c, zRef)); zmin = Math.min(zmin, c.p[2]); }
    return zmin;
  };
  const st = { q: [1, 0, 0, 0], v: [12, 0, 0], p: [0, 0, 0], thrS: 0.35 };
  let zRef = 0, pl = null, trick = null, cruiseLeft = 1.5, ratesPrev = [0, 0, 0];
  const vib = [0, 0, 0], wobS = [0, 0, 0], trk = new Int8Array(n);
  for (let i = 0; i < n; i++) {
    if (!pl && cruiseLeft <= 0) {
      // pick a trick that keeps CLEAR metres above the ground (checked by flying it ahead of time); if none fits, climb first
      for (let tries = 0; tries < 6 && !pl; tries++) {
        const nm = names[Math.floor(rnd() * names.length)], seg = TR[nm]();
        if (lowest(st, seg, zRef) > GROUND + CLEAR) { pl = { seg, tk: 0 }; trick = nm; }
      }
      if (!pl) { zRef = Math.min(zRef + 4, 25); cruiseLeft = 1.0; }
    }
    trk[i] = pl ? names.indexOf(trick) : -1;
    let rates, thr;
    if (pl) { [rates, thr] = planStep(st, pl, zRef); if (!pl.seg.length) { pl = null; cruiseLeft = 0.9 + rnd() * 1.6; } }
    else { cruiseLeft -= dt; rates = cruise(st, zRef); thr = hold(st, zRef); if (zRef > 0) zRef = Math.max(0, zRef - 0.4 * dt); }
    const acc = phys(st, rates, thr);
    if (st.p[2] < GROUND + 0.5) { st.p[2] = GROUND + 0.5; st.v[2] = Math.max(0, st.v[2]); }   // safety net, should never trigger
    const { q, p, thrS } = st;
    // vibration that grows with throttle (m) and a little rate wobble
    for (let k = 0; k < 3; k++) {
      vib[k] = 0.6 * vib[k] + (rnd() - 0.5) * (0.0006 + 0.0038 * thrS) * (k === 2 ? 1.4 : 1);
      wobS[k] = 0.9 * wobS[k] + (rnd() - 0.5) * (0.0004 + 0.0025 * thrS) * (k === 2 ? 0.4 : 1);
    }
    ch.t[i] = i * dt; ch.thr[i] = thrS * 100;
    const accB = rot([q[0], -q[1], -q[2], -q[3]], [acc[0], acc[1], acc[2] + g]);
    for (let k = 0; k < 3; k++) {
      const gy = rates[k] + wobS[k] * 400;
      ch[`gyro[${k}]`][i] = gy; ch[`gyroRaw[${k}]`][i] = gy + (rnd() - 0.5) * 30 * thrS; ch[`sp[${k}]`][i] = rates[k];
      ch[`acc[${k}]`][i] = accB[k] / g; ch[`wob[${k}]`][i] = ch[`wobRaw[${k}]`][i] = wobS[k]; ch[`disp[${k}]`][i] = vib[k];
      pos[k][i] = p[k];
    }
    const racc = [0, 1, 2].map(k => (rates[k] - ratesPrev[k]) / dt); ratesPrev = rates;
    [[-1, 1, -1], [-1, -1, 1], [1, 1, 1], [1, -1, -1]].forEach((mx, m) => {
      const c = Math.max(3, Math.min(100, thrS * 100 + (mx[0] * racc[0] + mx[1] * racc[1] + mx[2] * racc[2] * 0.5) * 0.0015));
      ch[`m%[${m}]`][i] = c; ch[`mHz[${m}]`][i] = 60 + 26 * Math.sqrt(c * 10);
    });
    qa.set(q, 4 * i);
  }
  const d = { n, nm: 4, t: ch.t, ch, dur: ch.t[n - 1], fmax: 360, gmax: 900, demo: true };
  d.q = { filt: qa, raw: qa };
  d.wob = { filt: [0, 1, 2].map(a => ch[`wob[${a}]`]), raw: [0, 1, 2].map(a => ch[`wobRaw[${a}]`]) };
  d.accHP = [0, 1, 2].map(a => highpass(ch[`acc[${a}]`], 100));
  d.disp = [0, 1, 2].map(a => ch[`disp[${a}]`]);
  d.pos = pos; d.groundZ = GROUND; d.trick = { names, idx: trk };
  return d;
}

const DEMO = { cam: store.get("demo.cam", "chase") };
function startDemo() {
  S.demo = true;
  PB.d = makeDemo(); PB.key = "demo"; PB.t = 0; PB.playing = true; PB.speed = 1; PB.hooks = {};
  document.body.classList.add("demo");
  $("controls").innerHTML = `<div class="hero"><h2>Drop a Betaflight blackbox log to start</h2>
    <p class="hint">.BBL / .BFL straight from the flight controller, or pick one above. Decoding takes a few seconds the first time, then it's cached.</p>
    <label class="btn">Choose a log…<input type="file" accept=".bbl,.bfl,.txt" hidden onchange="this.files[0] && upload(this.files[0])"></label></div>`;
  $("main").style.display = "none"; $("findings").innerHTML = ""; $("dash").hidden = true;
  const el = $("viewer"); el.hidden = false;
  const SPEEDS = [[0.1, "0.1×"], [0.25, "¼×"], [0.5, "½×"], [1, "1×"]];
  el.innerHTML = `<div class="demoview"><canvas id="v3d" aria-label="Animated FPV quad flying freestyle tricks"></canvas>
    <div class="demobar"><span class="seg" id="demoCam">${[["chase", "Chase"], ["world", "World"], ["flight", "Flight"]].map(([v, l]) => `<button data-v="${v}" class="${DEMO.cam === v ? "on" : ""}">${l}</button>`).join("")}</span>
      <button class="btn sm" id="demoPlay" title="Pause / play (space)">❚❚</button>
      <span class="seg" id="demoSpd" title="Animation speed">${SPEEDS.map(([v, l]) => `<button data-v="${v}" class="${DEMO.speed === v ? "on" : ""}">${l}</button>`).join("")}</span>
      <span class="chips" id="demoFx">${chip("parts", "Particles", DEMO.parts)}</span>
      <span class="hint demohint">drag = orbit · wheel = zoom · double-click = reset</span></div></div>`;
  $("demoCam").onclick = e => { const v = e.target.dataset.v; if (!v) return; DEMO.cam = v; store.set("demo.cam", v); [...$("demoCam").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); resetDemoView(); };
  const setSpd = () => { PB.speed = DEMO.paused ? 0 : DEMO.speed; $("demoPlay").textContent = DEMO.paused ? "▶" : "❚❚"; [...$("demoSpd").children].forEach(b => b.classList.toggle("on", +b.dataset.v === DEMO.speed)); };
  $("demoSpd").onclick = e => { const v = e.target.dataset.v; if (!v) return; DEMO.speed = +v; DEMO.paused = false; store.set("demo.speed", DEMO.speed); setSpd(); };
  $("demoPlay").onclick = () => { DEMO.paused = !DEMO.paused; setSpd(); };
  $("demoFx").onclick = () => { DEMO.parts = !DEMO.parts; store.set("demo.parts", DEMO.parts); $("demoFx").firstElementChild.classList.toggle("on", DEMO.parts); };
  DEMO.o = { src: "filt", wobble: 1, shake: 1, az: VDEF.az, el: 0.28, el0: 0.28, dist: 3.4, pscale: 1, blade: [0, 0, 0, 0], spin: true, hudText: false,
             show: { body: true, props: true, labels: false, thrust: true, grid: true, axes: false, hud: false, acc: false, legend: false } };
  resetDemoView(); setSpd();
  // orbit / zoom in every camera: drag turns around the quad, wheel moves closer / further
  const cv = $("v3d"); let drag = null;
  cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, az: DEMO.o.az, el: DEMO.o.el }; cv.setPointerCapture(e.pointerId); cv.classList.add("grab"); };
  cv.onpointermove = e => { if (!drag) return; DEMO.o.az = drag.az - (e.clientX - drag.x) * 0.01; DEMO.o.el = Math.max(-0.9, Math.min(1.45, drag.el + (e.clientY - drag.y) * 0.01)); };
  cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.classList.remove("grab"); };
  cv.onwheel = e => { e.preventDefault(); DEMO.o.dist = Math.max(1.2, Math.min(14, DEMO.o.dist * 1.1 ** Math.sign(e.deltaY))); };
  cv.ondblclick = resetDemoView;
  fitDemo();
  PB.hooks.demo = () => { if (!S.demo) return; if (!PB.playing) { PB.d = makeDemo(); PB.t = 0; PB.playing = true; DEMO.o.camS = {}; DEMO.o.parts = []; }
    const o = DEMO.o; o.cam = DEMO.cam; o.dt = PB.frameDt * PB.speed; o.dtReal = PB.frameDt; o.particles = DEMO.parts;
    drawViewer($("v3d"), PB.t, o); drawTrickName($("v3d"), PB.t); };
}
DEMO.speed = store.get("demo.speed", 1); DEMO.parts = store.get("demo.parts", true); DEMO.paused = false;
function resetDemoView() { if (!DEMO.o) return; Object.assign(DEMO.o, { az: VDEF.az, el: 0.28, dist: DEMO.cam === "world" ? 4.2 : 3.4 }); }
// the splash viewer runs down to the bottom of the window
function fitDemo() { const cv = $("v3d"); if (!S.demo || !cv) return; const top = cv.getBoundingClientRect().top + scrollY; cv.style.height = Math.max(320, innerHeight - top - 14) + "px"; }
addEventListener("resize", fitDemo);
addEventListener("keydown", e => { if (S.demo && e.code === "Space" && !e.target.closest("input,select,textarea") && $("demoPlay")) { e.preventDefault(); $("demoPlay").click(); } });
// trick names in FPV slang, shown while the trick is flown (fade in / out)
const TRICK_TXT = { "roll": ["SNAP ROLL", "quick 360 on the roll axis"], "double roll": ["DOUBLE SNAP", "two rolls, one breath"], "backflip": ["BACKFLIP", "chop, flip, punch out"],
  "frontflip": ["FRONT FLIP", "nose over, catch it clean"], "power loop": ["POWER LOOP", "full send around the gap"], "split-S": ["SPLIT-S", "half roll, dive back the way you came"],
  "matty flip": ["MATTY FLIP", "backwards flip with a throttle blip"], "yaw spin": ["YAW SPIN", "pirouette on the spot"], "inverted yaw spin": ["INVERTED YAW SPIN", "upside-down helicopter"],
  "rewind": ["REWIND", "roll, yaw, roll: back where it came from"], "barrel roll": ["BARREL ROLL", "corkscrew through the air"], "juicy flick": ["JUICY FLICK", "nose dip and snap back"],
  "triple roll": ["TRIPLE ROLL", "three snaps, no breathing"], "double flip": ["DOUBLE FLIP", "two backflips on a dead stick"], "trippy spin": ["TRIPPY SPIN", "flip and pirouette at once"],
  "tornado": ["TORNADO", "roll and yaw together, full twist"], "power dive": ["POWER DIVE", "invert, drop, pull out and punch"], "knife edge": ["KNIFE EDGE", "on its side, sliding the line"],
  "rubik's cube": ["RUBIK'S CUBE", "roll, flip, roll, flip"], "sbang": ["SBANG", "punch up, pitch back, roll level, gone"], "stall tumble": ["STALL TUMBLE", "cut, hang, tumble, catch"] };
function drawTrickName(cv, t) {
  const d = PB.d; if (!cv || !d || !d.trick) return;
  const i = idxAt(t), k = d.trick.idx[i]; DEMO.tn = DEMO.tn || { k: -1, a: 0, last: -1 };
  const st = DEMO.tn, dt = PB.frameDt || 0.016;
  if (k >= 0) { st.last = k; st.a = Math.min(1, st.a + dt / 0.15); } else st.a = Math.max(0, st.a - dt / 0.6);
  if (st.a <= 0 || st.last < 0) return;
  const [name, sub] = TRICK_TXT[d.trick.names[st.last]] || [d.trick.names[st.last].toUpperCase(), ""];
  const c = cv.getContext("2d"), W = cv.clientWidth, H = cv.clientHeight;
  c.save(); c.globalAlpha = st.a; c.textAlign = "center";
  c.font = `italic 900 ${Math.round(Math.min(64, W / 14))}px system-ui, sans-serif`;
  c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.55)"; c.strokeText(name, W / 2, H * 0.14);
  const g = c.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0); g.addColorStop(0, "#ffb347"); g.addColorStop(1, "#ff5e62");
  c.fillStyle = g; c.fillText(name, W / 2, H * 0.14);
  c.font = "600 14px system-ui, sans-serif"; c.fillStyle = css("--ink2"); c.fillText(sub, W / 2, H * 0.14 + 24);
  c.restore();
}
function stopDemo() {
  if (!S.demo) return;
  S.demo = false; document.body.classList.remove("demo");
  PB.d = null; PB.key = null; PB.playing = false; PB.t = 0; PB.hooks = {};
  $("viewer").hidden = true; $("viewer").innerHTML = ""; $("main").style.display = "";
}
