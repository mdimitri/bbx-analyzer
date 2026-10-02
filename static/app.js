// BBX frontend — vanilla JS + Plotly. State → fetch → render.
const $ = id => document.getElementById(id);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const AX = ["Roll", "Pitch", "Yaw"], AXV = ["--roll", "--pitch", "--yaw"];
const axc = i => css(AXV[i]);
const rgba = (hex, a) => { const n = parseInt(hex.slice(1), 16); return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`; };
const store = { get(k, d) { try { const v = localStorage.getItem("bbx." + k); return v == null ? d : JSON.parse(v); } catch { return d; } },
                set(k, v) { try { localStorage.setItem("bbx." + k, JSON.stringify(v)); } catch {} } };
const S = { file: null, sub: 1, meta: null, range: null, tab: "summary", nnper: store.get("nnper", 512), prop: null, profile: null, tabLevel: {}, _flist: [], src: "gyroUnfilt", mode: "throttle",
  cmap: store.get("cmap", "BBX"), clim: null, motorLines: true,
  filt: new Set(store.get("filt", ["gyro_lpf1", "gyro_lpf2", "rpm", "dyn_notch", "gyro_total", "dterm_lpf1", "dterm_lpf2", "dterm_total", "bands"])),
  viewerOn: store.get("viewerOn", true), healthLive: true,
  focusAx: null, ovMode: store.get("ovMode", "nav"),
  nper: store.get("nper", 256), fr: null, gamma: store.get("gamma", 1),
  res: { on: true, prom: 6, persist: 40, mask: 4, fmax: 500, ...store.get("res2", {}) }, nfr: null, _spec: {}, _res: {},
  step: { axes: [true, true, true], min_sp: 20, max_sp: 2000, thr_min: 0, thr_max: 100, win_s: 2, curves: false } };
const LV = { good: "✓ GOOD", info: "ℹ INFO", warning: "⚠ WARNING", serious: "✖ SERIOUS" };
const esc = v => String(v ?? "").replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const findingsHTML = (list, head = "") => { if (list && list.length) S._flist.push(...list); return _fHTML(list, head); };
const _fHTML = (list, head = "") => (list && list.length) ? head + list.map(f => `<details class="fnd lv-${f.level}"${f.level === "warning" || f.level === "serious" ? " open" : ""}>
  <summary><span class="lvl">${LV[f.level]}</span><span class="ti">${esc(f.title)}</span><span class="tl">${esc(f.tldr)}</span></summary>
  <div class="more">${f.detail ? `<div>${esc(f.detail)}</div>` : ""}${f.action ? `<div><b>Try:</b> ${esc(f.action)}</div>` : ""}${f.cost ? `<div><b>Cost:</b> ${esc(f.cost)}</div>` : ""}</div></details>`).join("") : "";

const api = (path, q = {}) => {
  if (S.prop) q = { prop: S.prop.inch, blades: S.prop.blades, ...q };  // the prop size the user confirmed drives every analysis
  if (S.auw && /^(profile|simmodel)/.test(path)) q = { auw: S.auw, ...q };   // the weight they set (only these two use it server-side)
  const p = new URLSearchParams(Object.entries(q).filter(([, v]) => v != null));
  const url = `/api/${encodeURIComponent(S.file)}/${S.sub}/${path}?${p}`;
  // heavy analyses are pure functions of the URL: keep the last few, so toggling a chart option or switching tabs doesn't recompute
  const cacheable = !/^(series|playback|meta|logs)/.test(path);
  if (cacheable && API_CACHE.has(url)) { const v = API_CACHE.get(url); API_CACHE.delete(url); API_CACHE.set(url, v); return v; }
  const pr = fetch(url).then(r => { if (!r.ok) throw r; return r.json(); });
  if (cacheable) { API_CACHE.set(url, pr); pr.catch(() => API_CACHE.delete(url)); while (API_CACHE.size > 60) API_CACHE.delete(API_CACHE.keys().next().value); }
  return pr;
};
const API_CACHE = new Map();
// ---- busy indicator: what is running, live progress from the server (/api/progress) when it knows it, elapsed time ----
const BUSY = { jobs: [], timer: 0, t0: 0 };
const SRV_TASK = { decode: "Decoding the log", sim: "Learning this quad's dynamics" };
const busy = async (fn, label = "Working") => {
  const job = { label, t0: performance.now() }; BUSY.jobs.push(job);
  if (!BUSY.timer) { BUSY.t0 = performance.now(); $("busy").hidden = false; busyTick(); BUSY.timer = setInterval(busyTick, 350); }
  try { return await fn(); } finally {
    BUSY.jobs.splice(BUSY.jobs.indexOf(job), 1);
    if (!BUSY.jobs.length) { clearInterval(BUSY.timer); BUSY.timer = 0; $("busy").hidden = true; }
  }
};
async function busyTick() {
  const job = BUSY.jobs[BUSY.jobs.length - 1]; if (!job) return;
  let title = job.label, detail = BUSY.jobs.length > 1 ? `${BUSY.jobs.length} tasks running` : "", frac = null;
  if (S.file) {
    try {
      const pr = await fetch(`/api/progress?name=${encodeURIComponent(S.file)}&idx=${S.sub}`).then(r => r.json());
      const k = ["decode", "sim"].find(k => pr[k]);
      if (k) { title = SRV_TASK[k]; detail = pr[k].detail; frac = pr[k].frac; }
    } catch (e) {}
  }
  if (!BUSY.jobs.length) return;
  const el = Math.round((performance.now() - job.t0) / 1000);
  $("busyT").textContent = title + "…";
  $("busyD").textContent = [detail, el >= 2 ? `${el} s` : ""].filter(Boolean).join(" · ");
  $("busyBar").classList.toggle("ind", frac == null);
  $("busyBar").style.width = frac == null ? "" : Math.round(frac * 100) + "%";
  $("busyP").textContent = frac == null ? "" : Math.round(frac * 100) + "%";
}
const rng = () => S.range ? { t0: S.range[0], t1: S.range[1] } : {};

// ---------- Plotly theming ----------
function base(extra = {}) {
  const ax = { gridcolor: css("--grid"), zerolinecolor: css("--axis"), linecolor: css("--axis"), tickfont: { size: 10 }, automargin: true, title: { standoff: 4 } };
  return Object.assign({
    paper_bgcolor: css("--surface"), plot_bgcolor: css("--surface"),
    font: { family: "system-ui, -apple-system, Segoe UI, sans-serif", color: css("--ink2"), size: 12 },
    margin: { l: 46, r: 8, t: 34, b: 30 }, hovermode: "x unified", showlegend: true,
    legend: { orientation: "h", x: 0, xanchor: "left", y: 1, yanchor: "top", yref: "container", font: { size: 12 } },   // left: the chart toolbar shows top-right on hover
    hoverlabel: { bgcolor: css("--surface"), bordercolor: css("--border"), font: { color: css("--ink") }, namelength: -1 },
    xaxis: { ...ax }, yaxis: { ...ax },
  }, extra, { _ax: ax });
}
// n vertically stacked rows sharing one x axis
function stack(n, titles, extra = {}) {
  const L = base(extra), gap = 0.035, h = (1 - gap * (n - 1)) / n;
  L.annotations = [];
  for (let i = 0; i < n; i++) {
    const k = i ? `yaxis${i + 1}` : "yaxis", top = 1 - i * (h + gap);
    L[k] = { ...L._ax, domain: [top - h, top] };
    L.annotations.push({ text: titles[i], xref: "paper", yref: "paper", x: 0, y: top, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12, color: css("--ink") } });
  }
  L.xaxis.title = { text: "time (s)", font: { size: 11 } }; L.xaxis.anchor = `y${n > 1 ? n : ""}`;
  delete L._ax; return L;
}
// n side-by-side columns
function cols(n, titles, xtitle, extra = {}) {
  const L = base({ hovermode: "closest", ...extra }), gap = 0.03, w = (1 - gap * (n - 1)) / n;
  L.annotations = [];
  for (let i = 0; i < n; i++) {
    const s = i ? i + 1 : "", x0 = i * (w + gap);
    L[`xaxis${s}`] = { ...L._ax, domain: [x0, x0 + w], anchor: `y${s}`, title: { text: xtitle, font: { size: 11 } } };
    L[`yaxis${s}`] = { ...L._ax, anchor: `x${s}` };
    L.annotations.push({ text: titles[i], xref: "paper", yref: "paper", x: x0, y: 1, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12, color: css("--ink") }, captureevents: true, name: "title" });
  }
  delete L._ax; return L;
}
// size the main chart to fill the space between its top and the bottom dock (min = readable floor per tab)
function fitMain(min) {
  const top = $("main").getBoundingClientRect().top + scrollY, dock = $("dock").offsetHeight;
  $("main").style.height = Math.round(Math.max(min, innerHeight - dock - top - 10)) + "px";
}
const CFG = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
const line = (x, y, name, color, { line: l = {}, ...o } = {}) => ({ type: "scattergl", mode: "lines", x, y, name, line: { color, width: 1.5, ...l }, hoverlabel: { namelength: -1 }, ...o });

// ---------- time-series tabs (zoom → refetch at full resolution) ----------
const TS = {
  tracking: {
    titles: AX, fields: [0, 1, 2].flatMap(i => [`setpoint[${i}]`, `gyroADC[${i}]`]),
    traces: d => [0, 1, 2].flatMap(i => [
      line(d.t, d[`gyroADC[${i}]`], `gyro ${AX[i].toLowerCase()}`, axc(i), { yaxis: `y${i + 1}` }),
      line(d.t, d[`setpoint[${i}]`], "setpoint", css("--ink"), { yaxis: `y${i + 1}`, line: { dash: "dot", width: 1.2 }, legendgroup: "sp", showlegend: !i })]),
    hint: "°/s · dotted = what you asked for (setpoint) · colour = what the quad did (gyro)",
  },
  pid: {
    titles: AX, fields: [0, 1, 2].flatMap(i => ["P", "I", "D", "F"].map(t => `axis${t}[${i}]`)),
    traces: d => [0, 1, 2].flatMap(i => ["D", "P", "I", "F"].map(t => [t, "PIDF".indexOf(t)]).map(([t, j]) => d[`axis${t}[${i}]`] &&
      line(d.t, d[`axis${t}[${i}]`], t, css(["--roll", "--pitch", "--yaw", "--s4"][j]), { yaxis: `y${i + 1}`, legendgroup: t, showlegend: !i })).filter(Boolean)),
    hint: "how hard P, I, D and feedforward each push, per axis", an: "pidterms",
  },
  motors: {
    titles: ["Motor output (%)", "Motor speed (Hz, from bidir DShot eRPM)"],
    fields: ["throttle%", ...[0, 1, 2, 3].flatMap(i => [`motor%[${i}]`, `motorHz[${i}]`])],
    traces: d => [
      line(d.t, d["throttle%"], "throttle", css("--muted"), { line: { dash: "dot" } }),
      ...[0, 1, 2, 3].flatMap(i => [
        line(d.t, d[`motor%[${i}]`], `M${i + 1}`, css(["--roll", "--pitch", "--yaw", "--s4"][i]), { legendgroup: `m${i}` }),
        d[`motorHz[${i}]`] && line(d.t, d[`motorHz[${i}]`], `M${i + 1}`, css(["--roll", "--pitch", "--yaw", "--s4"][i]), { yaxis: "y2", legendgroup: `m${i}`, showlegend: false })]).filter(Boolean)],
    hint: "flat tops at 100% = motor maxed out", an: "motorout",
  },
};

async function renderTS(win) {
  if (S.tab === "pid" && S.pidv === "behaviour") return renderPidBehaviour();
  const tab0 = S.tab, T = TS[S.tab], D = S.meta.stats.duration_s, r = win || S.view || S.range || [0, D], w = r[1] - r[0];
  // fetch half a window of margin on each side so panning never shows empty edges before the refetch
  const f0 = Math.max(0, r[0] - w), f1 = Math.min(D, r[1] + w);   // one window of margin each side: panning / playback never shows empty edges
  const d = await api("series", { fields: T.fields.join(","), t0: f0, t1: f1, n: 6000 });
  if (S.tab !== tab0) return;
  S._fetched = [f0, f1];
  const L = stack(T.titles.length, T.titles, { dragmode: "pan" });
  L.legend = { ...L.legend, x: 0.5, xanchor: "center" };   // right corner is kept for the per-plot verdict labels
  L.xaxis.range = r; L.xaxis.uirevision = ++TSY.rev; L.uirevision = S.file + S.tab;
  for (let k = 1; k <= T.titles.length; k++) L[k > 1 ? `yaxis${k}` : "yaxis"].fixedrange = true;
  setTimeAxes([{ axis: "xaxis", dim: "x", pair: null }]);
  $("controls").innerHTML = tbar(`<h3>${$("tabs").querySelector(".on").textContent}</h3>${S.tab === "pid" ? pidvSeg() : ""}<span class="hint" data-tip="time_nav">${T.hint} · drag = move · click the chart, then wheel = zoom · all time charts follow · double-click = whole log</span>
    ${S.tab === "tracking" ? `<span class="tspacer"></span><span class="chips" id="vtoggle">${chip("v", "3D viewer", S.viewerOn, { tip: "viewer3d" })}</span>` : ""}`, []);
  bindPidv();
  if ($("vtoggle")) $("vtoggle").onclick = () => { S.viewerOn = !S.viewerOn; store.set("viewerOn", S.viewerOn); setupPlayer(); render(); };
  if (typeof PB !== "undefined" && PB.d) L.shapes = phShapes($("main"), PB.t);
  const A = T.an ? await tsAnalysis(T.an) : null;
  if (S.tab !== tab0) return;
  if (A && !A.error) tsAnnotate(A, L);
  else $("findings").innerHTML = A && A.error ? `<div class="hint">${esc(A.error)}</div>` : "";
  const split = document.querySelector(".maincard").classList.contains("split");
  fitMain(split ? 460 : S.tab === "tracking" && S.viewerOn ? 360 : 400);
  if (split && $("v3d")) { const hMain = parseFloat($("main").style.height), vp = document.querySelector(".vpanel");
    $("v3d").style.height = Math.max(240, hMain - (vp ? vp.offsetHeight : 0) - 12) + "px"; PB.dirty = true; }
  await Plotly.react("main", T.traces(d), L, CFG);
}

// ---------- interpretation layer on the PID terms / Motors tabs: event shading, per-plot labels, findings panel ----------
async function tsAnalysis(kind) {
  const key = [S.file, S.sub, S.range, kind, S.prop && S.prop.inch].join("|");
  S._an = S._an || {};
  if (!S._an[key]) S._an[key] = api(kind, rng()).catch(e => ({ error: "analysis failed" }));
  const A = await S._an[key];
  if (S._anShown !== key + S.tab) { S._anShown = key + S.tab; $("findings").innerHTML = findingsHTML(A.findings || [], `<div class="fh">What this shows</div>`); }
  return A;
}
const LVC = l => css({ good: "--good", info: "--info", warning: "--warning", serious: "--serious" }[l] || "--muted");
const worstOf = arr => arr.reduce((w, l) => LVORD[l] < LVORD[w] ? l : w, "good");
function tsAnnotate(A, L) {
  const EVC = { sat: ["--serious", "motor at 100%"], floor: ["--warning", "motor at minimum"], pidsat: ["--serious", "PID sum at limit"], windup: ["--warning", "I-term wind-up"] };
  const shapes = [], seen = new Set();
  for (const e of A.events || []) {
    const [cv] = EVC[e.kind] || ["--info"]; seen.add(e.kind);
    const yr = e.axis != null ? `y${e.axis ? e.axis + 1 : ""} domain` : "paper";
    shapes.push({ type: "rect", xref: "x", yref: yr, x0: e.t0 - 0.02, x1: e.t1 + 0.02, y0: 0, y1: 1, fillcolor: rgba(css(cv), 0.22), line: { width: 0 }, layer: "below" });
  }
  L.shapes = [...shapes, ...(L.shapes || [])];
  const tag = (i, text, lv, y = 1) => ({ text, xref: "paper", yref: `y${i ? i + 1 : ""} domain`, x: 1, y, xanchor: "right", yanchor: y >= 1 ? "bottom" : "top", showarrow: false,
    font: { size: 11, color: css("--ink") }, bgcolor: rgba(LVC(lv), 0.16), bordercolor: LVC(lv), borderwidth: 1, borderpad: 3 });
  if (S.tab === "pid") {
    [0, 1, 2].forEach(i => { const a = A.axes[String(i)]; if (!a) return;
      const fl = a.flags.map(([n, l]) => `${l === "good" ? "✓" : l === "info" ? "ℹ" : "⚠"} ${n}`), lv = worstOf(a.flags.map(f => f[1]));
      const r = a.rms, extra = Math.abs(a.i_bias) > 5 ? ` · I holds ${a.i_bias > 0 ? "+" : ""}${a.i_bias}` : "";
      L.annotations.push(tag(i, `RMS  P ${r.P} · I ${r.I} · D ${r.D} · FF ${r.FF}${extra}${a.d_hf != null ? ` · D ${Math.round(a.d_hf * 100)}% noise` : ""}${fl.length ? "  |  " + fl.join("  ") : ""}`, lv)); });
  } else if (S.tab === "motors") {
    const lv = A.sat_pct > 1.5 || A.floor_pct > 3 ? "warning" : A.sat_pct > 0.2 || A.floor_pct > 0.5 ? "info" : "good";
    L.annotations.push(tag(0, `hover ≈ ${A.hover_motor ?? "–"}% · at 100%: ${A.sat_pct}% of time · at minimum: ${A.floor_pct}% · buzz ≤ ${Math.max(...A.noise).toFixed(1)}%`, lv));
    L.annotations.push(tag(1, A.mean.map((v, m) => `M${m + 1} avg ${v}%`).join(" · "), "info"));
  }
  if (seen.size) L.annotations.push({ text: [...seen].map(k => `<span style="color:${css(EVC[k][0])}">■</span> ${EVC[k][1]}`).join("   "), xref: "paper", yref: "paper", x: 0, y: -0.06, xanchor: "left", yanchor: "top", showarrow: false, font: { size: 10, color: css("--ink2") } });
}

// ---------- grouped toolbars: titled groups + popovers for advanced settings ----------
const tbar = (head, groups) => `<div class="tbar"><div class="tbhead">${head}</div><div class="tgroups">${groups.filter(Boolean).join("")}</div></div>`;
const tg = (label, html, o = {}) => `<div class="tgrp ${o.cls || ""}"${o.tip ? ` data-tip="${o.tip}"` : ""}${o.id ? ` id="${o.id}"` : ""}><span class="tl">${label}</span><div class="tc">${html}</div></div>`;
const tpop = (id, label, html, o = {}) => `<details class="tpop ${o.right ? "right" : ""}" id="${id}" ${(S._pop || {})[id] ? "open" : ""}><summary class="btn sm ${o.cls || ""}">${label}</summary><div class="tpanel">${html}</div></details>`;
const prow = (label, html, tip) => `<div class="prow"><span${tip ? ` data-tip="${tip}"` : ""}>${label}</span><span>${html}</span></div>`;
document.addEventListener("toggle", e => { const d = e.target; if (d.matches && d.matches("details.tpop")) (S._pop = S._pop || {})[d.id] = d.open; }, true);
document.addEventListener("pointerdown", e => { document.querySelectorAll("details.tpop[open]").forEach(d => { if (!d.contains(e.target)) d.open = false; }); });

// ---------- analysis tabs ----------
const chip = (key, label, on, o = {}) => `<button class="chip ${on ? "on" : ""} ${o.dash ? "dash" : ""}" data-k="${key}"${o.tip ? ` data-tip="${o.tip}"` : ""}${o.color ? ` style="color:${o.color}"` : ""}>${o.color ? "<i></i>" : ""}<span style="color:var(--ink2)">${label}</span></button>`;
const FSTYLE = {  // filter stage → [color var, dash]
  gyro_lpf1: ["--s5", "solid"], gyro_lpf2: ["--s7", "solid"], gyro_notch: ["--s8", "solid"], rpm: ["--s6", "solid"], dyn_notch: ["--s4", "solid"],
  gyro_total: ["--ink", "solid"], dterm_lpf1: ["--s5", "dash"], dterm_lpf2: ["--s7", "dash"], dterm_notch: ["--s8", "dash"], dterm_total: ["--ink", "dash"] };
const FSHORT = { gyro_lpf1: "Gyro LPF1", gyro_lpf2: "Gyro LPF2", gyro_notch: "Gyro notches", rpm: "RPM notches", dyn_notch: "Dyn notch", gyro_total: "Gyro total",
  dterm_lpf1: "D LPF1", dterm_lpf2: "D LPF2", dterm_notch: "D notch", dterm_total: "D-term total" };

// 2 rows (spectrum / filter response) × 3 columns (axes); bottom x axes match the top ones
function noiseLayout(titles) {  // n columns × 2 rows (spectrum / filter response), one shared frequency axis
  const n = titles.length, L = base({ hovermode: "x unified", dragmode: "pan", margin: { l: 46, r: 8, t: 46, b: 30 } }), gap = 0.03, w = (1 - (n - 1) * gap) / n, ax = L._ax;
  L.annotations = [];
  titles.forEach((t, i) => {
    const x0 = i * (w + gap), top = i + 1, bot = i + 1 + n, sT = top === 1 ? "" : top;
    L[`xaxis${sT}`] = { ...ax, domain: [x0, x0 + w], anchor: `y${sT}`, showticklabels: true, ticks: "outside", ticklen: 3, ...(top > 1 ? { matches: "x" } : {}) };
    L[`yaxis${sT}`] = { ...ax, domain: [0.4, 1], anchor: `x${sT}`, fixedrange: true, title: i ? undefined : { text: "noise power (dB)", font: { size: 10 }, standoff: 2 } };
    L[`xaxis${bot}`] = { ...ax, domain: [x0, x0 + w], anchor: `y${bot}`, matches: "x", title: { text: "frequency (Hz)", font: { size: 10 }, standoff: 2 } };
    L[`yaxis${bot}`] = { ...ax, domain: [0, 0.37], anchor: `x${bot}`, range: [-42, 4], fixedrange: true, title: i ? undefined : { text: "filter gain (dB)", font: { size: 10 }, standoff: 2 } };
    L.annotations.push({ text: `<b>${t}</b> ${n > 1 ? "⤢" : "⤡"}`, xref: "paper", yref: "paper", x: x0, y: 1, xanchor: "left", yanchor: "bottom", showarrow: false,
      font: { size: 12, color: css("--ink") }, captureevents: true, name: "title", hovertext: n > 1 ? "click: show only this axis" : "click: show all axes" });
  });
  L.annotations.push({ text: "Filter response (modelled from your settings)", xref: "paper", yref: "paper", x: 0, y: 0.375, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 10, color: css("--ink2") } });
  delete L._ax; return L;
}
async function renderNoise() {
  if (S.nview === "planner") return renderPlanner();
  const d = await api("noise", { ...rng(), res_prom: S.res.prom, res_persist: S.res.persist, res_mask: S.res.mask, res_fmax: resFmax(), nper: S.nnper });
  if (S.tab !== "noise") return;
  const nyq = S.meta.stats.log_rate_hz / 2, nfr = S.nfr || [10, nyq];
  if (d.error) { $("controls").innerHTML = `<h3>Noise</h3><span class="hint">${d.error}</span>`; return; }
  const present = Object.keys(d.filters);
  const on = k => S.filt.has(k);
  $("controls").innerHTML = tbar(`<h3 data-tip="psd">Noise & filters</h3>${nviewSeg()}
    <span class="hint">vibration by frequency, ${S.range ? "selected part of the flight" : "whole flight"} · filter delay: gyro <b>${d.delay.gyro_ms} ms</b>, D-term <b>${d.delay.dterm_ms} ms</b> <span data-tip="delay">ⓘ</span> · <span data-tip="freq_nav">click a chart, then wheel = zoom · drag = pan</span></span>`, [
    tg("Filter curves", `<span class="chips" id="fchips">${present.map(k => chip(k, FSHORT[k] || k, on(k), { color: css(FSTYLE[k]?.[0] || "--ink"), dash: FSTYLE[k]?.[1] === "dash" })).join("")}</span>`, { tip: "filter_resp" }),
    tg("Overlays", `<span class="chips" id="xchips">${chip("bands", "Noise bands", on("bands"), { tip: "rpm_band" })}${chip("dpsd", "D-term PSD", on("dpsd"), { tip: "tab_pid" })}</span>`),
    tg("Axes", focusHTML()),
    tg("Frequency", `<label class="ctl"><input id="nfmin" type="number" step="10" min="0" value="${Math.round(nfr[0])}"> – <input id="nfmax" type="number" step="10" value="${Math.round(nfr[1])}"> Hz</label>
      <button class="btn sm ghost" id="nffull" ${S.nfr ? "" : "disabled"}>Full${S.nfr ? "" : " ✓"}</button>
      <label class="ctl"><span data-tip="nnper">Detail</span><select id="nnper">${[256, 512, 1024, 2048, 4096].map(n => `<option value="${n}" ${n === S.nnper ? "selected" : ""}>Δf ${(S.meta.stats.log_rate_hz / n).toFixed(1)} Hz</option>`).join("")}</select></label>`, { tip: "frange" }),
    resCtlHTML(d.resonances ? d.resonances.list.length : 0)]);
  bindNview();
  bindResCtl();
  const setNF = () => { const a = Math.max(0, +$("nfmin").value), b = Math.min(nyq, +$("nfmax").value); if (a < b) setNfr(a <= 10 && b >= nyq - 1 ? null : [a, b], true); };
  $("nfmin").onchange = setNF; $("nfmax").onchange = setNF;
  $("nffull").onclick = () => setNfr(null, true);
  $("nnper").onchange = e => { S.nnper = +e.target.value; store.set("nnper", S.nnper); render(); };
  bindFocus();
  const SH = shownAxes([0, 1, 2]), nC = SH.length, xs = c => c ? c + 1 : "";
  for (const id of ["fchips", "xchips"]) $(id).onclick = e => { const b = e.target.closest(".chip"); if (!b) return;
    const k = b.dataset.k; S.filt.has(k) ? S.filt.delete(k) : S.filt.add(k); store.set("filt", [...S.filt]); render(); };
  const f = d.f, k0 = f.findIndex(v => v >= 10), cut = a => a.slice(k0), fx = cut(f), tr = [];
  SH.forEach((i, c) => {
    const a = d.axes[i], s = xs(c), sb = c + 1 + nC;
    tr.push(line(fx, cut(a.raw), "gyro raw", css("--muted"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, legendgroup: "raw", showlegend: !c }));
    tr.push(line(fx, cut(a.filt), `gyro filtered · ${AX[i]}`, axc(i), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { width: 2.4 } }));
    if (on("dpsd") && a.dterm) tr.push(line(fx, cut(a.dterm), `D-term · ${AX[i]}`, axc(i), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { dash: "dot", width: 1.2 } }));
    for (const k of present) if (on(k)) {
      const [c, dash] = FSTYLE[k] || ["--ink", "solid"], tot = k.endsWith("total");
      tr.push(line(fx, cut(d.filters[k].db), d.filters[k].label, css(c), { type: "scatter", xaxis: `x${sb}`, yaxis: `y${sb}`, legendgroup: k, showlegend: false,
        line: { dash: dash === "dash" ? "dash" : "solid", width: tot ? 2.4 : 1.4 }, opacity: tot ? 1 : .85 }));
    }
  });
  const L = noiseLayout(SH.map(i => AX[i]));
  L.xaxis.range = nfr; L.xaxis.uirevision = ++TSY.rev;
  if (on("bands")) L.shapes = SH.flatMap((_, i) => d.bands.flatMap(b => b.kind === "rpm"
    ? [{ type: "rect", xref: `x${i ? i + 1 : ""}`, yref: "paper", x0: b.x0, x1: b.x1, y0: 0, y1: 1, fillcolor: rgba(css("--s6"), .09), line: { width: 0 }, layer: "below" }]
    : [b.x0, b.x1].map(x => ({ type: "line", xref: `x${i ? i + 1 : ""}`, yref: "paper", x0: x, x1: x, y0: 0, y1: 1, line: { color: css("--s4"), width: 1, dash: "dot" } }))));
  if (on("bands") && d.bands.length) L.annotations.push(...d.bands.filter(b => b.kind === "rpm").map(b => ({ text: b.label, xref: "x", yref: "paper", x: (b.x0 + b.x1) / 2, y: 0.985, showarrow: false, font: { size: 10, color: css("--ink2") } })));
  const manyR = d.resonances && d.resonances.list.length > 4;
  if (S.res.on && d.resonances) d.resonances.list.forEach((r, ri) => SH.forEach((i, c) => {
    const s = xs(c), onAx = r.axes.includes(i);
    if (!onAx && manyR) return;
    const done = r.filtered_att_db != null && r.filtered_att_db >= 20;   // already well filtered: keep it in the background
    (L.shapes = L.shapes || []).push({ type: "line", xref: `x${s}`, yref: "paper", x0: r.f, x1: r.f, y0: 0, y1: 1, line: { color: RED(), width: onAx && !done ? 1.8 : 1, dash: onAx && !done ? "dash" : "dot" }, opacity: onAx ? (done ? .4 : .95) : .3 });
    if (onAx && ri < 5) L.annotations.push({ text: `<b>${r.id}</b> ${r.f.toFixed(0)} Hz`, xref: `x${s}`, yref: "paper", x: r.f, y: ri % 2 ? 0.93 : 0.97, showarrow: false, font: { size: 10, color: RED() },
      bgcolor: rgba(css("--surface").length === 7 ? css("--surface") : "#1a1a19", .85), hovertext: `${r.id}: +${r.prom_db} dB, ${r.persistence}% of throttle range, filters remove ${r.filtered_att_db} dB` });
  }));
  if (S.res.on) { L.shapes = L.shapes || []; SH.forEach((_, c) => L.shapes.push(searchLimit(`x${xs(c)}`, "paper")));
    L.annotations.push({ text: `resonance search ≤ ${resFmax()} Hz`, xref: "x", yref: "paper", x: resFmax(), y: 0.01, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 9, color: RED() } }); }
  $("main")._freq = true;
  fitMain(nC > 1 ? 440 : 400);
  await Plotly.react("main", tr, L, CFG);
  $("findings").innerHTML = findingsHTML(d.findings, `<div class="fh">Findings & suggestions</div>`);
}

const CMAPS = {
  BBX: () => css("--seq").split(",").map((c, i, a) => [i / (a.length - 1), c.trim()]),
  Inferno: ["#000004", "#160b39", "#420a68", "#6a176e", "#932667", "#bc3754", "#dd513a", "#f37819", "#fca50a", "#f6d746", "#fcffa4"],
  Magma: ["#000004", "#140e36", "#3b0f70", "#641a80", "#8c2981", "#b73779", "#de4968", "#f7705c", "#fe9f6d", "#fecf92", "#fcfdbf"],
  Viridis: "Viridis", Cividis: "Cividis",
  Turbo: ["#30123b", "#4454c4", "#4490fe", "#1fc8de", "#29efa2", "#7dff56", "#c1f334", "#f1ca3a", "#fe922a", "#ea4f0d", "#7a0403"],
  Jet: "Jet", Hot: "Hot", Greys: "Greys" };
const cmap = n => { const c = CMAPS[n] || CMAPS.BBX; return typeof c === "function" ? c() : Array.isArray(c) ? c.map((x, i, a) => [i / (a.length - 1), x]) : c; };

// ---- single-axis focus (Noise & Spectrogram): "All" or one axis filling the whole chart ----
const shownAxes = avail => S.focusAx == null || !avail.includes(S.focusAx) ? avail : [S.focusAx];
const focusHTML = () => `<span class="seg axseg" id="axfocus" data-tip="ax_focus">${[["all", "All axes"], [0, "Roll"], [1, "Pitch"], [2, "Yaw"]].map(([v, t]) =>
  `<button data-v="${v}" class="${String(S.focusAx ?? "all") === String(v) ? "on" : ""}" style="--c:${v === "all" ? css("--accent") : axc(v)}">${v === "all" ? "" : "<i></i>"}${t}</button>`).join("")}</span>`;
function bindFocus() { $("axfocus").onclick = e => { const v = e.target.dataset.v; if (v == null) return; S.focusAx = v === "all" ? null : +v; render(); }; }
// clicking a panel title toggles focus on that axis (titles carry captureevents)
function onTitleClick(e) {
  if (!e || !e.annotation || e.annotation.name !== "title" || !["noise", "spectro"].includes(S.tab)) return;
  const i = AX.indexOf(String(e.annotation.text).replace(/<[^>]+>/g, "").replace(/ ⤢| ⤡/g, "").trim());
  if (i < 0) return;
  S.focusAx = S.focusAx === i ? null : i; render();
}

// ---- frame-resonance controls (shared by Noise and Spectrogram tabs) ----
const RES_PRESETS = { sensitive: [4.5, 30, 3], balanced: [6, 40, 4], strict: [8, 60, 6] };
const saveRes = () => store.set("res2", S.res);
const resFmax = () => S.res.fmaxAuto !== false && S.meta ? Math.round(S.meta.stats.log_rate_hz * 0.45) : S.res.fmax;
function resCtlHTML(n) {
  const R = S.res, pre = Object.entries(RES_PRESETS).map(([k, v]) => `<button class="${v[0] === R.prom && v[1] === R.persist && v[2] === R.mask ? "on" : ""}" data-p="${k}">${k}</button>`).join("");
  return tg("Frame resonances", `<span class="chips" id="reson">${chip("on", R.on ? `shown <span class="cnt">${n}</span>` : "hidden", R.on, { tip: "res_on", color: css("--serious") })}</span>
    <span class="seg" id="rpre" data-tip="res_presets">${pre}</span>
    ${tpop("resAdv", "⚙ Detection", `<div class="ph">Resonance detection</div>
      ${prow("Prominence ≥", `<input id="rprom" type="range" min="3" max="15" step="0.5" value="${R.prom}"><b id="rpromV">${R.prom} dB</b>`, "res_prom")}
      ${prow("Consistency ≥", `<input id="rper" type="range" min="10" max="100" step="5" value="${R.persist}"><b id="rperV">${R.persist}%</b>`, "res_persist")}
      ${prow("Motor mask ±", `<input id="rmask" type="range" min="3" max="15" step="1" value="${R.mask}"><b id="rmaskV">${R.mask}%</b>`, "res_mask")}
      ${prow("Search up to", `<input id="rfmax" type="number" min="60" max="1000" step="10" value="${resFmax()}"> Hz <button class="btn sm ghost" id="rfauto" ${R.fmaxAuto !== false ? "disabled" : ""}>${R.fmaxAuto !== false ? "full range ✓" : "full range"}</button>`, "res_fmax")}
      <div class="hint">Presets set the first three. A line counts as a resonance when it stands out from its neighbourhood by the prominence, stays put in at least the consistency share of the throttle range it was seen in, and is not within the mask of any motor harmonic.</div>`, { right: true })}`, { tip: "res_on" });
}
function bindResCtl() {
  $("reson").onclick = () => { S.res.on = !S.res.on; saveRes(); render(); };
  for (const [id, k, u] of [["rprom", "prom", " dB"], ["rper", "persist", "%"], ["rmask", "mask", "%"]]) {
    $(id).oninput = e => { $(id + "V").textContent = e.target.value + u; };
    $(id).onchange = e => { S.res[k] = +e.target.value; saveRes(); render(); };
  }
  $("rfmax").onchange = e => { const v = Math.max(60, Math.min(1000, +e.target.value || 150)); S.res.fmax = v; S.res.fmaxAuto = false; saveRes(); render(); };
  $("rfauto").onclick = () => { S.res.fmaxAuto = true; saveRes(); render(); };
  $("rpre").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { [S.res.prom, S.res.persist, S.res.mask] = RES_PRESETS[b.dataset.p]; saveRes(); render(); } };
}
async function getRes() {
  const R = S.res, key = [S.file, S.sub, S.range, R.prom, R.persist, R.mask, resFmax()].join("|");
  if (S._res.key !== key) S._res = { key, d: await api("resonances", { ...rng(), prom: R.prom, persist: R.persist, mask: R.mask, fmax: resFmax() }) };
  return S._res.d;
}
const RED = () => css("--serious");
const searchLimit = (xref, yref) => ({ type: "line", xref, yref, x0: resFmax(), x1: resFmax(), y0: 0, y1: 1, line: { color: RED(), width: 1, dash: "dot" }, opacity: .5 });

// gamma: colour = cmap(u^γ) with u = (dB − min)/(max − min); colourbar keeps real dB labels
function gammaZ(z, lo, hi, g) {
  if (g === 1) return z;
  const sp = hi - lo;
  return z.map(row => row.map(v => v == null ? null : lo + sp * Math.pow(Math.min(1, Math.max(0, (v - lo) / sp)), g)));
}
function gammaTicks(lo, hi, g) {
  const sp = hi - lo, st = [1, 2, 5, 10, 20].find(x => sp / x <= 8) || 20, vals = [];
  for (let v = Math.ceil(lo / st) * st; v <= hi; v += st) vals.push(v);
  return { tickvals: vals.map(v => lo + sp * Math.pow((v - lo) / sp, g)), ticktext: vals.map(String) };
}

async function renderSpectro() {
  const seg = (id, opts, cur) => `<span class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;
  const axesAll = [0, 1, 2].filter(i => S.meta.fields.includes(`${S.src}[${i}]`)), axes = shownAxes(axesAll);
  const fs = S.meta.stats.log_rate_hz, nyq = fs / 2;
  const key = [S.file, S.sub, S.src, S.mode, S.nper, S.range].join("|");
  if (S._spec.key !== key) S.stime = null;   // own time window (vs-time view): starts at the whole flight / selected range
  if (S._spec.key !== key) S._spec = { key, ax: axesAll, ds: await Promise.all(axesAll.map(i => api("spectrogram", { field: `${S.src}[${i}]`, mode: S.mode, nper: S.nper, ...rng() }))) };
  if (S.tab !== "spectro") return;
  const ds = axes.map(i => S._spec.ds[S._spec.ax.indexOf(i)]), res = S.res.on ? await getRes() : { list: [] };
  const auto = ds.map(d => d.auto_clim).filter(Boolean);
  const aut = auto.length ? [Math.min(...auto.map(a => a[0])), Math.max(...auto.map(a => a[1]))] : [0, 60];
  const [zmin, zmax] = S.clim || aut, fr = S.fr || [0, nyq];
  const nperOpts = [64, 128, 256, 512, 1024].map(n => `<option value="${n}" ${n === S.nper ? "selected" : ""}>${n} · Δf ${(fs / n).toFixed(1)} Hz · Δt ${(n / fs * 1000).toFixed(0)} ms</option>`).join("");
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_spectro">Spectrogram</h3><span class="hint" data-tip="freq_nav">click a chart, then wheel = zoom frequency${S.mode === "time" ? " · ctrl+wheel = scroll through time · shift+wheel = zoom time" : ""} · drag = pan${S.mode === "throttle" ? " · empty rows = never flown at that throttle" : ""}</span>`, [
    tg("Signal", seg("src", [["gyroUnfilt", "Gyro raw"], ["gyroADC", "Gyro filtered"], ["axisD", "D-term"]], S.src)),
    tg("Plot against", seg("mode", [["throttle", "Throttle"], ["time", "Time"]], S.mode)),
    tg("Axes", focusHTML()),
    tg("Frequency", `<label class="ctl"><input id="fmin" type="number" step="10" min="0" value="${Math.round(fr[0])}"> – <input id="fmax" type="number" step="10" value="${Math.round(fr[1])}"> Hz</label>
      <button class="btn sm ghost" id="ffull" ${S.fr ? "" : "disabled"}>Full${S.fr ? "" : " ✓"}</button>`, { tip: "frange" }),
    tg("Display", `<select id="cmap" data-tip="colormap">${Object.keys(CMAPS).map(k => `<option ${k === S.cmap ? "selected" : ""}>${k}</option>`).join("")}</select>
      <span class="chips" id="schips">${chip("ml", "Motor lines", S.motorLines, { tip: "motor_lines" })}</span>
      ${tpop("spAdv", `⚙ ${S.clim ? "Manual" : "Auto"} ${Math.round(zmin)}…${Math.round(zmax)} dB`, `<div class="ph">Colour scale &amp; detail</div>
        ${prow("dB range", `<input id="zmin" type="number" step="1" value="${zmin}"> – <input id="zmax" type="number" step="1" value="${zmax}"> <button class="btn sm ghost" id="zauto" ${S.clim ? "" : "disabled"}>Auto${S.clim ? "" : " ✓"}</button>`, "clim")}
        ${prow("Gamma γ", `<input id="gam" type="range" min="-1.6" max="1.6" step="0.05" value="${Math.log2(S.gamma)}"><b id="gamV">${S.gamma.toFixed(2)}</b>`, "gamma")}
        ${prow("Resolution", `<select id="nper">${nperOpts}</select>`, "nper")}
        <div class="hint">Auto range spans the 2nd to 99th percentile of the raw gyro on all axes, so raw, filtered and D-term share one scale. γ &lt; 1 lifts faint lines, γ &gt; 1 keeps only the strongest.</div>`)}`),
    resCtlHTML(res.list.length)]);
  for (const id of ["src", "mode"]) $(id).onclick = e => { if (e.target.dataset.v) { S[id] = e.target.dataset.v; render(); } };
  $("nper").onchange = e => { S.nper = +e.target.value; store.set("nper", S.nper); render(); };
  $("cmap").onchange = e => { S.cmap = e.target.value; store.set("cmap", S.cmap); render(); };
  const setC = () => { const a = +$("zmin").value, b = +$("zmax").value; if (a < b) { S.clim = [a, b]; render(); } };
  $("zmin").onchange = setC; $("zmax").onchange = setC;
  $("zauto").onclick = () => { S.clim = null; render(); };
  $("gam").oninput = e => { $("gamV").textContent = (2 ** +e.target.value).toFixed(2); };
  $("gam").onchange = e => { S.gamma = Math.abs(+e.target.value) < 0.04 ? 1 : +(2 ** +e.target.value).toFixed(3); store.set("gamma", S.gamma); render(); };
  const setF = () => { const a = Math.max(0, +$("fmin").value), b = Math.min(nyq, +$("fmax").value); if (a < b) setSfr(a <= 0 && b >= nyq - 1 ? null : [a, b], true); };
  $("fmin").onchange = setF; $("fmax").onchange = setF;
  $("ffull").onclick = () => setSfr(null, true);
  $("schips").onclick = () => { S.motorLines = !S.motorLines; render(); };
  bindResCtl(); bindFocus();
  const ylab = S.mode === "time" ? "time (s)" : "throttle (%)", tk = gammaTicks(zmin, zmax, S.gamma);
  const tr = ds.flatMap((d, k) => {
    const s = k ? k + 1 : "", o = [{ type: "heatmap", x: d.f, y: d.y, z: gammaZ(d.z, zmin, zmax, S.gamma), zmin, zmax, colorscale: cmap(S.cmap), xaxis: `x${s}`, yaxis: `y${s}`, zsmooth: "best",
      showscale: k === ds.length - 1, colorbar: { thickness: 10, outlinewidth: 0, tickfont: { size: 10 }, title: { text: "dB", side: "top", font: { size: 10 } }, tickmode: "array", ...tk },
      customdata: d.z.map((row, r) => row.map(v => [d.count[r], v])),
      hovertemplate: `%{x:.0f} Hz<br>${S.mode === "time" ? "t %{y:.1f} s" : "thr %{y:.0f}% · %{customdata[0]} windows"}<br>%{customdata[1]:.1f} dB<extra>${AX[axes[k]]}</extra>` }];
    if (S.motorLines && d.motor_hz) [1, 2, 3].forEach(h => o.push({ type: "scatter", mode: "lines", x: d.motor_hz.map(v => v == null ? null : v * h), y: d.y, xaxis: `x${s}`, yaxis: `y${s}`,
      line: { color: rgba(css("--ink").length === 7 ? css("--ink") : "#ffffff", .75), width: 1, dash: "dot" }, hovertemplate: `motor ×${h}: %{x:.0f} Hz<extra></extra>`, showlegend: false, connectgaps: false }));
    return o;
  });
  const L = cols(axes.length, axes.map(i => AX[i]), "frequency (Hz)", { showlegend: false, dragmode: "pan", margin: { l: 46, r: 8, t: 30, b: 30 } });
  L.annotations.forEach(a => { if (a.name === "title") { a.text = `<b>${a.text}</b> ${axes.length > 1 ? "⤢" : "⤡"}`; a.hovertext = axes.length > 1 ? "click: show only this axis" : "click: show all axes"; } });
  axes.forEach((_, k) => { const s = k ? k + 1 : "";
    L[`xaxis${s}`].range = fr; L[`xaxis${s}`].fixedrange = false; if (k) L[`xaxis${s}`].matches = "x"; else L.xaxis.uirevision = ++TSY.rev;
    if (S.mode === "throttle") { L[`yaxis${s}`].range = [0, 100]; L[`yaxis${s}`].fixedrange = true; }
    else { if (k) L[`yaxis${s}`].matches = "y"; else { L.yaxis.uirevision = ++TSY.rev; L.yaxis.range = S.stime || spFull(ds); } } });
  // red resonance markers: dashed line at the frequency, solid bar over the throttle band where it was found
  L.shapes = []; L.annotations = L.annotations || [];
  const many = res.list.length > 4;  // declutter: label only the 5 strongest, stagger labels, drop faint cross-axis lines
  if (S.res.on) res.list.forEach((r, ri) => axes.forEach((ax, k) => {
    const s = k ? k + 1 : "", on = r.axes.includes(ax);
    if (!on && many) return;
    const halo = { type: "line", xref: `x${s}`, x0: r.f, x1: r.f, line: { color: "#000000", width: 5 }, opacity: on ? .55 : .25 };  // contrast on any colormap
    L.shapes.push({ ...halo, yref: `y${s} domain`, y0: 0, y1: 1 });
    L.shapes.push({ type: "line", xref: `x${s}`, yref: `y${s} domain`, x0: r.f, x1: r.f, y0: 0, y1: 1, line: { color: RED(), width: on ? 2 : 1, dash: "dash" }, opacity: on ? 1 : .45 });
    if (on && S.mode === "throttle") L.shapes.push({ type: "line", xref: `x${s}`, yref: `y${s}`, x0: r.f, x1: r.f, y0: r.thr[0], y1: r.thr[1], line: { color: RED(), width: 3.5 } });
    if (on && ri < 5) L.annotations.push({ text: `<b>${r.id}</b> ${r.f.toFixed(0)} Hz`, xref: `x${s}`, yref: `y${s} domain`, x: r.f, y: ri % 2 ? 1.035 : 1, yanchor: "bottom", showarrow: false, font: { size: 10, color: RED() }, bgcolor: rgba(css("--surface").length === 7 ? css("--surface") : "#1a1a19", .8) });
  }));
  if (S.res.on) axes.forEach((_, k) => { const s = k ? k + 1 : ""; L.shapes.push(searchLimit(`x${s}`, `y${s} domain`)); });
  L.yaxis.title = { text: ylab, font: { size: 11 } };
  setTimeAxes([]);   // the spectrogram keeps its own time window (whole flight by default), it doesn't follow the other time charts
  $("main")._freq = "spectro";
  fitMain(400);
  await Plotly.react("main", tr, L, CFG);
  $("findings").innerHTML = S.res.on && res.list.length ? findingsHTML(resonance_findings_js(res), `<div class="fh">Suspected frame resonances</div>`) : "";
}
const spFull = ds => { const y = ds[0].y; return [y[0], y[y.length - 1]]; };
// vs-time spectrogram: ctrl+wheel scrolls through time, shift+wheel zooms time around the cursor
function spectroTimeWheel(e) {
  const gd = $("main"), fl = gd._fullLayout; if (!fl || !S._spec.ds) return false;
  const full = spFull(S._spec.ds), cur = (S.stime || fl.yaxis.range).slice(), span = cur[1] - cur[0];
  let r;
  if (e.ctrlKey) { const d = Math.sign(e.deltaY) * span * 0.15; r = [cur[0] + d, cur[1] + d]; }
  else { const b = gd.getBoundingClientRect(), v = fl.yaxis.p2d(e.clientY - b.top - fl.yaxis._offset), f = 1.2 ** Math.sign(e.deltaY); r = [v - (v - cur[0]) * f, v + (cur[1] - v) * f]; }
  const w = Math.min(full[1] - full[0], Math.max(0.5, r[1] - r[0]));
  r[0] = Math.max(full[0], Math.min(r[0], full[1] - w)); r[1] = r[0] + w;
  S.stime = w >= full[1] - full[0] - 1e-6 ? null : r;
  Plotly.relayout(gd, { "yaxis.range": r });
  return true;
}

