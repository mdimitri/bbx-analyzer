"""Quad profile: estimate prop size & blade count from the log, and size-dependent reference values.

Prop size: hover physics. In steady flight each motor carries a quarter of the weight, and a prop's thrust is
T = Ct·ρ·n²·D⁴ (n = rev/s, D = diameter), so at a given weight the hover speed falls steeply with prop size. Real
builds also get heavier with size, so across typical builds hover speed follows a power law in prop size:
    n_hover ≈ 104 Hz · (7″ / D)^1.38
calibrated on measured flights (7″ ≈ 104 Hz ≈ 6,200 RPM, 2.5″ ≈ 430 Hz ≈ 26,000 RPM; the same law gives ≈165 Hz on 5″
and ≈330 Hz on 3″). A build 35 % lighter or 50 % heavier than typical for its size shifts the estimate by about ±15 %.
Blade count: blade-pass harmonic. Every blade passing an arm gives a pulse, so 2-blade props excite 2× the rotation
frequency and 3-blade props 3×. Their relative prominence in the raw gyro (motor-speed tracked) votes for the blade count.
"""
import re
import numpy as np
from tuning import tracked_noise, hnum

N_REF, D_REF, K_SIZE = 104.0, 7.0, 1.38   # hover Hz of a typical 7″ build, and the size exponent (see module doc)


def n_pl(d):
    """Hover speed (rev/s) of a typical d″ build: the calibrated power law above."""
    return float(N_REF * (D_REF / d) ** K_SIZE)


def w_typ(d, blades=3):
    """Typical all-up weight (kg) of a d″ build: what four typical props carry at the typical hover speed, so the
    size estimate, the weight estimate and the simulator's 'typical quad' all describe the same build."""
    return thrust_kg(n_pl(d), d, blades)


def d_from_hover(n, wf=1.0):
    """Prop size (inch) of a build whose weight is wf × typical for its size, hovering at n Hz (n ∝ √W at fixed size)."""
    return float(np.clip(D_REF * (n / np.sqrt(wf) / N_REF) ** (-1 / K_SIZE), 1.0, 14.0))


def name_hints(h, craft_only=False):
    txt = (f"{h.get('Craft name', '')}" if craft_only else f"{h.get('Craft name', '')} {h.get('Board information', '')}").lower()
    out = []
    m = re.search(r'(?<![\d.])(\d{1,2}(?:\.\d)?)\s*(?:"|in\b|inch|″)', txt)
    if m and 1.5 <= float(m.group(1)) <= 13:
        out.append(dict(kind="size", inch=float(m.group(1)), text=f"name contains “{m.group(0).strip()}”"))
    if re.search(r'sub[\s_-]?250|<\s?250', txt):
        out.append(dict(kind="weight", kg=(0.18, 0.249), text="name contains “sub250”: probably under 250 g"))
    if "whoop" in txt:
        out.append(dict(kind="weight", kg=(0.02, 0.12), text="name contains “whoop”"))
    if "toothpick" in txt:
        out.append(dict(kind="weight", kg=(0.05, 0.15), text="name contains “toothpick”"))
    return out


