// Filter delay tab: where the delay comes from (stacked bars at each axis's crossover, yours vs a typical setup for the
// size), what it costs the PID loop (phase margin, sweeps of the low-pass cutoffs, P/D headroom), and how it changes
// with throttle. All numbers come from delay.py (exact Betaflight filter equations + the plant learned from this log).
S.dlyAx = store.get("dlyAx", "roll");
const DLY = { key: null, d: null };
const DLYV = { good: ["--good", "like typical or lighter"], warning: ["--warning", "heavier than typical"], serious: ["--serious", "much heavier than typical"] };
const SHORT = { gyro_lpf1: "Gyro LPF1", gyro_lpf2: "Gyro LPF2", gyro_notch: "Static notch", rpm: "RPM filter", dyn_notch: "Dyn notch", dterm_lpf1: "D LPF1",
  dterm_lpf2: "D LPF2", dterm_notch: "D notch", yaw_lpf: "Yaw P LPF" };
const pmLv = pm => pm == null ? "info" : pm >= 45 ? "good" : pm >= 30 ? "warning" : "serious";
const pmWord = pm => pm == null ? "–" : pm >= 45 ? "healthy" : pm >= 30 ? "low" : "very low";

async function renderDelay() {
  const key = [S.file, S.sub, S.prop && S.prop.inch, S.prop && S.prop.blades].join("|");
  if (DLY.key !== key) { DLY.d = await api("delay"); DLY.key = key; }
  if (S.tab !== "delay") return;
  const D = DLY.d, axes = Object.keys(D.axes || {});
  if (!axes.length) { $("controls").innerHTML = tbar(`<h3>Filter delay</h3><span class="hint">not enough data to model the loop</span>`, []); Plotly.purge("main"); return; }
  if (!axes.includes(S.dlyAx)) S.dlyAx = axes[0];
  const A = D.axes[S.dlyAx], ai = AX.findIndex(x => x.toLowerCase() === S.dlyAx);
  $("controls").innerHTML = tbar(`<h3 data-tip="dly_tab">Filter delay</h3><span class="hint">delay each filter adds at the loop's crossover frequency, yours vs a typical ${D.inch}″ setup, and what it costs the PID</span>`, [
    tg("Axis", `<span class="seg" id="dlyAx">${axes.map(a => `<button data-v="${a}" class="${a === S.dlyAx ? "on" : ""}" style="--c:${axc(AX.findIndex(x => x.toLowerCase() === a))}"><i></i>${a[0].toUpperCase() + a.slice(1)}</button>`).join("")}</span>`),
    tg("Colours", `<span class="dlyleg">${Object.entries(DLYV).map(([k, [c, t]]) => `<span><i style="background:${css(c)}"></i>${t}</span>`).join("")}<span><i style="background:${css("--muted")}"></i>typical ${D.inch}″</span></span>`, { tip: "dly_bar" })]);
  $("dlyAx").onclick = e => { const b = e.target.closest("button"); if (!b) return; S.dlyAx = b.dataset.v; store.set("dlyAx", S.dlyAx); render(); };
  await drawDelay(D, A, ai);
  delayPanel(D, A, ai);
}

