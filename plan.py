"""One tune plan from every analysis, and before/after comparison of two flights.

The plan gathers what the separate analyses suggest, puts it in the order changes should be made (logging setup →
mechanical → filters → PIDs → feedforward/feel → worth trying later), resolves overlaps (one value per setting, with the
reason the other was dropped) and produces one CLI block plus a test-flight checklist. Settings come from structured
sources where they exist (PID step suggestion, proposed notches, RPM-filter fade) and otherwise from the "set x = y"
text in a finding's advice.
"""
import re
import numpy as np

AXN = ["roll", "pitch", "yaw"]
_SET = re.compile(r"\bset\s+((?:[a-z][a-z0-9_]*\s*=\s*-?[\d.]+(?:\s*\(now [^)]*\))?\s*(?:[,;]\s*(?:set\s+)?)?)+)")
_PAIR = re.compile(r"([a-z][a-z0-9_]*)\s*=\s*(-?[\d.]+)")


def cli_pairs(text):
    """All `set name = value` assignments in free text (also 'set a = 1, b = 2; set c = 3')."""
    out = []
    for m in _SET.finditer(text or ""):
        for k, v in _PAIR.findall(re.sub(r"\(now [^)]*\)", "", m.group(1))):
            out.append((k, v.rstrip(".")))
    return out


def _memo(lg, key, fn):
    m = lg.__dict__.setdefault("_memo", {})
    if key not in m:
        m[key] = fn()
    return m[key]


def gather(lg, prop=None, blades=None, auw=None):
    """Run (or reuse) every analysis the plan and the comparison need. Errors become None, never a crash."""
    k = (prop, blades)

    def safe(name, fn):
        try:
            return _memo(lg, (name,) + k, fn)
        except Exception as e:   # one failing analysis must not sink the plan
            return {"error": f"{type(e).__name__}: {e}"[:200]}
    return dict(
        profile=lg.profile(prop, blades, auw),
        noise=safe("noise", lambda: lg.noise(prop=prop, blades=blades)),
        step=safe("step", lambda: lg.step_response(prop=prop, blades=blades)),
        motors=safe("motors", lambda: lg.motors()),
        pid=safe("pidterms", lambda: lg.flight("pidterms", prop=prop, blades=blades)),
        propwash=safe("propwash", lambda: lg.flight("propwash", prop=prop, blades=blades)),
        fplan=safe("fplan", lambda: lg.filterplan(prop=prop, blades=blades)),
    )


def _item(step, text, why="", cli=(), on=True, level="info", tab=None, src="", optional=False, note=""):
    optional = bool(optional and cli)          # only a setting can be optional; plain advice is just advice
    return dict(step=step, text=text, why=why, cli=[[k, str(v)] for k, v in cli], on=bool(on and not optional), level=level,
                tab=tab, src=src, optional=optional, note=note if (cli or not note.startswith("Optional")) else "")


STEPS = [
    ("log", "Before the next flight: logging", "So the next log can show what these changes did."),
    ("mech", "Mechanical first", "Vibration and imbalance from the hardware make every filter and PID setting worse. Fix these before tuning around them."),
    ("filters", "Filters", "Filters decide how much noise and delay the PID loop sees, so they come before the PIDs."),
    ("pids", "PIDs", "One careful step, sized for your props. Fly, log, check again."),
    ("feel", "Feedforward & feel", "Stick response; changes how it flies, not how stable it is."),
    ("later", "Worth trying later", "Smaller wins, or ideas to test one at a time once the above is done."),
]


