"""Closed-loop model of the quad for the PID tuning simulator.

Plant (per axis), identified from the log:
    rate ω [°/s]:  dω/dt = b·(m + λ·(u_d − m)) − a·ω   (b: control authority, a: aerodynamic rate damping,
                                                        λ: yaw only, reaction torque of the props spinning up)
    motor/prop:    τ·dm/dt = u_d − m,  u_d = u(t − d)    (τ: motor + prop spin-up lag, d: ESC / signal delay)
    u = P + I + D + F  (Betaflight PID sum, the units the blackbox logs)
Controller: Betaflight PID in its own units (P = 0.032029·Kp·e, I += 0.244381·Ki·e·dt, D = −0.000529·Kd·dg/dt,
F = 0.013754·Kf/100·dsp/dt), D-max boost, I-term relax, pidsum limit, and the real gyro / D-term filter chains
(dynamic LPFs at the flight's throttle, static LPFs, RPM notches).

What is measured directly, not fitted:
  • motor lag τ and delay d: from the motor command vs. the eRPM telemetry (bidirectional DShot), as a frequency
    response on the band where the two are coherent. τ scales with 1 / rotor speed (drag-limited props), so each
    flight segment uses τ at its own motor speed.
  • the P and D multipliers the flight controller really applied (TPA, yaw P attenuation, anti-gravity, …): the logged
    P and D terms regressed on what the header gains alone give for the logged gyro.
What is fitted: b, a, λ and a ±30 % correction of τ, by closed-loop output error. The logged setpoint and the logged
feedforward drive the modelled controller (P, I, D computed in the loop from the simulated gyro) and the candidate
plant; the parameters are chosen so the simulated filtered gyro matches the logged one below FIT_HZ, where the
control dynamics live (above that is sensor / frame noise no model of the sticks can predict). Only stretches with
real stick movement are used; an axis the pilot hardly moved can't be identified and is reported as such (or taken
from another flight of the same craft with the same motor dynamics, and labelled so).
"""
import numpy as np
from tuning import hnum, dyn_cutoff, rpm_notch

PT_CORR = {1: 1.0, 2: 1.553773974, 3: 1.961459177}
KP, KI, KD, KF = 0.032029, 0.244381, 0.000529, 0.013754
AXN = ["roll", "pitch", "yaw"]


# ---------------------------------------------------------------- configuration from headers
def pids(h):
    sp = lambda k: [float(x) for x in str(h.get(k, "0,0,0")).split(",")]
    P = [sp(f"{a}PID") for a in AXN]
    dmax = (sp("d_max") + [0, 0, 0])[:3]
    ff = (sp("ff_weight") + [0, 0, 0])[:3]
    return {a: dict(P=P[i][0], I=P[i][1], D=P[i][2], Dmax=max(dmax[i], P[i][2]), FF=ff[i]) for i, a in enumerate(AXN)}


def filters(h, thr, motor_hz=None):
    """Gyro and D-term filter chains as stage lists [{k: 'pt', order, fc} | {k: 'bq', type: 'lpf'|'notch', fc, q, w}]."""
    g, d = [], []
    t1 = int(hnum(h, "gyro_lpf1_type")[0]); lo, hi = (hnum(h, "gyro_lpf1_dyn_hz", 0) + [0])[:2]
    fc = dyn_cutoff(thr, lo, hi, hnum(h, "gyro_lpf1_dyn_expo", 5)[0]) if lo > 0 else hnum(h, "gyro_lpf1_static_hz")[0]
    if fc > 0: g.append(_lpf(t1, fc, "Gyro LPF1" + (" (dyn)" if lo > 0 else "")))
    fc = hnum(h, "gyro_lpf2_static_hz")[0]
    if fc > 0: g.append(_lpf(int(hnum(h, "gyro_lpf2_type")[0]), fc, "Gyro LPF2"))
    nh = int(hnum(h, "rpm_filter_harmonics")[0])
    if nh and motor_hz and hnum(h, "dshot_bidir")[0]:
        q = hnum(h, "rpm_filter_q", 500)[0] / 100
        w = (hnum(h, "rpm_filter_weights", 100) * 3)[:nh]
        for k in range(1, nh + 1):
            fk, wk = rpm_notch(h, motor_hz * k, w[k - 1] / 100)
            if wk > 0:
                g.append(dict(k="bq", type="notch", fc=round(fk, 1), q=q, w=round(wk, 3), label=f"RPM notch ×{k}"))
    t = int(hnum(h, "dterm_lpf1_type")[0]); lo, hi = (hnum(h, "dterm_lpf1_dyn_hz", 0) + [0])[:2]
    fc = dyn_cutoff(thr, lo, hi, hnum(h, "dterm_lpf1_dyn_expo", 5)[0]) if lo > 0 else hnum(h, "dterm_lpf1_static_hz")[0]
    if fc > 0: d.append(_lpf(t, fc, "D-term LPF1" + (" (dyn)" if lo > 0 else "")))
    fc = hnum(h, "dterm_lpf2_static_hz")[0]
    if fc > 0: d.append(_lpf(int(hnum(h, "dterm_lpf2_type")[0]), fc, "D-term LPF2"))
    return g, d


def _lpf(t, fc, label):
    if t == 1:
        return dict(k="bq", type="lpf", fc=round(float(fc), 1), q=1 / np.sqrt(2), w=1.0, label=label + " biquad")
    order = {0: 1, 2: 2, 3: 3}.get(t, 1)
    return dict(k="pt", order=order, fc=round(float(fc), 1), label=label + f" PT{order}")


