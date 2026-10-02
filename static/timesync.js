// Synced time navigation. Every time axis on the page follows one view window S.view = [t0, t1] (null = whole log):
// grab-to-pan on any time chart; click a chart, then the mouse wheel zooms time around the cursor. The playback strip,
// and every other time chart on the page move together.
const TSY = { active: null, busy: 0, lastLive: 0, rev: 0, fetchT: null };
S.view = null;
const DUR = () => (S.meta ? S.meta.stats.duration_s : 1);

// gd._time = [{ axis: "xaxis" | "yaxis" | "xaxis4" …, dim: "x" | "y", pair: anchor axis key or null (= whole plot area) }]
function setTimeAxes(list) { $("main")._time = list; }

function clampView(r) {
  if (!r) return null;
  let [a, b] = r[0] <= r[1] ? r : [r[1], r[0]];
  const D = DUR(), w = Math.min(D, Math.max(0.05, b - a));
  if (w >= D * 0.999) return null;
  a = Math.max(-w / 2, Math.min(a, D - w / 2));   // the playhead (= view centre) may reach both ends of the log
  return [a, a + w];
}
function rangeFromEv(ev, k) {
  if (ev[`${k}.autorange`]) return "auto";
  const arr = ev[`${k}.range`] || [], a = ev[`${k}.range[0]`] ?? arr[0], b = ev[`${k}.range[1]`] ?? arr[1];
  return a != null && b != null ? [+a, +b] : null;
}
function hookTime(gd) {  // Plotly event hooks: re-attached after every purge (see Plotly.react wrapper)
  gd.on("plotly_relayouting", ev => fromPlot(gd, ev, true));
  gd.on("plotly_relayout", ev => fromPlot(gd, ev, false));
}
// ---- noise tab: shared frequency axis (all panels match "x") ----
function setNfr(r, rerender) {
  S.nfr = r;
  if ($("nfmin")) { const nyq = S.meta.stats.log_rate_hz / 2, v = r || [10, nyq]; $("nfmin").value = Math.round(v[0]); $("nfmax").value = Math.round(v[1]);
    $("nffull").disabled = !r; $("nffull").textContent = r ? "Full" : "Full ✓"; }
  if (rerender) { const gd = $("main"); if (gd._freq) { TSY.busy++; Plotly.relayout(gd, r ? { "xaxis.range": r } : { "xaxis.range": [10, S.meta.stats.log_rate_hz / 2] }).finally(() => TSY.busy--); } }
}
// spectrogram: same idea, its own stored range S.fr (lower bound 0 Hz)
function setSfr(r, rerender) {
  S.fr = r;
  if ($("fmin")) { const nyq = S.meta.stats.log_rate_hz / 2, v = r || [0, nyq]; $("fmin").value = Math.round(v[0]); $("fmax").value = Math.round(v[1]);
    $("ffull").disabled = !r; $("ffull").textContent = r ? "Full" : "Full ✓"; }
  if (rerender) { const gd = $("main"); if (gd._freq) { TSY.busy++; Plotly.relayout(gd, { "xaxis.range": r || [0, S.meta.stats.log_rate_hz / 2] }).finally(() => TSY.busy--); } }
}
const freqLo = gd => gd._freq === "spectro" ? 0 : 10;
const freqSet = (gd, r, re) => (gd._freq === "spectro" ? setSfr : setNfr)(r, re);
function fromPlot(gd, ev, live) {
  if (gd._freq === "spectro" && S.mode === "time" && !live) {   // drag-pan / double-click on the time axis
    const r = rangeFromEv(ev, "yaxis");
    if (r) S.stime = r === "auto" ? null : r;
  }
  if (gd._freq && !TSY.busy) {
    for (const k of Object.keys(ev)) { const m = k.match(/^(xaxis\d*)\.(range|autorange)/); if (!m) continue;
      const r = rangeFromEv(ev, m[1]); if (!r) continue;
      if (!live) { const nyq = S.meta.stats.log_rate_hz / 2;
        freqSet(gd, r === "auto" || (r[0] <= freqLo(gd) && r[1] >= nyq - 1) ? null : [Math.max(0, r[0]), Math.min(nyq, r[1])], r === "auto"); }
      return; }
    if (!gd._time || !gd._time.length) return;
  }
  if (TSY.busy || !gd._time) return;
  // while playing, only a live drag by the user moves the view: a finished relayout here is usually our own (playTick),
  // arriving after the playhead has moved on; syncing to it would drag the playhead backwards
  if (!live && typeof PB !== "undefined" && PB.playing) return;
  for (const t of gd._time) {
    const r = rangeFromEv(ev, t.axis);
    if (!r) continue;
    if (live && performance.now() - TSY.lastLive < 40) return;
    TSY.lastLive = performance.now();
    syncView(r === "auto" ? null : r, { gd, axis: t.axis, live });
    return;
  }
}