def build_plan(lg, prop=None, blades=None, auw=None, G=None):
    G = G or gather(lg, prop, blades, auw)
    P, nz, st, mo, pt, pw, fp = (G[k] for k in ("profile", "noise", "step", "motors", "pid", "propwash", "fplan"))
    items, notes = [], []
    h, fields, u = lg.headers, set(lg.cols), getattr(lg, "units", {}) or {}
    ok = lambda d: isinstance(d, dict) and not d.get("error")

    # ---- 1. logging setup for the next flight
    if prop is None and (P["estimate"].get("needs_confirm")):
        items.append(_item("log", "Confirm the prop size in the Quad profile", "Every size-aware number (delay guide, PID step, typical-quad comparison, weight) scales with it.", level="warning", tab="summary", src="profile"))
    if P["used"].get("auw_source") != "user":
        items.append(_item("log", "Weigh the quad once and enter the all-up weight", "Hover power, battery waste in watts and the simulator's typical-quad comparison use it.", tab="summary", src="profile"))
    if lg.fs < 1500:
        items.append(_item("log", f"Log faster: this log runs at {lg.fs:.0f} Hz, so nothing above {lg.fs / 2:.0f} Hz is visible",
                           "For a filter flight, 2–4 kHz shows motor noise and its harmonics. In the Betaflight Blackbox tab set the rate to 1/2 or 1/1 (CLI: blackbox_sample_rate).",
                           level="info", tab="noise", src="logging"))
    if not u.get("high_res"):
        items.append(_item("log", "Turn on high-resolution logging", "Gyro and setpoint are logged in whole °/s; high resolution logs 0.1 °/s (check the name with: get blackbox_high_resolution).",
                           cli=[("blackbox_high_resolution", "1")], on=False, optional=True, tab="tracking", src="logging",
                           note="Optional: check the setting name on your firmware first."))
    if "gyroUnfilt[0]" not in fields:
        items.append(_item("log", "Log the raw gyro (gyroUnfilt)", "Without it the noise and filter analyses can't see what the filters remove.", level="warning", tab="noise", src="logging"))
    if "eRPM[0]" not in fields:
        items.append(_item("log", "Turn on bidirectional DShot", "Motor speed (eRPM) drives the RPM filter, the motor-health analysis, the prop-size estimate and the simulator's motor lag.",
                           cli=[("dshot_bidir", "ON")], on=False, optional=True, level="warning", tab="health", src="logging"))
    dbg = int(float(h.get("debug_mode", 0) or 0))
    if dbg == 0:
        items.append(_item("log", "For a filter flight, log the dynamic-notch frequencies", "debug_mode = FFT_FREQ records where the dynamic notches sit, so the Spectrogram can show whether they follow the noise.",
                           cli=[("debug_mode", "FFT_FREQ")], on=False, optional=True, tab="spectro", src="logging",
                           note="Optional: replaces any other debug mode you use."))

    # ---- 2. mechanical
    mech_serious = False
    for f in (mo.get("findings") if ok(mo) else []) or []:
        if f["level"] in ("warning", "serious") and not cli_pairs(f.get("action")):
            items.append(_item("mech", f["title"], f.get("action") or f.get("tldr"), level=f["level"], tab="health", src="motor health"))
            mech_serious |= f["level"] == "serious"
    for f in (nz.get("findings") if ok(nz) else []) or []:
        if re.match(r"^R\d+:", f["title"]) and f["level"] in ("warning", "serious") and "mechanical" in (f.get("action") or "").lower():
            items.append(_item("mech", f["title"], f.get("action"), level=f["level"], tab="spectro", src="frame resonance"))

    # ---- 3. filters
    if ok(fp):
        for n in fp.get("notches") or []:
            if not n.get("cli"):
                continue
            pairs = cli_pairs(n["cli"].replace("\n", "; set "))
            costly = bool(n.get("warn"))
            items.append(_item("filters", f"Static gyro notch on {n['id']} at {n['fc']:.0f} Hz (Q {n['q']:.1f})", "; ".join(n.get("why") or []),
                               cli=pairs, on=not costly, optional=costly, level="warning", tab="noise", src="filter planner",
                               note=n.get("warn") or ""))
        rf = fp.get("rpm_fix")
        if rf and rf.get("cli"):
            items.append(_item("filters", "Let the RPM filter work fully where this quad flies",
                               f"Its fade starts at {rf['min_hz']:.0f} Hz + {rf['fade']:.0f} Hz while the motors hover near {rf['typ_hz']:.0f} Hz, so the notches run at only {rf['eff'] * 100:.0f}% strength.",
                               cli=cli_pairs(rf["cli"].replace("\n", "; set ")), level="info", tab="noise", src="filter planner"))
    for f in (nz.get("findings") if ok(nz) else []) or []:
        pairs = cli_pairs(f.get("action"))
        if pairs and not any(k.startswith(("rpm_filter", "gyro_notch")) for k, _ in pairs) and not re.match(r"^R\d+:", f["title"]):
            items.append(_item("filters", f["title"], f.get("action"), cli=pairs, on=f["level"] in ("warning", "serious"),
                               optional=f["level"] not in ("warning", "serious"), level=f["level"], tab="noise", src="noise",
                               note="" if f["level"] in ("warning", "serious") else "Optional: small gain, a little more delay."))

    try:
        import debugmodes
        for f in debugmodes.report(lg).get("findings") or []:
            if f["level"] in ("warning", "info") and f.get("action"):
                items.append(_item("filters", f["title"], f.get("detail") or f.get("tldr"), cli=cli_pairs(f["action"]), on=False, optional=True,
                                   level=f["level"], tab="spectro", src="debug log", note="Optional: check the Spectrogram's debug lines first."))
    except Exception:
        pass

    # ---- 4. PIDs and 5. feedforward (one structured source: the step-response suggestion)
    ps = st.get("pid") if ok(st) else None
    if ps:
        for a in AXN:
            r = (ps.get("axes") or {}).get(a)
            if not r:
                continue
            cur, sug = r["current"], r["suggested"]
            NAME = {"P": ("p", "P"), "I": ("i", "I"), "D": ("d", "D"), "Dmax": ("d_max", "D max")}
            pid_ch, parts = [], []
            for k in ("P", "I", "D", "Dmax"):
                if sug[k] != cur[k] and not (k == "Dmax" and cur[k] == 0):
                    pid_ch.append((f"{NAME[k][0]}_{a}", int(round(sug[k])))); parts.append(f"{NAME[k][1]} {cur[k]:.0f} → {sug[k]:.0f}")
            ff_ch = [(f"f_{a}", int(round(sug["FF"])))] if sug["FF"] != cur["FF"] else []
            why = "; ".join(r.get("why") or [])
            if pid_ch:
                items.append(_item("pids", f"{a.capitalize()}: " + ", ".join(parts), why, cli=pid_ch, on=r.get("confident", True), level="warning", tab="step", src="step response"))
            if ff_ch:
                items.append(_item("feel", f"{a.capitalize()}: feedforward {cur['FF']:.0f} → {sug['FF']:.0f}", why, cli=ff_ch, level="info", tab="step", src="step response"))
            if not pid_ch and not ff_ch:
                items.append(_item("pids", f"{a.capitalize()}: keep the PIDs", why, level="good", tab="step", src="step response"))
    for src, d, tab in (("PID terms", pt, "pid"), ("propwash", pw, "propwash")):
        for f in (d.get("findings") if ok(d) else []) or []:
            if f["level"] not in ("warning", "serious") or not f.get("action"):
                continue
            pairs = cli_pairs(f.get("action"))
            step = "feel" if "feedforward" in f["title"].lower() else "pids" if src == "PID terms" else "later"
            items.append(_item(step, f["title"], f["action"], cli=pairs, on=False, optional=True, level=f["level"], tab=tab, src=src,
                               note="One option among several: try it on its own flight after the steps above."))
    for d, tab, src in ((pt, "pid", "PID terms"), (mo, "health", "motor health"), (pw, "propwash", "propwash")):
        for f in (d.get("findings") if ok(d) else []) or []:
            if f["level"] == "info" and f.get("action") and len(f["action"]) > 20 and not cli_pairs(f["action"]):
                items.append(_item("later", f["title"], f["action"], level="info", tab=tab, src=src))

    # ---- conflicts: one value per setting, earlier steps and structured sources win
    order = {s[0]: i for i, s in enumerate(STEPS)}
    seen = {}
    for it in sorted(items, key=lambda x: order[x["step"]]):
        if not it["on"]:
            continue
        for k, v in it["cli"]:
            if k in seen and seen[k][0] != v:
                notes.append(f"{k}: '{it['text']}' wants {v}, but '{seen[k][1]}' already sets {seen[k][0]}; keeping the earlier one.")
                it["cli"] = [p for p in it["cli"] if p[0] != k]
            else:
                seen[k] = (v, it["text"])
    if mech_serious:
        notes.append("There is a serious mechanical issue: fix it and fly once before trusting the filter and PID suggestions, they may change.")
    if any(i["step"] == "filters" and i["on"] and i["cli"] for i in items) and any(i["step"] == "pids" and i["on"] and i["cli"] for i in items):
        notes.append("Filters and PIDs both change: if the next flight feels worse, undo the PID step first (filter changes are the safer half).")

    # ---- test-flight checklist from what changes
    chk = ["Hover 20–30 s, land, touch each motor: warm is fine, too hot to hold means back off D or filtering.",
           "Fly 5 sharp flicks per axis (roll, pitch, yaw) with the other sticks still: the Step response tab needs them."]
    if any(i["step"] == "filters" and i["on"] for i in items):
        chk.append("Do a slow throttle sweep from hover to full and back: the Spectrogram shows what the filters do across the range.")
    chk.append("Do 4–6 throttle chops from 60–80% to zero with the sticks still: the Propwash tab scores them.")
    if any(i["step"] == "mech" for i in items):
        chk.append("After the mechanical fix, check Motor health again: the per-motor vibration should even out.")
    chk.append("Load the new log here and use Compare with the previous one.")
    return dict(steps=[dict(id=a, title=b, why=c) for a, b, c in STEPS], items=items, notes=notes, checklist=chk,
                craft=str(h.get("Craft name", "")), firmware=str(h.get("Firmware revision", "")))


