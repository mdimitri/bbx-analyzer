"""Filter delay: where it comes from, how it compares with a typical setup for this size, and what it does to the PID loop.

Method (all from first principles, nothing tuned by eye):
  • Each filter stage is evaluated with Betaflight's own discrete-time equations (tuning.lpf / tuning.notch, i.e.
    filter.c) at the rate it really runs (gyro_init.c): gyro LPF2 at the gyro sample rate; gyro LPF1, static and dynamic
    notches, RPM filter and every D-term filter at the PID loop rate. Dynamic low-pass cutoffs follow
    dynLpfGyroUpdate / dynLpfDTermUpdate (expo curve, or dynThrottle when expo = 0).
  • Phase delay of a stage at frequency f: τφ = −∠H(e^{jωT}) / ω. Phase delays of cascaded stages add, and the phase a
    stage removes from the loop at f is exactly ω·τφ, so a stacked bar of τφ per stage *is* the phase budget.
  • The frequency that matters is the loop's crossover f_c (|L| = 1), where the phase margin is decided. f_c, the
    phase margin, gain margin and peak sensitivity come from the open loop L = G_plant · C, with the plant identified
    from this log (sim.py: authority b, damping a, motor lag τ, ESC delay d, yaw spin-up λ) and C the Betaflight PID
    on measurement: C = P·Fg + I·T/(1−z⁻¹)·Fg + D·(1−z⁻¹)/T·Fg·Fd (Fg gyro chain, Fd D-term chain), the same model
    the PID simulator uses.
  • "Typical for this size": Betaflight defaults with the low-pass cutoffs scaled for the prop size (quad.size_params),
    on *this* quad's plant, so the comparison isolates the filter choice.
  • What the delay buys: motor-command noise above 80 Hz predicted from the measured raw gyro spectrum through
    |C(f)|² (mixer: Δmotor% = PID sum / 10 per axis, variances add over the axes), checked against the measured value.
"""
import numpy as np
from tuning import hnum, lpf, notch, notch_q, rpm_notch, dyn_cutoff, LPF_TYPES

KP, KI, KD = 0.032029, 0.244381, 0.000529
AXN = ["roll", "pitch", "yaw"]
PM_TARGET = 45.0          # classic robust design target (°); below ~30° a loop rings visibly
GM_TARGET = 6.0           # dB


def rates(h):
    fs_gyro = 1e6 / max(hnum(h, "looptime", 125)[0], 1)
    return fs_gyro, fs_gyro / max(hnum(h, "pid_process_denom", 1)[0], 1)


# ---------------------------------------------------------------- dynamic notch centres
def dyn_centres(lg, noise=None):
    """Where the dynamic notches sit: the logged centres when debug_mode is FFT_FREQ / DYN_LPF, else the strongest
    residual noise peaks inside dyn_notch_min..max (what the notch tracker locks onto once the RPM filter has removed
    the motor lines), else dyn_notch_min_hz (assumed: the position nearest the control band, the worst case)."""
    h = lg.headers
    n = int(hnum(h, "dyn_notch_count", 0)[0])
    if n <= 0:
        return [], "none"
    try:
        import debugmodes
        d = debugmodes.report(lg)
        if d.get("freq"):
            c = [f["median"] for f in d["freq"] if "notch" in f["label"]][:n]
            if c:
                return c, "logged (debug)"
    except Exception:
        pass
    if noise and noise.get("dyn_est"):
        return noise["dyn_est"][:n], "estimated from the noise peaks"
    lo = hnum(h, "dyn_notch_min_hz", 100)[0]
    return [lo] * n, "assumed at dyn_notch_min_hz (worst case)"


# ---------------------------------------------------------------- filter stages
LPF_ORDER = {0: 1, 1: 2, 2: 2, 3: 3}
TYPE_NAME = {0: "PT1", 1: "BIQUAD", 2: "PT2", 3: "PT3"}


def _lpf_spec(h, p, n, thr, rate_hz, rate_name, scale):
    """Spec rows of a low-pass stage p ('gyro' | 'dterm'), n (1 | 2). Returns (type, cutoff now, rows, dyn (lo, hi, expo) or None)."""
    t = int(hnum(h, f"{p}_lpf{n}_type")[0])
    dyn = None
    if n == 1:
        lo, hi = (hnum(h, f"{p}_lpf1_dyn_hz", 0) + [0])[:2]
        if lo > 0:
            ex = hnum(h, f"{p}_lpf1_dyn_expo" if p == "dterm" else "gyro_lpf1_dyn_expo", 5)[0]
            dyn = (lo * scale, hi * scale, ex)
    fc = dyn_cutoff(thr, *dyn) if dyn else hnum(h, f"{p}_lpf{n}_static_hz")[0] * scale
    rows = [["Type", TYPE_NAME.get(t, "?"), f"{p}_lpf{n}_type"]]
    if dyn:
        rows += [["Cutoff range", f"{dyn[0]:.0f}–{dyn[1]:.0f} Hz (dynamic, follows throttle)", f"{p}_lpf1_dyn_min_hz, {p}_lpf1_dyn_max_hz"],
                 ["Curve expo", f"{dyn[2]:.0f}", f"{p}_lpf1_dyn_expo" if p == "dterm" else "gyro_lpf1_dyn_expo"],
                 ["Cutoff at hover", f"{fc:.0f} Hz at {thr * 100:.0f}% throttle", None]]
    else:
        rows += [["Cutoff", f"{fc:.0f} Hz (static)", f"{p}_lpf{n}_static_hz"]]
    rows += [["Runs at", f"{rate_hz:.0f} Hz ({rate_name})", None]]
    return t, fc, rows, dyn