def estimate(lg):
    c, h, fs = lg.cols, lg.headers, lg.fs
    nm = [k for k in (f"motorHz[{i}]" for i in range(8)) if k in c]
    ev = []
    res = {"evidence": ev}
    if not nm:
        res.update(inch=None, blades=None, confidence="none", needs_confirm=True)
        ev.append("No motor-speed data (bidirectional DShot off): prop size can't be estimated. Please enter it.")
        return res
    thr = c["throttle%"]
    mh = np.mean([c[k] for k in nm], axis=0)
    acc = np.linalg.norm([c[f"accSmooth[{i}]"] for i in range(3)], axis=0) / float(h.get("acc_1G", 2048) or 2048) if "accSmooth[0]" in c else np.ones(len(mh))
    calm = (thr > 1) & np.all([np.abs(c[f"setpoint[{a}]"]) < 25 for a in range(3)], axis=0) & (np.abs(acc - 1) < 0.08)
    w = int(0.5 * fs); k = len(mh) // w
    blk = lambda x: x[: k * w].reshape(k, w).mean(1)
    cw = blk(calm.astype(float)) > 0.95
    if cw.sum() >= 5:
        n_h = float(np.median(blk(mh)[cw])); src = f"{int(cw.sum())} calm, level half-seconds"
        hm = np.zeros(len(mh), bool); hm[: k * w] = np.repeat(cw, w)
    else:
        s = (thr > 15) & (thr < 45)
        hm = s if s.any() else thr > 1
        n_h = float(np.median(mh[hm])); src = "cruise (no calm hover found)"
    # the one hover definition every tab uses: speed, motor command and throttle over the same calm stretches
    mp = [k_ for k_ in (f"motor%[{i}]" for i in range(8)) if k_ in c]
    res["hover_cmd"] = round(float(np.median(np.mean([c[k_] for k_ in mp], 0)[hm])), 1) if mp and hm.any() else None
    res["hover_thr"] = round(float(np.median(thr[hm])), 1) if hm.any() else None
    if not np.isfinite(n_h) or n_h < 10 or (thr > 10).sum() < fs:
        res.update(inch=None, blades=None, confidence="none", needs_confirm=True)
        ev.append("Too little flight in this log to estimate the prop size. Please enter it.")
        return res
    ev.append(f"Hover motor speed ≈ {n_h:.0f} Hz ({n_h * 60:.0f} RPM), from {src}, at ≈ {np.median(thr[calm]) if calm.any() else np.median(thr):.0f}% throttle.")

    # blade count from blade-pass harmonics (median over axes)
    raw = [c[f"gyroUnfilt[{a}]"] for a in range(3)]
    p2, p3 = [], []
    for a in range(3):
        hm, _, _ = tracked_noise(raw[a], c[f"gyroADC[{a}]"], [c[k_] for k_ in nm], fs, nh=4)
        d = {x["k"]: x["prominence_db"] for x in hm if x}
        if 2 in d and 3 in d:
            p2.append(d[2]); p3.append(d[3])
    if p2:
        diff = float(np.median(np.array(p2) - np.array(p3)))
        blades = 2 if diff > 0 else 3
        bconf = "high" if abs(diff) > 6 else "medium" if abs(diff) > 3 else "low"
        ev.append(f"Blade-pass: the 2× harmonic stands {abs(diff):.0f} dB {'above' if diff > 0 else 'below'} the 3× harmonic → {blades}-blade props ({bconf} confidence).")
    else:
        blades, bconf = 3, "low"
        ev.append("Blade-pass harmonics not measurable: assuming 3-blade.")

    d_typ = d_from_hover(n_h)
    lo_t, hi_t = d_from_hover(n_h, 0.65), d_from_hover(n_h, 1.5)
    alts = [dict(basis="typical build weight", inch=round(d_typ, 1), range=[round(lo_t, 1), round(hi_t, 1)], weight_kg=round(w_typ(d_typ, blades), 2))]
    ev.append(f"Typical builds hover at ≈{N_REF:.0f} Hz on 7″ and ≈430 Hz on 2.5″ (hover speed falls with prop size as a power law), "
              f"so {n_h:.0f} Hz points to ≈{d_typ:.1f}″ props. Weight isn't logged: a build 35% lighter or 50% heavier than typical would mean {lo_t:.1f}–{hi_t:.1f}″.")
    est, rng, basis, conf = d_typ, [lo_t, hi_t], "hover speed + typical build weight", "medium"
    # the pilot's own filter settings usually match their size (weak evidence, shown but not used in the estimate)
    g1, d1 = hnum(h, "gyro_lpf1_dyn_hz", 0)[0], hnum(h, "dterm_lpf1_dyn_hz", 0)[0]
    if g1 > 0 and d1 > 0:
        d_set = float(np.sqrt(5 * (250 / g1) ** 1.25 * 5 * (75 / d1) ** 1.25))
        res["settings_hint_inch"] = round(d_set, 1)
        agree = abs(d_set - est) / est < 0.2
        ev.append(f"Cross-check: your logged filter cutoffs (gyro {g1:.0f} Hz, D-term {d1:.0f} Hz min) are what people typically run on ≈{d_set:.1f}″ props, "
                  + ("which agrees." if agree else "which doesn't agree, so the size is uncertain: please confirm it."))
        if not agree:
            conf = "low"
    if abs(hnum(h, "motor_kv", 0)[0] - 1960) < 1:
        ev.append("motor_kv is 1960, Betaflight's default, so it isn't used (it's probably not your motors' real KV).")
    ev.append("Only flight data is used (motor speeds, gyro vibration, logged settings), not the craft or board name.")
    res.update(inch=round(est, 1), range=[round(rng[0], 1), round(rng[1], 1)], blades=blades, blade_conf=bconf, basis=basis,
               confidence=conf, needs_confirm=conf != "high", alternatives=alts, hover_hz=round(n_h, 1))
    return res