# ---------------------------------------------------------------- before / after
def scorecard(lg, G):
    """Comparable numbers for one flight (None where an analysis has nothing to say)."""
    P, nz, st, mo, pt, pw = (G[k] for k in ("profile", "noise", "step", "motors", "pid", "propwash"))
    ok = lambda d: isinstance(d, dict) and not d.get("error")
    S = {}
    if ok(nz):
        m, d = nz.get("metrics") or {}, nz.get("delay") or {}
        S.update(gyro_hf=m.get("gyro_hf"), dterm_hf=m.get("dterm_hf"), motor_hf=m.get("motor_hf"), rpm_min_db=m.get("rpm_min_db"),
                 delay_gyro=d.get("gyro_ms"), delay_dterm=d.get("dterm_ms"),
                 res_open=sum(1 for r in ((nz.get("resonances") or {}).get("list") or []) if (r.get("filtered_att_db") or 0) < 15))
    if ok(st):
        for i, a in enumerate(AXN):
            r = st.get(str(i)) or {}
            mt = r.get("metrics")
            if mt and (r.get("reliability") or {}).get("ok", True):
                S[f"os_{a}"] = mt.get("overshoot_pct"); S[f"rise_{a}"] = mt.get("rise_ms"); S[f"settle_{a}"] = mt.get("settle_ms")
    if ok(pw):
        ev = pw.get("events") or []
        if ev:
            S["pw_ratio"] = round(float(np.median([e["ratio"] for e in ev])), 2)
            S["pw_bad"] = round(100 * float(np.mean([e["cls"] in ("bad", "terrible") for e in ev])))
            S["pw_n"] = len(ev)
        ax = pw.get("axes") or {}
        for i, a in enumerate(AXN[:2]):
            if str(i) in ax:
                S[f"err_{a}"] = ax[str(i)].get("err_move")
    if ok(mo) and mo.get("power"):
        p = mo["power"]
        S.update(batt_waste=p.get("total"), twr=p.get("tw"))
        v = [m.get("ratio") for m in (mo.get("vib") or {}).get("motors", [])] if isinstance(mo.get("vib"), dict) else []
    if ok(pt):
        b = pt.get("behaviour") or {}
        for i, a in enumerate(AXN):
            o = ((b.get("axes") or {}).get(i) or (b.get("axes") or {}).get(str(i)) or {}).get("osc") or {}
            if o.get("kind") in ("loop", "pi"):
                S[f"osc_{a}"] = o.get("prom_db")
    e = P["estimate"]
    S.update(hover_hz=e.get("hover_hz"), hover_cmd=e.get("hover_cmd"), auw_g=round(P["used"]["auw_kg"] * 1000))
    S["dur_s"] = round(float(lg.t[-1]), 1)
    return S


