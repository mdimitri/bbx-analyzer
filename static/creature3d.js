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
  function build(c) {
    const hue = CR_KINDS[c.kind].hue, dark = theme() === "dark", body = hsl(hue, 0.42, dark ? 0.48 : 0.56), alt = hsl(hue + 25, 0.55, dark ? 0.6 : 0.5), pale = hsl(hue - 10, 0.5, dark ? 0.78 : 0.4), glow = hsl(hue + 10, 0.9, 0.62);
    const edge = dark ? hsl(hue, 0.55, 0.86) : hsl(hue, 0.5, 0.16);
    const wings = [], tips = [], ticks = [], root = new T.Group(), owned = [];
    const mesh = (geo, col, o = {}) => { owned.push(geo); const g = new T.Group(), mt = new T.MeshStandardMaterial({ color: col, flatShading: true, roughness: 0.72, metalness: 0.05, side: o.double ? T.DoubleSide : T.FrontSide, transparent: o.op != null, opacity: o.op ?? 1, emissive: o.glow ? col : 0x000000, emissiveIntensity: o.glow ? 0.9 : 0 });
      g.add(new T.Mesh(geo, mt)); if (!o.noEdge) g.add(new T.LineSegments(new T.EdgesGeometry(geo, o.ang ?? 22), new T.LineBasicMaterial({ color: edge, transparent: true, opacity: o.eo ?? 0.85 }))); return g; };
    const place = (g, x, y, z, sx, sy, sz) => { g.position.set(x, y, z); if (sx !== undefined) g.scale.set(sx, sy ?? sx, sz ?? sx); return g; };
    const ell = (sx, sy, sz, col, o = {}) => place(mesh(new T.IcosahedronGeometry(1, o.d ?? 1), col, o), 0, 0, 0, sx, sy, sz);
    const cone = (r, h, seg = 6) => new T.ConeGeometry(r, h, seg);
    // a wing outline (span along +z, chord along +x), as a flat shape
    const outline = (kind, s, ch) => {
      const P = { membrane: [[0, 0.15], [0.35, 0.38], [1, 0.14], [0.86, -0.34], [0.7, -0.14], [0.6, -0.62], [0.4, -0.26], [0.24, -0.6], [0, -0.5]],
        feather: [[0, 0.3], [0.4, 0.46], [0.85, 0.28], [1, 0.05], [0.93, -0.12], [0.84, -0.04], [0.8, -0.3], [0.7, -0.2], [0.64, -0.46], [0.5, -0.32], [0.42, -0.52], [0.26, -0.36], [0, -0.3]],
        butter: [[0, 0.05], [0.3, 0.7], [0.8, 0.9], [1, 0.45], [0.7, 0.05], [0.9, -0.55], [0.55, -0.8], [0.2, -0.45]],
        leaf: [[0, 0.1], [0.3, 0.4], [0.7, 0.34], [1, 0.02], [0.7, -0.3], [0.3, -0.28], [0, -0.1]],
        fin: [[0, 0.3], [0.5, 0.55], [1, 0.0], [0.7, -0.3], [0.45, -0.1], [0.3, -0.5], [0, -0.35]],
        panel: [[0, 0.3], [1, 0.3], [1, -0.3], [0, -0.3]] }[kind];
      const sh = new T.Shape(); P.forEach(([a, b], i) => i ? sh.lineTo(a * s, b * ch) : sh.moveTo(a * s, b * ch)); sh.closePath();
      return new T.ShapeGeometry(sh).applyMatrix4(new T.Matrix4().makeBasis(new T.Vector3(0, 0, 1), new T.Vector3(1, 0, 0), new T.Vector3(0, 1, 0)));   // shape x (span) → +z, shape y (chord) → +x, normal → +y
    };
    const addWing = (px, py, pz, side, kind, s, ch, col, o = {}) => {
      const pivot = new T.Group(); pivot.position.set(px, py, pz); const m = mesh(outline(kind, s, ch), col, { double: true, op: o.op, eo: o.eo ?? 0.8, ang: 5 }); m.scale.z = side; pivot.add(m);
      if (o.bones !== false) { const g = new T.BufferGeometry().setFromPoints([new T.Vector3(0, 0, 0), new T.Vector3(0.05 * s, 0, 0.5 * s * side), new T.Vector3(0.1 * ch, 0, s * side)]); pivot.add(new T.Line(g, new T.LineBasicMaterial({ color: edge }))); owned.push(g); }
      const tip = new T.Object3D(); tip.position.set(0.1 * ch, 0, s * side); pivot.add(tip); tips.push(tip); root.add(pivot);
      wings.push({ pivot, side, amp: o.amp ?? 0.8, ph: o.ph ?? 0, tw: o.tw ?? 0.25 }); return pivot; };
    const wingPair = (px, py, pz, kind, s, ch, col, o) => { addWing(px, py, pz, 1, kind, s, ch, col, o); addWing(px, py, -pz, -1, kind, s, ch, col, o); };
    const legs = (n, x0, dx, y, z, len, col) => { for (let i = 0; i < n; i++) for (const sd of [-1, 1]) { const l = mesh(new T.CylinderGeometry(0.05, 0.035, len, 5), col, { noEdge: true }); l.position.set(x0 + i * dx, y - len * 0.35, sd * z); l.rotation.z = 0.5; l.rotation.x = sd * 0.25; root.add(l); } };
    const tailChain = (n, len, r0, col, y = 0, x0 = -0.8, wag = 0.5) => { const segs = []; let par = root;
      for (let i = 0; i < n; i++) { const seg = new T.Group(); seg.position.set(i ? -len : x0, i ? 0 : y, 0); const m = mesh(new T.ConeGeometry(r0 * (1 - i / (n + 1)), len * 1.15, 5).rotateZ(Math.PI / 2).translate(-len * 0.5, 0, 0), col); seg.add(m); par.add(seg); segs.push(seg); par = seg; }
      ticks.push(t => segs.forEach((s, i) => { s.rotation.y = Math.sin(t * 2.2 - i * 0.55) * wag * 0.35; s.rotation.z = Math.sin(t * 1.7 - i * 0.5) * 0.12; })); return segs; };
    const eyes = (x, y, z, r = 0.05) => [-1, 1].forEach(sd => root.add(place(mesh(new T.IcosahedronGeometry(r, 0), glow, { glow: true, noEdge: true }), x, y, sd * z)));

    switch (c.body) {
      case "dragon": {
        root.add(ell(1.15, 0.46, 0.5, body)); root.add(place(ell(0.5, 0.3, 0.42, pale), 0.35, -0.18, 0));
        const neck = [[0.95, 0.12], [1.3, 0.3], [1.6, 0.46]]; neck.forEach(([x, y], i) => root.add(place(ell(0.3 - i * 0.04, 0.2, 0.2, body), x, y, 0)));
        const head = mesh(new T.BoxGeometry(0.62, 0.26, 0.3), body); head.position.set(1.95, 0.5, 0); root.add(head); const snout = mesh(cone(0.13, 0.35), body); snout.position.set(2.35, 0.46, 0); snout.rotation.z = -Math.PI / 2; root.add(snout);
        [-1, 1].forEach(sd => { const h = mesh(cone(0.07, 0.4, 5), alt); h.position.set(1.8, 0.78, sd * 0.1); h.rotation.z = 0.7; root.add(h); }); eyes(2.12, 0.58, 0.14);
        tailChain(7, 0.42, 0.38, body, 0, -1.0, 1); legs(2, 0.2, -0.7, -0.1, 0.3, 0.45, body);
        wingPair(0.35, 0.3, 0.28, "membrane", 2.7, 1.5, alt, { amp: 0.75 }); break; }
      case "serpent": {
        const N = 16, segs = []; for (let i = 0; i < N; i++) { const r = 0.2 * (1 - i / (N + 4)) + 0.05, g = place(ell(r * 1.2, r, r, i % 2 ? body : alt, { d: 0 }), 0, 0, 0); root.add(g); segs.push(g); }
        const head = place(mesh(new T.OctahedronGeometry(0.28, 0), body), 0, 0, 0, 1.4, 0.8, 0.8); root.add(head); [-1, 1].forEach(sd => { const h = mesh(cone(0.05, 0.35, 5), pale); h.rotation.z = 0.8; h.position.set(0, 0.25, sd * 0.1); head.add(h); }); const eyeL = place(mesh(new T.IcosahedronGeometry(0.05, 0), glow, { glow: true, noEdge: true }), 0.18, 0.08, 0.14); head.add(eyeL);
        ticks.push(t => { for (let i = 0; i < N; i++) { const u = i * 0.34; segs[i].position.set(1.5 - i * 0.2, Math.sin(t * 3 - u * 2.4) * 0.28, Math.sin(t * 2.2 - u * 1.9) * 0.2); } head.position.set(1.65, Math.sin(t * 3) * 0.28, Math.sin(t * 2.2) * 0.2); head.rotation.z = Math.cos(t * 3) * 0.25; });
        wingPair(1.1, 0.2, 0.12, "feather", 1.5, 0.8, alt, { amp: 0.6 }); wingPair(0.2, 0.2, 0.12, "feather", 1.2, 0.7, alt, { amp: 0.6, ph: 1 }); break; }
      case "bird": {
        root.add(ell(0.85, 0.34, 0.3, body)); root.add(place(ell(0.5, 0.2, 0.22, pale), 0.2, -0.12, 0)); root.add(place(ell(0.28, 0.24, 0.24, body), 0.95, 0.18, 0)); const bk = mesh(cone(0.07, 0.3, 4), alt); bk.rotation.z = -Math.PI / 2; bk.position.set(1.3, 0.14, 0); root.add(bk); eyes(1.1, 0.26, 0.15, 0.04);
        for (let i = -2; i <= 2; i++) { const f = mesh(new T.BoxGeometry(0.7, 0.02, 0.1), i % 2 ? alt : body, { eo: 0.5 }); f.position.set(-1.15, 0, i * 0.11); f.rotation.y = i * 0.16; root.add(f); }
        if (/Phoenix|Fire|Bennu|Thunder|Fenghuang/.test(c.name)) for (let i = -1; i <= 1; i++) { const f = mesh(new T.BoxGeometry(1.1, 0.02, 0.07), glow, { glow: true, eo: 0.3 }); f.position.set(-1.45, 0.05 * i, i * 0.2); f.rotation.y = i * 0.3; root.add(f); }
        wingPair(0.25, 0.14, 0.2, "feather", 2.3, 1.0, alt, { amp: 0.85 }); break; }
      case "beast": {
        root.add(ell(0.95, 0.4, 0.34, body)); root.add(place(ell(0.38, 0.3, 0.3, body), 1.1, 0.35, 0)); root.add(place(mesh(new T.BoxGeometry(0.4, 0.2, 0.2), body), 1.45, 0.3, 0)); eyes(1.28, 0.45, 0.13, 0.04);
        [-1, 1].forEach(sd => { const e = mesh(cone(0.07, 0.25, 4), alt); e.position.set(1.05, 0.62, sd * 0.1); root.add(e); });
        for (const [x, z] of [[0.6, 0.18], [0.6, -0.18], [-0.55, 0.2], [-0.55, -0.2]]) { const l = mesh(new T.CylinderGeometry(0.06, 0.04, 0.55, 5), body, { noEdge: true }); l.position.set(x, -0.3, z); l.rotation.z = x > 0 ? 0.55 : -0.5; root.add(l); }
        tailChain(4, 0.28, 0.16, alt, 0.05, -0.95, 1.2); wingPair(0.2, 0.3, 0.2, "feather", 2.0, 1.0, c.name.includes("Bat") ? pale : alt, { amp: 0.8 }); break; }
      case "fairy": {
        root.add(place(mesh(new T.CylinderGeometry(0.1, 0.07, 0.6, 6), body), 0, 0, 0)); root.children[0].rotation.z = Math.PI / 2 - 0.3; root.add(place(ell(0.16, 0.16, 0.16, pale), 0.4, 0.14, 0));
        [-1, 1].forEach(sd => { const a = mesh(new T.CylinderGeometry(0.025, 0.02, 0.4, 4), pale, { noEdge: true }); a.position.set(0.1, -0.05, sd * 0.14); a.rotation.z = 1.1; root.add(a); const l = mesh(new T.CylinderGeometry(0.03, 0.02, 0.45, 4), pale, { noEdge: true }); l.position.set(-0.3, -0.12, sd * 0.06); l.rotation.z = 1.3; root.add(l); });
        wingPair(0.05, 0.1, 0.06, "butter", 0.9, 0.9, alt, { amp: 0.7, op: 0.78 }); wingPair(0.0, 0.05, 0.06, "leaf", 0.6, 0.5, glow, { amp: 0.7, op: 0.7, ph: 0.5 }); break; }
      case "insect": {
        root.add(place(ell(0.28, 0.24, 0.24, body), 0.45, 0, 0)); root.add(place(ell(0.22, 0.2, 0.2, alt), 0.8, 0.04, 0)); root.add(place(ell(0.5, 0.2, 0.2, body, { d: 0 }), -0.25, -0.02, 0));
        for (let i = 0; i < 3; i++) root.add(place(ell(0.22 - i * 0.04, 0.18 - i * 0.03, 0.18 - i * 0.03, i % 2 ? alt : body, { d: 0 }), -0.7 - i * 0.28, -0.04, 0));
        [-1, 1].forEach(sd => { for (let i = 0; i < 3; i++) { const l = mesh(new T.CylinderGeometry(0.015, 0.01, 0.5, 3), edge, { noEdge: true }); l.position.set(0.5 - i * 0.2, -0.28, sd * 0.2); l.rotation.x = sd * 0.5; root.add(l); } const an = mesh(new T.CylinderGeometry(0.01, 0.01, 0.5, 3), edge, { noEdge: true }); an.position.set(1.0, 0.25, sd * 0.1); an.rotation.z = -0.9; root.add(an); });
        eyes(0.95, 0.1, 0.12, 0.07); wingPair(0.4, 0.22, 0.1, "leaf", 1.3, 0.9, pale, { amp: 0.55, op: 0.55, bones: false }); wingPair(0.15, 0.2, 0.1, "leaf", 1.0, 0.7, pale, { amp: 0.55, op: 0.55, ph: 0.4, bones: false }); break; }
      case "bat": {
        root.add(ell(0.5, 0.3, 0.28, body)); root.add(place(ell(0.24, 0.22, 0.22, body), 0.55, 0.12, 0)); [-1, 1].forEach(sd => { const e = mesh(cone(0.08, 0.3, 4), pale); e.position.set(0.55, 0.42, sd * 0.12); root.add(e); }); eyes(0.72, 0.18, 0.1, 0.035);
        wingPair(0.05, 0.12, 0.2, "membrane", 2.3, 1.2, c.name.includes("Lich") || c.name.includes("Night") ? hsl(hue, 0.3, 0.3) : alt, { amp: 0.9 }); legs(1, -0.3, 0, -0.05, 0.1, 0.3, body); break; }
      case "orb": {
        const core = mesh(new T.IcosahedronGeometry(0.42, 1), glow, { glow: true, ang: 40 }); root.add(core); const shell = mesh(new T.IcosahedronGeometry(0.75, 1), pale, { op: 0.16, eo: 0.5, ang: 1 }); root.add(shell);
        const light = new T.PointLight(glow, 5, 8); root.add(light);
        ticks.push(t => { shell.rotation.y = t * 0.7; shell.rotation.x = t * 0.4; const k = 1 + Math.sin(t * 4) * 0.08; core.scale.setScalar(k); });
        wingPair(0, 0, 0.05, "leaf", 1.3, 1.0, glow, { amp: 0.5, op: 0.5, bones: false }); wingPair(-0.2, 0, 0.05, "fin", 1.9, 1.0, glow, { amp: 0.45, op: 0.35, ph: 0.8, bones: false });
        for (let i = 0; i < 3; i++) { const r = mesh(new T.ConeGeometry(0.12, 2 - i * 0.4, 4).rotateZ(Math.PI / 2).translate(-1.1 + i * 0.2, 0, 0), glow, { op: 0.4, eo: 0.3, double: true }); r.rotation.x = (i - 1) * 0.5; root.add(r); ticks.push(t => { r.rotation.y = Math.sin(t * 2 + i) * 0.3; }); } break; }
      case "humanoid": {
        root.add(place(mesh(new T.CylinderGeometry(0.2, 0.14, 0.9, 6), body), 0, 0, 0)); root.children[0].rotation.z = Math.PI / 2 - 0.25; root.add(place(ell(0.19, 0.19, 0.19, pale), 0.62, 0.22, 0));
        [-1, 1].forEach(sd => { const a = mesh(new T.CylinderGeometry(0.045, 0.035, 0.7, 5), pale, { noEdge: true }); a.position.set(0.3, -0.05, sd * 0.28); a.rotation.z = 0.8; a.rotation.x = sd * 0.5; root.add(a); const l = mesh(new T.CylinderGeometry(0.06, 0.04, 0.8, 5), body, { noEdge: true }); l.position.set(-0.6, -0.12, sd * 0.1); l.rotation.z = 1.35; root.add(l); });
        if (/Seraph|Archangel|Angelic|Cherub|Kinnara|Valkyrie/.test(c.name)) { const h = mesh(new T.TorusGeometry(0.2, 0.025, 5, 16), glow, { glow: true, noEdge: true }); h.position.set(0.62, 0.55, 0); h.rotation.x = Math.PI / 2; root.add(h); }
        else if (/Demon|Balrog|Ifrit|Harpy|Fallen|Banshee/.test(c.name)) [-1, 1].forEach(sd => { const h = mesh(cone(0.05, 0.3, 4), alt); h.position.set(0.7, 0.5, sd * 0.1); h.rotation.z = -0.4; root.add(h); });
        eyes(0.78, 0.26, 0.09, 0.03); wingPair(0.15, 0.2, 0.18, /Demon|Balrog|Ifrit|Harpy/.test(c.name) ? "membrane" : "feather", 2.4, 1.1, alt, { amp: 0.85 }); break; }
      case "construct": {
        root.add(mesh(new T.BoxGeometry(1.2, 0.5, 0.6), body, { ang: 30 })); root.add(place(mesh(new T.BoxGeometry(0.5, 0.4, 0.45), pale, { ang: 30 }), 0.85, 0.12, 0)); root.add(place(mesh(new T.IcosahedronGeometry(0.1, 0), glow, { glow: true, noEdge: true }), 1.12, 0.14, 0));
        const gear = mesh(new T.CylinderGeometry(0.22, 0.22, 0.08, 8), alt, { ang: 30 }); gear.position.set(-0.1, 0.1, 0.34); gear.rotation.x = Math.PI / 2; root.add(gear); ticks.push(t => { gear.rotation.y = t * 3; });
        const rod = mesh(new T.CylinderGeometry(0.03, 0.03, 0.8, 4), edge, { noEdge: true }); rod.rotation.z = Math.PI / 2; rod.position.set(-1.0, 0, 0); root.add(rod); tailChain(3, 0.2, 0.1, alt, 0, -1.15, 0.3);
        wingPair(0.1, 0.3, 0.3, "panel", 1.8, 1.1, alt, { amp: 0.45 }); wingPair(-0.3, 0.3, 0.3, "panel", 1.3, 0.9, body, { amp: 0.45, ph: 0.7 }); break; }
      case "ray": {
        root.add(place(mesh(new T.OctahedronGeometry(1, 0), body), 0, 0, 0, 1.2, 0.22, 0.8)); root.add(place(ell(0.35, 0.22, 0.28, pale), 0.7, 0.05, 0)); const tl = mesh(new T.CylinderGeometry(0.02, 0.05, 1.8, 4), alt, { noEdge: true }); tl.rotation.z = Math.PI / 2; tl.position.set(-1.9, 0, 0); root.add(tl); ticks.push(t => { tl.rotation.y = Math.sin(t * 2) * 0.3; });
        wingPair(0.0, 0.0, 0.2, "fin", 2.6, 2.4, alt, { amp: 0.4, bones: false, op: 0.92 }); break; }
      case "jelly": {
        const dome = mesh(new T.SphereGeometry(0.9, 10, 6, 0, Math.PI * 2, 0, Math.PI / 2), body, { op: 0.82, double: true }); root.add(dome); const core = mesh(new T.IcosahedronGeometry(0.28, 0), glow, { glow: true, noEdge: true }); core.position.y = 0.15; root.add(core);
        const ts = []; for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283, m = mesh(new T.CylinderGeometry(0.03, 0.01, 1.6, 4), pale, { noEdge: true }); m.position.set(Math.cos(a) * 0.6, -0.8, Math.sin(a) * 0.6); ts.push([m, a]); root.add(m); }
        ticks.push(t => { dome.scale.set(1 + Math.sin(t * 3) * 0.06, 1 - Math.sin(t * 3) * 0.1, 1 + Math.sin(t * 3) * 0.06); ts.forEach(([m, a]) => { m.rotation.z = Math.sin(t * 2.5 - a) * 0.25; m.rotation.x = Math.cos(t * 2 - a) * 0.25; }); });
        root.rotation.z = -Math.PI / 2; break; }
    }
    root.userData.owned = owned;
    return { root, wings, tips, ticks, baseWing: wings.length ? 1 : 0, vertical: c.body === "jelly" };
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
    const st = { az: 0.6, el: 0.22, dist: 7, auto: true, idle: 0, c: null, mode: "quad", wind: true, trails: true, F: null, rig: null, flap: 0, t: 0, stats: { quad: null, creature: null }, last: 0, hud: { speed: 0, bank: 0, climb: 0 } };
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
    let cw = 0, chh = 0; const resize = () => { const w = canvas.clientWidth, h = canvas.clientHeight; if (w === cw && h === chh) return; cw = w; chh = h; renderer.setSize(w, h, false); cam.aspect = w / Math.max(1, h); cam.updateProjectionMatrix(); };
    let curTheme = "";
    const applyTheme = () => { const th = theme(); if (th === curTheme) return; curTheme = th; const dark = th === "dark"; hemi.intensity = dark ? 0.95 : 1.25; windMat.blending = dark ? T.AdditiveBlending : T.NormalBlending; windMat.needsUpdate = true;
      grid.material.color.set(dark ? 0x58708a : 0x7d8794); trails.forEach(tr => { tr.l.material.blending = dark ? T.AdditiveBlending : T.NormalBlending; tr.l.material.needsUpdate = true; }); if (st.c) setCreature(st.c, st.stats.creature, true); };
    function disposeRig() { if (!st.rig) return; scene.remove(st.rig.root); st.rig.root.traverse(o => { if (o.material) { o.material.dispose && o.material.dispose(); } if (o.geometry) o.geometry.dispose(); }); st.rig = null; }
    function setCreature(c, cs, keep) {
      st.c = c; st.stats.creature = cs; disposeRig(); const rig = build(c), sc = SIZE[c.sz - 1]; rig.root.scale.setScalar(sc); rig.sc = sc; st.rig = rig; scene.add(rig.root); trails.forEach(tr => { scene.remove(tr.l); tr.g.dispose(); }); trails.length = 0; rig.tips.forEach(() => trails.push(mkTrail()));
      applyTrailTheme(); if (!keep) { st.dist = 8.6 * (0.7 + sc * 0.5); st.F = makeFlight(st.mode === "quad" ? st.stats.quad : cs, 1 + c.id); }
      grid.position.y = -2.4 * (0.7 + sc * 0.5); }
    const applyTrailTheme = () => { trails.forEach(tr => { tr.l.material.blending = theme() === "dark" ? T.AdditiveBlending : T.NormalBlending; }); };
    function setMode(m) { st.mode = m; if (st.c) st.F = makeFlight(m === "quad" ? st.stats.quad : st.stats.creature, 1 + st.c.id); }
    const q = new T.Quaternion(), eu = new T.Euler(0, 0, 0, "YZX"), tmp = new T.Vector3();
    function frame(now) {
      resize(); applyTheme(); const dt = Math.min(0.05, Math.max(0.001, (now - (st.last || now)) / 1000)); st.last = now; st.t += dt; const rig = st.rig; if (!rig || !st.F) { renderer.render(scene, cam); return; }
      const F = st.F.step(dt), sc = rig.sc, dark = curTheme === "dark";
      // wing beats: a slower flap for big and tireless creatures, a harder beat for strong ones; a gliding pause when it banks hard
      const cs = st.stats.creature, hz = (c => [0, 5.5, 4.2, 3.2, 2.2, 1.5][c.sz] * (c.body === "insect" ? 4.5 : c.body === "fairy" ? 3.5 : c.body === "orb" ? 0.6 : c.body === "ray" || c.body === "jelly" ? 0.35 : c.body === "bat" ? 1.4 : 1))(st.c) * (1.3 - 0.5 * cs.end) * (0.85 + 0.4 * (st.F.stat.pwr)) * (1 + 0.25 * Math.max(0, Math.min(1, F.climb / 8)));
      st.flap += dt * hz * 2 * Math.PI; const glide = c => 1 - 0.55 * Math.max(0, Math.min(1, Math.abs(F.bank) / 1.1)) * (c.body === "bird" || c.body === "humanoid" ? 1 : 0.4);
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
      st.hud = { speed: sp, bank: F.bank, climb: F.climb, trick: F.trick && F.trick.kind };
    }
    // orbit and zoom
    canvas.addEventListener("pointerdown", e => { st.drag = { x: e.clientX, y: e.clientY, az: st.az, el: st.el }; st.idle = 0; canvas.setPointerCapture(e.pointerId); canvas.classList.add("grab"); });
    canvas.addEventListener("pointermove", e => { if (!st.drag) return; st.az = st.drag.az - (e.clientX - st.drag.x) * 0.008; st.el = Math.max(-1.2, Math.min(1.45, st.drag.el + (e.clientY - st.drag.y) * 0.008)); st.idle = 0; });
    const up = () => { st.drag = null; canvas.classList.remove("grab"); }; canvas.addEventListener("pointerup", up); canvas.addEventListener("pointercancel", up);
    canvas.addEventListener("wheel", e => { e.preventDefault(); st.dist = Math.max(2.2, Math.min(22, st.dist * 1.1 ** Math.sign(e.deltaY))); st.idle = 0; }, { passive: false });
    canvas.addEventListener("dblclick", () => { st.az = 0.6; st.el = 0.22; if (st.c) st.dist = 8.6 * (0.7 + SIZE[st.c.sz - 1] * 0.5); });
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
  if (S.tab !== "creature") return;
  try { Plotly.purge("main"); } catch (e) {} $("main").style.display = "none";
  $("controls").innerHTML = tbar(`<h3>Creature match</h3><span class="hint">a bit of fun: which creature of myth flies most like your quad? · scores are 0–99, higher is better (↑) on every axis</span>`, []);
  const craft = (CRS.R.craft || "Your quad"), best = CRS.ranked[0];
  const L = $("findings"); L.innerHTML = `<div class="crt">
    <div class="crt-main">
      <div class="crt-stage" id="crStage"><canvas id="crCv"></canvas>
        <div class="crt-title"><div class="crt-k" id="crKind"></div><div class="crt-n" id="crName"></div></div>
        <div class="crt-tools"><span class="seg" id="crMode"><button data-v="quad" class="on" title="Animate with the quad's own flight scores">Flies like ${esc(craft)}</button><button data-v="creature" title="Animate with the creature's own scores">Flies like itself</button></span>
          <span class="chips" id="crFx">${chip("wind", "Wind", true)}${chip("trails", "Wing trails", true)}${chip("auto", "Auto-rotate", true)}</span></div>
        <div class="crt-hud" id="crHud"></div><div class="crt-hint">drag = orbit · wheel = zoom · double-click = reset</div></div>
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
    if (gen !== CRS.gen || S.tab !== "creature" || !$("crCv")) return g.dispose();
    CRS.g = g; g.st.stats.quad = qs; g.st.mode = CRS.mode; const c = info(CRS.sel).c; g.setCreature(c, Object.fromEntries(CR_AXES.map(([k], i) => [k, c.v[i] / 99])), false);
    $("crMode").onclick = e => { const b = e.target.closest("[data-v]"); if (!b) return; CRS.mode = b.dataset.v; [...$("crMode").children].forEach(x => x.classList.toggle("on", x === b)); g.setMode(CRS.mode); };
    $("crFx").onclick = e => { const b = e.target.closest("[data-k]"); if (!b) return; const k = b.dataset.k; g.st[k] = !g.st[k]; b.classList.toggle("on", g.st[k]); if (k === "auto") g.st.idle = 0; };
    let hudT = 0;
    const loop = now => { if (gen !== CRS.gen || S.tab !== "creature" || !document.body.contains($("crCv") || document.body)) { if (CRS.g === g) { g.dispose(); CRS.g = null; } return; }
      g.frame(now); if (now - hudT > 120) { hudT = now; const h = g.st.hud; if ($("crHud")) $("crHud").innerHTML = `<span>speed <b>${(h.speed * 3.6).toFixed(0)}</b> km/h</span><span>bank <b>${(h.bank * 57.3).toFixed(0)}</b>°</span><span>climb <b>${h.climb >= 0 ? "+" : ""}${h.climb.toFixed(1)}</b> m/s</span>${h.trick ? `<span class="trk">${h.trick}!</span>` : ""}`; }
      CRS.raf = requestAnimationFrame(loop); };
    CRS.raf = requestAnimationFrame(loop);
  }).catch(e => { console.warn("creature 3D failed", e); if ($("crCv")) { $("crCv").hidden = true; $("crFall").hidden = false; } });
}