def controller(h, thr):
    """Everything besides gains and filters that shapes the PID output."""
    bp = hnum(h, "tpa_breakpoint", 1350)[0]; rate = hnum(h, "tpa_rate", 65)[0] / 100
    thr_us = 1000 + 10 * thr * 100
    tpa = 1 - rate * max(0.0, thr_us - bp) / max(1.0, 2000 - bp) if thr_us > bp else 1.0
    mode = int(hnum(h, "tpa_mode", 0)[0])  # 0 = PD, 1 = D only
    fs_gyro = 1e6 / max(hnum(h, "looptime", 125)[0], 1)
    fs_pid = fs_gyro / max(hnum(h, "pid_process_denom", 1)[0], 1)
    return dict(tpa_p=tpa if mode == 0 else 1.0, tpa_d=tpa, relax=int(hnum(h, "iterm_relax", 1)[0]), relax_type=int(hnum(h, "iterm_relax_type", 0)[0]),
                relax_hz=hnum(h, "iterm_relax_cutoff", 15)[0], dmax_gain=hnum(h, "d_max_gain", 37)[0], dmax_adv=hnum(h, "d_max_advance", 0)[0],
                limit=[hnum(h, "pidsum_limit", 500)[0]] * 2 + [hnum(h, "pidsum_limit_yaw", 400)[0]], yaw_lp=hnum(h, "yaw_lowpass_hz", 100)[0],
                fs_pid=round(fs_pid), ff_boost=hnum(h, "feedforward_boost", 15)[0],
                rc_hz=_rc_sp_hz(h), iterm_limit=hnum(h, "iterm_limit", 400)[0])


def _rc_sp_hz(h):
    """Setpoint RC-smoothing cutoff actually used. Older firmware logs three cutoffs (feedforward, setpoint, throttle),
    BF 4.5+ / 2025 logs two (setpoint, throttle)."""
    v = [x for x in hnum(h, "rc_smoothing_active_cutoffs_ff_sp_thr", 0) if x > 0]
    return float(v[1] if len(v) >= 3 else v[0]) if v else 40.0


# ---------------------------------------------------------------- vectorised filter bank
class Stage:
    def __init__(self, st, fs, L, x0):
        self.st = st
        x0 = np.broadcast_to(np.asarray(x0, float), (L,)).copy()
        if st["k"] == "pt":
            om = 2 * np.pi * np.asarray(st["fc"]) * PT_CORR[st["order"]] / fs
            self.kk = om / (om + 1)
            self.s = [np.array(x0, float) for _ in range(st["order"])]
        else:
            fc = np.asarray(st["fc"], float)
            w0 = 2 * np.pi * np.clip(fc, 1, fs * 0.45) / fs
            al = np.sin(w0) / (2 * st["q"]); cs = np.cos(w0)
            if st["type"] == "lpf":
                b = [(1 - cs) / 2, 1 - cs, (1 - cs) / 2]
            else:
                b = [np.ones_like(cs), -2 * cs, np.ones_like(cs)]
            a0 = 1 + al
            self.b = [x / a0 for x in b]; self.a = [-2 * cs / a0, (1 - al) / a0]
            self.w = st.get("w", 1.0); self.off = (fc >= fs * 0.45)
            x0 = np.array(x0, float)
            self.x1 = x0.copy(); self.x2 = x0.copy(); self.y1 = x0.copy(); self.y2 = x0.copy()

    def __call__(self, x):
        if self.st["k"] == "pt":
            for s in self.s:
                s += self.kk * (x - s); x = s
            return x.copy()
        y = self.b[0] * x + self.b[1] * self.x1 + self.b[2] * self.x2 - self.a[0] * self.y1 - self.a[1] * self.y2
        self.x2, self.x1, self.y2, self.y1 = self.x1, x, self.y1, y
        out = x + self.w * (y - x) if self.st["type"] == "notch" else y
        return np.where(self.off, x, out)


def _pt(x, fc, fs, order=1):
    om = 2 * np.pi * fc * PT_CORR[order] / fs; k = om / (om + 1); y = np.asarray(x, float)
    for _ in range(order):
        o = np.empty_like(y); s = y[0]
        for i, v in enumerate(y):
            s += k * (v - s); o[i] = s
        y = o
    return y