# metric: (label, unit, better: -1 lower is better / +1 higher / 0 neutral, threshold for "changed", tab)
METRICS = [
    ("gyro_hf", "Gyro noise left after filters", "°/s RMS", -1, 0.15, "noise"),
    ("dterm_hf", "D-term noise", "", -1, 0.15, "noise"),
    ("motor_hf", "Noise reaching the motors", "% RMS", -1, 0.15, "noise"),
    ("delay_gyro", "Gyro filter delay", "ms", -1, 0.12, "noise"),
    ("delay_dterm", "D-term filter delay", "ms", -1, 0.12, "noise"),
    ("rpm_min_db", "RPM filter removal (weakest)", "dB", +1, 0.1, "noise"),
    ("res_open", "Unfiltered frame resonances", "", -1, 0.5, "spectro"),
    ("os_roll", "Roll overshoot", "%", -1, 0.2, "step"), ("os_pitch", "Pitch overshoot", "%", -1, 0.2, "step"), ("os_yaw", "Yaw overshoot", "%", -1, 0.2, "step"),
    ("rise_roll", "Roll rise time", "ms", -1, 0.1, "step"), ("rise_pitch", "Pitch rise time", "ms", -1, 0.1, "step"), ("rise_yaw", "Yaw rise time", "ms", -1, 0.1, "step"),
    ("pw_ratio", "Propwash wobble (median chop)", "×", -1, 0.12, "propwash"),
    ("pw_bad", "Chops rated bad/terrible", "%", -1, 0.3, "propwash"),
    ("err_roll", "Roll tracking error in moves", "°/s", -1, 0.1, "propwash"), ("err_pitch", "Pitch tracking error in moves", "°/s", -1, 0.1, "propwash"),
    ("batt_waste", "Battery wasted holding attitude", "%", -1, 0.15, "health"),
    ("osc_roll", "Roll loop oscillation", "dB", -1, 0.3, "pid"), ("osc_pitch", "Pitch loop oscillation", "dB", -1, 0.3, "pid"), ("osc_yaw", "Yaw loop oscillation", "dB", -1, 0.3, "pid"),
    ("hover_hz", "Hover motor speed", "Hz", 0, 0.05, "health"), ("hover_cmd", "Hover motor command", "%", 0, 0.08, "motors"),
    ("auw_g", "All-up weight in use", "g", 0, 0.05, "summary"),
]