def stages(h, thr, motor_hz, dyn, scale_g=1.0, scale_d=1.0):
    """Every filter stage: key, label, chain ('gyro': P, I and D see it; 'dterm': D only; 'yawp': yaw P only), H(f),
    and for the explanations: kind, its numbers (spec rows with the CLI names) and its parts (each notch / harmonic).
    scale_g / scale_d multiply the gyro / D-term low-pass cutoffs (what-if)."""
    fs_g, fs_p = rates(h)
    S = []

    def add(key, label, chain, fn, kind, spec, rows, parts=None):
        S.append(dict(key=key, label=label, chain=chain, H=fn, kind=kind, spec=spec, rows=rows, parts=parts or []))
    for p, sc, chain in (("gyro", scale_g, "gyro"), ("dterm", scale_d, "dterm")):
        for n in (1, 2):
            fsr, rn = (fs_g, "gyro sample rate, it is the downsampling filter") if (p, n) == ("gyro", 2) else (fs_p, "PID loop rate")
            t, fc, rows, dy = _lpf_spec(h, p, n, thr, fsr, rn, sc)
            if fc > 0:
                nm = ("Gyro" if p == "gyro" else "D-term") + f" LPF{n}"
                add(f"{p}_lpf{n}", f"{nm} {TYPE_NAME.get(t, '?')} {fc:.0f} Hz" + (" (dynamic)" if dy else ""), chain,
                    lambda f, fc=fc, t=t, fsr=fsr: lpf(f, fsr, fc, t), "lpf", dict(type=t, fc=fc, dyn=dy, fs=fsr, p=p, n=n), rows)
        if p == "gyro":
            ns = [(c, co) for c, co in zip(hnum(h, "gyro_notch_hz"), hnum(h, "gyro_notch_cutoff")) if c > 0 and 0 < co < c]
            if ns:
                qs = [notch_q(c, co) for c, co in ns]
                rows = [[f"Notch {i + 1}", f"centre {c:.0f} Hz, cutoff {co:.0f} Hz → Q {q:.2f}", f"gyro_notch{i + 1}_hz, gyro_notch{i + 1}_cutoff"] for i, ((c, co), q) in enumerate(zip(ns, qs))]
                rows.append(["Runs at", f"{fs_p:.0f} Hz (PID loop rate)", None])
                add("gyro_notch", "Static notch" + ("es " if len(ns) > 1 else " ") + ", ".join(f"{c:.0f}" for c, _ in ns) + " Hz", "gyro",
                    lambda f, ns=ns: np.prod([notch(f, fs_p, c, notch_q(c, co)) for c, co in ns], axis=0), "notch",
                    dict(notches=[(c, q, 1.0) for (c, _), q in zip(ns, qs)]), rows,
                    [(f"{c:.0f} Hz notch (Q {q:.2f})", lambda f, c=c, q=q: notch(f, fs_p, c, q)) for (c, _), q in zip(ns, qs)])
            nh = int(hnum(h, "rpm_filter_harmonics")[0])
            if nh and motor_hz and hnum(h, "dshot_bidir")[0]:
                q = hnum(h, "rpm_filter_q", 500)[0] / 100
                w = (hnum(h, "rpm_filter_weights", 100) * 3)[:nh]
                mn, fr = hnum(h, "rpm_filter_min_hz", 100)[0], hnum(h, "rpm_filter_fade_range_hz", 50)[0]
                lst = [(k, fk, wk) for m in motor_hz for k in range(1, nh + 1) for fk, wk in [rpm_notch(h, m * k, w[k - 1] / 100)] if wk > 0]
                if lst:
                    per = {k: [(fk, wk) for kk, fk, wk in lst if kk == k] for k in range(1, nh + 1)}
                    rows = [["Notches", f"{nh} harmonics × {len(motor_hz)} motors = {len(lst)} active", "rpm_filter_harmonics"],
                            ["Q", f"{q:.2f} (every notch)", "rpm_filter_q"],
                            ["Weights", ", ".join(f"{x:.0f}%" for x in w), "rpm_filter_weights"],
                            ["Min / fade", f"{mn:.0f} Hz, fades in over {fr:.0f} Hz above it", "rpm_filter_min_hz, rpm_filter_fade_range_hz"]]
                    for k, v in per.items():
                        if v:
                            rows.append([f"Harmonic {k}", ", ".join(f"{fk:.0f}" for fk, _ in v) + " Hz" + ("" if all(abs(wk - w[k - 1] / 100) < 1e-6 for _, wk in v)
                                                                                                         else " · faded to " + ", ".join(f"{wk * 100:.0f}%" for _, wk in v)), None])
                    rows.append(["Centres from", "median motor speed in the air (eRPM telemetry)", None])
                    rows.append(["Runs at", f"{fs_p:.0f} Hz (PID loop rate)", None])
                    add("rpm", f"RPM filter ({nh} harmonics × {len(motor_hz)} motors)", "gyro",
                        lambda f, lst=lst, q=q: np.prod([notch(f, fs_p, fk, q, wk) for _, fk, wk in lst], axis=0), "rpm",
                        dict(notches=[(fk, q, wk) for _, fk, wk in lst], q=q, nh=nh), rows,
                        [(f"harmonic {k} ({len(v)} notches, {min(x for x, _ in v):.0f}–{max(x for x, _ in v):.0f} Hz)",
                          lambda f, v=v: np.prod([notch(f, fs_p, fk, q, wk) for fk, wk in v], axis=0)) for k, v in per.items() if v])
            if dyn:
                q = hnum(h, "dyn_notch_q", 300)[0] / 100
                rows = [["Count", f"{len(dyn)}", "dyn_notch_count"], ["Q", f"{q:.2f}", "dyn_notch_q"],
                        ["Range", f"{hnum(h, 'dyn_notch_min_hz', 100)[0]:.0f}–{hnum(h, 'dyn_notch_max_hz', 600)[0]:.0f} Hz", "dyn_notch_min_hz, dyn_notch_max_hz"],
                        ["Centres", ", ".join(f"{c:.0f}" for c in dyn) + " Hz", None], ["Runs at", f"{fs_p:.0f} Hz (PID loop rate)", None]]
                add("dyn_notch", f"Dynamic notch{'es' if len(dyn) > 1 else ''} " + ", ".join(f"{c:.0f}" for c in dyn) + " Hz", "gyro",
                    lambda f, dyn=tuple(dyn), q=q: np.prod([notch(f, fs_p, c, q) for c in dyn], axis=0), "notch",
                    dict(notches=[(c, q, 1.0) for c in dyn]), rows, [(f"{c:.0f} Hz notch", lambda f, c=c: notch(f, fs_p, c, q)) for c in dyn])
    c, co = hnum(h, "dterm_notch_hz")[0], hnum(h, "dterm_notch_cutoff")[0]
    if c > 0 and 0 < co < c:
        q = notch_q(c, co)
        add("dterm_notch", f"D-term notch {c:.0f} Hz", "dterm", lambda f: notch(f, fs_p, c, q), "notch", dict(notches=[(c, q, 1.0)]),
            [["Centre / cutoff", f"{c:.0f} / {co:.0f} Hz → Q {q:.2f}", "dterm_notch_hz, dterm_notch_cutoff"], ["Runs at", f"{fs_p:.0f} Hz (PID loop rate)", None]])
    yl = hnum(h, "yaw_lowpass_hz", 0)[0]
    if yl > 0:
        add("yaw_lpf", f"Yaw P low-pass {yl:.0f} Hz", "yawp", lambda f: lpf(f, fs_p, yl, 0), "lpf", dict(type=0, fc=yl, dyn=None, fs=fs_p, p="yaw", n=0),
            [["Type", "PT1 (on the yaw P term only)", None], ["Cutoff", f"{yl:.0f} Hz", "yaw_lowpass_hz"], ["Runs at", f"{fs_p:.0f} Hz (PID loop rate)", None]])
    order = {"gyro_lpf1": 0, "gyro_lpf2": 1, "gyro_notch": 2, "rpm": 3, "dyn_notch": 4, "dterm_lpf1": 5, "dterm_lpf2": 6, "dterm_notch": 7, "yaw_lpf": 8}
    S.sort(key=lambda x: order[x["key"]])
    return S


