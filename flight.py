"""Flight-behaviour analyses: PID-term balance, motor-output headroom, propwash & latency. numpy only."""
import numpy as np
from tuning import finding, hnum, welch, D_NOISY

AXN = ["Roll", "Pitch", "Yaw"]


def band(x, fs, lo=None, hi=None):
    """Zero-phase FFT band filter (lo/hi in Hz, None = open)."""
    from tuning import _band
    return _band(x, fs, lo, hi)


def mov_rms(x, w):
    w = max(1, int(w))
    k = np.ones(w) / w
    return np.sqrt(np.convolve(x * x, k, mode="same"))


def runs(mask, t, min_s=0.0, join_s=0.0):
    """Contiguous True stretches → [(t0, t1)], closing gaps shorter than join_s."""
    if not mask.any():
        return []
    d = np.diff(np.r_[0, mask.astype(np.int8), 0])
    a, b = np.flatnonzero(d == 1), np.flatnonzero(d == -1) - 1
    out = []
    for i, j in zip(a, b):
        if out and t[i] - out[-1][1] <= join_s:
            out[-1][1] = float(t[j])
        else:
            out.append([float(t[i]), float(t[j])])
    return [(round(x, 3), round(y, 3)) for x, y in out if y - x >= min_s]


def rms(x):
    return float(np.sqrt(np.mean(np.square(x)))) if len(x) else 0.0


# ---------------------------------------------------------------- PID terms
def pid_report(lg, t0=None, t1=None, prof=None):
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    t = lg.t[sl]
    if len(t) < fs * 2:
        return {"error": "Select at least 2 s."}
    air = c["throttle%"][sl] > 5
    lim = [hnum(h, "pidsum_limit", 500)[0]] * 2 + [hnum(h, "pidsum_limit_yaw", 400)[0]]
    ilim = hnum(h, "iterm_limit", 400)[0]
    out, F, ev = {"axes": {}, "findings": [], "events": []}, [], []
    for ax in range(3):
        g = lambda k: c[f"{k}[{ax}]"][sl].astype(np.float64) if f"{k}[{ax}]" in c else np.zeros(len(t))
        P, I, D, FF, sp = g("axisP"), g("axisI"), g("axisD"), g("axisF"), g("setpoint")
        calm = air & (np.abs(sp) < 30)
        move = air & (np.abs(sp) > 80)
        r = {k: round(rms(v[air]), 1) for k, v in (("P", P), ("I", I), ("D", D), ("FF", FF))}
        d_hf = rms(band(D, fs, 100)[air]) / (r["D"] + 1e-9) if r["D"] > 0.5 else None
        p_hf = rms(band(P, fs, 100)[air]) / (r["P"] + 1e-9) if r["P"] > 0.5 else None
        ff_hf = rms(band(FF, fs, 40)[move]) / (rms(FF[move]) + 1e-9) if move.sum() > fs * 0.5 and rms(FF[move]) > 1 else None
        bias = float(np.median(I[calm])) if calm.sum() > fs else 0.0
        tot = P + I + D + FF
        sat = air & (np.abs(tot) >= 0.97 * lim[ax])
        wind = air & (np.abs(I) >= min(0.5 * ilim, 150))
        for a_, b_ in runs(sat, t, 0.01, 0.1)[:40]:
            ev.append(dict(kind="pidsat", axis=ax, t0=a_, t1=b_, label=f"{AXN[ax]} PID sum at limit"))
        for a_, b_ in runs(wind, t, 0.1, 0.2)[:40]:
            ev.append(dict(kind="windup", axis=ax, t0=a_, t1=b_, label=f"{AXN[ax]} I-term wind-up"))
        a = dict(rms=r, d_hf=None if d_hf is None else round(d_hf, 2), p_hf=None if p_hf is None else round(p_hf, 2),
                 ff_hf=None if ff_hf is None else round(ff_hf, 2), i_bias=round(bias, 1), sat_pct=round(float(sat.mean() * 100), 2),
                 windup_s=round(float(wind.sum() / fs), 2), flags=[])
        out["axes"][str(ax)] = a
        n = AXN[ax]
        # I-term holding a constant offset = the quad is not symmetric
        if abs(bias) > (15 if ax < 2 else 20):
            # Betaflight Quad X mixer: +roll raises the left motors, +pitch raises the rear motors
            side = {0: "left" if bias > 0 else "right", 1: "rear" if bias > 0 else "front"}.get(ax)
            why = {0: f"the {side} side needs more thrust: weight sits toward the {side}, or the {('right' if side == 'left' else 'left')} motors/props produce more thrust",
                   1: f"the {side} needs more thrust: weight sits toward the {side} (battery, camera), and/or in fast forward flight the frame and camera create a steady "
                      f"pitching moment (common on long-range builds that cruise a lot)",
                   2: "the props' torque doesn't cancel: a slightly tilted motor or a different/damaged prop"}[ax]
            lvl = "warning" if abs(bias) > (30 if ax < 2 else 40) else "info"
            F.append(finding(lvl, f"{n}: I-term constantly holds {bias:+.0f}" + (f" (the {side} needs a steady push)" if side else ""),
                             "The quad needs a steady correction on this axis just to fly straight.",
                             f"With the stick centred, the I term's median is {bias:+.0f} instead of ≈0 ({abs(bias) / 10:.1f}% motor output). I accumulates whatever push is missing, so: {why}. "
                             "It uses up some control authority and the quad drifts briefly after each flip until I catches up.",
                             (f"Move weight away from the {side} until the Motors tab shows the load evenly shared." + (" If it only appears in fast cruise, it's aerodynamic and harmless." if ax == 1 else ""))
                             if ax < 2 else "Check that all motors sit flat (no twisted arm or bent mount) and all props are the same type and undamaged.",
                             ""))
            a["flags"].append(("I bias", lvl))
        if a["windup_s"] > 0.3:
            lvl = "warning" if a["windup_s"] > 1.5 else "info"
            F.append(finding(lvl, f"{n}: I-term winds up ({a['windup_s']:.1f} s above {min(0.5 * ilim, 150):.0f})",
                             "I grows large, then overshoots when released (bounce-back).",
                             "Big I values build up when the quad can't follow the command for a while: long flips, motor saturation, or a strong offset (see I bias). When the move ends, the stored I pushes past the target.",
                             "Keep iterm_relax on (RP, setpoint mode) and lower iterm_relax_cutoff for big props (15 → 10). If it happens during saturation, reduce rates or P.",
                             "Lower relax cutoff = slightly slower I recovery in sharp moves."))
            a["flags"].append(("wind-up", lvl))
        if a["sat_pct"] > 0.3:
            lvl = "warning" if a["sat_pct"] > 2 else "info"
            F.append(finding(lvl, f"{n}: PID output hits its limit {a['sat_pct']:.1f}% of the time", "The controller asks for more than it's allowed to give.",
                             f"P+I+D+FF reached pidsum limit ({lim[ax]:.0f}). While clipped, the loop can't respond fully, so flips overshoot and propwash gets worse.",
                             "Usually from too much P/D on a noisy quad or very high rates on this axis. Lower P or D by 10%, or raise pidsum_limit if the quad has spare power.",
                             "Higher limit = motors can saturate instead."))
            a["flags"].append(("limit", lvl))
        if d_hf is not None:
            a["flags"].append(("D noise", "good" if d_hf < D_NOISY else "info" if d_hf < 0.65 else "warning"))
        if p_hf is not None and p_hf > 0.5:
            a["flags"].append(("P noise", "info"))
        if ff_hf is not None and ff_hf > 0.5:
            F.append(finding("info", f"{n}: feedforward is jittery ({ff_hf * 100:.0f}% fast content during stick moves)", "FF follows radio-link steps, not smooth stick motion.",
                             "Feedforward uses how fast the stick moves. A slow or uneven radio link turns smooth moves into steps, and FF turns steps into spikes on the motors.",
                             "Raise feedforward_smooth_factor (e.g. 50 → 65) or feedforward_jitter_factor, or use a faster RC link rate.", "Slightly softer stick feel."))
    beh = pid_behaviour(lg, sl, prof)
    out["behaviour"] = beh
    F.extend(beh.pop("findings"))
    if not F:
        F.append(finding("good", "PID terms look balanced", "No constant offsets, no wind-up, no clipping, D is not dominated by noise."))
    # overall balance line (always)
    bal = " · ".join(f"{AXN[a]}: P {out['axes'][str(a)]['rms']['P']} I {out['axes'][str(a)]['rms']['I']} D {out['axes'][str(a)]['rms']['D']} FF {out['axes'][str(a)]['rms']['FF']}" for a in range(3))
    F.append(finding("info", "How hard each term works (RMS in flight)", bal,
                     "RMS of each term over the airborne part of the selection, in PID units (10 = 1% motor output). A large I usually means a steady offset "
                     "(see above); D larger than P often means D is mostly reacting to noise (see its fast-noise share)."))
    out["findings"] = F
    out["events"] = ev
    return out


