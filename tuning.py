"""Betaflight filter models (from log headers) + rule-based noise / step-response advice."""
import numpy as np

LPF_TYPES = {0: "PT1", 1: "BIQUAD", 2: "PT2", 3: "PT3"}
PT_CORR = {1: 1.0, 2: 1.553774, 3: 1.961459}  # BF cutoff correction so PTn has -3 dB at f_cut


def hnum(h, key, default=0.0):
    """Header value → list of floats."""
    v = h.get(key)
    if v is None:
        return [float(default)]
    return [float(x) for x in str(v).replace("[", "").replace("]", "").split(",") if x.strip() != ""]


# ---------- discrete-time filter responses (as implemented in BF src/main/common/filter.c) ----------
def _z(f, fs):
    return np.exp(-2j * np.pi * f / fs)


def lpf(f, fs, fc, kind):
    """Complex response of BF lowpass of type 0 PT1 / 1 BIQUAD / 2 PT2 / 3 PT3."""
    if fc <= 0:
        return np.ones_like(f, dtype=complex)
    z1 = _z(f, fs)
    if kind == 1:  # RBJ biquad, Q = 1/sqrt2
        w = 2 * np.pi * fc / fs
        a = np.sin(w) / (2 / np.sqrt(2))
        b0 = b2 = (1 - np.cos(w)) / 2
        b1, a0, a1, a2 = 1 - np.cos(w), 1 + a, -2 * np.cos(w), 1 - a
        return (b0 + b1 * z1 + b2 * z1 ** 2) / (a0 + a1 * z1 + a2 * z1 ** 2)
    order = {0: 1, 2: 2, 3: 3}.get(kind, 1)
    om = 2 * np.pi * fc * PT_CORR[order] / fs
    k = om / (om + 1)
    return (k / (1 - (1 - k) * z1)) ** order


def notch(f, fs, fc, q, weight=1.0):
    if fc <= 0 or fc >= fs / 2:
        return np.ones_like(f, dtype=complex)
    z1, w = _z(f, fs), 2 * np.pi * fc / fs
    a = np.sin(w) / (2 * q)
    h = (1 - 2 * np.cos(w) * z1 + z1 ** 2) / ((1 + a) - 2 * np.cos(w) * z1 + (1 - a) * z1 ** 2)
    return 1 + weight * (h - 1)


def rpm_notch(h, f_hz, weight=1.0):
    """Betaflight RPM-filter notch at f_hz: below rpm_filter_min_hz + rpm_filter_fade_range_hz its weight fades linearly
    to 0 at rpm_filter_min_hz, and its frequency is held at rpm_filter_min_hz (rpm_filter.c). Returns (centre, weight)."""
    mn = hnum(h, "rpm_filter_min_hz", 100)[0]
    fr = hnum(h, "rpm_filter_fade_range_hz", 50)[0]
    if fr > 0 and f_hz < mn + fr:
        weight *= float(np.clip((f_hz - mn) / fr, 0.0, 1.0))
    return max(f_hz, mn), weight


def notch_q(center, cutoff):  # BF filterGetNotchQ
    return center * cutoff / (center ** 2 - cutoff ** 2)


def dyn_cutoff(thr, lo, hi, expo):  # BF dynLpfCutoffFreq, thr 0..1
    curve = thr * (1 - thr) * expo / 10 + thr
    return (hi - lo) * curve + lo


def phase_delay_ms(H, f, at=100.0):
    i = int(np.argmin(np.abs(f - at)))
    ph = np.unwrap(np.angle(H))[i]
    return round(float(-ph / (2 * np.pi * f[i]) * 1000), 2)


def filter_model(h, f, thr=0.3, motor_hz=None, dyn_peaks=(), scale=1.0):
    """Return dict of stage name -> complex response on grid f. scale multiplies all LPF cutoffs (what-if)."""
    fs_gyro = 1e6 / max(hnum(h, "looptime", 125)[0], 1)
    fs_pid = fs_gyro / max(hnum(h, "pid_process_denom", 1)[0], 1)
    st = {}
    # gyro lowpass 1 (dynamic if dyn min > 0)
    t1 = int(hnum(h, "gyro_lpf1_type")[0])
    dmin, dmax = (hnum(h, "gyro_lpf1_dyn_hz", 0) + [0])[:2]
    expo = hnum(h, "gyro_lpf1_dyn_expo", 5)[0]
    fc1 = dyn_cutoff(thr, dmin, dmax, expo) if dmin > 0 else hnum(h, "gyro_lpf1_static_hz")[0]
    if fc1 > 0:
        st["gyro_lpf1"] = dict(H=lpf(f, fs_gyro, fc1 * scale, t1), label=f"Gyro LPF1 {LPF_TYPES.get(t1)} {fc1 * scale:.0f} Hz" + (" (dyn)" if dmin > 0 else ""), chain="gyro")
    fc2 = hnum(h, "gyro_lpf2_static_hz")[0]
    if fc2 > 0:
        t2 = int(hnum(h, "gyro_lpf2_type")[0])
        st["gyro_lpf2"] = dict(H=lpf(f, fs_gyro, fc2 * scale, t2), label=f"Gyro LPF2 {LPF_TYPES.get(t2)} {fc2 * scale:.0f} Hz", chain="gyro")
    # static gyro notches
    H = np.ones_like(f, dtype=complex)
    for c, co in zip(hnum(h, "gyro_notch_hz"), hnum(h, "gyro_notch_cutoff")):
        if c > 0 and 0 < co < c:
            H = H * notch(f, fs_gyro, c, notch_q(c, co))
    if not np.allclose(H, 1):
        st["gyro_notch"] = dict(H=H, label="Gyro static notches", chain="gyro")
    # RPM filter: one notch per motor per harmonic (snapshot at median motor speed)
    nh = int(hnum(h, "rpm_filter_harmonics")[0])
    if nh and motor_hz is not None and hnum(h, "dshot_bidir")[0]:
        q = hnum(h, "rpm_filter_q", 500)[0] / 100
        wts = (hnum(h, "rpm_filter_weights", 100) * 3)[:nh]
        H = np.ones_like(f, dtype=complex)
        for m in motor_hz:
            for k in range(1, nh + 1):
                fk, wk = rpm_notch(h, m * k, wts[k - 1] / 100)
                if wk > 0:
                    H = H * notch(f, fs_pid, fk, q, wk)
        st["rpm"] = dict(H=H, label=f"RPM filter ({nh} harm., median motor speed)", chain="gyro")
    # dynamic notch at estimated positions
    if dyn_peaks:
        q = hnum(h, "dyn_notch_q", 300)[0] / 100
        H = np.ones_like(f, dtype=complex)
        for p in dyn_peaks:
            H = H * notch(f, fs_pid, p, q)
        st["dyn_notch"] = dict(H=H, label="Dyn notch (estimated position)", chain="gyro")
    # D-term chain
    tdt = int(hnum(h, "dterm_lpf1_type")[0])
    dmin, dmax = (hnum(h, "dterm_lpf1_dyn_hz", 0) + [0])[:2]
    expo = hnum(h, "dterm_lpf1_dyn_expo", 5)[0]
    fcd = dyn_cutoff(thr, dmin, dmax, expo) if dmin > 0 else hnum(h, "dterm_lpf1_static_hz")[0]
    if fcd > 0:
        st["dterm_lpf1"] = dict(H=lpf(f, fs_pid, fcd * scale, tdt), label=f"D-term LPF1 {LPF_TYPES.get(tdt)} {fcd * scale:.0f} Hz" + (" (dyn)" if dmin > 0 else ""), chain="dterm")
    fcd2 = hnum(h, "dterm_lpf2_static_hz")[0]
    if fcd2 > 0:
        t2 = int(hnum(h, "dterm_lpf2_type")[0])
        st["dterm_lpf2"] = dict(H=lpf(f, fs_pid, fcd2 * scale, t2), label=f"D-term LPF2 {LPF_TYPES.get(t2)} {fcd2 * scale:.0f} Hz", chain="dterm")
    c, co = hnum(h, "dterm_notch_hz")[0], hnum(h, "dterm_notch_cutoff")[0]
    if c > 0 and 0 < co < c:
        st["dterm_notch"] = dict(H=notch(f, fs_pid, c, notch_q(c, co)), label=f"D-term notch {c:.0f} Hz", chain="dterm")
    g = np.prod([s["H"] for s in st.values() if s["chain"] == "gyro"], axis=0) if any(s["chain"] == "gyro" for s in st.values()) else np.ones_like(f, dtype=complex)
    d = np.prod([s["H"] for s in st.values() if s["chain"] == "dterm"], axis=0) if any(s["chain"] == "dterm" for s in st.values()) else np.ones_like(f, dtype=complex)
    st["gyro_total"] = dict(H=g, label="Gyro total", chain="total")
    st["dterm_total"] = dict(H=g * d, label="D-term total (gyro + D-term filters)", chain="total")
    return st


