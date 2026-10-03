// Before / after: compare the open flight with another one. Each flight is analysed with its own prop size and weight
// (as set for its craft); the result is what changed in the settings, what changed in the flight, and ideas that come
// from the change itself.
S.cmp = null;   // { name, idx, before: true if the OTHER flight is the earlier one }
const CMP = { key: null, d: null };

function cmpButton() { const b = $("cmpBtn"); if (b) b.hidden = !S.file; setCmpTab(); }
function setCmpTab() {
  const t = document.querySelector('#tabs [data-tab="compare"]'); if (!t) return;
  t.hidden = !S.cmp; t.textContent = S.cmp ? "Compare ⇄" : "Compare";
}

async function openCompareDialog() {
  const L = await fetch("/api/logs").then(r => r.json());
  const opts = L.flatMap(f => Array.from({ length: f.logs || 1 }, (_, i) => ({ name: f.name, idx: i + 1, n: f.logs || 1, mb: f.size_mb })))
    .filter(o => !(o.name === S.file && o.idx === S.sub));
  const el = document.createElement("div"); el.className = "modal-back"; el.id = "cmpDlg";
  const guessBefore = o => (o.name < S.file) || (o.name === S.file && o.idx < S.sub);
  el.innerHTML = `<div class="modal cmpmodal" role="dialog" aria-modal="true" aria-labelledby="cmpT"><button class="btn sm ghost xclose" id="cmpX">✕</button>
    <h2 id="cmpT">Compare with another flight</h2>
    <p class="hint">Open flight: <b>${esc(S.file)}${S.sub > 1 ? ` · log ${S.sub}` : ""}</b>. Pick the flight to compare it with. Each one is analysed with its own prop size and weight.</p>
    <label class="ctl" style="display:flex;gap:8px;align-items:center">Other flight
      <select id="cmpSel" style="flex:1">${opts.length ? opts.map((o, i) => `<option value="${i}">${esc(o.name)}${o.n > 1 ? ` · log ${o.idx}/${o.n}` : ""} · ${o.mb} MB</option>`).join("") : `<option disabled>no other logs: upload one</option>`}</select></label>
    <div style="margin:8px 0"><label class="btn sm ghost">Upload another log…<input id="cmpUp" type="file" accept=".bbl,.bfl,.txt" hidden></label></div>
    <div class="seg" id="cmpOrd" style="margin:6px 0"><button data-v="before">The other flight was <b>before</b> (the open one is the result)</button><button data-v="after">The other flight was <b>after</b></button></div>
    <div class="modal-btns"><button class="btn ghost" id="cmpNo">Cancel</button><button class="btn primary" id="cmpGo" ${opts.length ? "" : "disabled"}>Compare</button></div></div>`;
  document.body.appendChild(el); document.body.classList.add("modal-open");
  let ord = opts.length && !guessBefore(opts[0]) ? "after" : "before";
  const setOrd = v => { ord = v; [...$("cmpOrd").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); };
  setOrd(ord);
  $("cmpSel").onchange = () => setOrd(guessBefore(opts[+$("cmpSel").value]) ? "before" : "after");
  $("cmpOrd").onclick = e => { const b = e.target.closest("button"); if (b) setOrd(b.dataset.v); };
  const close = () => { el.remove(); document.body.classList.remove("modal-open"); };
  $("cmpX").onclick = $("cmpNo").onclick = close;
  el.addEventListener("keydown", e => { if (e.key === "Escape") close(); });
  $("cmpUp").onchange = async e => { const f = e.target.files[0]; if (!f) return; const fd = new FormData(); fd.append("file", f);
    const r = await busy(() => fetch("/api/upload", { method: "POST", body: fd }).then(r => r.json()), `Uploading ${f.name}`);
    close(); startCompare({ name: r.name, idx: 1, before: ord === "before" }); };
  $("cmpGo").onclick = () => { const o = opts[+$("cmpSel").value]; close(); startCompare({ name: o.name, idx: o.idx, before: ord === "before" }); };
}

function startCompare(c) {
  S.cmp = c; CMP.key = null; setCmpTab();
  document.querySelector('#tabs [data-tab="compare"]').click();
}

async function craftOf(name, idx) {   // prop size / weight stored for the other flight's craft
  const m = await fetch(`/api/${encodeURIComponent(name)}/${idx}/meta`).then(r => r.json());
  const k = (m.headers && m.headers["Craft name"]) || name;
  return { prop: store.get("prop:" + k, null), auw: store.get("auw:" + k, null) };
}