def explain(st, fc, ms, thr_ms=None):
    """Why this stage delays as much as it does: the closed-form rule next to the exact value at the crossover."""
    sp = st["spec"]
    if st["kind"] == "lpf":
        t, f0 = sp["type"], sp["fc"]
        if t == 1:
            rule, approx = f"a 2nd-order Butterworth (biquad, Q 0.707) delays everything well below its cutoff by about √2 / (2π · cutoff)", np.sqrt(2) / (2 * np.pi * f0)
        else:
            n = LPF_ORDER[t]; corr = {1: 1.0, 2: 1.553774, 3: 1.961459}[n]
            if n == 1:
                rule, approx = "a PT1 low-pass delays everything well below its cutoff by about 1 / (2π · cutoff)", 1 / (2 * np.pi * f0)
            else:
                rule = (f"a PT{n} is {n} PT1 stages in a row, each at {corr:.3f} × the cutoff (so the whole filter is −3 dB at the cutoff): "
                        f"delay ≈ {n} / (2π · {corr:.3f} · cutoff)")
                approx = n / (2 * np.pi * corr * f0)
        txt = (f"It smooths by averaging over time, so its output lags: {rule} = {approx * 1000:.2f} ms at {f0:.0f} Hz. "
               f"Exactly at the {fc:.0f} Hz crossover: {ms:.2f} ms ({ms / 1000 * 360 * fc:.1f}° of phase). Delay scales with 1 / cutoff: "
               f"20% lower cutoff → 25% more delay.")
        if sp.get("dyn"):
            lo, hi, ex = sp["dyn"]
            txt += f" It is dynamic: the cutoff runs from {lo:.0f} Hz at idle to {hi:.0f} Hz at full throttle (expo {ex:.0f}), so it delays most at low throttle"
            txt += (f" ({thr_ms[0]:.2f} ms at 15% throttle, {thr_ms[1]:.2f} ms at 80%)." if thr_ms else ".")
        return txt
    nts = sp["notches"]
    each = [w / (q * 2 * np.pi * c) * 1000 for c, q, w in nts]
    rule = ("A notch removes a narrow band around its centre, but it also shifts the phase of everything below it: "
            "well below the centre it delays by about weight / (Q · 2π · centre).")
    if st["kind"] == "rpm":
        lowest = min(nts, key=lambda x: x[0])
        faded = [x for x in nts if x[2] < 0.999]
        fade_txt = (f" {len(faded)} of them are faded to {', '.join(f'{x[2] * 100:.0f}%' for x in faded)} because the motors run within "
                    f"rpm_filter_fade_range_hz of rpm_filter_min_hz: a faded notch delays less, but it also removes less of that motor line."
                    if faded else "")
        txt = (f"{rule} {len(nts)} notches at Q {sp['q']:.2f}: the lowest ones (1st harmonic, ≈{lowest[0]:.0f} Hz) cost most, "
               f"≈{lowest[2] / (lowest[1] * 2 * np.pi * lowest[0]) * 1000:.3f} ms each; the sum of the rule over all notches is {sum(each):.2f} ms. "
               f"Exactly at {fc:.0f} Hz: {ms:.2f} ms. More notches, lower Q or lower motor speed (centres nearer the control band) → more delay.{fade_txt}")
        return txt
    if len(nts) == 1:
        c, q, w = nts[0]
        return f"{rule} Centre {c:.0f} Hz, Q {q:.2f}: ≈{each[0]:.3f} ms; exactly at {fc:.0f} Hz: {ms:.3f} ms. Halving Q (wider notch) doubles it; a notch nearer the control band costs more."
    return (f"{rule} {len(nts)} notches (" + ", ".join(f"{c:.0f} Hz Q {q:.2f}" for c, q, _ in nts) + f"): ≈{sum(each):.3f} ms by the rule, "
            f"{ms:.3f} ms exactly at {fc:.0f} Hz. Each extra notch adds its own share; a wider notch (lower Q) or one nearer the control band costs more.")


def _mul_pair(v, m):
    return ",".join(f"{x * m:.0f}" for x in v)


def whatifs(h, key, dyn, cand=()):
    """Header changes worth trying for one stage: list of (label, header updates, new dyn centres or None, CLI text)."""
    W = []
    if key in ("gyro_lpf1", "dterm_lpf1"):
        p = key.split("_")[0]
        lo, hi = (hnum(h, f"{p}_lpf1_dyn_hz", 0) + [0])[:2]
        st = hnum(h, f"{p}_lpf1_static_hz", 0)[0]
        t = int(hnum(h, f"{p}_lpf1_type")[0])
        for m, nm in ((0.8, "cutoff −20%"), (1.25, "cutoff +25%"), (1.5, "cutoff +50%")):
            if lo > 0:
                W.append((nm, {f"{p}_lpf1_dyn_hz": _mul_pair([lo, hi], m)}, None, f"set {p}_lpf1_dyn_min_hz = {lo * m:.0f}\nset {p}_lpf1_dyn_max_hz = {hi * m:.0f}"))
            else:
                W.append((nm, {f"{p}_lpf1_static_hz": st * m}, None, f"set {p}_lpf1_static_hz = {st * m:.0f}"))
        alt = 2 if t == 0 else 0
        W.append((f"type {TYPE_NAME[alt]}, same cutoff", {f"{p}_lpf1_type": alt}, None, f"set {p}_lpf1_type = {TYPE_NAME[alt]}"))
        W.append(("off", {f"{p}_lpf1_dyn_hz": "0,0", f"{p}_lpf1_static_hz": 0}, None, f"set {p}_lpf1_dyn_min_hz = 0\nset {p}_lpf1_static_hz = 0"))
    elif key in ("gyro_lpf2", "dterm_lpf2"):
        p = key.split("_")[0]
        st = hnum(h, f"{p}_lpf2_static_hz", 0)[0]; t = int(hnum(h, f"{p}_lpf2_type")[0]); alt = 2 if t == 0 else 0
        for m, nm in ((0.8, "cutoff −20%"), (1.25, "cutoff +25%")):
            W.append((nm, {f"{p}_lpf2_static_hz": st * m}, None, f"set {p}_lpf2_static_hz = {st * m:.0f}"))
        W.append((f"type {TYPE_NAME[alt]}, same cutoff", {f"{p}_lpf2_type": alt}, None, f"set {p}_lpf2_type = {TYPE_NAME[alt]}"))
        W.append(("off", {f"{p}_lpf2_static_hz": 0}, None, f"set {p}_lpf2_static_hz = 0"))
    elif key == "gyro_notch":
        cs, cos = hnum(h, "gyro_notch_hz"), hnum(h, "gyro_notch_cutoff")
        for m, nm in ((2.0, "half as wide (Q × 2)"), (0.5, "twice as wide (Q ÷ 2)")):
            nc = [tuning_notch_cutoff(c, notch_q(c, co) * m) if c > 0 and 0 < co < c else co for c, co in zip(cs, cos)]
            W.append((nm, {"gyro_notch_cutoff": ",".join(f"{x:.0f}" for x in nc)}, None,
                      "\n".join(f"set gyro_notch{i + 1}_cutoff = {x:.0f}" for i, x in enumerate(nc) if cs[i] > 0)))
        W.append(("off", {"gyro_notch_hz": "0,0"}, None, "set gyro_notch1_hz = 0\nset gyro_notch2_hz = 0"))
    elif key == "rpm":
        q = hnum(h, "rpm_filter_q", 500)[0]; nh = int(hnum(h, "rpm_filter_harmonics")[0])
        w = (hnum(h, "rpm_filter_weights", 100) * 3)[:3]
        W.append((f"Q {q * 1.4 / 100:.1f} (narrower)", {"rpm_filter_q": q * 1.4}, None, f"set rpm_filter_q = {q * 1.4:.0f}"))
        W.append((f"Q {q * 0.7 / 100:.1f} (wider)", {"rpm_filter_q": q * 0.7}, None, f"set rpm_filter_q = {q * 0.7:.0f}"))
        if nh >= 3 and w[2] > 0:
            W.append(("3rd harmonic off", {"rpm_filter_weights": f"{w[0]:.0f},{w[1]:.0f},0"}, None, f"set rpm_filter_weights = {w[0]:.0f},{w[1]:.0f},0"))
        elif nh >= 2:
            W.append((f"{nh - 1} harmonics", {"rpm_filter_harmonics": nh - 1}, None, f"set rpm_filter_harmonics = {nh - 1}"))
        mn = hnum(h, "rpm_filter_min_hz", 100)[0]
        if mn != 100:
            W.append(("min 100 Hz (default)", {"rpm_filter_min_hz": 100}, None, "set rpm_filter_min_hz = 100"))
        W.append(("off", {"rpm_filter_harmonics": 0}, None, "set rpm_filter_harmonics = 0"))
    elif key == "dyn_notch":
        q = hnum(h, "dyn_notch_q", 300)[0]; n = len(dyn)
        W.append((f"Q {q * 1.5 / 100:.1f} (narrower)", {"dyn_notch_q": q * 1.5}, None, f"set dyn_notch_q = {q * 1.5:.0f}"))
        W.append((f"Q {q / 1.5 / 100:.1f} (wider)", {"dyn_notch_q": q / 1.5}, None, f"set dyn_notch_q = {q / 1.5:.0f}"))
        if n > 1:
            W.append((f"{n - 1} notch{'es' if n > 2 else ''}", {"dyn_notch_count": n - 1}, list(dyn[:-1]), f"set dyn_notch_count = {n - 1}"))
        if n < 5:
            extra = next((c for c in cand if all(abs(c - d) > 20 for d in dyn)), hnum(h, "dyn_notch_min_hz", 100)[0])
            W.append((f"{n + 1} notches", {"dyn_notch_count": n + 1}, list(dyn) + [extra], f"set dyn_notch_count = {n + 1}"))
        W.append(("off", {"dyn_notch_count": 0}, [], "set dyn_notch_count = 0"))
    elif key == "dterm_notch":
        W.append(("off", {"dterm_notch_hz": 0}, None, "set dterm_notch_hz = 0"))
    elif key == "yaw_lpf":
        yl = hnum(h, "yaw_lowpass_hz", 0)[0]
        W.append(("cutoff × 0.5", {"yaw_lowpass_hz": yl * 0.5}, None, f"set yaw_lowpass_hz = {yl * 0.5:.0f}"))
        W.append(("cutoff × 2", {"yaw_lowpass_hz": yl * 2}, None, f"set yaw_lowpass_hz = {yl * 2:.0f}"))
        W.append(("off", {"yaw_lowpass_hz": 0}, None, "set yaw_lowpass_hz = 0"))
    return W