// playhead line on every registered time axis (named "ph" so other shapes survive)
function phShapes(gd, t) {
  if (S.view) return [];   // zoomed: the centred HTML overlay line is used instead (playTick)
  return (gd._time || []).map(a => { const k = a.axis.replace("axis", ""), c = { color: css("--accent"), width: 2 };
    return a.dim === "x" ? { name: "ph", type: "line", xref: k, yref: a.pair ? a.pair.replace("axis", "") + " domain" : "paper", x0: t, x1: t, y0: 0, y1: 1, line: c }
                         : { name: "ph", type: "line", yref: k, xref: "paper", y0: t, y1: t, x0: 0, x1: 1, line: c }; });
}
const withPh = (gd, t) => ((gd.layout && gd.layout.shapes) || []).filter(s => s.name !== "ph").concat(phShapes(gd, t));
const drawOverviewMarks = () => null;

async function syncView(r, src = {}) {
  r = clampView(r);
  S.view = r;
  TSY.busy++;
  try {
    const gd = $("main"), jobs = [];
    if (gd._time && gd._time.length && gd._fullLayout) {
      const upd = {};
      for (const t of gd._time) {
        if (src.gd === gd && src.axis === t.axis && src.live) continue;  // don't fight the axis being dragged
        if (r) { upd[`${t.axis}.range`] = r.slice(); upd[`${t.axis}.autorange`] = false; }
        else upd[`${t.axis}.autorange`] = true;
      }
      if (Object.keys(upd).length) jobs.push(Plotly.relayout(gd, upd));
    }
    await Promise.all(jobs);
  } finally { TSY.busy--; }
  // playback strip: same window, playhead at its centre
  if (!src.strip && typeof PB !== "undefined" && PB.d && !$("player").hidden) {
    const rr = r || [0, PB.d.dur];
    PB.span = Math.max(0.5, rr[1] - rr[0]); if ($("pbZoom")) { $("pbZoom").value = Math.log2(PB.span); labels(); }
    seek((rr[0] + rr[1]) / 2);
  }
  // time-series tabs: fetch full-rate data for the new window once movement stops
  if (TS[S.tab] && !src.live) { clearTimeout(TSY.fetchT); TSY.fetchT = setTimeout(() => renderTS(), 180); }
}

// playback strip → charts (called from player.js while dragging / zooming the strip)
function stripSync(live) {
  if (!PB.d) return;
  const now = performance.now();
  if (live && now - TSY.lastLive < 50) return;
  TSY.lastLive = now;
  syncView([PB.t - PB.span / 2, PB.t + PB.span / 2], { strip: true, live });
}

// ---- wheel zoom on the active (clicked) chart ----
function hitTime(gd, e) {
  const fl = gd._fullLayout; if (!fl) return null;
  const b = gd.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top;
  for (const t of gd._time || []) {
    const ax = fl[t.axis]; if (!ax) continue;
    const pa = t.pair ? fl[t.pair] : null, sz = fl._size;
    if (t.dim === "x") {
      const px = x - ax._offset, inY = pa ? y >= pa._offset && y <= pa._offset + pa._length : y >= sz.t && y <= sz.t + sz.h;
      if (px >= 0 && px <= ax._length && inY) return { v: ax.p2d(px), cur: ax.range.slice() };
    } else {
      const py = y - ax._offset, inX = x >= sz.l && x <= sz.l + sz.w;
      if (py >= 0 && py <= ax._length && inX) return { v: ax.p2d(py), cur: ax.range.slice() };
    }
  }
  return null;
}
function onWheel(e) {
  const gd = e.currentTarget;
  if (TSY.active !== gd) return;              // not clicked → let the page scroll
  if (gd._freq === "spectro" && S.mode === "time" && (e.ctrlKey || e.shiftKey)) { e.preventDefault(); e.stopPropagation(); spectroTimeWheel(e); return; }
  if (gd._freq && !(e.shiftKey && gd._time && gd._time.length)) {   // noise / spectrogram: zoom frequency around the cursor, all panels together (shift+wheel = time)
    const fl = gd._fullLayout, b = gd.getBoundingClientRect(), x = e.clientX - b.left, y = e.clientY - b.top, nyq = S.meta.stats.log_rate_hz / 2;
    for (let i = 1; i <= 6; i++) { const ax = fl[i > 1 ? `xaxis${i}` : "xaxis"]; if (!ax) continue; const px = x - ax._offset;
      if (px < 0 || px > ax._length || y < fl._size.t || y > fl._size.t + fl._size.h) continue;
      e.preventDefault(); e.stopPropagation();
      const v = ax.p2d(px), [a, c] = fl.xaxis.range, f = 1.2 ** Math.sign(e.deltaY);
      let r = [Math.max(0, v - (v - a) * f), Math.min(nyq, v + (c - v) * f)];
      if (r[1] - r[0] < 5) return;
      TSY.busy++; Plotly.relayout(gd, { "xaxis.range": r }).finally(() => TSY.busy--);
      freqSet(gd, r[0] <= freqLo(gd) && r[1] >= nyq - 1 ? null : r, false); return; }
    return;
  }
  const h = hitTime(gd, e); if (!h) return;
  e.preventDefault(); e.stopPropagation();
  const f = 1.2 ** Math.sign(e.deltaY), [a, b] = h.cur, v = h.v;
  syncView([v - (v - a) * f, v + (b - v) * f], {});
}
$("main").addEventListener("wheel", onWheel, { passive: false, capture: true });
document.addEventListener("pointerdown", e => {
  const gd = e.target.closest && e.target.closest("#main");
  const ok = gd && (gd._freq || (gd._time && gd._time.length));
  TSY.active = ok ? gd : null;
  $("main").classList.toggle("tactive", !!TSY.active);
}, true);