// the Noise tab gets full findings from the server; here we show a compact version of the same list
function resonance_findings_js(res) {
  return res.list.slice(0, 5).map(r => ({ level: (r.filtered_att_db != null && r.filtered_att_db < 12) || r.f < 100 ? "warning" : "info",
    title: `${r.id}: ${r.f.toFixed(0)} Hz (+${r.prom_db} dB, ${r.persistence}% of throttle range)`,
    tldr: `on ${r.axes.map(a => AX[a].toLowerCase()).join(", ")} · ${r.thr[0]}–${r.thr[1]}% throttle · filters remove ${r.filtered_att_db ?? "?"} dB`,
    detail: "It stays at one frequency while motor noise moves with RPM, so it comes from the frame or a part on it. The Noise tab lists what to do.", action: "", cost: "" }));
}

// stick-rate presets from this log's own distribution (roll+pitch window peaks): gentle / active / aggressive
function presets(d) {
  const v = [0, 1].flatMap(i => (d[i] && d[i].seg_stick) || []).filter(x => x >= 20).sort((a, b) => a - b);
  if (v.length < 10) return [["all", 20, 2000]];
  const q = p => Math.round(v[Math.floor((v.length - 1) * p)] / 5) * 5, p50 = q(.5), p90 = q(.9);
  return [[`gentle 20–${p50}°/s`, 20, p50], [`active ${p50}–${p90}`, p50, p90], [`aggressive >${p90}`, p90, 2000], ["all", 20, 2000]];
}
async function renderStep() {
  const P = S.step;
  P.src = P.src || store.get("step.src", "filt"); P.band = P.band || store.get("step.band", "ci");
  const q = { ...rng(), win_s: P.win_s, min_sp: P.min_sp, max_sp: P.max_sp, thr_min: P.thr_min, thr_max: P.thr_max };
  // filtered gyro is the reference (what the PID loop acts on, least estimation noise); raw is shown for comparison
  const [d, dr] = await Promise.all([api("step", { ...q, src: "gyroADC" }), P.src !== "filt" ? api("step", { ...q, src: "gyroUnfilt" }) : null]);
  if (S.tab !== "step") return;
  const main = P.src === "raw" ? dr : d;
  const num = (id, v, step = 10) => `<input id="${id}" type="number" step="${step}" value="${v}">`;
  const seg = (id, opts, cur, tip) => `<span class="seg" id="${id}" data-tip="${tip}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_step">Step response</h3><span class="hint">average response to your stick moves, ${S.range ? "selected part of the flight" : "whole flight"}</span>`, [
    tg("Axes", `<span class="chips" id="axchips">${AX.map((a, i) => chip(i, a, P.axes[i], { color: axc(i) })).join("")}</span>`),
    tg("Gyro", seg("ssrc", [["filt", "Filtered"], ["raw", "Raw"], ["both", "Both"]], P.src, "step_src")),
    tg("Band", seg("sband", [["ci", "Confidence"], ["iqr", "Spread"], ["off", "None"]], P.band, "step_band") + `<span class="chips" id="cchips">${chip("c", "Each window", P.curves, { tip: "show_curves" })}</span>`),
    tg("Stick moves", `<span class="chips" id="presets" data-tip="min_sp">${presets(d).map(([l, a, b]) => `<button class="chip ${P.min_sp === a && P.max_sp === b ? "on" : ""}" data-p="${a},${b}">${l}</button>`).join("")}</span>
      ${tpop("stAdv", "⚙ Filter moves", `<div class="ph">Which stick moves are averaged</div>
        ${prow("Stick rate °/s", `${num("min_sp", P.min_sp)} – ${num("max_sp", P.max_sp, 50)}`, "min_sp")}
        ${prow("Throttle %", `${num("thr_min", P.thr_min, 5)} – ${num("thr_max", P.thr_max, 5)}`, "thr_rng")}
        ${prow("Window", `<select id="win_s">${[1, 2, 3].map(v => `<option value="${v}" ${v === P.win_s ? "selected" : ""}>${v} s</option>`).join("")}</select>`, "win_s")}`, { right: true })}`)]);
  $("axchips").onclick = e => { const b = e.target.closest(".chip"); if (b) { P.axes[+b.dataset.k] = !P.axes[+b.dataset.k]; render(); } };
  $("cchips").onclick = () => { P.curves = !P.curves; render(); };
  $("ssrc").onclick = e => { const v = e.target.dataset.v; if (v) { P.src = v; store.set("step.src", v); render(); } };
  $("sband").onclick = e => { const v = e.target.dataset.v; if (v) { P.band = v; store.set("step.band", v); render(); } };
  for (const k of ["min_sp", "max_sp", "thr_min", "thr_max"]) $(k).onchange = e => { P[k] = +e.target.value; render(); };
  $("win_s").onchange = e => { P.win_s = +e.target.value; render(); };
  $("presets").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { [P.min_sp, P.max_sp] = b.dataset.p.split(",").map(Number); render(); } };

  const tr = [], sel = [0, 1, 2].filter(i => P.axes[i] && main[i]);
  const bandOf = r => {  // confidence of the median (95 %) or spread of individual windows (IQR)
    if (P.band === "iqr") return [r.q25, r.q75];
    const se = r.q75.map((v, k) => 1.2533 * ((v - r.q25[k]) / 1.349) / Math.sqrt(r.n));
    return [r.median.map((m, k) => m - 1.96 * se[k]), r.median.map((m, k) => m + 1.96 * se[k])];
  };
  const addAxis = (dd, i, dashed) => {
    const r = dd[i]; if (!r || !r.median) return;
    const c = axc(i), g = `a${i}${dashed ? "r" : ""}`, lab = `${AX[i]}${P.src === "both" ? (dashed ? " raw" : " filtered") : ""} (n=${r.n})`;
    if (P.curves && !dashed) r.curves.forEach(cv => tr.push(line(dd.t_ms.filter((_, k) => k % 2 === 0), cv, "", c, { type: "scatter", opacity: .15, line: { width: 1 }, legendgroup: g, showlegend: false, hoverinfo: "skip" })));
    if (P.band !== "off" && !dashed) { const [lo, hi] = bandOf(r);
      tr.push(line(dd.t_ms, hi, "", c, { type: "scatter", line: { width: 0 }, legendgroup: g, showlegend: false, hoverinfo: "skip" }),
              line(dd.t_ms, lo, "", c, { type: "scatter", line: { width: 0 }, fill: "tonexty", fillcolor: rgba(c, P.band === "iqr" ? .10 : .28), legendgroup: g, showlegend: false, hoverinfo: "skip" })); }
    tr.push(line(dd.t_ms, r.median, lab, c, { type: "scatter", legendgroup: g, line: { width: dashed ? 1.6 : 2.4, dash: dashed ? "dash" : "solid" } }));
  };
  for (const i of sel) {
    if (P.src === "raw") addAxis(dr, i, false); else addAxis(d, i, false);
    if (P.src === "both") addAxis(dr, i, true);
    const r = main[i], c = axc(i), g = `a${i}`, used = r.seg_used.map(Boolean);
    tr.push({ type: "scattergl", mode: "markers", x: r.seg_t.filter((_, k) => used[k]), y: (r.seg_stick || []).filter((_, k) => used[k]), xaxis: "x2", yaxis: "y2",
              marker: { size: 5, color: c }, legendgroup: g, showlegend: false, hovertemplate: `t %{x:.1f}s · peak stick %{y:.0f}°/s<extra>${AX[i]} used</extra>` });
    tr.push({ type: "scattergl", mode: "markers", x: r.seg_t.filter((_, k) => !used[k]), y: (r.seg_stick || []).filter((_, k) => !used[k]), xaxis: "x2", yaxis: "y2",
              marker: { size: 4, color: rgba(css("--muted").length === 7 ? css("--muted") : "#898781", .35) }, legendgroup: g, showlegend: false, hovertemplate: `t %{x:.1f}s · %{y:.0f}°/s<extra>excluded</extra>` });
  }
  const L = base({ hovermode: "x unified" }), ax = L._ax; delete L._ax;
  L.xaxis = { ...ax, domain: [0, 1], anchor: "y", range: [0, 300], title: { text: "time after the stick move (ms)", font: { size: 10 }, standoff: 2 } };
  L.yaxis = { ...ax, domain: [0.34, 1], range: [0, 1.6], title: { text: "response (1 = what you asked)", font: { size: 10 }, standoff: 2 } };
  L.xaxis2 = { ...ax, domain: [0, 1], anchor: "y2", title: { text: "flight time (s)", font: { size: 10 }, standoff: 2 }, uirevision: ++TSY.rev, ...(S.view ? { range: S.view } : {}) };
  L.dragmode = "pan";
  setTimeAxes([{ axis: "xaxis2", dim: "x", pair: "yaxis2" }]);
  L.yaxis2 = { ...ax, domain: [0, 0.2], anchor: "x2", type: "log", fixedrange: true, title: { text: "stick °/s", font: { size: 10 }, standoff: 2 } };
  L.shapes = [{ type: "line", xref: "x domain", yref: "y", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), dash: "dash", width: 1 } },
    ...[P.min_sp, P.max_sp].filter(v => v > 0).map(v => ({ type: "line", xref: "x2 domain", yref: "y2", x0: 0, x1: 1, y0: v, y1: v, line: { color: css("--ink2"), dash: "dot", width: 1 } }))];
  const lat = i => d[i] && d[i].metrics && dr && dr[i] && dr[i].metrics ? (d[i].metrics.latency_ms - dr[i].metrics.latency_ms) : null;
  const latTxt = P.src !== "filt" ? sel.map(i => lat(i)).filter(v => v != null) : [];
  L.annotations = [{ text: `Band: ${P.band === "ci" ? "95% confidence of the median (thin = reliable)" : P.band === "iqr" ? "spread of individual moves (middle 50%)" : "off"}` +
      (latTxt.length ? ` · raw reaches 50% ~${(latTxt.reduce((a, b) => a + b, 0) / latTxt.length).toFixed(1)} ms earlier than filtered (= filter delay)` : ""),
      xref: "paper", yref: "paper", x: 1, y: 1.0, xanchor: "right", yanchor: "bottom", showarrow: false, font: { size: 10, color: css("--ink2") } },
    { text: "Analysis windows: biggest stick movement in each piece of the flight (colour = used, grey = left out by the ranges above)", xref: "paper", yref: "paper", x: 0, y: 0.205, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 10, color: css("--ink2") } }];
  L.hoversubplots = "single";
  fitMain(440);
  await Plotly.react("main", tr, L, CFG);

  const mt = (k, lbl, v, u = "") => `<dt data-tip="${k}">${lbl}</dt><dd>${v ?? "–"}${v != null ? u : ""}</dd>`;
  const vlv = { Good: "good", OK: "warning", "Needs work": "serious", "Low confidence": "info" };
  const cards = sel.filter(i => d[i] && d[i].metrics).map(i => { const r = d[i], m = r.metrics;
    return `<div class="vd lv-${vlv[r.verdict]}"><div class="hd"><span><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</span>
      <span class="badge lv-${vlv[r.verdict]}">${{ Good: "✓", OK: "⚠", "Needs work": "✖", "Low confidence": "ℹ" }[r.verdict]} ${r.verdict}</span></div>
      <dl>${mt("overshoot", "Overshoot", m.overshoot_pct, "%")}${mt("rise", "Rise", m.rise_ms, " ms")}${mt("latency", "Latency", m.latency_ms, " ms")}${mt("settle", "Settle", m.settle_ms, " ms")}
      ${mt("steady", "Steady", m.steady)}${mt("ringing", "Ringing", m.ringing)}${mt("n", "Windows", r.n)}</dl></div>`; }).join("");
  const mx = Math.max(0, ...sel.flatMap(i => main[i].seg_stick || []));
  const none = sel.filter(i => !(d[i] && d[i].metrics)).map(i => `<div class="vd lv-info"><div class="hd">${AX[i]}<span class="badge lv-info">ℹ no data</span></div><span class="hint">Only ${d[i] ? d[i].n : 0} windows match (need 3). The fastest stick input in this range is ${mx.toFixed(0)} °/s, so widen the stick or throttle range.</span></div>`).join("");
  $("findings").innerHTML = pidHTML(d.pid) + `<div class="fh">Tune verdict (filtered gyro)</div><div class="verdicts">${cards}${none}</div>` +
    findingsHTML(sel.flatMap(i => (d[i] && d[i].findings) || []), `<div class="fh">What to change, and what it costs</div>`);
  if ($("pidCopy")) $("pidCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText($("pidCli").textContent); $("pidCopy").textContent = "Copied ✓"; };
}

