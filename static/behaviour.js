// PID terms → "Behaviour": what each term does, from flight.pid_behaviour.
// Top: spectra of P, I, D, FF and the tracking error with the sticks still (where each term puts its effort, by frequency).
// Bottom: a verdict card per axis — oscillation (P loop / P-I chase / vibration), D vibration, P-D balance and feedforward.
S.pidv = store.get("pidv", "traces");
const pidvSeg = () => `<span class="seg" id="pidv">${[["traces", "Traces", "pid_traces"], ["behaviour", "Behaviour", "pid_beh"]].map(([v, l, t]) => `<button data-v="${v}" data-tip="${t}" class="${S.pidv === v ? "on" : ""}">${l}</button>`).join("")}</span>`;
function bindPidv() { if ($("pidv")) $("pidv").onclick = e => { const v = e.target.dataset.v; if (!v || v === S.pidv) return; S.pidv = v; store.set("pidv", v); Plotly.purge("main"); $("dash").hidden = true; render(); }; }
const TERMC = { axisP: "--roll", axisI: "--pitch", axisD: "--yaw", axisF: "--s4" };
const TERML = { axisP: "P", axisI: "I", axisD: "D", axisF: "FF", err: "error (setpoint − gyro)" };
const OSCK = { loop: ["loop ringing", "warning"], pi: ["P and I chasing", "warning"], vibration: ["vibration (not the tune)", "info"], other: ["fast ripple (not the loop)", "info"] };

