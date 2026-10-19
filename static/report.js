// PDF report, made in the browser (jsPDF + DejaVu fonts, loaded on first use): profile, key numbers, top priorities and
// the flight at a glance; then one section per area (stick response & PID, noise & filters incl. filter delay, propwash &
// stability, motors & power, the learned dynamics), the tune plan with its CLI, before → after, and all findings.
const RPT = { fonts: null, lib: false };
const RC = { ink: "#14161b", ink2: "#4b5060", muted: "#8a8f9c", line: "#dfe2e8", soft: "#f4f6f9", accent: "#3987e5", amber: "#ffb340", dark: "#0c0e13",
  good: "#14a44d", info: "#2a78d6", warning: "#e09b00", serious: "#d03b3b", ax: ["#2a78d6", "#eb6834", "#1baf7a"] };
// which way is better, printed next to every metric: ↑ higher is better, ↓ lower is better (DejaVu Sans has both arrows)
const UP = "↑", DN = "↓";
const LVL = { good: "Good", info: "Info", warning: "Check", serious: "Fix" };
// long Betaflight names (BTFL_BLACKBOX_LOG_<craft>_<date>_<time>_<board>.BBL) shortened to fit a header: keep date and time
const shortName = n => { n = String(n || ""); if (n.length <= 34) return n; const m = n.match(/(\d{8})_(\d{6})/); return m ? `${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6)} ${m[2].slice(0, 2)}:${m[2].slice(2, 4)} · …${n.slice(-12)}` : n.slice(0, 18) + "…" + n.slice(-14); };

function loadScript(src) { return new Promise((res, rej) => { const s = document.createElement("script"); s.src = src; s.onload = res; s.onerror = rej; document.head.appendChild(s); }); }
async function b64(url) {
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer()); let s = "";
  for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode.apply(null, buf.subarray(i, i + 0x8000));
  return btoa(s);
}
async function dataURL(url) { const b = await (await fetch(url)).blob(); return new Promise(r => { const fr = new FileReader(); fr.onload = () => r(fr.result); fr.readAsDataURL(b); }); }

async function reportDoc() {
  if (!RPT.lib) { await loadScript("/static/vendor/jspdf.umd.min.js"); RPT.lib = true; }
  if (!RPT.fonts) RPT.fonts = await Promise.all(["DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSansMono.ttf"].map(f => b64(`/static/vendor/fonts/${f}`)));
  const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4", compress: true });
  [["DejaVuSans.ttf", "dv", "normal"], ["DejaVuSans-Bold.ttf", "dv", "bold"], ["DejaVuSansMono.ttf", "mono", "normal"]].forEach(([f, n, st], i) => {
    doc.addFileToVFS(f, RPT.fonts[i]); doc.addFont(f, n, st); });
  doc.setFont("dv", "normal");
  return doc;
}

