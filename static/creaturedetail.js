// Level-3 detail layer: extra body parts, skin and plumage, and the motion that goes with them, added on top of every body plan (called from build() in creature3d.js).
//   window.CR_DETAIL_LEVEL: 0 = off, 1 = face and limbs, 2 = + skin and plumage, 3 = + life (default)
const CR_DETAIL = (K, L, c, level) => {
  if (!level) return;
  const { T, C, root } = K, both = f => [-1, 1].forEach(f), Z = new T.Vector3(0, 0, 1), L3 = level >= 3, a = L.a;
  const hasEagle = L.head === "eagle" || a === "bird";
  const noseHole = (parent, x, y, z, r = 0.012) => { const g = K.mesh(new T.IcosahedronGeometry(r, 0), C.edge, { noEdge: true, plain: true, op: 1 }); g.position.set(x, y, z); parent.add(g); return g; };
  // tiles laid over an ellipsoid like feathers, fur or scales: each lies flat on the surface with its long axis running rearwards, rows offset against each other
  const shell = (parent, cen, ra, rb, rd, o) => {
    const { size = 0.13, flat = 0.3, len = 1.5, tilt = 0.25, colors = [C.body, C.alt], x0 = -0.85, x1 = 0.85 } = o, pcs = [];
    const nx = Math.min(16, Math.max(5, Math.ceil(1.7 * ra / (size * 1.05)))), nr = Math.min(22, Math.max(8, Math.ceil(Math.PI * (rb + rd) / (size * 1.1))));
    for (let ix = 0; ix < nx; ix++) { const u = x0 + (x1 - x0) * ix / Math.max(1, nx - 1), s = Math.sqrt(Math.max(0.03, 1 - u * u));
      for (let ir = 0; ir < nr; ir++) { const ph = 2 * Math.PI * (ir + (ix % 2) * 0.5) / nr;
        const n = new T.Vector3(u / ra, s * Math.sin(ph) / rb, s * Math.cos(ph) / rd).normalize(), p = new T.Vector3(cen[0] + u * ra, cen[1] + rb * s * Math.sin(ph), cen[2] + rd * s * Math.cos(ph)).addScaledVector(n, 0.008);
        const tx = new T.Vector3(-1, 0, 0).addScaledVector(n, n.x).normalize(), tz = tx.clone().cross(n).normalize();
        const g = K.ell(size * len, size * flat, size * 0.8, colors[(ix + ir) % colors.length], { d: -1, wire: false }); g.position.copy(p); g.quaternion.setFromRotationMatrix(new T.Matrix4().makeBasis(tx, n, tz)); g.rotateZ(tilt); parent.add(g); pcs.push({ g, ix, ir }); } }
    return pcs; };
  const big = K.ells.filter(e => e.g.parent === root).sort((p, q) => q.sx * q.sy * q.sz - p.sx * p.sy * p.sz)[0];
  const skin = (colors, o = {}) => { if (level < 2 || !big) return;
    const g = new T.Group(); g.position.set(big.g.position.x, big.g.position.y, big.g.position.z); root.add(g);
    const pcs = shell(g, [0, 0, 0], big.sx, big.sy, big.sz, { colors, ...o });
    if (L3) { const y0 = g.position.y; K.ticks.push(t => { const br = 1 + 0.02 * Math.sin(t * 2.3); g.scale.set(1, br, br); pcs.forEach(p => { p.g.rotation.x = Math.sin(t * 2.6 + p.ix * 0.6 + p.ir * 0.4) * 0.07; }); }); } return g; };
  // arm and finger bones along a wing with knuckles and a claw, fanned out like the real thing
  const bones = (w, thick, fingers) => { const { pivot, side, s, ch } = w, mk = (p, q, r0, r1) => { const g = K.limb(p, q, r0, r1, C.edge); root.remove(g); pivot.add(g); return g; };
    const w1 = [0.05 * s, 0, 0.5 * s * side], w2 = [0.1 * ch, 0, s * side]; mk([0, 0, 0], w1, thick * 1.4, thick); mk(w1, w2, thick, thick * 0.5);
    const kn = K.ell(thick * 1.8, thick * 1.8, thick * 1.8, C.pale, { d: -1 }); kn.position.set(...w1); pivot.add(kn);
    const claw = K.cone(thick, thick * 5, 4, C.pale, { noEdge: true }); claw.position.set(w1[0] + thick, thick * 2, w1[2]); claw.rotation.z = 0.8; pivot.add(claw);
    (fingers || []).forEach(f => mk(w1, [-0.45 * ch, 0, f * s * side], thick * 0.7, thick * 0.3)); };
  // feather-kind wings: coverts on the root half and hinged primaries along the trailing edge that ripple behind the beat
  const primaries = w => { const { pivot, side, s, ch } = w;
    for (let row = 0; row < 2; row++) for (let i = 0; i < 7; i++) { const u = 0.08 + i * 0.1, g = K.ell(0.13 * ch, 0.018, 0.04 * s, row ? C.pale : C.alt, { d: -1 }); g.position.set(-0.05 * ch - row * 0.2 * ch, 0.015, u * s * side); g.rotation.y = -side * 0.3; pivot.add(g); }
    const prim = []; for (let i = 0; i < 9; i++) { const u = 0.3 + i * 0.075, len = (0.55 - 0.02 * i) * ch * (0.7 + 0.5 * u), f = K.cone(0.05 * ch + 0.02, len, 4, i % 2 ? C.alt : C.body), pv = new T.Group();
      pv.position.set(-0.28 * ch, 0, u * s * side); f.rotation.z = Math.PI / 2; f.position.set(-len / 2, 0, 0); f.scale.set(1, 1, 0.45); pv.add(f); pv.rotation.y = side * (-0.18 - i * 0.03); pivot.add(pv); prim.push(pv); }
    if (L3) K.ticks.push(t => prim.forEach((pv, i) => { const q = pivot.rotation.x * side; pv.rotation.z = -q * (0.12 + 0.05 * i); pv.rotation.y = side * (-0.18 - i * 0.03 + (0.04 + 0.01 * i) * Math.sin(t * 5 - i * 0.5)); })); };
  // ---- wings, every body plan ----
  K.wings.forEach(w => { if (!w.s || w.s < 0.5) return;
    if (w.kind === "feather") { if (level >= 1) bones(w, 0.018); if (level >= 2) primaries(w); }
    else if (w.kind === "membrane") { if (level >= 1) bones(w, 0.026, level >= 2 ? [0.55, 0.78] : []); } });
  // ---- bird and eagle-headed bodies ----
  if (hasEagle && K.heads[0]) { const head = K.heads[0];
    both(sd => { noseHole(head, 0.34, 0.03, sd * 0.045, 0.012); const ch = K.ell(0.1, 0.08, 0.05, C.pale, { d: 0, noEdge: true }); ch.position.set(0, -0.05, sd * 0.17); head.add(ch); const ear = K.cone(0.05, 0.1, 5, C.alt, { noEdge: true }); ear.rotation.x = sd * 1.3; ear.position.set(-0.1, 0, sd * 0.2); head.add(ear); });
    const low = K.cone(0.07, 0.24, 4, C.alt); low.rotation.z = -Math.PI / 2; low.position.set(0.3, -0.085, 0); head.add(low);
    const tg = K.cone(0.02, 0.16, 3, C.glow, { noEdge: true, glow: true }); tg.rotation.z = -Math.PI / 2; tg.position.set(0.3, -0.06, 0); head.add(tg);
    if (level >= 2) { const ruff = []; for (let i = 0; i < 9; i++) { const q = (i / 9 - 0.5) * 2.1, f = K.cone(0.035, 0.2, 4, i % 2 ? C.alt : C.pale); f.position.set(-0.12, 0.05 + Math.cos(q) * 0.06, Math.sin(q) * 0.2); f.rotation.z = Math.PI / 2 + 0.5; f.rotation.x = -q * 0.7; head.add(f); ruff.push(f); }
      if (L3) K.ticks.push(t => ruff.forEach((f, i) => { f.rotation.y = Math.sin(t * 3.1 + i * 0.7) * 0.18; })); }
    if (L3) K.ticks.push(t => { low.rotation.z = -Math.PI / 2 - Math.max(0, Math.sin(t * 2.6)) ** 6 * 0.35; tg.visible = Math.sin(t * 2.6) > -0.2; }); }
  // ---- dragon heads ----
  (K.dragonHeads || []).forEach(hg => { both(sd => noseHole(hg, 0.58, 0.02, sd * 0.05, 0.016));
    const nh = K.cone(0.05, 0.14, 5, C.pale); nh.position.set(0.55, 0.1, 0); nh.rotation.z = -0.3; hg.add(nh);
    both(sd => { const fr = K.cone(0.05, 0.28, 3, C.alt); fr.scale.z = 0.3; fr.rotation.x = sd * -1.0; fr.rotation.z = 0.8; fr.position.set(-0.1, 0.05, sd * 0.16); hg.add(fr); });
    for (let i = 0; i < 6; i++) both(sd => { const t = K.cone(0.016, 0.07, 3, C.pale, { noEdge: true }); t.rotation.z = Math.PI; t.position.set(0.18 + i * 0.07, -0.07, sd * 0.07); hg.add(t); });
    const tg = K.cone(0.025, 0.3, 3, C.glow, { noEdge: true, glow: true }); tg.rotation.z = -Math.PI / 2; tg.position.set(0.45, -0.08, 0); hg.add(tg);
    const fk = K.cone(0.02, 0.1, 3, C.glow, { noEdge: true, glow: true }); fk.rotation.z = -Math.PI / 2 - 0.4; fk.position.set(0.62, -0.06, 0.03); hg.add(fk); const fk2 = fk.clone(); fk2.rotation.z = -Math.PI / 2 + 0.4; fk2.position.z = -0.03; hg.add(fk2);
    if (level >= 2) both(sd => { for (let k = 0; k < 4; k++) { const hr = K.cone(0.05 - k * 0.008, 0.12, 6, C.pale); hr.position.set(-0.1 - k * 0.07, 0.17 + k * 0.05, sd * 0.1); hr.rotation.z = 0.85; hg.add(hr); } });
    if (L3) K.ticks.push(t => { const q = Math.max(0, Math.sin(t * 1.9)) ** 8; tg.scale.x = 1 + q * 0.9; tg.position.x = 0.45 + q * 0.14; fk.visible = fk2.visible = q > 0.2; }); });
  // ---- skin: feathers on birds and eagle heads, scales on dragons and fish, fur tufts on other four-legged bodies ----
  if (a === "bird" || L.head === "eagle") { const g = skin([C.body, C.alt, C.pale, C.alt], { x0: -0.75, x1: 0.8, size: 0.12, len: 1.6 });
    if (g && big) for (let i = 0; i < 14; i++) { const A = i / 14 * Math.PI * 2, f = K.cone(0.04, 0.18, 4, i % 2 ? C.alt : C.pale); f.position.set(big.sx * 0.85, big.sy * 0.5 + Math.sin(A) * 0.12, Math.cos(A) * 0.12); f.rotation.z = Math.PI / 2 + 0.7; g.add(f); } }
  else if (a === "dragon" || a === "fish") { const g = skin([C.body, C.alt, C.body, C.pale], { size: 0.15, len: 1.15, flat: 0.45, tilt: 0.3 });
    if (a === "dragon" && level >= 2 && big) for (let i = 0; i < 9; i++) { const p = K.box(0.15, 0.03, 0.34 - i * 0.02, C.pale); p.position.set(big.g.position.x + 0.8 - i * 0.2, big.g.position.y - big.sy * 0.95, 0); root.add(p); } }
  else if (a === "quad4") { skin([C.body, C.alt, C.body], { size: 0.12, len: 1.4, flat: 0.35 });
    if (level >= 1) both(sd => { [0.5, -0.55].forEach(x => { const m = K.ell(0.2, 0.2, 0.12, C.body, { d: 1 }); m.position.set(x, -0.1, sd * 0.27); root.add(m); }); }); }
  // chest rises and falls on every body plan that has a main body
  if (L3 && big && level < 2) K.ticks.push(t => { const br = 1 + 0.02 * Math.sin(t * 2.3); big.g.scale.set(big.sx, big.sy * br, big.sz * br); });
};