// suggested PIDs for the next test flight (from the filtered-gyro step response, scaled to prop size)
function pidHTML(p) {
  if (!p) return "";
  const u = S.profile ? S.profile.used : { inch: "?" }, keys = ["P", "I", "D", "Dmax", "FF"];
  const cell = (a, k) => { const c = a.current[k], s = a.suggested[k], ch = s !== c;
    return `<td class="${ch ? (s > c ? "up" : "down") : ""}">${ch ? `<s>${Math.round(c)}</s> <b>${s}</b>` : Math.round(c)}</td>`; };
  const rows = ["roll", "pitch", "yaw"].map((a, i) => { const A = p.axes[a];
    return `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td>${keys.map(k => cell(A, k)).join("")}</tr>`; }).join("");
  const whys = ["roll", "pitch", "yaw"].map((a, i) => `<li><b style="color:${axc(i)}">${AX[i]}</b> ${p.axes[a].why.map(esc).join("; ")}</li>`).join("");
  const anyCh = ["roll", "pitch", "yaw"].some(a => keys.some(k => p.axes[a].suggested[k] !== p.axes[a].current[k]));
  const sl = (p.sliders || []).map(x => `${x.label}: <b>${x.current.toFixed(2)} → ${x.suggested.toFixed(2)}</b>`).join(" · ");
  return `<div class="fh" data-tip="pid_sug">Suggested PIDs for your next test flight</div>
    <div class="pidcard lv-${anyCh ? "warning" : "good"}"><div class="hint">One cautious step (${p.step_pct}% for ${u.inch}″ props: bigger props get smaller steps). Based on the filtered-gyro step response${p.d_noisy ? "; D-term is already noisy, so damping is added by lowering P instead of raising D" : ""}. Fly, log, and check again.</div>
    <table class="pidt"><tr><th></th>${keys.map(k => `<th data-tip="${k}">${k}</th>`).join("")}</tr>${rows}</table><ul class="whys">${whys}</ul>
    ${sl ? `<div class="hint">Your PIDs come from the simplified sliders: easiest is to move the sliders instead. ${sl}</div>` : ""}
    ${p.cli.length ? `<div class="clibox"><pre id="pidCli">${p.cli.join("\n")}\nsave</pre><button class="btn sm" id="pidCopy">Copy CLI</button></div>
      <div class="hint">Typing exact values in the CLI turns the simplified sliders off. Check names with <code>get p_</code> on your firmware.</div>` : `<div class="hint">No change suggested.</div>`}</div>`;
}

