// Headless check of the splash world and the autopilot (run by test_world.py). Prints one JSON object.
const fs = require("fs"), path = require("path");
const dir = path.join(__dirname, "..", "static");
const src = fs.readFileSync(path.join(dir, "world.js"), "utf8") + "\n" + fs.readFileSync(path.join(dir, "demo.js"), "utf8") + "\nreturn {makeDemo, makeWorld, WORLD_KINDS};";
const L = new Function("addEventListener", "store", "highpass", "$", src)(() => {}, { get: (k, d) => d, set() {} }, x => x, () => null);
const w1 = L.makeWorld(), w2 = L.makeWorld();
const used = new Set(w1.insts.map(i => i.ki)), cnt = {}; w1.insts.forEach(i => cnt[i.ki] = (cnt[i.ki] || 0) + 1);
const names = new Set(L.WORLD_KINDS.map(k => k.name));
const rms = a => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
const flights = [1, 2, 3, 4].map(s => { const d = L.makeDemo(s, 60, w1), c = d.ch; let sp = 0; for (let i = 1; i < d.n; i++) sp += Math.hypot(d.pos[0][i] - d.pos[0][i - 1], d.pos[1][i] - d.pos[1][i - 1], d.pos[2][i] - d.pos[2][i - 1]);
  const err = [], cmd = []; for (let i = 0; i < d.n; i += 4) { err.push(c["sp[1]"][i] - c["gyro[1]"][i]); cmd.push(c["sp[1]"][i]); }
  const mot = []; for (let m = 0; m < 4; m++) for (let i = 0; i < d.n; i += 10) mot.push(c[`m%[${m}]`][i]);
  return { hits: d.hits, tricks: d.trick.names.length, n: d.n, finite: Array.from(d.pos[2]).every(Number.isFinite) && Array.from(c["pidP[0]"]).every(Number.isFinite), speed: sp / 60,
           trackRatio: rms(err) / rms(cmd), motMin: Math.min(...mot), motMax: Math.max(...mot), hasPid: !!c["pidD[2]"] }; });
// the endless flight: each flight carries on from the end of the last one (no jump, no collision) and starts with its last 5 s as history
let a = L.makeDemo(7, 40, w1), chain = { gap: 0, hits: a.hits, hist: 0, sticks: !!a.ch.thrCmd };
for (let k = 8; k <= 10; k++) { const b = L.makeDemo(k, 40, w1, a.cont), i = a.n - 1250;
  chain.gap = Math.max(chain.gap, Math.hypot(b.pos[0][1249] - a.pos[0][a.n - 1], b.pos[1][1249] - a.pos[1][a.n - 1], b.pos[2][1249] - a.pos[2][a.n - 1]), Math.hypot(b.pos[0][1250] - a.pos[0][a.n - 1], b.pos[1][1250] - a.pos[1][a.n - 1], b.pos[2][1250] - a.pos[2][a.n - 1]) - 0.5);
  for (let j = 0; j < 1250; j += 50) chain.hist = Math.max(chain.hist, Math.abs(b.ch["m%[0]"][j] - a.ch["m%[0]"][i + j]), Math.abs(b.pos[2][j] - a.pos[2][i + j]));
  chain.hits += b.hits; a = b; }
console.log(JSON.stringify({ chain, kinds: L.WORLD_KINDS.length, unique: names.size, used: used.size, minCount: Math.min(...Object.values(cnt)),
  same: JSON.stringify(w1.insts.slice(0, 50)) === JSON.stringify(w2.insts.slice(0, 50)) && w1.insts.length === w2.insts.length, flights }));
