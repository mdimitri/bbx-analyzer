// Filter planner (Noise tab → "Filter planner"): try notches and low-pass changes on the measured spectra.
// Prediction = ratio method: a filter change multiplies what passes by |H_new / H_now|², so
//   predicted filtered gyro = measured filtered gyro × |Hg_new/Hg_now|²,  predicted D = measured D × |Hg|²·|Hd|² ratio,
//   motor noise > 80 Hz = measured × √(Σ term share × that term's power ratio).  RPM and dynamic notches stay as they are.
const FP = { key: null, d: null };
S.fp = store.get("fp", null) || { gmul: 1, dmul: 1, man: { on: false, f: 150, q: 3 }, off: {}, statOff: {} };
const saveFp = () => store.set("fp", S.fp);
const nviewSeg = () => `<span class="seg" id="nview">${[["spectrum", "Spectrum", "psd"], ["planner", "✚ Filter planner", "fplan"]].map(([v, l, t]) => `<button data-v="${v}" data-tip="${t}" class="${(S.nview || "spectrum") === v ? "on" : ""}">${l}</button>`).join("")}</span>`;
function bindNview() { $("nview").onclick = e => { const v = e.target.dataset.v; if (!v || v === (S.nview || "spectrum")) return; S.nview = v; store.set("nview", v); Plotly.purge("main"); render(); }; }
S.nview = store.get("nview", "spectrum");

const notchQ = (fc, co) => Math.sqrt(fc * co) / (fc - co);
const notchCut = (fc, q) => fc * (Math.sqrt(1 + 4 * q * q) - 1) / (2 * q);
// per-stage frequency responses are memoised (planner sliders re-run this on every move)
const FP_H = new Map();
function stageResp(st, fs, mul, f) {
  const key = `${st.k}|${st.type}|${st.order}|${st.fc}|${st.q}|${st.w}|${fs}|${st.type === "notch" ? 1 : mul}|${f.length}|${f[1]}`;
  let r = FP_H.get(key);
  if (!r) {
    const S_ = mkStage(st, fs, st.type === "notch" ? 1 : mul), mag = new Float64Array(f.length), ph = new Float64Array(f.length);
    f.forEach((x, k) => { const h = S_.H(cexpj(-2 * Math.PI * x / fs)); mag[k] = cabs(h); ph[k] = Math.atan2(h.im, h.re); });
    r = { mag, ph }; if (FP_H.size > 400) FP_H.clear(); FP_H.set(key, r);
  }
  return r;
}
// whole chain at the frequencies f: magnitude product, phase summed per stage (no wrap)
function chainResp(stages, fs, mul, f) {
  const mag = new Float64Array(f.length).fill(1), ph = new Float64Array(f.length);
  for (const st of stages) { const r = stageResp(st, fs, mul, f); for (let k = 0; k < f.length; k++) { mag[k] *= r.mag[k]; ph[k] += r.ph[k]; } }
  return { mag, ph };
}
const FDL = [20, 50, 100];
const delayMs = (stages, fs, mul) => { const r = chainResp(stages, fs, mul, FDL); return FDL.map((x, k) => -r.ph[k] / (2 * Math.PI * x) * 1000); };

// Betaflight has two static gyro notches. Existing notches that stay on keep their slot; switched-on proposals (in list
// order) and the manual notch take the free ones; anything beyond that has no slot and is left out of the prediction.
function fpAssign(d) {
  const F = S.fp, idleReplaced = s => d.notches.some(n => n.replaces != null && Math.round(n.replaces) === Math.round(s.fc));
  const statOff = s => F.statOff[s.slot] ?? idleReplaced(s);
  const statOn = d.stages.gyro_notch.filter(s => !statOff(s));
  const free = [1, 2].filter(k => !statOn.some(s => s.slot === k));
  const isOn = n => F.off[n.id] === undefined ? n.slot != null : !F.off[n.id];
  const slot = {};
  d.notches.forEach(n => { if (isOn(n)) slot[n.id] = free.length ? free.shift() : null; });
  const man = F.man.on ? (free.length ? free.shift() : null) : undefined;
  return { statOn, statOff, isOn, slot, man };
}