// ---------- motor health ----------
const MC = ["--roll", "--pitch", "--yaw", "--s4", "--s5", "--s6", "--s7", "--s8"];  // motor colours = Motors tab
function quadMap(d) {
  if (d.motors.length !== 4) return "";
  const at = { 0: [230, 190], 1: [230, 50], 2: [70, 190], 3: [70, 50] };  // M1 RR, M2 FR, M3 RL, M4 FL (front = top)
  const rel = d.vib["1"].rel, off = d.cmd_offset || [0, 0, 0, 0];
  const lvl = v => v == null ? "info" : v > 2.2 ? "serious" : v > 1.6 ? "warning" : "good";
  const R = off.length ? (-off[0] - off[1] + off[2] + off[3]) / 4 : 0, P = off.length ? (off[0] - off[1] + off[2] - off[3]) / 4 : 0;
  const cg = [150 - Math.max(-60, Math.min(60, R * 12)), 120 + Math.max(-50, Math.min(50, P * 12))];  // heavier side = motors working harder
  return `<svg viewBox="0 0 300 250" style="width:100%;max-width:360px;display:block" role="img" aria-label="Quad top view with per-motor vibration and load">
    <line x1="70" y1="50" x2="230" y2="190" stroke="var(--axis)" stroke-width="8" stroke-linecap="round"/>
    <line x1="230" y1="50" x2="70" y2="190" stroke="var(--axis)" stroke-width="8" stroke-linecap="round"/>
    <rect x="125" y="95" width="50" height="50" rx="8" fill="var(--surface)" stroke="var(--axis)"/>
    <text x="150" y="16" text-anchor="middle" font-size="11" fill="var(--ink2)">▲ FRONT</text>
    ${d.cmd_offset ? `<circle id="hq-cg" cx="${cg[0]}" cy="${cg[1]}" r="6" fill="var(--ink)"/><text id="hq-cgt" x="${cg[0]}" y="${cg[1] + 18}" text-anchor="middle" font-size="10" fill="var(--ink2)">CG est.</text>` : ""}
    <text id="hq-cap" x="4" y="14" font-size="10" fill="var(--muted)">summary</text>
    ${[0, 1, 2, 3].map(m => { const [x, y] = at[m], v = rel[m];
      return `<g><circle id="hq-r${m}" cx="${x}" cy="${y}" r="34" fill="none" stroke="var(--${lvl(v)})" stroke-width="${v > 1.6 ? 4 : 2}"/>
        <circle id="hq-d${m}" cx="${x}" cy="${y}" r="7" fill="${css(MC[m])}" stroke="var(--ink)" stroke-width="0.8"/>
        <text x="${x}" y="${y - 14}" text-anchor="middle" font-size="12" font-weight="700" fill="var(--ink)">M${m + 1}</text>
        <text id="hq-a${m}" x="${x}" y="${y + 24}" text-anchor="middle" font-size="10" fill="var(--ink2)">1× ${v != null ? v.toFixed(2) + "×" : "–"}</text>
        <text id="hq-b${m}" x="${x}" y="${y + 52}" text-anchor="middle" font-size="10" fill="var(--ink2)">load ${off.length ? (off[m] > 0 ? "+" : "") + off[m].toFixed(1) + "%" : "–"}</text></g>`; }).join("")}
  </svg>`;
}

// per-motor report card: status + plain verdict + small gauges (thresholds match the backend findings)
function motorCard(d, m, bk) {
  const v1 = d.vib["1"].rel[m], vb = d.vib[bk] ? d.vib[bk].rel[m] : null, ld = d.cmd_offset ? d.cmd_offset[m] : null, rp = d.rpm_dev[m];
  const ev = d.events.filter(e => e.motor === m).length, R = 7.5;
  const lvRel = v => v == null ? "info" : v > 2.2 ? "serious" : v > 1.6 ? "warning" : "good";
  const lvSym = v => v == null ? "info" : Math.abs(v) > 0.76 * R ? "serious" : Math.abs(v) > 0.4 * R ? "warning" : "good";
  const issues = [];
  if (lvRel(v1) !== "good" && v1 != null) issues.push([lvRel(v1), `Shakes once per turn (${v1.toFixed(1)}× the others): balance or replace the prop first, then check for a bent shaft or a loose bell.`]);
  if (lvRel(vb) !== "good" && vb != null) issues.push([lvRel(vb), `Blade-pass buzz (${vb.toFixed(1)}× the others): look for a chipped or bent blade, or a loose prop nut.`]);
  if (lvSym(ld) !== "good" && ld != null) issues.push([lvSym(ld), ld > 0 ? `Works ${ld.toFixed(1)}% harder than average: heavy corner (battery/CG), a weaker motor, or a damaged prop.`
                                                                             : `Works ${(-ld).toFixed(1)}% less than average: this corner is light, or the others work harder.`]);
  if (lvSym(rp) !== "good" && rp != null) issues.push([lvSym(rp), rp < 0 ? `Spins ${(-rp).toFixed(1)}% slower for the same command: worn bearings, rubbing, or a heavier prop.`
                                                                             : `Spins ${rp.toFixed(1)}% faster for the same command: prop may be smaller or damaged (less load).`]);
  if (ev) issues.push([ev > 2 ? "serious" : "warning", `Lost its RPM signal ${ev}×: possible desync. Check solder joints, motor screws and the ESC.`]);
  issues.sort((a, b) => LVORD[a[0]] - LVORD[b[0]]);
  const lv = issues.length ? issues[0][0] : "good";
  const g = (label, tip, v, pos, txt, sym, g1 = 53, g2 = 73) => v == null ? `<div class="gauge"><span data-tip="${tip}">${label}</span><span class="na">no data</span></div>`
    : `<div class="gauge ${sym ? "sym" : ""}"><span data-tip="${tip}">${label}</span><span class="gt" style="--g1:${g1}%;--g2:${g2}%"><i style="left:${Math.max(0, Math.min(100, pos * 100)).toFixed(1)}%"></i></span><span class="gv">${txt}</span></div>`;
  const rel = v => v / 3, sym = v => (v + R) / (2 * R), sg = v => (v > 0 ? "+" : "") + v.toFixed(1) + "%";
  return `<section class="mcard lv-${lv}" style="grid-area:m${m + 1}">
    <div class="mh"><span><span class="sw" style="background:${css(MC[m])}"></span> <b>${d.motors[m]}</b> <span class="hint">${d.pos[m] || ""}</span></span>
      <span class="badge lv-${lv}">${LV[lv].split(" ")[0]} ${{ good: "Healthy", info: "Unclear", warning: "Check", serious: "Fix" }[lv]}</span></div>
    <div class="verd">${issues.length ? esc(issues[0][1]) : "Nothing stands out: vibration, load and speed match the other motors."}</div>
    ${issues.slice(1).map(x => `<div class="hint">• ${esc(x[1])}</div>`).join("")}
    ${g("Balance (1×)", "vib_rel", v1, v1 != null ? rel(v1) : 0, v1 != null ? v1.toFixed(2) + "×" : "")}
    ${g(`Blades (${bk}×)`, "vib_bp", vb, vb != null ? rel(vb) : 0, vb != null ? vb.toFixed(2) + "×" : "")}
    ${g("Load", "load", ld, ld != null ? sym(ld) : 0, ld != null ? sg(ld) : "", true)}
    ${g("RPM / command", "rpm_dev", rp, rp != null ? sym(rp) : 0, rp != null ? sg(rp) : "", true)}
    <div class="gauge"><span data-tip="desync">RPM dropouts</span><span style="color:var(--${ev ? ev > 2 ? "serious" : "warn-ink" : "good-ink"})">${ev ? "▲ " + ev : "none"}</span><span></span></div>
  </section>`;
}