def tuning_notch_cutoff(fc, q):
    from tuning import notch_cutoff
    return float(notch_cutoff(fc, q))


def phase_delay_ms(H, f):
    """τφ = −∠H/ω in ms (H on a grid f starting at low frequency, so unwrapping is safe)."""
    ph = np.unwrap(np.angle(H))
    return -ph / (2 * np.pi * np.maximum(f, 1e-9)) * 1000


def delay_at(Hfn, fc):
    """Phase delay (ms) of response Hfn at fc, unwrapped along a fine grid from 0.5 Hz (exact even for strong notches)."""
    g = np.geomspace(0.5, fc, 256)
    return float(phase_delay_ms(Hfn(g), g)[-1])


def chain(S, f, which):
    out = np.ones_like(f, dtype=complex)
    for s in S:
        if s["chain"] in which:
            out = out * s["H"](f)
    return out


# ---------------------------------------------------------------- open loop
def loop(h, S, pl, g, ax, f, kp_mul=1.0, kd_mul=1.0, p_scale=1.0):
    """Open loop L(f) for one axis, plus the controller Cfb (for the noise prediction)."""
    fs_g, fs_p = rates(h)
    T = 1 / fs_p
    z1 = np.exp(-2j * np.pi * f * T)
    s = 2j * np.pi * f
    Gg = chain(S, f, ("gyro",))
    Yp = chain(S, f, ("yawp",)) if ax == 2 else 1.0
    kp = KP * g["P"] * kp_mul * p_scale
    ki = KI * g["I"]
    kd = KD * g["D"] * kd_mul * p_scale
    Fd = chain(S, f, ("dterm",))
    Cg = kp * Yp + ki * T / (1 - z1) + kd * (1 - z1) / T * Fd           # what the PID does to the (already gyro-filtered) signal
    Cfb = Cg * Gg
    tau = pl["tau_ms"] / 1000
    Gp = pl["b"] * np.exp(-s * (pl["delay_ms"] / 1000 + 1.5 * T)) * (1 + (pl.get("lam") or 0) * tau * s) / ((1 + tau * s) * (s + pl["a"]))
    return Gp * Cfb, dict(Cg=Cg, Gg=Gg)


def margins(L, f):
    """Crossover, phase margin, gain margin, peak sensitivity (interpolated on the log-frequency grid)."""
    mag = np.abs(L)
    ph = np.degrees(np.unwrap(np.angle(L)))
    ph -= 360 * np.ceil(ph[0] / 360)                    # start in (−360, 0], as the simulator does
    lf = np.log(f)
    out = dict(fc=None, pm=None, f180=None, gm=None)
    i = np.flatnonzero((mag[:-1] >= 1) & (mag[1:] < 1))
    if len(i):
        i = i[0]; x = (0 - np.log(mag[i])) / (np.log(mag[i + 1]) - np.log(mag[i]))
        out["fc"] = float(np.exp(lf[i] + x * (lf[i + 1] - lf[i]))); out["pm"] = float(180 + ph[i] + x * (ph[i + 1] - ph[i]))
    j = np.flatnonzero((ph[:-1] > -180) & (ph[1:] <= -180))
    if len(j):
        j = j[0]; x = (-180 - ph[j]) / (ph[j + 1] - ph[j])
        out["f180"] = float(np.exp(lf[j] + x * (lf[j + 1] - lf[j])))
        out["gm"] = float(-20 * np.log10(np.exp(np.log(mag[j]) + x * (np.log(mag[j + 1]) - np.log(mag[j])))))
    Sv = 1 / np.abs(1 + L)
    k = int(np.argmax(Sv))
    out["ms"] = float(Sv[k]); out["f_ms"] = float(f[k])
    return out


# ---------------------------------------------------------------- the reference setup
# Betaflight firmware defaults (checked against the source, master / 2025.x, unchanged since 4.3):
#   sensors/gyro.h   GYRO_LPF1_DYN_MIN_HZ_DEFAULT 250, GYRO_LPF1_DYN_MAX_HZ_DEFAULT 500, GYRO_LPF2_HZ_DEFAULT 500
#   sensors/gyro.c   gyro_lpf1_type = gyro_lpf2_type = PT1, gyro_lpf1_dyn_expo 5, gyro notches 0 (off)
#   flight/pid.h     DTERM_LPF1_DYN_MIN_HZ_DEFAULT 75, DTERM_LPF1_DYN_MAX_HZ_DEFAULT 150, DTERM_LPF2_HZ_DEFAULT 150
#   flight/pid.c     dterm_lpf1_type = dterm_lpf2_type = PT1, dterm_lpf1_dyn_expo 5, dterm_notch_hz 0, yaw_lowpass_hz 100
#   pg/dyn_notch.c   dyn_notch_count 3, dyn_notch_q 300, dyn_notch_min_hz 100, dyn_notch_max_hz 600
#   pg/rpm_filter.c  rpm_filter_harmonics 3, rpm_filter_weights 100,100,100, rpm_filter_min_hz 100, rpm_filter_fade_range_hz 50, rpm_filter_q 500
BF_DEFAULTS = {"gyro_lpf1_type": 0, "gyro_lpf1_dyn_hz": "250,500", "gyro_lpf1_dyn_expo": 5, "gyro_lpf1_static_hz": 250,
               "gyro_lpf2_type": 0, "gyro_lpf2_static_hz": 500, "gyro_notch_hz": "0,0", "gyro_notch_cutoff": "0,0",
               "dterm_lpf1_type": 0, "dterm_lpf1_dyn_hz": "75,150", "dterm_lpf1_dyn_expo": 5, "dterm_lpf1_static_hz": 75,
               "dterm_lpf2_type": 0, "dterm_lpf2_static_hz": 150, "dterm_notch_hz": 0, "dterm_notch_cutoff": 0, "yaw_lowpass_hz": 100,
               "dyn_notch_count": 3, "dyn_notch_q": 300, "dyn_notch_min_hz": 100, "dyn_notch_max_hz": 600,
               "rpm_filter_harmonics": 3, "rpm_filter_weights": "100,100,100", "rpm_filter_min_hz": 100, "rpm_filter_fade_range_hz": 50, "rpm_filter_q": 500}
