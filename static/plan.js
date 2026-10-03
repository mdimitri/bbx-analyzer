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
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_plan">Tune plan</h3><span class="hint">everything the analyses suggest, in the order to change it · tick what you want · one CLI block at the end</span>
    <span class="tspacer"></span><button class="btn sm" id="planPdf" data-tip="report_pdf">⬇ PDF report</button>`, []);
  $("planPdf").onclick = () => makeReport();
  const items = planItems(P, st), cli = planCli(P, items);
  const stepHTML = P.steps.map((s, si) => {
    const its = items.filter(it => it.step === s.id); if (!its.length) return "";
    return `<section class="pstep"><div class="psh"><span class="pnum">${si + 1}</span><div><h4>${esc(s.title)}</h4><div class="hint">${esc(s.why)}</div></div></div>
      ${its.map(it => { const id = itemId(it), has = it.cli && it.cli.length;
        return `<div class="pitem lv-${it.level} ${has && !it.on ? "off" : ""}">
          ${has ? `<label class="pchk"><input type="checkbox" data-id="${esc(id)}" ${it.on ? "checked" : ""}></label>` : `<span class="pdot" style="background:${LVC(it.level)}"></span>`}
          <div class="pbody"><div class="ptitle">${esc(it.text)} ${it.tab ? `<a class="plink" data-go="${it.tab}">${esc(TAB_LABEL[it.tab] || it.tab)} →</a>` : ""}
            ${it.user ? `<button class="btn sm ghost puser" data-user="${it.user}">use the automatic proposal instead</button>` : ""}</div>
            ${it.why ? `<div class="pwhy">${esc(it.why)}</div>` : ""}${it.note ? `<div class="pnote">${esc(it.note)}</div>` : ""}
            ${has ? `<div class="pcli">${it.cli.map(([k, v]) => `<code>${esc(k)} = ${esc(v)}</code>`).join("")}</div>` : ""}</div></div>`; }).join("")}</section>`; }).join("");
  $("findings").innerHTML = `<div class="plan">
    <div class="pcol">${P.notes.length ? `<div class="pnotes">${P.notes.map(n => `<div>⚠ ${esc(n)}</div>`).join("")}</div>` : ""}${stepHTML}</div>
    <aside class="pside"><div class="fh">CLI for the ticked items</div>
      ${cli.length > 1 ? `<pre class="cli" id="planCli">${esc(cli.join("\n"))}</pre><button class="btn sm" id="planCopy">Copy CLI</button>`
        : `<div class="hint">Nothing ticked that changes a setting.</div>`}
      <div class="hint" style="margin-top:6px">Paste into the Betaflight CLI tab. Typing exact PID values turns the simplified-tuning sliders off.</div>
      <div class="fh" style="margin-top:14px">Next test flight</div><ol class="pchecklist">${P.checklist.map(c => `<li>${esc(c)}</li>`).join("")}</ol></aside></div>`;
  $("findings").querySelectorAll("[data-id]").forEach(cb => cb.onchange = () => { const s2 = planState(); s2.on[cb.dataset.id] = cb.checked; savePlan(s2); renderPlan(); });
  $("findings").querySelectorAll("[data-go]").forEach(a => a.onclick = () => document.querySelector(`#tabs [data-tab="${a.dataset.go}"]`).click());
  $("findings").querySelectorAll("[data-user]").forEach(b => b.onclick = () => { const s2 = planState(); s2[b.dataset.user] = null; savePlan(s2); renderPlan(); });
  if ($("planCopy")) $("planCopy").onclick = () => { navigator.clipboard && navigator.clipboard.writeText(cli.join("\n")); $("planCopy").textContent = "Copied ✓"; };
}
// the plan's items with the user's ticks, and their planner / simulator choices in place of the automatic proposal
function planItems(P, st = planState()) {
  let items = P.items.map(it => ({ ...it, on: st.on[itemId(it)] ?? it.on }));
  if (st.filt) items = items.filter(it => !(it.step === "filters" && it.src === "filter planner"))
    .concat([{ step: "filters", text: "Your filter-planner choices", why: st.filt.label, cli: st.filt.cli, on: st.on["filters|Your filter-planner choices"] ?? true, level: "info", tab: "noise", src: "you", user: "filt" }]);
  if (st.pids) items = items.filter(it => !(it.src === "step response" && (it.step === "pids" || it.step === "feel")))
    .concat([{ step: "pids", text: "Your PID-simulator gains", why: st.pids.label, cli: st.pids.cli, on: st.on["pids|Your PID-simulator gains"] ?? true, level: "info", tab: "pidsim", src: "you", user: "pids" }]);
  return items;
}
const TAB_LABEL = { summary: "Profile", tracking: "Tracking", pid: "PID terms", motors: "Motors", noise: "Noise", spectro: "Spectrogram", step: "Step response", propwash: "Propwash", pidsim: "PID simulator", health: "Motor health" };

function planCli(P, items) {
  const out = [`# BBX tune plan · ${P.craft || S.file} · ${new Date().toISOString().slice(0, 10)}`], seen = new Map();
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