# ---------- helpers ----------
def welch(x, fs, nper=512):
    x = np.asarray(x, np.float64)
    if len(x) < nper:
        return None, None
    idx = np.arange(0, len(x) - nper + 1, nper // 2)[:, None] + np.arange(nper)
    seg = x[idx] - x[idx].mean(1, keepdims=True)
    w = np.hanning(nper)
    p = (np.abs(np.fft.rfft(seg * w, axis=1)) ** 2).mean(0) / (fs * (w ** 2).sum())
    return np.fft.rfftfreq(nper, 1 / fs), p


def band_rms(f, p, lo, hi):
    """RMS in [lo, hi) from welch()'s one-sided density (×2 for the negative frequencies: Parseval)."""
    m = (f >= lo) & (f < hi)
    return float(np.sqrt(2 * np.sum(p[m]) * (f[1] - f[0]))) if m.any() else 0.0


def smooth_db(db, n=15):
    pad = np.pad(db, n // 2, mode="edge")
    return np.array([np.median(pad[i:i + n]) for i in range(len(db))])


def find_peaks(f, db, prom=8.0, fmin=40.0):
    base = smooth_db(db, 21)
    out = []
    for i in range(1, len(db) - 1):
        if f[i] >= fmin and db[i] >= db[i - 1] and db[i] >= db[i + 1] and db[i] - base[i] >= prom:
            out.append((float(f[i]), float(db[i] - base[i])))
    out.sort(key=lambda t: -t[1])
    merged = []
    for fr, pr in out:  # keep the strongest peak within ±15 Hz
        if all(abs(fr - m[0]) > 15 for m in merged):
            merged.append((fr, pr))
    return merged


def finding(level, title, tldr, detail="", action="", cost=""):
    return dict(level=level, title=title, tldr=tldr, detail=detail, action=action, cost=cost)


def tracked_noise(raw, filt, motors, fs, nper=256, nh=3):
    """Per 0.25 s segment: level of each motor harmonic in raw vs filtered gyro (tracks the real eRPM),
    plus the average raw spectrum with all motor lines masked out (what's left = frame/other noise)."""
    idx = np.arange(0, len(raw) - nper + 1, nper // 2)[:, None] + np.arange(nper)
    w = np.hanning(nper)
    spec = lambda x: 10 * np.log10(np.abs(np.fft.rfft((x[idx] - x[idx].mean(1, keepdims=True)) * w, axis=1)) ** 2 + 1e-9)
    R, F = spec(raw), spec(filt)
    f = np.fft.rfftfreq(nper, 1 / fs)
    df = f[1] - f[0]
    M = np.stack([m[idx].mean(1) for m in motors], 1)  # segments x motors (Hz)
    floor = np.median(R[:, f > 40], axis=1)
    harm = []
    mask = np.zeros_like(R, dtype=bool)
    for k in range(1, nh + 1):
        fk = M * k
        ok = (fk.min(1) > 40) & (fk.max(1) < f[-1] - 2 * df)
        if ok.sum() < 5:
            harm.append(None)
            continue
        bins = np.clip(np.rint(fk / df).astype(int), 0, len(f) - 1)
        r = np.take_along_axis(R, bins, 1).max(1)
        fl = np.take_along_axis(F, bins, 1).max(1)
        harm.append(dict(k=k, f_med=round(float(np.median(fk[ok])), 1), prominence_db=round(float(np.median((r - floor)[ok])), 1),
                         suppression_db=round(float(np.median((r - fl)[ok])), 1)))
        for j in range(fk.shape[1]):
            mask |= np.abs(f[None, :] - fk[:, j:j + 1]) < np.maximum(0.08 * fk[:, j:j + 1], 1.5 * df)
    resid = np.where(mask, np.nan, R)
    return harm, f, np.nanmean(resid, axis=0)


def _fastlen(n):
    """Smallest 2^a·3^b·5^c ≥ n: numpy's FFT is ~50× slower on lengths with large prime factors."""
    best = 1 << int(np.ceil(np.log2(max(n, 1))))
    p5 = 1
    while p5 < best:
        p35 = p5
        while p35 < best:
            p = p35
            while p < n:
                p *= 2
            best = min(best, p)
            p35 *= 3
        p5 *= 5
    return best


def _band(x, fs, lo=None, hi=None):
    """Zero-phase brick-wall band-pass (DC removed). Zero-padded to a fast FFT length."""
    x = np.asarray(x, np.float64)
    n = len(x); N = _fastlen(n)
    X = np.fft.rfft(x - x.mean(), N); f = np.fft.rfftfreq(N, 1 / fs)
    m = np.ones_like(f, bool)
    if lo is not None: m &= f >= lo
    if hi is not None: m &= f <= hi
    return np.fft.irfft(X * m, N)[:n]


def filter_knob(h, chain, scale):
    """The settings that really move this chain's low-pass cutoffs on this quad, scaled by `scale`, as CLI text."""
    if chain == "gyro" and hnum(h, "simplified_gyro_filter", 0)[0] >= 1:
        cur = hnum(h, "simplified_gyro_filter_multiplier", 100)[0]
        return f"set simplified_gyro_filter_multiplier = {int(round(cur * scale / 5) * 5)} (now {cur:.0f})"
    if chain == "dterm" and hnum(h, "simplified_dterm_filter", 0)[0] >= 1:
        cur = hnum(h, "simplified_dterm_filter_multiplier", 100)[0]
        return f"set simplified_dterm_filter_multiplier = {int(round(cur * scale / 5) * 5)} (now {cur:.0f})"
    p = "gyro" if chain == "gyro" else "dterm"
    out = []
    lo, hi = (hnum(h, f"{p}_lpf1_dyn_hz", 0) + [0])[:2]
    if lo > 0:
        out.append(f"set {p}_lpf1_dyn_min_hz = {int(round(lo * scale))}, {p}_lpf1_dyn_max_hz = {int(round(hi * scale))}")
    elif hnum(h, f"{p}_lpf1_static_hz", 0)[0] > 0:
        out.append(f"set {p}_lpf1_static_hz = {int(round(hnum(h, f'{p}_lpf1_static_hz')[0] * scale))}")
    if hnum(h, f"{p}_lpf2_static_hz", 0)[0] > 0:
        out.append(f"set {p}_lpf2_static_hz = {int(round(hnum(h, f'{p}_lpf2_static_hz')[0] * scale))}")
    return "; ".join(out) if out else f"(no {chain} low-pass is enabled: enable {p}_lpf1)"


def noise_budget(lg, sl, lo=80.0):
    """Fast (> lo Hz) part of each motor command (% of range), and which PID term it comes from. The PID sum maps to the
    mixer at 1/1000 of the motor range (Betaflight PID_MIXER_SCALING), so 10 PID units = 1 % motor output."""
    c, fs = lg.cols, lg.fs
    mk = [k for k in (f"motor%[{i}]" for i in range(8)) if k in c]
    thr = c["throttle%"][sl]
    air = thr > 5
    if not mk or air.sum() < fs:
        return None
    mot = [float(np.sqrt(np.mean(_band(c[k][sl], fs, lo)[air] ** 2))) for k in mk]
    var = {"P": 0.0, "I": 0.0, "D": 0.0, "F": 0.0}
    dfr = []
    for ax in range(3):
        for t in "PIDF":
            k = f"axis{t}[{ax}]"
            if k in c:
                var[t] += float(np.mean(_band(c[k][sl], fs, lo)[air] ** 2))
        if ax < 2 and f"axisD[{ax}]" in c:
            d = c[f"axisD[{ax}]"][sl].astype(float)
            tot = float(np.sqrt(np.mean((d - d.mean())[air] ** 2)))
            if tot > 0.5:
                dfr.append(float(np.sqrt(np.mean(_band(d, fs, 100)[air] ** 2))) / tot)
    tv = sum(var.values()) or 1.0
    return dict(motor=[round(v, 2) for v in mot], motor_max=round(max(mot), 2), share={k: round(v / tv, 3) for k, v in var.items()},
                pid_est=round(float(np.sqrt(tv)) / 10, 2), d_frac=round(max(dfr), 3) if dfr else 0.0)


def lf_wobble(lg, sl, nper=256):
    """Filtered gyro (roll/pitch) RMS in 20–100 Hz with each motor's ×1–×3 (±8 %) cut out window by window."""
    c, fs = lg.cols, lg.fs
    motors = [c[f"motorHz[{i}]"][sl].astype(float) for i in range(8) if f"motorHz[{i}]" in c]
    thr = c["throttle%"][sl]
    n = len(thr)
    if n < 4 * nper:
        return None
    idx = np.arange(0, n - nper + 1, nper // 2)[:, None] + np.arange(nper)
    idx = idx[thr[idx].mean(1) > 5]
    if len(idx) < 4:
        return None
    f = np.fft.rfftfreq(nper, 1 / fs); w = np.hanning(nper); df = f[1] - f[0]
    band = (f >= 20) & (f <= 100)
    msk = np.zeros((len(idx), len(f)), bool)
    for m in motors:
        fm = m[idx].mean(1)[:, None]
        for k in (1, 2, 3):
            msk |= np.abs(f[None] - k * fm) < np.maximum(0.08 * k * fm, 1.5 * df)
    best = None
    for ax in (0, 1):
        x = c[f"gyroADC[{ax}]"][sl].astype(float)[idx]
        P = np.abs(np.fft.rfft((x - x.mean(1, keepdims=True)) * w, axis=1)) ** 2 / (fs * (w ** 2).sum()) * 2
        tot = P[:, band].sum(1) * df
        res = np.where(msk, 0, P)[:, band].sum(1) * df / np.maximum(1 - msk[:, band].mean(1), 0.2)   # rescale for the bins cut out
        tot_m, res_m = float(np.mean(tot)), float(np.mean(np.minimum(res, tot)))
        spec = np.nanmean(np.where(msk, np.nan, P), 0)
        pk = float(f[band][np.nanargmax(spec[band])]) if np.isfinite(spec[band]).any() else 0.0
        r = dict(resid=round(float(np.sqrt(res_m)), 2), total=round(float(np.sqrt(tot_m)), 2), motor_share=round(max(0.0, 1 - res_m / max(tot_m, 1e-12)), 2), peak_hz=round(pk, 1), axis=ax)
        if best is None or r["resid"] > best["resid"]:
            best = r
    return best


# ---------- noise report ----------
def _lpf_only(st, chain):
    keys = [k for k in st if st[k]["chain"] == "gyro" and "lpf" in k]
    if chain == "dterm":
        keys += [k for k in st if st[k]["chain"] == "dterm" and "lpf" in k]
    return np.prod([st[k]["H"] for k in keys], axis=0) if keys else None


def noise_report(lg, t0=None, t1=None, res_prom=6.0, res_persist=40.0, res_mask=4.0, res_fmax=None, nper=512, prof=None):
    nper = int(min(8192, max(64, 2 ** round(np.log2(nper)))))
    c, h, sl = lg.cols, lg.headers, lg.window(t0, t1)
    fs = lg.fs
    thr = c["throttle%"][sl]
    armed = thr > 0
    motors = [c[f"motorHz[{i}]"][sl] for i in range(8) if f"motorHz[{i}]" in c]
    out = {"axes": {}, "findings": []}
    F = out["findings"]
    rms_hf, rms_lf, d_hf, d_lf, resid_peaks, harm_all = [], [], [], [], [], []
    f = None
    for ax in range(3):
        a = {}
        f, pr = welch(c[f"gyroUnfilt[{ax}]"][sl], fs, nper)
        if f is None:
            return {"error": "window too short for this resolution: select more flight time or a lower resolution"}
        _, pf = welch(c[f"gyroADC[{ax}]"][sl], fs, nper)
        a["raw"], a["filt"] = (10 * np.log10(pr + 1e-12)).round(2).tolist(), (10 * np.log10(pf + 1e-12)).round(2).tolist()
        if f"axisD[{ax}]" in c:
            _, pd = welch(c[f"axisD[{ax}]"][sl], fs, nper)
            a["dterm"] = (10 * np.log10(pd + 1e-12)).round(2).tolist()
            if ax < 2:
                d_hf.append(band_rms(f, pd, 100, fs / 2)); d_lf.append(band_rms(f, pd, 1, 50))
        if ax < 2:
            rms_hf.append(band_rms(f, pf, 100, fs / 2)); rms_lf.append(band_rms(f, pf, 20, 100))
        if motors:
            harm, fr, res = tracked_noise(c[f"gyroUnfilt[{ax}]"][sl], c[f"gyroADC[{ax}]"][sl], motors, fs,
                                          nh=max(int(hnum(h, "rpm_filter_harmonics", 3)[0]), 3))
            harm_all.append(harm)
            resid_peaks += [(fq, pr_, ax) for fq, pr_ in find_peaks(fr, res, prom=5.5, fmin=50)[:3]]
        out["axes"][str(ax)] = a
    out["f"] = f.round(2).tolist()

    # ----- filter model, snapshot at this window's typical throttle and motor speed -----
    thr_mean = float(np.mean(thr[armed]) / 100) if armed.any() else 0.3
    mot_med = [float(np.median(m[armed])) for m in motors] if motors and armed.any() else None
    lo_d, hi_d = hnum(h, "dyn_notch_min_hz", 0)[0], hnum(h, "dyn_notch_max_hz", 0)[0]
    n_dyn = int(hnum(h, "dyn_notch_count", 0)[0])
    cand = sorted([p for p in resid_peaks if lo_d <= p[0] <= hi_d], key=lambda p: -p[1])
    dyn_est = []
    for p in cand:
        if len(dyn_est) < n_dyn and all(abs(p[0] - q) > 20 for q in dyn_est):
            dyn_est.append(p[0])
    st = filter_model(h, f, thr_mean, mot_med, dyn_est)
    out["filters"] = {k: dict(label=s["label"], chain=s["chain"], db=(20 * np.log10(np.abs(s["H"]) + 1e-9)).clip(-60, 6).round(2).tolist())
                      for k, s in st.items()}
    bands = []
    if motors and armed.any() and hnum(h, "rpm_filter_harmonics")[0] > 0:
        mm = np.mean(motors, axis=0)[armed]
        p10, p90 = np.percentile(mm, [10, 90])
        for k in range(1, int(hnum(h, "rpm_filter_harmonics")[0]) + 1):
            bands.append(dict(kind="rpm", x0=round(float(p10) * k, 1), x1=round(float(p90) * k, 1), label=f"motor ×{k}"))
    if n_dyn and hi_d > 0:
        bands.append(dict(kind="dyn", x0=float(lo_d), x1=float(hi_d), label="dyn notch range"))
    out["bands"] = bands

    # ----- delays -----
    g_lp, d_lp = _lpf_only(st, "gyro"), _lpf_only(st, "dterm")
    dg = phase_delay_ms(g_lp, f) if g_lp is not None else 0.0
    dd = phase_delay_ms(d_lp, f) if d_lp is not None else 0.0
    st_up = filter_model(h, f, thr_mean, scale=1.2)
    st_dn = filter_model(h, f, thr_mean, scale=0.85)
    dg_up, dd_up = phase_delay_ms(_lpf_only(st_up, "gyro"), f), phase_delay_ms(_lpf_only(st_up, "dterm"), f)
    dg_dn, dd_dn = phase_delay_ms(_lpf_only(st_dn, "gyro"), f), phase_delay_ms(_lpf_only(st_dn, "dterm"), f)
    out["delay"] = dict(gyro_ms=dg, dterm_ms=dd, thr_pct=round(thr_mean * 100))
    sp = (prof or {}).get("params") or {"gyro_delay_light": 1.0, "gyro_delay_heavy": 2.0, "dterm_delay_light": 2.5, "dterm_delay_heavy": 4.0}
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    out["df"] = round(float(f[1] - f[0]), 2)
    lvl = "good" if dg < sp["gyro_delay_light"] else "info" if dg < sp["gyro_delay_heavy"] else "warning"
    F.append(finding(lvl, f"Filter delay: gyro {dg} ms, D-term {dd} ms",
                     "Less delay = sharper and better in propwash; more delay = smoother and quieter.",
                     f"How late a 100 Hz signal arrives after passing the low-pass filters, at this flight's average throttle ({thr_mean * 100:.0f}%). "
                     "The PID controller always reacts to slightly old data; the older it is, the less P and D you can use before it oscillates. "
                     "Notches are left out here because they only delay signals close to their own frequency.",
                     f"Guide for {inch:g}″ props (bigger props react slower, so they tolerate more delay): gyro under {sp['gyro_delay_light']} ms is light, "
                     f"over {sp['gyro_delay_heavy']} ms heavy. D-term under {sp['dterm_delay_light']} ms light, over {sp['dterm_delay_heavy']} ms heavy."))

    # ----- noise that reaches the motors, and which term carries it -----
    hf = max(rms_hf) if rms_hf else 0
    nb = noise_budget(lg, sl)
    out["budget"] = nb
    if nb:
        mx, sh = nb["motor_max"], nb["share"]
        lvl = "good" if mx < 1.0 else "info" if mx < 2.0 else "warning"
        src = max(sh, key=sh.get)
        src_txt = {"P": "P (gyro noise that passes the gyro filters goes straight through P)", "D": "D (it amplifies whatever fast gyro noise is left)",
                   "F": "feedforward (radio-link steps)", "I": "I"}[src]
        brk = ", ".join(f"{k} {v * 100:.0f}%" for k, v in sorted(sh.items(), key=lambda kv: -kv[1]) if v >= 0.05)
        act = ""
        if lvl != "good":
            if src == "P":
                act = (f"Filter the gyro more ({filter_knob(h, 'gyro', 0.85)}: gyro delay {dg} → ~{dg_dn} ms) or find the vibration source; "
                       "the D-term filters don't touch this part.")
            elif src == "D":
                act = f"Filter the D-term more ({filter_knob(h, 'dterm', 0.85)}: D-term delay {dd} → ~{dd_dn} ms) or lower D a little."
            elif src == "F":
                act = "Raise feedforward_smooth_factor or use a faster RC link rate."
        F.append(finding(lvl, f"Noise reaching the motors: {mx:.1f}% RMS above 80 Hz, mostly from {src}",
                         f"Comes from {src_txt}.",
                         f"The motor commands' fast part (above 80 Hz, where the props can't follow anyway) per motor: "
                         + " · ".join(f"M{m + 1} {v:.1f}%" for m, v in enumerate(nb["motor"])) +
                         f". Split by PID term (share of that fast power, roll + pitch + yaw): {brk}. "
                         f"For reference: filtered gyro above 100 Hz {hf:.2f} °/s; {nb['d_frac'] * 100:.0f}% of the D term's output is above 100 Hz. "
                         "This fast part can't produce useful thrust: it ends up as motor heat and noise. How much is too much depends on the motors, so "
                         "feel them after a hard flight; if they're hot, this is the first thing to reduce.",
                         act, "More filtering = more delay: slightly softer response and propwash handling." if act else ""))

    out["metrics"] = dict(gyro_hf=round(hf, 2), gyro_lf=round(max(rms_lf) if rms_lf else 0, 2),
                          dterm_hf=round(max(d_hf), 2) if d_hf else None, dterm_ratio=round(max(d_hf) / (max(d_lf) + 1e-9), 2) if d_hf else None,
                          nper=nper, df=round(float(f[1] - f[0]), 2), segments=int(max(1, (sl.stop - sl.start) // (nper // 2) - 1)),
                          motor_hf=nb["motor_max"] if nb else None)
    # ----- RPM filter: how much it really removes at each motor harmonic, and why when it's weak -----
    nh = int(hnum(h, "rpm_filter_harmonics")[0])
    rpm_weak = False
    if harm_all and nh and hnum(h, "dshot_bidir")[0] and motors and armed.any():
        typ = float(np.median(np.mean(motors, axis=0)[armed]))
        low = float(np.percentile(np.min(motors, axis=0)[armed], 5))
        wts = (hnum(h, "rpm_filter_weights", 100) * 3)[:nh]
        mn, frng = hnum(h, "rpm_filter_min_hz", 100)[0], hnum(h, "rpm_filter_fade_range_hz", 50)[0]
        worst = {}
        for harm in harm_all[:2]:
            for hm in harm:
                if hm and hm["k"] <= nh:
                    w_ = worst.get(hm["k"])
                    if w_ is None or hm["suppression_db"] < w_["suppression_db"]:
                        worst[hm["k"]] = hm
        rows = []
        for k, w_ in sorted(worst.items()):
            _, eff = rpm_notch(h, typ * k, wts[k - 1] / 100)
            rows.append(dict(w_, eff=eff, set_w=wts[k - 1] / 100))
        out["metrics"]["rpm_min_db"] = round(min(r["suppression_db"] for r in rows), 1) if rows else None
        out["rpm"] = dict(typ_hz=round(typ, 1), low_hz=round(low, 1), harmonics=rows)
        txt = ", ".join(f"×{r['k']} (≈{r['f_med']:.0f} Hz): −{r['suppression_db']:.0f} dB" for r in rows)
        weak = [r for r in rows if r["prominence_db"] > 6 and r["suppression_db"] < 12]
        rpm_weak = bool(weak)
        for r in weak:
            k = r["k"]
            if r["set_w"] < 0.5:
                F.append(finding("info", f"×{k} motor noise isn't filtered: rpm_filter_weights sets that notch to {r['set_w'] * 100:.0f}%",
                                 f"It stands +{r['prominence_db']:.0f} dB in the raw gyro; −{r['suppression_db']:.0f} dB after filtering.",
                                 "You (or a preset) turned this harmonic's notch down. That's fine when it's quiet, but on this flight it's clearly present.",
                                 f"If the motors run warm or the D term is noisy, raise the ×{k} weight in rpm_filter_weights.", "A little more delay near that frequency."))
            elif r["eff"] < 0.85:
                f_full = 0.8 * typ * k                       # full depth a bit below cruise speed
                new_min = max(40.0, f_full - frng)
                new_fade = max(0.0, f_full - new_min)
                rec = f"set rpm_filter_min_hz = {int(5 * round(new_min / 5))}" + (f", rpm_filter_fade_range_hz = {int(5 * round(new_fade / 5))}" if abs(new_fade - frng) > 4 else "")
                F.append(finding("warning" if r["suppression_db"] < 8 else "info",
                                 f"×{k} RPM notch works at only {r['eff'] * 100:.0f}% strength at your usual motor speed",
                                 f"The ×{k} motor noise (+{r['prominence_db']:.0f} dB in the raw gyro) is only cut by {r['suppression_db']:.0f} dB.",
                                 f"Betaflight fades each RPM notch out between rpm_filter_min_hz ({mn:.0f} Hz) and rpm_filter_min_hz + rpm_filter_fade_range_hz ({mn + frng:.0f} Hz). "
                                 f"Your motors spend most of the flight around {typ:.0f} Hz, so the ×{k} notch at ≈{typ * k:.0f} Hz is {'mostly ' if r['eff'] < 0.5 else ''}faded. "
                                 f"A notch at {r['eff'] * 100:.0f}% depth can remove at most ≈{-20 * np.log10(max(1e-3, 1 - r['eff'])):.0f} dB, which matches what was measured.",
                                 f"{rec}: the ×{k} notch then reaches full depth from ≈{f_full:.0f} Hz, below where your motors usually run (they go down to ≈{low:.0f} Hz near idle).",
                                 "A notch near the motor fundamental adds a little delay at low throttle; keep rpm_filter_min_hz above the idle motor speed's ×1 if descents get jittery."))
            else:
                F.append(finding("warning", f"The ×{k} RPM notch is at full strength but only removes {r['suppression_db']:.0f} dB",
                                 "The notch probably sits off the real noise frequency, or is too narrow.",
                                 f"At ≈{r['f_med']:.0f} Hz the motor noise stands +{r['prominence_db']:.0f} dB in the raw gyro, and the notch (weight {r['set_w'] * 100:.0f}%, not faded) "
                                 "should remove much more than that.",
                                 f"Check motor_poles = {hnum(h, 'motor_poles', 14)[0]:.0f} matches your motors (count the magnets). If it does, widen the notches: rpm_filter_q {hnum(h, 'rpm_filter_q', 500)[0]:.0f} → {max(250, hnum(h, 'rpm_filter_q', 500)[0] * 0.7):.0f}.",
                                 "Wider notches add a little delay near the motor frequencies."))
        if not weak and rows:
            F.append(finding("good", "The RPM filter removes motor noise well", txt,
                             "Each motor's measured speed was followed through the flight, and raw vs filtered gyro compared at exactly that frequency. "
                             f"More than 12 dB removed on every harmonic that stands out. Motor speed: typically {typ:.0f} Hz, down to ≈{low:.0f} Hz near idle "
                             f"(notches fade out below {mn + frng:.0f} Hz and are off below {mn:.0f} Hz)."))
        quiet = [r for r in rows if r["prominence_db"] < 4 and r["set_w"] >= 0.5 and r["k"] == max(x["k"] for x in rows)]
        if quiet:
            F.append(finding("info", f"Motor harmonic ×{quiet[0]['k']} is barely there",
                             f"It stands only {quiet[0]['prominence_db']:.0f} dB above the background in the raw gyro.",
                             "The highest RPM-filter harmonic has very little to remove on this flight.",
                             f"Optional: rpm_filter_harmonics {nh} → {nh - 1} saves a few notches. Check with another flight first: it can appear at other throttles or battery levels.",
                             ""))

    # ----- frame resonances (fixed frequency across throttle, motor harmonics masked) -----
    res = resonances(lg, t0, t1, prom=res_prom, persist=res_persist, mask=res_mask, fmax=res_fmax)
    out["resonances"] = res
    F.extend(resonance_findings(res, h))
    # ----- dynamic notch: is there anything in its range for it to track? (searched over its own range, up to Nyquist) -----
    n_dyn = int(hnum(h, "dyn_notch_count", 0)[0])
    lo_d, hi_d = hnum(h, "dyn_notch_min_hz", 0)[0], hnum(h, "dyn_notch_max_hz", 0)[0]
    top = min(hi_d, 0.45 * fs)
    if n_dyn and top > lo_d + 20:
        rd = {"list": [r for r in res["list"] if lo_d <= r["f"] <= top]} if (res_fmax or 0.45 * fs) >= top else resonances(lg, t0, t1, prom=res_prom, persist=res_persist, mask=res_mask, fmin=max(lo_d, 25.0), fmax=top)
        k_ = len(rd["list"])
        out["dyn_check"] = dict(found=k_, fmin=lo_d, fmax=round(top), list=rd["list"][:4])
        lim_txt = f" (the log can only show up to {fs / 2:.0f} Hz, so {top:.0f}–{hi_d:.0f} Hz is unchecked)" if top < hi_d else ""
        if k_ < n_dyn and nh and not rpm_weak:
            F.append(finding("info", f"{n_dyn} dynamic notch{'es' if n_dyn > 1 else ''}, {k_} fixed peak{'s' if k_ != 1 else ''} for {'them' if n_dyn > 1 else 'it'} to catch",
                             f"Searched {lo_d:.0f}–{top:.0f} Hz{lim_txt}, with motor noise (handled by the RPM filter) cut out.",
                             f"The dynamic notch is there for vibration that isn't tied to motor speed (frame, mounts). In its range this flight shows "
                             + (f"{k_}: " + ", ".join(f"{r['f']:.0f} Hz" for r in rd["list"][:4]) if k_ else "none") + " at this strictness. Each notch adds some delay below its frequency.",
                             f"Optional: dyn_notch_count {n_dyn} → {max(1, k_)}" + (" (keeping one as a safety net)" if k_ == 0 else "") + ". Confirm on a harder flight before removing more.",
                             "Less protection if a resonance appears later (crash damage, new frame)."))
    # ----- 20–100 Hz content that isn't motor noise: wobble the filters can't remove without costing control -----
    lfm = lf_wobble(lg, sl)
    out["lf"] = lfm
    if lfm and lfm["resid"] > 1.5:
        rs = [r for r in res["list"] if 20 <= r["f"] <= 100]
        F.append(finding("warning" if lfm["resid"] > 2.5 else "info", f"Vibration between 20 and 100 Hz that isn't motor noise ({lfm['resid']:.1f} °/s)",
                         f"Strongest around {lfm['peak_hz']:.0f} Hz" + (f", the same as resonance {rs[0]['id']}" if rs else "") + ".",
                         f"Filtered gyro, roll/pitch, 20–100 Hz with every motor harmonic cut out ({lfm['motor_share'] * 100:.0f}% of that band was motor noise and is not counted). "
                         "This range overlaps what the controller works with, so filtering it costs response. Common sources: frame or arm flex, loose parts, "
                         "a damaged prop, or an oscillation of the tune itself (then it shows in the Tracking tab as a regular ripple).",
                         "If a resonance is listed at that frequency, fix it mechanically first. If it only appears after throttle chops, see the Propwash tab.",
                         ""))
    nyq = fs / 2
    over = [lbl for lbl, key in (("gyro LPF2", "gyro_lpf2_static_hz"), ("dyn notch max", "dyn_notch_max_hz")) if hnum(h, key)[0] >= nyq * 0.95]
    if over:
        F.append(finding("info", f"This log can't show anything above {nyq:.0f} Hz",
                         f"{' and '.join(over).capitalize()} {'sit' if len(over) > 1 else 'sits'} above what a {fs:.0f} Hz log can show.",
                         "A log can only show frequencies up to half its sample rate. Faster noise still exists, and can even show up as a fake lower frequency (aliasing).",
                         "For a filter-tuning flight, set blackbox_sample_rate to 1/2 or 1/1 (2–4 kHz).", "Bigger files, shorter recording time."))
    return out


# ---------- step response advice ----------
def step_metrics(t_ms, med, q25, q75):
    t = np.asarray(t_ms)
    k = max(1, int(round(6 / (t[1] - t[0]))))  # ~6 ms moving average: removes estimator ripple, keeps real ringing (<80 Hz)
    y = np.convolve(np.pad(np.asarray(med), (k // 2, k - 1 - k // 2), mode="edge"), np.ones(k) / k, mode="valid")
    first = lambda cond: float(t[np.argmax(cond)]) if cond.any() else None
    peak_i = int(np.argmax(np.where(t < 250, y, -np.inf)))
    ss = float(np.mean(y[(t >= 200) & (t <= 500)]))
    t10, t50, t90 = first(y >= 0.1), first(y >= 0.5), first(y >= 0.9)
    after = np.where((np.abs(y - ss) > 0.1) & (t < 400))[0]
    # count swings > 5% around the final value after the peak, below 30 Hz only: faster ripple in the estimate is frame
    # vibration leaking through, not the loop ringing (loop crossover on any prop size is well below that)
    dt = (t[1] - t[0]) / 1000
    pad = len(y)
    Y = np.fft.rfft(np.r_[y, y[::-1]]); fr_ = np.fft.rfftfreq(2 * pad, dt)
    yr = np.fft.irfft(Y * (fr_ <= 30), 2 * pad)[:pad]
    e = yr[(t >= t[peak_i]) & (t < 250)] - ss
    ring, sign = 0, 0
    for v in e:
        if abs(v) > 0.05 and np.sign(v) != sign:
            ring, sign = ring + (sign != 0), np.sign(v)
    return dict(peak=round(float(y[peak_i]), 3), overshoot_pct=round(max(0.0, float(y[peak_i]) - 1) * 100, 1),
                t_peak_ms=round(float(t[peak_i]), 1), latency_ms=round(t50, 1) if t50 is not None else None,
                rise_ms=round(t90 - t10, 1) if t10 is not None and t90 is not None else None,
                settle_ms=round(float(t[after[-1]]), 1) if len(after) else 0.0, steady=round(ss, 3), ringing=int(ring),
                spread=round(float(np.mean((np.asarray(q75) - np.asarray(q25))[(t > 50) & (t < 300)])), 3))


D_NOISY = 0.5   # D term counts as noisy when at least this share of its output (RMS) is above 100 Hz


def step_reliability(t_ms, steps, m, ax, rng, nboot=150):
    """How far the measured step response can be trusted. Bootstrap over the stick-move windows gives 90 % ranges; a roll /
    pitch response that doesn't settle near 1 is physically implausible for a rate loop around a free-spinning airframe
    (it can only come from estimation bias: stick moves too small for the turbulence / vibration around them)."""
    n = len(steps)
    t = np.asarray(t_ms)
    B = []
    for _ in range(nboot if n >= 5 else 0):
        q = np.median(steps[rng.integers(0, n, n)], 0)
        b = step_metrics(t, q, q, q)
        B.append((b["overshoot_pct"], b["rise_ms"] if b["rise_ms"] is not None else np.nan, b["steady"], b["ringing"], b["peak"]))
    B = np.array(B, float) if B else np.full((1, 5), np.nan)
    ci = lambda j: [round(float(np.nanpercentile(B[:, j], 5)), 2), round(float(np.nanpercentile(B[:, j], 95)), 2)] if np.isfinite(B[:, j]).any() else None
    r = dict(n=n, overshoot_ci=ci(0), rise_ci=ci(1), steady_ci=ci(2), ring_p=round(float(np.mean(B[:, 3] >= 2)), 2) if n >= 5 else 0.0)
    why = []
    if n < 30:
        why.append(f"only {n} stick moves (30+ needed)")
    if ax < 2 and not 0.85 <= m["steady"] <= 1.15:
        why.append(f"it settles at {m['steady']:.2f}× the command, which a rate loop can't really do: the stick moves are too small for the turbulence and vibration around them")
    if r["overshoot_ci"] and r["overshoot_ci"][1] - r["overshoot_ci"][0] > 25:
        why.append(f"the overshoot could be anywhere from {r['overshoot_ci'][0]:.0f} to {r['overshoot_ci'][1]:.0f}%")
    r["ok"] = not why
    r["why"] = why
    return r


def step_advice(ax, m, n, h, prof=None, rel=None):
    name = ["Roll", "Pitch", "Yaw"][ax]
    pid = hnum(h, ["rollPID", "pitchPID", "yawPID"][ax], 0)
    p, i_, d = (pid + [0, 0, 0])[:3]
    ff = (hnum(h, "ff_weight", 0) * 3)[ax]
    yaw = ax == 2
    rel = rel or {"ok": n >= 30, "why": [] if n >= 30 else [f"only {n} stick moves"], "overshoot_ci": None, "rise_ci": None, "steady_ci": None, "ring_p": 0}
    F = []
    if not rel["ok"]:
        F.append(finding("info", f"{name}: can't judge the tune from this selection", "; ".join(rel["why"]).capitalize() + ".",
                         "The step response is worked out from your own stick moves. It needs enough of them, and they must be large compared with the "
                         "wobble the quad gets from wind, propwash and vibration, otherwise the estimate is dominated by those. The curve is still drawn, but no "
                         "conclusions are drawn from it.",
                         "Select a part with more decisive rolls, flips or snaps (the 'active' stick-rate preset), or log a flight with some."))
        return "Low confidence", F
    rl = ((prof or {}).get("params") or {}).get("rise_ok_ms", 25)
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    rise_lim, os_warn, os_bad = (round(rl * 1.6), 20, 35) if yaw else (rl, 12, 25)
    os_, rise, ss = m["overshoot_pct"], m["rise_ms"] or 999, m["steady"]
    oc, rc, sc = rel["overshoot_ci"] or [os_, os_], rel["rise_ci"] or [rise, rise], rel["steady_ci"] or [ss, ss]
    rng_ = lambda c, u="": f"{c[0]:.0f}–{c[1]:.0f}{u}"
    dn = lambda x, pct: round(x * (1 + pct / 100))
    sim_hint = " The PID simulator shows on a model of this quad which of these brings it down."
    if oc[0] > os_warn:
        F.append(finding("serious" if oc[0] > os_bad else "warning", f"{name}: {os_:.0f}% overshoot (90% range {rng_(oc, '%')})",
                         "It goes past the target before settling.",
                         f"Across {n} stick moves the response peaks at {m['peak']:.2f}× the command after {m['t_peak_ms']:.0f} ms. Overshoot comes from P being strong "
                         f"relative to D, from feedforward pushing ahead of the move, or from filter delay making D brake late.{sim_hint}",
                         f"Options: D +10–15% (D {d:.0f} → {dn(d, 12)}), or P −10% (P {p:.0f} → {dn(p, -10)})" + (f", or FF −15% ({ff:.0f} → {dn(ff, -15)}) if it's mostly on quick flicks" if ff > 0 else "") + ".",
                         "More D → warmer motors. Less P → softer hold. Less FF → sticks feel slightly delayed."))
    if oc[1] < 3 and rc[0] > rise_lim:
        F.append(finding("warning", f"{name}: slow response ({rise:.0f} ms to rise, range {rng_(rc, ' ms')}; {os_:.0f}% overshoot)",
                         "Very safe, but lazy to follow the sticks.",
                         f"Going from 10% to 90% of the move takes {rise:.0f} ms with almost no overshoot. For {inch:g}″ props, above ~{rise_lim} ms is on the slow side.{sim_hint}",
                         f"Options: P +10% (P {p:.0f} → {dn(p, 10)})" + (f", or FF +15% ({ff:.0f} → {dn(ff, 15)}) for a sharper stick feel" if ff > 0 else "") + ".",
                         "More risk of overshoot and more sensitivity to noise and propwash."))
    if sc[1] < 0.93:
        F.append(finding("warning" if sc[1] < 0.88 else "info", f"{name}: settles short of the target ({ss:.2f}, range {sc[0]:.2f}–{sc[1]:.2f})", "Doesn't fully hold the rate you ask for within half a second.",
                         "200–500 ms after a move the rotation stays below the command. The props' aerodynamic damping (strongest on yaw) leaves an error that only the I term removes, "
                         "and I-term relax slows it down on purpose during moves.",
                         f"I +15% (I {i_:.0f} → {dn(i_, 15)}).", "Too much I gives a slow wobble and bounce-back after flips."))
    elif sc[0] > 1.07:
        F.append(finding("warning", f"{name}: settles above the target ({ss:.2f}, range {sc[0]:.2f}–{sc[1]:.2f})", "Keeps pushing past the command after the first peak.",
                         "200–500 ms after a move the rotation is still above the command, usually from too much feedforward or from I building up during the move.",
                         f"Options: FF −10% ({ff:.0f} → {dn(ff, -10)}) or I −10% ({i_:.0f} → {dn(i_, -10)}).", "Slightly less locked-in feel."))
    if m["ringing"] >= 2 and rel.get("ring_p", 0) >= 0.8:
        F.append(finding("warning" if m["ringing"] >= 3 else "info", f"{name}: wobbles before settling ({m['ringing']} swings)", "It rocks back and forth around the target.",
                         f"Seen in {rel['ring_p'] * 100:.0f}% of resampled estimates, so it's consistent. Swinging back and forth means the loop is close to its stability "
                         f"limit: P too strong for the damping available, or filters adding too much delay.{sim_hint}",
                         f"Options: D +10% ({d:.0f} → {dn(d, 10)}), or P −5–10%.", "More D → warmer motors; less P → softer feel."))
    if not any(x["level"] in ("warning", "serious") for x in F):
        F.append(finding("good", f"{name}: no problems in the step response ({os_:.0f}% overshoot, {rise:.0f} ms rise, settles at {ss:.2f})",
                         "Fast and well damped for this selection.",
                         f"From {n} stick moves. Halfway in {m['latency_ms']} ms, within ±10% after {m['settle_ms']:.0f} ms. 90% ranges: overshoot {rng_(oc, '%')}, rise {rng_(rc, ' ms')}."))
    verdict = "Needs work" if any(x["level"] == "serious" for x in F) else "OK" if any(x["level"] == "warning" for x in F) else "Good"
    return verdict, F


# ---------- frame resonance detector ----------
def _nanmedfilt(x, half):
    """Running median over ±half[i] bins (scalar or per-bin), ignoring NaN (masked) bins instead of closing the gap."""
    n = len(x)
    half = np.broadcast_to(np.asarray(half, int), (n,))
    out = np.full(n, np.nan)
    x = np.asarray(x, float)
    import warnings
    from numpy.lib.stride_tricks import sliding_window_view
    with warnings.catch_warnings():
        warnings.simplefilter("ignore", RuntimeWarning)
        for h in np.unique(half):            # vectorised per window size (NaN padding = window cut at the edges)
            idx = np.flatnonzero(half == h)
            win = sliding_window_view(np.r_[np.full(h, np.nan), x, np.full(h, np.nan)], 2 * h + 1)[idx]
            good = np.isfinite(win).sum(1) >= 3
            out[idx[good]] = np.nanmedian(win[good], axis=1)
    return out


def resonances(lg, t0=None, t1=None, prom=6.0, persist=40.0, mask=4.0, nper=None, fmin=25.0, fmax=None):
    """Memoised per log: the Noise tab, filter planner, PID behaviour and motor power all ask for the same list."""
    import copy
    sl = lg.window(t0, t1)
    key = (sl.start, sl.stop, float(prom), float(persist), float(mask), nper, float(fmin), fmax)
    cache = lg.__dict__.setdefault("_res_cache", {})
    if key not in cache:
        if len(cache) > 32:
            cache.clear()
        cache[key] = _resonances(lg, t0, t1, prom, persist, mask, nper, fmin, fmax)
    return copy.deepcopy(cache[key])


def _resonances(lg, t0=None, t1=None, prom=6.0, persist=40.0, mask=4.0, nper=None, fmin=25.0, fmax=None):
    """Vibration at a FIXED frequency across throttle (frame, arms, mounts), with motor noise cut out.

    Raw gyro, ~2 Hz resolution, 5 % throttle bands. Every motor harmonic up to Nyquist (each motor's own measured speed,
    window by window) is masked ±mask % (at least ±2 bins), and masked bins are treated as missing, not removed, so the
    neighbouring frequencies keep their place. In each band a peak must stand prom dB above the local median (±15 Hz) of
    the unmasked spectrum. Peaks are then grouped across bands by frequency; persistence = bands where the peak shows /
    bands where that frequency could be seen at all. A peak whose frequency follows throttle is rejected (that's an
    unmasked motor order, not the frame).
    prom    = min height above the local baseline (dB)                 → higher = stricter
    persist = min % of the bands (within the throttle span where it shows) where it was observable → higher = stricter
    mask    = ± % around each motor harmonic that is ignored"""
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    thr = c["throttle%"][sl]
    fmax = min(fmax or 0.45 * fs, 0.45 * fs)
    nper = int(nper or 2 ** int(round(np.log2(fs / 2))))
    motors = [c[f"motorHz[{i}]"][sl].astype(np.float64) for i in range(8) if f"motorHz[{i}]" in c]
    f = np.fft.rfftfreq(nper, 1 / fs)
    df, w = f[1] - f[0], np.hanning(nper)
    n = len(thr)
    if n < nper * 4:
        return {"list": [], "bands": 0, "params": dict(prom=prom, persist=persist, mask=mask, fmin=fmin, fmax=fmax)}
    idx = np.arange(0, n - nper + 1, nper // 2)[:, None] + np.arange(nper)
    tb = np.clip((thr[idx].mean(1) // 5).astype(int), 0, 19)
    armed = thr[idx].mean(1) > 1
    msk = np.zeros((len(idx), len(f)), bool)
    if motors:
        for m in motors:
            fm = m[idx].mean(1)[:, None]
            kmax = int(np.ceil(f[-1] / max(np.nanmin(fm[armed]) if armed.any() else 30.0, 20.0))) + 1
            for k in range(1, min(kmax, 40) + 1):
                fk = fm * k
                msk |= np.abs(f[None, :] - fk) < np.maximum(fk * mask / 100, 2 * df)
    band_ok = (f >= fmin) & (f <= fmax)
    half = np.maximum(2, np.round(np.clip(0.35 * f, 15.0, 30.0) / df)).astype(int)   # baseline ±35 % of f, 15–30 Hz: broad low humps stay visible
    found = []                                     # (freq, prom, axis, band)
    seen = np.zeros((20, len(f)), bool)            # bin observable in band
    filt_att = {}
    bands_used = set()
    for ax in range(3):
        raw = c[f"gyroUnfilt[{ax}]"][sl].astype(np.float64)
        X = raw[idx]
        P = np.abs(np.fft.rfft((X - X.mean(1, keepdims=True)) * w, axis=1)) ** 2
        P = np.where(msk, np.nan, P)
        for b in range(20):
            s = armed & (tb == b)
            if s.sum() < 6:
                continue
            bands_used.add(b)
            cnt = np.isfinite(P[s]).sum(0)
            with np.errstate(all="ignore"):
                import warnings
                warnings.simplefilter("ignore", RuntimeWarning)
                spec = 10 * np.log10(np.nanmean(P[s], 0) + 1e-12)
            spec[cnt < max(3, 0.3 * s.sum())] = np.nan
            seen[b] |= np.isfinite(spec)
            base = _nanmedfilt(spec, half)
            ex = spec - base
            for i in np.flatnonzero(band_ok & np.isfinite(ex) & (ex >= prom)):
                lo_, hi_ = spec[i - 1] if i > 0 else -np.inf, spec[i + 1] if i + 1 < len(spec) else -np.inf
                if spec[i] >= np.nan_to_num(lo_, nan=-np.inf) and spec[i] >= np.nan_to_num(hi_, nan=-np.inf):
                    # parabolic refinement of the peak frequency
                    fr = f[i]
                    if np.isfinite(lo_) and np.isfinite(hi_):
                        d_ = lo_ - 2 * spec[i] + hi_
                        if d_ < 0:
                            fr = f[i] + 0.5 * (lo_ - hi_) / d_ * df
                    found.append((float(fr), float(ex[i]), ax, b))
        fw, pr = welch(raw, fs, nper)
        _, pf = welch(c[f"gyroADC[{ax}]"][sl].astype(np.float64), fs, nper)
        if fw is not None:
            filt_att[ax] = (fw, 10 * np.log10(pr + 1e-12) - 10 * np.log10(pf + 1e-12))
    nb = max(1, len(bands_used))
    # group across bands: a frame resonance sits at (almost) the same frequency in every band
    found.sort()
    clusters = []
    for fr, pr_, ax, b in found:
        tol = max(2.5 * df, 0.03 * fr)
        if clusters and fr - np.median(clusters[-1]["fs"]) <= tol:
            cl = clusters[-1]
        else:
            cl = {"fs": [], "prom": [], "axes": set(), "bands": {}}
            clusters.append(cl)
        cl["fs"].append(fr); cl["prom"].append(pr_); cl["axes"].add(ax)
        cl["bands"].setdefault(b, []).append(fr)
    out = []
    lo_d, hi_d = hnum(h, "dyn_notch_min_hz", 0)[0], hnum(h, "dyn_notch_max_hz", 0)[0]
    n_dyn = int(hnum(h, "dyn_notch_count", 0)[0])
    for cl in clusters:
        fr = float(np.median(cl["fs"]))
        bins_ = np.abs(f - fr) <= max(df, 0.01 * fr)
        bl = sorted(cl["bands"])
        # judged within the throttle span where it shows (some resonances are only excited at high or low throttle)
        observable = [b for b in bands_used if bl[0] <= b <= bl[-1] and seen[b][bins_].any()]
        if len(bl) < 4 or not observable:
            continue
        p = 100.0 * len(bl) / max(len(observable), len(bl))
        if p < persist:
            continue
        bf = np.array([np.median(cl["bands"][b]) for b in bl]); bt = np.array(bl) * 5 + 2.5
        slope = float(np.polyfit(bt, bf, 1)[0]) if len(bl) >= 3 and np.ptp(bt) > 0 else 0.0
        drift = slope * float(np.ptp(bt))                 # Hz the peak moves across the throttle range it was seen in
        if abs(drift) > max(3 * df, 0.04 * fr):
            continue                                      # follows throttle: a motor order or mix of motor speeds, not the frame
        att = []
        for ax in cl["axes"]:
            if ax in filt_att:
                fw, a = filt_att[ax]
                att.append(float(a[np.argmin(np.abs(fw - fr))]))
        out.append(dict(f=round(fr, 1), prom_db=round(float(np.median(cl["prom"])), 1), persistence=round(p), bands_seen=len(bl), bands_observable=len(observable),
                        axes=sorted(int(a) for a in cl["axes"]), thr=[bl[0] * 5, bl[-1] * 5 + 5],
                        width_hz=round(float(np.ptp(cl["fs"]) + df), 1), drift_hz=round(drift, 1),
                        filtered_att_db=round(min(att), 1) if att else None,
                        in_dyn=bool(n_dyn and lo_d <= fr <= hi_d)))
    out.sort(key=lambda r: -(r["prom_db"] * r["persistence"]))
    for k, r in enumerate(out):
        r["id"] = f"R{k + 1}"
    return {"list": out, "bands": nb, "df": round(float(df), 2), "params": dict(prom=prom, persist=persist, mask=mask, fmin=fmin, fmax=round(fmax))}


def resonance_findings(res, h):
    F = []
    names = ["roll", "pitch", "yaw"]
    n_dyn = int(hnum(h, "dyn_notch_count", 0)[0])
    lo_d, hi_d = hnum(h, "dyn_notch_min_hz", 0)[0], hnum(h, "dyn_notch_max_hz", 0)[0]
    q_dyn = hnum(h, "dyn_notch_q", 300)[0]
    L = res["list"]
    p = res.get("params", {})
    if not L:
        return [finding("good", f"No frame resonance found (searched {p.get('fmin', 40):.0f}–{p.get('fmax', 150):.0f} Hz)",
                        f"Nothing stays at a fixed frequency in ≥ {p.get('persist', 0):.0f}% of the throttle range with ≥ {p.get('prom', 0):.0f} dB prominence.",
                        "Motor noise is cut out before searching, so anything found would be structural. Use the 'sensitive' preset or a higher search limit to see weaker candidates.")]
    for r in L[:5]:
        fr, att = r["f"], r["filtered_att_db"]
        where = f"{r['thr'][0]}–{r['thr'][1]}% throttle"
        axes_txt = ", ".join(names[a] for a in r["axes"])
        what = (f"This peak stays at about {fr:.0f} Hz across {where}, while motor noise moves with RPM (every motor harmonic was cut out ±{p.get('mask', 8):.0f}% "
                "before searching). Something that doesn't follow motor speed is structural: the frame or a part on it vibrating at its own natural frequency.")
        if att is not None and att >= 20 and fr >= 100:
            F.append(finding("info", f"{r['id']}: {fr:.0f} Hz frame vibration, already filtered out (−{att:.0f} dB)",
                             f"On {axes_txt} · {where} · +{r['prom_db']:.0f} dB in the raw gyro.", what,
                             "Nothing to do for the tune. If it grows on later flights, look for whatever loosened.", ""))
            continue
        sev = "warning" if (att is not None and att < 12) or fr < 100 else "info"
        acts = []
        if fr < 100:
            acts.append("It sits close to the range the controller works in, so a notch here costs response: a mechanical fix is better")
        if n_dyn and not r["in_dyn"]:
            acts.append(f"It's outside the dynamic notch range ({lo_d:.0f}–{hi_d:.0f} Hz): to let it track this, set dyn_notch_min_hz ≤ {fr * 0.85:.0f}" if fr < lo_d
                        else f"It's outside the dynamic notch range ({lo_d:.0f}–{hi_d:.0f} Hz): set dyn_notch_max_hz ≥ {fr * 1.15:.0f}")
        elif not n_dyn:
            acts.append("The dynamic notch is off (dyn_notch_count = 0)")
        elif att is not None and att < 12:
            acts.append(f"It's in the dynamic notch range but only {att:.0f} dB is removed: the notches may be busy elsewhere (dyn_notch_count {n_dyn} → {n_dyn + 1}) or too narrow (dyn_notch_q {q_dyn:.0f} → {max(200, q_dyn * 0.7):.0f})")
        if r["persistence"] >= 80 and r["width_hz"] <= 12 and fr >= 100:
            acts.append(f"It's very stable, so a fixed notch would also work: gyro_notch1_hz = {fr:.0f}, gyro_notch1_cutoff = {fr * 0.8:.0f}")
        cause = ("arms or frame plates flexing, a loose arm screw, a soft-mounted stack, or a camera/antenna/GPS mast on a flexible mount"
                 if fr < 150 else "arms or frame flexing, cracked carbon, or the flight-controller mounting (grommets too hard or too soft)")
        F.append(finding(sev, f"{r['id']}: frame vibration at {fr:.0f} Hz (+{r['prom_db']:.0f} dB, in {r['persistence']}% of the throttle range)",
                         f"On {axes_txt} · {where}" + (f" · the filters remove {att:.0f} dB" if att is not None else ""),
                         what + f" At {fr:.0f} Hz the usual suspects are {cause}.",
                         (". ".join(acts) + ".") if acts else "",
                         "A notch adds a little delay around its frequency; a mechanical fix costs nothing."))
    return F


# ---------- PID suggestions from the step response ----------
CLI = {"P": "p_{a}", "I": "i_{a}", "D": "d_{a}", "Dmax": "d_max_{a}", "FF": "f_{a}"}


def pid_suggest(axes, h, prof, d_noisy):
    """axes: {ax: {'metrics','n'}}. One cautious step per flight, sized for the props."""
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    rl = ((prof or {}).get("params") or {}).get("rise_ok_ms", 25)
    pct = float(np.clip(0.12 * (5 / inch) ** 0.5, 0.06, 0.18))       # 5″ → 12 %, 7″ → 10 %, 3″ → 15 %
    names = ["roll", "pitch", "yaw"]
    out = {"step_pct": round(pct * 100), "axes": {}, "cli": [], "d_noisy": bool(d_noisy)}
    for ax in range(3):
        a = names[ax]
        pid = (hnum(h, f"{a}PID", 0) + [0, 0, 0])[:3]
        cur = {"P": pid[0], "I": pid[1], "D": pid[2], "Dmax": (hnum(h, "d_max", 0) * 3)[ax], "FF": (hnum(h, "ff_weight", 0) * 3)[ax]}
        r = axes.get(ax)
        if not r or "metrics" not in r:
            out["axes"][a] = {"current": cur, "suggested": cur, "why": ["not enough stick movement to judge"], "confident": False}
            continue
        m, n = r["metrics"], r["n"]
        rl_ = r.get("reliability") or {}
        if not rl_.get("ok", n >= 30):
            out["axes"][a] = {"current": cur, "suggested": cur, "why": ["no change suggested: " + "; ".join(rl_.get("why") or [f"only {n} stick moves"])], "confident": False}
            continue
        oc = rl_.get("overshoot_ci") or [m["overshoot_pct"]] * 2
        os_, rise, ss, ring = m["overshoot_pct"], m["rise_ms"] or 999, m["steady"], m["ringing"]
        yaw = ax == 2
        f = {k: 1.0 for k in cur}
        why = []
        os_lim = 20 if yaw else 12
        if oc[0] > os_lim:
            if not yaw and not d_noisy and cur["D"] > 0:
                f["D"] = f["Dmax"] = 1 + pct; why.append(f"{os_:.0f}% overshoot → more damping (D +{pct * 100:.0f}%)")
            else:
                f["P"] = 1 - pct * 0.8; why.append(f"{os_:.0f}% overshoot" + (" but D-term is already noisy" if d_noisy and not yaw else "") + f" → less P (−{pct * 80:.0f}%)")
            if oc[0] > 20 and cur["FF"] > 0:
                f["FF"] = 1 - pct * 0.8; why.append("large overshoot: feedforward often contributes → FF a little lower")
        elif oc[1] < 3 and (rl_.get("rise_ci") or [rise])[0] > (rl * 1.6 if yaw else rl):
            f["P"] = 1 + pct * 0.8; why.append(f"slow ({rise:.0f} ms rise, expected ≲{round(rl * (1.6 if yaw else 1))} ms for {inch:g}″) → more P")
            if cur["FF"] > 0:
                f["FF"] = 1 + pct; why.append("→ more FF for sharper stick response")
        if ring >= 3 and rl_.get("ring_p", 0) >= 0.8 and f["D"] == 1 and f["P"] == 1:
            if not yaw and not d_noisy and cur["D"] > 0:
                f["D"] = f["Dmax"] = 1 + pct * 0.8; why.append(f"wobbles {ring}× before settling → more D")
            else:
                f["P"] = 1 - pct * 0.6; why.append(f"wobbles {ring}× before settling → less P")
        sc = rl_.get("steady_ci") or [ss, ss]
        if sc[1] < 0.93:
            f["I"] = 1 + pct * 1.2; why.append(f"settles at {ss:.2f} (short of target) → more I")
        elif sc[0] > 1.07:
            if f["FF"] == 1 and cur["FF"] > 0:
                f["FF"] = 1 - pct * 0.8; why.append(f"settles at {ss:.2f} (past target) → less FF")
            else:
                f["I"] = 1 - pct * 0.8; why.append(f"settles at {ss:.2f} (past target) → less I")
        if not why:
            why.append("already good: keep it")
        sug = {k: (round(v * f[k]) if v else v) for k, v in cur.items()}
        conf = True
        out["axes"][a] = {"current": cur, "suggested": sug, "why": why, "confident": conf}
        for k in cur:
            if sug[k] != cur[k] and not (k == "Dmax" and cur[k] == 0):
                out["cli"].append(f"set {CLI[k].format(a=a)} = {sug[k]}")
    # simplified-tuning slider equivalent (roll-based; sliders move roll & pitch together)
    mode = int(hnum(h, "simplified_pids_mode", 0)[0])
    if mode:
        rr = out["axes"]["roll"]
        ratio = lambda k: (rr["suggested"][k] / rr["current"][k]) if rr["current"][k] else 1
        sl = []
        for key, lab, k in (("simplified_d_gain", "Damping (D)", "D"), ("simplified_pi_gain", "Tracking (P & I)", "P"), ("simplified_feedforward_gain", "Stick response (FF)", "FF")):
            cur_s = hnum(h, key, 100)[0]
            new_s = round(cur_s * ratio(k) / 5) * 5
            if new_s != cur_s:
                sl.append(dict(key=key, label=lab, current=cur_s / 100, suggested=new_s / 100))
        out["sliders"] = sl
        out["slider_mode"] = mode
    return out


# ---------- filter planner: measured spectra + what could change, for the browser's what-if tool ----------
def _peak_q(f, db, fr):
    """Quality factor of a spectral peak from its half-power (−3 dB) width in a dB spectrum."""
    i = int(np.argmin(np.abs(f - fr)))
    lo, hi = i, i
    top = db[i]
    while lo > 0 and db[lo] > top - 3 and f[i] - f[lo] < 0.5 * fr:
        lo -= 1
    while hi < len(db) - 1 and db[hi] > top - 3 and f[hi] - f[i] < 0.5 * fr:
        hi += 1
    bw = max(f[hi] - f[lo], 2 * (f[1] - f[0]))
    return float(np.clip(fr / bw, 1.5, 12.0)), float(bw)


def notch_cutoff(fc, q):
    """Betaflight notch cutoff for a wanted Q (inverse of filterGetNotchQ)."""
    return fc * (np.sqrt(1 + 4 * q * q) - 1) / (2 * q)


def filter_plan(lg, t0=None, t1=None, prof=None, res_kw=None):
    from sim import filters as sim_filters
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    thr = c["throttle%"][sl]
    air = thr > 5
    if air.sum() < fs * 3:
        return {"error": "Select at least 3 s of flight."}
    nper = int(2 ** int(round(np.log2(fs / 2))))
    out = {"fs_log": round(fs), "nper": nper}
    fs_gyro = 1e6 / max(hnum(h, "looptime", 125)[0], 1)
    fs_pid = fs_gyro / max(hnum(h, "pid_process_denom", 1)[0], 1)
    out.update(fs_gyro=round(fs_gyro), fs_pid=round(fs_pid))
    ax_out = {}
    f = None
    for ax in range(3):
        f, pr = welch(c[f"gyroUnfilt[{ax}]"][sl], fs, nper)
        if f is None:
            return {"error": "Window too short."}
        _, pf = welch(c[f"gyroADC[{ax}]"][sl], fs, nper)
        a = dict(raw=(10 * np.log10(pr + 1e-12)).round(2).tolist(), filt=(10 * np.log10(pf + 1e-12)).round(2).tolist())
        for t in "PD":
            k = f"axis{t}[{ax}]"
            if k in c:
                _, pt = welch(c[k][sl], fs, nper)
                a[t] = (10 * np.log10(pt + 1e-12)).round(2).tolist()
        ax_out[str(ax)] = a
    out["f"] = f.round(2).tolist()
    out["axes"] = ax_out
    thr_mean = float(np.mean(thr[air]) / 100)
    motors = [c[f"motorHz[{i}]"][sl] for i in range(8) if f"motorHz[{i}]" in c]
    mhz = float(np.median(np.mean(motors, 0)[air])) if motors else None
    g, d = sim_filters(h, thr_mean, None)            # low-pass stages only (RPM / dynamic notches stay as they are)
    statics = []
    for k, (cc, co) in enumerate(zip(hnum(h, "gyro_notch_hz"), hnum(h, "gyro_notch_cutoff"))):
        if cc > 0 and 0 < co < cc:
            statics.append(dict(k="bq", type="notch", fc=cc, q=float(notch_q(cc, co)), w=1.0, label=f"Gyro notch {k + 1}", slot=k + 1))
    out["stages"] = dict(gyro=[s_ for s_ in g if s_["k"] != "bq" or s_["type"] == "lpf"], dterm=d, gyro_notch=statics)
    out["thr_pct"] = round(thr_mean * 100)
    out["motor_hz"] = None if mhz is None else round(mhz, 1)
    out["budget"] = noise_budget(lg, sl)
    out["settings"] = {k: h.get(k) for k in ("simplified_gyro_filter", "simplified_gyro_filter_multiplier", "simplified_dterm_filter", "simplified_dterm_filter_multiplier",
                                           "gyro_lpf1_type", "gyro_lpf1_static_hz", "gyro_lpf1_dyn_hz", "gyro_lpf2_type", "gyro_lpf2_static_hz",
                                           "dterm_lpf1_type", "dterm_lpf1_static_hz", "dterm_lpf1_dyn_hz", "dterm_lpf2_type", "dterm_lpf2_static_hz",
                                           "gyro_notch_hz", "gyro_notch_cutoff", "dyn_notch_count", "dyn_notch_q", "dyn_notch_min_hz", "dyn_notch_max_hz",
                                           "rpm_filter_harmonics", "rpm_filter_q", "rpm_filter_min_hz", "rpm_filter_fade_range_hz", "rpm_filter_weights")}
    def span_db(axis, thr_rng):
        """Raw spectrum averaged only over the throttle span where a resonance shows (it's diluted elsewhere)."""
        x = c[f"gyroUnfilt[{axis}]"][sl].astype(float)
        ix = np.arange(0, len(x) - nper + 1, nper // 4)
        tm = np.array([thr[i:i + nper].mean() for i in ix])
        ix = ix[(tm >= thr_rng[0]) & (tm <= thr_rng[1])]
        if len(ix) < 3:
            return np.array(ax_out[str(axis)]["raw"])
        w = np.hanning(nper); X = x[ix[:, None] + np.arange(nper)]
        P = (np.abs(np.fft.rfft((X - X.mean(1, keepdims=True)) * w, axis=1)) ** 2).mean(0)
        return 10 * np.log10(P + 1e-12)
    # existing static notches: is anything there in the raw gyro?
    for st_ in statics:
        best = -99.0
        for ax in range(3):
            db = np.array(ax_out[str(ax)]["raw"])
            base = _nanmedfilt(db, max(2, int(round(25 / (f[1] - f[0])))))
            sel = np.abs(f - st_["fc"]) <= max(3 * (f[1] - f[0]), 0.05 * st_["fc"])
            best = max(best, float(np.max(db[sel] - base[sel])))
        st_["raw_excess_db"] = round(best, 1)
        st_["useful"] = bool(best >= 4 or any(abs(r["f"] - st_["fc"]) <= max(5, 0.08 * st_["fc"]) for r in resonances(lg, t0, t1, **(res_kw or {}))["list"]))
    # notch proposals: resonances the filters don't already handle
    res = resonances(lg, t0, t1, **(res_kw or {}))
    props, used = [], {s_["slot"] for s_ in statics}
    free = [k for k in (1, 2) if k not in used]
    taken = set()
    for r in res["list"]:
        att = r["filtered_att_db"]
        if att is not None and att >= 15:
            continue
        axis = max(r["axes"], key=lambda a: np.interp(r["f"], f, np.array(ax_out[str(a)]["raw"])))
        q, bw = _peak_q(f, span_db(axis, r["thr"]), r["f"])
        q = float(np.clip(q * 0.8, 1.5, 8.0))                      # a little wider than the peak itself: covers drift between flights
        why = [f"{r['id']} at {r['f']:.0f} Hz stands +{r['prom_db']:.0f} dB on {', '.join(AXN_L[a] for a in r['axes'])}, the filters remove only {att:.0f} dB there" if att is not None else f"{r['id']} at {r['f']:.0f} Hz"]
        why.append(f"measured peak width ≈ {bw:.0f} Hz → Q ≈ {q:.1f}")
        warn = None
        if r["f"] < 80:
            warn = "This is close to the frequencies the controller works with: a notch here costs noticeable response. Fix it mechanically if you can (see the finding)."
        replaces = None
        if not free:   # both slots taken: offer the one that isn't catching anything
            idle = [st_ for st_ in statics if not st_["useful"] and st_["slot"] not in taken]
            if idle:
                free.append(idle[0]["slot"]); replaces = idle[0]["fc"]; taken.add(idle[0]["slot"])
        slot = free.pop(0) if free else None
        co = notch_cutoff(r["f"], q)
        props.append(dict(kind="notch", id=r["id"], fc=round(r["f"], 1), q=round(q, 2), cutoff=round(float(co)), slot=slot, replaces=replaces, why=why, warn=warn,
                          cli=None if slot is None else f"set gyro_notch{slot}_hz = {round(r['f'])}\nset gyro_notch{slot}_cutoff = {round(float(co))}"))
    out["resonances"] = res["list"]
    out["notches"] = props
    # RPM fade fix (same logic as the noise finding)
    if motors and hnum(h, "rpm_filter_harmonics")[0] and hnum(h, "dshot_bidir")[0]:
        mn, frng = hnum(h, "rpm_filter_min_hz", 100)[0], hnum(h, "rpm_filter_fade_range_hz", 50)[0]
        _, eff = rpm_notch(h, mhz, 1.0)
        if eff < 0.85:
            f_full = 0.8 * mhz
            new_min = max(40.0, f_full - frng); new_fade = max(0.0, f_full - new_min)
            out["rpm_fix"] = dict(eff=round(eff, 2), typ_hz=round(mhz), min_hz=mn, fade=frng,
                                  cli=f"set rpm_filter_min_hz = {int(5 * round(new_min / 5))}" + (f"\nset rpm_filter_fade_range_hz = {int(5 * round(new_fade / 5))}" if abs(new_fade - frng) > 4 else ""))
    return out


AXN_L = ["roll", "pitch", "yaw"]