BF_SRC = {"gyro_lpf1": "sensors/gyro.h: GYRO_LPF1_DYN_MIN/MAX_HZ_DEFAULT 250/500, PT1, expo 5",
          "gyro_lpf2": "sensors/gyro.h: GYRO_LPF2_HZ_DEFAULT 500, PT1",
          "dterm_lpf1": "flight/pid.h: DTERM_LPF1_DYN_MIN/MAX_HZ_DEFAULT 75/150, PT1, expo 5",
          "dterm_lpf2": "flight/pid.h: DTERM_LPF2_HZ_DEFAULT 150, PT1",
          "dyn_notch": "pg/dyn_notch.c: count 3, Q 300 (3.0), 100–600 Hz",
          "rpm": "pg/rpm_filter.c: 3 harmonics, Q 500 (5.0), weights 100/100/100, min 100 Hz, fade 50 Hz",
          "yaw_lpf": "flight/pid.c: yaw_lowpass_hz 100",
          "gyro_notch": "off by default", "dterm_notch": "off by default"}
REFS = {"bf": "Betaflight defaults", "size": "Betaflight defaults scaled for the size"}


def typical_headers(h, inch, rpm_on, ref="bf"):
    """The reference setup on this quad's hardware (loop rates, bidirectional DShot): Betaflight's firmware defaults
    (ref 'bf'), or those defaults with the low-pass cutoffs and the notch minimums scaled for the prop size (ref 'size',
    quad.size_params: × (5 / inch)^0.8 for the low-passes, the same reference the Noise tab uses). Returns (headers, notes)
    where notes says where each stage's numbers come from."""
    H = dict(h)
    H.update(BF_DEFAULTS)
    src = dict(BF_SRC)
    if ref == "size":
        import quad
        t = quad.size_params(inch)["typical"]
        H.update({"gyro_lpf1_dyn_hz": t["gyro_lpf1_dyn_hz"], "dterm_lpf1_dyn_hz": t["dterm_lpf1_dyn_hz"],
                  "dyn_notch_min_hz": t["dyn_notch_min_hz"], "rpm_filter_min_hz": t["rpm_filter_min_hz"]})
        sc = f"scaled for {inch:g}″ from the 5″ default (× (5/{inch:g})^0.8)"
        src["gyro_lpf1"] = f"{t['gyro_lpf1_dyn_hz'].replace(',', '–')} Hz: {sc}; type and expo: Betaflight default"
        src["dterm_lpf1"] = f"{t['dterm_lpf1_dyn_hz'].replace(',', '–')} Hz: {sc}; type and expo: Betaflight default"
        src["dyn_notch"] = f"count 3, Q 3.0: Betaflight default; min {t['dyn_notch_min_hz']} Hz scaled for {inch:g}″"
        src["rpm"] = f"3 harmonics, Q 5.0, weights 100%: Betaflight default; min {t['rpm_filter_min_hz']} Hz scaled for {inch:g}″"
    if not rpm_on:
        H["rpm_filter_harmonics"] = 0     # needs bidirectional DShot, which this quad doesn't run
    return H, src


def typical_dyn(Ht, user_dyn, user_src, noise):
    """Where the reference's dynamic notches would sit: the tracker locks onto the strongest residual peaks in its range,
    so the same rule as for your own notches is used (logged centres first, then the peaks in your gyro spectrum, then
    the range minimum). Returns (centres, description)."""
    n = int(hnum(Ht, "dyn_notch_count", 0)[0])
    lo, hi = hnum(Ht, "dyn_notch_min_hz", 100)[0], hnum(Ht, "dyn_notch_max_hz", 600)[0]
    out, how = [], []
    if user_src.startswith("logged"):
        for c in user_dyn:
            if lo <= c <= hi and len(out) < n:
                out.append(c); how.append("logged")
    for c, _ in (noise or {}).get("dyn_cand") or []:
        if len(out) < n and lo <= c <= hi and all(abs(c - d) > 20 for d in out):
            out.append(c); how.append("noise peak in your gyro")
    for c, _ in (noise or {}).get("dyn_tops") or []:
        if len(out) < n and lo <= c <= hi and all(abs(c - d) > 20 for d in out):
            out.append(c); how.append("highest remaining point of your gyro spectrum")
    while len(out) < n:
        out.append(lo); how.append("nothing else in range: at the minimum (worst case)")
    return out, ", ".join(f"{c:.0f} Hz ({w})" for c, w in zip(out, how))


# ---------------------------------------------------------------- the analysis
def _is_default(upd):
    """True when every changed setting lands exactly on the firmware default."""
    try:
        return all(k in BF_DEFAULTS and [round(x) for x in hnum({k: v}, k)] == [round(x) for x in hnum(BF_DEFAULTS, k)] for k, v in upd.items())
    except ValueError:
        return False


def _verdict_ratio(r, tiny):
    if tiny or r <= 1.15:
        return "good"
    return "warning" if r <= 1.5 else "serious"