// ---- Motor health: four plain-language verdicts on top (props, weight balance, motors & ESCs, efficiency) ----
function healthVerdicts(d, bk) {
  const nm = d.motors.length, v1 = d.vib["1"].rel, vb = d.vib[bk] ? d.vib[bk].rel : [], off = d.cmd_offset || [], rd = d.rpm_dev || [], p = d.power, e = p && p.elec;
  const worstIdx = arr => { let k = -1; arr.forEach((v, i) => { if (v != null && (k < 0 || v > arr[k])) k = i; }); return k; };
  const tiles = [];
  // 1. props & balance
  const k1 = worstIdx(v1), kb = worstIdx(vb), w1 = k1 >= 0 ? v1[k1] : null, wb = kb >= 0 ? vb[kb] : null;
  const pv = Math.max(w1 ?? 0, wb ?? 0), pk = (w1 ?? 0) >= (wb ?? 0) ? k1 : kb;
  tiles.push(["🌀", "Props & balance", pv > 2.2 ? "serious" : pv > 1.6 ? "warning" : w1 == null ? "info" : "good",
    w1 == null ? "not enough data" : pv > 1.6 ? `${d.motors[pk]} shakes ${pv.toFixed(1)}×` : "all smooth",
    pv > 1.6 ? `${d.motors[pk]} (${d.pos[pk] || ""}) vibrates ${pv.toFixed(1)}× more than the others ${(w1 ?? 0) >= (wb ?? 0) ? "once per turn: unbalanced prop or bent shaft" : "at blade-pass: damaged blade"}.` : "No motor vibrates clearly more than the others at the same speed.", "hmap"]);
  // 2. weight balance from the load offsets
  if (nm === 4 && off.length) {
    const R = (-off[0] - off[1] + off[2] + off[3]) / 4, P = (off[0] - off[1] + off[2] - off[3]) / 4, mag = Math.hypot(R, P);
    const dir = [Math.abs(P) >= 0.8 ? (P > 0 ? "rear" : "front") : "", Math.abs(R) >= 0.8 ? (R > 0 ? "left" : "right") : ""].filter(Boolean).join("-");
    const single = worstIdx(off.map(Math.abs));
    tiles.push(["⚖️", "Weight balance", mag > 3 ? "warning" : mag > 1.5 ? "info" : "good", mag > 1.5 ? `${dir || "uneven"}-heavy` : "centred",
      mag > 1.5 ? `The ${dir} motors work ~${(2 * mag).toFixed(1)}% harder in calm flight: move the battery or camera ${dir.split("-").map(x => ({ rear: "forward", front: "back", left: "right", right: "left" }[x])).join(" and ")}.`
        : `Load is within ±${Math.max(...off.map(Math.abs)).toFixed(1)}% on every motor${Math.abs(off[single]) > 2 ? ` (${d.motors[single]} ${off[single] > 0 ? "+" : ""}${off[single].toFixed(1)}%)` : ""}.`, "hmap"]);
  }
  // 3. motors & ESCs
  const ev = d.events.filter(x => !x.zero).length, kr = worstIdx(rd.map(v => v == null ? null : Math.abs(v))), rv = kr >= 0 ? rd[kr] : null;
  tiles.push(["⚙️", "Motors & ESCs", ev > 2 ? "serious" : ev || (rv != null && Math.abs(rv) > 3) ? "warning" : "good",
    ev ? `${ev} speed dropout${ev > 1 ? "s" : ""}` : rv != null && Math.abs(rv) > 3 ? `${d.motors[kr]} ${rv > 0 ? "fast" : "slow"} ${rv > 0 ? "+" : ""}${rv.toFixed(1)}%` : "all matched",
    ev ? "A motor lost speed while its command held: check solder joints, motor wires and ESC." : rv != null && Math.abs(rv) > 3 ? `${d.motors[kr]} spins ${Math.abs(rv).toFixed(1)}% ${rv > 0 ? "faster" : "slower"} than the others for the same command: worn bearing, rubbing bell or a different prop.`
      : "Same command gives the same speed on every motor; no desyncs.", "hmap"]);
  // 4. efficiency
  if (p) {
    const waste = e ? e.corr + e.vib : null, all = (waste ?? 0) + p.parts.steady;
    tiles.push(["🔋", "Efficiency", all >= 10 ? "serious" : all >= 4 ? "warning" : all >= 1.5 ? "info" : "good", `~${all.toFixed(1)}% battery wasted`,
      e ? `Holding attitude swings the motors for +${waste.toFixed(1)}% battery power${e.spec && e.spec.peak_f && waste >= 1 ? ` (mostly ${e.spec.peak_f.toFixed(0)} Hz: ${e.spec.peak_what})` : ""}; steady imbalance +${p.parts.steady.toFixed(1)}%.`
        : `Steady imbalance costs +${p.parts.steady.toFixed(1)}% prop power (no electrical model: motor values missing).`, "hpwr"]);
  }
  return `<div class="hverd">${tiles.map(([ic, h, lv, big, txt, go]) => `<button class="hv lv-${lv}" data-go="${go}"><span class="hvi">${ic}</span><span class="hvb"><span class="hvh">${h}</span>
    <b>${esc(big)}</b><span class="hvt">${esc(txt)}</span></span></button>`).join("")}</div>`;
}

// where the extra battery power goes (motors.motor_power): plain-language headline + one bar per cause, maths in a fold-out
function powerPanel(p) {
  if (!p) return "";
  const P = p.parts, e = p.elec;
  const size = v => v < 0.5 ? ["tiny", "good"] : v < 2 ? ["small", "info"] : v < 5 ? ["worth fixing", "warning"] : ["big", "serious"];
  const rows = [];
  if (e) {
    rows.push(["Motors twitching to stay level", e.corr, e.corr_rng, "--warning", "twitch",
      "To hold the quad steady the motors speed up and slow down many times a second. A little is normal; oscillation, propwash or a frame resonance makes it worse.",
      "Fix: a calmer tune (see Step response / PID terms), and check the Noise tab for resonances."]);
    rows.push(["Motors buzzing from noise", e.vib, e.vib_rng, "--serious", "buzz",
      "Vibration that gets through the filters makes the motor commands buzz. That only makes heat.",
      "Fix: balanced props and a solid frame first, then a bit more D-term filtering."]);
  }
  rows.push(["Uneven load (weight, props)", P.steady, null, "--s5", "uneven",
    "Some motors always work harder than others, and a motor that works harder is less efficient.",
    "Fix: move the battery or camera so the quad hovers level, and use matching props."]);
  const total = rows.reduce((a, r) => a + r[1], 0), [tw, tlv] = size(total), mx = Math.max(1, ...rows.map(r => r[2] ? r[2][1] : r[1]));
  const SMP = p.samples || {};
  const cap = { twitch: "1 s of one motor, sticks still", buzz: "0.15 s zoom of the same motor", uneven: "3 s of steady flight, all motors" };
  const HW = S.profile && S.profile.derived && S.profile.derived.hover_w, KG = S.profile && S.profile.used.auw_kg;
  const watts = v => HW ? ` <small class="hint">≈${(v / 100 * HW).toFixed(v / 100 * HW < 1 ? 2 : 1)} W</small>` : "";
  const row = ([h, v, rg, c, key, what, fix]) => { const [w, lv] = size(v);
    return `<div class="prow3 lv-${lv} ${SMP[key] ? "hasm" : ""}"><div class="ph3"><b>${h}</b><span class="badge lv-${lv}">${w}</span></div>
      <div class="ptrack"><i style="width:${Math.max(1, v / mx * 100)}%;background:${css(c)}"></i></div><div class="pv3">${v.toFixed(v < 1 ? 2 : 1)}%${watts(v)}</div>
      <div class="pt3">${what} <span class="hint">${fix}</span></div>
      ${SMP[key] ? `<div class="pm3"><div class="pmini" id="pm_${key}"></div><div class="pmcap hint">${cap[key]} · <span class="optk">━ battery-optimal</span> · shaded = wasted</div></div>` : ""}</div>`; };
  const tech = `${e ? `Electrical model fitted to this flight: duty = speed/${e.full_hz.toFixed(0)} Hz + resistive term (R² ${e.r2}); resistive share at hover ${(e.ir * 100).toFixed(0)}%. ` : ""}`
    + `Twitching = command swings between 3 and 80 Hz with the sticks still; buzzing = above 80 Hz. Ranges across the flight: ${e ? `twitching ${e.corr_rng[0].toFixed(1)}–${e.corr_rng[1].toFixed(1)}%, buzzing ${e.vib_rng[0].toFixed(1)}–${e.vib_rng[1].toFixed(1)}%. ` : ""}`
    + `Uneven load comes from eRPM: prop power ∝ speed³ and thrust ∝ speed², so unequal speeds cost power at the same thrust. Speed differences needed for the moves themselves (+${P.manoeuvre.toFixed(2)}%) are not a loss and not counted.`
    + `${p.sat_hi > 0.05 ? ` A motor was at 100% for ${p.sat_hi.toFixed(1)}% of the time.` : ""} No current sensor needed: everything comes from motor commands and eRPM.`;
  return `<section class="pwr pwr2" id="hpwr">
    <div class="phead lv-${tlv}"><span class="pic">🔋</span><div><div class="pbig">About <b>${total.toFixed(1)}%</b> of the battery is wasted <span class="badge lv-${tlv}">${tw}</span></div>
      <div class="hint">Energy that turns into heat instead of keeping the quad in the air, measured while the sticks were still.${HW ? ` At ${Math.round(KG * 1000)} g this quad needs ≈${HW} W to hover, so that's <b>≈${(total / 100 * HW).toFixed(1)} W</b> of heat <span data-tip="auw">(weight: Quad profile)</span>.` : ""} ${total < 1.5 ? "Nothing to chase here." : "This is the part you can win back."}</div></div>
      <div class="pfacts">${p.tw ? `<span data-tip="pw_tw"><b>${p.tw.toFixed(1)}×</b> more thrust than its weight${p.max_how === "extrapolated" ? " (estimated)" : ""}</span>` : ""}
        <span data-tip="pw_hover">hovers at <b>${p.hover_cmd.toFixed(0)}%</b> motor command</span></div></div>
    <div class="prows">${rows.map(row).join("")}</div>
    <details class="pdet" id="pwrDet"><summary class="hint">How this is measured · which motor swings cost the most</summary>
      <div class="hint">${tech}</div><div id="pwrSpec" class="pwrspec"></div></details></section>`;
}
// tiny trace clips: the real motor command against the line a battery-optimal quad would follow, waste shaded between
function drawPowerSamples(p) {
  const S_ = p && p.samples; if (!S_) return;
  const opt = css("--good"), mcfg = { staticPlot: true, displayModeBar: false, responsive: true };
  const mini = (id, tr, xt) => { if (!$(id)) return;
    const L = base({ margin: { l: 30, r: 6, t: 4, b: 18 }, showlegend: false, hovermode: false }); delete L._ax;
    L.xaxis.tickfont = L.yaxis.tickfont = { size: 9 }; L.xaxis.ticksuffix = xt; L.yaxis.ticksuffix = "%"; L.yaxis.nticks = 4; L.xaxis.nticks = 5;
    Plotly.react(id, tr, L, mcfg); };
  const xs = (n, dt, sc) => Array.from({ length: n }, (_, k) => +(k * dt * sc).toFixed(3));
  const pair = (o, col, sc, xt) => { const x = xs(o.cmd.length, o.dt, sc);
    return [[{ type: "scatter", mode: "lines", x, y: o.opt, line: { color: opt, width: 2.4 } },
             { type: "scatter", mode: "lines", x, y: o.cmd, line: { color: col, width: 1.1 }, fill: "tonexty", fillcolor: rgba(col, 0.38) }], xt]; };
  if (S_.twitch) { const [tr, xt] = pair(S_.twitch, css("--warning"), 1, " s"); mini("pm_twitch", tr, xt); }
  if (S_.buzz) { const [tr, xt] = pair(S_.buzz, css("--serious"), 1000, " ms"); mini("pm_buzz", tr, xt); }
  if (S_.uneven) { const u = S_.uneven, x = xs(u.opt.length, u.dt, 1), tr = [];
    u.motors.forEach((m, i) => { const col = css(MC[i]);
      tr.push({ type: "scatter", mode: "lines", x, y: u.opt, line: { width: 0 }, hoverinfo: "skip" },
              { type: "scatter", mode: "lines", x, y: m, line: { color: col, width: 1.6 }, fill: "tonexty", fillcolor: rgba(col, 0.22) }); });
    tr.push({ type: "scatter", mode: "lines", x, y: u.opt, line: { color: opt, width: 2.6, dash: "dash" } });
    mini("pm_uneven", tr, " s"); }
}
function drawPowerSpec(p) {
  const s = p && p.elec && p.elec.spec; if (!s || !$("pwrSpec")) return;
  const cum = []; let acc = 0; s.pct.forEach(v => { acc += Math.max(0, v); cum.push(acc); });
  const tr = [{ type: "bar", x: s.f, y: s.pct.map(v => Math.max(0, v)), name: "cost per bin", marker: { color: css("--warning") }, hovertemplate: "%{x:.0f} Hz: +%{y:.2f}%<extra></extra>" },
    { type: "scatter", mode: "lines", x: s.f, y: cum, yaxis: "y2", name: "cumulative", line: { color: css("--ink2"), width: 1.5 }, hovertemplate: "up to %{x:.0f} Hz: +%{y:.1f}%<extra></extra>" }];
  const L = base({ margin: { l: 44, r: 44, t: 26, b: 34 }, showlegend: false, bargap: 0, dragmode: false }), ax = L._ax; delete L._ax;
  Object.assign(L, { xaxis: { ...ax, type: "log", title: { text: "frequency of the command swing (Hz)", font: { size: 10 } }, fixedrange: true },
    yaxis: { ...ax, title: { text: "% battery per bin", font: { size: 10 } }, fixedrange: true, rangemode: "tozero" },
    yaxis2: { ...ax, overlaying: "y", side: "right", showgrid: false, fixedrange: true, rangemode: "tozero", title: { text: "cumulative %", font: { size: 10 } } },
    annotations: [{ text: `Which swings cost battery${s.peak_f ? ` · biggest: ${s.peak_f.toFixed(0)} Hz (${s.peak_what})` : ""}`, xref: "paper", yref: "paper", x: 0, y: 1.02, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 11, color: css("--ink") } }],
    shapes: s.peak_f ? [{ type: "line", xref: "x", yref: "paper", x0: s.peak_f, x1: s.peak_f, y0: 0, y1: 1, line: { color: css("--serious"), dash: "dot", width: 1.2 } }] : [] });
  Plotly.react("pwrSpec", tr, L, { ...CFG, displayModeBar: false });
}

async function renderHealth() {
  S.hthr = S.hthr || [0, 100];
  const d = await api("motors", { ...rng(), thr_min: S.hthr[0], thr_max: S.hthr[1] });
  if (S.tab !== "health") return;
  const hctl = tg("Throttle band", `<span class="seg" id="hPre">${[["all", 0, 100], ["cruise", 15, 45], ["punch", 45, 100]].map(([n, a, b]) => `<button data-a="${a}" data-b="${b}" class="${S.hthr[0] === a && S.hthr[1] === b ? "on" : ""}">${n}</button>`).join("")}</span>
    <label class="ctl"><input id="hT0" type="number" min="0" max="100" step="5" value="${S.hthr[0]}" style="width:52px"> – <input id="hT1" type="number" min="0" max="100" step="5" value="${S.hthr[1]}" style="width:52px"> %</label>`, { tip: "h_part" });
  const hhint = `<span class="hint">${S.range ? "within the selected range" : "whole log · use Select range on the timeline to pick a part"}${d.windows ? ` · ${d.windows} one-second windows` : ""}</span>`;
  const bindH = () => { const go = (a, b) => { S.hthr = [a, b]; render(); };
    $("hT0").onchange = $("hT1").onchange = () => go(+$("hT0").value, +$("hT1").value);
    $("hPre").onclick = e => { const b = e.target.closest("button"); if (b) go(+b.dataset.a, +b.dataset.b); }; };
  if (d.error) { $("controls").innerHTML = tbar(`<h3>Motor health</h3><span class="hint">${esc(d.error)}</span>`, [hctl]); bindH(); $("dash").innerHTML = ""; Plotly.purge("main"); $("findings").innerHTML = ""; return; }
  const nm = d.motors.length, mc = m => css(MC[m]), bl = S.profile ? S.profile.used.blades : 3, bk = String(bl === 2 ? 2 : 3);
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_health">Motor health</h3>${hhint}`,
    [hctl, tg("Quad map", `<span class="chips" id="hlive">${chip("live", "Follow playback", S.healthLive, { tip: "live" })}</span>`)]);
  $("hlive").onclick = () => { S.healthLive = !S.healthLive; render(); }; bindH();
  $("dash").innerHTML = healthVerdicts(d, bk) + (nm === 4 ? `<div class="hgrid" id="hmap">${[0, 1, 2, 3].map(m => motorCard(d, m, bk)).join("")}
      <div class="hmap">${quadMap(d)}<div class="hint" style="text-align:center">ring = once-per-turn vibration (green / amber / red) · CG dot leans to the heavier side${S.healthLive ? " · press ▶ to watch it live" : ""}</div></div></div>`
    : `<div class="dashgrid" style="padding:0" id="hmap">${[...Array(nm).keys()].map(m => motorCard(d, m, bk).replace(/style="grid-area:m\d"/, "")).join("")}</div>`);
  $("dash").innerHTML += powerPanel(d.power);
  if ($("pwrDet")) $("pwrDet").ontoggle = () => $("pwrDet").open && drawPowerSpec(d.power);
  drawPowerSamples(d.power);
  $("dash").querySelectorAll(".hv[data-go]").forEach(b => b.onclick = () => { const el = $(b.dataset.go); el && el.scrollIntoView({ behavior: "smooth", block: "start" }); });
  // two compact detail charts: 1× vs speed, and 1× relative through the flight (time axis, synced)
  const tr = [];
  for (let m = 0; m < nm; m++) {
    tr.push(line(d.speed_bins, d.vs_speed["1"][m], d.motors[m], mc(m), { type: "scatter", mode: "lines", line: { width: 2, shape: "spline", smoothing: 0.6 }, legendgroup: `m${m}`, connectgaps: true,
      hovertemplate: `%{x:.0f} Hz: %{y:.1f} °/s<extra>${d.motors[m]} 1×</extra>` }));
    tr.push(line(d.time.t, d.time.rel[m], d.motors[m], mc(m), { type: "scatter", xaxis: "x2", yaxis: "y2", legendgroup: `m${m}`, showlegend: false, connectgaps: false,
      hovertemplate: `t %{x:.0f}s: %{y:.2f}×<extra>${d.motors[m]} vs others</extra>` }));
  }
  tr.push(line([d.speed_bins[0], d.speed_bins.at(-1)], [d.floor, d.floor], "noise floor", css("--muted"), { type: "scatter", line: { dash: "dot", width: 1 }, hoverinfo: "skip" }));
  if (d.events.length) tr.push({ type: "scatter", mode: "markers", x: d.events.map(e => e.t), y: d.events.map(() => 0.1), xaxis: "x2", yaxis: "y2", name: "RPM dropout",
    marker: { symbol: "x", size: 10, color: css("--serious") }, hovertemplate: d.events.map(e => `M${e.motor + 1} dropout ${e.ms} ms<extra></extra>`) });
  const L = base({ hovermode: "closest", dragmode: "pan", margin: { l: 46, r: 10, t: 26, b: 36 } }), ax = L._ax; delete L._ax;
  setTimeAxes([{ axis: "xaxis2", dim: "x", pair: "yaxis2" }]);
  const t = x => ({ text: x, font: { size: 11 } });
  Object.assign(L, {
    xaxis: { ...ax, domain: [0, 0.44], anchor: "y", title: t("motor speed (Hz) · 5–95% of flight"), fixedrange: true, ...(d.speed_p ? { range: d.speed_p } : {}) }, yaxis: { ...ax, title: t("1× vibration (°/s)"), rangemode: "tozero", fixedrange: true },
    xaxis2: { ...ax, domain: [0.52, 1], anchor: "y2", title: t("flight time (s)"), uirevision: ++TSY.rev, ...(S.view ? { range: S.view } : {}) },
    yaxis2: { ...ax, anchor: "x2", title: t("× other motors"), rangemode: "tozero", fixedrange: true },
  });
  const sub = (x, text) => ({ text, xref: "paper", yref: "paper", x, y: 1, xanchor: "left", yanchor: "bottom", showarrow: false, font: { size: 12, color: css("--ink") } });
  L.annotations = [sub(0, "Once-per-turn vibration vs motor speed"), sub(0.52, "Once-per-turn vibration through the flight (1 = same as others)")];
  L.shapes = [{ type: "line", xref: "x2 domain", yref: "y2", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), width: 1, dash: "dash" } },
              { type: "line", xref: "x2 domain", yref: "y2", x0: 0, x1: 1, y0: 1.6, y1: 1.6, line: { color: css("--warning"), width: 1, dash: "dot" } }];
  // the detailed charts and the full findings list stay folded away unless asked for
  S.hDetail = S.hDetail ?? store.get("hDetail", false);
  $("main").style.height = "270px"; $("main").style.display = S.hDetail ? "" : "none";
  if (S.hDetail) await Plotly.react("main", tr, L, CFG); else Plotly.purge("main");
  $("findings").innerHTML = `<button class="btn sm ghost hdet" id="hDet">${S.hDetail ? "▴ Hide" : "▾ Show"} vibration charts &amp; all ${d.findings.length} findings</button>` + (S.hDetail ? `<div class="fh">All findings</div>${findingsHTML(d.findings)}` : "");
  if (!S.hDetail) S._flist.push(...d.findings);
  $("hDet").onclick = () => { S.hDetail = !S.hDetail; store.set("hDetail", S.hDetail); render(); };
  if (typeof PB !== "undefined") { PB.hooks.health = t => healthLive(d, t); PB.dirty = true; }
}