async function renderCompare() {
  if (!S.cmp) { $("controls").innerHTML = tbar(`<h3>Compare</h3><span class="hint">no second flight chosen</span>`, []); return; }
  const c = S.cmp, key = [S.file, S.sub, c.name, c.idx, c.before, S.prop && S.prop.inch, S.auw].join("|");
  if (CMP.key !== key) {
    const other = await craftOf(c.name, c.idx), me = { prop: S.prop, auw: S.auw };
    const [A, B] = c.before ? [{ name: c.name, idx: c.idx, ...other }, { name: S.file, idx: S.sub, ...me }] : [{ name: S.file, idx: S.sub, ...me }, { name: c.name, idx: c.idx, ...other }];
    const q = new URLSearchParams(Object.entries({ a: A.name, ai: A.idx, b: B.name, bi: B.idx, pa: A.prop && A.prop.inch, ba: A.prop && A.prop.blades, wa: A.auw,
      pb: B.prop && B.prop.inch, bb: B.prop && B.prop.blades, wb: B.auw }).filter(([, v]) => v != null));
    CMP.d = await fetch(`/api/compare?${q}`).then(r => r.json()); CMP.key = key;
  }
  if (S.tab !== "compare") return;
  const d = CMP.d, openIsB = c.before;
  const nm = x => `${esc(x.name)}${x.idx > 1 ? ` · log ${x.idx}` : ""}`;
  $("controls").innerHTML = tbar(`<h3 data-tip="compare">Before → after</h3><span class="hint"><b>before</b> ${nm(d.a)} (${d.a.dur} s) → <b>after</b> ${nm(d.b)} (${d.b.dur} s)</span>
    <span class="tspacer"></span><button class="btn sm ghost" id="cmpSwap" title="Swap before and after">⇄ swap</button><button class="btn sm ghost" id="cmpOther">Other flight…</button>
    <button class="btn sm ghost" id="cmpEnd">End comparison</button><button class="btn sm" id="cmpPdf">⬇ PDF report</button>`, []);
  $("cmpSwap").onclick = () => { S.cmp.before = !S.cmp.before; render(); };
  $("cmpOther").onclick = openCompareDialog;
  $("cmpEnd").onclick = () => { S.cmp = null; setCmpTab(); document.querySelector('#tabs [data-tab="summary"]').click(); };
  $("cmpPdf").onclick = () => makeReport();
  drawCompareCharts(d);
  const VB = { better: ["good", "better"], worse: ["serious", "worse"], same: ["same", "same"], changed: ["info", "changed"] };
  const fmt = v => v == null ? "–" : Math.abs(v) >= 100 ? Math.round(v) : +(+v).toFixed(2);
  const delta = r => r.a == null || r.b == null ? "" : r.key === "res_open" ? `${r.b - r.a >= 0 ? "+" : ""}${r.b - r.a}` : r.a ? `${r.b >= r.a ? "+" : ""}${Math.round((r.b - r.a) / Math.abs(r.a) * 100)}%` : "";
  const rows = d.rows.map(r => { const [lv, w] = VB[r.verdict] || ["info", "–"];
    return `<tr class="cmprow" data-go="${r.tab}"><td>${esc(r.label)}</td><td>${fmt(r.a)} <small>${esc(r.unit)}</small></td><td><b>${fmt(r.b)}</b> <small>${esc(r.unit)}</small></td><td class="hint">${delta(r)}</td><td>${r.verdict ? `<span class="badge lv-${lv}">${w}</span>` : ""}</td></tr>`; }).join("");
  const ch = d.changed.length ? `<table class="cmp cmpset"><tr><th>setting</th><th>before</th><th>after</th></tr>${d.changed.map(x => `<tr><td><code>${esc(x.key)}</code></td><td>${esc(x.a)}</td><td><b>${esc(x.b)}</b></td></tr>`).join("")}</table>`
    : `<div class="hint">No tuning setting differs between the two logs' headers.</div>`;
  const ideas = d.ideas.map(i => `<div class="pitem lv-${i.level}"><span class="pdot" style="background:${LVC(i.level)}"></span><div class="pbody"><div class="ptitle">${esc(i.title)}</div><div class="pwhy">${esc(i.text)}</div></div></div>`).join("");
  const hl = d.n_better > d.n_worse * 2 ? "good" : d.n_worse > d.n_better * 2 ? "serious" : d.n_better || d.n_worse ? "warning" : "info";
  $("findings").innerHTML = `${d.same_craft ? "" : `<div class="pnotes">⚠ These logs come from different craft (“${esc(d.a.craft)}” vs “${esc(d.b.craft)}”): the comparison still runs, but differences are mostly the hardware.</div>`}
    <div class="cmphead lv-${hl}"><div class="pbig">${esc(d.headline)}</div><div class="hint">${d.n_better} measures better · ${d.n_worse} worse · the rest about the same (changes under ~10–20% count as the same; flights are never identical).</div></div>
    <div class="cmpgrid"><div><div class="fh">What changed in the settings</div>${ch}
        <div class="fh" style="margin-top:12px">What the change did: ideas for the next step</div><div class="pcol">${ideas}</div>
        ${openIsB ? `<div class="toplan"><span class="hint">The open flight is the “after”: its Tune plan continues from here.</span><button class="btn sm" data-goplan>Open the Tune plan →</button></div>` : ""}</div>
      <div><div class="fh">What changed in the flight</div><table class="cmp cmptab"><tr><th></th><th>before</th><th>after</th><th></th><th></th></tr>${rows}</table>
        <div class="hint">Click a row to open that tab for the open flight.</div></div></div>`;
  $("findings").querySelectorAll(".cmprow").forEach(r => r.onclick = () => document.querySelector(`#tabs [data-tab="${r.dataset.go}"]`).click());
  const gp = $("findings").querySelector("[data-goplan]"); if (gp) gp.onclick = () => document.querySelector('#tabs [data-tab="plan"]').click();
}