def analyse(lg, prof, M, noise, pw=None, ref="bf", prog=None):
    """lg: Log, prof: profile, M: simmodel report (learned plant), noise: noise report (raw spectra, dyn_est, budget).
    ref: reference setup ('bf' firmware defaults, 'size' defaults scaled for the prop size). prog(frac 0..1, detail)."""
    prog = prog or (lambda fr, d: None)
    ref = ref if ref in REFS else "bf"
    h, c = lg.headers, lg.cols
    fs_g, fs_p = rates(h)
    thr = c["throttle%"]; air = thr > 8
    hover_thr = float(np.median(thr[air]) / 100) if air.any() else 0.3
    motors = [c[f"motorHz[{i}]"] for i in range(8) if f"motorHz[{i}]" in c]
    mot_med = [float(np.median(m[air])) for m in motors] if motors and air.any() else None
    rpm_hw = bool(mot_med and hnum(h, "dshot_bidir")[0])         # RPM filtering possible on this hardware (bidirectional DShot)
    dyn, dyn_src = dyn_centres(lg, noise)
    cand = [x for x, _ in (noise or {}).get("dyn_cand") or []]
    inch = prof["used"]["inch"]
    Ht, tsrc = typical_headers(h, inch, rpm_hw, ref)
    dyn_t, dyn_t_src = typical_dyn(Ht, dyn, dyn_src, noise)
    simp = {"gyro": hnum(h, "simplified_gyro_filter", 0)[0] >= 1, "dterm": hnum(h, "simplified_dterm_filter", 0)[0] >= 1}
    f = np.geomspace(0.5, fs_p * 0.45, 900)
    S = stages(h, hover_thr, mot_med, dyn)
    St = stages(Ht, hover_thr, mot_med, dyn_t)
    out = dict(fs_gyro=round(fs_g), fs_pid=round(fs_p), hover_thr=round(hover_thr * 100, 1), dyn=dict(centres=[round(x, 1) for x in dyn], source=dyn_src),
               dyn_typ=dict(centres=[round(x, 1) for x in dyn_t], source=dyn_t_src), ref=ref, ref_label=REFS[ref], refs=REFS,
               ref_src={k: v for k, v in tsrc.items()}, inch=inch, axes={}, stages=[dict(key=s["key"], label=s["label"], chain=s["chain"]) for s in S],
               typical_stages=[dict(key=s["key"], label=s["label"], chain=s["chain"]) for s in St])
    # phase delay vs frequency, per chain (for the curve chart)
    fd = np.geomspace(5, fs_p * 0.45, 240)
    out["curve"] = dict(f=fd.round(2).tolist(),
                        gyro=phase_delay_ms(chain(S, fd, ("gyro",)), fd).round(3).tolist(),
                        dterm=phase_delay_ms(chain(S, fd, ("gyro", "dterm")), fd).round(3).tolist(),
                        gyro_typ=phase_delay_ms(chain(St, fd, ("gyro",)), fd).round(3).tolist(),
                        dterm_typ=phase_delay_ms(chain(St, fd, ("gyro", "dterm")), fd).round(3).tolist())
    raw = noise.get("axes") or {}
    nf = np.array(noise.get("f") or [])
    F = []
    for ax, a in enumerate(AXN):
        pl = (M.get("axes") or {}).get(a)
        if not pl:
            continue
        prog(ax / 3, f"{a}: crossover, margins and the delay of each of {len(S)} filter stages")
        g = M["pids"][a]
        km, kd = pl.get("kp_mul") or 1.0, pl.get("kd_mul") or 1.0
        L, C0 = loop(h, S, pl, g, ax, f, km, kd)
        L0, _ = loop(h, [], pl, g, ax, f, km, kd)                      # same loop, no filters at all
        Lt, _ = loop(Ht, St, pl, g, ax, f, km, kd)                        # typical filters for the size
        m, m0, mt = margins(L, f), margins(L0, f), margins(Lt, f)
        fc = m["fc"] or m0["fc"]
        if not fc:
            continue
        # per-stage phase delay at the crossover, and its typical counterpart
        rows = []
        S15, S80 = stages(h, 0.15, mot_med, dyn), stages(h, 0.8, mot_med, dyn)
        St15, St80 = stages(Ht, 0.15, mot_med, dyn_t), stages(Ht, 0.8, mot_med, dyn_t)
        at = lambda SS, k: next((delay_at(x["H"], fc) for x in SS if x["key"] == k), 0.0)
        for s in S:
            if s["chain"] == "yawp" and ax != 2:
                continue
            v = delay_at(s["H"], fc)
            thr_ms = (at(S15, s["key"]), at(S80, s["key"])) if s["spec"].get("dyn") else None
            wi = []
            for lbl, upd, ndyn, cli in whatifs(h, s["key"], dyn, cand):
                if "default" not in lbl and lbl != "off" and _is_default(upd):
                    lbl += " (= Betaflight default)"
                H2 = {**h, **upd}
                S2 = stages(H2, hover_thr, mot_med, dyn if ndyn is None else ndyn)
                ms2 = at(S2, s["key"])
                m2 = margins(loop(H2, S2, pl, g, ax, f, km, kd)[0], f)
                ch = s["chain"] if s["chain"] in simp else None
                if ch and simp[ch] and s["kind"] == "lpf":
                    cli = f"set simplified_{ch}_filter = OFF\n" + cli      # the slider would overwrite typed cutoffs
                wi.append(dict(label=lbl, cli=cli, ms=round(ms2, 3), d_ms=round(ms2 - v, 3), pm=None if m2["pm"] is None else round(m2["pm"], 1),
                               d_pm=None if None in (m2["pm"], m["pm"]) else round(m2["pm"] - m["pm"], 1), fc=None if m2["fc"] is None else round(m2["fc"], 1)))
            rows.append(dict(key=s["key"], label=s["label"], chain=s["chain"], kind=s["kind"], ms=round(v, 3), deg=round(v / 1000 * 360 * fc, 2),
                             spec=[r[:2] + [r[2]] for r in s["rows"]], parts=[[lb, round(delay_at(fn, fc), 3)] for lb, fn in s["parts"]],
                             why=explain(s, fc, v, thr_ms), thr_ms=None if thr_ms is None else [round(x, 3) for x in thr_ms], whatif=wi))
        tmap = {}
        for s in St:
            if s["chain"] == "yawp" and ax != 2:
                continue
            v = delay_at(s["H"], fc)
            thr_ms = (at(St15, s["key"]), at(St80, s["key"])) if s["spec"].get("dyn") else None
            spec = [r[:2] + [r[2]] for r in s["rows"]]
            if s["key"] == "dyn_notch":
                spec = [r if r[0] != "Centres" else ["Centres", dyn_t_src, None] for r in spec]
            tmap[s["key"]] = dict(label=s["label"], chain=s["chain"], ms=round(v, 3), spec=spec, src=tsrc.get(s["key"], ""), why=explain(s, fc, v, thr_ms),
                                  parts=[[lb, round(delay_at(fn, fc), 3)] for lb, fn in s["parts"]])
        d_off = not (g.get("D") or 0) > 0
        for r in rows:
            t_ = tmap.get(r["key"])
            tiny = abs(r["ms"]) < 0.05
            r["inactive"] = bool(d_off and r["chain"] == "dterm")
            r["typ_ms"] = t_["ms"] if t_ else 0.0
            r["typ"] = t_                 # the reference's own numbers for this stage (None: the reference doesn't have it)
            r["ratio"] = round(r["ms"] / t_["ms"], 2) if t_ and t_["ms"] > 0.01 else None
            r["verdict"] = "inactive" if r["inactive"] else "good" if tiny else ("serious" if r["ms"] > 0.15 else "warning") if r["ratio"] is None else _verdict_ratio(r["ratio"], tiny)
        extra = [k for k in tmap if k not in {r["key"] for r in rows} and (k != "yaw_lpf" or ax == 2)]
        prog(ax / 3 + 0.12, f"{a}: sweeping the low-pass cutoffs ×0.5–×2 (63 loop variants) and the P/D headroom (57)")
        # timing that is not filtering, at the same frequency
        tau = pl["tau_ms"] / 1000; w = 2 * np.pi * fc
        mot_ms = float(np.arctan(w * tau) / w * 1000)
        timing = [dict(key="loop", label=f"PID loop timing (1.5 × {1000 / fs_p:.3f} ms)", ms=round(1.5 * 1000 / fs_p, 3),
                       why=f"Betaflight runs the PID once per loop ({fs_p:.0f} Hz) on the newest filtered gyro sample, and the motors get the result at "
                           f"the end of that loop: on average 1.5 loop periods between the quad moving and the motors reacting. Only a faster PID loop "
                           f"(pid_process_denom) shortens it; at {fs_p / 2:.0f} Hz it would be {3000 / fs_p:.2f} ms."),
                  dict(key="esc", label="ESC + motor command delay (measured)", ms=round(float(pl["delay_ms"]), 3),
                       why=f"Measured from this log as the dead time between the motor command and the eRPM response: DShot frame, ESC processing and "
                           f"the motor's electrical response. Logged at {lg.fs:.0f} Hz, so it is resolved to about {1000 / lg.fs:.1f} ms."),
                  dict(key="motor", label=f"Motor spin-up lag τ = {float(pl['tau_ms']):.0f} ms (equivalent at f_c)", ms=round(mot_ms, 3),
                       why=f"Props need time to change speed: τ = {float(pl['tau_ms']):.0f} ms, learned from this flight (command → eRPM and the loop fit). "
                           f"A first-order lag costs atan(2π·f·τ) / (2π·f) = {mot_ms:.2f} ms of equivalent delay at {fc:.0f} Hz "
                           f"({np.degrees(np.arctan(w * tau)):.0f}° of phase). Lighter props, higher motor KV or voltage make it shorter; filters can't change it.")]
        # P path (gyro chain) and D path (gyro + D-term chain) totals at f_c
        p_ms = sum(r["ms"] for r in rows if r["chain"] in ("gyro",) + (("yawp",) if ax == 2 else ()))
        d_ms = sum(r["ms"] for r in rows if r["chain"] in ("gyro", "dterm"))
        p_typ = sum(tmap[k]["ms"] for k in tmap if any(s["key"] == k and s["chain"] in ("gyro",) + (("yawp",) if ax == 2 else ()) for s in St))
        d_typ = sum(tmap[k]["ms"] for k in tmap if any(s["key"] == k and s["chain"] in ("gyro", "dterm") for s in St))
        spare = (m0["pm"] or 0) - PM_TARGET
        used = (m0["pm"] or 0) - (m["pm"] or 0)
        share = used / spare if spare > 1 else None
        # throttle dependence of the filter delay at f_c (dynamic low-passes move with throttle)
        thr_axis = np.linspace(0.05, 1.0, 20)
        pd_thr = [round(float(sum(delay_at(x["H"], fc)
                                  for x in stages(h, tt, mot_med, dyn) if x["chain"] in ("gyro",))), 3) for tt in thr_axis]
        dd_thr = [round(float(sum(delay_at(x["H"], fc)
                                  for x in stages(h, tt, mot_med, dyn) if x["chain"] in ("gyro", "dterm"))), 3) for tt in thr_axis]
        # sweep of the low-pass cutoffs: phase margin and predicted motor noise
        mults = np.geomspace(0.5, 2.0, 21)
        sweep = []
        for kind in ("both", "gyro", "dterm"):
            pmv, nzv = [], []
            for mu in mults:
                Sx = stages(h, hover_thr, mot_med, dyn, scale_g=mu if kind in ("both", "gyro") else 1.0, scale_d=mu if kind in ("both", "dterm") else 1.0)
                Lx, Cx = loop(h, Sx, pl, g, ax, f, km, kd)
                pmv.append(margins(Lx, f)["pm"])
                nzv.append(_noise_pct(Cx, f, raw.get(str(ax)), nf, C0["Gg"]))
            sweep.append(dict(kind=kind, pm=[None if v is None else round(v, 2) for v in pmv], noise=[None if v is None else round(v, 4) for v in nzv]))
        # P/D scale curve: phase margin when P and D are scaled together (I unchanged), with these / typical / no filters
        scales = np.geomspace(0.4, 2.5, 19)
        head = dict(scale=scales.round(3).tolist())
        for nm, SS, HH in (("now", S, h), ("typical", St, Ht), ("none", [], h)):
            pms = []
            for sc_ in scales:
                Lh, _ = loop(HH, SS, pl, g, ax, f, km, kd, p_scale=sc_)
                mm = margins(Lh, f)
                pms.append(None if mm["pm"] is None or (mm["gm"] is not None and mm["gm"] < 0) else round(mm["pm"], 2))
            ok = [sc_ for sc_, pm_ in zip(scales, pms) if pm_ is not None and pm_ >= PM_TARGET]
            head[nm] = dict(pm=pms, max_scale=round(float(max(ok)), 2) if ok else None, best_pm=max([p for p in pms if p is not None], default=None))
        nz_now = _noise_pct(C0, f, raw.get(str(ax)), nf, C0["Gg"])
        nz_meas = measured_pid_noise(lg, ax)
        out["axes"][a] = dict(fc=round(fc, 2), margins=dict(now=_r(m), none=_r(m0), typical=_r(mt)), rows=rows, extra_typical=[dict(key=k, **tmap[k]) for k in extra],
                              timing=timing, p_ms=round(p_ms, 3), d_ms=round(d_ms, 3), p_typ=round(p_typ, 3), d_typ=round(d_typ, 3),
                              phase_used=round(used, 2), phase_spare=round(spare, 2), share=None if share is None else round(share, 3),
                              thr=dict(t=(thr_axis * 100).round(1).tolist(), p=pd_thr, d=dd_thr), mults=mults.round(3).tolist(), sweep=sweep, headroom=head,
                              noise_pct=None if nz_now is None else round(nz_now, 3), noise_meas=None if nz_meas is None else round(nz_meas, 3), excited_hz=pl.get("excited_hz"), status=pl.get("status"), conf=pl.get("conf"),
                              gains=dict(P=g["P"], I=g["I"], D=g["D"], kp_mul=km, kd_mul=kd), d_off=d_off)
    # model check: predicted vs measured motor noise above 80 Hz (all axes add at each motor)
    pv = [(out["axes"][a]["noise_pct"], out["axes"][a]["noise_meas"]) for a in out["axes"] if out["axes"][a]["noise_pct"] is not None and out["axes"][a]["noise_meas"]]
    out["check"] = dict(pred_motor_pct=round(float(np.sqrt(sum(p * p for p, _ in pv))), 3) if pv else None,
                        meas_motor_pct=round(float(np.sqrt(sum(m * m for _, m in pv))), 3) if pv else None,
                        axes={a: dict(pred=out["axes"][a]["noise_pct"], meas=out["axes"][a]["noise_meas"]) for a in out["axes"]})
    # empirical cross-check: a lightly damped loop rings near its sensitivity peak; propwash excites exactly that
    if isinstance(pw, dict) and pw.get("pw_freq"):
        out["check"]["pw_freq"] = pw["pw_freq"]
        out["check"]["model_peak"] = {a: out["axes"][a]["margins"]["now"].get("f_ms") for a in out["axes"]}
    out["findings"] = findings(out, h, prof)
    return out