function fpStages(d, plan) {
  if (!plan) return { gyro: [...d.stages.gyro, ...d.stages.gyro_notch.map(s => ({ ...s, k: "bq" }))], dterm: d.stages.dterm, gmul: 1, dmul: 1 };
  const A = fpAssign(d);
  const nn = d.notches.filter(n => A.slot[n.id] != null).map(n => ({ k: "bq", type: "notch", fc: n.fc, q: n.q, w: 1 }));
  if (A.man != null) nn.push({ k: "bq", type: "notch", fc: S.fp.man.f, q: S.fp.man.q, w: 1 });
  return { gyro: [...d.stages.gyro, ...A.statOn.map(s => ({ ...s, k: "bq" })), ...nn], dterm: d.stages.dterm, gmul: S.fp.gmul, dmul: S.fp.dmul };
}

function fpPredict(d) {
  const cur = fpStages(d, false), nw = fpStages(d, true), f = d.f, fg = d.fs_gyro, fp = d.fs_pid;
  const G0 = chainResp(cur.gyro, fg, 1, f), G1 = chainResp(nw.gyro, fg, nw.gmul, f), D0 = chainResp(cur.dterm, fp, 1, f), D1 = chainResp(nw.dterm, fp, nw.dmul, f);
  const rg = f.map((x, k) => x <= 0 ? 1 : (G1.mag[k] / Math.max(1e-9, G0.mag[k])) ** 2);
  const rd = f.map((x, k) => x <= 0 ? 1 : rg[k] * (D1.mag[k] / Math.max(1e-9, D0.mag[k])) ** 2);
  const db = r => 10 * Math.log10(Math.max(r, 1e-12));
  const axes = {};
  for (const [a, A] of Object.entries(d.axes)) {
    const lin = v => 10 ** (v / 10), hf = (arr, r) => { let s0 = 0, s1 = 0; f.forEach((x, k) => { if (x >= 80) { const p = lin(arr[k]); s0 += p; s1 += p * r[k]; } }); return s0 > 0 ? s1 / s0 : 1; };
    axes[a] = { filt: A.filt.map((v, k) => v + db(rg[k])), D: A.D ? A.D.map((v, k) => v + db(rd[k])) : null, rP: hf(A.filt, rg), rD: A.D ? hf(A.D, rd) : 1 };
  }
  let mot = null;
  if (d.budget) {
    const ax = Object.values(axes), mean = k => ax.reduce((s, x) => s + x[k], 0) / ax.length, sh = d.budget.share;
    const ratio = (sh.P || 0) * mean("rP") + (sh.D || 0) * mean("rD") + (sh.I || 0) + (sh.F || 0);
    mot = { now: d.budget.motor_max, new: d.budget.motor_max * Math.sqrt(ratio) };
  }
  const g0 = delayMs(cur.gyro, fg, 1), g1 = delayMs(nw.gyro, fg, nw.gmul), e0 = delayMs(cur.dterm, fp, 1), e1 = delayMs(nw.dterm, fp, nw.dmul);
  const delay = FDL.map((x, k) => ({ f: x, g0: g0[k], g1: g1[k], d0: g0[k] + e0[k], d1: g1[k] + e1[k] }));
  const dB = M => Array.from(M.mag, (m, k) => f[k] <= 0 ? 0 : 20 * Math.log10(Math.max(1e-6, m)));
  return { axes, mot, delay, cur, nw, hg0: dB(G0), hg1: dB(G1), hd0: dB(D0), hd1: dB(D1) };
}

// CLI for the low-pass multipliers, mirroring tuning.filter_knob (the settings that really move this quad's cutoffs)
function lpfCli(st, chain, sc) {
  const num = k => { const v = st[k]; return v == null ? 0 : +String(v).split(",")[0]; }, p = chain === "gyro" ? "gyro" : "dterm";
  if (num(`simplified_${p}_filter`) >= 1) { const c = num(`simplified_${p}_filter_multiplier`) || 100; return [`set simplified_${p}_filter_multiplier = ${Math.round(c * sc / 5) * 5}`]; }
  const out = [], dyn = String(st[`${p}_lpf1_dyn_hz`] || "0,0").split(",").map(Number);
  if (dyn[0] > 0) out.push(`set ${p}_lpf1_dyn_min_hz = ${Math.round(dyn[0] * sc)}`, `set ${p}_lpf1_dyn_max_hz = ${Math.round(dyn[1] * sc)}`);
  else if (num(`${p}_lpf1_static_hz`) > 0) out.push(`set ${p}_lpf1_static_hz = ${Math.round(num(`${p}_lpf1_static_hz`) * sc)}`);
  if (num(`${p}_lpf2_static_hz`) > 0) out.push(`set ${p}_lpf2_static_hz = ${Math.round(num(`${p}_lpf2_static_hz`) * sc)}`);
  return out;
}