// ---------- PROPWASH ----------
// rating bands for "wobble after a throttle chop, × calm flight" (same limits as flight.PW_CLASSES)
const PWC = [[1.5, "excellent", "--good"], [2.5, "good", "--good"], [3.5, "ok", "--warning"], [5, "bad", "--serious"], [8, "terrible", "--serious"]];
const pwInfo = cls => PWC.find(c => c[1] === cls) || PWC[2];
const PWTXT = { excellent: "Locked in: barely any wobble after the chop.", good: "Small, quickly damped wobble. Most pilots won't notice.",
  ok: "Visible wobble for a moment. Worth improving if you fly low-throttle moves a lot.", bad: "Clear propwash oscillation: it shows in the video and costs precision.",
  terrible: "Strong, long-lasting oscillation: fix before tuning anything else." };
S.pwSpeed = store.get("pwSpeed2", 1); S.pwWob = store.get("pwWob", 2); S.pwShk = store.get("pwShk", 30);

// detection settings (same defaults as flight.PW_DEFAULTS)
const PW_DEF = { chop: 120, drop: 0, win: 0.6, stick: 300, skip: 80, flo: 15, fhi: 100, minev: 3 };
const PW_PRE = { "more chops": { chop: 80, drop: 0, stick: 500, skip: 60 }, default: { chop: 120, drop: 0, stick: 300, skip: 80 }, "hard chops only": { chop: 200, drop: 25, stick: 250, skip: 100 } };
S.pw = { ...PW_DEF, ...store.get("pw.det", {}) };
const PW_SL = [  // key, label, min, max, step, unit, tip text
  ["chop", "Chop speed ≥", 40, 400, 10, " %/s", "How fast the throttle must fall to count as a chop (throttle smoothed over 50 ms)."],
  ["drop", "Chop depth ≥", 0, 60, 5, " %", "Minimum total throttle lost in the chop (0 = any). Raise it to ignore small blips."],
  ["win", "Look window", 0.3, 1.5, 0.05, " s", "How long after the chop the wobble is measured."],
  ["stick", "Sticks still below", 100, 1500, 50, " °/s²", "Stick (setpoint) acceleration above this counts as the pilot moving: those moments are not scored."],
  ["skip", "Skip after a move", 0, 250, 10, " ms", "Extra time ignored after every stick move, so the tune's response to the move isn't mistaken for propwash."],
  ["flo", "Wobble band from", 5, 60, 1, " Hz", "Lower edge of the tracking-error band scored as wobble."],
  ["fhi", "Wobble band to", 40, 200, 5, " Hz", "Upper edge of the band."],
  ["minev", "Chops needed to rate", 1, 8, 1, "", "Fewer usable chops than this gives an 'too few to rate' note instead of a rating."]];
const pwFmt = (k, v) => (k === "win" ? (+v).toFixed(2) : String(+v)) + PW_SL.find(x => x[0] === k)[5];