def _r(m):
    return {k: (None if v is None else round(v, 2)) for k, v in m.items()}


def _noise_pct(C, f, ax_spec, nf, Gg_ref=None):
    """Motor-command noise (% of motor range, RMS) above 80 Hz from this axis's PID, predicted from the measured
    *filtered* gyro spectrum: |Cg|²·|Gg / Gg_ref|²·S_filt (Gg_ref = the gyro chain the log was recorded with). Using
    the filtered gyro keeps sensor noise above half the logging rate out of the prediction (in the raw gyro it folds
    down to lower frequencies where the PID would weigh it wrongly). Δmotor % = PID sum / 10."""
    if not ax_spec or not len(nf):
        return None
    Sf = 10 ** (np.array(ax_spec["filt"]) / 10)
    band = (nf >= 80) & (nf <= nf[-1] * 0.98)
    if band.sum() < 3:
        return None
    gain = np.abs(C["Cg"]) ** 2
    if Gg_ref is not None:
        gain = gain * np.abs(C["Gg"]) ** 2 / np.maximum(np.abs(Gg_ref) ** 2, 1e-12)
    g = np.interp(nf[band], f, gain)
    trap = getattr(np, "trapezoid", None) or np.trapz
    return float(np.sqrt(trap(g * Sf[band], nf[band])) / 10)


def measured_pid_noise(lg, ax, lo=80.0):
    """The same quantity measured: RMS above lo Hz of the logged PID sum (P+I+D+F) of this axis, / 10 → motor %."""
    from tuning import _band
    c = lg.cols
    keys = [f"axis{t}[{ax}]" for t in "PIDF" if f"axis{t}[{ax}]" in c]
    if not keys:
        return None
    u = sum(c[k].astype(float) for k in keys)
    air = c["throttle%"] > 8
    if air.sum() < lg.fs:
        return None
    return float(np.sqrt(np.mean(_band(u, lg.fs, lo)[air] ** 2)) / 10)