async function renderPlanner() {
  const R = S.res, key = [S.file, S.sub, S.range, R.prom, R.persist, R.mask, resFmax(), S.prop && S.prop.inch].join("|");
  if (FP.key !== key) { FP.d = await api("filterplan", { ...rng(), prom: R.prom, persist: R.persist, mask: R.mask, fmax: resFmax() });
  if (S.tab !== "noise") return; FP.key = key; }
  const d = FP.d;
  if (d.error) { $("controls").innerHTML = tbar(`<h3>Noise & filters</h3>${nviewSeg()}<span class="hint">${esc(d.error)}</span>`, []); bindNview(); Plotly.purge("main"); $("findings").innerHTML = ""; return; }
  const F = S.fp, nyq = d.fs_log / 2, A = fpAssign(d);
  const nchips = d.notches.map(n => { const on = A.isOn(n), sl = A.slot[n.id];
    return `<button class="chip ${on ? "on" : ""} ${on && sl == null ? "noslot" : ""}" data-n="${n.id}" title="${on ? (sl == null ? "on, but both gyro notch slots are taken: switch another notch off" : `uses gyro_notch${sl}`) : "click to try it"}" style="color:${css("--s8")}"><i></i><span style="color:var(--ink2)">${n.id} ${n.fc.toFixed(0)} Hz · Q ${n.q.toFixed(1)}${on ? (sl == null ? " · no slot" : ` · n${sl}`) : ""}</span></button>`; }).join("");
  const schips = d.stages.gyro_notch.map(s => `<button class="chip ${A.statOff(s) ? "" : "on"}" data-s="${s.slot}" title="existing gyro_notch${s.slot}: ${s.useful ? "catching something" : "nothing there (+" + s.raw_excess_db + " dB)"}"><span style="color:var(--ink2)">notch${s.slot} ${s.fc.toFixed(0)} Hz ${s.useful ? "" : "· idle"}</span></button>`).join("");
  const sl = (id, a, b, st, v, fmt) => `<input id="${id}" type="range" min="${a}" max="${b}" step="${st}" value="${v}"><b id="${id}V">${fmt(v)}</b>`;
  $("controls").innerHTML = tbar(`<h3 data-tip="psd">Noise & filters</h3>${nviewSeg()}<span class="hint">what-if on the measured spectra · ${S.range ? "selected part of the flight" : "whole flight"} · thin = now, bold = with your changes · RPM and dynamic notches unchanged</span>`, [
    tg("Proposed notches · 2 slots", nchips || `<span class="hint">none needed</span>`, { tip: "fp_notch" }),
    d.stages.gyro_notch.length ? tg("Existing notches", `<span class="chips" id="fpS">${schips}</span>`) : "",
    tg("Manual notch", `<span class="chips" id="fpM">${chip("m", F.man.on ? "on" : "off", F.man.on, { color: css("--s4") })}</span>
      ${tpop("fpMan", `${F.man.f.toFixed(0)} Hz · Q ${F.man.q.toFixed(1)}`, `<div class="ph">Manual gyro notch</div>
        ${prow("Centre", sl("fpMf", 40, Math.min(1000, Math.round(nyq)), 1, F.man.f, v => (+v).toFixed(0) + " Hz"))}
        ${prow("Q (narrow ↔ wide)", sl("fpMq", 1, 10, 0.1, F.man.q, v => (+v).toFixed(1)))}
        <div class="hint">Q = centre / width. Higher Q = narrower, less delay, but misses a peak that drifts. Betaflight sets a static notch by centre and the lower −3 dB edge (cutoff): <b id="fpMc">${notchCut(F.man.f, F.man.q).toFixed(0)}</b> Hz.</div>`)}`, { tip: "fp_manual" }),
    tg("Low-pass", `<label class="ctl" data-tip="sim_gmul">Gyro × ${sl("fpG", 0.5, 2, 0.05, F.gmul, v => (+v).toFixed(2))}</label><label class="ctl" data-tip="sim_dmul">D-term × ${sl("fpD", 0.5, 2, 0.05, F.dmul, v => (+v).toFixed(2))}</label>
      <button class="btn sm ghost" id="fpReset">Reset</button>`),
    tg("D-term spectrum", `<span class="chips" id="fpDs">${chip("d", F.dOn !== false ? "now & planned" : "hidden", F.dOn !== false, { color: css("--s7"), dash: true })}</span>`, { tip: "fp_dterm" }),
    tg("Axes", focusHTML()),
    resCtlHTML(d.resonances.length)]);
  bindNview(); bindFocus(); bindResCtl();
  const upd = () => { saveFp(); drawPlanner(d); };
  $("controls").querySelectorAll("[data-n]").forEach(b => b.onclick = () => { const n = d.notches.find(x => x.id === b.dataset.n); F.off[n.id] = A.isOn(n); saveFp(); render(); });
  $("controls").querySelectorAll("[data-s]").forEach(b => b.onclick = () => { const st = d.stages.gyro_notch.find(x => String(x.slot) === b.dataset.s); F.statOff[st.slot] = !A.statOff(st); saveFp(); render(); });
  $("fpM").onclick = () => { F.man.on = !F.man.on; saveFp(); render(); };
  $("fpDs").onclick = () => { F.dOn = F.dOn === false; saveFp(); render(); };
  const live = (id, k, fmt, set) => { $(id).oninput = e => { set(+e.target.value); $(id + "V").textContent = fmt(e.target.value);
    if ($("fpMc")) $("fpMc").textContent = notchCut(F.man.f, F.man.q).toFixed(0); clearTimeout(FP.t); FP.t = setTimeout(upd, 40); }; };
  live("fpMf", 0, v => (+v).toFixed(0) + " Hz", v => { F.man.f = v; if (!F.man.on) { F.man.on = true; } });
  live("fpMq", 0, v => (+v).toFixed(1), v => { F.man.q = v; });
  live("fpG", 0, v => (+v).toFixed(2), v => { F.gmul = v; });
  live("fpD", 0, v => (+v).toFixed(2), v => { F.dmul = v; });
  $("fpReset").onclick = () => { S.fp = { gmul: 1, dmul: 1, man: { on: false, f: F.man.f, q: F.man.q }, off: {}, statOff: {}, dOn: F.dOn }; saveFp(); render(); };
  await drawPlanner(d);
}