# ---------------------------------------------------------------- how the terms behave together
def mode_acro(c, sl):
    """True where the quad flew in acro (rate) mode. Blackbox flightModeFlags: bit 0 ARM, bit 1 ANGLE, bit 2 HORIZON."""
    if "flightModeFlags" not in c:
        return np.ones(sl.stop - sl.start, bool)
    fm = c["flightModeFlags"][sl].astype(int)
    return (fm & 6) == 0


def mode_share(c, sl, air):
    if "flightModeFlags" not in c or not air.any():
        return None
    fm = c["flightModeFlags"][sl].astype(int)[air]
    return dict(acro=round(float(np.mean((fm & 6) == 0) * 100)), angle=round(float(np.mean((fm & 2) > 0) * 100)), horizon=round(float(np.mean((fm & 4) > 0) * 100)))


def _spec_windows(x_by_key, idx, w):
    return {k: np.fft.rfft((v[idx] - v[idx].mean(1, keepdims=True)) * w, axis=1) for k, v in x_by_key.items()}


def pid_behaviour(lg, sl, prof=None):
    """Per axis, with the sticks still: the strongest oscillation in the tracking error and which term drives it
    (P, D or I), checked against frame resonances and motor speed; during stick moves: P/D/FF balance and how much of
    its nominal strength feedforward delivered. Spectra are returned for the chart."""
    from tuning import _nanmedfilt, resonances, D_NOISY
    c, h, fs = lg.cols, lg.headers, lg.fs
    t = lg.t[sl]
    thr = c["throttle%"][sl]
    air = thr > 8
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    f_loop_max = max(15.0, 150.0 / inch)          # fastest plausible loop oscillation for this size (7″ ≈ 21 Hz, 2.5″ ≈ 60 Hz)
    sp = np.array([c[f"setpoint[{a}]"][sl].astype(float) for a in range(3)])
    still = air & (np.abs(sp).max(0) < 30)
    nper = int(2 ** round(np.log2(fs * 4)))
    if len(t) < 2 * nper:
        nper = int(2 ** int(np.log2(max(256, len(t) // 3))))
    f = np.fft.rfftfreq(nper, 1 / fs); w = np.hanning(nper); df = f[1] - f[0]
    st = np.arange(0, len(t) - nper, nper // 2)
    st_still = st[np.array([still[s:s + nper].mean() > 0.85 for s in st], bool)] if len(st) else st
    res = [r["f"] for r in resonances(lg, float(lg.t[sl.start]), float(lg.t[sl.stop - 1]))["list"]] if len(t) > fs * 10 else []
    motors = [c[f"motorHz[{i}]"][sl] for i in range(8) if f"motorHz[{i}]" in c]
    mh = float(np.median(np.mean(motors, 0)[air])) if motors and air.any() else None
    F, axes = [], {}
    gl = np.unique(np.round(np.geomspace(max(0.5, df), fs / 2, 160) / df)).astype(int)    # log-spaced bins for the chart
    gl = gl[gl < len(f)]
    pid = lambda a: (hnum(h, f"{a}PID", 0) + [0, 0, 0])[:3]
    for ax in range(3):
        n = AXN[ax]
        sig = {k: c[f"{k}[{ax}]"][sl].astype(float) for k in ("axisP", "axisI", "axisD", "axisF") if f"{k}[{ax}]" in c}
        sig["err"] = sp[ax] - c[f"gyroADC[{ax}]"][sl].astype(float)
        a = {"f": f[gl].round(2).tolist()}
        if len(st_still) >= 3:
            Fq = _spec_windows(sig, st_still[:, None] + np.arange(nper), w)
            S = {k: (abs(v) ** 2).mean(0) for k, v in Fq.items()}
            a["still"] = {k: (10 * np.log10(v[gl] + 1e-9)).round(1).tolist() for k, v in S.items()}
            db = 10 * np.log10(S["err"] + 1e-9); base = _nanmedfilt(db, max(2, int(round(4 / df))))
            band = (f >= 1) & (f <= min(60, fs / 4))
            k = int(np.flatnonzero(band)[np.argmax((db - base)[band])])
            prom = float((db - base)[k]); fk = float(f[k]); bb = slice(max(0, k - 1), k + 2)
            amp = lambda key: float(np.sqrt(S[key][bb].mean())) if key in S else 0.0
            rI, rD = amp("axisI") / max(amp("axisP"), 1e-9), amp("axisD") / max(amp("axisP"), 1e-9)
            is_res = any(abs(fk - r) <= max(1.5, 0.06 * r) for r in res)
            is_mot = mh is not None and fk > 0.7 * mh and abs(fk / mh - round(fk / mh)) < 0.06
            kind = None
            if prom >= 4:
                if is_res or is_mot:
                    kind = "vibration"
                elif fk <= 6 and rI >= 0.8:
                    kind = "pi"
                elif 2.5 <= fk <= f_loop_max:
                    kind = "loop"
                elif fk > f_loop_max:
                    kind = "other"          # (slower than 2.5 Hz and not I-driven: wind / the pilot's own corrections → no claim)
            a["osc"] = dict(f=round(fk, 1), prom_db=round(prom, 1), i_over_p=round(rI, 2), d_over_p=round(rD, 2), kind=kind, res=is_res, motor=is_mot)
            P_, I_, D_ = pid(n.lower())
            if kind == "pi":
                F.append(finding("warning" if prom >= 6 else "info", f"{n}: P and I chase each other (slow {fk:.1f} Hz wobble)",
                                 f"With the sticks still, the error swings at {fk:.1f} Hz (+{prom:.0f} dB above its surroundings) and I pushes as hard as P there ({rI:.1f}×).",
                                 "At this frequency the I term isn't just trimming a steady offset: it overshoots, P pulls back, I winds the other way. That's the classic slow "
                                 "'floaty' wobble or bounce-back after moves. It gets worse with a high I/P ratio and with big, slow props.",
                                 f"Options: I −15% (I {I_:.0f} → {round(I_ * 0.85)}), or P +10% (P {P_:.0f} → {round(P_ * 1.1)}) so P dominates at this frequency"
                                 + (f"; on roll/pitch, a lower iterm_relax_cutoff (now {hnum(h, 'iterm_relax_cutoff', 15)[0]:.0f})" if ax < 2 else "") + ".",
                                 "Less I holds attitude less firmly in wind; more P raises noise to the motors."))
            elif kind == "loop" and D_ <= 0:
                F.append(finding("warning" if prom >= 6 else "info", f"{n}: the loop rings at {fk:.1f} Hz",
                                 f"With the sticks still, the error swings at {fk:.1f} Hz (+{prom:.0f} dB above its surroundings). This axis has no D, so P alone sets the damping.",
                                 "A narrow peak at a frequency the loop can reach on this size of quad means it is ringing near its limit; it also shows as overshoot in the Step response tab.",
                                 f"Options: P −10% (P {P_:.0f} → {round(P_ * 0.9)})" + ". The PID simulator shows the effect on a model of this quad.",
                                 "Less P → softer hold."))
            elif kind == "loop":
                cross = 9.6 * P_ / max(D_, 1)          # above ≈ this frequency D's push exceeds P's for the same error
                F.append(finding("warning" if prom >= 6 else "info", f"{n}: the loop rings at {fk:.1f} Hz",
                                 f"With the sticks still, the error swings at {fk:.1f} Hz (+{prom:.0f} dB above its surroundings); at that frequency D pushes {rD:.1f}× as hard as P.",
                                 "A narrow peak at a frequency the loop can reach on this size of quad means it is ringing near its limit; it also shows as overshoot in the Step "
                                 f"response tab. (With your gains D overtakes P above ≈{cross:.0f} Hz, so the D/P ratio here mostly reflects where the ring sits.)",
                                 (f"Options: D +10–15% (D {D_:.0f} → {round(D_ * 1.12)}) or P −10% (P {P_:.0f} → {round(P_ * 0.9)})." if rD < 1 else
                                  f"D already outweighs P here, so it's arriving late rather than being too weak: less filter delay (Noise tab → filter planner) usually damps this better; or P −10% (P {P_:.0f} → {round(P_ * 0.9)}).")
                                 + " The PID simulator shows the effect on a model of this quad.",
                                 "More D → warmer motors; less P → softer hold; less filtering → more noise."))
            elif kind == "vibration":
                src = "a frame resonance" if is_res else f"motor speed ×{round(fk / mh)}"
                F.append(finding("info", f"{n}: the strongest ripple in the error ({fk:.0f} Hz) is vibration, not the tune",
                                 f"It sits on {src}; P passes it straight to the motors.",
                                 "P reacts to everything the filtered gyro shows, including vibration the filters leave in. This is not the loop oscillating.",
                                 "See the Noise tab's filter planner for a notch or filter change.", ""))
            elif kind == "other":
                F.append(finding("info", f"{n}: ripple at {fk:.0f} Hz in the error (+{prom:.0f} dB)",
                                 "Too fast to be the loop oscillating on this size of quad, and it doesn't match a confirmed resonance or motor order.",
                                 f"A loop oscillation on {inch:g}″ props would sit below ~{f_loop_max:.0f} Hz. Likely a weak resonance or turbulence; check the Noise tab.", "", ""))
            # D vibration: where its fast energy sits
            if "axisD" in S:
                hb = f >= 80
                if hb.any() and S["axisD"].sum() > 0:
                    share = float(S["axisD"][hb].sum() / S["axisD"][f >= 1].sum())
                    kd = int(np.flatnonzero(hb)[np.argmax(S["axisD"][hb])]); fd = float(f[kd])
                    where = ("motor speed ×%d" % round(fd / mh)) if mh and abs(fd / mh - round(fd / mh)) < 0.06 else \
                            next((f"the {r:.0f} Hz resonance" for r in res if abs(fd - r) <= max(2, 0.05 * r)), "no motor order or resonance")
                    a["d_vib"] = dict(share=round(share, 2), f=round(fd, 1), where=where)
                    if share >= D_NOISY:
                        F.append(finding("warning" if share >= 0.65 else "info", f"{n}: D is mostly vibrating ({share * 100:.0f}% of it above 80 Hz, strongest at {fd:.0f} Hz)",
                                         f"The strongest fast part of D sits at {fd:.0f} Hz: {where}.",
                                         "D amplifies fast changes, so leftover vibration in the gyro becomes D output the props can't use. "
                                         + ("Since it sits on a motor order, the RPM filter is the place to look." if "motor" in where else
                                            "Since it sits on a resonance, a notch there (filter planner) removes it at the source." if "resonance" in where else
                                            "More D-term filtering (or less D) reduces it."),
                                         "See 'Noise reaching the motors' and the filter planner in the Noise tab.", ""))
        # stick moves: P / D / FF balance and FF delivery
        mv = air & (np.abs(np.gradient(sp[ax]) * fs) > 300)
        if mv.sum() > fs * 0.5:
            def brms(x, lo, hi):
                from tuning import _band
                return _band(x, fs, lo, hi)
            Pm = brms(sig["axisP"], 2, 30)[mv]; Dm = brms(sig["axisD"], 2, 30)[mv] if "axisD" in sig else np.zeros(1)
            Fm = sig["axisF"][mv] if "axisF" in sig else np.zeros(1)
            pd_r = float(np.sqrt(np.mean(Dm ** 2)) / max(np.sqrt(np.mean(Pm ** 2)), 1e-9))
            ff_share = float(np.sqrt(np.mean(Fm ** 2)) / max(np.sqrt(np.mean((sig["axisP"][mv] + Fm) ** 2)), 1e-9))
            # feedforward delivered vs nominal, by stick speed (jitter reduction trims slow moves)
            kf = 0.013754 * ((hnum(h, "ff_weight", 0) * 3)[ax]) / 100
            spd = np.gradient(sp[ax]) * fs
            dlv = None
            acro = mode_acro(c, sl)
            if kf > 0 and "axisF" in sig and (acro & air).sum() > 2 * fs:
                from tuning import _band
                spd_s, F_s = _band(spd, fs, None, 25), _band(sig["axisF"], fs, None, 25)
                dlv = {}
                for lo_, hi_, lab in ((100, 600, "slow"), (600, 2000, "medium"), (2000, 1e9, "fast")):
                    m_ = air & acro & (np.abs(spd_s) >= lo_) & (np.abs(spd_s) < hi_)
                    if m_.sum() > fs * 0.2:
                        dlv[lab] = round(float(np.dot(F_s[m_], spd_s[m_]) / max(np.dot(spd_s[m_], spd_s[m_]), 1e-9) / kf), 2)
            a["moves"] = dict(d_over_p=round(pd_r, 2), ff_share=round(ff_share, 2), ff_delivered=dlv,
                              gain_d_over_p=round(pid(n.lower())[2] / max(pid(n.lower())[0], 1), 2), gain_i_over_p=round(pid(n.lower())[1] / max(pid(n.lower())[0], 1), 2))
            if dlv and ax < 2 and dlv.get("slow") is not None and dlv.get("fast") is not None and dlv["slow"] < 0.6 and dlv["fast"] > 0.75:
                F.append(finding("info", f"{n}: feedforward is mostly off on slow stick moves ({dlv['slow'] * 100:.0f}% of nominal), full on fast ones ({dlv['fast'] * 100:.0f}%)",
                                 "Betaflight's feedforward jitter reduction trims FF when the sticks move slowly.",
                                 f"Measured in acro mode by comparing the logged FF term with what ff_weight alone would give, at different stick speeds: "
                                 + ", ".join(f"{k} {v * 100:.0f}%" for k, v in dlv.items()) + ". On slow, smooth moves P does the work instead, which adds lag.",
                                 f"If slow moves feel late, lower feedforward_jitter_factor (now {hnum(h, 'feedforward_jitter_factor', 7)[0]:.0f}); if fast flicks overshoot, lower ff_weight.",
                                 "Less jitter reduction lets RC-link jitter through to the motors."))
        axes[str(ax)] = a
    ms = mode_share(c, sl, air)
    if ms and ms["acro"] < 95:
        F.append(finding("info", f"Flown {100 - ms['acro']}% in a self-levelling mode (angle {ms['angle']}%, horizon {ms['horizon']}%)",
                         "There the roll/pitch setpoint comes from the levelling controller, not straight from the sticks.",
                         "The rate loop (what P, I, D and the simulator model) works the same, but feedforward on roll/pitch behaves differently in angle mode, "
                         "so feedforward is only analysed on the acro-mode part. Stick-speed based numbers mix both modes.", "", ""))
    return dict(axes=axes, f_loop_max=round(f_loop_max), modes=ms, findings=F)


# ---------------------------------------------------------------- motor output
def motor_out_report(lg, t0=None, t1=None, prof=None):
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    t = lg.t[sl]
    mk = [k for k in (f"motor%[{i}]" for i in range(8)) if k in c]
    if not mk or len(t) < fs * 2:
        return {"error": "No motor output in this window."}
    M = np.array([c[k][sl] for k in mk], np.float64)
    nm = len(mk)
    thr = c["throttle%"][sl]
    air = thr > 5
    F, ev = [], []
    top, bot = M.max(0), M.min(0)
    sat = air & (top >= 99.5)
    floor = air & (bot <= 0.5) & (thr > 10)
    for a_, b_ in runs(sat, t, 0.005, 0.08)[:60]:
        ev.append(dict(kind="sat", t0=a_, t1=b_, label="motor at 100%"))
    for a_, b_ in runs(floor, t, 0.02, 0.08)[:60]:
        ev.append(dict(kind="floor", t0=a_, t1=b_, label="motor at minimum"))
    who = [round(float(np.mean(M[m][sat] >= 99.5) * 100), 1) if sat.any() else 0.0 for m in range(nm)]
    sp = np.abs(np.array([c[f"setpoint[{a}]"][sl] for a in range(3)]))
    calm = air & (sp[:2].max(0) < 30) & (np.abs(np.gradient(thr) * fs) < 30)
    hover_thr = float(np.median(thr[calm])) if calm.sum() > fs else None
    hover_mot = float(np.median(M.mean(0)[calm])) if calm.sum() > fs else None
    noise = [round(rms(band(M[m], fs, 80)[air]), 2) for m in range(nm)]
    out = dict(sat_pct=round(float(sat.mean() * 100), 2), floor_pct=round(float(floor.mean() * 100), 2), sat_by_motor=who,
               hover_thr=None if hover_thr is None else round(hover_thr, 1), hover_motor=None if hover_mot is None else round(hover_mot, 1),
               noise=noise, mean=[round(float(M[m][air].mean()), 1) for m in range(nm)], events=ev)
    if out["sat_pct"] > 0.2:
        lvl = "warning" if out["sat_pct"] > 1.5 else "info"
        wm = int(np.argmax(who))
        F.append(finding(lvl, f"Motors hit 100% for {out['sat_pct']:.1f}% of the flight", "At full power the quad can't correct attitude any more.",
                         f"While a motor is at 100%, the mixer has to reduce the others to keep control, so tracking suffers (overshoot at the end of punch-outs, wobble in hard turns). "
                         f"M{wm + 1} is the one maxed out most often ({who[wm]:.0f}% of those moments)." + (" One motor maxing out much more than the others points to CG offset or a weaker motor." if max(who) > 60 else ""),
                         "Normal in short punch-outs. If it happens in turns, lower rates or P; if always the same motor, check CG and that motor.",
                         "—"))
    else:
        F.append(finding("good", f"Plenty of headroom: motors at 100% only {out['sat_pct']:.2f}% of the time", "The mixer always had room to correct."))
    if out["floor_pct"] > 0.5:
        lvl = "warning" if out["floor_pct"] > 3 else "info"
        F.append(finding(lvl, f"A motor sits at its minimum {out['floor_pct']:.1f}% of the flight (with throttle up)", "At the bottom the motor can't slow down further to correct.",
                         "When throttle is low and the quad rotates, one motor may be commanded to 0 %: control is lost on that side for a moment. This is a main cause of propwash wobble and can provoke desyncs.",
                         f"Raise dynamic idle (dyn_idle_min_rpm {hnum(h, 'dyn_idle_min_rpm', 0)[0]:.0f} → +5), keep airmode on, and consider thrust_linear 20–40 for big props.",
                         "Higher idle = descents feel a bit floatier."))
    if hover_mot is not None:
        lvl = "info" if 15 <= hover_mot <= 55 else "warning"
        F.append(finding(lvl, f"Hover at about {hover_mot:.0f}% motor output (throttle {hover_thr:.0f}%)",
                         "Low = lots of spare power; high = heavy or underpowered." if lvl == "info" else ("Very high hover: little headroom left." if hover_mot > 55 else "Very low hover: throttle resolution near hover is poor."),
                         "Motor output needed to hold altitude in calm flight. Around 20–40% is typical for freestyle quads. Very low values make the throttle touchy and increase propwash at low throttle; very high values leave little room for corrections.",
                         "If hover is very low, thrust_linear and a throttle limit / curve help; if very high, lighten the quad or use bigger props / higher KV.", ""))
    mx = max(noise)
    lvl = "good" if mx < 1.0 else "info" if mx < 2.0 else "warning"
    F.append(finding(lvl, f"Fast motor-command noise: up to {mx:.1f}% RMS above 80 Hz", "How much the motor commands buzz.",
                     "Fast changes in the motor command that the props can't turn into useful thrust; they end up as motor heat and sound. "
                     + " · ".join(f"M{m + 1} {v:.1f}%" for m, v in enumerate(noise)) + ". The Noise tab splits this by PID term.",
                     "See 'Noise reaching the motors' in the Noise tab for which term carries it and which filter to change." if lvl != "good" else "", ""))
    out["findings"] = F
    return out


# ---------------------------------------------------------------- propwash & latency
PW_CLASSES = [(1.5, "excellent"), (2.5, "good"), (3.5, "ok"), (5.0, "bad"), (1e9, "terrible")]


def pw_class(ratio):
    """Wobble after a throttle chop, relative to calm flight → rating."""
    return next(n for lim, n in PW_CLASSES if ratio < lim)

PW_DEFAULTS = dict(chop=120.0, drop=0.0, win=0.6, stick=300.0, skip=80.0, flo=15.0, fhi=100.0, minev=3)


def propwash_report(lg, t0=None, t1=None, prof=None, **pw):
    P = {**PW_DEFAULTS, **{k: v for k, v in pw.items() if v is not None and k in PW_DEFAULTS}}
    P["fhi"] = max(P["fhi"], P["flo"] + 5)
    c, h, sl, fs = lg.cols, lg.headers, lg.window(t0, t1), lg.fs
    t = lg.t[sl]
    if len(t) < fs * 5:
        return {"error": "Select at least 5 s."}
    inch = ((prof or {}).get("used") or {}).get("inch", 5)
    thr = c["throttle%"][sl].astype(np.float64)
    air = thr > 5
    F = []
    out = {"axes": {}}
    # ---- latency: lag that best aligns gyro to setpoint (cross-correlation, stick-active stretches) ----
    maxlag = int(0.12 * fs)
    for ax in range(3):
        sp = c[f"setpoint[{ax}]"][sl].astype(np.float64)
        gy = c[f"gyroADC[{ax}]"][sl].astype(np.float64)
        a = {}
        act = air & (np.abs(sp) > 40)
        if act.sum() > fs:
            s, g = np.gradient(band(sp, fs, 1, 30)), np.gradient(band(gy, fs, 1, 30))   # rate of change: sharp correlation peak
            w = np.convolve(act, np.ones(int(0.3 * fs)), "same") > 0
            s, g = s * w, g * w
            n = 1 << int(np.ceil(np.log2(2 * len(s))))
            full = np.fft.irfft(np.fft.rfft(g, n) * np.conj(np.fft.rfft(s, n)), n)
            neg = int(0.03 * fs)
            cc = np.r_[full[-neg:], full[:maxlag]]
            k = int(np.argmax(cc))
            kf = float(k)
            if 0 < k < len(cc) - 1:
                y0, y1, y2 = cc[k - 1], cc[k], cc[k + 1]
                kf = k + 0.5 * (y0 - y2) / (y0 - 2 * y1 + y2 + 1e-12)
            a["lag_ms"] = round(float((kf - neg) / fs * 1000), 1)
            a["err_move"] = round(rms((sp - gy)[act]), 1)
        a["err_calm"] = round(rms((sp - gy)[air & (np.abs(sp) < 30)]), 1)
        out["axes"][str(ax)] = a
    # ---- propwash: throttle chops followed by low-throttle descent ----
    ts = np.convolve(thr, np.ones(int(0.05 * fs)) / int(0.05 * fs), "same")
    dthr = np.gradient(ts) * fs
    cand = runs(air & (dthr < -P["chop"]), t, 0.02, 0.3)
    if P["drop"] > 0:  # keep only chops that lost at least this much throttle overall
        cand = [(a_, b_) for a_, b_ in cand
                if ts[max(0, int(np.searchsorted(t, a_)) - int(0.1 * fs))] - ts[min(len(t) - 1, int(np.searchsorted(t, b_)) + int(0.1 * fs))] >= P["drop"]]
    err = [band(c[f"setpoint[{ax}]"][sl] - c[f"gyroADC[{ax}]"][sl], fs, P["flo"], min(P["fhi"], 0.45 * fs)) for ax in range(2)]
    # sticks-quiet mask: only judge wobble while the pilot is NOT moving roll/pitch/yaw. A split-S, flip or turn right after the
    # chop makes its own tracking transients (overshoot at the start/end of the move) that are the tune's step response,
    # not propwash. Stick acceleration is smoothed over 20 ms; after any stick movement 80 ms are skipped as well.
    k20 = max(1, int(0.02 * fs))
    stick = np.max([np.convolve(np.abs(np.gradient(c[f"setpoint[{ax}]"][sl].astype(np.float64)) * fs), np.ones(k20) / k20, "same") for ax in range(3)], axis=0)
    moving = stick > P["stick"]                                        # °/s² of setpoint change
    ks = max(1, int(P["skip"] / 1000 * fs))
    moving = np.convolve(moving.astype(float), np.ones(ks), "full")[:len(moving)] > 0   # extend past each move
    quiet = ~moving
    envq = np.max([mov_rms(e * quiet, 0.1 * fs) / np.sqrt(np.maximum(mov_rms(quiet.astype(float), 0.1 * fs) ** 2, 0.2)) for e in err], axis=0)
    calm = air & quiet & (np.abs(dthr) < 30)
    base = float(np.median(envq[calm])) if calm.sum() > fs else float(np.median(envq[air]))
    env = envq
    events, pw_idx = [], []
    out["skipped"] = 0
    for a_, b_ in cand:
        i0 = int(np.searchsorted(t, a_))
        i1 = min(len(t), i0 + int(P["win"] * fs))
        if i1 - i0 < fs * min(0.3, 0.5 * P["win"]):
            continue
        q = quiet[i0:i1]
        if q.sum() < min(0.25, 0.4 * P["win"]) * fs:          # sticks busy for most of the window: can't separate propwash from the manoeuvre
            out["skipped"] += 1
            continue
        pk = float(np.percentile(env[i0:i1][q], 98))
        ax = int(np.argmax([rms(e[i0:i1][q]) for e in err]))
        thr_from = float(ts[max(0, i0 - int(0.1 * fs))])
        ratio = pk / (base + 1e-9)
        # dominant wobble frequency of this event (Hann-windowed FFT of the tracking error, 15–100 Hz)
        e0 = err[ax][i0:i1] * q
        E = np.abs(np.fft.rfft((e0 - e0.mean()) * np.hanning(len(e0)), 4096)); fq = np.fft.rfftfreq(4096, 1 / fs)
        mf = (fq >= max(18.0, P["flo"])) & (fq <= P["fhi"])
        wf = float(fq[mf][np.argmax(E[mf])])
        # how long until the wobble falls back under 1.5× calm (sustained 50 ms)
        above = env[i0:min(len(t), i0 + int(1.5 * fs))] > 1.5 * base
        k50 = int(0.05 * fs)
        settle = next((j for j in range(len(above) - k50) if not above[j:j + k50].any()), len(above))
        gpk = max(float(np.max(np.abs(c[f"gyroADC[{a}]"][sl][i0:i1] - c[f"setpoint[{a}]"][sl][i0:i1])[q])) for a in (0, 1))
        events.append(dict(t=round(float(t[i0]), 2), t1=round(float(t[i1 - 1]), 2), ratio=round(ratio, 2), peak=round(pk, 1),
                           axis=ax, thr_from=round(thr_from), thr_to=round(float(ts[i1 - 1])), freq=round(wf, 1),
                           settle_ms=round(settle / fs * 1000), err_peak=round(gpk, 1), cls=pw_class(ratio), quiet_pct=round(float(q.mean() * 100))))
        pw_idx.append((i0, i1))
    out["events"] = events
    out["baseline"] = round(base, 2)
    # error spectrum inside propwash windows vs normal flight
    if pw_idx:
        nper = 256
        seg = lambda idx: np.concatenate([np.asarray(c[f"setpoint[{ax}]"][sl][i:j] - c[f"gyroADC[{ax}]"][sl][i:j], np.float64) for i, j in idx for ax in (0, 1)])
        f, pp = welch(seg(pw_idx), fs, nper)
        normal = [(i, i + int(P["win"] * fs)) for i in np.flatnonzero(calm)[:: int(P["win"] * fs)][:200]]
        _, pn = welch(seg(normal), fs, nper)
        if f is not None and pn is not None:
            m = (f >= 5) & (f <= 200)
            out["spec"] = dict(f=f[m].round(1).tolist(), propwash=(10 * np.log10(pp[m] + 1e-9)).round(2).tolist(), normal=(10 * np.log10(pn[m] + 1e-9)).round(2).tolist())
            mm = (f >= max(20, P["flo"])) & (f <= P["fhi"])
            out["pw_freq"] = round(float(f[mm][np.argmax(pp[mm] - pn[mm])]), 1)
    # ---- findings ----
    # motors at their floor during the events: the mixer can't brake that side, no tune fixes that
    mk = [k for k in (f"motor%[{i}]" for i in range(8)) if k in c]
    floor_ev = None
    if pw_idx and mk:
        Mn = np.min([c[k][sl] for k in mk], axis=0)
        sel = np.concatenate([np.arange(i, j) for i, j in pw_idx])
        floor_ev = float(np.mean(Mn[sel] <= 1.0))
    out["floor_during_pw"] = None if floor_ev is None else round(floor_ev, 3)
    out["params"] = P
    if len(events) >= P["minev"]:
        med = float(np.median([e["ratio"] for e in events]))
        worst = max(events, key=lambda e: e["ratio"])
        lvl = "good" if med < 2 else "warning" if med < 3.5 else "serious"
        fq = out.get("pw_freq")
        acts = []
        if floor_ev is not None and floor_ev > 0.05:
            acts.append(f"During these chops a motor sat at its minimum {floor_ev * 100:.0f}% of the time, so the mixer couldn't slow it to correct: raise dyn_idle_min_rpm "
                        f"(now {hnum(h, 'dyn_idle_min_rpm', 0)[0]:.0f}) and/or thrust_linear (now {hnum(h, 'thrust_linear', 0)[0]:.0f})")
        rp = [(hnum(h, f"{a}PID", 0) + [0, 0, 0])[2] for a in ("roll", "pitch")]
        dm = (hnum(h, "d_max", 0) + [0, 0])[:2]
        if all(dm[k] <= rp[k] for k in range(2)):
            acts.append(f"D max is off (d_max = D): set d_max_roll/pitch ≈ 1.3× D ({round(rp[0] * 1.3)}/{round(rp[1] * 1.3)}) so damping rises only on fast changes like these")
        else:
            acts.append("More D max (+10–15%) raises damping on fast changes like these")
        acts.append("less filter delay helps too (Noise tab)")
        F.append(finding(lvl, f"Propwash: {med:.1f}× more wobble after throttle chops ({len(events)} chops)",
                         {"good": "The quad stays calm when it drops into its own prop wash.", "warning": "Noticeable wobble when dropping into dirty air.", "serious": "Strong wobble after throttle chops."}[lvl],
                         f"After each fast throttle drop (faster than {P['chop']:.0f} %/s), with the sticks still, the tracking error in the {P['flo']:.0f}–{P['fhi']:.0f} Hz band was compared with calm flight over {P['win']:.2f} s. Typical event {med:.1f}×, worst {worst['ratio']:.1f}× at {worst['t']:.1f} s. "
                         + (f"The extra wobble peaks around {fq:.0f} Hz. " if fq else ""),
                         ("In order: " + "; ".join(acts) + ".") if lvl != "good" else "", "More D → warmer motors; less filtering → more noise." if lvl != "good" else ""))
    elif events:
        F.append(finding("info", f"Only {len(events)} usable throttle chop{'s' if len(events) > 1 else ''}: too few to rate propwash",
                         f"Wobble after {'it' if len(events) == 1 else 'them'}: " + ", ".join(f"{e['ratio']:.1f}× at {e['t']:.0f} s" for e in events) + " (vs calm flight).",
                         f"A few chops can be dominated by wind or what the quad flew into. {P['minev']} or more give a usable typical value (set under Detection)."))
    else:
        F.append(finding("info", "No throttle chops found", "Propwash can't be judged from this part of the flight.",
                         "Propwash shows after quick throttle drops (dives, split-S, flips with throttle cut). Select a part with those moves."))
    if out.get("skipped"):
        F.append(finding("info", f"{out['skipped']} chop(s) left out: the sticks were moving",
                         "Only wobble with centred, still sticks counts as propwash.",
                         "When a flip, split-S or turn follows the throttle chop, the error in that window is mostly the tune's response to the move itself. "
                         f"Those chops are skipped; in the others only the moments with still sticks (and {P['skip']:.0f} ms after any stick movement faster than {P['stick']:.0f} °/s²) are scored."))
    lags = [out["axes"][str(a)].get("lag_ms") for a in range(3)]
    ok = [l for l in lags[:2] if l is not None]
    if ok:
        guide = round(6 + 2 * inch)
        lat = max(ok)
        lvl = "info"
        F.append(finding(lvl, "Stick-to-motion delay: " + ", ".join(f"{nm_} {l} ms" for nm_, l in zip(("roll", "pitch", "yaw"), lags) if l is not None),
                         "How long the quad takes to follow your sticks.",
                         "Time shift that best lines up the gyro with the setpoint during stick moves (cross-correlation). It adds up RC smoothing, filter delay, and how quickly the props can change speed; "
                         "bigger props are slower. Compare between flights and tunes rather than with other quads.",
                         "", ""))
    em = [out["axes"][str(a)].get("err_move") for a in range(3)]
    if any(e is not None for e in em):
        F.append(finding("info", "Tracking error during stick moves: " + ", ".join(f"{nm_} {e}" for nm_, e in zip(("roll", "pitch", "yaw"), em) if e is not None) + " °/s RMS",
                         "Average gap between what you asked and what the quad did.",
                         f"Calm flight: roll {out['axes']['0']['err_calm']}, pitch {out['axes']['1']['err_calm']}, yaw {out['axes']['2']['err_calm']} °/s. "
                         "Most of the gap during moves is the delay above; the rest is overshoot and wobble. Compare between tunes flown the same way."))
    out["findings"] = F
    return out