# ---------------------------------------------------------------- plain-language findings
def findings(D, h, prof):
    from tuning import finding, filter_knob
    F = []
    inch = D["inch"]
    for a, A in D["axes"].items():
        m, m0, mt = A["margins"]["now"], A["margins"]["none"], A["margins"]["typical"]
        if m["pm"] is None or m0["pm"] is None:
            continue
        fc, used, spare = A["fc"], A["phase_used"], A["phase_spare"]
        tau = next((t["label"] for t in A["timing"] if t["key"] == "motor"), "")
        lvl = "good" if m["pm"] >= PM_TARGET else "info" if m["pm"] >= 35 else "warning"
        if spare < 10:
            why = (f"Even with no filtering at all this loop would only have {m0['pm']:.0f}°: the motors' spin-up lag and the ESC delay use most of the phase "
                   f"at {fc:.0f} Hz, so every bit of filter delay shows.")
        else:
            why = f"Without filtering it would have {m0['pm']:.0f}°; the filters use {min(used / spare, 9.99) * 100:.0f}% of the phase the loop can spare above the 45° target."
        cmp_t = "" if mt["pm"] is None else f" With the reference filters ({D['ref_label'].lower()}) it would be {mt['pm']:.0f}°."
        F.append(finding(lvl, f"{a.capitalize()}: {m['pm']:.0f}° phase margin at the {fc:.0f} Hz crossover, the filters take {used:.0f}° of it",
                         why,
                         f"The crossover is where the loop gain is 1; the phase left there decides how well the quad damps a kick (45° is the usual target, "
                         f"below ~30° it rings). At {fc:.0f} Hz the filters delay what the PID sees by {A['p_ms']:.2f} ms on the P path and "
                         f"{A['d_ms']:.2f} ms on the D path.{cmp_t}"
                         + (f" Peak disturbance amplification ×{m['ms']:.1f} around {m['f_ms']:.0f} Hz." if m.get("ms") else ""), "", ""))
        # does lighter filtering help? compare the chains at cutoffs × 1.26 (margin gained per extra motor noise)
        mu = A["mults"]; i1 = min(range(len(mu)), key=lambda k: abs(mu[k] - 1)); i2 = min(range(len(mu)), key=lambda k: abs(mu[k] - 1.26))
        best = None
        for sw in A["sweep"]:
            if None in (sw["pm"][i1], sw["pm"][i2]):
                continue
            gain = sw["pm"][i2] - sw["pm"][i1]
            cost = (sw["noise"][i2] - sw["noise"][i1]) if None not in (sw["noise"][i2], sw["noise"][i1]) else None
            score = gain / max(cost if cost is not None else 0.05, 0.02)
            if best is None or score > best[0]:
                best = (score, sw["kind"], gain, cost)
        if best and m["pm"] < PM_TARGET and best[2] >= 2.5:
            kind = best[1]
            chs = ["gyro", "dterm"] if kind == "both" else [kind]
            cli = "; ".join(filter_knob(h, ch, 1.25) for ch in chs)
            nm = "gyro and D-term" if kind == "both" else ("D-term" if kind == "dterm" else "gyro")
            F.append(finding("warning" if m["pm"] < 35 else "info", f"{a.capitalize()}: lighter {nm} filtering would buy {best[2]:.0f}° of phase margin",
                             f"Raising the {nm} low-pass cutoffs by 25% adds {best[2]:.0f}°"
                             + (f" for about +{best[3]:.2f}% motor noise on this axis (predicted from your own gyro spectrum)." if best[3] is not None else "."),
                             "Of the three options (gyro only, D-term only, both) this one buys the most margin per unit of extra motor noise. "
                             "Less filter delay at the crossover is phase the PID can use: better damping of propwash and kicks.",
                             f"{cli}. Hover, punch a few times, land and feel the motors.", "More noise reaches the motors; they run warmer."))
        elif m["pm"] >= PM_TARGET + 10 and spare > 10 and used / spare < 0.35:
            F.append(finding("good", f"{a.capitalize()}: filter delay is not what limits this PID",
                             f"It keeps {m['pm']:.0f}° of phase margin; lighter filtering would change little.",
                             "If motors run warm or the D-term is noisy, there is room to filter a bit more before the delay starts to matter.", "", ""))
        H = A["headroom"]
        mx_now, mx_none = H["now"]["max_scale"], H["none"]["max_scale"]
        if mx_now is None and mx_none is not None:
            F.append(finding("info", f"{a.capitalize()}: with these filters no P/D setting reaches 45°",
                             f"Scaling P and D together never gets above {H['now']['best_pm']:.0f}° with the current filters; without filtering ×{mx_none:.2f} would still keep 45°.",
                             "The filter delay, not the gains, is what holds this loop back. See the sweep chart for how much each chain costs.", "", ""))
        elif mx_now is None and mx_none is None:
            F.append(finding("info", f"{a.capitalize()}: 45° isn't reachable by tuning P and D alone",
                             f"Even without filters the best is {H['none']['best_pm']:.0f}°: motor spin-up lag and delay set this limit ({tau}).",
                             "Faster-responding props/motors (lighter props, higher motor speed) raise it; feedforward makes stick response sharp without needing loop margin.", "", ""))
        elif mx_now is not None and mx_now < 0.95:
            F.append(finding("info", f"{a.capitalize()}: P and D are above what keeps 45° with these filters",
                             f"Scaling P and D to ×{mx_now:.2f} would bring the margin back to 45°" + (f" (without filters ×{mx_none:.2f} would be fine)." if mx_none else "."),
                             "Model-based: check the PID simulator's stability view and the step response before changing anything.", "", ""))
        tot = sum(r["ms"] for r in A["rows"]) or 1
        for r in A["rows"]:
            if r["key"] in ("gyro_notch", "dyn_notch", "dterm_notch", "rpm") and r["ms"] > 0.25 * tot and r["ms"] > 0.2:
                F.append(finding("info", f"{a.capitalize()}: the {r['label']} costs {r['ms']:.2f} ms at the crossover ({r['ms'] / tot * 100:.0f}% of the filter delay)",
                                 "Notches delay low frequencies too: each one adds about 1 / (Q · 2π · its frequency) of delay well below its centre.",
                                 ("With many RPM notches (harmonics × motors) this adds up. If the 3rd harmonic carries little noise (Noise tab), "
                                  "rpm_filter_weights can turn it down, and a higher rpm_filter_q makes every notch narrower and cheaper.")
                                 if r["key"] == "rpm" else "A narrower notch (higher Q) costs less; fixing the resonance mechanically lets you remove it.", "", ""))
    a0 = D["axes"].get("roll") or next(iter(D["axes"].values()), None)
    if a0:
        t, p = np.array(a0["thr"]["t"]), np.array(a0["thr"]["d"])
        lo_d, hv = float(np.interp(15, t, p)), float(np.interp(D["hover_thr"], t, p))
        if hv > 0 and lo_d > 1.3 * hv and lo_d - hv > 0.2:
            F.append(finding("info", f"At low throttle the D path is {lo_d / hv:.1f}× slower than at hover ({lo_d:.2f} vs {hv:.2f} ms)",
                             "The dynamic low-pass filters sit at their minimum cutoff at low throttle, exactly where propwash happens.",
                             "If propwash is the main complaint and the motors stay cool, raising the first number of gyro_lpf1_dyn_hz / dterm_lpf1_dyn_hz "
                             "reduces the delay where it matters most.", "", ""))
    ck = D.get("check") or {}
    if ck.get("pw_freq") and ck.get("model_peak"):
        pk = [v for k, v in ck["model_peak"].items() if k != "yaw" and v]
        if pk:
            F.append(finding("info", f"Cross-check: propwash rings at {ck['pw_freq']:.0f} Hz, the model's resonance sits at {', '.join(f'{v:.0f}' for v in pk)} Hz (roll, pitch)",
                             "A loop with little phase margin rings near its sensitivity peak, and propwash is what excites it.",
                             "Measured in the Propwash tab (the frequency of the wobble after throttle chops) vs. predicted by this model. Close values mean the "
                             "margins on this tab describe the real quad; a big gap means take them as indicative.", "", ""))
    if ck.get("pred_motor_pct") and ck.get("meas_motor_pct"):
        r = ck["pred_motor_pct"] / ck["meas_motor_pct"]
        det = ", ".join(f"{k} {v['pred']:.2f}/{v['meas']:.2f}%" for k, v in (ck.get("axes") or {}).items() if v.get("pred") is not None and v.get("meas"))
        F.append(finding("good" if 0.7 <= r <= 1.4 else "info", f"Model check: predicted PID noise {ck['pred_motor_pct']:.2f}% vs logged {ck['meas_motor_pct']:.2f}%",
                         "How closely the filter + PID model reproduces the high-frequency part of the logged PID output (above 80 Hz, as motor %).",
                         f"Per axis, predicted/logged: {det}. The noise numbers in the sweep (what more or less filtering would do) are as reliable as this match.", "", ""))
    return F