async function drawCompareCharts(d) {
  const O = d.overlay || {}, tr = [], ax = [0, 1, 2];
  const L = base({ hovermode: "x unified", dragmode: "pan", margin: { l: 46, r: 8, t: 40, b: 34 } }); const a0 = L._ax; delete L._ax;
  L.annotations = []; const gap = 0.04, w = (1 - 2 * gap) / 3;
  const hasS = !!O.step, hasN = !!O.noise, rowsN = (hasS ? 1 : 0) + (hasN ? 1 : 0);
  if (!rowsN) { Plotly.purge("main"); $("main").style.height = "0px"; return; }
  const top = [hasS ? [0.58, 1] : null, hasN ? (hasS ? [0, 0.4] : [0, 1]) : null];
  ax.forEach(i => {
    const x0 = i * (w + gap);
    if (hasS) { const s = i ? i + 1 : "";
      L[`xaxis${s}`] = { ...a0, domain: [x0, x0 + w], anchor: `y${s}`, title: { text: "ms after a stick move", font: { size: 10 }, standoff: 2 }, ...(i ? { matches: "x" } : {}) };
      L[`yaxis${s}`] = { ...a0, domain: top[0], anchor: `x${s}`, fixedrange: true, ...(i ? { matches: "y" } : {}) };
      const A = O.step.a[i], B = O.step.b[i];
      if (A) tr.push(line(O.step.t_ms, A, "before", css("--muted"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { dash: "dash", width: 2 }, legendgroup: "a", showlegend: !i }));
      if (B) tr.push(line(O.step.t_ms_b, B, "after", axc(i), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { width: 2.4 }, legendgroup: `b${i}`, showlegend: false }));
      L.annotations.push({ text: `<b>${AX[i]}</b> step response`, xref: "paper", yref: "paper", x: x0, y: top[0][1], yanchor: "bottom", xanchor: "left", showarrow: false, font: { size: 12, color: css("--ink") } }); }
    if (hasN) { const n = i + 1 + (hasS ? 3 : 0), s = n === 1 ? "" : n;
      L[`xaxis${s}`] = { ...a0, domain: [x0, x0 + w], anchor: `y${s}`, title: { text: "frequency (Hz)", font: { size: 10 }, standoff: 2 } };
      L[`yaxis${s}`] = { ...a0, domain: top[1], anchor: `x${s}`, fixedrange: true, title: i ? undefined : { text: "dB", font: { size: 10 }, standoff: 2 } };
      const A = O.noise.a[String(i)], B = O.noise.b[String(i)], k0 = arr => (arr || []).findIndex(v => v >= 10);
      if (A) tr.push(line(O.noise.fa.slice(k0(O.noise.fa)), A.slice(k0(O.noise.fa)), "before", css("--muted"), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { dash: "dash", width: 1.6 }, legendgroup: "a", showlegend: false }));
      if (B) tr.push(line(O.noise.fb.slice(k0(O.noise.fb)), B.slice(k0(O.noise.fb)), `after · ${AX[i].toLowerCase()}`, axc(i), { type: "scatter", xaxis: `x${s}`, yaxis: `y${s}`, line: { width: 2 }, legendgroup: `b${i}`, showlegend: true }));
      L.annotations.push({ text: `<b>${AX[i]}</b> gyro noise after filters`, xref: "paper", yref: "paper", x: x0, y: top[1][1], yanchor: "bottom", xanchor: "left", showarrow: false, font: { size: 12, color: css("--ink") } }); }
  });
  $("main")._time = []; $("main")._freq = false;
  fitMain(rowsN > 1 ? 560 : 320);
  await Plotly.react("main", tr, L, CFG);
}
