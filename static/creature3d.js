// The creature match tab: the quad's eight scores next to the nearest creature's, and a 3D creature flying the way the quad flies.
// Three.js (vendored) draws a procedural body for each of twelve body plans (flat faces + crease lines, like the splash), wing beats,
// wind streaks flowing past it, wingtip trails and a scrolling ground grid. Nothing here is a measurement: it is an illustration.
const CR3 = (() => {
  let T = null;
  const load = async () => T || (T = await import("/static/vendor/three.module.min.js"));
  const theme = () => document.documentElement.dataset.theme === "light" ? "light" : "dark";
  const SIZE = [0.62, 0.8, 1.0, 1.25, 1.55];            // size class 1..5 → scale of the body (kept close enough that every creature fills the view)
  const hsl = (h, s, l) => new T.Color().setHSL(((h % 360) + 360) % 360 / 360, s, l);

  // ---------- parts ----------
  // build(c): the creature's look (creaturelooks.js) turned into a model by its archetype (creaturearch.js); K is the kit of parts they share
  function build(c) {
    const L = crLook(c), hue = CR_KINDS[c.kind].hue, dark = theme() === "dark", pal = L.pal || {};
    const P = (k, d) => pal[k] ? hsl(pal[k][0], pal[k][1], pal[k][2]) : d;
    const C = { body: P("body", hsl(hue, 0.42, dark ? 0.48 : 0.56)), alt: P("alt", hsl(hue + 25, 0.55, dark ? 0.6 : 0.5)), pale: P("pale", hsl(hue - 10, 0.5, dark ? 0.78 : 0.4)), glow: P("glow", hsl(hue + 10, 0.9, 0.62)) };
    const lum = (C.body.r + C.body.g + C.body.b) / 3;
    C.edge = L.metal || lum > 0.55 ? (dark ? hsl(hue, 0.4, 0.2) : hsl(hue, 0.5, 0.16)) : (dark ? hsl(hue, 0.55, 0.86) : hsl(hue, 0.5, 0.16));
    if (dark && lum > 0.55) C.edge = hsl(hue, 0.3, 0.3);
    const wings = [], tips = [], ticks = [], root = new T.Group(), owned = [], translucent = L.ghost || L.glass;
    const mesh = (geo, col, o = {}) => { owned.push(geo); const g = new T.Group(), op = o.op != null ? o.op : translucent ? 0.62 : null, mt = new T.MeshStandardMaterial({ color: col, flatShading: true, roughness: L.metal ? 0.38 : 0.72, metalness: L.metal ? 0.7 : 0.05, side: o.double ? T.DoubleSide : T.FrontSide, transparent: op != null, opacity: op ?? 1, emissive: o.glow ? col : 0x000000, emissiveIntensity: o.glow ? 0.9 : 0 });
      g.add(new T.Mesh(geo, mt)); if (!o.noEdge) g.add(new T.LineSegments(new T.EdgesGeometry(geo, o.ang ?? 22), new T.LineBasicMaterial({ color: C.edge, transparent: true, opacity: o.eo ?? 0.85 }))); return g; };
    const place = (g, x, y, z, sx, sy, sz) => { g.position.set(x, y, z); if (sx !== undefined) g.scale.set(sx, sy ?? sx, sz ?? sx); return g; };
    const ell = (sx, sy, sz, col, o = {}) => place(mesh(new T.IcosahedronGeometry(1, o.d ?? 1), col, o), 0, 0, 0, sx, sy, sz);
    const cone = (r, h, seg = 5, col = C.body, o = {}) => mesh(new T.ConeGeometry(r, h, seg), col, o), cyl = (r1, r2, h, seg = 6, col = C.body, o = {}) => mesh(new T.CylinderGeometry(r1, r2, h, seg), col, o), box = (sx, sy, sz, col = C.body, o = {}) => mesh(new T.BoxGeometry(sx, sy, sz), col, o);
    const UPV = new T.Vector3(0, 1, 0);
    const limb = (a, b, r0, r1, col, o = {}) => { const d = new T.Vector3(b[0] - a[0], b[1] - a[1], b[2] - a[2]), len = d.length() || 1e-3; const g = mesh(new T.CylinderGeometry(r1, r0, len, 6), col, { noEdge: o.noEdge ?? true, ...o });
      g.position.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2); g.quaternion.setFromUnitVectors(UPV, d.normalize()); root.add(g); return g; };
    // a wing outline (span along +z, chord along +x), as a flat shape
    const outline = (kind, s, ch) => {
      const P_ = { membrane: [[0, 0.15], [0.35, 0.38], [1, 0.14], [0.86, -0.34], [0.7, -0.14], [0.6, -0.62], [0.4, -0.26], [0.24, -0.6], [0, -0.5]],
        feather: [[0, 0.3], [0.4, 0.46], [0.85, 0.28], [1, 0.05], [0.93, -0.12], [0.84, -0.04], [0.8, -0.3], [0.7, -0.2], [0.64, -0.46], [0.5, -0.32], [0.42, -0.52], [0.26, -0.36], [0, -0.3]],
        butter: [[0, 0.05], [0.3, 0.7], [0.8, 0.9], [1, 0.45], [0.7, 0.05], [0.9, -0.55], [0.55, -0.8], [0.2, -0.45]],
        leaf: [[0, 0.1], [0.3, 0.4], [0.7, 0.34], [1, 0.02], [0.7, -0.3], [0.3, -0.28], [0, -0.1]],
        fin: [[0, 0.3], [0.5, 0.55], [1, 0.0], [0.7, -0.3], [0.45, -0.1], [0.3, -0.5], [0, -0.35]],
        panel: [[0, 0.3], [1, 0.3], [1, -0.3], [0, -0.3]] }[kind] || [[0, 0.3], [1, 0.3], [1, -0.3], [0, -0.3]];
      const sh = new T.Shape(); P_.forEach(([a, b], i) => i ? sh.lineTo(a * s, b * ch) : sh.moveTo(a * s, b * ch)); sh.closePath();
      return new T.ShapeGeometry(sh).applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0, 0, 1), new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0)));   // shape x (span) → +z, shape y (chord) → +x, normal → +y
    };
    const addWing = (px, py, pz, side, kind, s, ch, col, o = {}) => {
      const pivot = new T.Group(); pivot.position.set(px, py, pz); const m = mesh(outline(kind, s, ch), col, { double: true, op: o.op, eo: o.eo ?? 0.8, ang: 5 }); m.scale.z = side; pivot.add(m);
      if (o.bones !== false) { const g = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0.05 * s, 0, 0.5 * s * side), new T.Vector3(0.1 * ch, 0, s * side)]); pivot.add(new T.Line(g, new T.LineBasicMaterial({ color: C.edge }))); owned.push(g); }
      const tip = new T.Object3D(); tip.position.set(0.1 * ch, 0, s * side); pivot.add(tip); tips.push(tip); root.add(pivot);
      wings.push({ pivot, side, amp: o.amp ?? 0.8, ph: o.ph ?? 0, tw: o.tw ?? 0.25 }); return pivot; };
    const wingPair = (px, py, pz, kind, s, ch, col, o) => { addWing(px, py, pz, 1, kind, s, ch, col, o); addWing(px, py, -pz, -1, kind, s, ch, col, o); };
    const tailChain = (n, len, r0, col, y = 0, x0 = -0.8, wag = 0.5) => { const segs = []; let par = root;
      for (let i = 0; i < n; i++) { const seg = new T.Group(); seg.position.set(i ? -len : x0, i ? 0 : y, 0); const m = mesh(new T.ConeGeometry(r0 * (1 - i / (n + 1)), len * 1.15, 5).rotateZ(Math.PI / 2).translate(-len * 0.5, 0, 0), col); seg.add(m); par.add(seg); segs.push(seg); par = seg; }
      ticks.push(t => segs.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.2 - i * 0.55) * wag * 0.35; s.rotation.z = Math.sin(t * 1.7 - i * 0.5) * 0.12; })); return segs; };
    const K = { T, C, root, owned, ticks, wings, tips, mesh, place, ell, cone, cyl, box, limb, wingPair, addWing, tailChain, hsl };
    const arch = CR_ARCH[L.a] || CR_ARCH.spirit; arch(K, L.a in CR_ARCH ? L : { ...L, kind: "wisp" }, c);
    root.userData.owned = owned;
    return { root, wings, tips, ticks, size: Math.sqrt(L.size || 1), look: L, vertical: false };
  }

  // ---------- the flight: attitude, trick and gust model driven by the eight scores (0..1) ----------
  function makeFlight(s, seed = 1) {
    let r = seed * 9301 % 233280; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280, ph = [rnd() * 6.28, rnd() * 6.28, rnd() * 6.28, rnd() * 6.28];
    const F = { t: 0, yaw: 0, pitch: 0, roll: 0, om: 0, vz: 0, wx: 0, wy: 0, wz: 0, trick: null, nextTrick: 3 + rnd() * 3, x: 0, z: 0, speed: 0, bank: 0, climb: 0, stat: s };
    F.v = 5 + 30 * s.spd;                       // m/s
    F.step = dt => {
      const t = F.t += dt, tau = 0.5 - 0.44 * s.nim, k = 1 - Math.exp(-dt / tau), turnMax = 0.3 + 1.6 * s.agi, climbAmp = 1.2 + 8 * s.clb;
      const omT = turnMax * (0.7 * Math.sin(0.33 * t + ph[0]) + 0.3 * Math.sin(0.83 * t + ph[1])); F.om += (omT - F.om) * k; F.yaw += F.om * dt;
      const vzT = climbAmp * Math.sin(0.41 * t + ph[2]) * (0.6 + 0.4 * Math.sin(0.17 * t + ph[3])); F.vz += (vzT - F.vz) * k;
      const bankT = Math.max(-1.15, Math.min(1.15, Math.atan2(F.v * F.om, 9.81) * (0.65 + 0.5 * s.agi))), pitchT = Math.atan2(F.vz, F.v) * 1.1;
      F.rollB = (F.rollB || 0) + (bankT - (F.rollB || 0)) * k; F.pitchB = (F.pitchB || 0) + (pitchT - (F.pitchB || 0)) * k;
      // gusts: slow wobble, as large as the creature is unsteady; jitter: fast and small, as large as it is rough
      const g = 1 - s.std, ju = 1 - s.smo; const ou = (key, sg) => { F[key] += (-F[key] / 0.7 * dt) + sg * Math.sqrt(2 / 0.7 * dt) * (rnd() + rnd() + rnd() + rnd() - 2) * 1.73; return F[key]; };
      const wob = [ou("wx", 0.16 * g), ou("wy", 0.12 * g), ou("wz", 0.1 * g)], jit = [(rnd() - 0.5) * 0.09 * ju, (rnd() - 0.5) * 0.06 * ju, (rnd() - 0.5) * 0.09 * ju];
      // tricks: a roll, a loop or a flip, as fast as it can rotate
      let ar = 0, ap = 0;
      if (!F.trick && t > F.nextTrick) { const kinds = ["roll", "loop", "flip", "roll"]; F.trick = { kind: kinds[(rnd() * 4) | 0], u: 0, dur: Math.max(0.55, 2.4 - 1.9 * s.agi) * (rnd() < 0.3 ? 1.6 : 1), n: rnd() < 0.25 ? 2 : 1 }; }
      if (F.trick) { const T_ = F.trick; T_.u += dt / (T_.dur * T_.n); const e = T_.u < 1 ? T_.u - Math.sin(2 * Math.PI * T_.u) / (2 * Math.PI) : 1, ang = e * 2 * Math.PI * T_.n;
        if (T_.kind === "roll") ar = ang; else ap = T_.kind === "loop" ? -ang : ang; if (T_.u >= 1) { F.trick = null; F.nextTrick = t + 4.5 + (1 - s.agi) * 6 + rnd() * 3; } }
      F.rollA = F.rollB + wob[0] + jit[0] + ar; F.pitchA = F.pitchB + wob[1] + jit[1] + ap; F.yawA = F.yaw + wob[2] + jit[2];
      const cp = Math.cos(F.pitchB), vx = F.v * cp * Math.cos(F.yaw), vy = F.vz, vzz = -F.v * cp * Math.sin(F.yaw);
      F.vel = [vx, vy, vzz]; F.speed = Math.hypot(vx, vy, vzz); F.bank = F.rollB; F.climb = F.vz; F.x += vx * dt; F.z += vzz * dt; return F;
    };
    return F;
  }

  // ---------- the viewer ----------
  async function create(canvas, host) {
    await load();
    const renderer = new T.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" }); renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2)); renderer.setClearColor(0x000000, 0);
    const scene = new T.Scene(), cam = new T.PerspectiveCamera(42, 1, 0.1, 200);
    const hemi = new T.HemisphereLight(0xffffff, 0x334455, 1.1), sun = new T.DirectionalLight(0xffffff, 2.2); sun.position.set(-4, 6, 3); scene.add(hemi, sun);
    const st = { az: 0.6, el: 0.22, dist: 7, auto: true, idle: 0, c: null, mode: "quad", wind: true, trails: true, pip: true, F: null, rig: null, flap: 0, t: 0, stats: { quad: null, creature: null }, last: 0, hud: { speed: 0, bank: 0, climb: 0 } };
    // wind streaks
    const NW = 700, WR = 14, wp = new Float32Array(NW * 3), wl = new Float32Array(NW * 6), wc = new Float32Array(NW * 6);
    for (let i = 0; i < NW; i++) { wp[i * 3] = (Math.random() * 2 - 1) * WR; wp[i * 3 + 1] = (Math.random() * 2 - 1) * WR * 0.7; wp[i * 3 + 2] = (Math.random() * 2 - 1) * WR; }
    const wg = new T.BufferGeometry(); wg.setAttribute("position", new T.BufferAttribute(wl, 3)); wg.setAttribute("color", new T.BufferAttribute(wc, 3));
    const windMat = new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false }); const wind = new T.LineSegments(wg, windMat); wind.frustumCulled = false; scene.add(wind);
    // wingtip trails
    const TL = 44, trails = []; const mkTrail = () => { const g = new T.BufferGeometry(), P = new Float32Array(TL * 3), C = new Float32Array(TL * 3); g.setAttribute("position", new T.BufferAttribute(P, 3)); g.setAttribute("color", new T.BufferAttribute(C, 3)); g.setDrawRange(0, 0);
      const l = new T.Line(g, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })); l.frustumCulled = false; scene.add(l); return { g, P, C, l, n: 0, pts: [] }; };
    const grid = new T.GridHelper(80, 32, 0x888888, 0x888888); grid.material.transparent = true; grid.material.opacity = 0.35; scene.add(grid); const cell = 80 / 32;
    const ring = new T.Mesh(new T.RingGeometry(0.01, 3.4, 40).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ transparent: true, opacity: 0.0, depthWrite: false })); scene.add(ring);
    // picture-in-picture: your own quad, flying the same flight as the avatar, in the bottom-right corner (its own scene and camera, drawn into a scissored corner of the canvas)
    const qscene = new T.Scene(), qcam = new T.PerspectiveCamera(40, 1.33, 0.1, 100), qhemi = new T.HemisphereLight(0xffffff, 0x334455, 1.1), qsun = new T.DirectionalLight(0xffffff, 2.2); qsun.position.set(-4, 6, 3); qscene.add(qhemi, qsun);
    const seq = () => getComputedStyle(document.documentElement).getPropertyValue("--seq").split(",").map(c => new T.Color(c.trim())), seqAt = (S_, g) => { const x = Math.max(0, Math.min(1, g)) * (S_.length - 1), i = Math.min(S_.length - 2, Math.floor(x)); return S_[i].clone().lerp(S_[i + 1], x - i); };
    const quadRig = (() => { const g = new T.Group(), S_ = seq(), dk = theme() === "dark", fr = seqAt(S_, dk ? 0.55 : 0.8), hi = seqAt(S_, 1), mt = seqAt(S_, dk ? 0.8 : 0.9), edge = dk ? 0xcfd8e3 : 0x20252d, blades = [];
      const bx = (sx, sy, sz, x, y, z, col, o = {}) => { const geo = new T.BoxGeometry(sx, sy, sz), m = new T.Mesh(geo, new T.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.6, emissive: o.glow ? col : 0, emissiveIntensity: o.glow ? 0.8 : 0 })); m.position.set(x, y, z); g.add(m); const l = new T.LineSegments(new T.EdgesGeometry(geo), new T.LineBasicMaterial({ color: edge, transparent: true, opacity: 0.6 })); l.position.copy(m.position); g.add(l); return m; };
      bx(1.0, 0.06, 0.4, 0, 0, 0, fr); bx(1.0, 0.06, 0.4, 0, 0.24, 0, fr); bx(0.6, 0.2, 0.3, -0.1, 0.12, 0, seqAt(S_, 0.35)); bx(0.3, 0.2, 0.22, 0.52, 0.1, 0, seqAt(S_, 0.25)); bx(0.05, 0.14, 0.14, 0.7, 0.1, 0, hi, { glow: true });
      for (const [x, z] of [[0.55, 0.62], [0.55, -0.62], [-0.55, 0.62], [-0.55, -0.62]]) { const a = new T.Mesh(new T.BoxGeometry(1.0, 0.04, 0.12), new T.MeshStandardMaterial({ color: fr, flatShading: true })); a.position.set(x / 2, 0.1, z / 2); a.rotation.y = Math.atan2(-z, x); g.add(a);
        const mo = new T.Mesh(new T.CylinderGeometry(0.09, 0.09, 0.14, 10), new T.MeshStandardMaterial({ color: mt, flatShading: true, emissive: mt, emissiveIntensity: 0.4 })); mo.position.set(x, 0.18, z); g.add(mo);
        const di = new T.Mesh(new T.CircleGeometry(0.55, 24).rotateX(-Math.PI / 2), new T.MeshBasicMaterial({ color: mt, transparent: true, opacity: 0.18, side: T.DoubleSide, depthWrite: false })); di.position.set(x, 0.3, z); g.add(di);
        const bl = new T.Mesh(new T.BoxGeometry(1.1, 0.01, 0.07), new T.MeshBasicMaterial({ color: hi, transparent: true, opacity: 0.8 })); bl.position.set(x, 0.31, z); g.add(bl); blades.push(bl); }
      qscene.add(g); return { g, blades }; })();
    const QWR = 8, QN = 220, qwp = new Float32Array(QN * 3), qwl = new Float32Array(QN * 6), qwc = new Float32Array(QN * 6); for (let i = 0; i < QN; i++) { qwp[i * 3] = (Math.random() * 2 - 1) * QWR; qwp[i * 3 + 1] = (Math.random() * 2 - 1) * QWR * 0.7; qwp[i * 3 + 2] = (Math.random() * 2 - 1) * QWR; }
    const qwg = new T.BufferGeometry(); qwg.setAttribute("position", new T.BufferAttribute(qwl, 3)); qwg.setAttribute("color", new T.BufferAttribute(qwc, 3)); const qwind = new T.LineSegments(qwg, new T.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false })); qwind.frustumCulled = false; qscene.add(qwind);
    const pipBox = () => { const w = Math.round(Math.max(150, Math.min(300, cw * 0.3))), h = Math.round(w * 0.72); return { w, h, x: cw - w - 12, y: 12 }; };   // CSS px, y from the bottom
    let cw = 0, chh = 0; const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (w === cw && h === chh) return; cw = w; chh = h; renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); };
    let curTheme = "";
    const applyTheme = () => { const th = theme(); if (th === curTheme) return; curTheme = th; const dark = th === "dark"; hemi.intensity = dark ? 0.95 : 1.25; windMat.blending = dark ? T.AdditiveBlending : T.NormalBlending; windMat.needsUpdate = true;
      grid.material.color.set(dark ? 0x58708a : 0x7d8794); trails.forEach(tr => { tr.l.material.blending = dark ? T.AdditiveBlending : T.NormalBlending; tr.l.material.needsUpdate = true; }); if (st.c) setCreature(st.c, st.stats.creature, true); };
    function disposeRig() { if (!st.rig) return; scene.remove(st.rig.root); st.rig.root.traverse(o => { if (o.material) { o.material.dispose && o.material.dispose(); } if (o.geometry) o.geometry.dispose(); }); st.rig = null; }
    function setCreature(c, cs, keep) {
      st.c = c; st.stats.creature = cs; disposeRig(); const rig = build(c), sc = SIZE[c.sz - 1] * rig.size; rig.root.scale.setScalar(sc); rig.sc = sc; st.rig = rig; scene.add(rig.root); trails.forEach(tr => { scene.remove(tr.l); tr.g.dispose(); }); trails.length = 0; rig.tips.forEach(() => trails.push(mkTrail()));
      applyTrailTheme(); if (!keep) { st.dist = 2.4 + 5 * Math.pow(sc, 0.9); st.F = makeFlight(st.mode === "quad" ? st.stats.quad : cs, 1 + c.id); }
      grid.position.y = -(1.2 + 1.5 * sc); }
    const applyTrailTheme = () => { trails.forEach(tr => { tr.l.material.blending = theme() === "dark" ? T.AdditiveBlending : T.NormalBlending; }); };
    function setMode(m) { st.mode = m; if (st.c) st.F = makeFlight(m === "quad" ? st.stats.quad : st.stats.creature, 1 + st.c.id); }
    const q = new T.Quaternion(), eu = new T.Euler(0, 0, 0, "YZX"), tmp = new T.Vector3();
    function frame(now) {
      resize(); applyTheme(); const dt = Math.min(0.05, Math.max(0.001, (now - (st.last || now)) / 1000)); st.last = now; st.t += dt; const rig = st.rig; if (!rig || !st.F) { renderer.render(scene, cam); return; }
      const F = st.F.step(dt), sc = rig.sc, dark = curTheme === "dark";
      // wing beats: a slower flap for big and tireless creatures, a harder beat for strong ones; a gliding pause when it banks hard
      const cs = st.stats.creature, lk = rig.look, fam = lk.a === "insect" ? 4.5 : lk.fey ? 3.5 : lk.a === "spirit" ? 0.6 : lk.a === "fish" || lk.a === "squid" ? 0.35 : lk.hang ? 1.4 : lk.a === "craft" ? 0.9 : 1;
      const hz = [0, 5.5, 4.2, 3.2, 2.2, 1.5][st.c.sz] * fam * (st.c.kind === "Absurd & unlikely" ? 2.2 : 1) * (1.3 - 0.5 * cs.end) * (0.85 + 0.4 * (st.F.stat.pwr)) * (1 + 0.25 * Math.max(0, Math.min(1, F.climb / 8)));
      st.flap += dt * hz * 2 * Math.PI; const glide = c => 1 - 0.55 * Math.max(0, Math.min(1, Math.abs(F.bank) / 1.1)) * (lk.a === "bird" || lk.a === "humanoid" ? 1 : 0.4);
      rig.wings.forEach(w => { const a = w.amp * (0.55 + 0.55 * st.F.stat.pwr) * glide(st.c), p = st.flap + w.ph; const ang = a * (Math.sin(p) + 0.18 * Math.sin(2 * p + 0.6)); w.pivot.rotation.x = w.side * ang * (w.side > 0 ? 1 : 1) - 0; w.pivot.rotation.z = -w.tw * Math.cos(p) * 0.5; });
      rig.ticks.forEach(fn => fn(st.t));
      eu.set(F.rollA, F.yawA, F.pitchA, "YZX"); rig.root.quaternion.setFromEuler(eu); rig.root.position.set(0, Math.sin(st.t * 2 * Math.PI * hz * 0.5) * 0.05 * sc, 0);
      // the world streams past: wind streaks, wingtip trails and the ground grid all move against the flight direction
      const V = tmp.set(F.vel[0], F.vel[1], F.vel[2]), sp = V.length(), Vn = V.clone().normalize(), len = Math.min(3.2, 0.25 + sp * 0.07);
      const cl = dark ? [0.7, 0.85, 1] : [0.12, 0.25, 0.4], bg = dark ? [0, 0, 0] : [1, 1, 1];
      for (let i = 0; i < NW; i++) { let x = wp[i * 3] - V.x * dt, y = wp[i * 3 + 1] - V.y * dt, z = wp[i * 3 + 2] - V.z * dt;
        const d = Math.hypot(x, y, z), R = 1.9 * sc + 0.3; if (d < R) { const k = (R - d) / R * 2.4 * dt * sp * 0.4; x += x / (d || 1) * k; y += y / (d || 1) * k; z += z / (d || 1) * k; }
        if (Math.abs(x) > WR || Math.abs(y) > WR * 0.7 || Math.abs(z) > WR) { x = (Math.random() * 2 - 1) * WR; y = (Math.random() * 2 - 1) * WR * 0.7; z = (Math.random() * 2 - 1) * WR; const e = -1 / sp; x -= Vn.x * WR * 0.9; y -= Vn.y * WR * 0.6; z -= Vn.z * WR * 0.9; }
        wp[i * 3] = x; wp[i * 3 + 1] = y; wp[i * 3 + 2] = z; const o = i * 6, f = Math.min(1, 1.2 - Math.abs(Math.hypot(x, y, z) - 9) / 12);
        wl[o] = x; wl[o + 1] = y; wl[o + 2] = z; wl[o + 3] = x + Vn.x * len; wl[o + 4] = y + Vn.y * len; wl[o + 5] = z + Vn.z * len;
        for (let c = 0; c < 3; c++) { wc[o + c] = bg[c] + (cl[c] - bg[c]) * 0.05 * f; wc[o + 3 + c] = bg[c] + (cl[c] - bg[c]) * (0.4 * f); } }
      wg.attributes.position.needsUpdate = true; wg.attributes.color.needsUpdate = true; wind.visible = st.wind;
      rig.tips.forEach((tip, k) => { const tr = trails[k]; if (!tr) return; tip.getWorldPosition(tmp); for (const p of tr.pts) { p[0] -= V.x * dt; p[1] -= V.y * dt; p[2] -= V.z * dt; } tr.pts.push([tmp.x, tmp.y, tmp.z]); if (tr.pts.length > TL) tr.pts.shift();
        const n = tr.pts.length; for (let i = 0; i < n; i++) { const p = tr.pts[n - 1 - i], a = Math.pow(1 - i / TL, 1.5); tr.P[i * 3] = p[0]; tr.P[i * 3 + 1] = p[1]; tr.P[i * 3 + 2] = p[2]; for (let c = 0; c < 3; c++) tr.C[i * 3 + c] = bg[c] + (cl[c] - bg[c]) * a * 0.45; }
        tr.g.setDrawRange(0, n); tr.g.attributes.position.needsUpdate = true; tr.g.attributes.color.needsUpdate = true; tr.l.visible = st.trails; });
      grid.position.x = -((F.x % cell) + cell) % cell; grid.position.z = -((F.z % cell) + cell) % cell; grid.position.x = -(((F.x % cell) + cell) % cell); grid.position.z = -(((F.z % cell) + cell) % cell);
      // camera: orbits the creature; it turns slowly by itself until you take hold of it
      if (st.auto && !st.drag) { st.idle += dt; if (st.idle > 2.5) st.az += dt * 0.18; }
      cam.position.set(Math.cos(st.az) * Math.cos(st.el) * st.dist, Math.sin(st.el) * st.dist, Math.sin(st.az) * Math.cos(st.el) * st.dist); cam.lookAt(0, 0, 0);
      renderer.render(scene, cam);
      // the quad copy: the same attitude, the same velocity, so any difference you see is the flight, not the model
      if (st.pip) { const b = pipBox(), Vn2 = Vn.clone(); quadRig.g.quaternion.copy(rig.root.quaternion); const dk = curTheme === "dark"; quadRig.blades.forEach((bl, i) => { bl.rotation.y = st.t * 26 * (i % 2 ? 1 : -1) + i; });
        const R2 = Math.cos(st.el) * 4.3; qcam.position.set(Math.cos(st.az) * R2, Math.sin(st.el) * 4.3, Math.sin(st.az) * R2); qcam.lookAt(0, 0, 0); qcam.aspect = b.w / b.h; qcam.updateProjectionMatrix();
        const cl2 = dk ? [0.7, 0.85, 1] : [0.12, 0.25, 0.4], bg2 = dk ? [0, 0, 0] : [1, 1, 1], ln = Math.min(2.2, 0.2 + sp * 0.05);
        for (let i = 0; i < QN; i++) { let x = qwp[i * 3] - V.x * dt * 0.6, y = qwp[i * 3 + 1] - V.y * dt * 0.6, z = qwp[i * 3 + 2] - V.z * dt * 0.6;
          if (Math.abs(x) > QWR || Math.abs(y) > QWR * 0.7 || Math.abs(z) > QWR) { x = (Math.random() * 2 - 1) * QWR - Vn2.x * QWR * 0.9; y = (Math.random() * 2 - 1) * QWR * 0.7 - Vn2.y * QWR * 0.6; z = (Math.random() * 2 - 1) * QWR - Vn2.z * QWR * 0.9; }
          qwp[i * 3] = x; qwp[i * 3 + 1] = y; qwp[i * 3 + 2] = z; const o = i * 6, f = Math.max(0.15, 1 - Math.hypot(x, y, z) / 11); qwl[o] = x; qwl[o + 1] = y; qwl[o + 2] = z; qwl[o + 3] = x + Vn2.x * ln; qwl[o + 4] = y + Vn2.y * ln; qwl[o + 5] = z + Vn2.z * ln;
          for (let c = 0; c < 3; c++) { qwc[o + c] = bg2[c] + (cl2[c] - bg2[c]) * 0.05 * f; qwc[o + 3 + c] = bg2[c] + (cl2[c] - bg2[c]) * 0.38 * f; } }
        qwg.attributes.position.needsUpdate = true; qwg.attributes.color.needsUpdate = true; qwind.visible = st.wind; qwind.material.blending = dk ? T.AdditiveBlending : T.NormalBlending;
        renderer.setScissorTest(true); renderer.setViewport(b.x, b.y, b.w, b.h); renderer.setScissor(b.x, b.y, b.w, b.h); renderer.setClearColor(dk ? 0x0b0d12 : 0xf2f1ed, 0.86); renderer.clear(true, true, true); renderer.render(qscene, qcam);
        renderer.setClearColor(0x000000, 0); renderer.setScissorTest(false); renderer.setViewport(0, 0, cw, chh); }
      st.hud = { speed: sp, bank: F.bank, climb: F.climb, trick: F.trick && F.trick.kind };
    }
    // orbit and zoom
    canvas.addEventListener("pointerdown", e => { st.drag = { x: e.clientX, y: e.clientY, az: st.az, el: st.el }; st.idle = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add("grab"); });
    canvas.addEventListener("pointermove", e => { if (!st.drag) return; st.az = st.drag.az - (e.clientX - st.drag.x) * 0.008; st.el = Math.max(-1.2, Math.min(1.45, st.drag.el + (e.clientY - st.drag.y) * 0.008)); st.idle = 0; });
    const up = () => { st.drag = null; canvas.classList.remove("grab"); }; canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", e => { e.preventDefault(); st.dist = Math.max(2.2, Math.min(22, st.dist * 1.1 ** Math.sign(e.deltaY))); st.idle = 0; }, { passive: false });
    canvas.addEventListener("dblclick", () => { st.az = 0.6; st.el = 0.22; if (st.c && st.rig) st.dist = 2.4 + 5 * Math.pow(st.rig.sc, 0.9); });
    const dispose = () => { try { disposeRig(); wg.dispose(); windMat.dispose(); trails.forEach(tr => tr.g.dispose()); renderer.dispose(); renderer.forceContextLoss(); } catch (e) { console.warn(e); } };
    return { st, frame, setCreature, setMode, dispose };
  }
  return { create, supported: () => { try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch (e) { return false; } } };
})();