async function drawPlanner(d) {
  const P = fpPredict(d), f = d.f, SH = shownAxes([0, 1, 2]).filter(i => d.axes[i]), nC = SH.length, xs = c => c ? c + 1 : "", tr = [];
  const dVis = S.fp.dOn !== false ? true : "legendonly";
  const k0 = f.findIndex(v => v >= 10), cut = a => a.slice(k0), fx = cut(f), lightMode = document.documentElement.dataset.theme === "light";
  SH.forEach((i, c) => {
    const A = d.axes[i], s = xs(c), sb = c + 1 + nC, col = axc(i);
    tr.push(line(fx, cut(A.raw), "gyro raw", css("--muted"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "raw", showlegend: !c, line: { width: 1 } }));
    tr.push(line(fx, cut(A.filt), "filtered now", col, { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "now", showlegend: !c, line: { width: 1 }, opacity: 0.55 }));
    tr.push(line(fx, cut(P.axes[i].filt), "filtered, planned", col, { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "new", showlegend: !c, line: { width: 2.4 } }));
    if (A.D) { tr.push(line(fx, cut(A.D), "D-term now", css("--s7"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "dn", showlegend: !c, line: { width: 1, dash: "dot" }, opacity: 0.6, visible: dVis }));
               tr.push(line(fx, cut(P.axes[i].D), "D-term, planned", css("--s7"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "dp", showlegend: !c, line: { width: 2.4, dash: "dot" }, visible: dVis })); }
    tr.push(line(fx, cut(P.hg0), "gyro chain now", css("--ink"), { type: "scatter", xaxis: `x${sb}`, yaxis: `y${sb}`, legendgroup: "hg0", showlegend: false, line: { width: 1, dash: "dash" }, opacity: 0.6 }));
    tr.push(line(fx, cut(P.hg1), "gyro chain planned", css("--ink"), { type: "scatter", xaxis: `x${sb}`, yaxis: `y${sb}`, legendgroup: "hg1", showlegend: false, line: { width: 2.2 } }));
    tr.push(line(fx, cut(P.hd0), "D-term chain now", css("--s7"), { type: "scatter", xaxis: `x${sb}`, yaxis: `y${sb}`, legendgroup: "hd0", showlegend: false, line: { width: 1, dash: "dash" }, opacity: 0.6 }));
    tr.push(line(fx, cut(P.hd1), "D-term chain planned", css("--s7"), { type: "scatter", xaxis: `x${sb}`, yaxis: `y${sb}`, legendgroup: "hd1", showlegend: false, line: { width: 2 } }));
  });
  const L = noiseLayout(SH.map(i => AX[i]));
  L.annotations = L.annotations.filter(a => !String(a.text).startsWith("Filter response"));
  L.annotations.push({ text: "Filter response: dashed = now · solid = planned (black/white = gyro filters, purple = D-term low-pass)", xref: "paper", yref: "paper", x: 0, y: 0.375, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 10, color: css("--ink2") } });
  L.xaxis.range = S.nfr || [10, d.fs_log / 2]; L.xaxis.uirevision = ++TSY.rev;
  // notch markers: proposed (red), manual (amber), existing static (grey)
  L.shapes = [];
  const mark = (fx_, col, dash, lab, y) => SH.forEach((_, c) => { const s = xs(c);
    L.shapes.push({ type: "line", xref: `x${s}`, yref: "paper", x0: fx_, x1: fx_, y0: 0, y1: 1, line: { color: col, width: 1.4, dash }, opacity: .8 });
    if (lab) L.annotations.push({ text: lab, xref: `x${s}`, yref: "paper", x: fx_, y, showarrow: false, font: { size: 10, color: col }, bgcolor: rgba(css("--surface").length === 7 ? css("--surface") : "#1a1a19", .85) }); });
  const A = fpAssign(d);
  d.notches.forEach((n, k) => { if (A.slot[n.id] != null) mark(n.fc, RED(), "dash", `${n.id} ${n.fc.toFixed(0)}`, k % 2 ? 0.93 : 0.97); });
  d.stages.gyro_notch.forEach(s => mark(s.fc, css("--muted"), "dot", A.statOff(s) ? `off ${s.fc.toFixed(0)}` : `n${s.slot} ${s.fc.toFixed(0)}`, 0.89));
  if (S.fp.man.on) mark(S.fp.man.f, css("--s4"), "dash", `manual ${S.fp.man.f.toFixed(0)}`, 0.85);
  $("main")._freq = true;
  fitMain(nC > 1 ? 460 : 420);
  await Plotly.react("main", tr, L, CFG);
  plannerPanel(d, P);
}

