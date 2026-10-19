// The splash's toy world: terrain, a catalogue of 100 object kinds, how they are placed, and the collision shapes the
// autopilot has to respect. Pure data and maths (no rendering), so the flight simulation in demo.js and the Three.js
// renderer in world3d.js use exactly the same world, and a test can fly it headless.
//
// Coordinates: x, y horizontal, z up, metres. Every object kind is built from a few primitives in its own frame
// (z = 0 is the ground, the shape's bottom). Primitive: { k, x, y, z, ... } with
//   box   sx sy sz (full extents)          cyl/cone  r (base) r2 (top) h seg (ax:"x"|"y" lays it on its side, centred)   sph  r   dome  r (a half sphere)
//   rod   dx dy dz (the vector it spans, centred on x y z) t (thickness)
//   prism sx sy sz (gable roof, ridge along x)   wedge sx sy sz (ramp rising along +x)   tor R t (ring in the x–z plane)
// plus c (colour), rot (yaw, rad) and col:false for pieces that must not count as obstacles (leaves are, a ring is not).
const { WORLD_SEED, WORLD_KINDS, WORLD_AGENTS, makeWorld } = (() => {   // wrapped: the palette names (RED, …) would clash with other scripts
const WORLD_SEED = 20261012;

function _rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
function _hash(ix, iy, s) { let h = (Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(s, 1442695041)) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); h ^= h >>> 16; return (h >>> 0) / 4294967296; }
function _vnoise(x, y, s) {   // smooth value noise, 0…1
  const ix = Math.floor(x), iy = Math.floor(y), fx = x - ix, fy = y - iy, q = t => t * t * t * (t * (t * 6 - 15) + 10), u = q(fx), v = q(fy);
  const a = _hash(ix, iy, s), b = _hash(ix + 1, iy, s), c = _hash(ix, iy + 1, s), d = _hash(ix + 1, iy + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
const _sstep = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// ---- primitive constructors (z = bottom) ----
const _B = (x, y, z, sx, sy, sz, c, o = {}) => ({ k: "box", x, y, z, sx, sy, sz, c, ...o });
const _C = (x, y, z, r, h, c, o = {}) => ({ k: "cyl", x, y, z, r, r2: o.r2 ?? r, h, seg: o.seg ?? 14, c, ...o });
const _S = (x, y, z, r, c, o = {}) => ({ k: "sph", x, y, z, r, c, ...o });
const _P = (x, y, z, sx, sy, sz, c, o = {}) => ({ k: "prism", x, y, z, sx, sy, sz, c, ...o });
const _W = (x, y, z, sx, sy, sz, c, o = {}) => ({ k: "wedge", x, y, z, sx, sy, sz, c, ...o });
const _T = (x, y, z, R, t, c, o = {}) => ({ k: "tor", x, y, z, R, t, c, col: false, ...o });
const _R = (x1, y1, z1, x2, y2, z2, t, c, o = {}) => ({ k: "rod", x: (x1 + x2) / 2, y: (y1 + y2) / 2, z: (z1 + z2) / 2, dx: x2 - x1, dy: y2 - y1, dz: z2 - z1, t, c, col: false, ...o });
const _D = (x, y, z, r, c, o = {}) => ({ k: "dome", x, y, z, r, c, ...o });
const _WH = (x, y, r, w, c = 0x222222) => _C(x, y, r, r, w, c, { ax: "y", ctr: true, seg: 12, col: false });   // a wheel: axle along y, centre at height r
const GLASS = 0x6aa6c8, CONC = 0xb9b4a8, WHITE = 0xf1ede4, RED = 0xc8412f, BLUE = 0x2f5fa8, YEL = 0xe8b830, GRN = 0x3f8f4a, DARK = 0x3a3d44, WOOD = 0x8a5a36, ORG = 0xe7762b, GREY = 0x8d939b;

// ---- the catalogue: exactly 100 kinds ----
function _catalogue() {
  const K = [];
  const add = (name, cat, role, prims, extra = {}) => K.push({ name, cat, role, prims, ...extra });
  const house = (w, d, h, wall, roof, rh = 0.55 * d) => [_B(0, 0, 0, w, d, h, wall), _P(0, 0, h, w + 0.8, d + 0.8, rh, roof), _B(w * 0.2, d * 0.5 + 0.02, 0, 1.0, 0.1, 1.9, WOOD, { col: false }),
    _B(w * 0.2, d * 0.5 + 0.45, 0, 1.8, 0.9, 0.18, CONC, { col: false }), _B(-w * 0.22, d * 0.5 + 0.02, h * 0.5, 1.1, 0.1, 1.0, GLASS, { col: false }), _B(-w * 0.22, d * 0.5 + 0.12, h * 0.5 - 0.1, 1.4, 0.24, 0.1, CONC, { col: false }),
    _B(w * 0.3, -d * 0.2, h + rh * 0.35, 0.8, 0.8, rh * 0.9, 0x7a5242), _B(w * 0.3, -d * 0.2, h + rh * 0.35 + rh * 0.9, 1.0, 1.0, 0.18, CONC, { col: false })];
  // houses (12)
  add("Cottage", "house", "house", house(7, 6, 3.2, 0xe9dcc3, RED));
  add("Bungalow", "house", "house", [_B(0, 0, 0, 11, 5.5, 2.8, 0xd9c6a2), _P(0, 0, 2.8, 12, 6.4, 1.6, 0x6b4a3a), _B(3, 0, 3.2, 0.9, 0.9, 2.4, 0x7a5242)]);
  add("Townhouse", "house", "house", house(5, 6, 8.5, 0xb55a3c, 0x3d3f48, 2.4));
  add("Villa", "house", "house", [_B(0, 0, 0, 10, 8, 4, 0xf0e4cf), _P(0, 0, 4, 11, 8.8, 2.6, 0xc0623a), _B(0, 4.02, 0, 2.4, 0.12, 2.6, WOOD, { col: false }), _B(0, 4.5, 0, 4, 1.4, 0.2, CONC, { col: false }), _C(-5.5, 3, 0, 1.8, 7, 0xf0e4cf, { seg: 12 }), _C(-5.5, 3, 7, 2.3, 2.2, 0xc0623a, { r2: 0, seg: 12 })]);
  add("Barn", "house", "house", [_B(0, 0, 0, 12, 8, 4, RED), _P(0, 0, 4, 12.6, 8.8, 3.2, 0x4a4040), _B(0, 4.02, 0, 3.6, 0.12, 3.2, WHITE, { col: false })]);
  add("A-frame cabin", "house", "house", [_P(0, 0, 0, 7, 7, 6.2, 0x7a4f32), _B(0, 3.6, 0, 1.2, 0.1, 2.0, GLASS, { col: false })]);
  add("Log cabin", "house", "house", [_B(0, 0, 0, 8, 6, 3, 0x9a6a40), _P(0, 0, 3, 9, 7, 1.8, 0x3f6b3a), _B(0, 4.2, 0, 8, 2.4, 0.5, 0x8a5a36, { col: false }), _B(2.5, -1, 3.5, 0.8, 0.8, 2.2, 0x6a6a6a)]);
  add("Garage", "house", "house", [_B(0, 0, 0, 6.5, 6, 3, 0xcfd2d6), _B(0, 3.02, 0, 4.6, 0.12, 2.5, 0x888d95, { col: false }), _B(0, 0, 3, 6.8, 6.4, 0.4, 0x555a62)]);
  add("Shed", "house", "house", [_B(0, 0, 0, 3.5, 3, 2.4, 0xa47b52), _W(0, 0, 2.4, 3.9, 3.3, 0.5, 0x4a4a4a, { rot: Math.PI })]);
  add("Round hut", "house", "house", [_C(0, 0, 0, 3.4, 2.6, 0xd8c39a), _C(0, 0, 2.6, 4.1, 2.6, 0x9a7b3c, { r2: 0, seg: 14 })]);
  add("Dome house", "house", "house", [_C(0, 0, 0, 5.2, 0.5, 0xcfd6da, { seg: 16 }), _D(0, 0, 0.5, 5.0, 0xe8eef2), _B(0, 4.6, 0, 1.8, 1.4, 1.9, 0xdfe6ea), _B(0, 5.32, 0, 0.9, 0.06, 1.6, WOOD, { col: false }), _B(0, 0, 5.4, 0.6, 0.6, 0.35, DARK, { col: false })]);
  add("Modern house", "house", "house", [_B(0, 0, 0, 10, 7, 3.2, 0xe8e8e6), _B(1.5, 0, 3.2, 7, 6.4, 3, 0x3b4048), _B(-2, 3.55, 0.4, 5, 0.12, 2.4, GLASS, { col: false }), _B(1.5, 3.4, 3.6, 5.6, 0.12, 2, GLASS, { col: false })]);
  // buildings (12)
  const winRows = (w, d, h, n, col) => { const o = []; for (let i = 1; i <= n; i++) o.push(_B(0, 0, i * h / (n + 1), w + 0.14, d + 0.14, 0.45, col, { col: false })); return o; };
  add("Office tower", "building", "tall", [_B(0, 0, 0, 9, 9, 26, GLASS), ...winRows(9, 9, 26, 8, 0x3f6f95), _B(0, 0, 26, 9.6, 9.6, 0.6, DARK)]);
  add("Skyscraper", "building", "tall", [_B(0, 0, 0, 11, 11, 14, 0xc9ced4), _B(0, 0, 14, 8, 8, 10, 0xb7bec6), _B(0, 0, 24, 5, 5, 8, 0xa3acb6), _B(0, 0, 14, 8.6, 8.6, 0.3, DARK, { col: false }), _B(0, 0, 24, 5.6, 5.6, 0.3, DARK, { col: false }), _B(0, 0, 32, 5.4, 5.4, 0.3, DARK, { col: false }), _R(0, 0, 32, 0, 0, 38.5, 0.35, RED)]);
  add("Apartment block", "building", "tall", [_B(0, 0, 0, 14, 8, 15, 0xc8a48a), ...winRows(14, 8, 15, 4, 0xe8dcc8), _B(0, 0, 15, 14.4, 8.4, 0.5, 0x6a5a50)]);
  add("Warehouse", "building", "tall", [_B(0, 0, 0, 20, 11, 6, 0x9ca8b4), _P(0, 0, 6, 20.6, 11.8, 2.2, 0x6f7a86), _B(0, 5.52, 0, 6, 0.12, 4.5, 0x3d5a80, { col: false })]);
  add("Church", "building", "tall", [_B(0, 0, 0, 7, 12, 5.5, 0xe6dfd0), _P(0, -0.5, 5.5, 7.6, 13, 3.2, 0x7a4a3a), _B(0, 6.5, 0, 4, 4, 11, 0xe6dfd0), _C(0, 6.5, 11, 3, 6, 0x4a5568, { r2: 0, seg: 4, rot: Math.PI / 4 })]);
  add("Clock tower", "building", "tall", [_B(0, 0, 0, 5, 5, 16, 0xb99a6b), _B(0, 0, 16, 6, 6, 4, 0xb99a6b), _B(0, 3.02, 17, 3.2, 0.2, 3.2, WHITE, { col: false }), _C(0, 0, 20, 4.6, 5, 0x3f6b5a, { r2: 0, seg: 4, rot: Math.PI / 4 })]);
  add("Factory", "building", "tall", [_B(0, 0, 0, 16, 10, 6, 0xa86a50), _P(0, 0, 6, 16.6, 10.8, 2, 0x555555), _C(-5, -2, 6, 1.2, 12, 0x8a8a8a, { r2: 0.9 }), _C(-1.5, -2, 6, 1.0, 9, 0x8a8a8a, { r2: 0.8 })]);
  add("Pagoda", "building", "tall", [_B(0, 0, 0, 6, 6, 3, 0xa83a2e), _P(0, 0, 3, 9, 9, 1.6, 0x3a3a3a), _B(0, 0, 4.4, 4.6, 4.6, 3, 0xa83a2e), _P(0, 0, 7.4, 7, 7, 1.4, 0x3a3a3a), _B(0, 0, 8.6, 3, 3, 2.6, 0xa83a2e), _C(0, 0, 11.2, 4, 3.6, 0x3a3a3a, { r2: 0, seg: 4, rot: Math.PI / 4 })]);
  add("Lighthouse", "building", "tall", [_C(0, 0, 0, 3.2, 6, WHITE, { r2: 2.6 }), _C(0, 0, 6, 2.6, 6, RED, { r2: 2.2 }), _C(0, 0, 12, 2.2, 6, WHITE, { r2: 1.9 }), _C(0, 0, 18, 2.1, 1, DARK, { r2: 2.4 }), _C(0, 0, 19, 1.3, 1.6, YEL, { seg: 8, col: false }), _C(0, 0, 20.6, 2.2, 1.6, RED, { r2: 0 })]);
  add("Water tower", "building", "tall", [..."ABCD".split("").map((_, i) => _R(Math.cos(i * 1.5708 + 0.785) * 3.0, Math.sin(i * 1.5708 + 0.785) * 3.0, 0, Math.cos(i * 1.5708 + 0.785) * 2.0, Math.sin(i * 1.5708 + 0.785) * 2.0, 11, 0.4, 0x6f7a86)), _R(2.4, 0, 2, -2.4, 0, 7, 0.1, 0x6f7a86), _R(-2.4, 0, 2, 2.4, 0, 7, 0.1, 0x6f7a86), _C(0, 0, 11, 3.6, 5, 0x6f8fa8), _C(0, 0, 16, 3.7, 1.8, 0x4a6a85, { r2: 0, seg: 14 })]);
  add("Radio mast", "building", "tall", [_C(0, 0, 0, 0.35, 28, 0xcfd2d6, { r2: 0.18, seg: 8 }), ...[-1, 1].flatMap(sd => [_R(sd * 0.1, 0, 14, 0, sd * 2.6, 14, 0.08, 0xcfd2d6), _R(0, sd * 2.6, 14, 0, 0, 22, 0.05, 0xcfd2d6)]), _B(0, 0, 14, 5, 0.2, 0.2, 0xcfd2d6, { col: false }), _B(0, 0, 20, 3.4, 0.2, 0.2, 0xcfd2d6, { col: false }), _S(0, 0, 28, 0.5, RED, { col: false })]);
  add("Shopping mall", "building", "tall", [_B(0, 0, 0, 22, 12, 5, 0xd7d0c0), _B(0, 6.02, 0, 16, 0.12, 3.4, GLASS, { col: false }), _B(0, 0, 5, 22.6, 12.6, 0.5, 0x6a6e76), _B(8, 6.2, 5.6, 5, 0.3, 2.2, ORG, { col: false })]);
  // trees (10)
  const trunk = (h, r = 0.35, c = 0x6b4a2f) => _C(0, 0, 0, r, h, c, { r2: r * 0.8, seg: 8 });
  add("Pine", "tree", "tree", [trunk(2), _C(0, 0, 1.5, 2.3, 3.2, 0x2f6b3a, { r2: 0.9, seg: 9 }), _C(0, 0, 3.8, 1.8, 3.0, 0x357a40, { r2: 0.6, seg: 9 }), _C(0, 0, 6, 1.2, 2.6, 0x3b8847, { r2: 0, seg: 9 })]);
  add("Tall pine", "tree", "tree", [trunk(3, 0.4), _C(0, 0, 2.5, 2.6, 4, 0x2a6038, { r2: 1, seg: 9 }), _C(0, 0, 5.8, 2.0, 3.8, 0x2f6b3a, { r2: 0.7, seg: 9 }), _C(0, 0, 8.8, 1.4, 3.4, 0x357a40, { r2: 0, seg: 9 })]);
  add("Oak", "tree", "tree", [trunk(3, 0.45), _S(0, 0, 2.2, 3.2, 0x4f9a46), _S(1.6, 0.6, 3.2, 2.1, 0x5aa84e), _S(-1.5, -0.7, 3.4, 2.0, 0x468c3f)]);
  add("Birch", "tree", "tree", [trunk(4.5, 0.2, 0xe9e6dc), _S(0, 0, 3.6, 2.0, 0x8bc34a), _S(0.7, 0.4, 4.8, 1.4, 0x9ccc65)]);
  add("Palm", "tree", "tree", [_C(0, 0, 0, 0.35, 6, 0x9b7a4a, { r2: 0.22, seg: 8 }), ...[0, 1, 2, 3, 4, 5].map(i => _B(Math.cos(i * 1.047) * 1.4, Math.sin(i * 1.047) * 1.4, 6, 3.2, 0.5, 0.25, 0x3f9a4a, { rot: i * 1.047, col: false })), _S(0, 0, 5.7, 0.6, 0x3f9a4a, { col: false })]);
  add("Bush", "tree", "tree", [_S(0, 0, 0, 1.3, 0x3f7f3a), _S(1.0, 0.4, 0, 0.9, 0x4a8f43), _S(-0.9, -0.4, 0, 1.0, 0x357535)]);
  add("Dead tree", "tree", "tree", [_C(0, 0, 0, 0.45, 5, 0x5a4a3c, { r2: 0.2, seg: 7 }), _B(0.9, 0, 3.2, 2.2, 0.25, 0.25, 0x5a4a3c, { rot: 0.5 }), _B(-0.8, 0.2, 3.9, 1.8, 0.2, 0.2, 0x5a4a3c, { rot: -0.4 })]);
  add("Cypress", "tree", "tree", [trunk(1.2, 0.3), _C(0, 0, 1, 1.3, 8, 0x2c5a3a, { r2: 0, seg: 8 })]);
  add("Cherry tree", "tree", "tree", [trunk(2.6, 0.4, 0x5a3a2a), _S(0, 0, 2.0, 2.8, 0xf2a6c0), _S(1.4, 0.5, 2.6, 1.8, 0xf7bcd0)]);
  add("Toy mushroom", "tree", "tree", [_C(0, 0, 0, 0.9, 2.4, 0xf1e8d6, { r2: 0.7 }), _D(0, 0, 2.0, 2.4, 0xd33b3b), _S(0.9, 0.5, 4.0, 0.35, 0xf6f6f6, { col: false }), _S(-0.8, -0.6, 3.9, 0.3, 0xf6f6f6, { col: false })]);
  // ramps and skate things (12). curved ones are a quarter circle cut into slices, each a wedge on a block, so the surface is smooth and the footprint is solid.
  const curve = (x0, w, R, n, c, flip = false) => { const o = []; for (let i = 0; i < n; i++) { const a0 = i / n * Math.PI / 2, a1 = (i + 1) / n * Math.PI / 2, xa = R * Math.sin(a0), xb = R * Math.sin(a1), ha = R * (1 - Math.cos(a0)), hb = R * (1 - Math.cos(a1)), cx = x0 + (flip ? -1 : 1) * (xa + xb) / 2;
    if (ha > 0.02) o.push(_B(cx, 0, 0, xb - xa + 0.02, w, ha, c)); o.push(_W(cx, 0, ha, xb - xa + 0.02, w, hb - ha, c, flip ? { rot: Math.PI } : {})); } return o; };
  add("Kicker", "ramp", "ramp", [_W(0, 0, 0, 5, 3.4, 1.6, ORG)]);
  add("Big kicker", "ramp", "ramp", [_W(0, 0, 0, 9, 5, 3.6, YEL), _B(-4.2, 0, 0, 0.6, 5, 0.01, 0x777777, { col: false })]);
  add("Quarter-pipe", "ramp", "ramp", [...curve(-1.8, 6, 3.6, 6, 0x8a8f98), _B(2.0, 0, 0, 0.4, 6, 3.6, 0x6f747c), _R(1.8, -3, 3.65, 1.8, 3, 3.65, 0.16, 0xcfd2d6), _R(1.9, -2.9, 0, 1.9, -2.9, 3.6, 0.1, 0x555a62), _R(1.9, 2.9, 0, 1.9, 2.9, 3.6, 0.1, 0x555a62)]);
  add("Half-pipe", "ramp", "ramp", [...curve(2, 7, 3, 5, 0x8a8f98), ...curve(-2, 7, 3, 5, 0x8a8f98, true), _B(0, 0, 0, 4.04, 7, 0.3, 0x6f747c), _R(5.05, -3.5, 3.05, 5.05, 3.5, 3.05, 0.15, 0xcfd2d6), _R(-5.05, -3.5, 3.05, -5.05, 3.5, 3.05, 0.15, 0xcfd2d6)]);
  add("Spine", "ramp", "ramp", [_W(-2.6, 0, 0, 5, 6, 2.6, ORG), _W(2.6, 0, 0, 5, 6, 2.6, ORG, { rot: Math.PI })]);
  add("Double-up", "ramp", "ramp", [_W(-4, 0, 0, 4, 4, 1.4, YEL), _W(4, 0, 0, 5, 4, 2.2, ORG), _B(0, 0, 0, 3, 4, 0.2, 0x555555)]);
  add("Step-up", "ramp", "ramp", [_W(-3.5, 0, 0, 4, 3.6, 1.2, YEL), _B(1.5, 0, 0, 5, 3.6, 2.4, 0x9a9fa8), _B(5, 0, 0, 2, 3.6, 1.2, 0x9a9fa8)]);
  add("Table-top", "ramp", "ramp", [_W(-5, 0, 0, 4, 4.2, 1.8, YEL), _B(0, 0, 0, 6, 4.2, 1.8, 0x9a9fa8), _W(5, 0, 0, 4, 4.2, 1.8, YEL, { rot: Math.PI })]);
  add("Handrail", "ramp", "ramp", [_C(-3, 0, 0, 0.12, 1.1, 0x555555, { seg: 6 }), _C(0, 0, 0, 0.12, 1.1, 0x555555, { seg: 6 }), _C(3, 0, 0, 0.12, 1.1, 0x555555, { seg: 6 }), _B(0, 0, 1.1, 7, 0.14, 0.14, 0xcfd2d6), _B(0, 0, 0, 7.6, 1.0, 0.05, 0x777777, { col: false })]);
  add("Funbox", "ramp", "ramp", [_B(0, 0, 0, 5, 5, 1.2, 0x9a9fa8), _W(-4.5, 0, 0, 4, 5, 1.2, YEL), _W(4.5, 0, 0, 4, 5, 1.2, YEL, { rot: Math.PI })]);
  add("Bank wedge", "ramp", "ramp", [_W(0, 0, 0, 12, 4, 1.6, 0x7a8089)]);
  add("Wall ride", "ramp", "ramp", [_B(0, 0, 0, 10, 0.6, 5, 0x7f8690), _W(-3, 2.4, 0, 6, 3, 1.0, YEL, { rot: 0 })]);
  // gates (8): opening is in the x–z plane, fly through along y
  const gate = (w, h, c, post = 0.28, beam = null) => [_C(-w / 2, 0, 0, post, h, c, { seg: 8 }), _C(w / 2, 0, 0, post, h, c, { seg: 8 }), _B(0, 0, h - 0.1, w + post * 2, post * 1.4, post * 1.6, beam ?? c)];
  const G = (name, prims, w, h) => add(name, "gate", "gate", prims, { gate: { w, h } });
  G("Square gate", gate(6.4, 5.2, RED, 0.28, 0xf2f2f2), 6.4, 5.2);
  G("Arch gate", [...gate(8, 6.2, BLUE), _B(0, 0, 6.2, 8.8, 0.5, 0.5, BLUE), _B(0, 0, 6.7, 7, 0.5, 0.5, 0xf2f2f2, { col: false })], 8, 6.2);
  G("Hoop on stand", [_C(0, 0, 0, 0.18, 2.0, GREY, { seg: 6 }), _T(0, 0, 2.0, 2.8, 0.22, ORG), _C(0, 0, 0, 0.9, 0.2, 0x555555, { seg: 10, col: false })], 4.6, 4.6);
  G("Double hoop", [_C(-4, 0, 0, 0.16, 1.6, GREY, { seg: 6 }), _T(-4, 0, 1.6, 2.4, 0.2, YEL), _C(4, 0, 0, 0.16, 1.6, GREY, { seg: 6 }), _T(4, 0, 1.6, 2.4, 0.2, GRN)], 4, 4);
  G("Triangle gate", [_C(-3.2, 0, 0, 0.28, 5.4, 0x6a4a9a, { seg: 8 }), _C(3.2, 0, 0, 0.28, 5.4, 0x6a4a9a, { seg: 8 }), _B(0, 0, 5.2, 7.2, 0.4, 0.5, 0x8a6ac0), _C(0, 0, 5.6, 1.2, 1.9, 0xf2f2f2, { r2: 0, seg: 3, col: false })], 6.4, 5);
  G("Flag gate", [_C(-3, 0, 0, 0.16, 6, 0xcfd2d6, { seg: 6 }), _C(3, 0, 0, 0.16, 6, 0xcfd2d6, { seg: 6 }), _B(-3.8, 0, 4.7, 1.5, 0.05, 1.1, RED, { col: false }), _B(3.8, 0, 4.7, 1.5, 0.05, 1.1, RED, { col: false })], 6, 5.6);
  G("Tall gate", [...gate(7, 9, 0x2a8a8a, 0.35), _B(0, 0, 8.2, 7.8, 0.3, 0.3, 0xf2f2f2, { col: false })], 7, 9);
  G("Tunnel gate", [_B(-3.4, 0, 0, 0.7, 9, 4.2, 0x9a9fa8), _B(3.4, 0, 0, 0.7, 9, 4.2, 0x9a9fa8), _B(0, 0, 4.2, 8.2, 9, 0.7, 0x80858e)], 6.1, 4.2);
  // poles and lamps (8)
  add("Street lamp", "pole", "lamp", [_C(0, 0, 0, 0.12, 5.2, 0x3a3d44, { seg: 6 }), _B(0.6, 0, 5.1, 1.4, 0.2, 0.2, 0x3a3d44), _S(1.2, 0, 4.85, 0.3, 0xfff1b0, { col: false })]);
  add("Double lamp", "pole", "lamp", [_C(0, 0, 0, 0.14, 6, 0x3a3d44, { seg: 6 }), _B(0, 0, 5.9, 3.2, 0.18, 0.18, 0x3a3d44), _S(-1.5, 0, 5.6, 0.3, 0xfff1b0, { col: false }), _S(1.5, 0, 5.6, 0.3, 0xfff1b0, { col: false })]);
  add("Floodlight mast", "pole", "lamp", [_C(0, 0, 0, 0.25, 14, 0x777c85, { r2: 0.16, seg: 6 }), _B(0, 0, 14, 2.6, 0.5, 1.2, 0x333840), _B(0, 0.28, 14.1, 2.2, 0.08, 0.9, 0xfff1b0, { col: false })]);
  add("Power pole", "pole", "lamp", [_C(0, 0, 0, 0.18, 9, 0x6a4f3a, { seg: 6 }), _B(0, 0, 8.2, 2.8, 0.14, 0.14, 0x5a4331), _B(0, 0, 7.2, 2.2, 0.14, 0.14, 0x5a4331)]);
  add("Pylon", "pole", "lamp", [_R(-1.4, -0.6, 0, -0.35, 0, 15.5, 0.3, 0x8d939b), _R(1.4, -0.6, 0, 0.35, 0, 15.5, 0.3, 0x8d939b), _R(-1.4, 0.6, 0, -0.35, 0, 15.5, 0.3, 0x8d939b), _R(1.4, 0.6, 0, 0.35, 0, 15.5, 0.3, 0x8d939b), _R(-1.0, 0, 3, 1.0, 0, 8, 0.12, 0x8d939b), _R(1.0, 0, 3, -1.0, 0, 8, 0.12, 0x8d939b), _B(0, 0, 14, 6.4, 0.25, 0.25, 0x8d939b), _B(0, 0, 11.4, 4.6, 0.25, 0.25, 0x8d939b), _B(0, 0, 15.5, 2, 0.4, 0.4, 0x8d939b)]);
  add("Flagpole", "pole", "lamp", [_C(0, 0, 0, 0.12, 9, 0xe0e0e0, { seg: 6 }), _B(0.9, 0, 7.4, 1.8, 0.05, 1.2, RED, { col: false })]);
  add("Traffic light", "pole", "lamp", [_C(0, 0, 0, 0.12, 4.4, 0x3a3d44, { seg: 6 }), _B(0, 0, 3.6, 0.5, 0.5, 1.3, 0x222426), _S(0, 0.26, 4.5, 0.14, 0xff4a3a, { col: false }), _S(0, 0.26, 4.1, 0.14, 0xffc830, { col: false }), _S(0, 0.26, 3.75, 0.14, 0x3adf5a, { col: false })]);
  add("Dish antenna", "pole", "lamp", [_C(0, 0, 0, 0.2, 4.5, 0x777c85, { seg: 6 }), _S(0, 0.5, 4.5, 1.1, 0xe8e8e8, { col: false }), _B(0, 0, 4.4, 0.1, 1.4, 0.1, 0x555555, { col: false })]);
  // vehicles (10)
  const car = (l, w, h, c, cab = 0.55) => [_B(0, 0, 0.35, l, w, h * 0.5, c), _B(-l * 0.06, 0, 0.35 + h * 0.5, l * cab, w * 0.9, h * 0.5, GLASS, { col: true }), _B(-l * 0.06, 0, 0.35 + h, l * cab * 0.8, w * 0.8, 0.07, c, { col: false }),
    ..."1234".split("").map((_, i) => _WH((i < 2 ? 1 : -1) * l * 0.32, (i % 2 ? 1 : -1) * (w * 0.5 - 0.12), 0.36, 0.28)),
    _B(l * 0.5 - 0.03, w * 0.32, 0.62, 0.08, 0.34, 0.18, 0xfff1b0, { col: false }), _B(l * 0.5 - 0.03, -w * 0.32, 0.62, 0.08, 0.34, 0.18, 0xfff1b0, { col: false }), _B(-l * 0.5 + 0.03, w * 0.32, 0.62, 0.08, 0.34, 0.18, 0xff4a3a, { col: false }), _B(-l * 0.5 + 0.03, -w * 0.32, 0.62, 0.08, 0.34, 0.18, 0xff4a3a, { col: false })];
  const wheels4 = (x, r, w, ww) => [_WH(x, w, r, ww), _WH(x, -w, r, ww)];
  add("Sedan", "vehicle", "vehicle", car(4.4, 1.8, 1.4, 0x2f5fa8));
  add("Hatchback", "vehicle", "vehicle", car(3.8, 1.7, 1.45, 0xc8412f, 0.65));
  add("Pickup", "vehicle", "vehicle", [...car(5.2, 1.9, 1.5, 0x3a8f4a, 0.4), _B(-1.7, 0, 0.8, 1.9, 1.8, 0.6, 0x2f7a3e)]);
  add("Van", "vehicle", "vehicle", car(5, 2, 2.1, 0xf1ede4, 0.8));
  add("Bus", "vehicle", "vehicle", [_B(0, 0, 0.4, 11, 2.5, 2.8, 0xe8b830), _B(0, 1.27, 1.4, 9.4, 0.06, 1.0, GLASS, { col: false }), _B(0, -1.27, 1.4, 9.4, 0.06, 1.0, GLASS, { col: false }), _B(5.52, 0, 1.4, 0.06, 2.1, 1.1, GLASS, { col: false }), _B(0, 0, 3.2, 8, 1.8, 0.2, 0x8a8f98, { col: false }), ...wheels4(3.6, 0.5, 1.2, 0.4), ...wheels4(-3.4, 0.5, 1.2, 0.4)]);
  add("Truck", "vehicle", "vehicle", [_B(3.2, 0, 0.5, 2.4, 2.3, 2.6, RED), _B(3.95, 0, 1.9, 0.9, 2.1, 1.0, GLASS, { col: false }), _B(-1.4, 0, 0.7, 6.2, 2.4, 3, 0xf1ede4), ...wheels4(3.4, 0.5, 1.1, 0.4), ...wheels4(-0.1, 0.5, 1.1, 0.4), ...wheels4(-1.9, 0.5, 1.1, 0.4)]);
  add("Tractor", "vehicle", "vehicle", [_B(0.2, 0, 0.7, 3.0, 1.5, 1.1, 0x3a8f4a), _B(-0.5, 0, 1.8, 1.4, 1.5, 1.5, 0x2f7a3e), _B(-0.5, 0, 3.3, 1.7, 1.8, 0.12, 0x2f7a3e, { col: false }), _R(-0.5, 0, 3.0, 1.5, 0, 1.8, 0.1, DARK), _C(1.3, 0, 1.8, 0.12, 0.5, 0x888888, { seg: 6, col: false }),
    _WH(-1.1, 1.05, 0.9, 0.5), _WH(-1.1, -1.05, 0.9, 0.5), _WH(1.2, 0.85, 0.5, 0.35), _WH(1.2, -0.85, 0.5, 0.35)]);
  add("Fire truck", "vehicle", "vehicle", [_B(0, 0, 0.5, 8, 2.4, 2.4, 0xd8261f), _B(2.9, 0, 2.9, 2.0, 2.0, 0.9, GLASS, { col: false }), _R(-3, 0, 3.0, 2.4, 0, 3.4, 0.14, 0xcfd2d6), _R(-3, 0.35, 3.0, 2.4, 0.35, 3.4, 0.14, 0xcfd2d6), _B(1.4, 0, 2.9, 0.5, 1.9, 0.18, 0xffc830, { col: false }), ...wheels4(2.6, 0.5, 1.2, 0.4), ...wheels4(-2.4, 0.5, 1.2, 0.4)]);
  add("Taxi", "vehicle", "vehicle", [...car(4.4, 1.8, 1.4, 0xf2c300), _B(0, 0, 1.9, 0.9, 0.4, 0.3, 0xf1ede4, { col: false })]);
  add("Camper", "vehicle", "vehicle", [_B(0, 0, 0.5, 6.4, 2.3, 2.9, 0xf1ede4), _B(0, 1.17, 1.3, 5, 0.06, 1.0, 0x5b8fb8, { col: false }), _B(0, -1.17, 1.3, 5, 0.06, 1.0, 0x5b8fb8, { col: false }), _B(0, 0, 0.9, 6.5, 2.35, 0.5, 0x2f8a8a, { col: false }), _B(3.18, 0, 1.6, 0.06, 1.9, 1.2, GLASS, { col: false }), ...wheels4(2.1, 0.45, 1.1, 0.4), ...wheels4(-2.1, 0.45, 1.1, 0.4)]);
  // industry and farm (10)
  add("Silo", "industry", "tall", [_C(0, 0, 0, 2.6, 13, 0xb9c0c8, { seg: 14 }), _C(0, 0, 13, 2.7, 1.8, 0x8d939b, { r2: 0, seg: 14 })]);
  add("Windmill", "industry", "tall", [_C(0, 0, 0, 3, 8, 0xe6dccb, { r2: 1.9, seg: 8 }), _C(0, 0, 8, 2.2, 2, 0x9a4a3a, { r2: 0, seg: 8 }), _C(0, 2.0, 9.2, 0.45, 0.8, 0x777c85, { ax: "y", ctr: true, seg: 8, col: false }), _R(0, 2.5, 9.2, 0, 2.5, 16.2, 0.22, WHITE), _R(0, 2.5, 9.2, 0, 2.5, 2.2, 0.22, WHITE), _R(0, 2.5, 9.2, 7, 2.5, 9.2, 0.22, WHITE), _R(0, 2.5, 9.2, -7, 2.5, 9.2, 0.22, WHITE),
    _B(0, 2.52, 12.7, 0.9, 0.06, 3.0, 0xf1ede4, { col: false }), _B(0, 2.52, 5.7, 0.9, 0.06, 3.0, 0xf1ede4, { col: false }), _B(3.5, 2.52, 9.2, 3.0, 0.06, 0.9, 0xf1ede4, { col: false }), _B(-3.5, 2.52, 9.2, 3.0, 0.06, 0.9, 0xf1ede4, { col: false })]);
  add("Hay bale", "industry", "decor", [_C(0, 0, 1.1, 1.1, 1.4, 0xd8bd4a, { ax: "y", ctr: true, seg: 12 })]);
  add("Storage tank", "industry", "tall", [_C(0, 0, 0, 4.2, 6.5, 0xdadfe3, { seg: 16 }), _C(0, 0, 6.5, 4.3, 0.5, 0xa7adb4, { seg: 16 }), _B(3.6, 0, 0, 0.6, 0.6, 6.4, 0x777c85, { col: false })]);
  add("Container (red)", "industry", "decor", [_B(0, 0, 0, 6.1, 2.4, 2.6, 0xb8402f), _B(0, 1.22, 0.3, 5.6, 0.06, 2, 0x9a3526, { col: false })]);
  add("Container (blue)", "industry", "decor", [_B(0, 0, 0, 6.1, 2.4, 2.6, 0x2f5f98), _B(0, 1.22, 0.3, 5.6, 0.06, 2, 0x274f80, { col: false })]);
  add("Crane", "industry", "tall", [_B(0, 0, 0, 1.4, 1.4, 20, YEL), _B(3, 0, 19, 11, 0.9, 0.9, YEL), _B(-2.4, 0, 17.6, 2.6, 1.6, 2.2, 0x555555), _R(-2, 0, 20, 7.5, 0, 19.4, 0.12, 0x333333), _R(0, 0, 20.9, -2, 0, 20, 0.12, 0x333333), _R(0, 0, 20.9, 7.5, 0, 19.9, 0.12, 0x333333), _R(7, 0, 19, 7, 0, 12.5, 0.08, 0x333333), _B(7, 0, 11.8, 1.0, 0.8, 0.7, RED, { col: false })]);
  add("Cooling tower", "industry", "tall", [_C(0, 0, 0, 7, 9, 0xc9c6bd, { r2: 4.4, seg: 18 }), _C(0, 0, 9, 4.4, 6, 0xc9c6bd, { r2: 5.4, seg: 18 })]);
  add("Gas station", "industry", "decor", [..."1234".split("").map((_, i) => _C((i < 2 ? 1 : -1) * 4, (i % 2 ? 1 : -1) * 3, 0, 0.25, 5, 0xcfd2d6, { seg: 6 })), _B(0, 0, 5, 10.5, 8.5, 0.6, RED), _B(0, 0, 0, 1, 2.4, 1.2, 0x333840, { col: false })]);
  add("Barrel stack", "industry", "decor", [_C(-0.6, 0, 0, 0.55, 1.1, 0x3a6fa8, { seg: 10 }), _C(0.6, 0, 0, 0.55, 1.1, 0xc8412f, { seg: 10 }), _C(0, 0.1, 1.1, 0.55, 1.1, 0x3a8f4a, { seg: 10 })]);
  // nature and street furniture (10)
  add("Rock", "nature", "decor", [_S(0, 0, -0.4, 1.4, 0x8d8a85), _S(0.9, 0.5, -0.3, 0.8, 0x7f7c77)]);
  add("Boulder", "nature", "decor", [_S(0, 0, -1.2, 3.4, 0x85827d), _S(2.4, 1.2, -0.8, 1.7, 0x7b7873)]);
  add("Rock cluster", "nature", "decor", [_S(0, 0, -0.5, 1.9, 0x8d8a85), _S(2.3, -0.6, -0.4, 1.3, 0x7f7c77), _S(-1.8, 1.0, -0.4, 1.2, 0x9a9792)]);
  add("Fence", "nature", "decor", [_B(0, 0, 0.5, 6, 0.12, 0.14, 0xb08a58), _B(0, 0, 0.95, 6, 0.12, 0.14, 0xb08a58), _B(-2.8, 0, 0, 0.16, 0.16, 1.2, 0x9a7a4c), _B(0, 0, 0, 0.16, 0.16, 1.2, 0x9a7a4c), _B(2.8, 0, 0, 0.16, 0.16, 1.2, 0x9a7a4c)]);
  add("Hedge", "nature", "decor", [_B(0, 0, 0, 7, 1.2, 1.4, 0x3f7f3a), _S(-2.4, 0, 0.8, 0.8, 0x4a8f43, { col: false }), _S(0.5, 0, 0.9, 0.8, 0x4a8f43, { col: false })]);
  add("Bench", "nature", "decor", [_B(0, 0, 0.45, 2, 0.5, 0.1, 0x9a6a3c), _B(0, -0.25, 0.9, 2, 0.1, 0.45, 0x9a6a3c), _B(-0.8, 0, 0, 0.1, 0.5, 0.45, 0x333333, { col: false }), _B(0.8, 0, 0, 0.1, 0.5, 0.45, 0x333333, { col: false })]);
  add("Fountain", "nature", "decor", [_C(0, 0, 0, 3.2, 0.7, 0xb9b4a8, { seg: 16 }), _C(0, 0, 0.7, 2.7, 0.1, 0x4f9ac8, { seg: 16, col: false }), _C(0, 0, 0.7, 0.4, 2.4, 0xb9b4a8, { seg: 8 }), _C(0, 0, 2.4, 1.1, 0.4, 0xb9b4a8, { r2: 0.6, seg: 10, col: false }), _C(0, 0, 2.8, 0.25, 1.4, 0x9fd0ee, { r2: 0.05, seg: 6, col: false })]);
  add("Billboard", "nature", "tall", [_C(-2.2, 0, 0, 0.2, 7, 0x555a62, { seg: 6 }), _C(2.2, 0, 0, 0.2, 7, 0x555a62, { seg: 6 }), _B(0, 0, 6, 8, 0.3, 3.4, 0xe8e0c8), _B(0, 0.17, 6.4, 6.4, 0.06, 2.6, BLUE, { col: false }), _B(0, -0.17, 6.4, 6.4, 0.06, 2.6, BLUE, { col: false }), _B(0, 0.3, 9.4, 7.6, 0.4, 0.25, 0x333840, { col: false })]);
  add("Balloon", "nature", "decor", [_C(0, 0, 0, 0.06, 5, 0x888888, { seg: 4, col: false }), _S(0, 0, 5, 1.6, 0xe8412f), _S(1.2, 0.3, 4.5, 1.1, YEL)]);
  add("Snowman", "nature", "decor", [_S(0, 0, 0, 1.2, 0xf6f6f6), _S(0, 0, 1.9, 0.9, 0xf6f6f6), _S(0, 0, 3.4, 0.6, 0xf6f6f6), _C(0, 0.6, 3.9, 0.15, 0.7, ORG, { r2: 0, seg: 6, col: false })]);
  // toy extras (8)
  add("Giant dice", "toy", "decor", [_B(0, 0, 0, 3.4, 3.4, 3.4, 0xf2f2f2), _S(0, 1.71, 1.5, 0.28, 0x222222, { col: false }), _S(1.71, 0.8, 2.6, 0.28, 0x222222, { col: false }), _S(1.71, -0.8, 0.8, 0.28, 0x222222, { col: false })]);
  add("Block stack", "toy", "decor", [_B(0, 0, 0, 3, 3, 3, RED), _B(0.2, 0, 3, 2.6, 2.6, 2.6, YEL), _B(0, 0.1, 5.6, 2.2, 2.2, 2.2, BLUE)]);
  add("Beach ball", "toy", "decor", [_S(0, 0, 0, 2.2, 0xe8412f), _T(0, 0, 0.0, 2.2, 0.08, 0xf1ede4, { col: false })]);
  add("Toy rocket", "toy", "tall", [_C(0, 0, 0, 1.4, 8, 0xf1ede4, { r2: 1.2, seg: 12 }), _C(0, 0, 8, 1.2, 3, RED, { r2: 0, seg: 12 }), _B(0, 0, 0, 4.2, 0.2, 2.6, RED, { col: false }), _B(0, 0, 0, 0.2, 4.2, 2.6, RED, { col: false })]);
  add("Ferris wheel", "toy", "tall", [_B(-1.9, 0, 0, 0.5, 2.4, 1.0, 0x7a8089), _B(1.9, 0, 0, 0.5, 2.4, 1.0, 0x7a8089), _R(-1.9, 0, 0.5, 0, 0, 13, 0.4, 0x7a8089), _R(1.9, 0, 0.5, 0, 0, 13, 0.4, 0x7a8089), _R(-0.6, 0, 0.5, 0, 0, 13, 0.3, 0x7a8089), _R(0.6, 0, 0.5, 0, 0, 13, 0.3, 0x7a8089), _T(0, 0, 3, 10, 0.3, 0xe8412f), _T(0, 0, 8, 5, 0.15, 0xe8412f),
    ..."123456".split("").flatMap((_, i) => [_R(0, 0, 13, Math.cos(i * 1.047) * 10, 0, 13 + Math.sin(i * 1.047) * 10, 0.12, 0xcfd2d6), _B(Math.cos(i * 1.047) * 10, 0, 13 + Math.sin(i * 1.047) * 10 - 1.4, 1.5, 1.3, 1.2, [RED, YEL, BLUE, GRN, ORG, 0xa66ac8][i], { col: false })])]);
  add("Carousel", "toy", "decor", [_C(0, 0, 0, 5, 0.6, 0x8a8f98, { seg: 16 }), ..."1234".split("").map((_, i) => _C(Math.cos(i * 1.5708) * 3.2, Math.sin(i * 1.5708) * 3.2, 0.6, 0.14, 3.4, YEL, { seg: 5 })), _C(0, 0, 0.6, 0.3, 3.6, 0xcfd2d6, { seg: 6 }), _C(0, 0, 4, 5.4, 2.2, RED, { r2: 0.2, seg: 16 })]);
  add("Pier", "toy", "decor", [_B(0, 0, 0.2, 14, 3, 0.4, 0x9a6a3c), ..."123456".split("").map((_, i) => _C(-6 + i * 2.4, (i % 2 ? 1 : -1) * 1.3, -2.5, 0.18, 3, 0x5a4331, { seg: 6, col: false }))]);
  add("Launch pad", "toy", "pad", [_C(0, 0, 0, 5.5, 0.12, 0x4a4f58, { seg: 24, col: false }), _C(0, 0, 0.12, 4.6, 0.04, 0xe8b830, { seg: 24, col: false }), _C(0, 0, 0.16, 3.4, 0.03, 0x4a4f58, { seg: 24, col: false })]);
  return K;
}
const WORLD_KINDS = _catalogue();

// The people: drawn from a few primitives like everything else, but animated by the renderer (legs swing, wheels turn, pedals go round), so each lists its static body and where the moving parts hang.
// Body frame: x forward, y left, z up, feet (or tyres) on z = 0.
const WORLD_AGENTS = {
  walker: { prims: [_B(0, 0, 0.8, 0.22, 0.4, 0.62, 0x808690), _B(0, 0, 0.74, 0.2, 0.3, 0.1, 0x3a3d44), _S(0, 0, 1.46, 0.12, 0xe0c9a6), _R(0, 0.25, 1.38, 0.04, 0.29, 0.86, 0.07, 0x808690), _R(0, -0.25, 1.38, -0.04, -0.29, 0.86, 0.07, 0x808690)],
    legs: { hip: [[0, 0.1, 0.78], [0, -0.1, 0.78]], len: 0.78, t: 0.1, c: 0x3a3d44 } },
  bike: { prims: [_R(-0.55, 0, 0.33, 0, 0, 0.3, 0.035, 0x555a62), _R(0, 0, 0.3, -0.25, 0, 0.95, 0.035, 0x555a62), _R(-0.55, 0, 0.33, -0.25, 0, 0.95, 0.035, 0x555a62), _R(-0.25, 0, 0.95, 0.4, 0, 0.88, 0.035, 0x555a62), _R(0, 0, 0.3, 0.4, 0, 0.88, 0.035, 0x555a62), _R(0.4, 0, 0.88, 0.55, 0, 0.33, 0.035, 0x555a62),
      _R(0.38, 0, 0.9, 0.45, 0, 1.02, 0.03, 0x333840), _R(0.45, 0.28, 1.02, 0.45, -0.28, 1.02, 0.03, 0x333840), _B(-0.28, 0, 0.98, 0.2, 0.1, 0.05, 0x333840),
      _R(-0.22, 0, 1.0, 0.16, 0, 1.46, 0.2, 0x808690), _S(0.2, 0, 1.46, 0.12, 0xe0c9a6), _R(0.14, 0.18, 1.42, 0.45, 0.27, 1.03, 0.065, 0x808690), _R(0.14, -0.18, 1.42, 0.45, -0.27, 1.03, 0.065, 0x808690)],
    wheels: { at: [[-0.55, 0, 0.33], [0.55, 0, 0.33]], r: 0.33 }, legs: { hip: [[-0.24, 0.1, 0.98], [-0.24, -0.1, 0.98]], crank: [0, 0, 0.3], cr: 0.17, off: 0.16, t: 0.09, c: 0x3a3d44 } },
};

// ---- per-kind derived data: footprint radius, height; and which procedural surface texture each primitive gets ----
// (rendered by world3d.js as thin lines on the faces: window grids on walls, ridge lines on roofs, contour rings on trees and tanks, curtain walls on glass towers, ribs on ramps)
const _bounds = p => {
  switch (p.k) {
    case "box": case "prism": case "wedge": return [Math.hypot(p.sx, p.sy) / 2, p.z + p.sz];
    case "cyl": return p.ax ? [Math.max(p.r, p.r2 || 0, p.h / 2), p.z + Math.max(p.r, p.r2 || 0)] : [Math.max(p.r, p.r2 || 0), p.z + p.h];
    case "sph": return [p.r, p.z + 2 * p.r];
    case "dome": return [p.r, p.z + p.r];
    case "tor": return [p.R + p.t, p.z + 2 * p.R + 2 * p.t];
    case "rod": return [Math.hypot(p.dx, p.dy) / 2 + p.t, p.z + Math.abs(p.dz) / 2 + p.t];
  }
  return [0, 0];
};
const TEX = { none: 0, win: 1, roof: 2, ring: 3, glass: 4, plank: 5, rib: 6 };
const _texFor = (k, p) => {
  const living = k.cat === "house" || k.cat === "building";
  if (p.k === "box" && living) { if (Math.min(p.sx, p.sy) < 2.8 || p.sz < 2.2) return 0; return p.c === GLASS ? TEX.glass : /cabin|barn/i.test(k.name) ? TEX.plank : TEX.win; }
  if (p.k === "prism") return TEX.roof;
  if (p.k === "wedge" && k.cat === "ramp") return TEX.rib;
  if ((p.k === "cyl" && !p.ax && (k.cat === "tree" || (k.cat === "industry" && p.r > 1.5) || (k.cat === "building" && p.r > 1.8))) || (p.k === "sph" && (k.cat === "tree" || k.cat === "nature")) || p.k === "dome") return TEX.ring;
  return 0;
};
for (const k of WORLD_KINDS) {
  let r = 0, h = 0;
  for (const p of k.prims) { const [ext, top] = _bounds(p); r = Math.max(r, Math.hypot(p.x, p.y) + ext); h = Math.max(h, top); if (p.tex === undefined) p.tex = _texFor(k, p); }
  k.fr = r; k.height = h;
}

// ---- the world ----
// Laid out the way a small town is: a street grid (blocks of 24 m, streets of 12 m) with a plaza in the middle, density falling off with the distance
// from the centre (towers downtown → low-rise midtown → houses with yards at the edge, the concentric-zone idea), a few parks and a skatepark among
// the blocks, a ring road with a race line of gates just outside, and beyond it a forest belt with a farm, an industrial yard, a lake and a hill.
// Trees go in by rejection sampling against an occupancy grid (a Poisson-disc-like spacing) under a noise mask. Kinds are dealt round-robin, so all
// 100 are used evenly.
function makeWorld(seed = WORLD_SEED) {
  const rnd = _rng(seed), pick = a => a[Math.floor(rnd() * a.length)], rr = (a, b) => a + (b - a) * rnd(), D = Math.PI / 180;
  const byCat = {}; WORLD_KINDS.forEach((k, i) => (byCat[k.cat] || (byCat[k.cat] = [])).push(i));
  const idx = n => WORLD_KINDS.findIndex(k => k.name === n);
  const cyc = names => { const a = names.map(n => typeof n === "number" ? n : idx(n)); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } let p = 0; return () => a[p++ % a.length]; };
  const SIZE = 160, PITCH = 36, ST = 12, RING = 96, CITY_R = 98;
  const polar = (deg, r) => [Math.cos(deg * D) * r, Math.sin(deg * D) * r];
  const base = (x, y) => 8 * (_vnoise(x * 0.011, y * 0.011, 1) - 0.5) * 2 + 2.6 * (_vnoise(x * 0.032 + 7, y * 0.032, 2) - 0.5) * 2 + 0.6 * (_vnoise(x * 0.09, y * 0.09 + 3, 3) - 0.5) * 2;
  const [lkx, lky] = polar(200, 122), [fx, fy] = polar(30, 122), [ix, iy] = polar(-70, 122), [hx, hy] = polar(100, 126);
  const lake = { x: lkx, y: lky, r: 21 }, hill = { x: hx, y: hy, r: 26 };
  let lowest = 1e9; for (let x = -SIZE; x <= SIZE; x += 5) for (let y = -SIZE; y <= SIZE; y += 5) if (Math.hypot(x - lake.x, y - lake.y) > lake.r * 1.4) lowest = Math.min(lowest, base(x, y));
  const waterY = lowest - 0.8, dent = base(lake.x, lake.y) - waterY + 4.5;   // sea level sits under every hill; only the lake dips below it
  const zones = [{ id: "city", x: 0, y: 0, r: 90 }, { id: "farm", x: fx, y: fy, r: 22 }, { id: "industrial", x: ix, y: iy, r: 24 }];
  for (const z of zones) z.h = Math.max(base(z.x, z.y), waterY + 2.2);
  const H = (x, y) => {
    let h = base(x, y);
    for (const z of zones) { const w = 1 - _sstep(z.r, z.r * 1.4, Math.hypot(x - z.x, y - z.y)); if (w > 0) h = h * (1 - w) + z.h * w; }
    const dh = Math.hypot(x - hill.x, y - hill.y) / hill.r; h += 13 * Math.exp(-dh * dh * 1.6);
    const dl = Math.hypot(x - lake.x, y - lake.y) / lake.r; if (dl < 1) h -= dent * (1 - dl * dl) ** 1.3;
    return h;
  };
  const zoneAt = (x, y) => { for (const z of zones) if (z.id !== "city" && Math.hypot(x - z.x, y - z.y) < z.r * 1.05) return z; return null; };
  // roads: the street grid, the ring road, and a road out to each of the four districts
  const radials = [[30, fx, fy], [-70, ix, iy], [200, lkx, lky], [100, hx, hy]].map(([a, x, y]) => { const [sx, sy] = polar(a, RING), l = Math.hypot(x - sx, y - sy), t = Math.max(0, (l - 12) / l); return [sx, sy, sx + (x - sx) * t, sy + (y - sy) * t]; });
  const segD = (x, y, ax, ay, bx, by) => { const dx = bx - ax, dy = by - ay, t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy || 1))); return Math.hypot(x - ax - dx * t, y - ay - dy * t); };
  const gridRoad = (x, y) => { if (Math.hypot(x, y) > CITY_R || Math.abs(x) > 91 || Math.abs(y) > 91) return false; const u = ((x % PITCH) + PITCH) % PITCH, v = ((y % PITCH) + PITCH) % PITCH; return Math.abs(u - PITCH / 2) < ST / 2 || Math.abs(v - PITCH / 2) < ST / 2; };
  const roadAt = (x, y) => gridRoad(x, y) || Math.abs(Math.hypot(x, y) - RING) < 4.5 || radials.some(r => segD(x, y, r[0], r[1], r[2], r[3]) < 3.5);
  // blocks of the grid
  const blocks = [], park = new Set(["1,-1", "2,1", "-1,2", "-1,-2"]), skate = new Set(["-2,0", "-2,1", "-2,-1"]);
  for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) { const d = Math.hypot(i * PITCH, j * PITCH); if (d > 84) continue; const key = `${i},${j}`;
    blocks.push({ i, j, x: i * PITCH, y: j * PITCH, d, type: !i && !j ? "plaza" : skate.has(key) ? "skate" : park.has(key) ? "park" : d <= 54 ? "downtown" : d <= 76 ? "midtown" : "residential" }); }
  const blockAt = (x, y) => { const i = Math.round(x / PITCH), j = Math.round(y / PITCH); if (Math.abs(x - i * PITCH) > 12 || Math.abs(y - j * PITCH) > 12) return null; return blocks.find(b => b.i === i && b.j === j) || null; };
  const GR = { road: [0x4b4e56, 0.95], plaza: [0xb9b4a8, 0.8], skate: [0x9b9fa6, 0.9], park: [0x5c9f48, 0.9], paved: [0x7e848c, 0.75], yard: [0x6a9a58, 0.6], yard2: [0x7e8f5c, 0.6], ind: [0x8f8a80, 0.85], f1: [0x9db35a, 0.9], f2: [0x7f9b4a, 0.9] };
  const groundAt = (x, y) => {
    if (roadAt(x, y)) return GR.road;
    const b = blockAt(x, y); if (b) return b.type === "plaza" ? GR.plaza : b.type === "skate" ? GR.skate : b.type === "park" ? GR.park : b.type === "residential" ? GR.yard : GR.paved;
    const z = zoneAt(x, y); if (z && z.id === "industrial") return GR.ind;
    if (z && z.id === "farm") return Math.floor((x * 0.5 + y) / 8) % 2 ? GR.f2 : GR.f1;
    return null; };

  // ---- placement ----
  const insts = [], grid = new Map(), CELL = 10;
  const gk = (cx, cy) => cx * 100003 + cy;
  const addOcc = (x, y, r) => { for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) { const k = gk(cx, cy); (grid.get(k) || grid.set(k, []).get(k)).push([x, y, r]); } };
  const freeAt = (x, y, r, gap = 0.8) => { if (H(x, y) < waterY + 0.5) return false; for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cy = Math.floor((y - r) / CELL); cy <= Math.floor((y + r) / CELL); cy++) for (const o of grid.get(gk(cx, cy)) || []) if (Math.hypot(x - o[0], y - o[1]) < r + o[2] + gap) return false; return true; };
  const put = (ki, x, y, rot, s = 1, o = {}) => { const k = WORLD_KINDS[ki], fr = k.fr * s * (o.frScale ?? 1);
    if (!o.force && !freeAt(x, y, fr, o.gap ?? 0.8)) return null;
    let gz = H(x, y); if (fr > 3.5) for (let a = 0; a < 8; a++) gz = Math.min(gz, H(x + Math.cos(a * 0.785) * fr * 0.7, y + Math.sin(a * 0.785) * fr * 0.7));   // big things sit on the low side of a slope
    if (!o.force && fr > 3.5 && gz < waterY + 0.3) return null;   // nothing big stands in the lake
    const inst = { ki, x, y, z: gz + (o.dz ?? 0), rot, s, tint: 0.9 + rnd() * 0.2 }; insts.push(inst); addOcc(x, y, fr); return inst; };
  const fit = (ki, half) => Math.min(1, half / WORLD_KINDS[ki].fr);   // scale that makes a kind fit a lot of that half-size
  const quarter = () => Math.floor(rnd() * 4) * Math.PI / 2;
  put(idx("Launch pad"), 0, 0, 0, 1, { force: true });

  // the blocks
  const tallNext = cyc(["Skyscraper", "Office tower", "Apartment block", "Clock tower", "Shopping mall", "Church", "Pagoda"]), bigNext = cyc(["Apartment block", "Shopping mall", "Church", "Warehouse", "Pagoda", "Office tower"]);
  const smallNext = cyc(["Townhouse", "Modern house", "Garage", "Cottage", "Bungalow", "Villa", "Dome house", "Round hut", "Shed", "Log cabin", "A-frame cabin", "Barn"]), treeNext = cyc(["Oak", "Birch", "Cherry tree", "Bush", "Palm", "Cypress", "Pine", "Tall pine", "Dead tree", "Toy mushroom"]);
  const parkToy = cyc(["Ferris wheel", "Carousel", "Ferris wheel", "Carousel"]), parkBits = cyc(["Giant dice", "Block stack", "Beach ball", "Toy rocket", "Snowman", "Balloon"]), cornerNext = cyc(["Billboard", "Bench", "Fountain", "Street lamp", "Billboard", "Hedge", "Fountain", "Bush"]), skateNext = cyc(byCat.ramp);
  for (const B of blocks) {
    if (B.type === "plaza") {
      put(idx("Flagpole"), 8.5, 8.5, 0, 1, { gap: 0.2 }); put(idx("Bench"), -8, 0, Math.PI / 2, 1, { gap: 0.2 }); put(idx("Bench"), 0, 8.5, 0, 1, { gap: 0.2 }); put(idx("Fountain"), -8, -8, 0, 0.9, { gap: 0.2 });
      for (const [px, py] of [[9, -9], [-9, 9], [9, 0], [0, -9]]) put(treeNext(), px, py, 0, rr(0.8, 1), { gap: 0.2 });
    } else if (B.type === "downtown") {
      for (const px of [-6, 6]) { const ki = tallNext(), s = fit(ki, 5.4) * rr(0.9, 1) * Math.min(1, 30 / WORLD_KINDS[ki].height); put(ki, B.x + px, B.y + rr(-1, 1), px < 0 ? 0 : Math.PI, s, { gap: 0.1, force: true }); }
      for (const [px, py] of [[-9, 10], [9, -10]]) put(cornerNext(), B.x + px, B.y + py, rnd() * 6.28, 1, { gap: 0.1 });
    } else if (B.type === "midtown") {
      if (rnd() < 0.5) for (const px of [-6, 6]) { const ki = bigNext(); put(ki, B.x + px, B.y, px < 0 ? 0 : Math.PI, fit(ki, 5.4) * Math.min(1, 24 / WORLD_KINDS[ki].height), { gap: 0.1, force: true }); }
      else for (const [px, py] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const ki = smallNext(); put(ki, B.x + px, B.y + py, py < 0 ? Math.PI : 0, fit(ki, 5.2), { gap: 0.1, force: true }); }
    } else if (B.type === "residential") {
      for (const [px, py] of [[-6, -6], [6, -6], [-6, 6], [6, 6]]) { const ki = smallNext(), s = fit(ki, 4.8) * rr(0.92, 1), ox = px + rr(-0.6, 0.6), oy = py + rr(-0.6, 0.6);
        put(ki, B.x + ox, B.y + oy, py < 0 ? Math.PI : 0, s, { gap: 0.1, force: true });   // the door (local +y) faces the street on its side of the block
        if (rnd() < 0.7) put(treeNext(), B.x + px * 1.5 + rr(-0.6, 0.6), B.y + py * (rnd() < 0.5 ? 1.45 : 0.4), 0, rr(0.7, 0.95), { gap: 0.1 }); }
    } else if (B.type === "park") {
      const toy = parkToy(); put(toy, B.x, B.y, 0, fit(toy, 7.5), { gap: 0.1, force: true });
      for (const [px, py] of [[-9, -9], [9, 9], [-9, 9], [9, -9]]) { const bit = parkBits(); put(bit, B.x + px, B.y + py, rnd() * 6.28, 1, { gap: 0.1, force: true }); }
      for (let k = 0; k < 10; k++) put(treeNext(), B.x + rr(-10.5, 10.5), B.y + rr(-10.5, 10.5), 0, rr(0.75, 1.05), { gap: 0.5 });
      put(idx("Bench"), B.x + 10, B.y, 0, 1, { gap: 0.1 }); put(idx("Bench"), B.x - 10, B.y, Math.PI, 1, { gap: 0.1 }); for (let k = -1; k <= 1; k += 2) put(idx("Hedge"), B.x + k * 8, B.y + 11.5, 0, 0.9, { gap: 0.1 });
    } else if (B.type === "skate") {
      for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) { const ki = skateNext(), x = B.x + (c - 1) * 8, y = B.y + (r - 1) * 8; put(ki, x + rr(-0.5, 0.5), y + rr(-0.5, 0.5), Math.PI / 2 * (c % 2) + (r % 2 ? Math.PI : 0), fit(ki, 4.0), { gap: 0.1, force: true }); }
      put(idx("Floodlight mast"), B.x - 11, B.y - 11, 0, 1, { gap: 0.1 }); put(idx("Floodlight mast"), B.x + 11, B.y + 11, 0, 1, { gap: 0.1 });
    }
  }
  // streets: traffic lights at the corners, lamps down the sides, cars in the lanes
  const lampNext = cyc(["Street lamp", "Double lamp", "Street lamp"]);
  const lines = []; for (let k = -3; k <= 2; k++) lines.push(PITCH / 2 + k * PITCH);
  for (const sx of lines) for (const sy of lines) { if (Math.hypot(sx, sy) > 92) continue;
    put(idx("Traffic light"), sx + 6.6, sy + 6.6, 0, 1, { gap: 0.1 }); put(idx("Traffic light"), sx - 6.6, sy - 6.6, Math.PI, 1, { gap: 0.1 }); }
  for (const s0 of lines) for (let t = -2; t <= 2; t++) { const along = t * PITCH;
    for (const [px, py, rot, dirx] of [[s0, along, Math.PI / 2, true], [along, s0, 0, false]]) { if (Math.hypot(px, py) > 90) continue;
      const side = rnd() < 0.5 ? 1 : -1, lx = dirx ? px + side * 6.7 : px + rr(-8, 8), ly = dirx ? py + rr(-8, 8) : py + side * 6.7;
      put(lampNext(), lx, ly, dirx ? (side > 0 ? Math.PI : 0) : (side > 0 ? -Math.PI / 2 : Math.PI / 2), 1, { gap: 0.1 }); } }
  // ring road: a race line of gates facing along the road, power poles beside it
  { const gateNext = cyc(byCat.gate), nG = 16;
    for (let g = 0; g < nG; g++) { const a = (g + 0.5) / nG * 2 * Math.PI, ki = gateNext(); put(ki, Math.cos(a) * RING, Math.sin(a) * RING, a, 1.1, { gap: 0.5, force: true }); }
    const polesNext = cyc(["Power pole", "Pylon", "Power pole", "Dish antenna", "Floodlight mast", "Flagpole"]);
    for (let k = 0; k < 30; k++) { const a = k / 30 * 2 * Math.PI + 0.1; put(polesNext(), Math.cos(a) * (RING + 8), Math.sin(a) * (RING + 8), a, 1, { gap: 0.3 }); }
  }
  // farm: a barn yard on one side, fenced fields of hay bales on the other
  { const F = zones[1], T = (x, y) => [F.x + x, F.y + y];
    put(idx("Barn"), ...T(-9, 6), 0.1, 1.2, { gap: 0.2 }); put(idx("Silo"), ...T(-2, 12), 0, 0.9); put(idx("Silo"), ...T(3, 11), 0, 0.8); put(idx("Windmill"), ...T(12, 8), 0, 1); put(idx("Tractor"), ...T(8, -2), 2.2, 1); put(idx("Cottage"), ...T(-15, -4), 0.8, 1.2); put(idx("Tractor"), ...T(-4, 0), 0.7, 1);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 4; c++) put(idx("Hay bale"), ...T(2 + c * 3.4, -10 + r * 3.4), 0, rr(1, 1.3), { gap: 0.2 });
    for (let k = 0; k < 9; k++) { put(idx("Fence"), F.x - 22 + k * 5.4, F.y - 17, 0, 1, { gap: 0 }); put(idx("Fence"), F.x - 22 + k * 5.4, F.y + 19, 0, 1, { gap: 0 }); }
    for (let k = 0; k < 4; k++) put(idx("Hedge"), F.x + 21, F.y - 12 + k * 8, Math.PI / 2, 1, { gap: 0 }); }
  // industrial yard on a grid of plots, containers in rows, a crane at the dock
  { const I = zones[2], plots = cyc(["Warehouse", "Factory", "Cooling tower", "Storage tank", "Warehouse", "Crane", "Silo", "Storage tank", "Gas station", "Factory", "Cooling tower", "Crane", "Silo", "Gas station", "Water tower", "Radio mast"]);
    for (let gx = 0; gx < 4; gx++) for (let gy = 0; gy < 4; gy++) { const ki = plots(); put(ki, I.x + (gx - 1.5) * 12, I.y + (gy - 1.5) * 12 - 6, quarter(), fit(ki, 5.2), { gap: 0.2 }); }
    const conts = cyc(["Container (red)", "Container (blue)"]); for (let r = 0; r < 2; r++) for (let c = 0; c < 4; c++) { const ki = conts(), x = I.x - 7 + c * 4.4, y = I.y + 27 + r * 5, inst = put(ki, x, y, 0, 1, { gap: 0.1 }); if (inst && (r + c) % 2) insts.push({ ki, x, y, z: inst.z + 2.6, rot: 0, s: 1, tint: 1 }); }
    const yardNext = cyc(["Barrel stack", "Truck", "Pickup", "Barrel stack"]); for (let k = 0; k < 6; k++) put(yardNext(), I.x + rr(-18, 18), I.y + rr(-20, 20), quarter(), 1, { gap: 0.4 }); }
  // the lake shore: lighthouse and pier, a few cabins among the birches
  { const a0 = Math.atan2(lake.y, lake.x), sh = (r, da) => [lake.x + Math.cos(a0 + Math.PI + da) * r, lake.y + Math.sin(a0 + Math.PI + da) * r];   // the shore facing the city
    put(idx("Pier"), ...sh(lake.r * 0.9, 0), a0, 1, { force: true, dz: -1 }); put(idx("Lighthouse"), ...sh(lake.r + 6, 0.5), 0, 1, { gap: 0.2 }); put(idx("Lighthouse"), ...sh(lake.r + 5, -2.4), 0, 0.85, { gap: 0.2 }); put(idx("Pier"), ...sh(lake.r * 0.9, 2.0), a0 + 2.0, 1, { force: true, dz: -1 });
    for (const [da, nm] of [[-0.6, "Log cabin"], [-0.95, "A-frame cabin"], [1.0, "Round hut"], [1.3, "Shed"]]) put(idx(nm), ...sh(lake.r + 7 + rr(0, 3), da), rr(0, 6.28), 1, { gap: 0.3 });
    for (let k = 0; k < 8; k++) put(idx(pick(["Birch", "Pine", "Bush"])), ...sh(lake.r + rr(3, 14), rr(-1.4, 1.4)), 0, rr(0.8, 1.1), { gap: 0.6 }); }
  // the hill: a radio mast on top, rocks and dead trees on the slopes
  { put(idx("Radio mast"), hill.x, hill.y, 0, 1, { gap: 0.2 }); put(idx("Windmill"), hill.x + 13, hill.y + 12, 0, 0.9, { gap: 0.2 }); put(idx("Launch pad"), zones[1].x + 14, zones[1].y - 14, 0, 1, { gap: 0.2 }); put(idx("Dish antenna"), hill.x + 6, hill.y - 4, 1, 1.2, { gap: 0.2 }); put(idx("Water tower"), hill.x - 9, hill.y + 3, 0, 1, { gap: 0.2 });
    const rocks = cyc(["Boulder", "Rock cluster", "Rock", "Dead tree", "Snowman", "Balloon"]); for (let k = 0; k < 14; k++) { const a = rnd() * 6.28, r = rr(8, 26); put(rocks(), hill.x + Math.cos(a) * r, hill.y + Math.sin(a) * r, rnd() * 6.28, rr(0.8, 1.3), { gap: 0.6 }); } }
  // forest: trees where a noise mask says so (dense towards the edge), clear of roads, yards and districts
  const forest = (x, y) => _vnoise(x * 0.02 + 30, y * 0.02 - 11, 9);
  const near = (x, y) => roadAt(x + 6, y) || roadAt(x - 6, y) || roadAt(x, y + 6) || roadAt(x, y - 6);
  { const trees = byCat.tree, pines = [idx("Pine"), idx("Tall pine"), idx("Cypress")], next = cyc(trees);
    for (let k = 0; k < 9000; k++) { const x = rr(-SIZE + 12, SIZE - 12), y = rr(-SIZE + 12, SIZE - 12), r = Math.hypot(x, y); if (r < 90 || near(x, y)) continue; const z = zoneAt(x, y); if (z) continue;
      const m = forest(x, y), edge = _sstep(100, 140, r); if (m < 0.40 - 0.22 * edge) continue; const e = 0.8; if (Math.abs(H(x + e, y) - H(x - e, y)) > 1.0) continue;
      put(rnd() < 0.55 ? pick(pines) : next(), x, y, rnd() * 6.28, rr(0.85, 1.35), { gap: 1.6, frScale: 0.6 }); } }
  // ---- traffic and people: agents on closed routes ----
  // A route is a dense polyline (points ≤ 0.5 m apart, with its running length), so an agent's pose is a lookup at s = (s0 + v·t) mod length. Cars drive on the right: each block of the street grid has its own
  // clockwise loop 3 m inside the kerb (the four loops that meet at a junction each use their own corner, so they never cross), cyclists ride 1 m off the kerb, pedestrians walk the pavement.
  // The ring road has a lane each way, and an out-and-back road runs to each district.
  const routes = [], agents = [], DS = 0.5;
  const finish = (pts, rev) => { if (rev) pts.reverse(); pts.push(pts[0].slice()); const n = pts.length, x = new Float32Array(n), y = new Float32Array(n), cum = new Float32Array(n); let L = 0;
    for (let i = 0; i < n; i++) { if (i) L += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); x[i] = pts[i][0]; y[i] = pts[i][1]; cum[i] = L; } routes.push({ x, y, cum, len: L }); return routes.length - 1; };
  const line = (P, x0, y0, x1, y1) => { const n = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / DS)); for (let i = 0; i < n; i++) P.push([x0 + (x1 - x0) * i / n, y0 + (y1 - y0) * i / n]); };
  const arc = (P, cx, cy, rad, a0, a1) => { const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) * rad / DS)); for (let i = 0; i < n; i++) { const a = a0 + (a1 - a0) * i / n; P.push([cx + Math.cos(a) * rad, cy + Math.sin(a) * rad]); } };
  const rrect = (cx, cy, h, rad, cw) => { const P = [], k = h - rad, PI = Math.PI;   // clockwise: along the top to the right, down the right side, back along the bottom, up the left
    line(P, cx - k, cy + h, cx + k, cy + h); arc(P, cx + k, cy + k, rad, PI / 2, 0); line(P, cx + h, cy + k, cx + h, cy - k); arc(P, cx + k, cy - k, rad, 0, -PI / 2);
    line(P, cx + k, cy - h, cx - k, cy - h); arc(P, cx - k, cy - k, rad, -PI / 2, -PI); line(P, cx - h, cy - k, cx - h, cy + k); arc(P, cx - k, cy + k, rad, PI, PI / 2); return finish(P, !cw); };
  const circ = (cx, cy, rad, cw) => { const P = []; arc(P, cx, cy, rad, Math.PI / 2, Math.PI / 2 - 2 * Math.PI); return finish(P, !cw); };
  const outBack = (sx, sy, ex, ey, w) => { const P = [], L = Math.hypot(ex - sx, ey - sy), dx = (ex - sx) / L, dy = (ey - sy) / L, nx = dy, ny = -dx, an = Math.atan2(ny, nx);   // out in the right-hand lane, round the end, back in the other
    line(P, sx + nx * w, sy + ny * w, ex + nx * w, ey + ny * w); arc(P, ex, ey, w, an, an + Math.PI); line(P, ex - nx * w, ey - ny * w, sx - nx * w, sy - ny * w); arc(P, sx, sy, w, an + Math.PI, an + 2 * Math.PI); return finish(P, false); };
  const agent = (type, ki, route, s0, v, o = {}) => agents.push({ type, ki, route, s0, v, scale: 1, tint: 0.9 + rnd() * 0.2, ...o });
  const spread = (n, route, f) => { for (let k = 0; k < n; k++) f(((k + rnd() * 0.25) / n) * routes[route].len, k); };
  { const carNext = cyc(["Taxi", "Sedan", "Hatchback", "Van", "Bus", "Fire truck", "Pickup", "Sedan", "Taxi", "Hatchback", "Camper"]), walkNext = () => Math.floor(rnd() * 3);
    for (const B of blocks) {
      const lp = rrect(B.x, B.y, 15, 3, true), bus = rnd() < 0.18, n = B.type === "downtown" ? 2 : rnd() < 0.55 ? 2 : 1, v = bus ? 5.5 : rr(6, 9);
      spread(n, lp, (s0) => { const ki = bus ? idx("Bus") : carNext(); agent("car", ki, lp, s0, v); });
      if (rnd() < 0.4 || B.type === "residential") { const bl = rrect(B.x, B.y, 13, 2.5, true), vb = rr(4.2, 5.8); spread(1 + (rnd() < 0.3 ? 1 : 0), bl, s0 => agent("bike", -1, bl, s0, vb, { scale: rr(0.95, 1.05) })); }
      if (B.type === "skate") continue;
      if (B.type === "plaza") { const c = circ(B.x, B.y, 4.5, true), c2 = circ(B.x, B.y, 5.1, false); spread(3, c, s0 => agent("walker", -1, c, s0, rr(1.1, 1.4), { scale: rr(0.92, 1.08) })); spread(2, c2, s0 => agent("walker", -1, c2, s0, rr(1.1, 1.4), { scale: rr(0.92, 1.08) })); continue; }
      if (B.type === "park") { const c = circ(B.x, B.y, 8.7, rnd() < 0.5); spread(4, c, s0 => agent("walker", -1, c, s0, rr(1.0, 1.5), { scale: rr(0.9, 1.08) })); continue; }
      const w1 = rrect(B.x, B.y, 11.4, 1.0, true), w2 = rrect(B.x, B.y, 11.0, 1.0, false), v1 = rr(1.1, 1.5), v2 = rr(1.1, 1.5);
      spread(2, w1, s0 => agent("walker", -1, w1, s0, v1, { scale: rr(0.92, 1.08) })); spread(1 + walkNext() % 2, w2, s0 => agent("walker", -1, w2, s0, v2, { scale: rr(0.92, 1.08) })); }
    // the ring road: a lane each way (between the posts of the gates), and the way out to each district
    const ringKinds = cyc(["Pickup", "Truck", "Camper", "Van", "Sedan", "Bus", "Taxi", "Hatchback", "Fire truck", "Truck"]);
    for (const [rad, cw] of [[RING - 1.7, true], [RING + 1.7, false]]) { const c = circ(0, 0, rad, cw), v = rr(11, 14); spread(6, c, s0 => agent("car", ringKinds(), c, s0, v)); }
    const dist = [["Tractor", "Pickup"], ["Truck", "Van"], ["Camper", "Sedan"], ["Pickup", "Hatchback"]];
    radials.forEach((r, i) => { const rt = outBack(r[0], r[1], r[2], r[3], 1.45), v = i === 0 ? 7 : rr(9, 12); spread(2, rt, (s0, k) => agent("car", idx(dist[i][k]), rt, s0, v)); const bk = outBack(r[0], r[1], r[2], r[3], 3.0); agent("bike", -1, bk, rr(0, 1) * routes[bk].len, rr(5, 6.5)); });
  }
  const agentPose = (a, clock, out = {}) => { const r = routes[a.route], L = r.len; let s = (a.s0 + a.v * clock) % L; if (s < 0) s += L;
    let lo = 0, hi = r.cum.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (r.cum[m] <= s) lo = m; else hi = m; }
    const f = (s - r.cum[lo]) / ((r.cum[hi] - r.cum[lo]) || 1); out.x = r.x[lo] + (r.x[hi] - r.x[lo]) * f; out.y = r.y[lo] + (r.y[hi] - r.y[lo]) * f; out.yaw = Math.atan2(r.y[hi] - r.y[lo], r.x[hi] - r.x[lo]); out.z = H(out.x, out.y); out.s = s; return out; };
  // whatever kind is still missing (fewer than two) goes where it belongs: near its district, on open ground
  const fb = [];
  const home = { house: [lake.x, lake.y, 30], building: [zones[2].x, zones[2].y, 30], industry: [zones[2].x, zones[2].y, 30], nature: [hill.x, hill.y, 30], toy: [zones[1].x, zones[1].y, 34], ramp: [-72, 18, 12], tree: [0, 0, 150], gate: [0, 0, 0], pole: [0, 0, 0], vehicle: [0, 0, 0] };
  for (let ki = 0; ki < WORLD_KINDS.length; ki++) { let have = insts.filter(i => i.ki === ki).length + agents.filter(a => a.ki === ki).length; const k = WORLD_KINDS[ki], h = home[k.cat] || [0, 0, 150];
    for (let t = 0; t < 8000 && have < 2; t++) { let x, y, rot = rnd() * 6.28;
      if (t >= 1500 && h[2] !== 0) {
        if (k.cat === "house" || k.cat === "building") { const a = rnd() * 6.28, r = rnd() < 0.5 ? RING - rr(9, 11) : RING + rr(14, 24); x = Math.cos(a) * r; y = Math.sin(a) * r; rot = a + Math.PI / 2; }   // a suburb strip along the ring road
        else { const a = rnd() * 6.28, r = rr(0, h[2] * 2.2); x = h[0] + Math.cos(a) * r; y = h[1] + Math.sin(a) * r; } } else if (h[2] === 0) { const a = rnd() * 6.28, r = RING + rr(-7, 7); x = Math.cos(a) * r; y = Math.sin(a) * r; if (k.cat !== "pole") rot = a; } else if (h[2] >= 150) { x = rr(-140, 140); y = rr(-140, 140); } else { const a = rnd() * 6.28, r = rr(0, h[2]); x = h[0] + Math.cos(a) * r; y = h[1] + Math.sin(a) * r; }
      if (put(ki, x, y, rot, rr(0.95, 1.1), { gap: t < 3000 ? 1.2 : 0.2, frScale: t < 3000 ? 1 : 0.6 })) { have++; fb.push(k.name + (t >= 1500 ? "*" : "")); } } }

  // ---- collision shapes ----
  const cols = [], SC = 8, PAD = 6, cg = new Map(), ck = (a, b) => a * 100003 + b;
  const pushCol = c => { cols.push(c); for (let a = Math.floor((c.x0 - PAD) / SC); a <= Math.floor((c.x1 + PAD) / SC); a++) for (let b = Math.floor((c.y0 - PAD) / SC); b <= Math.floor((c.y1 + PAD) / SC); b++) { const key = ck(a, b); (cg.get(key) || cg.set(key, []).get(key)).push(c); } };
  for (const it of insts) { const k = WORLD_KINDS[it.ki], cs = Math.cos(it.rot), sn = Math.sin(it.rot), s = it.s;
    for (const p of k.prims) { if (p.col === false) continue;
      const wx = it.x + s * (p.x * cs - p.y * sn), wy = it.y + s * (p.x * sn + p.y * cs), z0 = it.z + s * p.z, rot = it.rot + (p.rot || 0);
      if (p.k === "box" || p.k === "prism" || p.k === "wedge") { const hx = p.sx * s / 2, hy = p.sy * s / 2, ex = Math.abs(hx * Math.cos(rot)) + Math.abs(hy * Math.sin(rot)), ey = Math.abs(hx * Math.sin(rot)) + Math.abs(hy * Math.cos(rot));
        pushCol({ ki: it.ki, t: "o", x: wx, y: wy, hx, hy, c: Math.cos(-rot), s: Math.sin(-rot), z0, z1: z0 + p.sz * s, slope: p.k === "wedge", x0: wx - ex, x1: wx + ex, y0: wy - ey, y1: wy + ey }); }
      else if ((p.k === "cyl" && !p.ax) || p.k === "sph" || p.k === "dome") { const r = (p.k === "sph" || p.k === "dome" ? p.r : Math.max(p.r, p.r2)) * s, h = (p.k === "sph" ? 2 * p.r : p.k === "dome" ? p.r : p.h) * s;
        pushCol({ ki: it.ki, t: "c", x: wx, y: wy, r, z0, z1: z0 + h, x0: wx - r, x1: wx + r, y0: wy - r, y1: wy + r }); }
    } }
  // top-of-everything map (1.5 m cells): the highest solid in each cell, so the autopilot can climb over what is ahead
  const TG = 1.5, TN = Math.ceil(2 * SIZE / TG), top = new Float32Array(TN * TN).fill(-1e9);
  for (const c of cols) { if (WORLD_KINDS[c.ki].role === "gate") continue;   // gates are flown through, not over
    const i0 = Math.max(0, Math.floor((c.x0 + SIZE) / TG)), i1 = Math.min(TN - 1, Math.floor((c.x1 + SIZE) / TG)), j0 = Math.max(0, Math.floor((c.y0 + SIZE) / TG)), j1 = Math.min(TN - 1, Math.floor((c.y1 + SIZE) / TG));
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) if (c.z1 > top[j * TN + i]) top[j * TN + i] = c.z1; }
  const topAt = (x, y) => { const i = Math.floor((x + SIZE) / TG), j = Math.floor((y + SIZE) / TG); return i < 0 || j < 0 || i >= TN || j >= TN ? -1e9 : top[j * TN + i]; };
  // signed distance to the nearest solid (terrain included), capped at PAD
  const sdf = (x, y, z) => {
    let d = Math.min(z - H(x, y), PAD);
    const L = cg.get(ck(Math.floor(x / SC), Math.floor(y / SC)));
    if (L) for (const c of L) {
      if (x < c.x0 - d || x > c.x1 + d || y < c.y0 - d || y > c.y1 + d || z < c.z0 - d || z > c.z1 + d) continue;   // cannot beat the best so far
      let di;
      if (c.t === "c") { const dr = Math.hypot(x - c.x, y - c.y) - c.r, dz = Math.max(c.z0 - z, z - c.z1); di = dr > 0 && dz > 0 ? Math.hypot(dr, dz) : Math.max(dr, dz); }
      else { const dx = x - c.x, dy = y - c.y, lx = dx * c.c - dy * c.s, ly = dx * c.s + dy * c.c, ax = Math.abs(lx) - c.hx, ay = Math.abs(ly) - c.hy;
        const top = c.slope ? c.z0 + (c.z1 - c.z0) * Math.max(0, Math.min(1, (lx + c.hx) / (2 * c.hx))) : c.z1, dz = Math.max(c.z0 - z, z - top);
        di = ax > 0 || ay > 0 || dz > 0 ? Math.hypot(Math.max(ax, 0), Math.max(ay, 0), Math.max(dz, 0)) : Math.max(ax, ay, dz); }
      if (di < d) d = di;
    }
    return d;
  };
  // ---- landmarks the quad flies to (gates, ramps, tall things, lamps, cars, houses) ----
  const landmarks = [];
  for (const [n, it] of insts.entries()) { const k = WORLD_KINDS[it.ki], s = it.s; let lm = null;
    if (k.role === "gate") lm = { type: "gate", zAim: it.z + k.gate.h * s * 0.5 + (/hoop/i.test(k.name) ? 2.0 * s : 0), axis: [-Math.sin(it.rot), Math.cos(it.rot)] };
    else if (k.role === "ramp") lm = { type: "ramp", zAim: it.z + k.height * s + 2.2, axis: [Math.cos(it.rot), Math.sin(it.rot)] };
    else if (k.role === "tall" && k.height > 8 && k.cat !== "tree") lm = { type: "tower", zAim: it.z + Math.min(k.height * s, 12), axis: null };
    else if (k.role === "lamp") lm = { type: "lamp", zAim: it.z + 4, axis: null };
    else if (k.role === "vehicle") lm = { type: "car", zAim: it.z + 2.8, axis: null };
    else if (k.role === "house" && k.cat === "house") lm = { type: "house", zAim: it.z + 3.5, axis: null };
    if (lm) landmarks.push({ ...lm, x: it.x, y: it.y, rad: k.fr * s, name: k.name, inst: n });   // everything but gates and ramps is flown past, not over
  }
  return { seed, kinds: WORLD_KINDS, insts, agents, routes, agentPose, radials, zones, lake, hill, waterY, H, sdf, topAt, zoneAt, roadAt, groundAt, blocks, fallbacks: fb, landmarks, cols, forest, size: SIZE, base, ring: RING };
}
return { WORLD_SEED, WORLD_KINDS, WORLD_AGENTS, makeWorld };
})();