async function renderPropwash() {
  const P = S.pw, q = Object.fromEntries(Object.entries(P).filter(([k, v]) => v !== PW_DEF[k]));
  const [d, thr] = await Promise.all([api("propwash", { ...rng(), ...q }), api("series", { fields: "throttle%", n: 3000, ...rng() })]);
  if (S.tab !== "propwash") return;
  const preOn = n => Object.entries(PW_PRE[n]).every(([k, v]) => P[k] === v) && ["win", "flo", "fhi", "minev"].every(k => P[k] === PW_DEF[k]);
  const changed = Object.keys(q).length;
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_propwash">Propwash</h3><span class="hint">${S.range ? "selected part of the flight" : "whole flight"} ·
    each dot = one throttle chop · height = wobble afterwards vs calm flight · <b>hover a dot</b> to replay it on the quad · click to jump there</span>`, [
    tg("Detection", `<span class="seg" id="pwPre">${Object.keys(PW_PRE).map(n => `<button data-p="${n}" class="${preOn(n) ? "on" : ""}">${n}</button>`).join("")}</span>
      ${tpop("pwAdv", `⚙ Fine-tune${changed ? ` <span class="cnt" style="background:color-mix(in srgb,var(--accent) 25%,transparent);color:var(--accent)">${changed}</span>` : ""}`, `<div class="ph">What counts as a propwash event</div>
        ${PW_SL.map(([k, l, a, b, st, u, tip]) => prow(`<span title="${tip}">${l}</span>`, `<input type="range" data-k="${k}" min="${a}" max="${b}" step="${st}" value="${P[k]}"><b id="pwv_${k}">${pwFmt(k, P[k])}</b>`)).join("")}
        <div class="pfoot"><span class="hint">${d.events ? d.events.length : 0} chops scored · ${d.skipped || 0} skipped (sticks busy)</span><button class="btn sm ghost" id="pwReset" ${changed ? "" : "disabled"}>Reset defaults</button></div>`)}`),
    tg("Replay", `<select id="pwSpd" data-tip="pw_speed">${[[1, "1× real time"], [0.5, "0.5×"], [0.25, "0.25× slow-mo"], [0.1, "0.1×"]].map(([v, l]) => `<option value="${v}" ${v === S.pwSpeed ? "selected" : ""}>${l}</option>`).join("")}</select>
      <label class="ctl" data-tip="v_wobble">Wobble × <input id="pwWob" type="range" min="0" max="8" step="0.5" value="${S.pwWob}"><b id="pwWobV">${S.pwWob}</b></label>
      <label class="ctl" data-tip="v_shake">Vibration × <input id="pwShk" type="range" min="0" max="120" step="5" value="${S.pwShk}"><b id="pwShkV">${S.pwShk}</b></label>`)]);
  $("pwSpd").onchange = e => { S.pwSpeed = +e.target.value; store.set("pwSpeed2", S.pwSpeed); };
  for (const [id, k] of [["pwWob", "pwWob"], ["pwShk", "pwShk"]]) $(id).oninput = e => { S[k] = +e.target.value; $(id + "V").textContent = S[k]; store.set(k, S[k]); };
  const savePw = () => { store.set("pw.det", S.pw); render(); };
  $("pwPre").onclick = e => { const b = e.target.closest("[data-p]"); if (b) { S.pw = { ...PW_DEF, ...PW_PRE[b.dataset.p] }; savePw(); } };
  $("pwReset").onclick = () => { S.pw = { ...PW_DEF }; savePw(); };
  $("controls").querySelectorAll('#pwAdv input[type=range]').forEach(el => {
    el.oninput = () => { $("pwv_" + el.dataset.k).textContent = pwFmt(el.dataset.k, el.value); };
    el.onchange = () => { S.pw[el.dataset.k] = +el.value; if (S.pw.fhi < S.pw.flo + 5) S.pw.fhi = S.pw.flo + 5; savePw(); }; });
  if (d.error) { Plotly.purge("main"); $("findings").innerHTML = `<div class="hint">${esc(d.error)}</div>`; return; }
  const ev = d.events, ymax = Math.max(6, ...ev.map(e => e.ratio + 0.8));
  const tr = [line(thr.t, thr["throttle%"], "throttle", css("--muted"), { type: "scatter", yaxis: "y2", line: { width: 1 }, fill: "tozeroy", fillcolor: rgba(css("--muted").length === 7 ? css("--muted") : "#898781", .10), hoverinfo: "skip" }),
    { type: "scatter", mode: "markers", x: ev.map(e => e.t), y: ev.map(e => e.ratio), name: "throttle chop", hoverinfo: "none",
      marker: { size: 15, color: ev.map(e => css(pwInfo(e.cls)[2])), line: { color: css("--ink"), width: 1.5 } } }];
  const L = base({ hovermode: "closest", dragmode: "pan", margin: { l: 50, r: 50, t: 20, b: 36 }, showlegend: false }), ax = L._ax; delete L._ax;
  Object.assign(L, {
    xaxis: { ...ax, title: { text: "flight time (s)", font: { size: 11 } }, uirevision: ++TSY.rev, ...(S.view ? { range: S.view } : {}) },
    yaxis: { ...ax, title: { text: "wobble after chop (× calm flight)", font: { size: 11 } }, range: [0, ymax], fixedrange: true },
    yaxis2: { ...ax, overlaying: "y", side: "right", range: [0, 100], showgrid: false, title: { text: "throttle %", font: { size: 11 } }, fixedrange: true },
  });
  // background rating bands with labels: the chart reads as good / ok / bad at a glance
  let lo = 0; L.shapes = []; L.annotations = [];
  for (const [hi, name, cv] of PWC) {
    const top = Math.min(hi, ymax); if (lo >= ymax) break;
    L.shapes.push({ type: "rect", xref: "x domain", yref: "y", x0: 0, x1: 1, y0: lo, y1: top, fillcolor: rgba(css(cv), name === "excellent" ? 0.12 : name === "terrible" ? 0.2 : 0.08), line: { width: 0 }, layer: "below" });
    L.annotations.push({ text: name.toUpperCase(), xref: "x domain", yref: "y", x: 0.005, y: (lo + top) / 2, xanchor: "left", showarrow: false, font: { size: 11, color: css(cv) }, opacity: 0.9 });
    lo = hi;
  }
  if (typeof PB !== "undefined" && PB.d) L.shapes.push(...phShapes({ _time: [{ axis: "xaxis", dim: "x", pair: "yaxis" }] }, PB.t));
  setTimeAxes([{ axis: "xaxis", dim: "x", pair: "yaxis" }]);
  fitMain(460);
  await Plotly.react("main", tr, L, CFG);
  const gd = $("main"); gd._pwEvents = ev;
  if (!hooked(gd, "_pw")) { markHooked(gd, "_pw");
    gd.on("plotly_click", e => { const p = e.points && e.points[0]; if (S.tab !== "propwash" || !p || p.curveNumber !== 1) return; hidePwTip(); syncView([p.x - 1.5, p.x + 2.5], {}); });
    gd.on("plotly_hover", e => { const p = e.points && e.points[0]; if (S.tab !== "propwash" || !p || p.curveNumber !== 1) return; showPwTip(gd._pwEvents[p.pointIndex], p); });
    gd.on("plotly_unhover", () => hidePwTip()); }
  const counts = PWC.map(([, n]) => [n, ev.filter(e => e.cls === n).length]).filter(([, k]) => k);
  $("findings").innerHTML = (ev.length ? `<div class="fh">Chops by rating</div><div class="pwcounts">${counts.map(([n, k]) => `<span class="pwc" style="--c:var(${pwInfo(n)[2]})"><b>${k}</b> ${n}</span>`).join("")}</div>` : "") +
    findingsHTML(d.findings, `<div class="fh">Propwash, delay &amp; tracking</div>`);
}

// ---- hover replay: the quad re-flies that chop in a loop, at true scale, with the stats of that incident ----
const PWT = { ev: null, raf: 0, t: 0, last: 0, blade: [0, 0, 0, 0] };
function showPwTip(e, pt) {
  if (!PB.d || !e) return;
  const gd = $("main"), card = document.querySelector(".maincard"), fl = gd._fullLayout, sz = fl._size;
  let tip = $("pwtip");
  if (!tip) { tip = document.createElement("div"); tip.id = "pwtip"; card.appendChild(tip); }
  const cb = card.getBoundingClientRect(), b = gd.getBoundingClientRect();
  const W = Math.round(Math.min(cb.width - 20, Math.max(540, sz.w * 0.6))), H = Math.round(Math.max(380, sz.h * 0.92)), px = fl.xaxis.l2p(e.t) + sz.l;
  const gx = b.left - cb.left, onRight = px < sz.l + sz.w / 2;   // open on the side away from the hovered dot
  const left = Math.max(6, Math.min(cb.width - W - 6, onRight ? gx + px + 24 : gx + px - W - 24));
  Object.assign(tip.style, { left: left + "px", top: (b.top - cb.top + sz.t + 4) + "px", width: W + "px", height: H + "px" });
  const [, name, cv] = pwInfo(e.cls);
  tip.innerHTML = `<div class="pwh"><span class="pwbadge" style="--c:var(${cv})">${name.toUpperCase()}</span><b>Throttle chop at ${e.t.toFixed(1)} s</b><span class="hint">replay ${S.pwSpeed}× speed · wobble ×${S.pwWob}, vibration ×${S.pwShk} (set under Replay)</span></div>
    <div class="pwbody"><canvas id="pwcv"></canvas><div class="pwstats">
      <div class="big" style="color:var(${cv})">${e.ratio.toFixed(1)}×<small> calm wobble</small></div>
      <div class="hint">${PWTXT[e.cls]}</div>
      <dl><dt>throttle</dt><dd>${e.thr_from}% → ${e.thr_to}%</dd><dt>peak error</dt><dd>${e.err_peak} °/s</dd>
        <dt>wobble freq.</dt><dd>≈ ${e.freq} Hz</dd><dt>settles in</dt><dd>${e.settle_ms < 50 ? "< 50" : e.settle_ms} ms</dd><dt>worst axis</dt><dd>${AX[e.axis]}</dd></dl>
      <div class="pwscale">${PWC.map(([hi, n, c]) => `<span class="${n === e.cls ? "on" : ""}" style="--c:var(${c})">${n}<small>&lt;${hi === 8 ? "∞" : hi}×</small></span>`).join("")}</div>
    </div></div><canvas id="pwtr"></canvas>`;
  tip.hidden = false;
  PWT.ev = e; PWT.t = e.t - 0.3; PWT.last = performance.now();
  cancelAnimationFrame(PWT.raf);
  const loop = now => {
    if (!PWT.ev || tip.hidden) return;
    const dt = Math.min(0.1, (now - PWT.last) / 1000) * S.pwSpeed; PWT.last = now;
    const t0 = PWT.ev.t - 0.3, t1 = PWT.ev.t + 0.9;
    PWT.t += dt; if (PWT.t > t1) PWT.t = t0;
    const o = { src: "filt", cam: "heading", wobble: S.pwWob, shake: S.pwShk, az: VDEF.az, el: 0.38, dist: 4.2, blade: PWT.blade, spin: true, dt, hudText: false,
      show: { body: true, props: true, labels: false, thrust: true, grid: true, axes: false, hud: false, acc: false, legend: false } };
    drawViewer($("pwcv"), PWT.t, o);
    drawPwTrace($("pwtr"), t0, t1, PWT.t, PWT.ev);
    PWT.raf = requestAnimationFrame(loop);
  };
  PWT.raf = requestAnimationFrame(loop);
}
function hidePwTip() { PWT.ev = null; cancelAnimationFrame(PWT.raf); if ($("pwtip")) $("pwtip").hidden = true; }
// roll / pitch tracking error (setpoint − gyro) across the replay window, with the replay cursor
function drawPwTrace(cv, t0, t1, t, e) {
  if (!cv) return;
  const dpr = devicePixelRatio || 1, W = cv.clientWidth, H = cv.clientHeight;
  if (cv.width !== W * dpr || cv.height !== H * dpr) { cv.width = W * dpr; cv.height = H * dpr; }
  const c = cv.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
  const d = PB.d, i0 = idxAt(t0), i1 = idxAt(t1), X = tt => 30 + (tt - t0) / (t1 - t0) * (W - 36);
  let m = 10; for (let a = 0; a < 2; a++) for (let i = i0; i <= i1; i++) m = Math.max(m, Math.abs(d.ch[`sp[${a}]`][i] - d.ch[`gyro[${a}]`][i]));
  const Y = v => H / 2 - v / m * (H / 2 - 6);
  c.strokeStyle = css("--grid"); c.beginPath(); c.moveTo(30, H / 2); c.lineTo(W, H / 2); c.stroke();
  c.fillStyle = css("--muted"); c.font = "10px system-ui"; c.fillText(`±${m.toFixed(0)}°/s`, 0, 10); c.fillText("error", 0, H / 2 + 3);
  [0, 1].forEach(a => { c.strokeStyle = axc(a); c.lineWidth = a === e.axis ? 1.8 : 1; c.beginPath();
    for (let i = i0; i <= i1; i++) { const x = X(d.t[i]), y = Y(d.ch[`sp[${a}]`][i] - d.ch[`gyro[${a}]`][i]); i === i0 ? c.moveTo(x, y) : c.lineTo(x, y); } c.stroke(); });
  c.strokeStyle = css("--muted"); c.setLineDash([3, 3]); c.beginPath(); c.moveTo(X(e.t), 0); c.lineTo(X(e.t), H); c.stroke(); c.setLineDash([]);
  c.strokeStyle = css("--accent"); c.lineWidth = 2; c.beginPath(); c.moveTo(X(t), 0); c.lineTo(X(t), H); c.stroke();
  c.fillStyle = css("--ink2"); c.fillText("chop", X(e.t) + 3, H - 3);
}

// ---------- SUMMARY: one-page tuning report ----------
async function renderSummary() {
  $("controls").innerHTML = `<div class="row2"><h3 data-tip="tab_summary">Tuning summary</h3><span class="hint">${S.range ? "selected part of the flight" : "whole flight"} · for ${S.profile ? S.profile.used.inch + "″ " + S.profile.used.blades + "-blade" : ""} props · click a card title to open its tab</span></div>`;
  const safe = p => p.catch(() => ({ error: "not available" }));
  const [nz, st, mo, pt, mt, pw] = await Promise.all([
    api("noise", { ...rng(), res_prom: S.res.prom, res_persist: S.res.persist, res_mask: S.res.mask, res_fmax: resFmax() }),
    api("step", rng()), safe(api("motors", rng())), safe(api("pidterms", rng())), safe(api("motorout", rng())), safe(api("propwash", { ...rng(), ...Object.fromEntries(Object.entries(S.pw).filter(([k, v]) => v !== PW_DEF[k])) }))]);
  if (S.tab !== "summary") return;
  const P = S.profile, e = P.estimate, u = P.used, stats = S.meta.stats, sp = P.params;
  const worst = l => (l || []).reduce((w, f) => LVORD[f.level] < LVORD[w] ? f.level : w, "good");
  const stepF = [0, 1, 2].flatMap(i => (st[i] && st[i].findings) || []);
  const res = (nz.resonances && nz.resonances.list) || [];
  const resLv = worst((nz.findings || []).filter(f => /^R\d+:/.test(f.title)));
  const lv = { noise: worst([...(nz.findings || []), { level: resLv }]), step: worst(stepF), health: mo.error ? null : worst(mo.findings), spectro: resLv,
               pid: pt.error ? null : worst(pt.findings), motors: mt.error ? null : worst(mt.findings), propwash: pw.error ? null : worst(pw.findings) };
  Object.entries(lv).forEach(([t, l]) => l && setTabLevel(t, l));
  // top priorities across all analyses
  const tag = (list, tab) => (list || []).map(f => ({ ...f, tab }));
  const pri = [...tag(nz.findings, "noise"), ...tag(stepF, "step"), ...tag(mo.findings, "health"), ...tag(pt.findings, "pid"), ...tag(mt.findings, "motors"), ...tag(pw.findings, "propwash")]
    .filter(f => f.level === "serious" || f.level === "warning").sort((a, b) => LVORD[a.level] - LVORD[b.level]);
  if (!S.prop && e.needs_confirm) pri.unshift({ level: "warning", title: "Confirm your prop size", tldr: "The analysis scales with it; the estimate isn't certain.", tab: "summary", self: true });
  const TABN = { noise: "Noise", step: "Step response", health: "Motor health", summary: "Profile", pid: "PID terms", motors: "Motors", propwash: "Propwash" };
  const badge = l => `<span class="badge lv-${l}">${LV[l].split(" ")[0]} ${{ good: "Good", info: "Info", warning: "Check", serious: "Fix" }[l]}</span>`;
  const card = (id, title, tab, l, body, tip, cls = "") => `<section class="dcard ${cls} ${l ? "lv-" + l : ""}" ${id ? `id="${id}"` : ""}><div class="dhead"><h3 ${tip ? `data-tip="${tip}"` : ""}>${tab ? `<a data-go="${tab}">${title} →</a>` : title}</h3>${l ? badge(l) : ""}</div>${body}</section>`;
  const flist = (list, n = 3) => { const l = (list || []).slice().sort((a, b) => LVORD[a.level] - LVORD[b.level]).slice(0, n);
    return l.length ? `<ul class="mflist">${l.map(f => `<li class="lv-${f.level}"><span class="lvl">${LV[f.level].split(" ")[0]}</span> ${esc(f.title)}</li>`).join("")}</ul>` : ""; };
  const conf = S.prop ? "good" : e.confidence === "high" ? "good" : e.confidence === "medium" ? "info" : "warning";
  const profile = `<div class="propbig">${u.inch}″ <small>× ${u.blades}-blade</small></div>
    <div class="hint">${S.prop ? "set by you" : `estimated from flight data · ${e.confidence} confidence${e.range ? ` · range ${e.range[0]}–${e.range[1]}″` : ""}`}</div>
    <div class="propedit"><label class="ctl">Prop size <input id="pIn" type="number" min="1" max="15" step="0.5" value="${u.inch}">″</label>
      <span class="seg" id="pBl">${[2, 3, 4].map(b => `<button data-v="${b}" class="${b === u.blades ? "on" : ""}">${b}-blade</button>`).join("")}</span>
      <button class="btn sm" id="pUse">${S.prop ? "Update" : "Confirm"}</button>${S.prop ? `<button class="btn sm ghost" id="pReset">Use estimate</button>` : ""}</div>
    <details ${S.prop ? "" : "open"}><summary class="hint">How it was estimated</summary><ul class="ev">${(e.evidence || []).map(x => `<li>${esc(x)}</li>`).join("")}</ul></details>
    ${auwHTML()}`;
  const vd = { Good: "good", OK: "warning", "Needs work": "serious", "Low confidence": "info" };
  const stepTbl = [0, 1, 2].map(i => { const r = st[i]; if (!r || !r.metrics) return `<tr><td>${AX[i]}</td><td colspan="4" class="hint">not enough stick input</td></tr>`;
    const m = r.metrics, ok = !r.reliability || r.reliability.ok, cl = ok ? "" : ` class="hint" title="not reliable: ${esc((r.reliability.why || []).join("; "))}"`;
    return `<tr${cl}><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td><td>${m.overshoot_pct}%${ok ? "" : "?"}</td><td>${m.rise_ms} ms</td><td>${m.steady}</td><td>${badge(vd[r.verdict])}</td></tr>`; }).join("");
  // filter effectiveness: measured noise removal per stage (raw vs filtered gyro), noise left, delay
  const meter = (label, tip, val, frac, l, txt) => `<div class="meter lv-${l}"><span data-tip="${tip}">${label}</span><span class="mb"><i style="width:${Math.max(3, Math.min(100, frac * 100)).toFixed(0)}%"></i></span><b>${txt}</b></div>`;
  let fe = "";
  if (nz.f) {
    const f = nz.f, nyq = stats.log_rate_hz / 2, M = nz.metrics || {};
    const pw_ = (db, lo, hi) => f.reduce((s, v, i) => v >= lo && v < hi ? s + 10 ** (db[i] / 10) : s, 0);
    const red = (lo, hi) => Math.min(...[0, 1].map(a => 10 * Math.log10(pw_(nz.axes[String(a)].raw, lo, hi) / Math.max(1e-12, pw_(nz.axes[String(a)].filt, lo, hi)))));
    const hf = red(100, nyq), mid = red(50, 100), rpm = M.rpm_min_db, dyn = res.length ? Math.min(...res.map(r => r.filtered_att_db ?? 0)) : null;
    const lvHf = hf >= 20 ? "good" : hf >= 10 ? "info" : "warning", lvRpm = rpm == null ? "info" : rpm >= 15 ? "good" : rpm >= 12 ? "info" : "warning";
    const B = nz.budget || {}, g = B.motor_max, lvG = g == null ? "info" : g < 1 ? "good" : g < 2 ? "info" : "warning", dr = B.d_frac, lvD = dr == null ? "info" : dr < 0.5 ? "good" : dr < 0.65 ? "info" : "warning";
    const dl = nz.delay || {}, lvDel = dl.gyro_ms < sp.gyro_delay_light ? "good" : dl.gyro_ms < sp.gyro_delay_heavy ? "info" : "warning";
    const lvDD = dl.dterm_ms < sp.dterm_delay_light ? "good" : dl.dterm_ms < sp.dterm_delay_heavy ? "info" : "warning";
    fe = `<div class="hint">Measured on this flight: how much each stage removes (raw → filtered gyro, worst of roll/pitch), what is left, and what it costs in delay. Longer bar = better.</div>
      ${meter("Fast noise removed (>100 Hz)", "fe_hf", hf, hf / 40, lvHf, `−${hf.toFixed(0)} dB`)}
      ${meter("RPM notches on motor lines", "fe_rpm", rpm, (rpm || 0) / 30, lvRpm, rpm == null ? "n/a" : `−${rpm.toFixed(0)} dB`)}
      ${meter("Dyn notch at frame resonances", "fe_dyn", dyn, (dyn || 0) / 30, dyn == null ? "good" : dyn >= 12 ? "good" : "warning", dyn == null ? "none to remove" : `−${dyn.toFixed(0)} dB`)}
      ${meter("Mid band removed (50–100 Hz)", "fe_mid", mid, mid / 20, "info", `−${mid.toFixed(1)} dB`)}
      ${meter("Noise reaching the motors (>80 Hz)", "fe_left", g, g == null ? 0 : 1 - Math.min(1, g / 3), lvG, g == null ? "–" : `${g}% RMS`)}
      ${meter("D output above 100 Hz", "fe_d", dr, dr == null ? 0 : 1 - Math.min(1, dr), lvD, dr == null ? "–" : `${Math.round(dr * 100)}%`)}
      ${meter("Gyro filter delay", "delay", dl.gyro_ms, 1 - Math.min(1, dl.gyro_ms / (2 * sp.gyro_delay_heavy)), lvDel, `${dl.gyro_ms} ms`)}
      ${meter("D-term filter delay", "delay", dl.dterm_ms, 1 - Math.min(1, dl.dterm_ms / (2 * sp.dterm_delay_heavy)), lvDD, `${dl.dterm_ms} ms`)}`;
    lv.filters = worst([lvHf, lvRpm, lvG, lvD, lvDel, lvDD].map(level => ({ level })));
  }
  const pwEv = pw.events || [], pwMed = pwEv.length ? pwEv.map(x => x.ratio).sort((a, b) => a - b)[pwEv.length >> 1] : null;
  const lag = pw.axes ? [0, 1, 2].map(i => pw.axes[String(i)].lag_ms) : [];
  const hist = stats.thr_hist_s || [];
  $("dash").innerHTML = `
    <section class="dcard wide pri lv-${pri.length ? worst(pri) : "good"}"><div class="dhead"><h3 data-tip="priorities">Top priorities</h3>${badge(pri.length ? worst(pri) : "good")}</div>
      ${pri.length ? `<ol class="prilist">${pri.slice(0, 7).map(f => `<li class="lv-${f.level}"><span class="lvl">${LV[f.level]}</span> <b>${esc(f.title)}</b> <span class="hint">${esc(f.tldr)}</span> <a data-go="${f.tab}" class="golink">${TABN[f.tab]} →</a></li>`).join("")}</ol>`
                   : `<div class="hint">Nothing needs attention: no warnings in noise, tune, PID terms, motors or propwash.</div>`}</section>
    ${card("profileCard", "Quad profile", null, conf, profile, "prop_chip")}
    ${card("", "Tune (step response)", "step", lv.step, `<div id="dStep" class="mini"></div><table class="cmp"><tr><th></th><th data-tip="overshoot">overshoot</th><th data-tip="rise">rise</th><th data-tip="steady">steady</th><th></th></tr>${stepTbl}</table>
      <div class="hint">rise faster than ~${sp.rise_ok_ms} ms is normal for ${u.inch}″ props${st.pid ? " · suggested PIDs on the Step response tab" : ""}</div>`, "tab_step")}
    ${card("", "Noise, filters &amp; frame resonances", "noise", lv.noise, `<div id="dNoise" class="mini"></div>
      <div class="kv"><span data-tip="delay">filter delay</span><b>gyro ${nz.delay ? nz.delay.gyro_ms : "–"} ms · D-term ${nz.delay ? nz.delay.dterm_ms : "–"} ms</b></div>
      <div class="kv"><span data-tip="res_on">frame resonances (red dashes)</span><b>${res.length ? res.length + " found" : `none up to ${resFmax()} Hz`}</b></div>
      ${res.length ? `<ul class="reslist">${res.slice(0, 4).map(r => `<li><b style="color:var(--serious)">${r.id}</b> ${r.f.toFixed(0)} Hz <span class="hint">+${r.prom_db} dB · ${r.axes.map(a => AX[a].toLowerCase()).join("/")} · ${r.thr[0]}–${r.thr[1]}% thr · filters −${r.filtered_att_db ?? "?"} dB ${r.in_dyn ? "" : "· outside dyn notch!"}</span></li>`).join("")}</ul>` : ""}`, "tab_noise")}
    ${card("", "Filter effectiveness", "noise", lv.filters, fe || `<div class="hint">not available</div>`, "filter_eff")}
    ${card("", "Propwash &amp; latency", "propwash", lv.propwash, pw.error ? `<div class="hint">${esc(pw.error)}</div>` : `
      <div class="kv"><span data-tip="tab_propwash">wobble after throttle chops</span><b>${pwMed != null ? pwMed.toFixed(1) + "× calm (" + pwEv.length + " chops)" : "no chops found"}</b></div>
      <div class="kv"><span data-tip="latency">stick → motion delay</span><b>${lag.map((v, i) => v != null ? `${AX[i][0]} ${v} ms` : "").filter(Boolean).join(" · ")}</b></div>${flist(pw.findings, 2)}`, "tab_propwash")}
    ${card("", "PID terms", "pid", lv.pid, pt.error ? `<div class="hint">${esc(pt.error)}</div>` : `<table class="cmp"><tr><th></th><th>P</th><th>I</th><th>D</th><th>FF</th><th data-tip="i_bias">I holds</th></tr>
      ${[0, 1, 2].map(i => { const a = pt.axes[String(i)], r = a.rms; return `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td><td>${r.P}</td><td>${r.I}</td><td>${r.D}</td><td>${r.FF}</td><td class="${Math.abs(a.i_bias) > 15 ? "high" : ""}">${a.i_bias > 0 ? "+" : ""}${a.i_bias}</td></tr>`; }).join("")}</table>
      <div class="hint">RMS of each term in flight</div>${flist(pt.findings.filter(f => f.level !== "info" || !f.title.startsWith("How hard")), 3)}`, "tab_pid")}
    ${card("", "Motors &amp; props", "health", mo.error ? null : worst([...(mo.findings || []), ...(mt.findings || [])]), mo.error ? `<div class="hint">${esc(mo.error)}</div>` : `<div class="qmini">${quadMap(mo)}</div>
      ${mt.error ? "" : `<div class="kv"><span>hover output</span><b>${mt.hover_motor ?? "–"}%</b></div><div class="kv"><span data-tip="motor_sat">at 100% / at minimum</span><b>${mt.sat_pct}% / ${mt.floor_pct}%</b></div>`}
      ${flist([...(mo.findings || []), ...(mt.findings || [])], 4)}`, "tab_health")}
    ${card("", "Flight", null, null, `<div id="dThr" class="mini sm"></div><div class="kv"><span>duration</span><b>${stats.duration_s} s</b></div><div class="kv"><span>max rotation</span><b>${stats.max_rate_dps} °/s</b></div><div class="kv"><span data-tip="motor_sat">motors maxed out</span><b>${stats["motor_saturation_%"]}%</b></div>`)}`;
  // bindings
  $("dash").querySelectorAll("[data-go]").forEach(a => a.onclick = () => { const t = a.dataset.go; if (t === "summary") return $("profileCard").scrollIntoView({ behavior: "smooth", block: "center" }); document.querySelector(`#tabs [data-tab="${t}"]`).click(); });
  let bl = u.blades;
  $("pBl").onclick = ev => { const v = ev.target.dataset.v; if (!v) return; bl = +v; [...$("pBl").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); };
  $("pUse").onclick = () => setProp({ inch: +$("pIn").value, blades: bl });
  if ($("pReset")) $("pReset").onclick = () => setProp(null);
  bindAuw();
  // mini charts
  const mcfg = { staticPlot: false, displayModeBar: false, responsive: true };
  const mini = (extra = {}) => { const L = base({ margin: { l: 34, r: 6, t: 6, b: 24 }, showlegend: false, hovermode: "x unified", ...extra }); delete L._ax; L.xaxis.tickfont = L.yaxis.tickfont = { size: 9 }; return L; };
  const tr1 = [0, 1, 2].filter(i => st[i] && st[i].median).map(i => line(st.t_ms, st[i].median, AX[i], axc(i), { type: "scatter", line: { width: 2 } }));
  const L1 = mini({ shapes: [{ type: "line", xref: "paper", x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), dash: "dash", width: 1 } }] });
  L1.xaxis.range = [0, 300]; L1.yaxis.range = [0, 1.5]; L1.xaxis.title = { text: "ms", font: { size: 9 }, standoff: 0 };
  Plotly.react("dStep", tr1, L1, mcfg);
  if (nz.f) { const k0 = nz.f.findIndex(v => v >= 10), cut = a => a.slice(k0), fx = cut(nz.f);
    const tr2 = [line(fx, cut(nz.axes["0"].raw), "raw (roll)", css("--muted"), { type: "scatter", line: { width: 1 } }), ...[0, 1, 2].map(i => line(fx, cut(nz.axes[String(i)].filt), AX[i] + " filtered", axc(i), { type: "scatter", line: { width: 1.3 } }))];
    const L2 = mini({ shapes: res.map(r => ({ type: "line", xref: "x", yref: "paper", x0: r.f, x1: r.f, y0: 0, y1: 1, line: { color: RED(), dash: "dash", width: 1 } })) });
    L2.xaxis.title = { text: "Hz", font: { size: 9 }, standoff: 0 }; Plotly.react("dNoise", tr2, L2, mcfg); }
  const L3 = mini({ bargap: 0.15, hovermode: "closest" }); L3.xaxis.title = { text: "throttle %", font: { size: 9 }, standoff: 0 }; L3.yaxis.title = { text: "s", font: { size: 9 }, standoff: 0 };
  Plotly.react("dThr", [{ type: "bar", x: hist.map((_, i) => i * 10 + 5), y: hist, marker: { color: css("--accent") }, hovertemplate: "%{x:.0f}% ±5: %{y:.1f} s<extra></extra>" }], L3, mcfg);
  S._flist.push(...(nz.findings || []), ...stepF, ...(mo.findings || []), ...(pt.findings || []), ...(mt.findings || []), ...(pw.findings || []));
}

// ---------- playback wiring ----------
const PLAYER_TABS = { tracking: { viewer: true, follow: true }, pid: { follow: true }, motors: { follow: true }, health: {} };
function setupPlayer() {
  if (typeof PB === "undefined" || !S.meta) return;
  const cfg = PLAYER_TABS[S.tab] || {};
  PB.hooks = {};
  $("dock").hidden = S.tab === "summary";            // the overview has no time axis: no timeline
  if (S.tab === "summary") { PB.playing = false; unmountViewer(); document.querySelector(".maincard").classList.remove("split"); return; }
  mountPlayer();
  const split = !!(cfg.viewer && S.viewerOn && innerWidth > 1100);   // wide screens: 3D viewer beside the chart
  document.querySelector(".maincard").classList.toggle("split", split);
  cfg.viewer && S.viewerOn ? mountViewer() : unmountViewer();
  ensurePB().then(() => { PB.dirty = true; });
  PB.hooks.chart = playTick;   // timesync.js: centred playhead on every time chart
}

