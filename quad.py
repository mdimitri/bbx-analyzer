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
W_TYP = [(2, .075), (2.5, .12), (3, .25), (3.5, .32), (4, .42), (5, .65), (6, .80), (7, .95), (8, 1.25), (10, 1.9)]  # kg


def w_typ(d):
    x, y = np.log([p[0] for p in W_TYP]), np.log([p[1] for p in W_TYP])
    return float(np.exp(np.interp(np.log(d), x, y)))


def d_from_hover(n, wf=1.0):
    """Prop size (inch) of a build whose weight is wf × typical for its size, hovering at n Hz (n ∝ √W at fixed size)."""
    return float(np.clip(D_REF * (n / np.sqrt(wf) / N_REF) ** (-1 / K_SIZE), 1.0, 14.0))


def name_hints(h):
    txt = f"{h.get('Craft name', '')} {h.get('Board information', '')}".lower()
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
    else:
        s = (thr > 15) & (thr < 45)
        n_h = float(np.median(mh[s])) if s.any() else float(np.median(mh[thr > 1])); src = "cruise (no calm hover found)"
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
    alts = [dict(basis="typical build weight", inch=round(d_typ, 1), range=[round(lo_t, 1), round(hi_t, 1)], weight_kg=round(w_typ(d_typ), 2))]
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