// ---- tiny layout engine: a cursor that starts new pages as needed ----
function Layout(doc, meta) {
  const W = 210, H = 297, M = 14, CW = W - 2 * M;
  const L = { doc, W, H, M, CW, y: M, page: 1 };
  L.rgb = c => { const n = parseInt(c.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  L.color = (c, what = "text") => { const [r, g, b] = L.rgb(c); what === "text" ? doc.setTextColor(r, g, b) : what === "fill" ? doc.setFillColor(r, g, b) : doc.setDrawColor(r, g, b); };
  L.font = (size, bold = false, mono = false) => { doc.setFont(mono ? "mono" : "dv", bold && !mono ? "bold" : "normal"); doc.setFontSize(size); };
  L.header = () => {   // slim running header on pages after the first
    L.font(8); L.color(RC.muted); doc.text(`BBX Analyzer · ${meta.craft || meta.file}`, M, 9);
    doc.text(shortName(meta.file), W - M, 9, { align: "right" }); L.color(RC.line, "draw"); doc.setLineWidth(0.2); doc.line(M, 11, W - M, 11); L.y = 16;
  };
  L.newPage = () => { doc.addPage(); L.page++; L.header(); };
  L.need = h => { if (L.y + h > H - 16) L.newPage(); };
  L.h1 = (t, sub) => { L.need(16); L.font(15, true); L.color(RC.ink); doc.text(t, M, L.y + 5); if (sub) { L.font(8.5); L.color(RC.ink2); doc.text(sub, M, L.y + 10); }
    L.color(RC.accent, "fill"); doc.rect(M, L.y + (sub ? 12.5 : 7.5), 18, 0.9, "F"); L.y += sub ? 17 : 12; };
  L.section = (t, sub) => { if (L.y > H * 0.52) L.newPage(); else L.y += 4; L.h1(t, sub); };   // a new page only when less than half is left
  L.table = (head, rows, widths, { size = 8.2, zebra = true, colors = null } = {}) => {     // simple table; widths in fractions of CW
    const xs = widths.reduce((a, w, i) => (a.push(i ? a[i - 1] + widths[i - 1] * CW : M), a), []), rh = size * 0.62;
    L.font(size - 1.2, true); const hl = head.map((h, i) => doc.splitTextToSize(String(h).toUpperCase(), widths[i] * CW - 2.5)), nh = Math.max(...hl.map(x => x.length));
    L.need(rh * (nh + 1.5)); L.color(RC.muted); hl.forEach((h, i) => doc.text(h, xs[i] + 1.5, L.y + 3)); L.y += rh * 0.15 + nh * (size - 1.2) * 0.42;
    L.color(RC.line, "draw"); doc.setLineWidth(0.2); doc.line(M, L.y, M + CW, L.y); L.y += 0.8;
    rows.forEach((r, ri) => { L.need(rh); if (zebra && ri % 2 === 0) { L.color(RC.soft, "fill"); doc.rect(M, L.y - 0.4, CW, rh, "F"); }
      r.forEach((c, i) => { L.font(size, i === 0); L.color(colors && colors[ri] && colors[ri][i] || (i === 0 ? RC.ink : RC.ink2)); doc.text(String(c ?? "–"), xs[i] + 1.5, L.y + rh * 0.68); });
      L.y += rh; });
    L.y += 2.5; };
  L.h2 = t => { L.need(10); L.font(11, true); L.color(RC.ink); doc.text(t, M, L.y + 4); L.y += 7.5; };
  L.para = (t, { size = 9, color = RC.ink2, x = M, w = CW, bold = false, gap = 1.6, lh = 0.43 } = {}) => {
    if (!t) return; L.font(size, bold); L.color(color);
    const lines = doc.splitTextToSize(String(t), w); const h = lines.length * size * lh;
    L.need(h + gap); doc.text(lines, x, L.y + size * 0.36); L.y += h + gap; };
  L.pill = (x, y, text, col) => { L.font(7, true); const w = doc.getTextWidth(text) + 3.6; L.color(col, "fill"); doc.roundedRect(x, y - 3, w, 4.2, 1.2, 1.2, "F");
    doc.setTextColor(255, 255, 255); doc.text(text, x + 1.8, y); return w; };
  L.footer = () => { const n = doc.getNumberOfPages(); for (let i = 1; i <= n; i++) { doc.setPage(i); L.font(7.5); L.color(RC.muted);
    doc.text(`Generated by BBX Analyzer v${BBX_VERSION} · ${new Date().toISOString().slice(0, 10)} · suggestions are a starting point: change one thing at a time`, M, H - 7);
    doc.text(`${i} / ${n}`, W - M, H - 7, { align: "right" }); } };
  return L;
}

// ---- charts rendered off-screen with a print palette ----
async function chartPNG(traces, layout, w = 1600, h = 520) {
  const el = document.createElement("div"); el.style.cssText = `position:fixed;left:-10000px;top:0;width:${w / 2}px;height:${h / 2}px`; document.body.appendChild(el);
  const ax = { gridcolor: "#e6e8ee", zerolinecolor: "#c9ccd4", linecolor: "#c9ccd4", tickfont: { size: 10, color: "#4b5060" }, automargin: true };
  const L = { paper_bgcolor: "#ffffff", plot_bgcolor: "#ffffff", font: { family: "DejaVu Sans, Arial, sans-serif", size: 11, color: "#14161b" }, margin: { l: 44, r: 10, t: 26, b: 34 },
    showlegend: true, legend: { orientation: "h", x: 1, xanchor: "right", y: 1.16, font: { size: 10 } }, ...layout };
  Object.keys(L).filter(k => /^[xy]axis\d*$/.test(k)).forEach(k => { L[k] = { ...ax, ...L[k] }; });
  await Plotly.newPlot(el, traces, L, { staticPlot: true });
  const url = await Plotly.toImage(el, { format: "png", width: w / 2, height: h / 2, scale: 2 });
  Plotly.purge(el); el.remove();
  return url;
}
function grid3(title, ytitle) {   // three side-by-side panels
  const L = { annotations: [] }, gap = 0.05, w = (1 - 2 * gap) / 3;
  [0, 1, 2].forEach(i => { const s = i ? i + 1 : "", x0 = i * (w + gap);
    L[`xaxis${s}`] = { domain: [x0, x0 + w], anchor: `y${s}`, title: { text: title, font: { size: 10 } } };
    L[`yaxis${s}`] = { anchor: `x${s}`, title: i ? undefined : { text: ytitle, font: { size: 10 } } };
    L.annotations.push({ text: `<b>${AX[i]}</b>`, xref: "paper", yref: "paper", x: x0, y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11, color: RC.ax[i] } }); });
  return L;
}
async function stepChart(R) {
  const S_ = R.step; if (!S_) return null; const tr = [], L = grid3("ms after a stick move", "response");
  [0, 1, 2].forEach(i => { const a = S_.axes[i], s = i ? i + 1 : ""; if (!a || !a.median) return;
    tr.push({ type: "scatter", mode: "lines", x: S_.t_ms, y: S_.t_ms.map(() => 1), xaxis: `x${s}`, yaxis: `y${s}`, line: { color: "#9aa0ad", dash: "dot", width: 1 }, showlegend: false, hoverinfo: "skip" });
    tr.push({ type: "scatter", mode: "lines", x: S_.t_ms, y: a.median, xaxis: `x${s}`, yaxis: `y${s}`, line: { color: RC.ax[i], width: 2.6 }, showlegend: false }); });
  L.showlegend = false; return chartPNG(tr, L);
}
async function noiseChart(R) {
  const N = R.noise; if (!N) return null; const tr = [], L = grid3("frequency (Hz)", "dB"); const k0 = N.f.findIndex(v => v >= 10), f = N.f.slice(k0);
  [0, 1, 2].forEach(i => { const a = N.axes[String(i)], s = i ? i + 1 : ""; if (!a) return;
    tr.push({ type: "scatter", mode: "lines", x: f, y: a.raw.slice(k0), name: "gyro raw", xaxis: `x${s}`, yaxis: `y${s}`, line: { color: "#9aa0ad", width: 1.2 }, legendgroup: "r", showlegend: !i });
    tr.push({ type: "scatter", mode: "lines", x: f, y: a.filt.slice(k0), name: "filtered", xaxis: `x${s}`, yaxis: `y${s}`, line: { color: RC.ax[i], width: 2.2 }, legendgroup: "f" + i, showlegend: !i }); });
  return chartPNG(tr, L);
}
async function propwashChart(R) {
  const P = R.propwash; if (!P || !P.events || !P.events.length) return null;
  const C = { excellent: RC.good, good: "#5bbf6a", ok: RC.warning, bad: "#e8743b", terrible: RC.serious };
  const tr = Object.keys(C).map(c => { const e = P.events.filter(x => x.cls === c); return { type: "bar", x: e.map(x => x.t), y: e.map(x => x.ratio), name: c, marker: { color: C[c] }, width: 1.5 }; }).filter(t => t.x.length);
  return chartPNG(tr, { barmode: "overlay", xaxis: { title: { text: "flight time (s)", font: { size: 10 } } }, yaxis: { title: { text: "wobble × calm (↓ better)", font: { size: 10 } } },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: "#9aa0ad", dash: "dot", width: 1 } }] }, 1600, 380);
}
async function compareChart(C) {
  const O = C && C.overlay && C.overlay.step; if (!O) return null; const tr = [], L = grid3("ms after a stick move", "response");
  [0, 1, 2].forEach(i => { const s = i ? i + 1 : "";
    if (O.a[i]) tr.push({ type: "scatter", mode: "lines", x: O.t_ms, y: O.a[i], name: "before", xaxis: `x${s}`, yaxis: `y${s}`, line: { color: "#9aa0ad", dash: "dash", width: 2 }, legendgroup: "a", showlegend: !i });
    if (O.b[i]) tr.push({ type: "scatter", mode: "lines", x: O.t_ms_b, y: O.b[i], name: "after", xaxis: `x${s}`, yaxis: `y${s}`, line: { color: RC.ax[i], width: 2.6 }, legendgroup: "b" + i, showlegend: !i }); });
  return chartPNG(tr, L);
}
// the whole flight: throttle and motor command range on top, how hard it rotated below
async function timelineChart(R) {
  const T = R.timeline; if (!T) return null; const tr = [];
  if (T.mot_hi) {
    tr.push({ type: "scatter", mode: "lines", x: T.t, y: T.mot_lo, line: { width: 0 }, showlegend: false, hoverinfo: "skip", yaxis: "y2" });
    tr.push({ type: "scatter", mode: "lines", x: T.t, y: T.mot_hi, fill: "tonexty", fillcolor: "rgba(57,135,229,0.22)", line: { width: 0 }, name: "motor command range", yaxis: "y2" });
    tr.push({ type: "scatter", mode: "lines", x: T.t, y: T.mot, line: { color: RC.accent, width: 1.4 }, name: "motor command (mean)", yaxis: "y2" });
  }
  tr.push({ type: "scatter", mode: "lines", x: T.t, y: T.thr, line: { color: "#14161b", width: 1.3 }, name: "throttle", yaxis: "y2" });
  tr.push({ type: "scatter", mode: "lines", x: T.t, y: T.rate, line: { color: RC.amber, width: 1.1 }, fill: "tozeroy", fillcolor: "rgba(255,179,64,0.25)", name: "fastest rotation", yaxis: "y" });
  return chartPNG(tr, { yaxis: { domain: [0, 0.3], title: { text: "°/s", font: { size: 9 } } }, yaxis2: { domain: [0.38, 1], range: [0, 100], title: { text: "%", font: { size: 9 } } },
    xaxis: { title: { text: "flight time (s)", font: { size: 10 } } }, margin: { l: 44, r: 10, t: 22, b: 32 } }, 1600, 440);
}
async function stepChart(R) {
  const S_ = R.step; if (!S_) return null; const tr = [], L = grid3("ms after a stick move", "response");
  [0, 1, 2].forEach(i => { const a = S_.axes[i], s = i ? i + 1 : ""; if (!a || !a.median) return;
    tr.push({ type: "scatter", mode: "lines", x: S_.t_ms, y: S_.t_ms.map(() => 1), xaxis: `x${s}`, yaxis: `y${s}`, line: { color: "#9aa0ad", dash: "dot", width: 1 }, showlegend: false, hoverinfo: "skip" });
    tr.push({ type: "scatter", mode: "lines", x: S_.t_ms, y: a.median, xaxis: `x${s}`, yaxis: `y${s}`, line: { color: RC.ax[i], width: 2.6 }, showlegend: false }); });
  L.showlegend = false; return chartPNG(tr, L);
}
const rgbaHex = (h, a) => { const n = parseInt(h.slice(1), 16); return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`; };
// what each PID term puts out (RMS, motor-command units), per axis
async function pidChart(R) {
  const P = R.pidterms; if (!P) return null;
  const terms = [["P", "#2a78d6"], ["I", "#7a5af5"], ["D", "#eb6834"], ["FF", "#1baf7a"]], xs = AX.slice(0, 3);
  const tr = terms.map(([k, c]) => ({ type: "bar", orientation: "h", y: xs, x: [0, 1, 2].map(i => (P[i] && P[i].rms && P[i].rms[k]) || 0), name: k === "FF" ? "feedforward" : k, marker: { color: c },
    text: [0, 1, 2].map(i => { const v = P[i] && P[i].rms && P[i].rms[k]; return v >= 1.5 ? v.toFixed(1) : ""; }), textposition: "inside", insidetextanchor: "middle", textfont: { color: "#fff", size: 10 } }));
  return chartPNG(tr, { barmode: "stack", yaxis: { autorange: "reversed" }, xaxis: { title: { text: "RMS output (PID units, ÷10 = % motor) · ↓ less effort", font: { size: 10 } } }, margin: { l: 50, r: 10, t: 24, b: 34 } }, 1600, 300);
}
// noise by throttle: raw vs filtered gyro, one shared colour scale, the motors' own frequency as a line
async function spectroChart(R) {
  const SP = R.spectro; if (!SP || !SP.raw) return null; const tr = [];
  const fmax = Math.min(SP.raw.f[SP.raw.f.length - 1], 500), cs = [[0, "#ffffff"], [0.25, "#cfe0f7"], [0.5, "#6aa2e8"], [0.75, "#e0742e"], [1, "#8c1d18"]];
  [["raw", "x", "y"], ["filt", "x2", "y2"]].forEach(([k, xa, ya], j) => { const d = SP[k];
    tr.push({ type: "heatmap", x: d.f, y: d.y, z: d.z, zmin: SP.clim && SP.clim[0], zmax: SP.clim && SP.clim[1], colorscale: cs, showscale: j === 1, xaxis: xa, yaxis: ya,
      colorbar: { title: { text: "dB", font: { size: 9 } }, thickness: 8, len: 0.9, tickfont: { size: 8 } } });
    if (d.motor_hz) tr.push({ type: "scatter", mode: "lines", x: d.motor_hz, y: d.y, xaxis: xa, yaxis: ya, line: { color: "#14161b", width: 1, dash: "dot" }, showlegend: false }); });
  return chartPNG(tr, { showlegend: false, xaxis: { domain: [0, 0.46], range: [0, fmax], title: { text: "Hz · raw gyro", font: { size: 10 } } }, yaxis: { title: { text: "throttle %", font: { size: 10 } } },
    xaxis2: { domain: [0.52, 0.98], range: [0, fmax], anchor: "y2", title: { text: "Hz · after the filters", font: { size: 10 } } }, yaxis2: { anchor: "x2", matches: "y", showticklabels: false } }, 1600, 460);
}
// filter delay at the crossover: P and D path, yours (coloured by verdict) next to the reference (grey), roll and pitch
const SHORT_R = { gyro_lpf1: "G LPF1", gyro_lpf2: "G LPF2", gyro_notch: "notch", rpm: "RPM", dyn_notch: "dyn", dterm_lpf1: "D LPF1", dterm_lpf2: "D LPF2", dterm_notch: "D notch", yaw_lpf: "yaw" };
async function delayChart(R) {
  const D = R.delay; if (!D) return null; const tr = [], L = { barmode: "stack", showlegend: false, annotations: [], margin: { l: 70, r: 10, t: 26, b: 34 } };
  const VC = { good: RC.good, warning: RC.warning, serious: RC.serious, inactive: "#c4c8d0" }, axes = ["roll", "pitch"].filter(a => D.axes[a]);
  axes.forEach((a, j) => { const A = D.axes[a], s = j ? j + 1 : "", x0 = j * 0.52, cats = ["D · ref.", "D · yours", "P · ref.", "P · yours"];
    L[`xaxis${s}`] = { domain: [x0, x0 + 0.46], anchor: `y${s}`, title: { text: `ms at the ${A.fc.toFixed(0)} Hz crossover (↓ better)`, font: { size: 9 } }, rangemode: "tozero" };
    L[`yaxis${s}`] = { anchor: `x${s}`, categoryorder: "array", categoryarray: cats, showticklabels: true };
    L.annotations.push({ text: `<b>${a[0].toUpperCase() + a.slice(1)}</b>`, xref: "paper", yref: "paper", x: x0, y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11, color: RC.ax[a === "roll" ? 0 : 1] } });
    const add = (y, ms, col, lab, light) => tr.push({ type: "bar", orientation: "h", y: [y], x: [ms], xaxis: `x${s}`, yaxis: `y${s}`, marker: { color: col, line: { color: "#fff", width: 1.5 } },
      text: [ms >= 0.55 ? lab : ""], textposition: "inside", insidetextanchor: "middle", textfont: { size: 9, color: light ? "#14161b" : "#fff" } });
    const onP = r => r.chain === "gyro", onD = r => r.chain === "gyro" || r.chain === "dterm";
    A.rows.filter(onP).forEach(r => add("P · yours", r.ms, VC[r.verdict] || RC.info, SHORT_R[r.key] || r.key));
    A.rows.filter(onD).forEach(r => add("D · yours", r.ms, VC[r.verdict] || RC.info, SHORT_R[r.key] || r.key));
    const refs = ch => A.rows.filter(ch).map(r => [r.key, r.typ_ms]).concat((A.extra || []).filter(ch).map(e => [e.key, e.ms])).filter(x => x[1] > 0);
    refs(onP).forEach(([k, ms], i) => add("P · ref.", ms, ["#d9dce3", "#c8ccd5", "#b9bec9"][i % 3], SHORT_R[k] || k, true));
    refs(onD).forEach(([k, ms], i) => add("D · ref.", ms, ["#d9dce3", "#c8ccd5", "#b9bec9"][i % 3], SHORT_R[k] || k, true)); });
  return chartPNG(tr, L, 1600, 380);
}
async function propwashChart(R) {
  const P = R.propwash; if (!P || !P.events || !P.events.length) return null;
  const C = { excellent: RC.good, good: "#5bbf6a", ok: RC.warning, bad: "#e8743b", terrible: RC.serious };
  const tr = Object.keys(C).map(c => { const e = P.events.filter(x => x.cls === c); return { type: "bar", x: e.map(x => x.t), y: e.map(x => x.ratio), name: c, marker: { color: C[c] }, width: 1.5 }; }).filter(t => t.x.length);
  return chartPNG(tr, { barmode: "overlay", xaxis: { title: { text: "flight time (s)", font: { size: 10 } } }, yaxis: { title: { text: "wobble × calm (↓ better)", font: { size: 10 } } },
    shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: "#9aa0ad", dash: "dot", width: 1 } }] }, 1600, 340);
}
// motor balance: how far each motor's command and speed sit from the average
async function motorChart(R) {
  const M = R.motors; if (!M || !M.motors) return null; const lab = M.motors.map((m, i) => `${m} · ${M.pos[i]}`);
  const tr = [{ type: "bar", x: lab, y: M.cmd_offset, name: "command vs average (%)", marker: { color: RC.accent }, text: M.cmd_offset.map(v => (v > 0 ? "+" : "") + v.toFixed(1)), textposition: "outside", textfont: { size: 10 } }];
  if (M.rpm_dev) tr.push({ type: "bar", x: lab, y: M.rpm_dev, name: "speed vs average (%)", marker: { color: RC.amber }, text: M.rpm_dev.map(v => (v > 0 ? "+" : "") + v.toFixed(1)), textposition: "outside", textfont: { size: 10 } });
  const mx = Math.max(4, ...M.cmd_offset.map(Math.abs), ...(M.rpm_dev || []).map(Math.abs)) * 1.35;
  return chartPNG(tr, { barmode: "group", yaxis: { range: [-mx, mx], title: { text: "% from the average", font: { size: 10 } }, zeroline: true }, margin: { l: 50, r: 10, t: 30, b: 40 } }, 1600, 360);
}

// ---- the report ----
async function makeReport() {
  const btns = [...document.querySelectorAll("#planPdf, #cmpPdf, #sumPdf")]; btns.forEach(b => { b.disabled = true; b.dataset.t = b.textContent; b.textContent = "Making the PDF…"; });
  try {
    await busy(async () => {
      const R = await api("report", S.auw ? { auw: S.auw } : {});
      const doc = await reportDoc(), L = Layout(doc, R), { M, CW } = L;
      const logo = await dataURL("/static/brand/icon-192.png").catch(() => null);
      // ---------- page 1: header band, profile, key numbers, priorities
      L.color(RC.dark, "fill"); doc.rect(0, 0, 210, 36, "F");
      if (logo) doc.addImage(logo, "PNG", M, 8, 20, 20);
      L.font(20, true); doc.setTextColor(255, 255, 255); doc.text("bbx", M + 24, 17);
      const bw = doc.getTextWidth("bbx"); L.font(8.5, true); L.color(RC.amber); doc.text("ANALYZER", M + 24 + bw + 2, 17);
      L.font(9); doc.setTextColor(205, 210, 220); doc.text(`Flight report · v${BBX_VERSION} · logs turned into answers`, M + 24, 24);
      L.font(14, true); doc.setTextColor(255, 255, 255); doc.text(String(R.craft || R.file).slice(0, 28), 210 - M, 15, { align: "right" });
      L.font(7.8); doc.setTextColor(190, 196, 208); doc.text(`${shortName(R.file)}${R.idx > 1 ? ` · log ${R.idx}` : ""}`, 210 - M, 21, { align: "right" });
      doc.text(`${R.dur} s · ${R.rate} Hz · ${String(R.firmware || "").replace(/\s*\(.*$/, "")}`, 210 - M, 26, { align: "right" });
      L.y = 44;
      // profile tiles
      const u = R.profile.used, D = R.profile.derived || {}, E = R.profile.estimate || {};
      const tiles = [["Props", `${u.inch}″ × ${u.blades}`, u.source === "user" ? "set by you" : "estimated"], ["All-up weight", `${Math.round(u.auw_kg * 1000)} g ${DN}`, (u.auw_source === "user" ? "set by you" : "estimated") + " · lower is better"],
        ["Hover", E.hover_hz ? `${Math.round(E.hover_hz)} Hz` : "–", E.hover_cmd != null ? `${E.hover_cmd}% motor command` : ""], ["Hover power", D.hover_w ? `≈${D.hover_w} W ${DN}` : "–", "estimate · lower is better"],
        ["Thrust / weight", D.twr ? `${D.twr}× ${UP}` : "–", (D.twr_how === "extrapolated" ? "extrapolated" : "measured") + " · higher is better"]];
      const tw = (CW - 4 * 3) / 5;
      tiles.forEach(([k, v, s], i) => { const x = M + i * (tw + 3); L.color(RC.soft, "fill"); doc.roundedRect(x, L.y, tw, 19, 2, 2, "F");
        L.font(7, true); L.color(RC.muted); doc.text(k.toUpperCase(), x + 3, L.y + 5); L.font(12.5, true); L.color(RC.ink); doc.text(v, x + 3, L.y + 11.5); L.font(6.8); L.color(RC.ink2); doc.text(s, x + 3, L.y + 16); });
      L.y += 26;
      // key numbers
      L.h2("Key numbers"); L.font(7.6); L.color(RC.muted); doc.text("↑ higher is better · ↓ lower is better (shown next to every metric in this report)", M + CW, L.y - 3, { align: "right" });
      const sc = R.score, rows = [
        ["Noise left after the gyro filters", sc.gyro_hf, "°/s RMS", DN], ["D-term noise", sc.dterm_hf, "", DN], ["Noise reaching the motors", sc.motor_hf, "% RMS", DN],
        ["Filter delay: gyro / D-term", sc.delay_gyro != null ? `${sc.delay_gyro} / ${sc.delay_dterm}` : null, "ms", DN],
        ["Overshoot: roll / pitch / yaw", ["roll", "pitch", "yaw"].map(a => sc[`os_${a}`] ?? "–").join(" / "), "%", DN],
        ["Rise time: roll / pitch / yaw", ["roll", "pitch", "yaw"].map(a => sc[`rise_${a}`] ?? "–").join(" / "), "ms", DN],
        ["Propwash: median wobble after a chop", sc.pw_ratio, `× calm (${sc.pw_n || 0} chops, ${sc.pw_bad ?? 0}% bad)`, DN],
        ["Battery wasted holding attitude", sc.batt_waste, "%", DN]].filter(r => r[1] != null);
      const colW = [CW * 0.55, CW * 0.45];
      rows.forEach(([k, v, unit, dir], i) => { L.need(6); if (i % 2 === 0) { L.color(RC.soft, "fill"); doc.rect(M, L.y - 1, CW, 6, "F"); }
        L.font(8.8); L.color(RC.ink2); doc.text(k, M + 2, L.y + 3); L.font(8.8, true); L.color(RC.ink); doc.text(`${v}`, M + colW[0], L.y + 3);
        const vw = doc.getTextWidth(`${v}`); L.font(8); L.color(RC.muted); doc.text(unit, M + colW[0] + vw + 1.5, L.y + 3);
        L.font(9.5, true); L.color(dir === UP ? RC.good : RC.accent); doc.text(dir || "", M + CW - 4, L.y + 3, { align: "right" }); L.y += 6; });
      L.y += 3;
      // step verdicts
      if (R.step) { L.need(8); let x = M; L.font(8.5, true); L.color(RC.ink); doc.text("Tune verdict:", x, L.y + 3); x += 24;
        [0, 1, 2].forEach(i => { const v = R.step.axes[i] && R.step.axes[i].verdict; if (!v) return; const col = { Good: RC.good, OK: RC.warning, "Needs work": RC.serious }[v] || RC.info;
          L.font(8.5); L.color(RC.ax[i]); doc.text(AX[i], x, L.y + 3); x += doc.getTextWidth(AX[i]) + 2; x += L.pill(x, L.y + 3, v, col) + 6; }); L.y += 9; }
      // priorities
      const all = Object.entries(R.findings).flatMap(([k, l]) => (l || []).map(f => ({ ...f, sec: k })));
      const pri = all.filter(f => f.level === "serious" || f.level === "warning").sort((a, b) => (a.level === "serious" ? 0 : 1) - (b.level === "serious" ? 0 : 1)).slice(0, 7);
      L.h2("Top priorities");
      if (!pri.length) L.para("Nothing urgent: no warnings in any analysis.", { color: RC.good });
      pri.forEach(f => { L.need(12); const col = RC[f.level]; L.color(col, "fill"); doc.rect(M, L.y - 0.5, 1.2, 9, "F");
        L.para(f.title, { x: M + 4, w: CW - 4, size: 9.2, bold: true, color: RC.ink, gap: 0.6 }); L.para(f.tldr, { x: M + 4, w: CW - 4, size: 8.2, gap: 2.6 }); });
      // ---------- flight at a glance (bottom of page 1, or the next page)
      const img = (url, h, cap, note) => { if (!url) return; L.need(h + (cap ? 8 : 3)); if (cap) L.para(cap, { size: 9.5, bold: true, color: RC.ink, gap: 1 }); doc.addImage(url, "PNG", M, L.y, CW, h); L.y += h + (note ? 1.5 : 4); if (note) L.para(note, { size: 7.6, color: RC.muted, gap: 3 }); };
      const [ct, cs, cpid, cn, csp, cdl, cp, cm] = await Promise.all([timelineChart(R), stepChart(R), pidChart(R), noiseChart(R), spectroChart(R), delayChart(R), propwashChart(R), motorChart(R)]);
      L.y += 2; img(ct, CW * 0.275, "Flight at a glance", "Top: throttle (black), average motor command (blue) and the spread between the busiest and the idlest motor (band). Bottom: the fastest rotation on any axis.");
      const f1 = v => v == null ? "–" : (+v).toFixed(1), f0 = v => v == null ? "–" : Math.round(+v);
      // ---------- stick response and the PID
      L.section("Stick response & the PID", "How the quad follows your sticks, and what each PID term contributes");
      img(cs, CW * 0.325, "Step response", "Median reaction to your stick moves (1.0 = exactly what you asked).");
      if (R.step) { const m = i => (R.step.axes[i] || {}).metrics || {}, n = i => (R.step.axes[i] || {}).n;
        L.table(["", `rise ${DN}`, `overshoot ${DN}`, `settles ${DN}`, `latency ${DN}`, "moves", "verdict"], [0, 1, 2].map(i => [AX[i], `${f1(m(i).rise_ms)} ms`, `${f1(m(i).overshoot_pct)} %`, `${f0(m(i).settle_ms)} ms`, `${f1(m(i).latency_ms)} ms`, n(i) ?? "–", (R.step.axes[i] || {}).verdict || "–"]),
          [0.14, 0.14, 0.14, 0.14, 0.14, 0.12, 0.18], { colors: [0, 1, 2].map(i => [RC.ax[i]]) }); }
      img(cpid, CW * 0.165, "What each PID term puts out", "Size of each term's output over the flight. P and D fight disturbances, I holds trims, feedforward follows the sticks.");
      if (R.pidterms) L.table(["", `D noise > 100 Hz ${DN}`, `P noise > 100 Hz ${DN}`, `output at the limit ${DN}`], [0, 1, 2].map(i => { const a = R.pidterms[i] || {}; return [AX[i], f1(a.d_hf), f1(a.p_hf), a.sat_pct == null ? "–" : `${f1(a.sat_pct)} %`]; }),
        [0.2, 0.27, 0.27, 0.26], { colors: [0, 1, 2].map(i => [RC.ax[i]]) });
      // ---------- noise and filters
      L.section("Noise & filters", "Where the vibration is, what the filters leave, and what their delay costs the PID");
      img(cn, CW * 0.325, "Gyro noise", "Raw gyro (grey) and after the filters (colour). Peaks that survive the filters reach the D term and the motors.");
      img(csp, CW * 0.29, "Noise by throttle (roll + pitch)", "Each row is a throttle band; the dotted line is the motors' own frequency. Lines that follow it are motor noise (the RPM filter's job); fixed vertical lines are frame resonances.");
      if (R.delay) { const Dl = R.delay;
        img(cdl, CW * 0.2375, `Filter delay at the crossover · yours vs ${Dl.ref_label.toLowerCase()}`, "Each segment is one filter's delay where stability is decided. Green: like the reference or lighter; amber: up to 1.5× heavier; red: more than 1.5×. P path = what P and I see; D path adds the D-term filters.");
        L.table(["", "crossover", `phase margin ${UP}`, `model range ${UP}`, `reference filters ${UP}`, `no filters ${UP}`, `filters take ${DN}`], Object.entries(Dl.axes).map(([a, A]) => [a[0].toUpperCase() + a.slice(1), `${f1(A.fc)} Hz`, `${f0(A.margins.now.pm)}°`,
          A.pm_range ? `${f0(A.pm_range[0])}–${f0(A.pm_range[1])}°` : "–", `${f0(A.margins.typical.pm)}°`, `${f0(A.margins.none.pm)}°`, `${f0(A.phase_used)}°`]),
          [0.12, 0.13, 0.15, 0.15, 0.17, 0.13, 0.15], { colors: Object.values(Dl.axes).map(A => [null, null, RC[A.margins.now.pm >= 45 ? "good" : A.margins.now.pm >= 30 ? "warning" : "serious"]]) });
        L.para("Phase margin: how far the loop is from oscillating at the crossover (≥ 45° healthy, 30–45° rings a little, below 30° rings clearly). The model range is the margin over equally good fits with the motor lag at ±15% of its eRPM measurement.", { size: 7.6, color: RC.muted, gap: 3 }); }
      // ---------- propwash and stability
      L.section("Propwash & stability", "The wobble after throttle chops, and whether anything oscillates on its own");
      img(cp, CW * 0.21, "Propwash: wobble after each throttle chop", `× the calm level; dotted = calm.${R.propwash && R.propwash.pw_freq ? ` The wobble rings at about ${R.propwash.pw_freq} Hz.` : ""}`);
      if (R.propwash && R.propwash.axes) L.table(["", `tracking lag ${DN}`, `error while moving ${DN}`, `error when calm ${DN}`], [0, 1, 2].map(i => { const a = R.propwash.axes[i] || {}; return [AX[i], `${f1(a.lag_ms)} ms`, `${f1(a.err_move)} °/s`, `${f1(a.err_calm)} °/s`]; }),
        [0.2, 0.26, 0.27, 0.27], { colors: [0, 1, 2].map(i => [RC.ax[i]]) });
      const calm = R.delay && R.delay.check && R.delay.check.calm;
      if (calm) L.table(["", "strongest 10–40 Hz wobble, sticks centred", `size ${DN}`, `stands out by ${DN}`, ""], Object.entries(calm).map(([a, o]) => [a[0].toUpperCase() + a.slice(1), `${o.f} Hz`, `${o.rms} °/s`, `${o.prom_db} dB`,
        o.prom_db >= 12 ? "self-sustained oscillation" : "none"]), [0.14, 0.32, 0.14, 0.16, 0.24], { colors: Object.values(calm).map(o => [null, null, null, null, o.prom_db >= 12 ? RC.serious : RC.good]) });
      // ---------- motors and power
      if (cm || R.power) { L.section("Motors & power", "Balance between the motors and where the battery goes");
        img(cm, CW * 0.2, "Motor balance", "A motor that needs more command than the others, or spins faster, points to a heavier corner, a bent prop or a tired motor (positions as Betaflight numbers them).");
        if (R.power) { const pp = R.power.parts || {}, T = R.power;
          L.table([`hover command ${DN}`, `thrust / weight ${UP}`, `extra power: steady imbalance ${DN}`, `manoeuvres ${DN}`, `corrections ${DN}`, `vibration ${DN}`], [[T.hover_cmd != null ? `${f1(T.hover_cmd)} %` : "–", T.tw ? `${f1(T.tw)}×` : "–",
            `${f1(pp.steady)} %`, `${f1(pp.manoeuvre)} %`, `${f1(pp.correction)} %`, `${f1(pp.vibration)} %`]], [0.14, 0.14, 0.24, 0.16, 0.16, 0.16], { zebra: false }); } }
      // ---------- the learned model
      if (R.model && R.model.axes) { const Mo = R.model, md = Mo.motor, ty = (Mo.typical && Mo.typical.axes) || {};
        L.section("This quad's dynamics", "Learned from the flight: what the PID simulator and the filter-delay analysis run on");
        L.table(["", `authority ${UP}`, "typical for the size", `motor lag ${DN}`, `system delay ${DN}`, "damping", `fit ${UP}`, `sticks excited up to ${UP}`], Object.entries(Mo.axes).map(([a, r]) => [a[0].toUpperCase() + a.slice(1), f0(r.b),
          ty[a] ? f0(ty[a].b_typ) : "–", `${f0(r.tau_ms)} ms`, `${f1(r.delay_ms)} ms`, f1(r.a), r.fit_pct == null ? "–" : `${f0(r.fit_pct)} %`, r.excited_hz ? `${f0(r.excited_hz)} Hz` : "–"]),
          [0.1, 0.12, 0.16, 0.12, 0.13, 0.1, 0.09, 0.18]);
        if (md) L.para(`Motor lag measured from motor command vs eRPM: ${md.tau_ms} ms at ${f0(md.hz)} Hz (${f0(md.hz * 60)} RPM)${md.law && md.law.length > 1 ? `, ${md.law.map(l => `${f0(l[1])} ms at ${f0(l[0])} Hz`).join(", ")}` : ""}. Each axis may refine it by at most ±${Math.round((md.room || 0.15) * 100)}%: stick inputs alone can't tell motor lag from authority.`, { size: 7.8, gap: 3 }); }
      // ---------- tune plan
      const P = R.plan, items = typeof planItems === "function" ? planItems(P) : P.items, cli = typeof planCli === "function" ? planCli(P, items) : [];
      L.section("Tune plan", "In the order to change things. Ticked items are in the CLI block at the end.");
      P.notes.forEach(n => L.para("⚠ " + n, { color: RC.warning, size: 8.5 }));
      P.steps.forEach((s, si) => { const its = items.filter(it => it.step === s.id); if (!its.length) return;
        L.need(16); L.color(RC.accent, "fill"); doc.circle(M + 3, L.y + 2.6, 3, "F"); L.font(8.5, true); doc.setTextColor(255, 255, 255); doc.text(String(si + 1), M + 3, L.y + 3.7, { align: "center" });
        L.font(11, true); L.color(RC.ink); doc.text(s.title, M + 8, L.y + 4); L.y += 6.5; L.para(s.why, { x: M + 8, w: CW - 8, size: 8, color: RC.muted, gap: 2 });
        its.forEach(it => { L.need(10); const has = it.cli && it.cli.length; const mark = has ? (it.on ? "☑" : "☐") : "•";
          L.font(9.5); L.color(has ? (it.on ? RC.accent : RC.muted) : RC[it.level] || RC.info); doc.text(mark, M + 8, L.y + 3.4);
          L.para(it.text, { x: M + 13, w: CW - 13, size: 9, bold: true, color: has && !it.on ? RC.muted : RC.ink, gap: 0.6 });
          if (it.why) L.para(it.why, { x: M + 13, w: CW - 13, size: 7.8, gap: 0.8 });
          if (it.note) L.para(it.note, { x: M + 13, w: CW - 13, size: 7.6, color: RC.warning, gap: 0.8 });
          if (has) L.para(it.cli.map(([k, v]) => `${k} = ${v}`).join("   "), { x: M + 13, w: CW - 13, size: 7.6, color: RC.accent, gap: 2 }); else L.y += 1.2; });
        L.y += 2; });
      if (cli.length > 1) { L.h2("CLI for the ticked items");
        L.font(8, false, true); const lines = cli; const h = lines.length * 3.6 + 6; L.need(Math.min(h, 120));
        let i = 0; while (i < lines.length) { const room = Math.max(4, Math.floor((L.H - 18 - L.y - 6) / 3.6)); const part = lines.slice(i, i + room); const ph = part.length * 3.6 + 5;
          L.color("#f1f3f7", "fill"); doc.roundedRect(M, L.y, CW, ph, 2, 2, "F"); L.font(8, false, true); L.color(RC.ink); doc.text(part, M + 3, L.y + 4.5); L.y += ph + 3; i += room; if (i < lines.length) L.newPage(); } }
      L.h2("Next test flight"); P.checklist.forEach((c, i) => L.para(`${i + 1}.  ${c}`, { size: 8.6, gap: 1.2 }));
      // ---------- before → after
      if (S.cmp && CMP.d) { const C = CMP.d; L.newPage(); L.h1("Before → after", `before ${C.a.name}${C.a.idx > 1 ? " · log " + C.a.idx : ""}  →  after ${C.b.name}${C.b.idx > 1 ? " · log " + C.b.idx : ""}`);
        L.para(C.headline, { size: 13, bold: true, color: C.n_better > C.n_worse * 2 ? RC.good : C.n_worse > C.n_better * 2 ? RC.serious : RC.warning, gap: 1 });
        L.para(`${C.n_better} measures better · ${C.n_worse} worse · the rest about the same.`, { size: 8.5, gap: 3 });
        const cc = await compareChart(C); img(cc, CW * 0.325, "Step response: before (dashed) and after");
        if (C.changed.length) { L.h2("What changed in the settings"); C.changed.forEach(x => L.para(`${x.key}:  ${x.a}  →  ${x.b}`, { size: 8.4, gap: 0.8 })); L.y += 2; }
        L.h2("What changed in the flight");
        const V = { better: RC.good, worse: RC.serious, same: RC.muted, changed: RC.info };
        C.rows.forEach((r, i) => { L.need(6); if (i % 2 === 0) { L.color(RC.soft, "fill"); doc.rect(M, L.y - 1, CW, 5.6, "F"); }
          const f = v => v == null ? "–" : Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(2);
          L.font(8.3); L.color(RC.ink2); doc.text(r.label + (r.dir > 0 ? " ↑" : r.dir < 0 ? " ↓" : ""), M + 2, L.y + 3); L.color(RC.ink); doc.text(`${f(r.a)}  →  ${f(r.b)} ${r.unit}`, M + CW * 0.55, L.y + 3);
          if (r.verdict) L.pill(M + CW - 18, L.y + 3.2, r.verdict, V[r.verdict] || RC.info); L.y += 5.6; });
        L.y += 3; L.h2("Ideas for the next step"); C.ideas.forEach(x => { L.para(x.title, { size: 9, bold: true, color: RC.ink, gap: 0.5 }); L.para(x.text, { size: 8.2, gap: 2.2 }); }); }
      // ---------- all findings
      L.newPage(); L.h1("All findings", "Grouped by analysis; the app has the charts and the full explanations.");
      const SEC = { step: "Stick response", pid: "PID terms", noise: "Noise & filters", delay: "Filter delay & stability", propwash: "Propwash", health: "Motors & power" };
      Object.entries(SEC).forEach(([k, name]) => { const l = R.findings[k]; if (!l || !l.length) return; L.h2(name);
        l.forEach(f => { L.need(10); const x0 = M; const w = L.pill(x0, L.y + 3, LVL[f.level] || f.level, RC[f.level] || RC.info);
          L.font(8.8, true); L.color(RC.ink); const t = doc.splitTextToSize(f.title, CW - w - 3); doc.text(t, x0 + w + 2, L.y + 3); L.y += t.length * 3.8 + 0.6;
          if (f.tldr) L.para(f.tldr, { size: 7.9, gap: 0.6 }); if (f.action) L.para("Try: " + f.action, { size: 7.9, color: RC.ink, gap: 2.4 }); else L.y += 1.6; }); });
      L.footer();
      const name = `BBX report - ${(R.craft || R.file).replace(/[^\w.-]+/g, "_")} - ${new Date().toISOString().slice(0, 10)}.pdf`;
      doc.save(name);
    }, "Making the PDF report");
  } catch (e) { console.error(e); alert("Could not make the PDF: " + (e && e.message || e)); }
  finally { btns.forEach(b => { b.disabled = false; b.textContent = b.dataset.t || b.textContent; }); }
}