def size_params(d, blades=3):
    """Reference values that scale with prop size (5″ = Betaflight's tuning baseline). d in inches."""
    s = 5.0 / d
    r5 = lambda x: int(5 * round(x / 5))
    return dict(
        rise_ok_ms=round(10 + 3.5 * d),               # roll/pitch 10→90 % rise considered sluggish above this
        gyro_delay_light=round(0.2 * d, 2), gyro_delay_heavy=round(0.4 * d, 2),
        dterm_delay_light=round(0.5 * d, 2), dterm_delay_heavy=round(0.8 * d, 2),
        res_fmax=None,   # resonances are searched over the whole range the log can show
        typical={"gyro_lpf1_dyn_hz": f"{r5(250 * s ** .8)},{r5(500 * s ** .8)}", "dterm_lpf1_dyn_hz": f"{r5(75 * s ** .8)},{r5(150 * s ** .8)}",
                 "dyn_notch_min_hz": r5(100 * s ** .9), "rpm_filter_min_hz": r5(100 * s ** .9)},
        hover_rpm_hint=None,
    )


def compare_settings(h, sp):
    rows = []
    for k, typ in sp["typical"].items():
        mine = hnum(h, k, 0)
        tv = [float(x) for x in str(typ).split(",")]
        ratio = np.mean(mine[:len(tv)]) / np.mean(tv) if np.mean(tv) else 1
        rows.append(dict(key=k, yours=",".join(f"{v:.0f}" for v in mine[:len(tv)]), typical=typ, ratio=round(float(ratio), 2),
                         flag="high" if ratio > 1.4 else "low" if ratio < 0.7 else "ok"))
    return rows


# ---------------------------------------------------------------- all-up weight (AUW) and size-typical dynamics
# Motion data alone can't separate mass from prop thrust (a heavier quad on grippier props flies exactly the same), so
# the weight rests on the prop size: hover speed + a typical thrust law for that prop size gives the weight. A current
# sensor (hover power, momentum theory) is a second, independent route when it is logged.
CT = {2: 0.09, 3: 0.17, 4: 0.19, 5: 0.2, 6: 0.21}   # thrust coefficient T/(ρ n² D⁴) of typical FPV props by blade count (±30% with pitch);
# with the hover law this gives typical builds of ≈0.6 kg on 5″ tri-blades, ≈0.9 kg on 7″ tri-blades, ≈0.5 kg on light 7″ bi-blades
WB_PER_INCH = 0.044      # m of motor-to-motor diagonal per inch of prop (5″ ≈ 220 mm, 7″ ≈ 310 mm)
KAPPA = 0.6              # radius of gyration about roll/pitch ÷ motor lateral offset (typical frame + battery layout)
YAW_K = 0.12             # prop drag torque ÷ (thrust × diameter) for typical FPV props
RHO = 1.225


def ct(blades):
    return CT.get(int(blades), 0.13)


def thrust_kg(n, d, blades):
    """Weight (kg) four props of d″ carry at n rev/s: T = Ct·ρ·n²·D⁴ each."""
    return float(4 * ct(blades) * RHO * n ** 2 * (d * 0.0254) ** 4 / 9.81)


def n_typ(d, blades=3):
    """Hover speed (rev/s) of a typical d″ build (the same for every blade count: the typical weight follows the props)."""
    return n_pl(d)


def arm_y(d):
    """Lateral offset of each motor from the roll axis (m) on a typical X frame for d″ props."""
    return 0.5 * WB_PER_INCH * d * np.sqrt(0.5)


def hover_power_w(kg, d, eff=0.45):
    """Battery power to hover (W): momentum theory, ideal power T^1.5/√(2ρA), over prop figure of merit × motor+ESC efficiency."""
    T = kg * 9.81; A = 4 * np.pi * (d * 0.0254 / 2) ** 2
    return float(T ** 1.5 / np.sqrt(2 * RHO * A) / eff)


