// The navigation rail: every tab as an icon with its name, docked under the timeline at the bottom of the window (default), or on top, or replaced by the classic tab strip.
// It mirrors the #tabs buttons (which stay in the DOM and keep doing the work), so a tab hidden, marked or activated anywhere shows up here too.
(() => {
  const ICON = {
    summary: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    plan: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M3.5 6l1.3 1.3L7 5M3.5 12l1.3 1.3L7 11M3.5 18l1.3 1.3L7 17"/>',
    pidsim: '<path d="M4 7h10M18 7h2M4 17h2M10 17h10"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    compare: '<path d="M7 4v16M17 4v16M3 8l4-4 4 4M13 16l4 4 4-4"/>',
    tracking: '<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v4M12 18v4M2 12h4M18 12h4"/>',
    pid: '<path d="M3 17c3 0 3-10 6-10s3 10 6 10 3-6 6-6"/>',
    motors: '<circle cx="12" cy="12" r="3"/><path d="M12 9c0-4 5-5 5-2s-3 3-5 2zM15 12c4 0 5 5 2 5s-3-3-2-5zM12 15c0 4-5 5-5 2s3-3 5-2zM9 12c-4 0-5-5-2-5s3 3 2 5z"/>',
    noise: '<path d="M2 12h3l2-6 3 12 3-9 2 5 2-2h5"/>',
    spectro: '<path d="M5 20V10M9 20V4M13 20v-8M17 20V7M21 20v-5"/>',
    delay: '<circle cx="12" cy="13" r="8"/><path d="M12 8v5l3 2M9 2h6"/>',
    step: '<path d="M3 19h5V9h5V5h8"/>',
    propwash: '<path d="M3 8h11a3 3 0 1 0-3-3M3 13h15a3 3 0 1 1-3 3M3 18h7"/>',
    health: '<path d="M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.5A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11z"/><path d="M6 12h3l1.5-3 2 5 1.5-2H18"/>',
    avatar: '<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8z"/>'
  };
  const GROUP = { summary: 0, plan: 1, pidsim: 1, compare: 1, tracking: 2, pid: 2, motors: 2, noise: 2, spectro: 2, delay: 2, step: 2, propwash: 2, health: 2, avatar: 3 };
  const svg = k => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[k] || '<circle cx="12" cy="12" r="3"/>'}</svg>`;
  const LV = { good: "var(--good)", info: "var(--info)", warning: "var(--warning)", serious: "var(--serious)" };
  const tabs = document.getElementById("tabs"); if (!tabs) return;
  const store = { get: () => { try { return localStorage.getItem("bbx.rail") || "bottom"; } catch (e) { return "bottom"; } }, set: v => { try { localStorage.setItem("bbx.rail", v); } catch (e) {} } };
  let mode = store.get(); if (!["bottom", "top", "classic"].includes(mode)) mode = "bottom";
  const rail = document.createElement("nav"); rail.id = "rail"; rail.className = "rail"; rail.setAttribute("aria-label", "Sections");
  const bar = document.querySelector(".bar"); (bar ? bar.after.bind(bar) : document.body.prepend.bind(document.body))(rail);
  const root = document.documentElement;

  function apply() {
    document.body.classList.toggle("rail-bottom", mode === "bottom"); document.body.classList.toggle("rail-top", mode === "top"); document.body.classList.toggle("rail-classic", mode === "classic");
    rail.dataset.pos = mode; requestAnimationFrame(() => { const h = mode === "classic" ? 0 : rail.offsetHeight; if (root.style.getPropertyValue("--rail-h") !== h + "px") { root.style.setProperty("--rail-h", h + "px"); window.dispatchEvent(new Event("resize")); } });   // only when the rail height really changed: the app redraws on resize
  }
  function build() {
    const list = [...tabs.querySelectorAll("button:not([hidden])")]; let last = -1, html = "";
    list.forEach((t, i) => { const key = t.dataset.tab || t.dataset.group, g = GROUP[key] ?? 2, name = t.textContent.replace(/[✦●]/g, "").trim(), on = t.classList.contains("on") || t.classList.contains("gon"), lv = t.dataset.lvl;
      if (last >= 0 && g !== last) html += '<i class="sep"></i>'; last = g;
      html += `<button class="rb${on ? " on" : ""}" data-i="${i}" ${t.dataset.tip ? `data-tip="${t.dataset.tip}"` : ""} ${on ? 'aria-current="page"' : ""}>${svg(key)}<span>${name}</span>${lv ? `<i class="lv" style="background:${LV[lv] || "var(--muted)"}"></i>` : ""}</button>`; });
    rail.innerHTML = `<button class="grip" title="Drag to the top or bottom of the window" aria-label="Move the navigation bar"><svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><circle cx="9" cy="6" r="1.6"/><circle cx="15" cy="6" r="1.6"/><circle cx="9" cy="12" r="1.6"/><circle cx="15" cy="12" r="1.6"/><circle cx="9" cy="18" r="1.6"/><circle cx="15" cy="18" r="1.6"/></svg></button><div class="rbs">${html}</div><button class="rmenu" title="Navigation bar position" aria-label="Navigation bar options">⋯</button>`;
    rail._list = list; const on = rail.querySelector(".rb.on"); if (on && rail.querySelector(".rbs").scrollWidth > rail.querySelector(".rbs").clientWidth) on.scrollIntoView({ inline: "center", block: "nearest" });
  }
  let pend = 0; const rebuild = () => { cancelAnimationFrame(pend); pend = requestAnimationFrame(() => { build(); apply(); }); };
  new MutationObserver(rebuild).observe(tabs, { attributes: true, subtree: true, attributeFilter: ["class", "hidden", "data-lvl"] });
  rail.addEventListener("click", e => { const b = e.target.closest(".rb"); if (b) { rail._list[+b.dataset.i]?.click(); return; }
    const m = e.target.closest(".rmenu"); if (m) { menu(m); } });

  // the position menu
  function menu(anchor) { document.getElementById("railmenu")?.remove(); const m = document.createElement("div"); m.id = "railmenu"; m.className = "railmenu";
    const o = (v, t) => `<button data-m="${v}" class="${mode === v ? "on" : ""}">${t}</button>`; m.innerHTML = o("bottom", "Dock at the bottom") + o("top", "Dock at the top") + o("classic", "Classic tab strip");
    document.body.appendChild(m); const r = anchor.getBoundingClientRect(); m.style.right = Math.max(8, innerWidth - r.right) + "px"; m.style[mode === "top" ? "top" : "bottom"] = (mode === "top" ? r.bottom + 6 : innerHeight - r.top + 6) + "px";
    m.onclick = e => { const b = e.target.closest("button"); if (b) { mode = b.dataset.m; store.set(mode); apply(); m.remove(); } };
    setTimeout(() => document.addEventListener("pointerdown", function h(ev) { if (!m.contains(ev.target)) { m.remove(); document.removeEventListener("pointerdown", h); } }), 0); }

  // drag the bar by its grip: it follows the pointer and snaps to the nearer edge on release
  let drag = null;
  rail.addEventListener("pointerdown", e => { const g = e.target.closest(".grip"); if (!g) return; e.preventDefault(); const r = rail.getBoundingClientRect();
    drag = { dy: e.clientY - r.top, start: mode }; g.setPointerCapture(e.pointerId); document.body.classList.add("rail-dragging"); rail.classList.add("dragging"); rail.style.top = r.top + "px"; });
  rail.addEventListener("pointermove", e => { if (!drag) return; const y = Math.max(0, Math.min(innerHeight - rail.offsetHeight, e.clientY - drag.dy)); rail.style.top = y + "px"; rail.style.bottom = "auto";
    document.body.dataset.railZone = e.clientY < innerHeight / 2 ? "top" : "bottom"; });
  const end = e => { if (!drag) return; const to = e.clientY < innerHeight / 2 ? "top" : "bottom"; drag = null; rail.classList.remove("dragging"); document.body.classList.remove("rail-dragging"); delete document.body.dataset.railZone; rail.style.top = rail.style.bottom = "";
    mode = to; store.set(mode); apply(); };
  rail.addEventListener("pointerup", end); rail.addEventListener("pointercancel", end);
  rail.addEventListener("dblclick", e => { if (e.target.closest(".grip")) { mode = mode === "top" ? "bottom" : "top"; store.set(mode); apply(); } });

  // cards in every tab: a soft light that follows the pointer
  document.addEventListener("pointermove", e => { const c = e.target.closest?.(".dcard"); if (!c) return; const r = c.getBoundingClientRect(); c.style.setProperty("--mx", e.clientX - r.left + "px"); c.style.setProperty("--my", e.clientY - r.top + "px"); }, { passive: true });
  window.RAIL = { rebuild, set: v => { mode = v; store.set(v); apply(); }, get mode() { return mode; } };
  build(); apply();
})();
