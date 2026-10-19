// Tune plan: every suggestion from every tab, in the order to apply them, one CLI block and a test-flight checklist.
// The filter planner and the PID simulator can hand their own choices to the plan ("Use in tune plan"), which then
// replace the automatic proposal for that step.
const PLAN = { key: null, d: null };
const planKey = () => `plan:${S.file}|${S.sub}`;
const planState = () => store.get(planKey(), null) || { on: {}, filt: null, pids: null };
const savePlan = st => store.set(planKey(), st);
const itemId = it => `${it.step}|${it.text}`;

async function renderPlan() {
  const key = [S.file, S.sub, S.prop && S.prop.inch, S.prop && S.prop.blades, S.auw].join("|");
  if (PLAN.key !== key) { PLAN.d = await api("plan", S.auw ? { auw: S.auw } : {}); PLAN.key = key; }
  if (S.tab !== "plan") return;
  const P = PLAN.d, st = planState();
  Plotly.purge("main"); $("main").style.height = "0px";
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_plan">Tune plan</h3><span class="hint">what to do, in order · filter and PID changes are made in their own tabs</span>
    <span class="tspacer"></span><button class="btn sm" id="planPdf" data-tip="report_pdf">⬇ PDF report</button>`, []);
  $("planPdf").onclick = () => makeReport();
  const items = planItems(P, st), cli = planCli(P, items);
  const stepHTML = P.steps.map((s, si) => {
    const its = items.filter(it => it.step === s.id); if (!its.length) return "";
    return `<section class="pstep"><div class="psh"><span class="pnum">${si + 1}</span><div><h4>${esc(s.title)}</h4><div class="hint">${esc(s.why)}</div></div></div>
      ${its.map(it => { const id = itemId(it), has = it.cli && it.cli.length;
        return `<div class="pitem lv-${it.level} ${has && !it.on ? "off" : ""}">
          ${has ? `<label class="pchk"><input type="checkbox" data-id="${esc(id)}" ${it.on ? "checked" : ""}></label>` : `<span class="pdot" style="background:${LVC(it.level)}"></span>`}
          <div class="pbody"><div class="ptitle">${esc(it.text)} ${it.tab ? `<a class="plink" data-go="${it.tab}">${esc(it.go || TAB_LABEL[it.tab] || it.tab)} →</a>` : ""}
            </div>
            ${it.why ? `<div class="pwhy">${esc(it.why)}</div>` : ""}${it.note ? `<div class="pnote">${esc(it.note)}</div>` : ""}
            ${has ? `<div class="pcli">${it.cli.map(([k, v]) => `<code>${esc(k)} = ${esc(v)}</code>`).join("")}</div>` : ""}</div></div>`; }).join("")}</section>`; }).join("");
  const rows = [], seenK = new Set(), kh = S.keyH || {};
  items.filter(it => it.on && it.cli).forEach(it => it.cli.forEach(([k, v]) => { if (seenK.has(k)) return; seenK.add(k);
    rows.push(`<tr><td><code>${esc(k)}</code></td><td>${esc(nowVal(k, kh))}</td><td class="pnew">${esc(v)}</td><td class="pw">${esc(it.text)}</td></tr>`); }));
  const todo = items.filter(it => it.level !== "good").length, nf = items.filter(it => it.step === "filters" && it.level !== "good").length, np = items.filter(it => (it.step === "pids" || it.step === "feel") && it.level !== "good").length;
  const head = `<div class="phead"><div class="phl">${todo} suggestion${todo === 1 ? "" : "s"}${nf || np ? ` · ${nf} on filters → Noise tab · ${np} on PIDs → PID simulator` : ""}</div>
    ${rows.length ? `<div class="hint">Settings to change now (logging):</div>` : ""}
    ${rows.length ? `<table class="ptab"><tr><th>Setting</th><th>Now</th><th>Suggested</th><th>Why</th></tr>${rows.join("")}</table>` : ""}
    <div class="hint">Filter and PID suggestions open the tab where you adjust them and get the CLI</div></div>`;
  $("findings").innerHTML = `<div class="plan one">
    <div class="pcol">${head}${stepHTML}
      <details class="pdet"><summary>Details · warnings, CLI block and next test flight</summary>
        ${P.notes.length ? `<div class="pnotes">${P.notes.map(n => `<div>⚠ ${esc(n)}</div>`).join("")}</div>` : ""}
        <div class="fh">CLI for the ticked items</div>
        ${cli.length > 1 ? `<pre class="cli" id="planCli">${esc(cli.join("\n"))}</pre><button class="btn sm" id="planCopy">Copy CLI</button>` : `<div class="hint">Nothing ticked that changes a setting.</div>`}
        <div class="hint">Paste into the Betaflight CLI tab. Typing exact PID values turns the simplified-tuning sliders off.</div>
        <div class="fh" style="margin-top:12px">Next test flight</div><ol class="pchecklist">${P.checklist.map(c => `<li>${esc(c)}</li>`).join("")}</ol></details></div></div>`;
  $("findings").querySelectorAll("[data-id]").forEach(cb => cb.onchange = () => { const s2 = planState(); s2.on[cb.dataset.id] = cb.checked; savePlan(s2); renderPlan(); });
  $("findings").querySelectorAll("[data-go]").forEach(a => a.onclick = () => document.querySelector(`#tabs [data-tab="${a.dataset.go}"]`).click());
  $("findings").querySelectorAll("[data-user]").forEach(b => b.onclick = () => { const s2 = planState(); s2[b.dataset.user] = null; savePlan(s2); renderPlan(); });
  if ($("planCopy")) $("planCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(cli.join("\n")); $("planCopy").textContent = "Copied ✓"; };
}
// the plan's items with the user's ticks, and their planner / simulator choices in place of the automatic proposal
function nowVal(k, kh) {
  const m = k.match(/^([pid])_(roll|pitch|yaw)$/); if (m) { const v = String(kh[m[2] + "PID"] || "").split(","); return v["pid".indexOf(m[1])] ?? "–"; }
  const d = k.match(/^d_max_(roll|pitch|yaw)$/); if (d) return String(kh.d_max || "").split(",")[["roll", "pitch", "yaw"].indexOf(d[1])] ?? "–";
  return kh[k] ?? "–"; }
// filters, PIDs and feedforward are only pointed at here: the changes and their CLI live in the Noise (filter planner) and PID simulator tabs
const PLAN_GO = { filters: ["noise", "Open the filter planner"], pids: ["pidsim", "Open the PID simulator"], feel: ["pidsim", "Open the PID simulator"] };
function planItems(P, st = planState()) {
  return P.items.map(it => { const g = PLAN_GO[it.step], on = st.on[itemId(it)] ?? it.on;
    return g ? { ...it, cli: null, on: false, tab: g[0], go: g[1] } : { ...it, on }; });
}
const TAB_LABEL = { delay: "Filter delay", summary: "Profile", tracking: "Tracking", pid: "PID terms", motors: "Motors", noise: "Noise", spectro: "Spectrogram", step: "Step response", propwash: "Propwash", pidsim: "PID simulator", health: "Motor health" };

function planCli(P, items) {
  const out = [`# BBX Analyzer v${BBX_VERSION} tune plan · ${P.craft || S.file} · ${new Date().toISOString().slice(0, 10)}`], seen = new Map();
  P.steps.forEach((s, si) => {
    const lines = [];
    items.filter(it => it.step === s.id && it.on && it.cli && it.cli.length).forEach(it => it.cli.forEach(([k, v]) => {
      if (seen.has(k) && seen.get(k) !== v) { lines.push(`# ${k}: already set to ${seen.get(k)} above, skipping ${v}`); return; }
      if (seen.has(k)) return; seen.set(k, v); lines.push(`set ${k} = ${v}`); }));
    if (lines.length) out.push(`# ${si + 1}. ${s.title}`, ...lines);
  });
  if (out.length > 1) out.push("save");
  return out;
}

// hand-offs from the filter planner and the PID simulator
function sendToPlan(kind, cliLines, label) {
  const pairs = cliLines.map(l => l.match(/^set\s+([a-z0-9_]+)\s*=\s*(\S+)/)).filter(Boolean).map(m => [m[1], m[2]]);
  const s2 = planState(); s2[kind] = pairs.length ? { cli: pairs, label } : null; savePlan(s2);
  return pairs.length;
}