def _power_hover(lg):
    """Hover battery power from a logged current sensor (vbat in 0.01 V, amperage in 0.01 A), else None."""
    c = lg.cols
    if "vbatLatest" not in c or "amperageLatest" not in c:
        return None
    thr = c["throttle%"]; sp = np.max([np.abs(c[f"setpoint[{a}]"]) for a in range(3)], 0)
    calm = (thr > 10) & (sp < 25)
    if calm.sum() < 2 * lg.fs:
        return None
    v = float(np.median(c["vbatLatest"][calm])) / 100; i = float(np.median(c["amperageLatest"][calm])) / 100
    if not (3 < v < 60 and 0.3 < i < 250):
        return None
    return dict(w=v * i, v=v, a=i)


def auw_estimate(lg, est, inch, blades, size_src):
    """AUW (kg) for this flight: votes in log space, each with its own uncertainty, combined as a weighted mean."""
    ev, votes = [], []
    wt = w_typ(inch, blades)
    votes.append(("typical", wt, 0.5))
    ev.append(f"Typical {inch:g}″ {blades}-blade builds weigh ≈{wt * 1000:.0f} g ready to fly, but builds differ a lot (half or double is not unusual), so this only counts when nothing better is measured.")
    n_h = est.get("hover_hz")
    if n_h:
        W_h = thrust_kg(n_h, inch, blades)
        if size_src == "user":
            sd, why = 0.3, ""
        else:
            r = est.get("range") or [inch * 0.85, inch * 1.15]
            sd = float(np.hypot(0.3, 4 * np.log(r[1] / r[0]) / 2)); why = " The prop size is only estimated, and the weight goes with size⁴, so this is loose until you confirm it."
        votes.append(("hover", W_h, sd))
        ev.append(f"Hover speed {n_h:.0f} Hz ({n_h * 60:.0f} RPM) on {inch:g}″ {blades}-blade props: four props carry Ct·ρ·n²·D⁴ each, which is "
                  f"≈{W_h * 1000:.0f} g with a typical {blades}-blade thrust coefficient (prop pitch and make shift this by about ±30%).{why}")
    pw = _power_hover(lg)
    if pw:
        T = (pw["w"] * 0.45 * np.sqrt(2 * RHO * 4 * np.pi * (inch * 0.0254 / 2) ** 2)) ** (2 / 3)
        votes.append(("power", T / 9.81, 0.3))
        ev.append(f"Current sensor: {pw['w']:.0f} W in calm flight ({pw['v']:.1f} V × {pw['a']:.1f} A). Momentum theory with typical prop and motor "
                  f"efficiency turns that into ≈{T / 9.81 * 1000:.0f} g of thrust.")
    lo_hint = hi_hint = None
    for x in name_hints(lg.headers, craft_only=True):   # board names ("SUB250 RedFox") are product lines, not weights
        if x["kind"] == "weight":
            lo_hint, hi_hint = x["kg"]
    if any(b != "typical" and sd <= 0.35 for b, _, sd in votes):   # a real measurement: the size-typical weight is only a fallback
        votes = [v for v in votes if v[0] != "typical"]
    w = np.array([1 / s ** 2 for _, _, s in votes]); lw = np.array([np.log(k) for _, k, _ in votes])
    m = float((w * lw).sum() / w.sum()); s = float(1 / np.sqrt(w.sum()))
    kg = float(np.exp(m))
    if lo_hint is not None:
        kg = float(np.clip(kg, lo_hint, hi_hint))
        ev.append(f"The craft name suggests {lo_hint * 1000:.0f}–{hi_hint * 1000:.0f} g, so the estimate is kept in that range.")
    conf = "high" if s < 0.2 else "medium" if s <= 0.32 else "low"
    return dict(kg=round(kg, 3), range=[round(kg * np.exp(-s), 3), round(kg * np.exp(s), 3)], confidence=conf,
                votes=[dict(basis=b, kg=round(k, 3), sigma=sd) for b, k, sd in votes], evidence=ev)