async function renderPidBehaviour() {
  const A = await tsAnalysis("pidterms"), tab0 = S.tab;
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_pid">PID terms</h3>${pidvSeg()}<span class="hint">with the sticks still: how strongly each term works at each frequency · peaks in the error = oscillation · ${S.range ? "selected part of the flight" : "whole flight"}</span>`, []);
  bindPidv();
  if (S.tab !== tab0) return;
  const B = A && A.behaviour;
  if (!B) { Plotly.purge("main"); $("findings").innerHTML = `<div class="hint">${esc((A && A.error) || "Behaviour analysis needs a longer stretch of flight.")}</div>`; return; }
  $("main")._time = [];
  const axes = [0, 1, 2].filter(i => B.axes[i] && B.axes[i].still), tr = [], fl = B.f_loop_max;
  const L = base({ hovermode: "x unified", dragmode: "pan", margin: { l: 46, r: 8, t: 40, b: 34 } }), ax = L._ax; delete L._ax;
  L.annotations = []; L.shapes = [];
  const all = axes.flatMap(i => Object.values(B.axes[i].still).flat()).filter(Number.isFinite);
  const yr = all.length ? [Math.floor(Math.min(...all) / 5) * 5 - 2, Math.ceil(Math.max(...all) / 5) * 5 + 4] : [0, 80];
  const gap = 0.04, w = (1 - (axes.length - 1) * gap) / Math.max(1, axes.length);
  axes.forEach((i, k) => {
    const a = B.axes[i], s = k ? k + 1 : "", x0 = k * (w + gap);
    L[`xaxis${s}`] = { ...ax, type: "log", domain: [x0, x0 + w], anchor: `y${s}`, range: [Math.log10(0.8), Math.log10(Math.min(300, a.f.at(-1)))], title: { text: "frequency (Hz)", font: { size: 10 }, standoff: 2 }, ...(k ? { matches: "x" } : {}) };
    L[`yaxis${s}`] = { ...ax, anchor: `x${s}`, fixedrange: true, range: yr, autorange: false, title: k ? undefined : { text: "power (dB)", font: { size: 10 }, standoff: 2 }, ...(k ? { matches: "y" } : {}) };
    for (const key of ["err", "axisP", "axisI", "axisD", "axisF"]) { const y = a.still[key]; if (!y) continue;
      tr.push(line(a.f, y, TERML[key], key === "err" ? css("--ink") : css(TERMC[key]), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: key, showlegend: !k,
        line: { width: key === "err" ? 2.4 : 1.4, dash: key === "axisF" ? "dot" : "solid" }, opacity: key === "err" ? 1 : 0.85 })); }
    // frequency regions: where a loop oscillation can sit on this size; where vibration lives
    L.shapes.push({ type: "rect", xref: `x${s}`, yref: `y${s} domain`, x0: 2.5, x1: fl, y0: 0, y1: 1, fillcolor: rgba(css("--warning"), .06), line: { width: 0 }, layer: "below" });
    L.shapes.push({ type: "rect", xref: `x${s}`, yref: `y${s} domain`, x0: 80, x1: 1000, y0: 0, y1: 1, fillcolor: rgba(css("--serious"), .05), line: { width: 0 }, layer: "below" });
    L.annotations.push({ text: `loop range ≤ ${fl} Hz`, xref: `x${s}`, yref: `y${s} domain`, x: Math.log10(Math.sqrt(2.5 * fl)), y: 0.01, yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--warn-ink") } });
    L.annotations.push({ text: "vibration", xref: `x${s}`, yref: `y${s} domain`, x: Math.log10(140), y: 0.01, yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--serious") } });
    L.annotations.push({ text: `<b>${AX[i]}</b>`, xref: "paper", yref: "paper", x: x0, y: 1.0, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12, color: axc(i) } });
    const o = a.osc;
    if (o && o.kind) { const [lab, lv] = OSCK[o.kind];
      L.shapes.push({ type: "line", xref: `x${s}`, yref: `y${s} domain`, x0: o.f, x1: o.f, y0: 0, y1: 1, line: { color: LVC(lv), width: 2, dash: "dash" } });
      L.annotations.push({ text: `${o.f.toFixed(1)} Hz · ${lab}`, xref: `x${s}`, yref: `y${s} domain`, x: Math.log10(o.f), y: 0.97, showarrow: false, font: { size: 10, color: LVC(lv) },
        bgcolor: rgba(css("--surface").length === 7 ? css("--surface") : "#1a1a19", .85) }); }
    if (a.d_vib && a.d_vib.share >= 0.3) L.annotations.push({ text: `D ${Math.round(a.d_vib.share * 100)}% above 80 Hz`, xref: `x${s}`, yref: `y${s} domain`, x: Math.log10(Math.max(90, a.d_vib.f)), y: 0.86, showarrow: false, font: { size: 10, color: css(TERMC.axisD) } });
  });
  L.showlegend = true; L.legend = { ...L.legend, orientation: "h", x: 1, xanchor: "right", y: 1.09 };
  fitMain(380);
  await Plotly.react("main", tr, L, CFG);
  // verdict cards
  const card = i => {
    const a = B.axes[i]; if (!a) return "";
    const rows = [], o = a.osc, mv = a.moves, dv = a.d_vib;
    if (o) {
      const k = o.kind, lv = k ? OSCK[k][1] : "good";
      rows.push([lv, "Oscillation", k === "loop" ? `rings at <b>${o.f.toFixed(1)} Hz</b> (+${o.prom_db} dB)${o.d_over_p > 0 ? `; D pushes ${o.d_over_p}× P there` : " (no D on this axis)"}`
        : k === "pi" ? `slow <b>${o.f.toFixed(1)} Hz</b> swing, I pushes ${o.i_over_p}× as hard as P: they chase each other`
        : k === "vibration" ? `strongest ripple ${o.f.toFixed(0)} Hz sits on ${o.res ? "a frame resonance" : "a motor order"}: vibration, not the tune`
        : k === "other" ? `ripple at ${o.f.toFixed(0)} Hz: too fast for a loop oscillation on this size`
        : `no clear peak (strongest +${o.prom_db} dB at ${o.f.toFixed(1)} Hz, under the 4 dB bar)`]);
      rows.push([o.i_over_p >= 0.8 && o.f <= 6 ? "warning" : "good", "P vs I", `at that frequency |I| / |P| = ${o.i_over_p}${o.i_over_p >= 0.8 ? " — I is as strong as P" : " — P leads, I only trims"}`]);
    }
    if (dv) rows.push([dv.share >= 0.65 ? "warning" : dv.share >= 0.5 ? "info" : "good", "D vibration", `${Math.round(dv.share * 100)}% of D is above 80 Hz, strongest at ${dv.f.toFixed(0)} Hz (${esc(dv.where)})`]);
    if (mv) {
      rows.push(["info", "P–D balance", mv.gain_d_over_p > 0 ? `in stick moves (2–30 Hz) D is ${mv.d_over_p}× P · gains D/P = ${mv.gain_d_over_p}, I/P = ${mv.gain_i_over_p}` : `no D on this axis · gain I/P = ${mv.gain_i_over_p}`]);
      const dl = mv.ff_delivered;
      rows.push(["info", "Feedforward", `${Math.round(mv.ff_share * 100)}% of P+FF in moves${dl ? ` · delivered vs nominal (acro): ${Object.entries(dl).map(([k, v]) => `${k} ${Math.round(v * 100)}%`).join(", ")}` : ""}`]);
    }
    const worst = worstOf(rows.map(r => r[0]));
    return `<section class="bcard lv-${worst}"><div class="mh"><b style="color:${axc(i)}">${AX[i]}</b><span class="badge lv-${worst}">${LV[worst]}</span></div>
      ${rows.map(([lv, k, v]) => `<div class="brow"><span class="bdot" style="background:${LVC(lv)}"></span><span class="bk">${k}</span><span>${v}</span></div>`).join("")}</section>`;
  };
  $("dash").hidden = false;
  $("dash").innerHTML = `<div class="bgrid">${[0, 1, 2].map(card).join("")}</div>
    ${B.modes && B.modes.acro < 95 ? `<div class="hint" style="padding:0 2px">Flown ${100 - B.modes.acro}% in angle/horizon mode: feedforward numbers use the acro part only.</div>` : ""}`;
}
