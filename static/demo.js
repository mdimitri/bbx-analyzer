// Idle screen before a log is opened: a quad flies a procedurally generated freestyle run through 3D space.
// Rigid-body physics: body rates from a trick script (or an attitude controller while cruising), thrust along the body
// z axis, gravity and quadratic drag → velocity → position. Motor speeds follow thrust + mixing, the frame vibrates
// in proportion to throttle. Same data layout as a real log, so the real viewer draws it.
// the flight is a generator (it yields about once per simulated second so the page can build it in the background);
// `cont` is the previous flight's end state: the next flight carries on from it, so the splash can run for ever without a cut
function makeDemo(...a) { const g = makeDemoGen(...a); let r; while (!(r = g.next()).done); return r.value; }
function* makeDemoGen(seed = Date.now() % 100000, dur = 150, world = null, cont = null) {
  let s_ = seed; const rnd = () => (s_ = (s_ * 16807) % 2147483647) / 2147483647;
  const fs = 250, dt = 1 / fs, HP = 5 * fs, pn = cont ? HP : 0, nT = pn + Math.round(dur * fs), n = nT + 5 * fs, D = Math.PI / 180, g = 9.81, TMAX = 4.2 * g, CD = 0.02;
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
  ["t", "thr", "thrCmd"].forEach(mk); for (let a = 0; a < 3; a++) ["gyro", "gyroRaw", "sp", "acc", "wob", "wobRaw", "disp"].forEach(k => mk(`${k}[${a}]`));
  for (let m = 0; m < 4; m++) { mk(`m%[${m}]`); mk(`mHz[${m}]`); }
  for (let a = 0; a < 3; a++) ["pidP", "pidI", "pidD", "pidF", "pidS"].forEach(k => mk(`${k}[${a}]`));
  mk("windS");
  const qa = new Float32Array(4 * n), pos = [new Float32Array(n), new Float32Array(n), new Float32Array(n)];
  // ---- the toy world: terrain and obstacles come from world.js (the renderer draws the very same world) ----
  const Wd = world || demoWorld(), Hf = Wd.H, RW = 130, HAGL = 6, CLR_TRICK = 2.2, CLR_FLY = 4.2;
  const wrap = a => Math.atan2(Math.sin(a), Math.cos(a)), sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  // what each kind of landmark invites, most fitting first (all are checked against the world before they are flown)
  const PREF = { gate: ["roll", "double roll", "barrel roll", "knife edge", "juicy flick", "triple roll", "tornado"],
    ramp: ["backflip", "frontflip", "double flip", "matty flip", "rubik's cube", "sbang", "power loop", "trippy spin"],
    tower: ["power dive", "split-S", "power loop", "stall tumble", "inverted yaw spin", "rewind"],
    lamp: ["yaw spin", "knife edge", "juicy flick", "barrel roll", "tornado"], car: ["roll", "barrel roll", "knife edge", "rewind", "juicy flick"],
    house: ["power loop", "split-S", "frontflip", "matty flip", "yaw spin", "tornado"] };
  const TW = { gate: 1.0, ramp: 1.4, tower: 1.0, lamp: 0.6, car: 0.7, house: 0.8 };
  const OFFS = [0, 0.3, -0.3, 0.6, -0.6, 0.95, -0.95, 1.3, -1.3, 1.8, -1.8, 2.5, -2.5];
  const waypoint = (nav, p) => {
    const L = nav.tgt; if (!L) return [0, 0, Hf(0, 0) + HAGL];
    if (L.type === "gate" || L.type === "ramp") {   // follow the line through it: aim a little ahead of where the quad's own position projects onto that line
      const ax = L.axis[0] * nav.sgn, ay = L.axis[1] * nav.sgn, rx = p[0] - L.x, ry = p[1] - L.y, s0 = rx * ax + ry * ay, lat = Math.abs(-rx * ay + ry * ax);
      const sp = Math.hypot(nav.vx || 0, nav.vy || 0), s = Math.min(26, s0 + 6 + 0.8 * sp + 0.8 * lat);
      return [L.x + ax * s, L.y + ay * s, L.zAim];
    }
    const ux = L.x - p[0], uy = L.y - p[1], ul = Math.hypot(ux, uy) || 1, R = L.rad + 6;   // beside it, not at it: a tangential pass, so the line is one smooth curve
    const nx = uy / ul * nav.side, ny = -ux / ul * nav.side;
    return [L.x + nx * R, L.y + ny * R, L.zAim];
  };
  // altitude to hold: terrain-following (looks a few seconds ahead), blending into the landmark's own height when close
  const zTargetOf = (st, nav) => {
    const sp = Math.max(6, Math.hypot(st.v[0], st.v[1])), hv = Math.atan2(st.v[1], st.v[0]); let zg = Hf(st.p[0], st.p[1]), zo = -1e9;
    for (const hd of Math.abs(wrap(nav.hd - hv)) > 0.25 ? [hv, nav.hd] : [hv]) for (const tt of [0.4, 0.9, 1.5, 2.2, 3.0]) for (const lat of [0, -3.5, 3.5]) {   // along the velocity and the planned heading, with a lateral margin
      const x = st.p[0] + Math.cos(hd) * sp * tt - Math.sin(hd) * lat, y = st.p[1] + Math.sin(hd) * sp * tt + Math.cos(hd) * lat; if (!lat) zg = Math.max(zg, Hf(x, y)); zo = Math.max(zo, Wd.topAt(x, y)); }
    for (const [dx, dy] of [[0, 0], [3, 0], [-3, 0], [0, 3], [0, -3]]) zo = Math.max(zo, Wd.topAt(st.p[0] + dx, st.p[1] + dy));
    let zb = zg + HAGL + 2.6 * Math.sin(0.27 * nav.t + 1) + nav.climb;
    if (nav.tgt) { const wp = waypoint(nav, st.p), dist = Math.hypot(wp[0] - st.p[0], wp[1] - st.p[1]), b = sstep(42, 12, dist); zb = zb * (1 - b) + Math.max(wp[2] + nav.climb, Hf(wp[0], wp[1]) + 2.2) * b; }
    return Math.min(Math.max(zb, zo + 3.2), zg + 40);     // over whatever is ahead, with a margin
  };
  const LEVELS = [0, 8];
  const planHeading = (st, nav, h_dt) => {   // pick heading and climb that keep CLR_FLY from everything, close to the way to the waypoint
    const sp = Math.max(7, Math.hypot(st.v[0], st.v[1])), wp = waypoint(nav, st.p), cur = nav.hd;
    let want = Math.atan2(wp[1] - st.p[1], wp[0] - st.p[0]); { const rr_ = Math.hypot(st.p[0], st.p[1]); if (rr_ > RW - 50) { const wc = Math.atan2(-st.p[1], -st.p[0]), k = Math.min(1, (rr_ - (RW - 50)) / 16); want = want + wrap(wc - want) * k; } }   // near the edge of the toy world the way back to the middle takes over
    let best = null;
    for (const dzc of LEVELS) { const zt = nav.zRef + Math.max(0, dzc - nav.avoid);
      for (const o of OFFS) { const h = want + o, c = Math.cos(h), s_ = Math.sin(h); let clr = 9;
        for (const tt of [0.5, 1.0, 1.6, 2.3, 3.2]) { const dm = sp * tt, k = Math.min(1, tt / 2.4); clr = Math.min(clr, Wd.sdf(st.p[0] + c * dm, st.p[1] + s_ * dm, st.p[2] + (zt - st.p[2]) * k + st.v[2] * tt * 0.4)); if (clr < CLR_FLY * 0.4) break; }
        const score = (clr >= CLR_FLY ? 0 : 20 + (CLR_FLY - clr) * 4) + Math.abs(o) + dzc * 0.3 + Math.abs(wrap(h - cur)) * 0.7;   // stay with the current choice unless another is clearly better
        if (!best || score < best.score) best = { score, h, dz: dzc }; } if (best.score < 1.2) break; }
    if (Wd.sdf(st.p[0], st.p[1], st.p[2]) < 2) best.dz = Math.max(best.dz, 8);   // too close to something: climb away from it
    const wmax = Math.max(0.6, Math.min(2.2, 21 / sp)); nav.hd = cur + Math.max(-wmax * h_dt, Math.min(wmax * h_dt, wrap(best.h - cur)));   // the planned heading turns at the rate the speed allows (~2.3 g of cornering)
    { const c = Math.cos(best.h), s_ = Math.sin(best.h); let fd = 70; for (let dm = 5; dm <= 70; dm += 5) if (Wd.sdf(st.p[0] + c * dm, st.p[1] + s_ * dm, st.p[2]) < CLR_FLY * 1.4) { fd = dm; break; } nav.freeD = fd; }
    nav.avoid += (best.dz - nav.avoid) * (best.dz > nav.avoid ? 1 : 0.2);
  };
  const navStep = (st, nav) => {          // every physics step: altitude reference (rate-limited), speed policy and, every 0.1 s, the heading plan
    nav.t += dt; nav.vx = st.v[0]; nav.vy = st.v[1]; const zt = zTargetOf(st, nav) + nav.avoid; nav.zRef += Math.max(-5 * dt, Math.min(7 * dt, zt - nav.zRef));
    { const goal = 25 + 21 * Math.max(0, Math.min(1, (nav.freeD - 12) / 50)) - 7 * Math.min(1, Math.abs(wrap(nav.hd - Math.atan2(st.v[1], st.v[0]))) / 0.8); nav.tilt += Math.max(-25 * dt, Math.min(25 * dt, goal - nav.tilt)); }   // open air: lean in and go; tight spots or hard turns: ease off
    if ((nav.pt -= dt) <= 0) { const h_ = nav.look ? 0.25 : 0.1; nav.pt = h_; planHeading(st, nav, h_); }
  };
  const cruise = (st, nav) => {           // a banked, coordinated turn: the thrust vector leans forward for speed and sideways for the turn; the nose follows the velocity
    const zb = rot(st.q, [0, 0, 1]), fwd = rot(st.q, [1, 0, 0]), yawNow = Math.atan2(fwd[1], fwd[0]), sp = Math.hypot(st.v[0], st.v[1]), hv = sp > 4 ? Math.atan2(st.v[1], st.v[0]) : yawNow;
    const wmax = Math.max(0.55, Math.min(2.0, 20 / Math.max(sp, 8))), wd = Math.max(-wmax, Math.min(wmax, 2.4 * wrap(nav.hd - hv)));
    const low = st.p[2] < nav.zRef - 2, tanT = Math.tan((low ? Math.min(12, nav.tilt * 0.4) : nav.tilt) * D), lat = sp * wd / g, hx = Math.cos(hv), hy = Math.sin(hv);
    let tq = [hx * tanT - hy * lat, hy * tanT + hx * lat, 1]; const tl = Math.hypot(...tq); tq = tq.map(c => c / tl);
    const e = rot([st.q[0], -st.q[1], -st.q[2], -st.q[3]], [zb[1] * tq[2] - zb[2] * tq[1], zb[2] * tq[0] - zb[0] * tq[2], zb[0] * tq[1] - zb[1] * tq[0]]);
    const inv = zb[2] < 0 ? 1 : 0, dy = wrap(hv + 0.3 * wd - yawNow);
    return [Math.max(-600, Math.min(600, 520 * e[0] + inv * 400)), Math.max(-600, Math.min(600, 520 * e[1])), Math.max(-300, Math.min(300, 260 * dy))];
  };
  const hold = (st, zRef) => { const zb = rot(st.q, [0, 0, 1]), up = Math.max(0.25, zb[2]), need = (g + 1.6 * (zRef - st.p[2]) - 1.2 * st.v[2]) / (TMAX * up);
    return Math.max(0.05, Math.min(0.95, zb[2] > 0.2 ? need : 0.15)); };
  const NOWIND = [0, 0, 0];
  const phys = (st, rates, thr, direct) => {
    if (direct) st.thrS = thr; else st.thrS += (thr - st.thrS) * 0.12;
    const wd_ = st.wind || NOWIND;
    const w = rates.map(r => r * D), h = 0.5 * dt, dq = qmul(st.q, [0, w[0], w[1], w[2]]);
    st.q = st.q.map((c, k) => c + h * dq[k]); const qn = Math.hypot(...st.q); st.q = st.q.map(c => c / qn);
    const zB = rot(st.q, [0, 0, 1]), sp_ = Math.hypot(st.v[0] - wd_[0], st.v[1] - wd_[1], st.v[2] - wd_[2]), acc = [0, 1, 2].map(k => TMAX * st.thrS * zB[k] - (k === 2 ? g : 0) - CD * sp_ * (st.v[k] - wd_[k]));
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
  // look-ahead: fly the trick + 1.5 s of recovery on a copy of the state; the least clearance from terrain or any object on the way
  const leastClear = (st, seg, nav) => {
    const c = { q: st.q.slice(), v: st.v.slice(), p: st.p.slice(), thrS: st.thrS }, nv = { ...nav, look: true }, pl = { seg: seg.slice(), tk: 0 };
    let m = Wd.sdf(c.p[0], c.p[1], c.p[2]), k = 0;
    while (pl.seg.length) { const [r, t] = planStep(c, pl, nv.zRef); phys(c, r, t); if (!(++k % 2)) m = Math.min(m, Wd.sdf(c.p[0], c.p[1], c.p[2])); if (m < CLR_TRICK) return m; }
    for (let j = 0; j < 1.5 * fs; j++) { navStep(c, nv); phys(c, cruise(c, nv), hold(c, nv.zRef)); if (!(j % 2)) m = Math.min(m, Wd.sdf(c.p[0], c.p[1], c.p[2])); if (m < CLR_TRICK) return m; }
    return m;
  };
  const st = { q: [1, 0, 0, 0], v: [14, 0, 0], p: [0, 0, Hf(0, 0) + 7], thrS: 0.35 };
  const nav = { tgt: null, tgtI: -1, stage: 0, sgn: 1, zRef: st.p[2], climb: 0, avoid: 0, hd: 0, pt: 0, fails: 0, since: 0, retry: 0, t: 0, tilt: 30, freeD: 40, side: 1 };
  const visited = new Map(), LM = Wd.landmarks, stats = { picks: 0, timeout: 0, failed: 0, none: 0 };
  const pickTarget = (tNow) => {          // the next landmark: not far, roughly ahead, not flown to lately, with a taste for gates and ramps
    const hd = Math.atan2(st.v[1], st.v[0]); let best = null;
    LM.forEach((L, k) => { const dx = L.x - st.p[0], dy = L.y - st.p[1], dist = Math.hypot(dx, dy); if (dist < 24 || dist > 90 || Math.hypot(L.x, L.y) > RW - 30) return;
      if (tNow - (visited.get(k) ?? -1e9) < 70) return;
      const cost = dist / 45 + Math.abs(wrap(Math.atan2(dy, dx) - hd)) * 1.5 + rnd() * 0.9 - (TW[L.type] || 0.5); if (!best || cost < best.cost) best = { cost, k }; });
    stats.picks++; if (!best) { stats.none++; nav.tgt = null; nav.tgtI = -1; return; }
    const L = LM[best.k]; nav.tgt = L; nav.tgtI = best.k; nav.stage = 0; nav.fails = 0; nav.since = 0; visited.set(best.k, tNow);
    { const dx = L.x - st.p[0], dy = L.y - st.p[1]; nav.side = Math.sin(Math.atan2(dy, dx) - Math.atan2(st.v[1], st.v[0])) > 0 ? 1 : -1;   // the object stays on the side it is already on
      const ul = Math.hypot(dx, dy) || 1, R = L.rad + 6, w1 = [L.x + dy / ul * R * nav.side, L.y - dx / ul * R * nav.side], w2 = [L.x - dy / ul * R * nav.side, L.y + dx / ul * R * nav.side];
      if (Wd.sdf(w1[0], w1[1], L.zAim) < CLR_FLY && Wd.sdf(w2[0], w2[1], L.zAim) > Wd.sdf(w1[0], w1[1], L.zAim)) nav.side = -nav.side; }
    // a gate is entered from the side the quad is on; a ramp is always taken up its slope (low end first)
    if (L.type === "gate") nav.sgn = (st.p[0] - L.x) * L.axis[0] + (st.p[1] - L.y) * L.axis[1] >= 0 ? -1 : 1;
    else if (L.type === "ramp") nav.sgn = (st.p[0] - L.x) * L.axis[0] + (st.p[1] - L.y) * L.axis[1] >= 0 ? -1 : 1;
  };
  const startTrick = (L) => {             // try the landmark's favourite tricks first, then the rest; the first one that clears everything wins
    const pref = (L && PREF[L.type] || []).slice().sort(() => rnd() - 0.5), rest = names.filter(x => !pref.includes(x)).sort(() => rnd() - 0.5);
    for (const nm of [...pref, ...rest].slice(0, 9)) { const seg = TR[nm](); if (leastClear(st, seg, nav) >= CLR_TRICK) return { seg, tk: 0, nm }; }
    return null;
  };
  let pl = null, trick = null, trickLm = -1, ratesPrev = [0, 0, 0], hits = 0, bumps = 0, minClear = 99;
  const dbg = { hd: new Float32Array(n), zr: new Float32Array(n), av: new Float32Array(n), yaw: new Float32Array(n) };
  const vib = [0, 0, 0], wobS = [0, 0, 0], trk = new Int8Array(n), trkLm = new Int16Array(n).fill(-1);
  // ---- what makes it feel flown: a rate PID loop on a lagging, noisy motor/gyro chain, and wind ----
  const GN = () => { let u = 0; for (let k = 0; k < 4; k++) u += rnd(); return (u - 2) * 1.73; };   // ~N(0,1)
  const CT = { A: [60000, 60000, 15000], kp: [0.0005, 0.0005, 0.0017], ki: [0.006, 0.006, 0.02], kd: [5.8e-6, 5.8e-6, 0], kf: [1.5e-5, 1.5e-5, 6e-5] };   // plant authority (°/s² per unit of motor mix) and the gains
  const MIX = [[-1, 1, -1], [-1, -1, 1], [1, 1, 1], [1, -1, -1]], TAUM = 0.022, aG = 1 - Math.exp(-dt * 2 * Math.PI * 45), aD = 1 - Math.exp(-dt * 2 * Math.PI * 60), aM = 1 - Math.exp(-dt / TAUM);
  const pid = { w: [0, 0, 0], gF: [0, 0, 0], gPrev: [0, 0, 0], iT: [0, 0, 0], dF: [0, 0, 0], spPrev: [0, 0, 0], fF: [0, 0, 0], mAct: [0.3, 0.3, 0.3, 0.3], dist: [0, 0, 0], u: [0, 0, 0] };
  const wind = { m: [0, 0, 0], t: [0, 0, 0], g: 0, gd: 1, gv: [0, 0, 0] }; { const a = rnd() * 6.28, m = 2 + rnd() * 2.5; wind.m = [Math.cos(a) * m, Math.sin(a) * m, 0]; }
  st.wind = [0, 0, 0]; st.w = pid.w;
  const stepWind = () => {   // slow mean drift + turbulence (an Ornstein–Uhlenbeck process, ~1.4 m/s, 1 s correlation) + a gust now and then
    for (let k = 0; k < 3; k++) wind.t[k] += (-wind.t[k] / 1.0 * dt) + (k === 2 ? 0.5 : 1.4) * Math.sqrt(2 / 1.0 * dt) * GN();
    if (wind.g > 0) { wind.g -= dt; if (wind.g <= 0) wind.gv = [0, 0, 0]; } else if (rnd() < dt / 9) { wind.g = wind.gd = 0.8 + rnd(); const a = rnd() * 6.28, m = 3 + rnd() * 3; wind.gv = [Math.cos(a) * m, Math.sin(a) * m, (rnd() - 0.5) * 2]; }
    for (let k = 0; k < 3; k++) st.wind[k] = wind.m[k] + wind.t[k] + (wind.g > 0 ? wind.gv[k] * Math.sin(Math.PI * (1 - wind.g / wind.gd)) : 0);
  };
  const control = (sp, thr, i) => {      // the flight controller + motors + body, one 250 Hz step; returns the true body rates
    const noiseG = 0.35 + 5 * thr * thr, out = [0, 0, 0], u = pid.u;
    for (let a = 0; a < 3; a++) {
      const gm = pid.w[a] + noiseG * GN();                         // gyro, with motor noise on it
      pid.gF[a] += (gm - pid.gF[a]) * aG;                            // gyro low-pass (45 Hz at this 250 Hz step: stands in for the real loop's filters and delays)
      const e = sp[a] - pid.gF[a];
      pid.iT[a] = Math.max(-0.25, Math.min(0.25, pid.iT[a] + CT.ki[a] * e * dt * 1));
      const dRaw = -(pid.gF[a] - pid.gPrev[a]) / dt * CT.kd[a]; pid.dF[a] += (dRaw - pid.dF[a]) * aD; pid.gPrev[a] = pid.gF[a];
      const P = CT.kp[a] * e; pid.fF[a] += (CT.kf[a] * (sp[a] - pid.spPrev[a]) / dt - pid.fF[a]) * 0.3; const F = pid.fF[a]; pid.spPrev[a] = sp[a];   // feed-forward from the setpoint's slope, smoothed (≈ Betaflight's FF smoothing)
      u[a] = P + pid.iT[a] + pid.dF[a] + F;
      ch[`pidP[${a}]`][i] = P * 1000; ch[`pidI[${a}]`][i] = pid.iT[a] * 1000; ch[`pidD[${a}]`][i] = pid.dF[a] * 1000; ch[`pidF[${a}]`][i] = F * 1000; ch[`pidS[${a}]`][i] = u[a] * 1000;
      ch[`gyroRaw[${a}]`][i] = gm; ch[`gyro[${a}]`][i] = pid.gF[a];
    }
    const cmd = MIX.map(mx => thr + mx[0] * u[0] + mx[1] * u[1] + mx[2] * u[2]);      // mixer, then keep every motor inside 0…1 (airmode: shift the lot)
    const hi = Math.max(...cmd), lo = Math.min(...cmd); let sh = 0; if (hi > 1) sh = 1 - hi; else if (lo < 0.03) sh = 0.03 - lo; const k2 = Math.max(hi - lo, 1e-6) > 0.97 ? 0.97 / (hi - lo) : 1;
    for (let m = 0; m < 4; m++) { const c = Math.max(0.03, Math.min(1, (cmd[m] - (hi + lo) / 2) * k2 + (hi + lo) / 2 + sh)); pid.mAct[m] += (c - pid.mAct[m]) * aM; }
    for (let a = 0; a < 3; a++) {      // torque from the motors, plus turbulence torque
      const tq = (pid.mAct[0] * MIX[0][a] + pid.mAct[1] * MIX[1][a] + pid.mAct[2] * MIX[2][a] + pid.mAct[3] * MIX[3][a]) / 4;
      pid.dist[a] += (-pid.dist[a] / 0.12 * dt) + (a === 2 ? 60 : 160) * Math.sqrt(2 / 0.12 * dt) * GN();
      pid.w[a] += (CT.A[a] * tq + pid.dist[a]) * dt; out[a] = pid.w[a];
    }
    return out;
  };
  const tAbs0 = cont ? cont.tAbs - pn * dt : 0;
  if (cont) {   // carry on from where the last flight ended: its state, and its last 5 s as history for the live plots
    Object.assign(st, cont.st); Object.assign(nav, cont.nav); Object.assign(pid, cont.pid); Object.assign(wind, cont.wind); for (const [k, v] of cont.visited) visited.set(k, v); vib.splice(0, 3, ...cont.vib); wobS.splice(0, 3, ...cont.wobS);
    const H_ = cont.hist; for (const k in ch) if (H_.ch[k]) ch[k].set(H_.ch[k]); for (let i = 0; i < pn; i++) ch.t[i] = i * dt; qa.set(H_.q); for (let k = 0; k < 3; k++) pos[k].set(H_.pos[k]); trk.set(H_.trk); trkLm.set(H_.trkLm); for (const k in dbg) dbg[k].set(H_[k]);
    pid.mAct = pid.mAct.slice(); st.wind = st.wind || [0, 0, 0]; st.w = pid.w;
  } else pickTarget(0);
  let i = pn;
  for (; i < n; i++) {
    if (i >= nT && !pl) break;            // ended: the flight stops in cruise, never half way through a trick
    if ((i & 255) === 0) yield;
    const tNow = tAbs0 + i * dt;
    if (!pl) {
      nav.since += dt; const L = nav.tgt;
      if (L) {   // progress towards the landmark, and the moment to do the trick
        const wp = waypoint(nav, st.p), dist = Math.hypot(wp[0] - st.p[0], wp[1] - st.p[1]), rx = st.p[0] - L.x, ry = st.p[1] - L.y;
        if ((L.type === "gate" || L.type === "ramp") && nav.stage === 0 && (rx * L.axis[0] + ry * L.axis[1]) * nav.sgn > -6) nav.stage = 1;
        let go = false;
        if (L.type === "gate") go = nav.stage === 1 && (rx * L.axis[0] + ry * L.axis[1]) * nav.sgn > 5;
        else if (L.type === "ramp") go = nav.stage === 1 && Math.hypot(rx, ry) < 8 && (rx * L.axis[0] + ry * L.axis[1]) * nav.sgn > -1;
        else go = Math.hypot(rx, ry) < L.rad + 16;
        if (nav.since > 12) { stats.timeout++; (stats.to || (stats.to = {}))[L.type] = (stats.to[L.type] || 0) + 1; pickTarget(tNow); go = false; }          // never reached it: choose another
        if (Math.hypot(st.p[0], st.p[1]) > RW - 22) go = false;           // tricks stay inside the world
        if (go && tNow > 1.5 && tNow >= nav.retry) {
          const r = startTrick(L);
          if (r) { (stats.ok || (stats.ok = {}))[L.type] = (stats.ok[L.type] || 0) + 1; pl = r; trick = r.nm; trickLm = nav.tgtI; nav.climb = Math.max(0, nav.climb - 2); }
          else { nav.retry = tNow + 0.3; if (++nav.fails >= 3) { stats.failed++; nav.climb = Math.min(nav.climb + 5, 18); pickTarget(tNow); } else nav.climb = Math.min(nav.climb + 3, 18); }   // nothing fits here: climb a little, move on
        }
      } else if (nav.since > 1) pickTarget(tNow);
    }
    trk[i] = pl ? names.indexOf(trick) : -1; trkLm[i] = pl ? trickLm : -1;
    let rates, thr; navStep(st, nav);
    if (pl) { [rates, thr] = planStep(st, pl, nav.zRef); nav.rs = rates.slice(); if (!pl.seg.length) { pl = null; nav.climb = Math.max(0, nav.climb - 3); pickTarget(tNow); } }
    else { const cr = cruise(st, nav), k_ = 1 - Math.exp(-dt / 0.05); nav.rs = nav.rs ? nav.rs.map((v, k) => v + (cr[k] - v) * k_) : cr; rates = nav.rs.slice(); thr = hold(st, nav.zRef); if (nav.climb > 0 && !nav.tgt) nav.climb = Math.max(0, nav.climb - 0.5 * dt); }
    dbg.hd[i] = nav.hd; dbg.zr[i] = nav.zRef; dbg.av[i] = nav.avoid; { const f_ = rot(st.q, [1, 0, 0]); dbg.yaw[i] = Math.atan2(f_[1], f_[0]); }
    ch.thrCmd[i] = thr * 100; stepWind(); const spt = rates; rates = control(spt, thr, i); thr = pid.mAct.reduce((a, b) => a + b, 0) / 4;
    const acc = phys(st, rates, thr, true);
    const gz = Hf(st.p[0], st.p[1]); if (st.p[2] < gz + 0.4) { st.p[2] = gz + 0.4; st.v[2] = Math.max(0, st.v[2]); }   // safety net, should never trigger
    { let c0 = Wd.sdf(st.p[0], st.p[1], st.p[2]);   // last line of defence: if the plan still brings it near something, it is pushed away like a soft bumper
      if (c0 < 1.6) { const e = 0.4, nx = Wd.sdf(st.p[0] + e, st.p[1], st.p[2]) - Wd.sdf(st.p[0] - e, st.p[1], st.p[2]), ny = Wd.sdf(st.p[0], st.p[1] + e, st.p[2]) - Wd.sdf(st.p[0], st.p[1] - e, st.p[2]),
          nz = Wd.sdf(st.p[0], st.p[1], st.p[2] + e) - Wd.sdf(st.p[0], st.p[1], st.p[2] - e), nl = Math.hypot(nx, ny, nz) || 1, nn = [nx / nl, ny / nl, nz / nl];
        for (let k = 0; k < 3; k++) st.v[k] += nn[k] * (1.6 - c0) * 14 * dt;
        if (c0 < 0.35) { for (let k = 0; k < 3; k++) st.p[k] += nn[k] * (0.35 - c0); const vn = st.v[0] * nn[0] + st.v[1] * nn[1] + st.v[2] * nn[2]; if (vn < 0) for (let k = 0; k < 3; k++) st.v[k] -= nn[k] * vn * 1.3; bumps++; }
        c0 = Wd.sdf(st.p[0], st.p[1], st.p[2]); }
      minClear = Math.min(minClear, c0); if (c0 < 0.1) hits++; }
    const { q, p, thrS } = st;
    // vibration that grows with throttle (m) and a little rate wobble
    for (let k = 0; k < 3; k++) {
      vib[k] = 0.6 * vib[k] + (rnd() - 0.5) * (0.0006 + 0.0038 * thrS) * (k === 2 ? 1.4 : 1);
      wobS[k] = 0.9 * wobS[k] + (rnd() - 0.5) * (0.0004 + 0.0025 * thrS) * (k === 2 ? 0.4 : 1);
    }
    ch.t[i] = i * dt; ch.thr[i] = thrS * 100;
    const accB = rot([q[0], -q[1], -q[2], -q[3]], [acc[0], acc[1], acc[2] + g]);
    for (let k = 0; k < 3; k++) {
      ch[`sp[${k}]`][i] = spt[k];
      ch[`acc[${k}]`][i] = accB[k] / g; ch[`wob[${k}]`][i] = ch[`wobRaw[${k}]`][i] = wobS[k]; ch[`disp[${k}]`][i] = vib[k];
      pos[k][i] = p[k];
    }
    for (let m = 0; m < 4; m++) { const c = pid.mAct[m] * 100; ch[`m%[${m}]`][i] = c; ch[`mHz[${m}]`][i] = 55 + 300 * Math.sqrt(pid.mAct[m]); }
    ch.windS[i] = Math.hypot(st.wind[0], st.wind[1]);
    qa.set(q, 4 * i);
  }
  const nA = i, cut = a => a.subarray(0, a.length === 4 * n ? 4 * nA : nA);   // the arrays were sized for the longest case: trim them
  const hist = { ch: {}, q: qa.slice(4 * (nA - HP), 4 * nA), pos: pos.map(a => a.slice(nA - HP, nA)), trk: trk.slice(nA - HP, nA), trkLm: trkLm.slice(nA - HP, nA) };
  for (const k in ch) hist.ch[k] = ch[k].slice(nA - HP, nA); for (const k in dbg) hist[k] = dbg[k].slice(nA - HP, nA);
  for (const k in ch) ch[k] = cut(ch[k]); for (let k = 0; k < 3; k++) pos[k] = cut(pos[k]); for (const k in dbg) dbg[k] = cut(dbg[k]);
  const qa_ = cut(qa), trk_ = cut(trk), trkLm_ = cut(trkLm);
  const d = { n: nA, nm: 4, t: ch.t, ch, dur: ch.t[nA - 1], fmax: 360, gmax: 900, demo: true };
  d.q = { filt: qa_, raw: qa_ };
  d.wob = { filt: [0, 1, 2].map(a => ch[`wob[${a}]`]), raw: [0, 1, 2].map(a => ch[`wobRaw[${a}]`]) };
  d.accHP = [0, 1, 2].map(a => highpass(ch[`acc[${a}]`], 100));
  d.disp = [0, 1, 2].map(a => ch[`disp[${a}]`]);
  let zmin = 1e9; for (let i = 0; i < nA; i += 25) zmin = Math.min(zmin, Hf(pos[0][i], pos[1][i]));
  d.pos = pos; d.groundZ = zmin - 1.5; d.trick = { names, idx: trk_, lm: trkLm_ }; d.world = Wd; d.dbg = dbg; d.stats = stats; d.hits = hits; d.bumps = bumps; d.minClear = minClear;
  d.cont = { st, nav, pid, wind, visited, vib, wobS, tAbs: tAbs0 + nA * dt, hist };
  return d;
}

const DEMO = { cam: store.get("demo.cam", "chase"), gen: 0 };
function demoWorld() { return DEMO.world || (DEMO.world = makeWorld()); }   // the same toy world every time; only the flight differs
function startDemo() {
  S.demo = true;
  DEMO.clk = 0; DEMO.nextG = DEMO.next = null; PB.d = makeDemo((Math.random() * 1e5) | 0, 60); PB.key = "demo"; PB.t = 0; PB.playing = true; PB.speed = 1; PB.hooks = {};
  document.body.classList.add("demo");
  $("controls").innerHTML = `<div class="hero"><h2>Drop a Betaflight blackbox log to start</h2>
    <p class="hint">.BBL / .BFL straight from the flight controller, or pick one above. Decoding takes a few seconds the first time, then it's cached.</p>
    <label class="btn">Choose a log…<input type="file" accept=".bbl,.bfl,.txt" hidden onchange="this.files[0] && upload(this.files[0])"></label></div>`;
  $("main").style.display = "none"; $("findings").innerHTML = ""; $("dash").hidden = true;
  const el = $("viewer"); el.hidden = false;
  const SPEEDS = [[0.1, "0.1×"], [0.25, "¼×"], [0.5, "½×"], [1, "1×"]];
  el.innerHTML = `<div class="demoview"><div class="stage"><canvas id="v3d" aria-label="Animated FPV quad flying freestyle tricks around a toy world"></canvas><canvas id="v3dOv" aria-hidden="true"></canvas></div>
    <div class="livegrid" id="liveGrid"></div>
    <div class="demobar"><span class="seg" id="demoCam">${[["chase", "Chase"], ["world", "Wide"], ["flight", "FPV"]].map(([v, l]) => `<button data-v="${v}" class="${DEMO.cam === v ? "on" : ""}">${l}</button>`).join("")}</span>
      <button class="btn sm" id="demoPlay" title="Pause / play (space)">❚❚</button>
      <span class="seg" id="demoSpd" title="Animation speed">${SPEEDS.map(([v, l]) => `<button data-v="${v}" class="${DEMO.speed === v ? "on" : ""}">${l}</button>`).join("")}</span>
      <span class="chips" id="demoFx">${chip("parts", "Particles", DEMO.parts)}${chip("trail", "Trail", DEMO.trail)}${chip("plots", "Live plots", DEMO.plots)}${chip("sticks", "Sticks", DEMO.sticks)}</span>
      <span class="hint demohint">drag = orbit · wheel = zoom · double-click = reset</span></div></div>`;
  $("demoCam").onclick = e => { const v = e.target.dataset.v; if (!v) return; DEMO.cam = v; store.set("demo.cam", v); [...$("demoCam").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); resetDemoView(); };
  const setSpd = () => { PB.speed = DEMO.paused ? 0 : DEMO.speed; $("demoPlay").textContent = DEMO.paused ? "▶" : "❚❚"; [...$("demoSpd").children].forEach(b => b.classList.toggle("on", +b.dataset.v === DEMO.speed)); };
  $("demoSpd").onclick = e => { const v = e.target.dataset.v; if (!v) return; DEMO.speed = +v; DEMO.paused = false; store.set("demo.speed", DEMO.speed); setSpd(); };
  $("demoPlay").onclick = () => { DEMO.paused = !DEMO.paused; setSpd(); };
  $("demoFx").onclick = e => { const b = e.target.closest("[data-k]"); const k = b && b.dataset.k; if (k === "parts") DEMO.parts = !DEMO.parts; else if (k === "trail") DEMO.trail = !DEMO.trail; else if (k === "plots") { DEMO.plots = !DEMO.plots; setPlots(); } else if (k === "sticks") DEMO.sticks = !DEMO.sticks; else return; store.set("demo." + k, DEMO[k]); b.classList.toggle("on", DEMO[k]); };
  DEMO.o = { src: "filt", wobble: 1, shake: 1, az: VDEF.az, el: 0.28, el0: 0.28, dist: 3.4, pscale: 1, blade: [0, 0, 0, 0], spin: true, hudText: false,
             show: { body: true, props: true, labels: false, thrust: true, grid: true, axes: false, hud: false, acc: false, legend: false } };
  resetDemoView(); setSpd();
  // orbit / zoom in every camera: drag turns around the quad, wheel moves closer / further
  const bindView = cv => { let drag = null;
    cv.onpointerdown = e => { drag = { x: e.clientX, y: e.clientY, az: DEMO.o.az, el: DEMO.o.el }; cv.setPointerCapture(e.pointerId); cv.classList.add("grab"); };
    cv.onpointermove = e => { if (!drag) return; DEMO.o.az = drag.az - (e.clientX - drag.x) * 0.01; DEMO.o.el = Math.max(-0.9, Math.min(1.45, drag.el + (e.clientY - drag.y) * 0.01)); };
    cv.onpointerup = cv.onpointercancel = () => { drag = null; cv.classList.remove("grab"); };
    cv.onwheel = e => { e.preventDefault(); DEMO.o.dist = Math.max(1.2, Math.min(14, DEMO.o.dist * 1.1 ** Math.sign(e.deltaY))); };
    cv.ondblclick = resetDemoView; };
  bindView($("v3d"));
  const setPlots = () => { const g = $("liveGrid"); if (!g) return; g.hidden = !DEMO.plots; if (DEMO.plots) LIVE.start(g); else LIVE.stop(); fitDemo(); };
  setPlots();
  // the 3D toy world (Three.js, loaded on demand); without WebGL the old flat-ground 2D viewer takes over
  const gen = ++DEMO.gen; DEMO.g3 = null; DEMO.mode = "load";
  const fallback = why => { if (gen !== DEMO.gen || !S.demo) return; console.warn("3D splash unavailable:", why); const old = $("v3d"), nu = document.createElement("canvas"); nu.id = "v3d"; nu.setAttribute("aria-label", old.getAttribute("aria-label")); old.replaceWith(nu); $("v3dOv").remove(); bindView(nu); DEMO.mode = "2d"; fitDemo(); };
  if (W3.supported()) W3.create($("v3d"), $("v3dOv"), demoWorld()).then(g => { if (gen !== DEMO.gen || !S.demo) return g.dispose(); DEMO.g3 = g; DEMO.mode = "3d"; }).catch(fallback); else fallback("no WebGL");
  PB.hooks.demo = () => { if (!S.demo || DEMO.mode === "load") return;
    let d = PB.d;
    // the flight never ends: the next one is built in the background (a few ms a frame) from where this one will end, and carries the last 5 s of this one as its
    // history, so at the hand-over nothing moves: not the quad, the camera, the trail or the plots
    if (!DEMO.nextG && !DEMO.next && PB.t > d.dur * 0.35) DEMO.nextG = makeDemoGen((Math.random() * 1e5) | 0, 60, demoWorld(), d.cont);
    if (DEMO.nextG) { const t0 = performance.now(); let r; do r = DEMO.nextG.next(); while (!r.done && performance.now() - t0 < (PB.playing ? 4 : 1e9)); if (r.done) { DEMO.next = r.value; DEMO.nextG = null; } }
    const off = (d.n - 1250) * (d.t[1] - d.t[0]);
    if (DEMO.next && (PB.t >= off || !PB.playing)) {
      const nd = DEMO.next; DEMO.next = null; PB.t = Math.max(0, PB.t - off); PB.d = d = nd; PB.playing = true; DEMO.clk = (DEMO.clk || 0) + off;
      if (DEMO.g3) DEMO.g3.rebase(nd, off); LIVE.rebase(nd, off); }
    else if (!PB.playing) { PB.playing = true; PB.t = 0; }   // only if a build failed: carry on rather than freeze
    const o = DEMO.o; o.cam = DEMO.cam; o.dt = PB.frameDt * PB.speed; o.dtReal = PB.frameDt; o.particles = DEMO.parts; o.trail = DEMO.trail; o.clk = PB.t + (DEMO.clk || 0);
    if (DEMO.plots) LIVE.update(PB.t, PB.d, o);
    if (DEMO.mode === "3d") { const r = DEMO.g3.draw(PB.t, o, PB.d); drawTrickName($("v3dOv"), PB.t, r); drawSticks($("v3dOv"), PB.t); }
    else { drawViewer($("v3d"), PB.t, o); drawTrickName($("v3d"), PB.t); } };
}
DEMO.speed = store.get("demo.speed", 1); DEMO.parts = store.get("demo.parts", true); DEMO.trail = store.get("demo.trail", false); DEMO.plots = store.get("demo.plots", true); DEMO.sticks = store.get("demo.sticks", true); DEMO.paused = false;
function resetDemoView() { if (!DEMO.o) return; Object.assign(DEMO.o, { az: VDEF.az, el: 0.28, dist: DEMO.mode === "2d" && DEMO.cam === "world" ? 4.2 : 3.4 }); }
// the splash viewer runs down to the bottom of the window
function fitDemo() { const cv = $("v3d"); if (!S.demo || !cv) return; const top = cv.getBoundingClientRect().top + scrollY, lg = $("liveGrid"), lh = lg && !lg.hidden && innerWidth > 760 ? 214 : 0; cv.style.height = Math.max(300, innerHeight - top - 14 - lh) + "px"; }
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
function drawTrickName(cv, t, hud) {
  const d = PB.d; if (!cv || !d || !d.trick) return;
  const c = cv.getContext("2d"), W = cv.clientWidth, H = cv.clientHeight;
  if (cv.id === "v3dOv") { c.setTransform(cv.width / Math.max(1, W), 0, 0, cv.height / Math.max(1, H), 0, 0); c.clearRect(0, 0, W, H); }
  const i = idxAt(t), k = d.trick.idx[i]; DEMO.tn = DEMO.tn || { k: -1, a: 0, last: -1 };
  const st = DEMO.tn, dt = PB.frameDt || 0.016;
  if (k >= 0) { st.last = k; st.a = Math.min(1, st.a + dt / 0.15); } else st.a = Math.max(0, st.a - dt / 0.6);
  if (st.a <= 0 || st.last < 0) return;
  let [name, sub] = TRICK_TXT[d.trick.names[st.last]] || [d.trick.names[st.last].toUpperCase(), ""];
  const lm = d.trick.lm && d.world ? d.world.landmarks[d.trick.lm[i] >= 0 ? d.trick.lm[i] : -1] : null; if (lm) sub += ` · at the ${lm.name.toLowerCase()}`;
  c.save(); c.globalAlpha = st.a; c.textAlign = "center";
  c.font = `italic 900 ${Math.round(Math.min(64, W / 14))}px system-ui, sans-serif`;
  c.lineWidth = 6; c.strokeStyle = "rgba(0,0,0,0.55)"; c.strokeText(name, W / 2, H * 0.27);
  const g = c.createLinearGradient(W / 2 - 200, 0, W / 2 + 200, 0); g.addColorStop(0, "#ffb347"); g.addColorStop(1, "#ff5e62");
  c.fillStyle = g; c.fillText(name, W / 2, H * 0.27);
  c.font = "600 14px system-ui, sans-serif"; c.fillStyle = css("--ink2"); c.fillText(sub, W / 2, H * 0.27 + 24);
  c.restore();
}
// the pilot's two sticks (mode 2), reconstructed from what the quad was told to do: left = throttle (up/down) and yaw (left/right),
// right = pitch (forward = up) and roll; the fading line is the last second of stick travel, so each trick shows its recipe
function drawSticks(cv, t) {
  const d = PB.d; if (!cv || !d || !d.ch.thrCmd || !DEMO.sticks) return;
  const W = cv.clientWidth, H = cv.clientHeight, c = cv.getContext("2d"); c.setTransform(cv.width / Math.max(1, W), 0, 0, cv.height / Math.max(1, H), 0, 0);
  const f = v => Math.sign(v) * Math.min(1, (Math.abs(v) / 900) ** 0.8), i = idxAt(t), size = Math.round(Math.max(76, Math.min(116, W * 0.11))), m = 14, y0 = H - size - m - 14;
  const stick = j => { j = Math.max(0, Math.min(d.n - 1, j)); return [-f(d.ch["sp[2]"][j]), Math.max(-1, Math.min(1, d.ch.thrCmd[j] / 100 * 2 - 1)), f(d.ch["sp[0]"][j]), f(d.ch["sp[1]"][j])]; };   // yaw, throttle | roll, pitch
  const ink = css("--ink2"), acc = css("--accent"), sf = css("--surface");
  [[m, "THROTTLE · YAW", 0], [W - m - size, "PITCH · ROLL", 2]].forEach(([x0, label, o]) => {
    const R = size / 2, cx = x0 + R, cy = y0 + R, P = j => { const s = stick(j); return [cx + s[o] * (R - 8), cy - s[o + 1] * (R - 8)]; };
    c.save(); c.globalAlpha = 0.55; c.fillStyle = sf; c.beginPath(); c.roundRect(x0, y0, size, size, 12); c.fill(); c.globalAlpha = 0.9; c.strokeStyle = ink; c.lineWidth = 1.2; c.stroke();
    c.globalAlpha = 0.25; c.beginPath(); c.moveTo(cx, y0 + 6); c.lineTo(cx, y0 + size - 6); c.moveTo(x0 + 6, cy); c.lineTo(x0 + size - 6, cy); c.stroke(); c.restore();
    c.save(); c.lineCap = "round"; c.lineWidth = 2.4; c.strokeStyle = acc;
    for (let k = 0; k < 24; k++) { const a = P(i - (k + 1) * 10), b = P(i - k * 10); c.globalAlpha = 0.75 * (1 - k / 24); c.beginPath(); c.moveTo(a[0], a[1]); c.lineTo(b[0], b[1]); c.stroke(); }
    const [px, py] = P(i); c.globalAlpha = 1; c.fillStyle = acc; c.beginPath(); c.arc(px, py, 6.5, 0, 6.2832); c.fill(); c.strokeStyle = sf; c.lineWidth = 1.5; c.stroke(); c.restore();
    c.save(); c.font = "600 10px system-ui, sans-serif"; c.fillStyle = ink; c.textAlign = "center"; c.globalAlpha = 0.9; c.fillText(label, cx, y0 + size + 13); c.restore(); });
}
function stopDemo() {
  if (!S.demo) return;
  S.demo = false; document.body.classList.remove("demo"); DEMO.gen++; DEMO.next = null; DEMO.nextG = null; DEMO.clk = 0; LIVE.stop(); if (DEMO.g3) { DEMO.g3.dispose(); DEMO.g3 = null; }
  PB.d = null; PB.key = null; PB.playing = false; PB.t = 0; PB.hooks = {};
  $("viewer").hidden = true; $("viewer").innerHTML = ""; $("main").style.display = "";
}