// ---------- the tab ----------
const CRS = { key: null, R: null, q: null, ranked: null, sel: null, kind: "all", q_: "", g: null, raf: 0, mode: "quad" };
const crScale = v => Math.max(0, Math.min(1, v / 99));
async function renderCreature() {
  const key = [S.file, S.sub, S.prop && S.prop.inch, S.prop && S.prop.blades, S.auw].join("|");
  if (CRS.key !== key) { const R = await api("report", S.auw ? { auw: S.auw } : {}); CRS.R = R; CRS.q = quadScores(R, S.meta.stats); CRS.ranked = crMatch(CRS.q.v); CRS.sel = CRS.ranked[0].c.id; CRS.key = key; }
  if (S.tab !== "avatar") return;
  try { Plotly.purge("main"); } catch (e) {} $("main").style.display = "none";
  $("controls").innerHTML = tbar(`<h3>Avatar</h3><span class="hint">a bit of fun: which creature of myth (or nonsense) flies most like your quad? · scores are 0–99, higher is better (↑) on every axis</span>`, []);
  const craft = (CRS.R.craft || "Your quad"), best = CRS.ranked[0];
  const L = $("findings"); L.innerHTML = `<div class="crt">
    <div class="crt-main">
      <div class="crt-stage" id="crStage"><canvas id="crCv"></canvas>
        <div class="crt-title"><div class="crt-k" id="crKind"></div><div class="crt-n" id="crName"></div></div>
        <div class="crt-tools"><span class="seg" id="crMode"><button data-v="quad" class="on" title="Animate with the quad's own flight scores">Flies like ${esc(craft)}</button><button data-v="creature" title="Animate with the creature's own scores">Flies like itself</button></span>
          <span class="chips" id="crFx">${chip("wind", "Wind", true)}${chip("trails", "Wing trails", true)}${chip("pip", "Quad copy", true)}${chip("auto", "Auto-rotate", true)}</span></div>
        <div class="crt-pip" id="crPip"><span>your quad · same flight</span></div><div class="crt-hud" id="crHud"></div><div class="crt-hint">drag = orbit · wheel = zoom · double-click = reset</div></div>
      <div class="crt-fall" id="crFall" hidden>3D needs WebGL, which this browser has turned off. The scores still work.</div>
    </div>
    <aside class="crt-side">
      <div class="crt-verdict" id="crVerdict"></div>
      <div class="crt-radar" id="crRadar"></div>
      <table class="crt-stats" id="crStats"></table>
      <div class="hint" id="crLore"></div>
      <div class="fh">Closest matches</div><div class="crt-top" id="crTop"></div>
    </aside>
    <div class="crt-all"><div class="crt-filter"><input id="crSearch" type="search" placeholder="Search ${CREATURES.length} creatures…" value="${esc(CRS.q_)}"><span class="chips" id="crKinds">${["all", ...Object.keys(CR_KINDS)].map(k => `<button class="chip ${CRS.kind === k ? "on" : ""}" data-k="${esc(k)}"><span style="color:var(--ink2)">${k === "all" ? "All kinds" : esc(k)}</span></button>`).join("")}</span></div>
      <div class="crt-grid" id="crGrid"></div></div></div>`;
  const hex = h => `hsl(${CR_KINDS[h].hue} 55% 55%)`;
  const info = (id) => { const m = CRS.ranked.find(x => x.c.id === id); return m; };
  const showSel = () => { const m = info(CRS.sel), c = m.c, q = CRS.q.v;
    $("crKind").innerHTML = `<i style="background:${hex(c.kind)}"></i>${esc(c.kind)}`; $("crName").textContent = c.name;
    $("crVerdict").innerHTML = CRS.sel === best.c.id ? `<span class="hint">${esc(craft)} flies most like</span><div class="crt-big">${esc(c.name)}</div><span class="badge lv-good">${m.like}% alike</span>` : `<span class="hint">${esc(craft)} vs</span><div class="crt-big">${esc(c.name)}</div><span class="badge lv-info">${m.like}% alike</span> <button class="btn sm ghost" id="crBest">back to the best match (${esc(best.c.name)})</button>`;
    if ($("crBest")) $("crBest").onclick = () => select(best.c.id);
    // radar chart: the quad (accent) over the creature (its kind's colour)
    const R0 = 74, cx = 110, cy = 100, pt = (i, v) => { const a = -Math.PI / 2 + i / 8 * 2 * Math.PI, r = R0 * v / 99; return [cx + Math.cos(a) * r, cy + Math.sin(a) * r]; }, poly = vs => vs.map((v, i) => pt(i, v).join(",")).join(" ");
    $("crRadar").innerHTML = `<svg viewBox="0 0 220 200" role="img" aria-label="Radar chart of the quad against the creature">${[25, 50, 75, 99].map(r => `<polygon points="${poly(Array(8).fill(r))}" fill="none" stroke="var(--grid)" stroke-width="1"/>`).join("")}
      ${CR_AXES.map(([k, n], i) => { const [x, y] = pt(i, 99), [lx, ly] = pt(i, 117); return `<line x1="${cx}" y1="${cy}" x2="${x}" y2="${y}" stroke="var(--grid)"/><text x="${lx}" y="${ly}" text-anchor="middle" dominant-baseline="middle" font-size="8.5" fill="var(--ink2)">${n}</text>`; }).join("")}
      <polygon points="${poly(c.v)}" fill="${hex(c.kind)}" fill-opacity="0.3" stroke="${hex(c.kind)}" stroke-width="2"/><polygon points="${poly(q)}" fill="var(--accent)" fill-opacity="0.18" stroke="var(--accent)" stroke-width="2" stroke-dasharray="4 3"/></svg>
      <div class="crt-leg"><span><i style="border-top:2px dashed var(--accent)"></i>${esc(craft)}</span><span><i style="background:${hex(c.kind)}"></i>${esc(c.name)}</span></div>`;
    $("crStats").innerHTML = `<tr><th></th><th>${esc(craft)} ↑</th><th>${esc(c.name)} ↑</th></tr>` + CR_AXES.map(([k, n], i) => { const why = CRS.q.why[k], miss = CRS.q.miss.includes(k), d = q[i] - c.v[i];
      return `<tr><td title="${esc(why || "")}">${n}</td><td><div class="crt-bar"><i style="width:${q[i]}%;background:var(--accent)"></i></div><b>${q[i]}</b></td><td><div class="crt-bar"><i style="width:${c.v[i]}%;background:${hex(c.kind)}"></i></div><b>${c.v[i]}</b> <small class="${Math.abs(d) < 8 ? "hint" : d > 0 ? "lo" : "hi"}">${d > 0 ? "−" : "+"}${Math.abs(d)}</small></td></tr>${why ? `<tr class="crt-why"><td colspan="3">${esc(miss ? "no data for this, scored as average" : why)}</td></tr>` : ""}`; }).join("");
    $("crLore").textContent = crLore(c);
    if (CRS.g) { CRS.g.setCreature(c, Object.fromEntries(CR_AXES.map(([k], i) => [k, c.v[i] / 99])), false); }
  };
  const select = id => { CRS.sel = id; showSel(); drawGrid(); };
  const drawGrid = () => { const qy = CRS.q_.trim().toLowerCase(); $("crGrid").innerHTML = CRS.ranked.filter(m => (CRS.kind === "all" || m.c.kind === CRS.kind) && (!qy || m.c.name.toLowerCase().includes(qy) || m.c.kind.toLowerCase().includes(qy)))
    .map(m => `<button class="crt-card ${m.c.id === CRS.sel ? "on" : ""}" data-id="${m.c.id}" style="--h:${CR_KINDS[m.c.kind].hue}"><i></i><span>${esc(m.c.name)}</span><b>${m.like}%</b></button>`).join("") || `<div class="hint">No creature matches that.</div>`;
    $("crGrid").querySelectorAll("[data-id]").forEach(b => b.onclick = () => { select(+b.dataset.id); $("crStage").scrollIntoView({ behavior: "smooth", block: "nearest" }); }); };
  $("crTop").innerHTML = CRS.ranked.slice(0, 5).map((m, i) => `<button class="crt-card ${i ? "" : "best"}" data-id="${m.c.id}" style="--h:${CR_KINDS[m.c.kind].hue}"><i></i><span>${i + 1}. ${esc(m.c.name)}</span><b>${m.like}%</b></button>`).join("");
  $("crTop").querySelectorAll("[data-id]").forEach(b => b.onclick = () => select(+b.dataset.id));
  $("crSearch").oninput = e => { CRS.q_ = e.target.value; drawGrid(); };
  $("crKinds").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; CRS.kind = b.dataset.k; [...$("crKinds").children].forEach(x => x.classList.toggle("on", x.dataset.k === CRS.kind)); drawGrid(); };
  showSel(); drawGrid();
  // the 3D view
  if (CRS.raf) cancelAnimationFrame(CRS.raf); if (CRS.g) { CRS.g.dispose(); CRS.g = null; }
  if (!CR3.supported()) { $("crCv").hidden = true; $("crFall").hidden = false; return; }
  const gen = CRS.gen = (CRS.gen || 0) + 1, qs = Object.fromEntries(CR_AXES.map(([k], i) => [k, CRS.q.v[i] / 99]));
  CR3.create($("crCv"), $("crStage")).then(g => {
    if (gen !== CRS.gen || S.tab !== "avatar" || !$("crCv")) return g.dispose();
    CRS.g = g; g.st.stats.quad = qs; g.st.mode = CRS.mode; const c = info(CRS.sel).c; g.setCreature(c, Object.fromEntries(CR_AXES.map(([k], i) => [k, c.v[i] / 99])), false);
    $("crMode").onclick = e => { const b = e.target.closest("[data-v]"); if (!b) return; CRS.mode = b.dataset.v; [...$("crMode").children].forEach(x => x.classList.toggle("on", x === b)); g.setMode(CRS.mode); };
    $("crFx").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; const k = b.dataset.k; g.st[k] = !g.st[k]; b.classList.toggle("on", g.st[k]); if (k === "pip" && $("crPip")) $("crPip").hidden = !g.st.pip; if (k === "auto") g.st.idle = 0; };
    let hudT = 0;
    const loop = now => { if (gen !== CRS.gen || S.tab !== "avatar" || !document.body.contains($("crCv") || document.body)) { if (CRS.g === g) { g.dispose(); CRS.g = null; } return; }
      g.frame(now); if (now - hudT > 120) { hudT = now; const h = g.st.hud; if ($("crHud")) $("crHud").innerHTML = `<span>speed <b>${(h.speed * 3.6).toFixed(0)}</b> km/h</span><span>bank <b>${(h.bank * 57.3).toFixed(0)}</b>°</span><span>climb <b>${h.climb >= 0 ? "+" : ""}${h.climb.toFixed(1)}</b> m/s</span>${h.trick ? `<span class="trk">${h.trick}!</span>` : ""}`; }
      CRS.raf = requestAnimationFrame(loop); };
    CRS.raf = requestAnimationFrame(loop);
  }).catch(e => { console.warn("creature 3D failed", e); if ($("crCv")) { $("crCv").hidden = true; $("crFall").hidden = false; } });
}