function plannerPanel(d, P) {
  const F = S.fp, h = d.settings, cli = [];
  const A = fpAssign(d), taken = new Set();
  d.notches.forEach(n => { const sl = A.slot[n.id]; if (sl == null) return; taken.add(sl);
    cli.push(`set gyro_notch${sl}_hz = ${Math.round(n.fc)}`, `set gyro_notch${sl}_cutoff = ${n.cutoff}`); });
  if (A.man != null) { taken.add(A.man); cli.push(`set gyro_notch${A.man}_hz = ${Math.round(F.man.f)}`, `set gyro_notch${A.man}_cutoff = ${Math.round(notchCut(F.man.f, F.man.q))}`); }
  else if (A.man === null) cli.push("# manual notch: both gyro notch slots are taken (switch one off above)");
  d.stages.gyro_notch.forEach(s => { if (A.statOff(s) && !taken.has(s.slot)) cli.push(`set gyro_notch${s.slot}_hz = 0`); });
  const skipped = d.notches.filter(n => A.isOn(n) && A.slot[n.id] == null);
  if (skipped.length) cli.push(`# not included (no free slot): ${skipped.map(n => n.id).join(", ")}`);
  if (Math.abs(F.gmul - 1) > 0.01) cli.push(...lpfCli(h, "gyro", F.gmul));
  if (Math.abs(F.dmul - 1) > 0.01) cli.push(...lpfCli(h, "dterm", F.dmul));
  if (d.rpm_fix) cli.push(...d.rpm_fix.cli.split("\n").map(x => x + "   # RPM filter fade, see below"));
  if (cli.length) cli.push("save");
  const fm = (v, p = 1) => (v >= 0 ? "+" : "") + v.toFixed(p), cls = v => v > 0.05 ? "up" : v < -0.05 ? "down" : "";
  const dRows = P.delay.map(x => `<tr><td>${x.f} Hz</td><td>${x.g0.toFixed(2)} → <b>${x.g1.toFixed(2)}</b> <span class="dd ${cls(x.g1 - x.g0)}">${fm(x.g1 - x.g0, 2)}</span></td>
    <td>${x.d0.toFixed(2)} → <b>${x.d1.toFixed(2)}</b> <span class="dd ${cls(x.d1 - x.d0)}">${fm(x.d1 - x.d0, 2)}</span></td></tr>`).join("");
  const ax = Object.entries(P.axes).map(([a, x]) => `<tr><td><span class="sw" style="background:${axc(+a)}"></span>${AX[+a]}</td><td>${fm(10 * Math.log10(x.rP))} dB</td><td>${d.axes[a].D ? fm(10 * Math.log10(x.rD)) + " dB" : "–"}</td></tr>`).join("");
  const mot = P.mot ? `<div class="kpi ${P.mot.new > P.mot.now * 1.05 ? "lv-warning" : P.mot.new < P.mot.now * 0.95 ? "lv-good" : ""}"><b>${P.mot.now.toFixed(2)} → ${P.mot.new.toFixed(2)}%</b><span data-tip="motor_noise">motor-command noise above 80 Hz (worst motor)</span></div>` : "";
  const ncards = d.notches.map(n => { const on = A.isOn(n), sl = A.slot[n.id];
    return `<div class="fpn ${on && sl != null ? "" : "off"}"><div><b style="color:var(--serious)">${n.id}</b> <b>${n.fc.toFixed(0)} Hz</b>, Q ${n.q.toFixed(1)} (cutoff ${n.cutoff} Hz)
      ${!on ? `<span class="hint">off: click its chip above to try it</span>` : sl == null ? `<span class="badge lv-warning">no free slot</span> <span class="hint">Betaflight has two static gyro notches; switch another one off</span>`
        : `→ gyro_notch${sl}${n.replaces != null ? ` <span class="hint">(replaces the idle notch at ${Math.round(n.replaces)} Hz)</span>` : ""}`}</div>
      <div class="hint">${n.why.map(esc).join(" · ")}</div>${n.warn ? `<div class="warnline">⚠ ${esc(n.warn)}</div>` : ""}</div>`; }).join("");
  const rpm = d.rpm_fix ? `<div class="fpn"><div><b>RPM filter fade</b>: at a typical motor speed of ${d.rpm_fix.typ_hz} Hz the RPM notches work at only ${Math.round(d.rpm_fix.eff * 100)}% strength
      (rpm_filter_min_hz ${d.rpm_fix.min_hz}, fade ${d.rpm_fix.fade} Hz). Lowering the fade start lets them work fully where this quad flies. Included in the CLI.</div></div>` : "";
  $("findings").innerHTML = `<div class="fh" data-tip="fplan">What this plan does</div>
    <div class="fpgrid"><div class="pwr fpbox"><div class="kpis">${mot}</div>
      <table class="cmp fpt"><tr><th></th><th data-tip="P">noise into P (&gt;80 Hz)</th><th data-tip="D">noise into D (&gt;80 Hz)</th></tr>${ax}</table>
      <table class="cmp fpt"><tr><th data-tip="delay">delay at</th><th>gyro chain (ms)</th><th>D-term path (ms)</th></tr>${dRows}</table>
      <div class="hint">Delay = phase delay of the filters you can change (low-pass + static notches) at that frequency; the loop works mostly at 20–100 Hz, so a few tenths of a ms there is what a notch or a lower low-pass costs.
        Noise predictions scale the measured spectra by the change in filter response, so they hold for the same flight style and props.</div></div>
    <div>${ncards || `<div class="hint">No resonance needs a notch: the filters already remove ≥ 15 dB at every suspected line, or none was found. Use the manual notch to experiment.</div>`}${rpm}
      <div class="fh" style="margin-top:8px">CLI for this plan</div>
      ${cli.length ? `<pre class="cli" id="fpCli">${esc(cli.join("\n"))}</pre><button class="btn sm" id="fpCopy">Copy CLI</button>` : `<div class="hint">No changes yet: toggle a proposed notch or move a slider.</div>`}
      <div class="hint" style="margin-top:6px">Test any filter change with a short hover and a few punch-outs, then feel the motors. Less filtering means warmer motors.</div></div></div>`;
  if ($("fpCopy")) $("fpCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(cli.join("\n")); $("fpCopy").textContent = "Copied ✓"; };
}