// ---- playhead: whenever the charts are zoomed (S.view set) the view is kept centred on the playhead and the line is an
// HTML overlay fixed at the plot centre, so it stays put while you drag, zoom or play; only the data moves.
// On the whole-log view (S.view = null) it is a Plotly shape at the playhead time instead.
function phOverlay(gd, show) {
  const card = document.querySelector(".maincard");
  let ov = $("phov"); if (!ov) { ov = document.createElement("div"); ov.id = "phov"; card.appendChild(ov); }
  if (!show) { ov.hidden = true; return; }
  const cb = card.getBoundingClientRect(), b = gd.getBoundingClientRect(), fl = gd._fullLayout, sz = fl._size, L = b.left - cb.left, T = b.top - cb.top;
  const html = gd._time.map(a => { const ax = fl[a.axis]; if (!ax || !ax._length) return "";
    if (a.dim === "x") { const pa = a.pair ? fl[a.pair] : null, x = L + ax._offset + ax._length / 2;
      return `<i style="left:${(x - 1).toFixed(1)}px;top:${T + (pa ? pa._offset : sz.t)}px;height:${pa ? pa._length : sz.h}px;width:2px"></i>`; }
    const y = T + ax._offset + ax._length / 2;
    return `<i style="top:${(y - 1).toFixed(1)}px;left:${L + sz.l}px;width:${sz.w}px;height:2px"></i>`; }).join("");
  if (ov._h !== html) { ov.innerHTML = html; ov._h = html; }
  ov.hidden = false;
}
function playTick(t, now) {
  const gd = $("main");
  if (!gd._time || !gd._time.length || !gd._fullLayout || gd.style.display === "none") { phOverlay(gd, false); return; }
  if (PB.playing && !S.view) { const w = Math.min(PB.span, DUR() * 0.99); S.view = [t - w / 2, t + w / 2]; }
  const centred = !!S.view;
  phOverlay(gd, centred);                                    // cheap and immediate, even mid-drag
  if (gd._dragging || PB._busy) { PB.dirty = true; return; }  // never move the axes under the user's mouse
  const shapes = (gd.layout && gd.layout.shapes) || [], ph = shapes.filter(s => s.name === "ph"), upd = {};
  let r = null;
  if (centred) {
    const w = S.view[1] - S.view[0];
    if (Math.abs((S.view[0] + S.view[1]) / 2 - t) > w * 1e-4) { r = [t - w / 2, t + w / 2]; S.view = r;
      for (const a of gd._time) { upd[`${a.axis}.range`] = r.slice(); upd[`${a.axis}.autorange`] = false; } }
    if (ph.length) upd.shapes = shapes.filter(s => s.name !== "ph");
  } else if (!ph.length || Math.abs(ph[0].x0 - t) > 1e-6 && ph[0].x0 != null || ph[0].y0 != null && ph[0].xref === "paper" && Math.abs(ph[0].y0 - t) > 1e-6) {
    upd.shapes = withPh(gd, t);
  }
  if (!Object.keys(upd).length) return;
  if (now - (PB._ch || 0) < 35) { PB.dirty = true; return; }
  PB._ch = now; PB._busy = true; TSY.busy++;
  Plotly.relayout(gd, upd).catch(() => {}).finally(() => { PB._busy = false; TSY.busy--; });
  // time-series tabs hold a margin of data around the view: reload when the view runs past it
  if (r && TS[S.tab] && S._fetched && !S._tsLoading && (r[0] < S._fetched[0] - 1e-6 && r[0] > 0 || r[1] > S._fetched[1] + 1e-6 && r[1] < DUR())) {
    S._tsLoading = true; renderTS().finally(() => S._tsLoading = false);
  }
}
