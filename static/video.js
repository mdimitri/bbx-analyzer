// Flight video (DVR / action cam) synced to the log. The file stays in the browser (object URL): nothing is uploaded.
// Modes: "bg" = behind the charts (dimmed, charts drawn transparent on top), "pip" = floating corner window, "off".
// Sync: video time = log time + offset. Set the offset once (nudge buttons, or "Match here" at a recognisable moment).
const V = { el: null, url: null, name: "", mode: store.get("vid.mode", "bg"), opacity: store.get("vid.op", 0.5), offset: 0 };

function openVideoPanel() {
  let p = $("vidpanel");
  if (p) { p.remove(); return; }
  p = document.createElement("div"); p.id = "vidpanel"; p.className = "vidpanel";
  const seg = (id, opts, cur) => `<span class="seg" id="${id}">${opts.map(([v, t]) => `<button data-v="${v}" class="${v === cur ? "on" : ""}">${t}</button>`).join("")}</span>`;
  p.innerHTML = `<div class="vph"><b>Flight video</b><button class="btn sm ghost" id="vpClose">✕</button></div>
    <label class="btn sm">${V.el ? "Replace video…" : "Load video…"}<input id="vpFile" type="file" accept="video/*" hidden></label>
    <span class="hint">${V.el ? esc(V.name) : "MP4 / MOV / WebM from your DVR or action cam. It stays on this computer."}</span>
    <div class="vprow"><span>Show</span>${seg("vpMode", [["bg", "Behind charts"], ["pip", "Corner window"], ["off", "Hidden"]], V.mode)}</div>
    <label class="vprow"><span>Opacity</span><input id="vpOp" type="range" min="0.1" max="1" step="0.05" value="${V.opacity}"></label>
    <div class="vprow"><span title="video time = log time + offset">Sync offset</span>
      <button class="btn sm ghost" data-n="-1">−1s</button><button class="btn sm ghost" data-n="-0.1">−0.1</button>
      <input id="vpOff" type="number" step="0.05" value="${V.offset.toFixed(2)}" style="width:72px"> s
      <button class="btn sm ghost" data-n="0.1">+0.1</button><button class="btn sm ghost" data-n="1">+1s</button></div>
    <div class="hint">Line them up once: find a sharp moment (take-off, a flip, a crash) in both, then nudge the offset until the video and the playhead agree.</div>`;
  $("dock").appendChild(p);
  $("vpClose").onclick = () => p.remove();
  $("vpFile").onchange = e => { const f = e.target.files[0]; if (f) { loadVideo(f); p.remove(); openVideoPanel(); } };
  $("vpMode").onclick = e => { const v = e.target.dataset.v; if (!v) return; V.mode = v; store.set("vid.mode", v); [...$("vpMode").children].forEach(b => b.classList.toggle("on", b.dataset.v === v)); applyVideoMode(); };
  $("vpOp").oninput = e => { V.opacity = +e.target.value; store.set("vid.op", V.opacity); applyVideoMode(); };
  const setOff = v => { V.offset = Math.round(v * 100) / 100; $("vpOff").value = V.offset.toFixed(2); if (S.file) store.set("vid.off:" + S.file, V.offset); };
  $("vpOff").onchange = e => setOff(+e.target.value || 0);
  p.querySelectorAll("[data-n]").forEach(b => b.onclick = () => setOff(V.offset + +b.dataset.n));
}

function loadVideo(file) {
  if (V.url) URL.revokeObjectURL(V.url);
  V.url = URL.createObjectURL(file); V.name = file.name;
  V.offset = (S.file && store.get("vid.off:" + S.file, 0)) || 0;
  if (!V.el) {
    V.el = document.createElement("video"); V.el.id = "vid"; V.el.muted = true; V.el.playsInline = true; V.el.preload = "auto";
    document.querySelector(".maincard").appendChild(V.el);
    // corner-window drag
    let drag = null;
    V.el.addEventListener("pointerdown", e => { if (V.mode !== "pip") return; const r = V.el.getBoundingClientRect(); drag = { dx: e.clientX - r.left, dy: e.clientY - r.top }; V.el.setPointerCapture(e.pointerId); });
    V.el.addEventListener("pointermove", e => { if (!drag) return; V.el.style.left = (e.clientX - drag.dx) + "px"; V.el.style.top = (e.clientY - drag.dy) + "px"; V.el.style.right = V.el.style.bottom = "auto"; });
    V.el.addEventListener("pointerup", () => drag = null);
    V.el.addEventListener("wheel", e => { if (V.mode !== "pip") return; e.preventDefault(); const w = Math.max(160, Math.min(900, V.el.offsetWidth * (1 - Math.sign(e.deltaY) * 0.1))); V.el.style.width = w + "px"; }, { passive: false });
  }
  V.el.src = V.url;
  if (V.mode === "off") V.mode = "bg";
  applyVideoMode();
}

function applyVideoMode() {
  const on = V.el && V.mode !== "off";
  document.querySelector(".maincard").classList.toggle("vidbg", !!(V.el && V.mode === "bg"));
  if (!V.el) return;
  V.el.hidden = !on;
  V.el.className = V.mode === "pip" ? "vid-pip" : "vid-bg";
  V.el.style.opacity = V.mode === "bg" ? V.opacity : Math.max(0.6, V.opacity);
  if (V.mode === "pip") { V.el.style.left = V.el.style.top = ""; V.el.style.width = V.el.style.width || "360px"; }
  if ($("pbVid")) $("pbVid").classList.toggle("on", on);
}

// keep the video on the playhead; in "bg" mode also keep it exactly behind the plot area of the current chart
(function vidLoop() {
  requestAnimationFrame(vidLoop);
  const v = V.el; if (!v || v.hidden || !v.duration || typeof PB === "undefined" || !PB.d) return;
  if (V.mode === "bg") {
    const gd = $("main"), card = document.querySelector(".maincard"), fl = gd._fullLayout;
    if (gd.style.display === "none" || !fl) { v.style.visibility = "hidden"; return; }
    const cb = card.getBoundingClientRect(), b = gd.getBoundingClientRect(), sz = fl._size;
    Object.assign(v.style, { visibility: "visible", left: (b.left - cb.left + sz.l) + "px", top: (b.top - cb.top + sz.t) + "px", width: sz.w + "px", height: sz.h + "px" });
  } else v.style.visibility = "visible";
  const target = PB.t + V.offset;
  if (target < 0 || target > v.duration) { if (!v.paused) v.pause(); return; }
  if (PB.playing) {
    v.playbackRate = Math.max(0.0625, Math.min(16, PB.speed));
    if (v.paused) v.play().catch(() => {});
    if (Math.abs(v.currentTime - target) > 0.25 && !v.seeking) v.currentTime = target;
  } else {
    if (!v.paused) v.pause();
    if (Math.abs(v.currentTime - target) > 0.02 && !v.seeking) v.currentTime = target;
  }
})();