SETTING_KEYS = ["rollPID", "pitchPID", "yawPID", "d_max", "ff_weight", "feedforward_transition", "feedforward_smooth_factor", "feedforward_jitter_factor",
                "iterm_relax_cutoff", "anti_gravity_gain", "tpa_rate", "tpa_breakpoint", "thrust_linear", "dyn_idle_min_rpm", "motor_idle",
                "gyro_lpf1_type", "gyro_lpf1_static_hz", "gyro_lpf1_dyn_hz", "gyro_lpf2_type", "gyro_lpf2_static_hz", "gyro_notch_hz", "gyro_notch_cutoff",
                "dterm_lpf1_type", "dterm_lpf1_static_hz", "dterm_lpf1_dyn_hz", "dterm_lpf2_type", "dterm_lpf2_static_hz", "dterm_notch_hz", "dterm_notch_cutoff",
                "dyn_notch_count", "dyn_notch_q", "dyn_notch_min_hz", "dyn_notch_max_hz", "rpm_filter_harmonics", "rpm_filter_q", "rpm_filter_min_hz",
                "rpm_filter_fade_range_hz", "rpm_filter_weights", "simplified_master_multiplier", "simplified_pi_gain", "simplified_d_gain",
                "simplified_feedforward_gain", "simplified_gyro_filter_multiplier", "simplified_dterm_filter_multiplier", "rates", "rc_rates", "rc_expo",
                "rc_smoothing_auto_factor", "rc_smoothing_feedforward_hz", "rc_smoothing_setpoint_hz", "motor_output_limit", "blackbox_high_resolution"]


# smallest change that counts, per metric (smaller moves are the normal spread between two flights)
ABS_MIN = {"os": 5.0, "rise": 2.0, "settle": 3.0, "osc": 1.0, "pw_bad": 10.0, "pw_ratio": 0.2, "err": 0.5, "delay": 0.1, "rpm_min_db": 1.0,
           "hover_hz": 3.0, "hover_cmd": 1.0, "auw_g": 15.0, "batt_waste": 0.3, "gyro_hf": 0.2, "dterm_hf": 0.5, "motor_hf": 0.1, "res_open": 1.0}