function healthLive(d, t) {
  if (!S.healthLive || !PB.d || !$("hq-r0")) return;
  const i = idxAt(t), T = d.time.t;
  let lo = 0, hi = T.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; T[m] < t ? lo = m + 1 : hi = m; }
  const nm = Math.min(4, PB.d.nm), pc = [...Array(nm).keys()].map(m => PB.d.ch[`m%[${m}]`][i]), mean = pc.reduce((a, b) => a + b, 0) / nm;
  for (let m = 0; m < nm; m++) {
    const v = d.time.rel[m][lo], hz = PB.d.ch[`mHz[${m}]`][i], ring = $(`hq-r${m}`);
    const lv = v == null ? null : v > 2.2 ? "serious" : v > 1.6 ? "warning" : "good";
    ring.setAttribute("stroke", lv ? `var(--${lv})` : "var(--muted)"); ring.setAttribute("stroke-dasharray", v == null ? "4 4" : "");
    ring.setAttribute("stroke-width", v == null ? 1.5 : Math.min(8, 1.5 + 2.5 * v)); ring.setAttribute("r", 26 + Math.min(14, (v || 0) * 5));
    $(`hq-d${m}`).setAttribute("fill", spdColor(hz / PB.d.fmax)); $(`hq-d${m}`).setAttribute("r", 7 + pc[m] / 100 * 9);
    $(`hq-a${m}`).textContent = v == null ? "1× –" : `1× ${v.toFixed(2)}×`;
    $(`hq-b${m}`).textContent = `${hz.toFixed(0)} Hz · ${pc[m] - mean >= 0 ? "+" : ""}${(pc[m] - mean).toFixed(1)}%`;
  }
  if (nm === 4 && $("hq-cg")) { const off = pc.map(p => p - mean), R = (-off[0] - off[1] + off[2] + off[3]) / 4, P = (off[0] - off[1] + off[2] - off[3]) / 4;
    PB.cg = PB.cg || [0, 0]; PB.cg = [PB.cg[0] * 0.9 + R * 0.1, PB.cg[1] * 0.9 + P * 0.1];
    const cx = 150 - Math.max(-60, Math.min(60, PB.cg[0] * 12)), cy = 120 + Math.max(-50, Math.min(50, PB.cg[1] * 12));
    $("hq-cg").setAttribute("cx", cx); $("hq-cg").setAttribute("cy", cy); $("hq-cgt").setAttribute("x", cx); $("hq-cgt").setAttribute("y", cy + 18); }
  $("hq-cap").textContent = `t ${t.toFixed(1)} s · live`;
}

const RENDER = { pidsim: () => renderPidSim(), propwash: renderPropwash, summary: renderSummary, tracking: renderTS, pid: renderTS, motors: renderTS, noise: renderNoise, spectro: renderSpectro, step: renderStep, health: renderHealth };
const render = () => {
  if (!S.meta) return;
  const dash = S.tab === "summary";
  $("dash").hidden = !(dash || S.tab === "health"); if (!$("dash").hidden) $("dash").innerHTML = ""; $("main").style.display = dash ? "none" : "";
  if (dash) $("findings").innerHTML = "";
  S._flist = [];
  document.querySelector(".maincard").classList.toggle("side3", SIDE3.includes(S.tab) && innerWidth > 1000);
  $("findings").style.maxHeight = "";
  renderTips();
  return busy(() => RENDER[S.tab](), TAB_BUSY[S.tab] || "Analysing").then(() => { updateBadge(S.tab, S._flist); if (typeof PB !== "undefined") PB.dirty = true; fitSide(); }).catch(e => console.error(e));
};
const TAB_BUSY = { summary: "Building the summary (all analyses)", tracking: "Loading flight traces", pid: "Analysing the PID terms", motors: "Analysing motor output",
  noise: "Analysing noise and filters", spectro: "Computing spectrograms", step: "Computing step responses", propwash: "Finding throttle chops",
  pidsim: "Preparing the PID simulator", health: "Checking motors and props" };
const LVORD = { serious: 0, warning: 1, info: 2, good: 3 };
const SIDE3 = ["step", "pid", "motors", "propwash", "pidsim"];   // chart 2/3 left, findings 1/3 right
function fitSide() { if (document.querySelector(".maincard.side3")) $("findings").style.maxHeight = $("main").offsetHeight + "px"; }
function updateBadge(tab, list) {
  const b = $("fbadge");
  if (!list || !list.length) { b.hidden = true; return; }
  const n = k => list.filter(f => f.level === k).length, worst = list.reduce((w, f) => LVORD[f.level] < LVORD[w] ? f.level : w, "good");
  b.hidden = false; b.className = `fbadge lv-${worst}`;
  b.innerHTML = [["serious", "✖"], ["warning", "⚠"], ["info", "ℹ"], ["good", "✓"]].filter(([k]) => n(k)).map(([k, i]) => `<span class="lv-${k}">${i} ${n(k)}</span>`).join("") + `<span class="go">findings ↓</span>`;
  setTabLevel(tab, worst);
}
function setTabLevel(tab, lvl) {
  S.tabLevel[tab] = lvl;
  const btn = document.querySelector(`#tabs [data-tab="${tab}"]`); if (!btn) return;
  btn.dataset.lvl = lvl;
}
$("fbadge").onclick = () => { const f = $("findings").hidden || !$("findings").innerHTML ? $("dash") : $("findings"); f.scrollIntoView({ behavior: "smooth", block: "start" }); };

// ---------- per-tab tips (fold-out) ----------
S.tipsOpen = store.get("tipsOpen", false);
function renderTips() {
  const t = (typeof TAB_TIPS !== "undefined" && TAB_TIPS[S.tab]) || [];
  $("tipsBtn").classList.toggle("on", S.tipsOpen);
  $("tips").hidden = !S.tipsOpen || !t.length;
  $("tips").innerHTML = `<div class="tipshead"><b>💡 How to read “${$("tabs").querySelector(".on").textContent}”</b><button class="btn sm ghost" id="tipsClose">✕</button></div><ul>${t.map(x => `<li>${x}</li>`).join("")}</ul>`;
  if ($("tipsClose")) $("tipsClose").onclick = () => { S.tipsOpen = false; store.set("tipsOpen", false); renderTips(); };
}
$("tipsBtn").onclick = () => { S.tipsOpen = !S.tipsOpen; store.set("tipsOpen", S.tipsOpen); renderTips(); };
addEventListener("resize", () => { clearTimeout(S._rs); S._rs = setTimeout(() => S.meta && render(), 250); });

// ---------- overview + sidebar ----------
const renderOverview = () => null;   // the docked playback strip is the only timeline now
function setRange(r) {
  S.range = r;
  $("range").textContent = r ? `window ${r[0].toFixed(1)}–${r[1].toFixed(1)} s (${(r[1] - r[0]).toFixed(1)} s)` : "";
  $("reset").hidden = !r;
  if (typeof PB !== "undefined") PB.dirty = true;
  render();
}

function renderSide(m) {
  const h = m.headers, k = m.key_headers, s = m.stats;
  $("craft").innerHTML = `<div class="name">${esc(h["Craft name"] || "Unnamed craft")}</div>
    <div class="cl">${esc(h["Firmware revision"])}</div><div class="cl">${esc(h["Board information"])}</div>
    <div class="cl">${esc((h["Log start datetime"] || "").replace("T", " ").slice(0, 19))}</div>`;
  const sp = v => String(v ?? "").split(",");
  const dmax = sp(k.d_max), ff = sp(k.ff_weight);
  $("pids").innerHTML = `<tr><th></th>${["P", "I", "D", "Dmax", "FF"].map(c => `<th><span data-tip="${c}">${c}</span></th>`).join("")}</tr>` +
    ["roll", "pitch", "yaw"].map((a, i) => `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td>${sp(k[a + "PID"]).map(v => `<td>${v}</td>`).join("")}<td>${dmax[i] ?? ""}</td><td>${ff[i] ?? ""}</td></tr>`).join("");
  const fmt = (n, v) => ENUMS[n] ? (ENUMS[n][+v] ?? v) : v;
  $("settings").innerHTML = GROUPS.map(([g, keys]) => { const rows = keys.filter(n => n in k);
    return rows.length ? `<dt class="gh">${g}</dt>` + rows.map(n => `<dt${GLOSSARY[n] ? ` data-tip="${n}"` : ""}>${n}</dt><dd>${esc(fmt(n, k[n]))}</dd>`).join("") : ""; }).join("");
  const T = [["duration_s", "Duration", s.duration_s, "s"], ["log_rate_hz", "Log rate", s.log_rate_hz, "Hz"], ["avg_throttle", "Avg throttle", s["avg_throttle_%"], "%"],
             ["max_rate", "Max rate", s.max_rate_dps, "°/s"], ["motor_sat", "Motor sat.", s["motor_saturation_%"], "%"], ["frames", "Frames", (s.frames / 1000).toFixed(0), "k"]];
  $("sumline").innerHTML = T.filter(t => t[2] != null).map(([t, a, v, u]) => `<span data-tip="${t}">${a} <b>${v}</b>${u}</span>`).join("");
}

// ---------- collapsible side panel ----------
function setSide(collapsed) {
  document.querySelector(".layout").classList.toggle("collapsed", collapsed);
  $("sideOpen").hidden = !collapsed; store.set("sideCollapsed", collapsed);
  setTimeout(() => { if ($("main").layout) Plotly.Plots.resize("main"); PB && (PB.dirty = true); }, 60);
}
$("sideToggle").onclick = () => setSide(true);
$("sideOpen").onclick = () => setSide(false);
setSide(store.get("sideCollapsed", false));

// ---------- tooltips (TL;DR + detail) ----------
(() => {
  const tip = $("tip");
  const show = (el, x, y) => { const g = GLOSSARY[el.dataset.tip]; if (!g) return;
    tip.innerHTML = `<b>${esc(g.t)}</b><div class="tl">${esc(g.tl)}</div><div class="d">${esc(g.d)}</div>${g.g ? `<div class="g"><span>Rule of thumb</span> ${esc(g.g)}</div>` : ""}`; tip.hidden = false;
    const r = tip.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    tip.style.left = Math.max(8, Math.min(x + 14, W - r.width - 8)) + "px";
    tip.style.top = (y + 16 + r.height > H ? Math.max(8, y - r.height - 12) : y + 16) + "px"; };
  let cur = null;
  document.addEventListener("mouseover", e => { const el = e.target.closest("[data-tip]"); if (el !== cur) { cur = el; el ? show(el, e.clientX, e.clientY) : (tip.hidden = true); } });
  document.addEventListener("mousemove", e => { if (cur && !tip.hidden) show(cur, e.clientX, e.clientY); });
  document.addEventListener("scroll", () => { tip.hidden = true; cur = null; }, true);
})();

async function loadLog() {
  stopDemo(); S.simAck = null;
  S.range = null; S.meta = null; S.clim = null; S.fr = null; S.nfr = null; setRangeLabel(); Plotly.purge("main"); S._anShown = null;
  S.meta = await busy(() => api("meta"), "Opening the log");
  S.prop = store.get("prop:" + propKey(), null); S.auw = store.get("auw:" + propKey(), null);
  renderSide(S.meta);
  setupPlayer();
  await renderOverview();
  await loadProfile();
  render();
}
// ---------- prop size (drives size-aware analysis) ----------
const propKey = () => (S.meta && S.meta.headers["Craft name"]) || S.file;
async function loadProfile() {
  S.profile = await api("profile");
  const u = S.profile.used, e = S.profile.estimate, chip = $("propChip");
  chip.hidden = false;
  chip.classList.toggle("warn", !S.prop && e.needs_confirm);
  chip.innerHTML = `Props <b>${u.inch}″ × ${u.blades}</b> ${S.prop ? "✓" : e.needs_confirm ? "<span class='q'>est. — confirm?</span>" : "est."} · <b>${Math.round(u.auw_kg * 1000)} g</b>${S.auw ? " ✓" : ""}`;
}
// ---------- all-up weight: estimated from what the log shows, the user can set it like the prop size ----------
function auwHTML() {
  const P = S.profile; if (!P || !P.auw) return "";
  const a = P.auw, u = P.used, D = P.derived || {}, g = Math.round(u.auw_kg * 1000);
  const conf = S.auw ? "set by you" : `estimated · ${a.confidence} confidence · range ${Math.round(a.range[0] * 1000)}–${Math.round(a.range[1] * 1000)} g`;
  const der = [D.hover_w != null ? `<div class="kv"><span data-tip="auw_hoverw">hover power</span><b>≈${D.hover_w} W</b></div>` : "",
    D.twr != null ? `<div class="kv"><span data-tip="auw_twr">max thrust / weight${D.twr_how === "extrapolated" ? " (est.)" : ""}</span><b>${D.twr}×</b></div>` : "",
    D.thrust_g != null ? `<div class="kv"><span data-tip="auw_twr">max thrust per motor</span><b>≈${D.thrust_g} g</b></div>` : ""].join("");
  return `<div class="auwbox"><div class="auwhead"><span class="tl" data-tip="auw">All-up weight (this flight)</span><div class="propbig">${g} <small>g</small></div><div class="hint">${conf}</div></div>
    <div class="propedit"><label class="ctl">AUW <input id="aIn" type="number" min="20" max="5000" step="5" value="${g}"> g</label>
      <button class="btn sm" id="aUse">${S.auw ? "Update" : "Set"}</button>${S.auw ? `<button class="btn sm ghost" id="aReset">Use estimate</button>` : ""}</div>
    ${der}
    <details><summary class="hint">How it was estimated · where it is used</summary><ul class="ev">${(a.evidence || []).map(x => `<li>${esc(x)}</li>`).join("")}
      <li>Used for: hover power and battery waste in watts (Motor health), the "typical quad" comparison in the PID simulator, and the thrust numbers here.</li></ul></details></div>`;
}
function bindAuw() {
  if (!$("aUse")) return;
  $("aUse").onclick = () => { const v = +$("aIn").value; if (v >= 20 && v <= 5000) setAuw(v / 1000); };
  $("aIn").onkeydown = e => { if (e.key === "Enter") $("aUse").click(); };
  if ($("aReset")) $("aReset").onclick = () => setAuw(null);
}
async function setAuw(kg) {
  S.auw = kg; store.set("auw:" + propKey(), kg);
  await loadProfile(); render();
}
$("propChip").onclick = () => { const b = document.querySelector('#tabs [data-tab="summary"]'); if (S.tab !== "summary") b.click(); setTimeout(() => $("profileCard") && $("profileCard").scrollIntoView({ behavior: "smooth", block: "center" }), 400); };
async function setProp(v) {
  S.prop = v; store.set("prop:" + propKey(), v); S._res = {}; S._spec = {};
  await loadProfile(); render();
}

const setRangeLabel = () => { $("range").textContent = ""; $("reset").hidden = true; };

async function loadList(select) {
  const L = await fetch("/api/logs").then(r => r.json());
  $("file").innerHTML = L.map(f => `<option value="${f.name}" data-n="${f.logs}">${f.name} · ${f.size_mb} MB</option>`).join("");
  // first load always opens on the flying quad; a log is decoded only when you pick or drop one
  $("file").insertAdjacentHTML("afterbegin", `<option value="" disabled>${L.length ? "— choose a log —" : "no logs yet"}</option>`);
  if (!select) { $("file").value = ""; return startDemo(); }
  $("file").value = select;
  onFile();
}
function onFile() {
  S.file = $("file").value;
  const n = +$("file").selectedOptions[0].dataset.n || 1;
  $("sub").innerHTML = Array.from({ length: n }, (_, i) => `<option value="${i + 1}">log ${i + 1}/${n}</option>`).join("");
  $("sub").hidden = n < 2; S.sub = 1; loadLog();
}
async function upload(file) {
  const fd = new FormData(); fd.append("file", file);
  API_CACHE.clear();
  const r = await busy(() => fetch("/api/upload", { method: "POST", body: fd }).then(r => r.json()), `Uploading ${file.name}`);
  loadList(r.name);
}

// ---------- wiring ----------
$("file").onchange = onFile;
$("sub").onchange = () => { S.sub = +$("sub").value; loadLog(); };
$("up").onchange = e => e.target.files[0] && upload(e.target.files[0]);
$("reset").onclick = () => setRange(null);
$("tabs").onclick = e => { const t = e.target.dataset.tab; if (!t) return; S.tab = t;
  if (t === "propwash") S.view = null;   // the chop overview needs the whole flight
  [...$("tabs").children].forEach(b => b.classList.toggle("on", b === e.target)); Plotly.purge("main"); S._anShown = null; $("main")._time = []; $("main")._freq = false; $("findings").innerHTML = ""; setupPlayer(); render(); };
document.documentElement.dataset.theme = store.get("theme", "dark");   // dark by default
$("theme").onclick = () => {
  const cur = document.documentElement.dataset.theme || "dark";
  document.documentElement.dataset.theme = cur === "dark" ? "light" : "dark"; store.set("theme", document.documentElement.dataset.theme);
  if (typeof PB !== "undefined") PB.dirty = true;
  if (S.meta) { renderSide(S.meta); renderOverview(); render(); }
};
addEventListener("dragover", e => { e.preventDefault(); $("drop").hidden = false; });
addEventListener("dragleave", e => { if (!e.relatedTarget) $("drop").hidden = true; });
addEventListener("drop", e => { e.preventDefault(); $("drop").hidden = true; e.dataTransfer.files[0] && upload(e.dataTransfer.files[0]); });

// every (re)created main plot gets the synced-time hooks (timesync.js)
const _react = Plotly.react;
// The flag lives on Plotly's own event emitter (gd._ev): Plotly.purge, and react falling back to a full
// redraw, throw that emitter away together with every listener, so the hooks are re-attached exactly then.
function hooked(gd, k) { return !!(gd._ev && gd._ev[k]); }
function markHooked(gd, k) { gd._ev[k] = 1; }
Plotly.react = async (el, ...a) => { const g = await _react(el, ...a), gd = $("main");
  if ((el === "main" || el === gd) && !hooked(gd, "_bbx")) { markHooked(gd, "_bbx"); hookTime(gd); gd.on("plotly_clickannotation", onTitleClick); }
  return g; };

loadList();