# ---------------------------------------------------------------- direct measurements
def motor_dynamics(lg, air=None):
    """Motor + prop response, command → measured rotor speed (eRPM), fitted as G·e^(−s·d)/(τs + 1) on the band where
    command and speed are coherent. Returns None without eRPM telemetry or with too little flight."""
    c, fs = lg.cols, lg.fs
    if "motorHz[0]" not in c:
        return None
    air = c["throttle%"] > 10 if air is None else air
    nper = int(2 ** round(np.log2(fs * 2)))
    f = np.fft.rfftfreq(nper, 1 / fs); w = np.hanning(nper)
    Sxy = Sxx = Syy = 0.0; nseg = 0; hz = []
    for i in range(8):
        if f"motorHz[{i}]" not in c or f"motor%[{i}]" not in c:
            continue
        x = c[f"motor%[{i}]"].astype(float) / 100; y = c[f"motorHz[{i}]"].astype(float)
        st = np.arange(0, len(x) - nper, nper // 2)
        st = st[air[st] & air[np.minimum(st + nper - 1, len(x) - 1)]]
        if len(st) < 4:
            continue
        ix = st[:, None] + np.arange(nper)
        X = np.fft.rfft((x[ix] - x[ix].mean(1, keepdims=True)) * w, axis=1)
        Y = np.fft.rfft((y[ix] - y[ix].mean(1, keepdims=True)) * w, axis=1)
        Sxy = Sxy + (X.conj() * Y).sum(0); Sxx = Sxx + (abs(X) ** 2).sum(0); Syy = Syy + (abs(Y) ** 2).sum(0); nseg += len(st)
        hz.append(float(np.median(y[air])))
    if nseg == 0:
        return None
    H = Sxy / (Sxx + 1e-30); coh = abs(Sxy) ** 2 / (Sxx * Syy + 1e-30)
    band = (f >= 1.5) & (f <= 40) & (coh > 0.5)
    if band.sum() < 8:
        band = (f >= 1.5) & (f <= 25) & (coh > 0.3)
    if band.sum() < 5:
        return None
    fb, Hb, wt = f[band], H[band], coh[band] / (1 - coh[band] + 0.05)
    taus = np.exp(np.linspace(np.log(0.003), np.log(0.15), 70)); ds = np.arange(0, 0.012, 0.0005)
    T, D = np.meshgrid(taus, ds, indexing="ij")
    M = np.exp(-2j * np.pi * fb[None, None] * D[..., None]) / (1 + 2j * np.pi * fb[None, None] * T[..., None])
    G = np.real((wt * np.conj(M) * Hb).sum(-1)) / (wt * abs(M) ** 2).sum(-1)
    E = (wt * abs(Hb - G[..., None] * M) ** 2).sum(-1) / (wt * abs(Hb) ** 2).sum()
    i, j = np.unravel_index(np.argmin(E), E.shape)
    return dict(tau=float(taus[i]), d=float(ds[j]), G=float(G[i, j]), err=float(E[i, j]), coh=float(np.median(coh[band])),
                hz=float(np.mean(hz)), band_hz=[round(float(fb.min()), 1), round(float(fb.max()), 1)])


def _run_stages(x, stages):
    y = np.empty(len(x))
    for k in range(len(x)):
        v = np.array([x[k]])
        for q in stages:
            v = q(v)
        y[k] = v[0]
    return y


def gain_factors(lg, ax, seg, W, h, g):
    """P and D multipliers the flight controller really applied (TPA, yaw P attenuation, anti-gravity, …), per segment:
    the logged P / D terms regressed on what the header gains give for the logged filtered gyro (D incl. D-max boost)."""
    c, fs = lg.cols, lg.fs
    ctl = controller(h, 0.3)
    kp0, kd0, kdm0 = KP * g["P"], KD * g["D"], KD * g["Dmax"]
    dgain = 0.00008 * ctl["dmax_gain"] / 35; sgain = 0.00008 * ctl["dmax_gain"] * ctl["dmax_adv"] / 100 / 35
    out_p, out_d = [], []
    for s in seg:
        sl = slice(s, s + W)
        sp = c[f"setpoint[{ax}]"][sl].astype(float); gy = c[f"gyroADC[{ax}]"][sl].astype(float)
        e = sp - gy
        if ax == 2 and ctl["yaw_lp"] > 0:
            e = _pt(e, ctl["yaw_lp"], fs)
        Pl = c[f"axisP[{ax}]"][sl].astype(float)
        den = kp0 * np.dot(e, e)
        out_p.append(float(np.clip(np.dot(Pl, e) / den, 0.2, 1.8)) if den > 0 else 1.0)
        if f"axisD[{ax}]" in c and g["D"] > 0:
            s0 = max(0, s - int(0.1 * fs))
            _, dch = filters(h, float(c["throttle%"][sl].mean()) / 100, None)
            x = c[f"gyroADC[{ax}]"][s0:s + W].astype(float)
            y = _run_stages(x, [Stage(q, fs, 1, x[0]) for q in dch])
            dg = np.gradient(y) * fs
            spx = c[f"setpoint[{ax}]"][s0:s + W].astype(float)
            sf = np.abs(np.gradient(spx) * fs) * sgain
            b1 = np.abs(_pt(dg, 85, fs, 2)) * dgain
            boost = np.minimum(1.0, _pt(np.maximum(b1, sf), 35, fs, 2))
            rep = (kd0 + (kdm0 - kd0) * boost) * dg
            rep, Dl = rep[-W:], -c[f"axisD[{ax}]"][sl].astype(float)
            den = np.dot(rep, rep)
            out_d.append(float(np.clip(np.dot(Dl, rep) / den, 0.2, 2.5)) if den > 0 else 1.0)
        else:
            out_d.append(1.0)
    return np.array(out_p), np.array(out_d)


# ---------------------------------------------------------------- segments
MIN_EXC = 6.0    # °/s: a segment must carry at least this much stick movement (std of setpoint) to teach the model anything
FIT_HZ = 30.0    # fits are judged below this (zero-phase 2nd-order Butterworth, the browser uses the same filter)


def _segments(lg, ax, n=24, win=1.5, min_std=MIN_EXC):
    c, fs = lg.cols, lg.fs
    thr = c["throttle%"]
    M = np.array([c[k] for k in (f"motor%[{i}]" for i in range(8)) if k in c])
    ok = (thr > 12) & (M.max(0) < 97) & (M.min(0) > 1)
    sp = c[f"setpoint[{ax}]"].astype(float)
    W = int(win * fs)
    pre = int(0.3 * fs)
    starts = np.arange(pre, len(sp) - W, W // 2)
    exc = lambda s: float(np.std(sp[s:s + W]))
    score = np.array([exc(s) + 0.02 * np.abs(np.diff(sp[s:s + W])).sum() / win if ok[s - pre:s + W].all() and exc(s) >= min_std else -1 for s in starts])
    order = np.argsort(-score)
    pick = []
    for i in order:
        if score[i] <= 0 or len(pick) >= n:
            break
        if all(abs(starts[i] - p) >= W for p in pick):
            pick.append(int(starts[i]))
    return sorted(pick), W


def lp_zero(x, fs, fc=FIT_HZ):
    """Zero-phase low-pass of each row: 2nd-order Butterworth (bilinear) forward and backward, ends padded by
    reflection. Identical to lpZero() in static/pidsim.js."""
    x = np.atleast_2d(np.asarray(x, float)); n = x.shape[1]; pad = min(n - 1, int(0.1 * fs))
    xe = np.concatenate([2 * x[:, :1] - x[:, pad:0:-1], x, 2 * x[:, -1:] - x[:, -2:-pad - 2:-1]], 1)
    K = np.tan(np.pi * min(fc, 0.45 * fs) / fs); q = np.sqrt(2); nrm = 1 / (1 + K * q + K * K)
    b0 = K * K * nrm; b1 = 2 * b0; b2 = b0; a1 = 2 * (K * K - 1) * nrm; a2 = (1 - K * q + K * K) * nrm

    def run(z):
        y = np.empty_like(z); x1 = x2 = z[:, 0].copy(); y1 = y2 = z[:, 0].copy()
        for k in range(z.shape[1]):
            v = z[:, k]; o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
            x2, x1, y2, y1 = x1, v, y1, o; y[:, k] = o
        return y
    y = run(run(xe)[:, ::-1])[:, ::-1]
    return y[:, pad:pad + n]


# ---------------------------------------------------------------- closed loop (mirror of static/pidsim.js simAxis)
def closed_loop(lg, ax, seg, W, h, g, prm, kfac=None, tscale=None, state=False):
    """Simulate len(prm['b']) × len(seg) lanes over the logged setpoint + logged feedforward; P, I, D computed in the
    loop from the simulated gyro. prm: arrays b, a, tau (s), d (samples), lam. kfac: (P mult[S], D mult[S]).
    tscale[S]: per-segment motor-lag multiplier from rotor speed. Returns sim filtered gyro (L×W), real (S×W), lane→seg."""
    c, fs = lg.cols, lg.fs
    S = len(seg); P = len(prm["b"]); L = P * S
    si = np.tile(np.arange(S), P); sg = np.array(seg)
    b = np.repeat(prm["b"], S); a = np.repeat(prm["a"], S); lam = np.repeat(prm.get("lam", np.zeros(P)), S)
    tau = np.repeat(prm["tau"], S) * (tscale[si] if tscale is not None else 1.0)
    dl = np.repeat(prm["d"], S).astype(int)
    idx = sg[:, None] + np.arange(W)
    sp = c[f"setpoint[{ax}]"].astype(float)[idx][si]
    gy_real = c[f"gyroADC[{ax}]"].astype(float)[idx]
    thr = c["throttle%"][idx].mean(1) / 100
    u_real = sum(c[f"axis{k}[{ax}]"].astype(float) for k in "PIDF" if f"axis{k}[{ax}]" in c)
    F_log = (c[f"axisF[{ax}]"].astype(float)[idx] if f"axisF[{ax}]" in c else np.zeros_like(gy_real))[si]
    I0 = c[f"axisI[{ax}]"].astype(float)[sg][si]
    motor = [c[f"motorHz[{i}]"] for i in range(8) if f"motorHz[{i}]" in c]
    mhz = np.array([np.mean([m[s:s + W].mean() for m in motor]) for s in seg]) if motor else None
    gch = [filters(h, float(thr[k]), float(mhz[k]) if mhz is not None else None) for k in range(S)]
    # start state: the smoothed rate at the segment start (one raw sample carries tens of °/s of noise)
    graw = c[f"gyroUnfilt[{ax}]" if f"gyroUnfilt[{ax}]" in c else f"gyroADC[{ax}]"].astype(float)
    hw = max(1, int(0.004 * fs))
    x0 = np.array([graw[max(0, s0 - hw):s0 + hw + 1].mean() for s0 in seg])[si]

    def bank(j):
        n = min(len(gch[k][j]) for k in range(S))
        out = []
        for q in range(n):
            st = dict(gch[0][j][q]); st["fc"] = np.array([gch[k][j][q]["fc"] for k in range(S)])[si]
            out.append(Stage(st, fs, L, x0))
        return out
    G, Dch = bank(0), bank(1)
    ctl = controller(h, float(np.mean(thr)))
    kpm, kdm_ = kfac if kfac is not None else (np.ones(S), np.ones(S))
    kp = KP * g["P"] * kpm[si]; kd = KD * g["D"] * kdm_[si]; kdmax = KD * g["Dmax"] * kdm_[si]
    ki = KI * g["I"]
    lim = ctl["limit"][ax]; ilim = ctl.get("iterm_limit", 400)
    p0 = c[f"axisP[{ax}]"].astype(float)[sg][si]
    ylp = Stage(dict(k="pt", order=1, fc=ctl["yaw_lp"]), fs, L, p0) if ax == 2 and ctl["yaw_lp"] > 0 else None
    om = 2 * np.pi * ctl["relax_hz"] / fs; relk = om / (om + 1)
    # motor lag pre-roll over the logged PID sum, then the trim (PID output that only balances a constant torque: CG,
    # motor tilt, wind) chosen so the model starts with the angular acceleration the quad really had
    H = int(max(dl.max(), 0)) + 2; pre = int(0.25 * fs)
    kt = 1 - np.exp(-1 / (tau * fs))
    hist = np.stack([u_real[sg - j] for j in range(pre + H, 0, -1)], 1)[si]
    m = hist[:, 0].copy(); nav = max(2, int(0.03 * fs)); drv = np.zeros(L); ln = np.arange(L)
    for k in range(pre):
        ud = hist[ln, np.maximum(0, k + H - dl)]
        m += kt * (ud - m)
        if k >= pre - nav:
            drv += (m + lam * (ud - m)) / nav
    gs = graw[sg[:, None] + np.arange(-2 * nav, 1)]
    tt = np.arange(gs.shape[1]) / fs; tt = tt - tt.mean()
    alpha0 = ((gs - gs.mean(1, keepdims=True)) * tt).sum(1) / (tt ** 2).sum()
    trim = drv - (alpha0[si] + a * x0) / np.maximum(b, 1e-6)
    m = m - trim; m0 = m.copy()
    buf = np.concatenate([hist[:, pre:], np.zeros((L, W))], 1)
    w = x0.copy(); I = I0.copy(); rl = sp[:, 0].copy(); dprev = None; spprev = sp[:, 0].copy()
    bst1 = Stage(dict(k="pt", order=2, fc=85), fs, L, 0.0); bst2 = Stage(dict(k="pt", order=2, fc=35), fs, L, 0.0)
    dgain = 0.00008 * ctl["dmax_gain"] / 35; sgain = 0.00008 * ctl["dmax_gain"] * ctl["dmax_adv"] / 100 / 35
    out = np.empty((L, W)); relax = ctl["relax"] >= 1 and ax < 2
    for k in range(W):
        gf = w
        for st in G: gf = st(gf)
        df = gf
        for st in Dch: df = st(df)
        if dprev is None: dprev = df
        dgd = (df - dprev) * fs; dprev = df
        e = sp[:, k] - gf
        pterm = kp * e
        if ylp is not None: pterm = ylp(pterm)
        rl += relk * (sp[:, k] - rl)
        if relax:
            hp = np.abs(sp[:, k] - rl)
            if ctl["relax_type"] == 0:
                xx = rl - gf; eI = np.where(np.abs(xx) < hp, 0.0, xx - np.sign(xx) * hp)
            else:
                eI = e * np.maximum(0, 1 - hp / 40)
        else:
            eI = e
        I = np.clip(I + ki * eI / fs, -ilim, ilim)
        sfac = np.abs((sp[:, k] - spprev) * fs) * sgain; spprev = sp[:, k]
        boost = np.minimum(1.0, bst2(np.maximum(np.abs(bst1(dgd)) * dgain, sfac)))
        u = np.clip(pterm + I - (kd + (kdmax - kd) * boost) * dgd + F_log[:, k], -lim, lim)
        buf[:, H + k] = u
        ud = buf[ln, H + k - dl] - trim
        m += kt * (ud - m)
        w = w + (b * (m + lam * (ud - m)) - a * w) / fs
        out[:, k] = gf
    if state:
        return out, gy_real, si, dict(trim=trim, m0=m0, uhist=hist[:, pre:], x0=x0)
    return out, gy_real, si


def _score(sim, real, si, P, S, fs):
    k0 = int(0.05 * fs)
    real = lp_zero(real, fs)
    sim = lp_zero(np.clip(np.where(np.isfinite(sim), sim, 1e6), -1e6, 1e6), fs)
    err = ((sim[:, k0:] - real[si][:, k0:]) ** 2).mean(1).reshape(P, S)
    var = ((real[:, k0:] - real[:, k0:].mean(1, keepdims=True)) ** 2).mean(1)
    err[~np.isfinite(err) | (err > 1e9)] = 1e9
    return err, var


import os as _os
FRF_W = float(_os.environ.get("BBX_FRF_W", 1.0))
XD_MS = [float(x) for x in _os.environ.get("BBX_XD", "0").split(",")]   # extra delay beyond the eRPM-measured one (ms) searched   # weight of the frequency-response term in the fit cost
FRF_BAND = (3.0, 30.0)   # Hz: closed-loop response (setpoint → gyro) compared here, where the loop's crossover lives


def frf(lg, ax, seg, W, ys):
    """Closed-loop frequency response setpoint → y, pooled over segments (Hann window per segment). ys: (L × W) with
    lanes ordered parameter-major like closed_loop(); returns f, H (P × F), and for the logged gyro H_real, coherence."""
    c, fs = lg.cols, lg.fs
    S = len(seg); idx = np.array(seg)[:, None] + np.arange(W)
    w = np.hanning(W); f = np.fft.rfftfreq(W, 1 / fs)
    sp = c[f"setpoint[{ax}]"].astype(float)[idx]
    X = np.fft.rfft((sp - sp.mean(1, keepdims=True)) * w, axis=1)
    Y = np.fft.rfft((ys - ys.mean(1, keepdims=True)) * w, axis=1)
    P = ys.shape[0] // S
    Sxy = (X.conj()[None] * Y.reshape(P, S, -1)).sum(1); Sxx = (abs(X) ** 2).sum(0)
    return f, Sxy / (Sxx + 1e-12), Sxx, X


def _search(lg, ax, seg, W, h, g, prm, kfac, tsc, max_lanes=3000):
    P, S = len(prm["b"]), len(seg)
    step = max(1, max_lanes // S)
    errs, Hss = [], []
    for i0 in range(0, P, step):   # chunks of candidates: bounded memory
        sub = {k: v[i0:i0 + step] for k, v in prm.items()}
        sim, real, si = closed_loop(lg, ax, seg, W, h, g, sub, kfac, tsc)
        e_, var = _score(sim, real, si, len(sub["b"]), S, lg.fs)
        # frequency-domain term: the sticks are the only input both share, so the cross-spectrum with the setpoint
        # averages out turbulence and propwash and isolates the loop's own response, phase included
        f, Hs_, Sxx, X = frf(lg, ax, seg, W, np.where(np.isfinite(sim), np.clip(sim, -1e5, 1e5), 0))
        errs.append(e_); Hss.append(Hs_)
        del sim
    err, Hs = np.concatenate(errs), np.concatenate(Hss)
    jt = np.median(err / var[None], 1)
    Rf = np.fft.rfft((real - real.mean(1, keepdims=True)) * np.hanning(W), axis=1)
    Sxy = (X.conj() * Rf).sum(0); Hr = Sxy / (Sxx + 1e-12); coh = abs(Sxy) ** 2 / (Sxx * (abs(Rf) ** 2).sum(0) + 1e-12)
    band = (f >= FRF_BAND[0]) & (f <= FRF_BAND[1])
    wt = np.where(band, coh / (1 - coh + 0.1), 0.0)
    jf = (wt * abs(Hs - Hr) ** 2).sum(1) / max((wt * abs(Hr) ** 2).sum(), 1e-12) if wt.sum() > 0 else np.zeros(P)
    cost = jt + FRF_W * jf
    cost[~np.isfinite(cost)] = 1e9
    j = int(np.argmin(cost))
    fit = 100 * (1 - np.sqrt(np.clip(err[j] / var, 0, 4)))
    return dict(b=float(prm["b"][j]), tau=float(prm["tau"][j]), d=int(prm["d"][j]), a=float(prm["a"][j]), lam=float(prm["lam"][j]),
                cost=float(cost[j]), fit_pct=round(float(np.median(fit)), 1), fit_seg=[round(float(x), 1) for x in fit],
                frf_pct=round(float(100 * (1 - np.sqrt(min(4.0, jf[j])))), 1) if wt.sum() > 0 else None,
                frf=dict(f=f[band].round(2).tolist(), real=[Hr[band].real.round(3).tolist(), Hr[band].imag.round(3).tolist()],
                         sim=[Hs[j][band].real.round(3).tolist(), Hs[j][band].imag.round(3).tolist()], coh=coh[band].round(2).tolist()))


def step_like_for_like(lg, ax, r, n=30, win=2.0, ms=300):
    """Model validation in step-response space: the logged setpoint (and logged FF) drives the model over stick-active
    2 s windows, and the same Wiener deconvolution the Step tab uses is applied to the real and the simulated gyro.
    Differences are then due to the model only, not to the test input."""
    c, fs, h = lg.cols, lg.fs, lg.headers
    seg, W = _segments(lg, ax, n=n, win=win)
    if len(seg) < 4:
        return None
    g = pids(h)[AXN[ax]]
    prm = {k: np.array([r[k]]) for k in ("b", "a", "tau", "d", "lam")}
    sim_, real, si = closed_loop(lg, ax, seg, W, h, g, prm, gain_factors(lg, ax, seg, W, h, g), _tscale(lg, seg, W, _motor(lg)))
    sp = c[f"setpoint[{ax}]"].astype(float)[np.array(seg)[:, None] + np.arange(W)]
    f = np.fft.rfftfreq(W, 1 / fs); w = np.hanning(W); nr = int(ms / 1000 * fs)
    X = np.fft.rfft((sp - sp.mean(1, keepdims=True)) * w, axis=1)
    lam = 1e-4 * (abs(X) ** 2).mean(1, keepdims=True) * (1 + (f / 50) ** 2)

    def dec(G):
        Y = np.fft.rfft((G - G.mean(1, keepdims=True)) * w, axis=1)
        return np.median(np.cumsum(np.fft.irfft(X.conj() * Y / (abs(X) ** 2 + lam), n=W, axis=1)[:, :nr], axis=1), 0)
    mr, msim = dec(real), dec(np.where(np.isfinite(sim_), sim_, 0))
    k = max(1, int(fs / 500))
    rms = float(np.sqrt(np.mean((mr[: int(0.15 * fs)] - msim[: int(0.15 * fs)]) ** 2)))
    return dict(t_ms=(np.arange(0, nr, k) / fs * 1000).round(2).tolist(), real=mr[::k].round(3).tolist(), model=msim[::k].round(3).tolist(),
                rms=round(rms, 3), n=len(seg))


def tau_prior(inch):
    """Motor lag for craft without eRPM: measured ≈ 28 ms on 2.5″ and ≈ 45 ms on 7″ builds."""
    return 0.004 * inch + 0.017


def _motor(lg):
    if not hasattr(lg, "_motordyn"):
        lg._motordyn = motor_dynamics(lg)
    return lg._motordyn


def _tscale(lg, seg, W, md):
    c = lg.cols
    motor = [c[f"motorHz[{i}]"] for i in range(8) if f"motorHz[{i}]" in c]
    if not (md and motor):
        return None
    mhz = np.array([np.mean([m[s:s + W].mean() for m in motor]) for s in seg])
    return np.clip(md["hz"] / np.maximum(mhz, 1), 0.6, 1.6)


def identify(lg, ax, prof=None, nseg=32, win=1.0):
    h, fs, c = lg.headers, lg.fs, lg.cols
    seg, W = _segments(lg, ax, n=nseg, win=win)
    if len(seg) < 4:
        return None
    g = pids(h)[AXN[ax]]
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    md = _motor(lg)
    kfac = gain_factors(lg, ax, seg, W, h, g)
    tsc = _tscale(lg, seg, W, md)
    tau0, d0 = (md["tau"], md["d"]) if md else (tau_prior(inch), 0.003)
    u = sum(c[f"axis{k}[{ax}]"].astype(float) for k in "PIDF" if f"axis{k}[{ax}]" in c)
    y = c[f"gyroADC[{ax}]"].astype(float)
    ix = np.concatenate([np.arange(s, s + W) for s in seg])
    b0 = float(np.std(np.gradient(y)[ix] * fs) / max(np.std(u[ix]), 1e-6))
    dn = int(round(d0 * fs))
    xds = [int(round(x * fs / 1000)) for x in XD_MS]
    lams = np.array([0.0, 0.4, 0.8, 1.2, 1.6]) if ax == 2 else np.array([0.0])
    tsg = np.array([0.75, 1.0, 1.3]) if md else np.array([0.5, 0.8, 1.2, 1.8])
    Gd = np.array(np.meshgrid(b0 * 2.0 ** np.linspace(-1.5, 3, 10), tsg, [0.0, 3.0, 8.0], lams, dn + np.array(xds), indexing="ij")).reshape(5, -1)
    best = _search(lg, ax, seg, W, h, g, dict(b=Gd[0], tau=Gd[1] * tau0, d=Gd[4].astype(int), a=Gd[2], lam=Gd[3]), kfac, tsc)
    for it, sc in enumerate((0.5, 0.25)):
        lam_c = np.clip(best["lam"] + np.array([-0.2, 0, 0.2]) * (1 if it == 0 else 0.5), 0, 2.5) if ax == 2 else np.array([0.0])
        tl = np.clip(best["tau"] * 2.0 ** (np.array([-1, 0, 1]) * sc * 0.6), 0.6 * tau0, 2.0 * tau0) if md else best["tau"] * 2.0 ** (np.array([-1, 0, 1]) * sc * 0.6)
        dd = np.unique(np.clip(best["d"] + np.array([-1, 0, 1]) * max(1, int(round(fs / 1000 * (1.5 if it == 0 else 0.5)))), dn, dn + int(0.02 * fs))) if len(xds) > 1 else np.array([best["d"]])
        Gd = np.array(np.meshgrid(best["b"] * 2.0 ** (np.linspace(-1, 1, 7) * sc), np.unique(tl),
                                  np.unique(np.clip(best["a"] + np.array([-1, 0, 1]) * (4 if it == 0 else 2), 0, 40)), lam_c, dd, indexing="ij")).reshape(5, -1)
        best = _search(lg, ax, seg, W, h, g, dict(b=Gd[0], tau=Gd[1], d=Gd[4].astype(int), a=Gd[2], lam=Gd[3]), kfac, tsc)
    # how far up the sticks really excited this axis: highest frequency below which the setpoint → gyro coherence stays
    # ≥ 0.5 (allowing one dip). Margins at a crossover above this are extrapolated from the measured motor lag.
    fr = best.get("frf") or {}
    ex, miss = FRF_BAND[0], 0
    for fq, ch in zip(fr.get("f", []), fr.get("coh", [])):
        if ch >= 0.5:
            ex, miss = fq, 0
        else:
            miss += 1
            if miss > 1:
                break
    best.update(segments=len(seg), win_s=W / fs, kp_mul=round(float(np.median(kfac[0])), 3), kd_mul=round(float(np.median(kfac[1])), 3),
                kp_mul_seg=np.round(kfac[0], 3).tolist(), excited_hz=round(float(ex), 1))
    return best


# ---------------------------------------------------------------- report + per-craft memory
MODEL_V = 2


def _cache_path(lg):
    p = getattr(lg, "path", None)
    return None if p is None else p.with_suffix(f".{lg.idx}.model.json")


def _borrow(lg, ax, md):
    """Plant of the same axis from another flight of the same craft (same name, motor lag within ×1.3, hover speed within
    ×1.25): used when this flight didn't move that axis enough. The best-fitting donor wins."""
    import json
    p = getattr(lg, "path", None)
    if p is None:
        return None
    craft = str(lg.headers.get("Craft name", "")).strip()
    if not craft:
        return None
    best = None
    for f in p.parent.glob("*.model.json"):
        if f == _cache_path(lg):
            continue
        try:
            d = json.loads(f.read_text())
        except Exception:
            continue
        if d.get("v") != MODEL_V or d.get("craft") != craft:
            continue
        r = (d.get("axes") or {}).get(AXN[ax])
        if not r or r.get("status") != "ok" or r.get("conf") == "low":
            continue
        dm = d.get("motor")
        if not (md and dm) or abs(np.log(dm["tau"] / md["tau"])) > np.log(1.3) or abs(np.log(dm["hz"] / md["hz"])) > np.log(1.25):
            continue   # same hardware is only assumed when the measured motor dynamics match
        if best is None or r["fit_pct"] > best[1]["fit_pct"]:
            best = (d.get("log", f.name), r)
    return best


def model_report(lg, prof=None):
    """Everything the browser simulator needs, grounded in this log."""
    from bbl import progress
    try:
        return _model_report(lg, prof)
    finally:
        progress(lg.path.name, lg.idx, "sim", done=True)


def _model_report(lg, prof=None):
    import json
    c, h, fs = lg.cols, lg.headers, lg.fs
    thr = c["throttle%"]
    air = thr > 12
    motor = [c[f"motorHz[{i}]"] for i in range(8) if f"motorHz[{i}]" in c]
    hover_thr = float(np.median(thr[air])) / 100 if air.any() else 0.3
    mhz = float(np.median(np.mean(motor, 0)[air])) if motor and air.any() else None
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    from bbl import progress
    progress(lg.path.name, lg.idx, "sim", "Measuring motor lag from command vs eRPM", 0.02)
    md = _motor(lg)
    out = dict(fs_log=round(fs), pids=pids(h), ctl=controller(h, hover_thr), hover_thr=round(hover_thr * 100, 1), motor_hz=None if mhz is None else round(mhz, 1),
               inch=inch, axes={}, fit_hz=FIT_HZ, min_exc=MIN_EXC,
               motor=None if md is None else dict(tau_ms=round(md["tau"] * 1000, 1), delay_ms=round(md["d"] * 1000, 1), hz=round(md["hz"], 1),
                                                  coh=round(md["coh"], 2), err=round(md["err"], 4), band_hz=md["band_hz"]))
    g_, d_ = filters(h, hover_thr, mhz)
    out["filters"] = dict(gyro=g_, dterm=d_)
    from bbl import progress
    for ax in range(3):
        progress(lg.path.name, lg.idx, "sim", f"Learning the {AXN[ax]} dynamics from your flight ({ax + 1}/3)", ax / 3)
        r = identify(lg, ax, prof)
        if r is not None:
            r["status"] = "ok"
            r["conf"] = "high" if r["fit_pct"] >= 75 else "medium" if r["fit_pct"] >= 55 else "low"
        else:
            bw = _borrow(lg, ax, md)
            sp_std = float(np.std(c[f"setpoint[{ax}]"][air])) if air.any() else 0.0
            if bw:
                src, rb = bw
                r = {k: rb[k] for k in ("b", "a", "tau", "d", "lam", "fit_pct")}
                r.update(status="borrowed", source=src, conf="medium", segments=0, fit_seg=[])
            else:   # nothing to learn from: motor lag measured (or size prior), authority from the raw signal ratio
                u = sum(c[f"axis{k}[{ax}]"].astype(float) for k in "PIDF" if f"axis{k}[{ax}]" in c)
                b0 = float(np.std(np.gradient(c[f"gyroADC[{ax}]"].astype(float)) * fs) / max(np.std(u), 1e-6))
                r = dict(b=0.7 * b0, tau=md["tau"] if md else tau_prior(inch), d=int(round((md["d"] if md else 0.003) * fs)), a=2.0, lam=0.5 if ax == 2 else 0.0,
                         fit_pct=None, fit_seg=[], segments=0, status="no_excitation", conf="none")
            r["sp_std"] = round(sp_std, 1)
            r.setdefault("kp_mul", None); r.setdefault("kd_mul", None)
        r["tau_ms"] = round(r["tau"] * 1000, 1); r["delay_ms"] = round(r["d"] / fs * 1000, 1)
        if r.get("kp_mul") is None:   # no segment to measure them on: what the headers say at the hover throttle
            r["kp_mul"], r["kd_mul"] = out["ctl"]["tpa_p"], out["ctl"]["tpa_d"]
        # validation segment for the browser replay: the most active one (setpoint, filtered gyro, logged FF, start state)
        seg, W = _segments(lg, ax, n=6, win=3.0)
        if not seg:
            seg, W = _segments(lg, ax, n=6, win=3.0, min_std=0)
        if seg:
            s = seg[0]; sl = slice(s, s + W)
            g = pids(h)[AXN[ax]]
            prm = {k: np.array([r[k]]) for k in ("b", "a", "tau", "d", "lam")}
            kf = gain_factors(lg, ax, [s], W, h, g)
            sim, real, si, st = closed_loop(lg, ax, [s], W, h, g, prm, kf, _tscale(lg, [s], W, md), state=True)
            err, var = _score(sim, real, si, 1, 1, fs)
            r["val"] = dict(t0=round(float(lg.t[s]), 3), sp=c[f"setpoint[{ax}]"][sl].round(1).tolist(), gyro=c[f"gyroADC[{ax}]"][sl].round(1).tolist(),
                            F=(c[f"axisF[{ax}]"][sl].round(2).tolist() if f"axisF[{ax}]" in c else None),
                            gyro0=round(float(st["x0"][0]), 2), I0=float(c[f"axisI[{ax}]"][s]), P0=float(c[f"axisP[{ax}]"][s]),
                            m0=round(float(st["m0"][0]), 3), uhist=np.round(st["uhist"][0], 2).tolist(), trim=round(float(st["trim"][0]), 3),
                            kp_mul=round(float(kf[0][0]), 3), kd_mul=round(float(kf[1][0]), 3), thr=round(float(thr[sl].mean()), 1),
                            fit=round(float(100 * (1 - np.sqrt(min(4.0, err[0, 0] / var[0])))), 1), sp_std=round(float(np.std(c[f"setpoint[{ax}]"][sl])), 1))
        r["step_ll"] = step_like_for_like(lg, ax, r) if r["status"] == "ok" else None
        # measured noise (raw gyro above ~60 Hz) to optionally inject into the simulation
        if f"gyroUnfilt[{ax}]" in c:
            s = seg[0] if seg else int(len(thr) / 2)
            raw = c[f"gyroUnfilt[{ax}]"][s:s + int(2 * fs)].astype(float)
            lo = _pt(_pt(raw, 60, fs), 60, fs)
            r["noise"] = (raw - lo).round(2).tolist()
        out["axes"][AXN[ax]] = r
    # remember this flight's plant for other flights of the same craft
    cp = _cache_path(lg)
    if cp is not None:
        try:
            keep = {a: {k: v for k, v in (out["axes"][a] or {}).items() if k in ("b", "a", "tau", "d", "lam", "fit_pct", "status", "conf", "segments")} for a in AXN}
            cp.write_text(json.dumps(dict(v=MODEL_V, craft=str(h.get("Craft name", "")).strip(), log=f"{lg.path.name} #{lg.idx}", motor=md, axes=keep)))
        except OSError:
            pass
    return out