def derived(lg, est, inch, kg):
    """Quantities that follow from the weight: hover power, and thrust headroom (shared with Motor health)."""
    out = dict(hover_w=round(hover_power_w(kg, inch)))
    hr = headroom(lg)
    if hr["tw"]:
        nm = sum(1 for i in range(8) if f"motorHz[{i}]" in lg.cols)
        out.update(twr=round(hr["tw"], 1), twr_how=hr["how"], thrust_g=round(hr["tw"] * kg * 1000 / nm))
    return out


def typical_dynamics(inch, blades, G, tau_prior_s):  # noqa: C901
    """The PID simulator's plant for a typical d″ X build at the typical weight for its size, driven by the same motors
    (G = motor speed per full command, Hz, measured from eRPM). Roll/pitch: a motor-speed change Δn changes each
    thrust by 2T/n·Δn, torque 4·ΔT·y over inertia m·(κy)², so α/Δn = 2g/(n·κ²·y) (the mass cancels once n is the hover
    speed); the PID output reaches the motors as Δcommand = u/1000. Yaw: prop drag torque ∝ thrust × diameter."""
    if not G:
        return None
    y, g, n = arm_y(inch), 9.81, n_typ(inch, blades)
    a_rp = 2 * g / (n * KAPPA ** 2 * y)                             # rad/s² per Hz of motor speed
    a_yaw = g * YAW_K * inch * 0.0254 / (n * (KAPPA * y) ** 2)
    du = G / 1000                                                   # Hz of motor speed per PID unit
    wt = w_typ(inch, blades)
    return dict(b_rp=round(float(np.degrees(a_rp) * du), 1), b_yaw=round(float(np.degrees(a_yaw) * du), 1), tau_ms=round(tau_prior_s * 1000, 1),
                delay_ms=[1.5, 4.0], kg=round(wt, 3), hover_hz=round(n, 1), arm_mm=round(y * 1000), wheelbase_mm=round(WB_PER_INCH * inch * 1000),
                inertia_gcm2=round(wt * (KAPPA * y) ** 2 * 1e7))


def implied_inertia(inch, kg, n_hover, G, b):
    """Roll/pitch inertia (g·cm²) the learned authority b implies for this weight and hover speed (same frame geometry)."""
    if not (n_hover and G and b):
        return None
    a = np.radians(b) / (G / 1000)                                  # rad/s² per Hz of motor speed, as learned
    y = arm_y(inch); kap2 = 2 * 9.81 / (n_hover * y * a)
    return round(float(kg * kap2 * y ** 2 * 1e7))


def headroom(lg):
    """Thrust headroom of the craft (whole flight, cached): motor speed at 100% command, seen in full-throttle punches or
    extrapolated from the speed-vs-command curve, against the hover speed. Thrust ∝ speed², so TWR = (max / hover)²."""
    if hasattr(lg, "_headroom"):
        return lg._headroom
    c, fs = lg.cols, lg.fs
    nm = [i for i in range(8) if f"motorHz[{i}]" in c and f"motor%[{i}]" in c]
    out = dict(max_hz=None, how=None, tw=None)
    n_h = estimate_cached(lg).get("hover_hz")
    if nm and n_h:
        W = np.array([c[f"motorHz[{i}]"] for i in nm], float); M = np.array([c[f"motor%[{i}]"] for i in nm], float)
        thr = c["throttle%"]; wm, mc = W.mean(0), M.mean(0)
        ok = (thr > 8) & (wm > 0.6 * n_h) & (W.min(0) > 0.25 * n_h)
        full = ok & (M.min(0) >= 97)
        w_max = how = None
        if full.sum() >= max(10, 0.02 * fs):
            w_max, how = float(np.percentile(wm[full], 90)), "seen"
        elif ok.any() and mc[ok].max() >= 85:
            sel = ok & (mc > 10)
            w_max, how = float(np.polyval(np.polyfit(mc[sel], wm[sel], 2), 100)), "extrapolated"
            if not (n_h < w_max < 4 * n_h):
                w_max = how = None
        if w_max:
            out = dict(max_hz=round(w_max, 1), how=how, tw=round((w_max / n_h) ** 2, 2))
    lg._headroom = out
    return out


def estimate_cached(lg):
    if not hasattr(lg, "_est"):
        lg._est = estimate(lg)
    return lg._est