async function drawDelay(D, A, ai) {
  const tr = [], fc = A.fc, deg = ms => ms / 1000 * 360 * fc;
  const L = base({ hovermode: "closest", barmode: "stack", bargap: 0.35, margin: { l: 120, r: 16, t: 34, b: 40 }, showlegend: false }); const ax = L._ax; delete L._ax;
  L.annotations = [];
  // ---- row 1: stacked bars (yours coloured by verdict, typical in grey), P path and D path, plus the whole loop for scale
  const rowsY = ["Whole loop", `D path · typical`, "D path · yours", `P path · typical`, "P path · yours"];
  const yours = (ch) => A.rows.filter(r => ch === "p" ? (r.chain === "gyro" || r.chain === "yawp") : (r.chain === "gyro" || r.chain === "dterm"));
  const typRows = ch => {   // typical stages: same keys where they exist, plus the typical-only ones
    const own = yours(ch).map(r => ({ key: r.key, ms: r.typ_ms })).filter(r => r.ms > 0);
    const ex = (A.extra_typical || []).filter(e => ch === "d" || !e.key.startsWith("dterm")).map(e => ({ key: e.key, ms: e.ms }));
    return own.concat(ex);
  };
  const seg = (y, r, color, typ) => ({ type: "bar", orientation: "h", y: [y], x: [r.ms], xaxis: "x", yaxis: "y", marker: { color, line: { color: css("--surface"), width: 2 } },
    text: [r.ms >= 0.8 ? SHORT[r.key] || r.key : ""], textposition: "inside", insidetextanchor: "middle", textangle: 0, textfont: { size: 10, color: typ ? css("--ink") : "#ffffff" }, cliponaxis: false,
    hovertemplate: typ ? `<b>${SHORT[r.key] || r.key}</b> (typical ${D.inch}″)<br>${r.ms.toFixed(2)} ms · ${deg(r.ms).toFixed(1)}° at ${fc.toFixed(0)} Hz<extra></extra>`
      : `<b>${esc(r.label)}</b><br>${r.ms.toFixed(2)} ms = ${deg(r.ms).toFixed(1)}° of phase at ${fc.toFixed(0)} Hz<br>typical ${D.inch}″: ${r.typ_ms.toFixed(2)} ms${r.ratio ? ` (×${r.ratio.toFixed(2)})` : ""}<br>${DLYV[r.verdict][1]}<extra></extra>` });
  for (const [ch, yy, yt] of [["p", "P path · yours", "P path · typical"], ["d", "D path · yours", "D path · typical"]]) {
    yours(ch).filter(r => r.ms > 0).forEach(r => tr.push(seg(yy, r, css(DLYV[r.verdict][0]), false)));
    typRows(ch).forEach((r, i) => tr.push(seg(yt, r, rgba(css("--muted").length === 7 ? css("--muted") : "#898781", 0.35 + 0.12 * (i % 3)), true)));
  }
  // whole loop: the filters (D path) next to the delays that are not filtering, for scale
  const loopParts = [{ key: "filt", label: "Filters (D path)", ms: A.d_ms, c: css("--accent") }, ...A.timing.map((t, i) => ({ key: t.key, label: t.label, ms: t.ms, c: ["#6b7280", "#8b93a3", "#aab1bf"][i] }))];
  loopParts.forEach(p => tr.push({ type: "bar", orientation: "h", y: ["Whole loop"], x: [p.ms], xaxis: "x", yaxis: "y", marker: { color: p.c, line: { color: css("--surface"), width: 2 } },
    text: [p.ms >= 1 ? ({ filt: "filters", loop: "loop", esc: "ESC", motor: "motor lag" }[p.key]) : ""], textposition: "inside", insidetextanchor: "middle", textangle: 0, textfont: { size: 10, color: "#ffffff" },
    hovertemplate: `<b>${esc(p.label)}</b><br>${p.ms.toFixed(2)} ms = ${deg(p.ms).toFixed(1)}° at ${fc.toFixed(0)} Hz<extra></extra>` }));
  L.xaxis = { ...ax, domain: [0, 1], anchor: "y", title: { text: `phase delay at the ${fc.toFixed(1)} Hz crossover (ms)`, font: { size: 10 }, standoff: 2 }, rangemode: "tozero" };
  L.yaxis = { ...ax, domain: [0.62, 1], anchor: "x", categoryorder: "array", categoryarray: rowsY, fixedrange: true, tickfont: { size: 11, color: css("--ink") } };
  L.annotations.push({ text: `<b>Where the delay comes from</b> · ${AX[ai]} · totals: P path ${A.p_ms.toFixed(2)} ms (typical ${A.p_typ.toFixed(2)}), D path ${A.d_ms.toFixed(2)} ms (typical ${A.d_typ.toFixed(2)})`,
    xref: "paper", yref: "paper", x: 0, y: 1.0, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12, color: css("--ink") } });
  // ---- rows 2–3: four small panels (each its own scale; no dual axes)
  const P = [[0, 0.46, 0.30, 0.52], [0.54, 1, 0.30, 0.52], [0, 0.46, 0, 0.22], [0.54, 1, 0, 0.22]];   // x0, x1, y0, y1
  P.forEach(([x0, x1, y0, y1], k) => { const n = k + 2;
    L[`xaxis${n}`] = { ...ax, domain: [x0, x1], anchor: `y${n}` }; L[`yaxis${n}`] = { ...ax, domain: [y0, y1], anchor: `x${n}`, fixedrange: true }; });
  const title = (n, t, tip) => L.annotations.push({ text: `<b>${t}</b>`, xref: "paper", yref: "paper", x: P[n - 2][0], y: P[n - 2][3], xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11, color: css("--ink") }, hovertext: tip });
  const SW = { both: ["gyro + D-term", css("--ink")], gyro: ["gyro only", css("--accent")], dterm: ["D-term only", css("--s7")] };
  const mu = A.mults;
  A.sweep.forEach(sw => {
    tr.push(line(mu, sw.pm, SW[sw.kind][0], SW[sw.kind][1], { type: "scatter", xaxis: "x2", yaxis: "y2", line: { width: 2 }, hovertemplate: `${SW[sw.kind][0]} × %{x:.2f}: %{y:.0f}° margin<extra></extra>` }));
    tr.push(line(mu, sw.noise, SW[sw.kind][0], SW[sw.kind][1], { type: "scatter", xaxis: "x3", yaxis: "y3", line: { width: 2 }, hovertemplate: `${SW[sw.kind][0]} × %{x:.2f}: %{y:.2f}% motor noise<extra></extra>` }));
  });
  const cur = A.margins.now.pm, i1 = mu.reduce((b, v, i) => Math.abs(v - 1) < Math.abs(mu[b] - 1) ? i : b, 0);
  tr.push({ type: "scatter", mode: "markers", x: [1], y: [cur], xaxis: "x2", yaxis: "y2", marker: { size: 10, color: css(`--${pmLv(cur) === "info" ? "info" : pmLv(cur)}`), line: { color: css("--surface"), width: 2 } }, hovertemplate: `now: %{y:.0f}°<extra></extra>` });
  tr.push({ type: "scatter", mode: "markers", x: [1], y: [A.sweep[0].noise[i1]], xaxis: "x3", yaxis: "y3", marker: { size: 10, color: css("--ink"), line: { color: css("--surface"), width: 2 } }, hovertemplate: `now: %{y:.2f}%<extra></extra>` });
  L.xaxis2 = { ...L.xaxis2, type: "log", title: { text: "low-pass cutoffs × (left = more filtering)", font: { size: 10 }, standoff: 2 }, tickvals: [0.5, 0.7, 1, 1.4, 2], ticktext: ["×0.5", "×0.7", "×1", "×1.4", "×2"] };
  L.xaxis3 = { ...L.xaxis3, type: "log", title: { text: "low-pass cutoffs ×", font: { size: 10 }, standoff: 2 }, tickvals: [0.5, 0.7, 1, 1.4, 2], ticktext: ["×0.5", "×0.7", "×1", "×1.4", "×2"] };
  L.yaxis2.title = { text: "phase margin (°)", font: { size: 10 }, standoff: 2 }; L.yaxis3.title = { text: "motor noise > 80 Hz (%)", font: { size: 10 }, standoff: 2 };
  L.shapes = [{ type: "line", xref: "x2", yref: "y2", x0: 0.5, x1: 2, y0: 45, y1: 45, line: { color: css("--good"), dash: "dash", width: 1 } }];
  L.annotations.push({ text: "45° target", xref: "x2", yref: "y2", x: Math.log10(0.52), y: 45, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--good-ink") } });
  title(2, `Phase margin if the low-pass filters change`, "Each line scales the low-pass cutoffs of one chain (or both) on this axis; the dot is your current setup.");
  title(3, `…and the motor noise it would cost`, "Predicted from your own filtered-gyro spectrum, through the PID and filters (above 80 Hz, motor %).");
  // delay vs throttle (P and D path at the crossover)
  const T = A.thr;
  tr.push(line(T.t, T.p, "P path", css("--accent"), { type: "scatter", xaxis: "x4", yaxis: "y4", line: { width: 2 }, hovertemplate: "P path at %{x:.0f}% throttle: %{y:.2f} ms<extra></extra>" }));
  tr.push(line(T.t, T.d, "D path", css("--s7"), { type: "scatter", xaxis: "x4", yaxis: "y4", line: { width: 2 }, hovertemplate: "D path at %{x:.0f}% throttle: %{y:.2f} ms<extra></extra>" }));
  L.shapes.push({ type: "line", xref: "x4", yref: "y4 domain", x0: D.hover_thr, x1: D.hover_thr, y0: 0, y1: 1, line: { color: css("--muted"), dash: "dot", width: 1 } });
  L.annotations.push({ text: "hover", xref: "x4", yref: "y4 domain", x: D.hover_thr, y: 0.97, xanchor: "left", yanchor: "top", xshift: 3, showarrow: false, font: { size: 9, color: css("--ink2") } });
  L.xaxis4.title = { text: "throttle (%)", font: { size: 10 }, standoff: 2 }; L.yaxis4.title = { text: "ms at crossover", font: { size: 10 }, standoff: 2 }; L.yaxis4.rangemode = "tozero";
  title(4, "Filter delay across the throttle range", "Dynamic low-pass filters open up with throttle: most delay at low throttle, where propwash happens.");
  // phase delay vs frequency (yours vs typical)
  const C = D.curve;
  tr.push(line(C.f, C.gyro, "P path (gyro chain)", css("--accent"), { type: "scatter", xaxis: "x5", yaxis: "y5", line: { width: 2 }, hovertemplate: "P path %{x:.0f} Hz: %{y:.2f} ms<extra></extra>" }));
  tr.push(line(C.f, C.dterm, "D path", css("--s7"), { type: "scatter", xaxis: "x5", yaxis: "y5", line: { width: 2 }, hovertemplate: "D path %{x:.0f} Hz: %{y:.2f} ms<extra></extra>" }));
  tr.push(line(C.f, C.gyro_typ, `typical ${D.inch}″ P path`, css("--accent"), { type: "scatter", xaxis: "x5", yaxis: "y5", line: { width: 1.2, dash: "dot" }, hovertemplate: "typical P path %{x:.0f} Hz: %{y:.2f} ms<extra></extra>" }));
  tr.push(line(C.f, C.dterm_typ, `typical ${D.inch}″ D path`, css("--s7"), { type: "scatter", xaxis: "x5", yaxis: "y5", line: { width: 1.2, dash: "dot" }, hovertemplate: "typical D path %{x:.0f} Hz: %{y:.2f} ms<extra></extra>" }));
  L.shapes.push({ type: "line", xref: "x5", yref: "y5 domain", x0: fc, x1: fc, y0: 0, y1: 1, line: { color: css("--ink2"), dash: "dot", width: 1 } });
  L.annotations.push({ text: `crossover ${fc.toFixed(0)} Hz`, xref: "x5", yref: "y5 domain", x: Math.log10(fc), y: 0.97, xanchor: "left", yanchor: "top", xshift: 3, showarrow: false, font: { size: 9, color: css("--ink2") } });
  L.xaxis5 = { ...L.xaxis5, type: "log", title: { text: "frequency (Hz) · dotted = typical", font: { size: 10 }, standoff: 2 } }; L.yaxis5.title = { text: "phase delay (ms)", font: { size: 10 }, standoff: 2 };
  L.yaxis5.range = [0, Math.max(...C.dterm.filter((v, i) => C.f[i] < 150)) * 1.3];
  title(5, "Phase delay by frequency", "How late each frequency arrives after the filters. Notches show as spikes near their centre; what matters for the loop is the value at the crossover line.");
  // direct labels on the sweep lines (≤ 4 series: label + legend-free, identity never colour-alone)
  // direct labels at the right end, nudged apart so they never overlap
  const ends = A.sweep.map(sw => ({ kind: sw.kind, y: sw.pm[sw.pm.length - 1] })).filter(e => e.y != null).sort((a, b) => b.y - a.y);
  const span = Math.max(...A.sweep.flatMap(sw => sw.pm.filter(v => v != null))) - Math.min(...A.sweep.flatMap(sw => sw.pm.filter(v => v != null))) || 1;
  ends.forEach((e, i) => { if (i && ends[i - 1].ly - e.y < span * 0.16) e.ly = ends[i - 1].ly - span * 0.16; else e.ly = e.y;
    L.annotations.push({ text: SW[e.kind][0], xref: "x2", yref: "y2", x: Math.log10(mu[mu.length - 1]), y: e.ly, xanchor: "right", yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--ink2") } }); });
  L.annotations.push({ text: "P path", xref: "x4", yref: "y4", x: T.t[T.t.length - 1], y: T.p[T.p.length - 1], xanchor: "right", yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--ink2") } });
  L.annotations.push({ text: "D path", xref: "x4", yref: "y4", x: T.t[T.t.length - 1], y: T.d[T.d.length - 1], xanchor: "right", yanchor: "bottom", showarrow: false, font: { size: 9, color: css("--ink2") } });
  $("main")._time = []; $("main")._freq = false;
  fitMain(760);
  await Plotly.react("main", tr, L, CFG);
}

function delayPanel(D, A, ai) {
  const m = A.margins, lv = pmLv(m.now.pm), fc = A.fc;
  const tile = (k, v, s, l, tip) => `<div class="dtile lv-${l || "info"}" ${tip ? `data-tip="${tip}"` : ""}><span>${k}</span><b>${v}</b><small>${s}</small></div>`;
  const H = A.headroom, hTxt = x => x.max_scale == null ? `never 45° (best ${x.best_pm == null ? "–" : x.best_pm.toFixed(0) + "°"})` : `up to ×${x.max_scale.toFixed(2)}`;
  const conf = A.status !== "ok" ? `<div class="warnline">⚠ This axis wasn't learned from this flight (${esc(A.status)}): treat its margins as rough.</div>` : "";
  const exc = A.excited_hz;
  const ck = D.check || {};
  const meth = `<details class="pdet"><summary class="hint">How this is worked out</summary><div class="hint dmeth">
    <p><b>Phase delay</b> of a filter at frequency f is −∠H(e<sup>jωT</sup>)/ω. Delays of filters in a row add up, and the phase a filter takes from the loop at f is exactly 360°·f·delay, so each bar segment is a slice of the phase budget.
    Every filter is computed with Betaflight's own equations at the rate it really runs (gyro LPF2 at ${D.fs_gyro} Hz; LPF1, notches, RPM filter and D-term filters at the ${D.fs_pid} Hz PID loop), dynamic low-passes at the hover throttle (${D.hover_thr}%).</p>
    <p><b>Crossover and margins</b> come from the open loop L = plant × PID: the plant learned from this log (control authority, motor spin-up lag, ESC delay, damping), the PID exactly as Betaflight runs it on the measurement
    (P and I on the filtered gyro, D on the gyro + D-term filters), plus 1.5 PID periods of computation. Phase margin = 180° + ∠L where |L| = 1. Same model as the PID simulator.</p>
    <p><b>Typical ${D.inch}″</b> = Betaflight defaults with the low-pass cutoffs scaled for the prop size, on <i>this</i> quad's plant, so the comparison isolates the filter choice.
    <b>Motor noise</b> = your filtered-gyro spectrum through the PID and the changed filters (above 80 Hz, as % of motor range).</p>
    <p><b>Dynamic notches</b>: ${esc(D.dyn.source)}${D.dyn.centres.length ? ` (${D.dyn.centres.join(", ")} Hz)` : ""}.</p></div></details>`;
  $("findings").innerHTML = `<div class="fh" data-tip="dly_pm">${AX[ai]} at a glance</div>
    <div class="dtiles">
      ${tile("Phase margin", m.now.pm == null ? "–" : m.now.pm.toFixed(0) + "°", `${pmWord(m.now.pm)} · target 45°`, lv, "dly_pm")}
      ${tile("Without filters", m.none.pm == null ? "–" : m.none.pm.toFixed(0) + "°", "same quad, no filtering", "info", "dly_none")}
      ${tile(`Typical ${D.inch}″ filters`, m.typical.pm == null ? "–" : m.typical.pm.toFixed(0) + "°", "same quad, size-typical filters", pmLv(m.typical.pm), "dly_typ")}
      ${tile("Crossover", fc.toFixed(1) + " Hz", "where the loop gain is 1", "info", "dly_fc")}
      ${tile("Filters take", A.phase_used.toFixed(0) + "°", `P ${A.p_ms.toFixed(2)} · D ${A.d_ms.toFixed(2)} ms`, A.phase_spare < 10 ? "warning" : (A.phase_used / A.phase_spare < 0.5 ? "good" : "warning"), "dly_cost")}
      ${tile("Disturbance peak", m.now.ms == null ? "–" : "×" + m.now.ms.toFixed(1), m.now.f_ms ? `around ${m.now.f_ms.toFixed(0)} Hz` : "", m.now.ms > 2.5 ? "warning" : m.now.ms > 1.8 ? "info" : "good", "dly_ms")}
    </div>
    <table class="cmp dhead" data-tip="dly_head"><tr><th>P &amp; D can scale…</th><th></th></tr>
      <tr><td>with your filters</td><td>${hTxt(H.now)}</td></tr><tr><td>with typical ${D.inch}″ filters</td><td>${hTxt(H.typical)}</td></tr><tr><td>without filters</td><td>${hTxt(H.none)}</td></tr></table>
    ${conf}
    <div class="hint">${exc ? `Your sticks excited this axis up to ${exc} Hz; at the ${fc.toFixed(0)} Hz crossover the model rests on the measured motor lag and ESC delay.` : ""}
      ${ck.pred_motor_pct ? ` Model check: predicted PID noise ${ck.pred_motor_pct.toFixed(2)}% vs logged ${ck.meas_motor_pct.toFixed(2)}%.` : ""}${ck.pw_freq ? ` Propwash rings at ${ck.pw_freq} Hz; the model's peak is at ${(m.now.f_ms || 0).toFixed(0)} Hz.` : ""}</div>
    ${findingsHTML(D.findings, `<div class="fh">Findings &amp; suggestions</div>`)}
    ${meth}`;
}