def _verdict(key, a, b, better, thr, unit=""):
    if a is None or b is None:
        return None
    am = ABS_MIN.get(key, ABS_MIN.get(key.split("_")[0], 0))
    if a == b or abs(b - a) < am:
        return "same"
    rel = (b - a) / max(abs(a), 1e-9) if key not in ("res_open",) else (b - a)
    if abs(rel) < thr:
        return "same"
    if better == 0:
        return "changed"
    return "better" if (rel < 0) == (better < 0) else "worse"


def compare(lgA, lgB, ga, gb):
    """Before (A) vs after (B): what changed in the settings, what changed in the flight, and what to try next."""
    A, B = scorecard(lgA, ga), scorecard(lgB, gb)
    rows = []
    for key, lab, unit, better, thr, tab in METRICS:
        a, b = A.get(key), B.get(key)
        if a is None and b is None:
            continue
        rows.append(dict(key=key, label=lab, unit=unit, a=a, b=b, verdict=_verdict(key, a, b, better, thr, unit), tab=tab))
    ha, hb = lgA.headers, lgB.headers
    changed = [dict(key=k, a=str(ha.get(k, "–")), b=str(hb.get(k, "–"))) for k in SETTING_KEYS if str(ha.get(k, "–")) != str(hb.get(k, "–"))]
    same_craft = str(ha.get("Craft name", "")) == str(hb.get("Craft name", ""))
    V = {r["key"]: r["verdict"] for r in rows}
    ideas = _ideas(V, A, B, changed, ga, gb)
    nb = sum(r["verdict"] == "better" for r in rows); nw = sum(r["verdict"] == "worse" for r in rows)
    head = ("Mostly better" if nb > nw * 2 else "Mostly worse" if nw > nb * 2 else "Mixed: some better, some worse" if nb and nw else "About the same") if (nb or nw) else "About the same"
    return dict(a=dict(name=lgA.path.name, idx=lgA.idx, dur=A.get("dur_s"), craft=str(ha.get("Craft name", ""))),
                b=dict(name=lgB.path.name, idx=lgB.idx, dur=B.get("dur_s"), craft=str(hb.get("Craft name", ""))),
                same_craft=same_craft, rows=rows, changed=changed, ideas=ideas, headline=head, n_better=nb, n_worse=nw,
                overlay=_overlay(ga, gb))


def _ideas(V, A, B, changed, ga, gb):
    """Suggestions that come from the change itself (what moved together), not from either flight alone."""
    out = []
    ck = {c["key"] for c in changed}
    filt_changed = any(k.startswith(("gyro_lpf", "dterm_lpf", "dyn_notch", "rpm_filter", "gyro_notch", "dterm_notch", "simplified_gyro", "simplified_dterm")) for k in ck)
    pid_changed = any(k in ck for k in ("rollPID", "pitchPID", "yawPID", "d_max", "simplified_master_multiplier", "simplified_pi_gain", "simplified_d_gain"))
    if not changed:
        out.append(("info", "No tuning settings changed between these flights", "Differences come from the flying, the battery, props or conditions. To test a change, change one thing and fly the same pattern."))
    if V.get("motor_hf") == "better" and V.get("delay_dterm") == "worse":
        out.append(("info", "Quieter motors, paid for with D-term delay", "If propwash or overshoot got worse too, the extra filtering went a step too far: back the D-term low-pass halfway."))
    if V.get("motor_hf") == "worse" and filt_changed:
        out.append(("warning", "More noise reaches the motors after the filter change", "Check motor temperature. Undo the last filter change, or move it half as far."))
    for a in AXN:
        if V.get(f"os_{a}") == "worse" and V.get(f"rise_{a}") == "better":
            out.append(("info", f"{a.capitalize()} got faster but overshoots more", f"A little more D (or a little less feedforward) on {a} keeps the speed and trims the overshoot."))
        if V.get(f"os_{a}") == "better" and V.get(f"rise_{a}") == "worse":
            out.append(("info", f"{a.capitalize()} overshoots less but responds slower", f"If it feels soft, add a little feedforward on {a} rather than P."))
    if V.get("pw_ratio") == "better" and pid_changed:
        out.append(("good", "Propwash improved with the PID change", "Keep it. The next lever for propwash is D max or dynamic idle, one at a time."))
    if V.get("pw_ratio") == "worse":
        out.append(("warning", "More propwash wobble than before", "Often from more filter delay or less D. Compare the D-term delay row; if it rose, that is the likely cause."))
    if V.get("batt_waste") == "better":
        out.append(("good", "Less battery wasted holding attitude", "The tune or the props got calmer: that's flight time."))
    if V.get("hover_hz") == "changed":
        out.append(("info", "Hover motor speed changed", "Different weight (battery, camera) or props. Size-aware numbers shift with it; check the AUW and prop size for each flight."))
    if V.get("res_open") == "worse":
        out.append(("warning", "A new frame resonance is not filtered", "Something may have loosened (camera, arms, stack). Check the Spectrogram of the second flight."))
    if not out:
        out.append(("good", "No side effects spotted", "Nothing moved in opposite directions. Continue with the next step of the tune plan for the second flight."))
    return [dict(level=l, title=t, text=x) for l, t, x in out]


