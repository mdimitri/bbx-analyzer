"""Motor & prop health: per-motor vibration via order tracking, load balance, RPM-per-command, desync detection.

Order tracking: each motor's phase φ_m(t) = 2π∫f_m dt is integrated from its eRPM, and the raw gyro is demodulated
at k·φ_m and averaged over 0.5 s Hann windows. Vibration locked to motor m survives; other motors average out when
their frequency differs by more than ~5 Hz. Windows where motors are closer than that are discarded.
Assumes Betaflight default Quad X order: M1 rear-right, M2 front-right, M3 rear-left, M4 front-left.
"""
import numpy as np
from tuning import finding

POS = ["rear-right", "front-right", "rear-left", "front-left"]
MIX = np.array([[-1, 1, -1], [-1, -1, 1], [1, 1, 1], [1, -1, -1]])  # BF QuadX rows: roll, pitch, yaw per motor
ORDERS = [1, 2, 3]


def _order_track(g, f, fs, win=1.0, sep_hz=3.0, hop=0.25):
    """g: 3×N gyro (slow motion removed), f: M×N motor Hz. Returns per order: windows×motors amplitude (nan = unusable)."""
    M, N = f.shape
    W = int(win * fs)
    w = np.hanning(W); w /= w.sum()
    starts = np.arange(0, N - W, max(1, int(hop * fs)))   # 1 s Hann windows (±2 Hz resolution), 0.25 s apart
    ph = 2 * np.pi * np.cumsum(f, 1) / fs
    fm = np.stack([f[:, s:s + W].mean(1) for s in starts])  # windows × motors
    out = {}
    for k in ORDERS + [1.5]:  # 1.5× = non-synchronous reference → noise floor
        A = np.full((len(starts), M), np.nan)
        for m in range(M):
            z = g * np.exp(-1j * k * ph[m])[None]
            a = np.stack([np.linalg.norm(2 * np.abs((z[:, s:s + W] * w).sum(1))) for s in starts])
            others = np.delete(fm, m, 1)
            sep = np.min(np.abs(others - fm[:, [m]]), 1) * k if M > 1 else np.full(len(starts), 99.0)
            ok = (sep > sep_hz) & (fm[:, m] > 30) & (fm[:, m] * k < 0.45 * fs)
            A[ok, m] = a[ok]
        out[k] = A
    return out, fm, (starts + W // 2) / fs


def _relative(A, fm, bw=10.0):
    """Compare motors only at matching speed: in each motor-frequency bin, ratio of each motor to the bin median."""
    M = A.shape[1]
    ratios = [[] for _ in range(M)]
    edges = np.arange(30, np.nanmax(fm) + bw, bw)
    for lo in edges:
        med = []
        for m in range(M):
            sel = (fm[:, m] >= lo) & (fm[:, m] < lo + bw) & np.isfinite(A[:, m])
            med.append(np.median(A[sel, m]) if sel.sum() >= 4 else np.nan)
        med = np.array(med)
        if np.isfinite(med).sum() >= 3:
            ref = np.nanmedian(med)
            for m in range(M):
                if np.isfinite(med[m]):
                    ratios[m].append(med[m] / ref)
    return [float(np.exp(np.mean(np.log(r)))) if r else None for r in ratios]


def motor_report(lg, t0=None, t1=None, thr_min=0.0, thr_max=100.0):
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    nm = sum(f"motorHz[{i}]" in c for i in range(8))
    if nm == 0:
        return {"error": "No eRPM in this log: enable bidirectional DShot to get motor health analysis."}
    names = [f"M{i + 1}" for i in range(nm)]
    pos = POS if nm == 4 else [""] * nm
    f = np.array([c[f"motorHz[{i}]"][sl] for i in range(nm)], float)
    cmd = np.array([c[f"motor%[{i}]"][sl] for i in range(nm)], float)
    thr = c["throttle%"][sl]
    armed = thr > 0
    g = np.array([c[f"gyroUnfilt[{a}]"][sl] for a in range(3)], float)
    g -= np.array([np.convolve(x, np.ones(15) / 15, "same") for x in g])  # drop flight motion (< ~60 Hz)
    if g.shape[1] < fs * 3:
        return {"error": "Select at least 3 s."}
    A, fm, tw = _order_track(g, f, fs)
    # optional throttle band: keep only windows flown in that band
    W = int(1.0 * fs)
    thw = np.array([thr[int(round((x - 0.5) * fs)):int(round((x - 0.5) * fs)) + W].mean() for x in tw])
    keep = (thw >= thr_min) & (thw <= thr_max)
    if keep.sum() < 8:
        return {"error": f"Too little flight between {thr_min:.0f} and {thr_max:.0f}% throttle: widen the throttle band."}
    for k in A:
        A[k][~keep] = np.nan
    fmk = fm[keep]
    floor = float(np.nanmedian(A[1.5]))
    out = {"motors": names, "pos": pos, "floor": round(floor, 2), "findings": []}
    F = out["findings"]

    # ---- vibration per order ----
    vib = {}
    for k in ORDERS:
        vib[k] = dict(abs=[None if np.isnan(v) else round(float(v), 2) for v in np.nanmedian(A[k], 0)],
                      rel=[None if r is None else round(r, 2) for r in _relative(A[k], fm)],
                      n=[int(np.isfinite(A[k][:, m]).sum()) for m in range(nm)])
    out["vib"] = {str(k): v for k, v in vib.items()}
    # amplitude vs motor speed: sliding 12 Hz bins every 2 Hz (overlapping → smooth trend), 3-point smoothing
    lo_, hi_ = np.nanpercentile(fmk, [2, 98])
    ctr = np.arange(max(30, lo_), hi_ + 2, 2.0)
    out["vs_speed"] = {}
    for k in (1, 2):
        rows = []
        for m in range(nm):
            ys = np.full(len(ctr), np.nan)
            for j, cc in enumerate(ctr):
                sel = (np.abs(fm[:, m] - cc) < 6) & np.isfinite(A[k][:, m])
                if sel.sum() >= 4:
                    ys[j] = np.median(A[k][sel, m])
            sm = ys.copy()
            for j in range(1, len(ys) - 1):
                w = ys[j - 1:j + 2]
                if np.isfinite(w).sum() >= 2:
                    sm[j] = np.nansum(w * np.array([.25, .5, .25])) / np.sum(np.array([.25, .5, .25])[np.isfinite(w)])
            rows.append([None if not np.isfinite(v) else round(float(v), 2) for v in sm])
        out["vs_speed"][str(k)] = rows
    out["speed_bins"] = ctr.round(1).tolist()
    out["speed_p"] = [round(float(v), 1) for v in np.nanpercentile(fmk, [5, 95])]
    out["windows"] = int(keep.sum())
    # 1× over time (rolling median over ~5 s)
    k5 = 10
    ts = []
    for m in range(nm):
        a = A[1][:, m]
        sm = [np.nanmedian(a[max(0, i - k5):i + k5 + 1]) if np.isfinite(a[max(0, i - k5):i + k5 + 1]).sum() >= 3 else np.nan for i in range(len(a))]
        ts.append([None if np.isnan(v) else round(float(v), 2) for v in sm])
    out["time"] = {"t": (tw + lg.t[sl][0]).round(2).tolist(), "v1": ts}

    # ---- load balance (steady, low-rate flight) ----
    steady = armed & np.all([np.abs(c[f"setpoint[{a}]"][sl]) < 30 for a in range(3)], axis=0) & (cmd.max(0) < 95)
    out["steady_s"] = round(float(steady.sum() / fs), 1)
    if steady.sum() > fs * 5:
        d = cmd[:, steady].mean(1)
        off = d - d.mean()
        out["cmd_offset"] = off.round(2).tolist()
        out["cmd_mean"] = round(float(d.mean()), 1)
    # ---- RPM at equal command (5% bins, relative to motor average) ----
    rr = [[] for _ in range(nm)]
    for lo in range(5, 95, 5):
        med = []
        for m in range(nm):
            s = armed & (cmd[m] >= lo) & (cmd[m] < lo + 5)
            med.append(np.median(f[m, s]) if s.sum() > fs * 0.3 else np.nan)
        med = np.array(med)
        if np.isfinite(med).sum() == nm:
            for m in range(nm):
                rr[m].append(med[m] / med.mean())
    out["rpm_dev"] = [round((float(np.mean(r)) - 1) * 100, 2) if r else None for r in rr]

    # ---- desync / eRPM dropouts: the speed collapses within 30 ms while the command holds or rises. Spin-up lag can't trigger
    # this (speed rises then), and neither can braking (the command falls first). A reading of exactly 0 for a few ms with
    # the motor back at speed right after is a telemetry glitch, not the motor.
    ev = []
    Wd = max(2, int(0.03 * fs))
    for m in range(nm):
        cs = np.convolve(cmd[m], np.ones(max(3, int(0.02 * fs))) / max(3, int(0.02 * fs)), "same")
        fb, cb = np.r_[np.full(Wd, np.nan), f[m, :-Wd]], np.r_[np.full(Wd, np.nan), cs[:-Wd]]
        bad = armed & (cs > 25) & (fb > 30) & (f[m] < 0.6 * fb) & (cs >= cb - 2)
        e_ = np.flatnonzero(np.diff(np.r_[0, bad.astype(int), 0]))
        for s0, s1 in zip(e_[::2], e_[1::2]):
            ref = fb[s0]
            k1 = s0 + int(np.argmax(np.r_[f[m, s0:s0 + int(0.3 * fs)], [np.inf]] >= 0.8 * ref))
            seg = f[m, s0:max(k1, s1)]
            ev.append(dict(motor=m, t=round(float(lg.t[sl][s0]), 2), ms=round(float(max(k1 - s0, s1 - s0) / fs * 1000), 1),
                           zero=bool(len(seg) and (seg == 0).any() and (k1 - s0) / fs < 0.01), cmd=round(float(cs[s0]), 1), hz=round(float(ref), 1)))
    out["events"] = ev

    # ---------- diagnosis ----------
    rel1, rel2, rel3 = vib[1]["rel"], vib[2]["rel"], vib[3]["rel"]
    # how stable is each motor's ratio? resample the 1 s windows (bootstrap) and keep the 5th percentile
    rng = np.random.default_rng(0)
    boot = {k: [] for k in ORDERS}
    for _ in range(60):
        j = rng.integers(0, len(fm), len(fm))
        for k in ORDERS:
            boot[k].append([np.nan if v is None else v for v in _relative(A[k][j], fm[j])])
    lo5 = {k: np.nanpercentile(np.array(boot[k], float), 5, axis=0) for k in ORDERS}
    for k in ORDERS:
        vib[k]["rel_lo"] = [None if not np.isfinite(v) else round(float(v), 2) for v in lo5[k]]
    out["vib"] = {str(k): v for k, v in vib.items()}
    lab = lambda m: f"{names[m]}{' (' + pos[m] + ')' if pos[m] else ''}"
    worst1 = max(range(nm), key=lambda m: rel1[m] or 0)
    if rel1[worst1] and rel1[worst1] > 1.6 and np.isfinite(lo5[1][worst1]) and lo5[1][worst1] > 1.3:
        F.append(finding("serious" if lo5[1][worst1] > 2.0 else "warning", f"{lab(worst1)}: {rel1[worst1]:.1f}× more once-per-turn vibration than the others (at least {lo5[1][worst1]:.1f}×)",
                         "Probably an out-of-balance prop or motor.",
                         "This vibration turns in step with that motor, so it belongs to it. It was compared with the other motors at the same speed, and the ratio holds when the flight's 1 s windows are resampled (lower bound shown). Something off-balance shakes the frame once per revolution, harder and harder as RPM rises (force ∝ RPM²): the classic sign of an unbalanced prop or bell.",
                         "In this order: 1) fit a fresh prop; 2) check the prop nut is tight and the prop sits flat; 3) spin the motor by hand and look for a bent shaft or wobbling bell; 4) look for dirt or a loose magnet inside the bell. "
                         f"To tell prop from motor: swap the {names[worst1]} prop with a quiet motor's prop of the same spin direction and log again. If the vibration follows the prop, it's the prop. If it stays at that corner, it's the motor or the arm (part of a difference can also come from how far that arm is from the flight controller).",
                         "A prop is cheap. A bent shaft means a new bell or motor."))
    elif rel1[worst1] and rel1[worst1] > 1.6:
        F.append(finding("info", f"{lab(worst1)}: once-per-turn vibration {rel1[worst1]:.1f}× the others, but not consistently",
                         f"Resampling the flight puts it anywhere from {lo5[1][worst1]:.1f}× up: not conclusive.",
                         "The ratio changes a lot between parts of the flight (different speeds, manoeuvres), so this flight doesn't prove an imbalance. "
                         "If it shows up again on the next flight, treat it as real.", "", ""))
    else:
        F.append(finding("good", "Once-per-turn vibration is even across motors",
                         " · ".join(f"{names[m]} {rel1[m]:.2f}×" for m in range(nm) if rel1[m]),
                         "Each number is that motor's once-per-turn vibration compared with a typical motor at the same speed (1.00 = typical). Within about ±40% is normal variation."))
    try:
        prof = lg.profile()
        blades, bconf = int(prof["used"]["blades"]), prof["estimate"].get("blade_conf", "low")
    except Exception:
        blades, bconf = 3, "low"
    out["blades"] = blades
    for k, rel in ((2, rel2), (3, rel3)):
        if k != blades:   # only the blade-pass order means "a blade": other orders are harmonics of the 1× imbalance
            continue
        wk = max(range(nm), key=lambda m: rel[m] or 0)
        hi = [m for m in range(nm) if rel[m] and rel[m] > 1.6 and np.isfinite(lo5[k][m]) and lo5[k][m] > 1.3]
        if len(hi) >= 2 and nm == 4 and set(hi) in ({1, 3}, {0, 2}):
            side = "front" if set(hi) == {1, 3} else "rear"
            F.append(finding("warning", f"{side.title()} motors: {k}× vibration {min(rel[m] for m in hi):.1f}–{max(rel[m] for m in hi):.1f}× the {('rear' if side == 'front' else 'front')} pair",
                             f"{k} pulses per turn = each blade of a {k}-blade prop passing something: a problem shared by the {side} pair.",
                             f"Each blade gives a small pulse when it passes an obstacle, or when the arm under it flexes. When a whole pair is affected rather than one motor, the usual causes are: props passing close to the frame, camera, antenna or action-cam mount; {side} arms flexing or cracked; or older / different props on the {side} pair.",
                             f"Check the clearance around the {side} props, the arm screws and stiffness, and try fresh props on the {side} pair.",
                             "Mostly a noise and video-jello issue: the RPM filter's 2× and 3× notches already remove most of it from the gyro."))
        elif rel[wk] and rel[wk] > 1.8 and np.isfinite(lo5[k][wk]) and lo5[k][wk] > 1.4 and not (rel1[wk] and rel1[wk] > 1.6):
            F.append(finding("warning", f"{lab(wk)}: blade-pass ({k}×) vibration {rel[wk]:.1f}× the others",
                             f"One blade is probably different, or the shaft is bent.",
                             f"{k} pulses per turn is what each blade of a {k}-blade prop produces. If only one motor shows it, one blade on that prop likely differs (nicked tip, bent, different pitch), or the prop doesn't sit square on the shaft.",
                             f"Replace the {names[wk]} prop; if it stays, check the shaft for a bend.", "One prop."))
    if nm == 4 and "cmd_offset" in out:
        off = np.array(out["cmd_offset"])
        R, P, Y = MIX.T @ off / 4
        mx = np.abs(off).max()
        comp = f"roll {R:+.1f}, pitch {P:+.1f}, yaw {Y:+.1f} (% motor)"
        if mx < 1.5:
            F.append(finding("good", "Motors share the load evenly", f"In calm flight no motor works more than {mx:.1f}% harder than average.",
                             f"Average motor command over {out['steady_s']:.0f} s of calm flight differs by less than 1.5% between motors: the quad is well balanced. Breakdown: {comp}."))
        else:
            a = np.abs([R, P, Y])
            if a[2] > 2 * max(a[0], a[1]):
                hiP = "M2/M3" if Y > 0 else "M1/M4"
                F.append(finding("warning" if a[2] > 3 else "info", f"Constant yaw twist: diagonal pair {hiP} works {2 * a[2]:.1f}% harder",
                                 "Something keeps trying to turn the quad.",
                                 f"Diagonal motors spin the same way. When one diagonal pair must constantly work harder, the quad is fighting a steady turning force (torque). Breakdown: {comp}.",
                                 "Look for a tilted or twisted motor (bent arm, motor not flat on the arm), more worn props on one pair, or mixed prop types. Check motor alignment with a straight edge.",
                                 "Wasted thrust and less yaw authority in one direction."))
            elif max(a[0], a[1]) > 1.2 * a[2] and min(a[0], a[1]) < 0.5 * max(a[0], a[1]) or a[2] < 0.4 * max(a[0], a[1]):
                if a[1] >= a[0]:
                    side = "front" if P < 0 else "rear"
                else:
                    side = "right" if R < 0 else "left"
                F.append(finding("warning" if max(a[0], a[1]) > 3 else "info",
                                 (f"Heavy toward the {side}: {side} motors work {2 * max(a[0], a[1]):.1f}% harder" if side in ("left", "right")
                                  else f"{side.title()} motors work {2 * max(a[0], a[1]):.1f}% harder than the {'rear' if side == 'front' else 'front'} pair"),
                                 f"The centre of gravity sits toward the {side}." if side in ("left", "right") else
                                 f"Weight toward the {side}, or a steady nose-{'down' if side == 'front' else 'up'} moment from the frame and camera in forward flight.",
                                 f"Both {side} motors need more throttle than the opposite pair just to stay level, with no twist involved: weight shifted to the {side}"
                                 + (", and/or, in fast forward flight, a steady pitching moment from the frame and camera (common on builds that cruise a lot)" if side in ("front", "rear") else "")
                                 + f". Breakdown: {comp}.",
                                 f"Move the battery (or other heavy parts) away from the {side} until the difference is under ~1%.",
                                 f"The {side} motors run hotter and max out first on punch-outs."))
            else:
                k_ = int(np.argmax(np.abs(off)))
                rd = out["rpm_dev"][k_]
                why = ("It also spins faster than the others for the same command, so its prop makes less thrust per turn: most likely a damaged, bent or wrong prop."
                       if rd is not None and rd > 2 else
                       "It spins normally or slower for the same command, so the motor itself (bearings, bent shaft, winding) or its ESC channel is the suspect."
                       if rd is not None and rd < -2 else "Its speed for a given command looks normal, so check the prop first, then the motor.")
                F.append(finding("warning" if abs(off[k_]) >= 3 else "info", f"{lab(k_)} works {off[k_]:+.1f}% vs average", "One motor carries a different load from the others.", why,
                                 f"Swap the {names[k_]} prop. If nothing changes, swap two motors between corners and see if the difference follows the motor.",
                                 "A prop is cheap; a motor swap takes 10 minutes."))
    rdev = [r for r in out["rpm_dev"] if r is not None]
    if rdev and max(abs(r) for r in rdev) > 4:
        k_ = int(np.nanargmax(np.abs([r if r is not None else 0 for r in out["rpm_dev"]])))
        r = out["rpm_dev"][k_]
        F.append(finding("warning", f"{lab(k_)} spins {r:+.1f}% vs the others for the same command",
                         "Its motor or prop behaves differently." if abs(r) < 8 else "Clearly a different motor or prop.",
                         "Faster for the same command = easier to turn (chipped, smaller or flatter prop). Slower = harder to turn, or a weak motor (dragging bearings, bent shaft, damaged winding, different KV).",
                         "Check the prop, then spin the motor by hand and feel for roughness. Compare its temperature with the others right after landing.", ""))
    elif rdev:
        F.append(finding("good", "All motors spin equally fast for the same command",
                         " · ".join(f"{names[m]} {r:+.1f}%" for m, r in enumerate(out["rpm_dev"]) if r is not None),
                         "Speed for the same command is within ±4% on all motors, so motors, ESCs and props are behaving alike."))
    if ev:
        by = {}
        for e in ev:
            by.setdefault(e["motor"], []).append(e)
        for m, es in by.items():
            tele = all(e["zero"] for e in es)
            F.append(finding("info" if tele else "serious" if len(es) > 2 else "warning", f"{lab(m)}: {len(es)} RPM dropout(s)" + (" (telemetry)" if tele else ""),
                             "The speed reading briefly dropped to 0: a reporting glitch, not a real problem." if tele else "The motor lost speed while it was being asked to keep spinning: possible desync.",
                             "At " + ", ".join(f"{e['t']} s ({e['hz']:.0f} Hz → below 60% within 30 ms, command {e['cmd']:.0f}% and not falling, recovered after {e['ms']:.0f} ms)" for e in es[:4]) + ".",
                             "Harmless if rare. If frequent, check the ESC signal wire and ground." if tele else
                             "A desync is when the ESC loses track of the motor position and the motor stutters. Check motor wires and solder joints, and the motor for damage. Try higher motor timing or a lower DShot rate, and update the ESC firmware.",
                             "" if tele else "Desyncs can cause crashes: don't ignore them."))
    else:
        F.append(finding("good", "No desyncs or speed dropouts", "Every motor followed its command."))
    # vibration change during flight: each motor relative to the others at the same moment (cancels RPM changes)
    A1 = A[1]
    okw = np.isfinite(A1).sum(1) >= 3
    with np.errstate(all="ignore"):
        import warnings
        warnings.simplefilter("ignore", RuntimeWarning)
        relt = np.where(okw[:, None], A1 / np.nanmedian(A1, 1, keepdims=True), np.nan)
    def roll_med(v, k=10):  # ~5 s rolling median (windows are 0.25 s apart)
        o = np.full(len(v), np.nan)
        for i in range(len(v)):
            seg = v[max(0, i - k):i + k + 1]
            if np.isfinite(seg).sum() >= 5:
                o[i] = np.nanmedian(seg)
        return o
    out["time"]["rel"] = [[None if not np.isfinite(v) else round(float(v), 2) for v in roll_med(relt[:, m])] for m in range(nm)]
    try:
        out["power"] = motor_power(lg, sl)
        F.extend(power_findings(out["power"]))
    except Exception as e:  # never break the motor report
        out["power"] = None
    order = {"serious": 0, "warning": 1, "info": 2, "good": 3}
    F.sort(key=lambda x: order[x["level"]])
    return out


def motor_power(lg, sl):
    """Where motor energy goes beyond what flying needs. Two views, both from the log:

    1. Prop power (aerodynamic): prop power ∝ ω³, thrust ∝ ω², so for the same total thrust unequal motor speeds cost
       ≈ 1.5·var(Δω/ω). Exact total from eRPM, split by frequency band (steady imbalance / manoeuvres / corrections / vibration).
    2. Electrical: each motor is a DC-motor-like load, duty·Vbat = kE·ω + I·R. From steady flight we fit
       duty = a·ω + b·ω² (back-EMF term + resistive term; R² ≈ 0.97–0.997 on the reference logs, and 1/a matches the
       motor KV × battery voltage). Battery power ∝ duty·(duty − a·ω). Fast command swings the rotor can't follow drive
       current back and forth through R without making thrust: their extra battery power is mean(d̃·(d̃ − a·ω̃)) for the
       band-passed parts, relative to the smooth part. Measured with the sticks still (holding attitude, not flying moves).
       Uncertainty: refit on each third of the flight (battery sag changes a and b) → range.
    """
    from tuning import _band, resonances
    c, fs = lg.cols, lg.fs
    nm = sum(f"motorHz[{i}]" in c for i in range(8))
    if nm < 3:
        return None
    W = np.array([c[f"motorHz[{i}]"][sl] for i in range(nm)], float)
    M = np.array([c[f"motor%[{i}]"][sl] for i in range(nm)], float)
    thr = c["throttle%"][sl]
    wm = W.mean(0)
    calm = (thr > 8) & (np.abs(np.gradient(thr) * fs) < 20) & (wm > 20)
    if calm.sum() < fs * 2:
        return None
    w_h = float(np.median(wm[calm]))
    ok = (thr > 8) & (wm > 0.6 * w_h) & (W.min(0) > 0.25 * w_h)
    if ok.sum() < fs * 3:
        return None
    # ---- 1. prop power ----
    P = np.sum(W ** 3, 0); T = np.sum(W ** 2, 0); Pu = nm * (T / nm) ** 1.5
    tot = float(np.sum(P[ok]) / np.sum(Pu[ok]) - 1)
    x = np.where(ok, (W - wm) / np.maximum(wm, 1), 0.0)
    wgt = (wm ** 3)[ok] / np.mean((wm ** 3)[ok])
    raw = {}
    for lab, lo, hi in (("steady", None, 0.2), ("manoeuvre", 0.2, 3), ("correction", 3, 80), ("vibration", 80, None)):
        xb = np.array([_band(xi, fs, lo, hi) for xi in x])
        raw[lab] = 1.5 * float(np.mean((xb ** 2)[:, ok] * wgt))
    s_ = sum(raw.values()) or 1
    parts = {k: tot * v / s_ for k, v in raw.items()}
    # ---- 2. electrical ----
    elec = None
    if all(f"motor[{i}]" in c for i in range(nm)):
        D = np.array([c[f"motor[{i}]"][sl] for i in range(nm)], float) / 2047.0
        lp = lambda v, f: _band(v, fs, None, f) + v.mean()
        Ws, Ds = np.array([lp(w, 3) for w in W]), np.array([lp(d, 3) for d in D])
        st = ok & (np.abs(np.gradient(Ws.mean(0)) * fs) < 30)
        sp = np.max([np.abs(c[f"setpoint[{k}]"][sl]) for k in range(3)], 0)
        still = ok & (sp < 30)
        if st.sum() > 2 * fs and still.sum() > 3 * fs:
            def fit(idx):
                xx, yy = Ws[:, idx].ravel(), Ds[:, idx].ravel()
                (a_, b_), *_ = np.linalg.lstsq(np.c_[xx, xx ** 2], yy, rcond=None)
                return a_, b_, 1 - np.var(yy - a_ * xx - b_ * xx ** 2) / np.var(yy)
            a, b, r2 = fit(st)
            Wc = np.array([_band(w, fs, 3, 60) for w in W])          # eRPM above ~60 Hz is telemetry jitter (coherence ≈ 0)
            Dc = np.array([_band(d, fs, 3, 80) for d in D]); Dv = np.array([_band(d, fs, 80, None) for d in D])
            def costs(a_):
                P0 = float(np.mean((Ds * (Ds - a_ * Ws))[:, still]))
                if P0 <= 0:
                    return None
                return (float(np.mean((Dc * (Dc - a_ * Wc))[:, still])) / P0, float(np.mean((Dv * Dv)[:, still])) / P0, P0)
            cen = costs(a)
            rng_ = [r for r in (costs(fit(ix)[0]) for ix in np.array_split(np.flatnonzero(st), 3) if len(ix) > fs) if r]
            if cen and r2 > 0.9:
                ir = float(np.median(((Ds - a * Ws) / np.maximum(Ds, 1e-3))[:, still]))
                # cost spectrum: real part of the cross-spectrum d × (d − a·ω), still-stick windows, all motors
                nper = int(2 ** round(np.log2(fs / 2)))
                ix = np.arange(0, len(thr) - nper, nper // 2)
                ix = ix[np.array([still[i:i + nper].mean() > 0.9 for i in ix], bool)] if len(ix) else ix
                spec = None
                if len(ix) >= 3:
                    w = np.hanning(nper); acc = 0
                    for m in range(nm):
                        dd = D[m][ix[:, None] + np.arange(nper)]; ww = Wc[m][ix[:, None] + np.arange(nper)]
                        dd = dd - dd.mean(1, keepdims=True)
                        Fd = np.fft.rfft(dd * w, axis=1); Fe = np.fft.rfft((dd - a * ww) * w, axis=1)
                        acc = acc + np.real(Fd * np.conj(Fe)).mean(0)
                    ff = np.fft.rfftfreq(nper, 1 / fs); dens = 2 * acc / nm / (w ** 2).sum() / nper
                    pct = dens / cen[2] * 100                       # extra % of battery power in each bin
                    sel = ff >= 3
                    spec = dict(f=ff[sel].round(1).tolist(), pct=np.round(pct[sel], 4).tolist())
                    # dominant cost frequency and what it is
                    pk = ff >= 8                                       # below ~8 Hz the rotor follows: that's ordinary control effort
                    k = int(np.argmax(np.where(pk, pct, -1))); fk = float(ff[k])
                    res = [r["f"] for r in resonances(lg, float(lg.t[sl.start]), float(lg.t[sl.stop - 1]))["list"]] if len(thr) > fs * 10 else []
                    mh = float(np.median(wm[still]))
                    what = next((f"frame resonance at {r:.0f} Hz" for r in res if abs(fk - r) <= max(2.5, 0.06 * r)), None)
                    if what is None and abs(fk / mh - round(fk / mh)) < 0.06 and round(fk / mh) >= 1:
                        what = f"motor speed ×{round(fk / mh)}"
                    if what is None:
                        what = "the control loop" if fk < 30 else "an unconfirmed vibration or oscillation" if fk < 80 else "noise passing the filters"
                    spec.update(peak_f=round(fk, 1), peak_what=what, peak_share=round(float(min(1.0, max(0.0, pct[max(0, k - 2):k + 3].sum()) / max(pct[sel][pct[sel] > 0].sum(), 1e-9))), 2))
                elec = dict(corr=round(cen[0] * 100, 2), vib=round(cen[1] * 100, 2),
                            corr_rng=[round(min(r[0] for r in rng_ + [cen]) * 100, 2), round(max(r[0] for r in rng_ + [cen]) * 100, 2)],
                            vib_rng=[round(min(r[1] for r in rng_ + [cen]) * 100, 2), round(max(r[1] for r in rng_ + [cen]) * 100, 2)],
                            ir=round(ir, 2), r2=round(float(r2), 3), full_hz=round(1 / a, 0), still=round(float(still.sum() / ok.sum()) * 100),
                            cmd_corr=round(float(np.sqrt(np.mean(Dc[:, still] ** 2))) * 100, 2), cmd_vib=round(float(np.sqrt(np.mean(Dv[:, still] ** 2))) * 100, 2),
                            spec=spec)
    cb = np.array([_band(m, fs, 80, None) for m in M])
    buzz = float(np.sqrt(np.mean((cb ** 2)[:, ok])))
    mc = M.mean(0)
    full = ok & (M.min(0) >= 97)
    if full.sum() >= max(10, 0.02 * fs):
        w_max, how = float(np.percentile(wm[full], 90)), "seen"
    elif mc[ok].max() >= 85:
        sel = ok & (mc > 10)
        p = np.polyfit(mc[sel], wm[sel], 2)
        w_max, how = float(np.polyval(p, 100)), "extrapolated"
        if not (w_h < w_max < 4 * w_h):
            w_max, how = None, None
    else:
        w_max, how = None, None
    air = thr > 8
    sat_hi = float(np.mean(M[:, air].max(0) >= 99.5)) if air.any() else 0.0
    try:
        sp_ = np.max([np.abs(c[f"setpoint[{k}]"][sl]) for k in range(3)], 0)
        k2 = max(1, int(0.2 * fs)); thr_s = np.convolve(thr, np.ones(k2) / k2, "same")   # 0.2 s smoothed throttle
        samples = _power_samples(M, ok & (sp_ < 30), ok & (np.abs(np.gradient(thr_s) * fs) < 40) & (sp_ < 80), fs)
    except Exception:
        samples = None
    return {"total": round(tot * 100, 2), "parts": {k: round(v * 100, 3) for k, v in parts.items()}, "elec": elec,
            "buzz": round(buzz, 2), "hover_hz": round(w_h, 1), "max_hz": None if w_max is None else round(w_max, 1), "max_how": how,
            "tw": None if w_max is None else round((w_max / w_h) ** 2, 2), "hover_cmd": round(float(np.median(mc[calm])), 1),
            "sat_hi": round(sat_hi * 100, 2), "cover": round(float(ok.mean()) * 100, 1), "samples": samples}


def _power_samples(M, still, steady, fs):
    """Short, representative motor-command clips for the battery panel, each with the 'battery-optimal' line it should
    follow: twitching (3–80 Hz swings around the 3 Hz-smoothed command), buzzing (>80 Hz around the 80 Hz-smoothed
    command) and uneven load (each motor's slow average vs the average of all motors). Windows are picked at the 75th
    percentile of the effect among still-stick stretches: typical for this flight, but large enough to see."""
    from tuning import _band
    nm = len(M)
    r = lambda a, k=1: [round(float(v), 2) for v in a[::k]]
    out = {}
    W1 = int(1.0 * fs)
    run = np.convolve(still.astype(float), np.ones(W1), "valid") >= W1 - 1
    if run.any():
        hp = np.array([_band(m, fs, 3, 80) for m in M])
        ce = np.convolve((hp ** 2).sum(0), np.ones(W1), "valid")
        starts = np.flatnonzero(run)[:: max(1, int(0.25 * fs))]
        s0 = int(starts[np.argsort(ce[starts])[int(0.75 * (len(starts) - 1))]])
        seg = slice(s0, s0 + W1)
        m = int(np.argmax((hp[:, seg] ** 2).sum(1)))
        mid = _band(M[m], fs, None, 80) + M[m].mean()
        opt = _band(M[m], fs, None, 3) + M[m].mean()
        k = max(1, int(fs / 500))
        out["twitch"] = dict(motor=m, dt=k / fs, cmd=r(mid[seg], k), opt=r(opt[seg], k))
        hv = (M[m] - mid)[seg] ** 2                                  # buzz: 0.15 s inside the same window, where it is strongest
        W2 = int(0.15 * fs)
        if len(hv) > W2:
            b0 = s0 + int(np.argmax(np.convolve(hv, np.ones(W2), "valid")))
            out["buzz"] = dict(motor=m, dt=1 / fs, cmd=r(M[m][b0:b0 + W2]), opt=r(mid[b0:b0 + W2]))
    W3 = int(3.0 * fs)
    run = np.convolve(steady.astype(float), np.ones(W3), "valid") >= 0.8 * W3
    if run.any():
        lo = np.array([_band(m, fs, None, 0.5) + m.mean() for m in M])
        spread = np.convolve(np.abs(lo - lo.mean(0)).mean(0), np.ones(W3), "valid")
        starts = np.flatnonzero(run)[:: max(1, int(0.5 * fs))]
        s0 = int(starts[np.argsort(spread[starts])[int(0.75 * (len(starts) - 1))]])
        seg = slice(s0, s0 + W3); k = max(1, int(fs / 50))
        out["uneven"] = dict(dt=k / fs, motors=[r(lo[i][seg], k) for i in range(nm)], opt=r(lo[:, seg].mean(0), k))
    return out or None


def power_findings(p):
    F = []
    if not p:
        return F
    pt, e = p["parts"], p.get("elec")
    if e:
        waste = e["corr"] + e["vib"]
        sp = e.get("spec") or {}
        where = f" The biggest single cost sits at {sp['peak_f']:.0f} Hz: {sp['peak_what']} ({sp['peak_share'] * 100:.0f}% of it)." if sp.get("peak_f") else ""
        lvl = "good" if waste < 1.5 else "info" if waste < 4 else "warning" if waste < 10 else "serious"
        F.append(finding(lvl, f"Holding attitude costs about {waste:.1f}% extra battery power (range {e['corr_rng'][0] + e['vib_rng'][0]:.1f}–{e['corr_rng'][1] + e['vib_rng'][1]:.1f}%)",
            {"good": "The motors are not being driven up and down much more than needed.", "info": "Some energy goes into driving the motors up and down without making thrust.",
             "warning": "A noticeable share of the battery goes into driving the motors up and down without making thrust.",
             "serious": "A large share of the battery goes into motor commands that swing back and forth without making thrust."}[lvl],
            f"With the sticks still, the motor commands swing by {e['cmd_corr']:.1f}% (3–80 Hz) and {e['cmd_vib']:.1f}% (above 80 Hz) of full range. "
            f"Swings faster than the rotor can follow push current back and forth through the windings, ESC and battery: heat, not thrust. "
            f"PID corrections 3–80 Hz: +{e['corr']:.1f}%, vibration above 80 Hz: +{e['vib']:.1f}% of battery power.{where} "
            f"How it's measured: duty = a·speed + b·speed² was fitted to steady flight (fit R² {e['r2']}); the resistive part is {e['ir'] * 100:.0f}% of the hover voltage. "
            f"The range comes from refitting on each third of the flight (battery sag).",
            ("Find the source first: " + ("a notch on the resonance (Noise tab → Filter planner) or a mechanical fix" if "resonance" in sp.get("peak_what", "") else
             "the RPM filter (it sits on a motor order)" if "motor" in sp.get("peak_what", "") else
             "more D-term filtering or less D (it sits above 80 Hz)" if "filters" in sp.get("peak_what", "") else
             "the PID terms tab (Behaviour) for loop oscillation")) if lvl in ("warning", "serious") else "",
            "Hot motors after a short hover confirm it." if lvl in ("warning", "serious") else ""))
    F.append(finding("info" if p["total"] < 3 else "warning", f"Unequal motor speeds cost about {p['total']:.1f}% extra prop power",
        "For the same total thrust, motors spinning at different speeds draw more power than motors at the same speed.",
        f"Split: steady imbalance {pt['steady']:.2f}% · flying the moves {pt['manoeuvre']:.2f}% · corrections 3–80 Hz {pt['correction']:.2f}% · vibration above 80 Hz {pt['vibration']:.2f}%. "
        f"Prop power goes with speed³ and thrust with speed², so the cost is about 1.5 × the variance of each motor's speed around the average (from eRPM, {p['cover']:.0f}% of the selection usable). "
        "This is the aerodynamic side only; the electrical cost of fast command swings is the finding above.",
        "The steady part is a CG offset, a bent or mismatched prop, or a weaker motor: rebalance the battery position and swap props to find it." if pt["steady"] >= 0.5 else "", ""))
    if p["tw"]:
        F.append(finding("info", f"Thrust headroom about {p['tw']:.1f}:1 ({p['max_how']})",
            f"Full-throttle speed {p['max_hz']:.0f} Hz vs hover {p['hover_hz']:.0f} Hz (hover command {p['hover_cmd']:.0f}%). Thrust goes with speed², so T/W ≈ (full / hover)².",
            "Seen = measured when all motors hit ≥97% command; extrapolated = command→speed fit carried to 100% (only when the motors reached ≥85% together). Battery sag makes the real figure a little lower.", "", ""))
    if p["sat_hi"] >= 2:
        F.append(finding("warning", f"A motor is at 100% for {p['sat_hi']:.1f}% of the flight",
            "When a motor is maxed, the PID loop loses authority on that side.",
            "Mixer saturation shows as propwash and wobble in punch-outs and fast turns.",
            "Normal on punch-outs; if it happens in turns, lower rates or check thrust headroom.", ""))
    return F