def _overlay(ga, gb):
    """Curves to overlay: step response per axis, filtered-gyro noise spectrum per axis."""
    o = {}
    sa, sb = ga["step"], gb["step"]
    if isinstance(sa, dict) and isinstance(sb, dict) and not sa.get("error") and not sb.get("error"):
        o["step"] = dict(t_ms=sa.get("t_ms"), t_ms_b=sb.get("t_ms"),
                         a={str(i): (sa.get(str(i)) or {}).get("median") for i in range(3)}, b={str(i): (sb.get(str(i)) or {}).get("median") for i in range(3)})
    na, nb = ga["noise"], gb["noise"]
    if isinstance(na, dict) and isinstance(nb, dict) and not na.get("error") and not nb.get("error"):
        o["noise"] = dict(fa=na.get("f"), fb=nb.get("f"), a={k: v.get("filt") for k, v in (na.get("axes") or {}).items()}, b={k: v.get("filt") for k, v in (nb.get("axes") or {}).items()},
                          ra={k: v.get("raw") for k, v in (na.get("axes") or {}).items()}, rb={k: v.get("raw") for k, v in (nb.get("axes") or {}).items()})
    return o


def report_data(lg, prop=None, blades=None, auw=None):
    """Everything the PDF report needs, from the same (memoised) analyses as the plan."""
    G = gather(lg, prop, blades, auw)
    ok = lambda d: isinstance(d, dict) and not d.get("error")
    P, nz, st, mo, pt, pw = (G[k] for k in ("profile", "noise", "step", "motors", "pid", "propwash"))
    h = lg.headers
    out = dict(file=lg.path.name, idx=lg.idx, craft=str(h.get("Craft name", "")), firmware=str(h.get("Firmware revision", "")),
               date=str(h.get("Log start datetime", "")), dur=round(float(lg.t[-1]), 1), rate=round(float(lg.fs)),
               profile=dict(used=P["used"], derived=P.get("derived"), estimate={k: P["estimate"].get(k) for k in ("hover_hz", "hover_cmd", "confidence", "blades")}),
               score=scorecard(lg, G), plan=build_plan(lg, prop, blades, auw, G), findings={})
    if ok(st):
        out["step"] = dict(t_ms=st.get("t_ms"), axes={str(i): dict(median=(st.get(str(i)) or {}).get("median"), metrics=(st.get(str(i)) or {}).get("metrics"),
                                                                     verdict=(st.get(str(i)) or {}).get("verdict")) for i in range(3)})
    if ok(nz):
        out["noise"] = dict(f=nz.get("f"), axes={k: dict(raw=v.get("raw"), filt=v.get("filt")) for k, v in (nz.get("axes") or {}).items()},
                            delay=nz.get("delay"), metrics=nz.get("metrics"))
    if ok(pw):
        out["propwash"] = dict(events=[{k: e[k] for k in ("t", "ratio", "cls", "axis")} for e in (pw.get("events") or [])], axes=pw.get("axes"))
    if ok(mo) and mo.get("power"):
        out["power"] = {k: mo["power"].get(k) for k in ("total", "parts", "elec", "tw", "hover_cmd")}
    for k, d in (("noise", nz), ("step", st), ("health", mo), ("pid", pt), ("propwash", pw)):
        if ok(d):
            fl = d.get("findings") or []
            if k == "step":
                fl = [f for i in range(3) for f in ((d.get(str(i)) or {}).get("findings") or [])]
            out["findings"][k] = fl
    return out
