"""Blackbox decoding (via orangebox), caching and analysis — numpy only."""
from pathlib import Path
import json
import numpy as np
from orangebox import Parser

KEY_HEADERS = ["Firmware revision", "Board information", "Craft name", "Log start datetime",
               "looptime", "pid_process_denom", "P interval", "rollPID", "pitchPID", "yawPID", "d_max", "ff_weight",
               "rates_type", "rc_rates", "rates", "rc_expo",
               "gyro_lpf1_type", "gyro_lpf1_static_hz", "gyro_lpf1_dyn_hz", "gyro_lpf2_type", "gyro_lpf2_static_hz", "gyro_notch_hz",
               "dterm_lpf1_type", "dterm_lpf1_static_hz", "dterm_lpf1_dyn_hz", "dterm_lpf2_type", "dterm_lpf2_static_hz", "dterm_notch_hz",
               "dyn_notch_count", "dyn_notch_q", "dyn_notch_min_hz", "dyn_notch_max_hz",
               "rpm_filter_harmonics", "rpm_filter_q", "rpm_filter_min_hz", "rpm_filter_weights", "motor_poles", "dshot_bidir",
               "motor_idle", "tpa_rate", "tpa_breakpoint", "anti_gravity_gain", "iterm_relax_cutoff", "feedforward_boost",
               "thrust_linear", "simplified_master_multiplier", "simplified_gyro_filter_multiplier", "simplified_dterm_filter_multiplier"]


# live progress of slow work, polled by the browser (/api/progress): key "file|sub" -> {task: {detail, frac, t0}}
import time as _time
PROGRESS = {}


def progress(name, idx, task, detail="", frac=None, done=False):
    d = PROGRESS.setdefault(f"{name}|{idx}", {})
    if done:
        d.pop(task, None)
        return
    cur = d.get(task)
    d[task] = {"detail": detail, "frac": None if frac is None else round(float(frac), 3), "t0": cur["t0"] if cur else _time.time()}


class Log:
    """One decoded sub-log: t (s, from 0), columns dict name->float32 array, headers dict."""

    def __init__(self, path: Path, idx: int = 1):
        self.path, self.idx = Path(path), idx
        cache = path.with_suffix(f".{idx}.npz")
        if cache.exists() and cache.stat().st_mtime > path.stat().st_mtime:
            z = np.load(cache, allow_pickle=False)
            self.headers = json.loads(str(z["_headers"]))
            self.cols = {k: z[k] for k in z.files if k != "_headers"}
        else:
            nm = Path(path).name
            progress(nm, idx, "decode", "Reading the log file", 0.0)
            p = Parser.load(str(path), idx)
            names = p.field_names
            rows, trunc = [], None
            it = p.frames()
            total = max(1, getattr(p.reader, "_frame_data_len", 0) or 1)
            while True:   # a log cut off by full flash / power loss ends in a broken frame: keep everything before it
                try:
                    f = next(it)
                except StopIteration:
                    break
                except Exception as e:
                    trunc = f"{type(e).__name__}: {e}"[:160]
                    break
                rows.append([np.nan if v == "" else v for v in f.data[:len(names)]])
                if len(rows) % 4000 == 0:
                    try:
                        fr = p.reader.tell() / total
                    except Exception:
                        fr = None
                    progress(nm, idx, "decode", f"Decoding frames · {len(rows) // 1000}k so far", None if fr is None else 0.02 + 0.88 * fr)
            if len(rows) < 2:
                raise ValueError(f"no decodable frames in sub-log {idx}" + (f" ({trunc})" if trunc else ""))
            progress(nm, idx, "decode", f"Tidying {len(rows) // 1000}k frames", 0.91)
            data = np.array(rows, dtype=np.float64)
            if len(data) > 2:   # a garbled last frame can carry a huge timestamp: drop non-monotonic tail
                tt = data[:, names.index("time")]
                good = np.r_[True, np.diff(tt) > 0] & (tt < tt[0] + 4 * 3600e6)
                if not good.all():
                    data = data[good]
                    tt = data[:, names.index("time")]
                    data = data[np.r_[True, np.diff(tt) > 0]]
            for j in range(data.shape[1]):  # slow (S) fields start blank → back-fill first value
                bad = np.isnan(data[:, j])
                if bad.any() and not bad.all():
                    data[bad, j] = data[~bad, j][0]
            self.headers = {k: ",".join(map(str, v)) if isinstance(v, (list, tuple)) else v
                            for k, v in p.headers.items() if not k.startswith("Field")}
            if trunc:
                self.headers["_truncated"] = trunc
            self.cols = {n: data[:, i].astype(np.float32) for i, n in enumerate(names)}
            self.cols["time"] = data[:, names.index("time")]  # keep µs precision
            progress(nm, idx, "decode", "Saving a cache so next time is instant", 0.95)
            tmp = cache.with_suffix(".tmp.npz")
            np.savez_compressed(tmp, _headers=json.dumps(self.headers), **self.cols)
            tmp.replace(cache)  # atomic: never read a half-written cache
        t = self.cols["time"].astype(np.float64)
        self.t = (t - t[0]) / 1e6
        self.fs = 1.0 / np.median(np.diff(self.t))
        self._clim = {}
        self._derive()
        progress(Path(path).name, idx, "decode", done=True)

    def _derive(self):
        c = self.cols
        lo, hi = (float(x) for x in str(self.headers.get("motorOutput", "48,2047")).split(",")[:2])
        for i in range(8):
            if f"motor[{i}]" in c:
                c[f"motor%[{i}]"] = np.clip((c[f"motor[{i}]"] - lo) / (hi - lo) * 100, 0, 100)
            if f"eRPM[{i}]" in c:  # eRPM/100 → mechanical Hz
                c[f"motorHz[{i}]"] = c[f"eRPM[{i}]"] * 100 / (int(self.headers.get("motor_poles", 14)) / 2) / 60
        if "setpoint[3]" in c:
            c["throttle%"] = c["setpoint[3]"] / 10.0
        elif "rcCommand[3]" in c:
            c["throttle%"] = (c["rcCommand[3]"] - 1000) / 10.0

    # ---------- helpers ----------
    def window(self, t0=None, t1=None):
        a = 0 if t0 is None else int(np.searchsorted(self.t, t0))
        b = len(self.t) if t1 is None else int(np.searchsorted(self.t, t1))
        return slice(a, max(b, a + 2))

    def meta(self):
        c, s = self.cols, {}
        s["duration_s"] = round(float(self.t[-1]), 1)
        s["log_rate_hz"] = round(float(self.fs))
        s["frames"] = len(self.t)
        if "throttle%" in c:
            s["avg_throttle_%"] = round(float(np.mean(c["throttle%"])), 1)
        mot = [c[k] for k in c if k.startswith("motor%")]
        if mot:
            s["max_motor_%"] = round(float(np.max(mot)), 1)
            s["motor_saturation_%"] = round(float(np.mean(np.max(mot, axis=0) >= 99.5) * 100), 2)
        if "throttle%" in c:
            s["thr_hist_s"] = (np.histogram(c["throttle%"], bins=10, range=(0, 100))[0] / self.fs).round(1).tolist()
        if "gyroADC[0]" in c:
            s["max_rate_dps"] = int(max(np.max(np.abs(c[f"gyroADC[{i}]"])) for i in range(3)))
        return {"stats": s, "fields": sorted(c), "headers": self.headers,
                "key_headers": {k: self.headers[k] for k in KEY_HEADERS if k in self.headers}}

    def series(self, fields, t0=None, t1=None, n=2000):
        """Min/max-envelope decimation so spikes survive downsampling."""
        sl = self.window(t0, t1)
        t = self.t[sl]
        step = max(1, len(t) // n)
        m = (len(t) // step) * step
        out = {}
        if step == 1:
            out["t"] = t.tolist()
            for f in fields:
                out[f] = self.cols[f][sl].round(2).tolist()
            return out
        tb = t[:m].reshape(-1, step)
        out["t"] = np.column_stack([tb[:, 0], tb[:, step // 2]]).ravel().tolist()
        for f in fields:
            y = self.cols[f][sl][:m].reshape(-1, step)
            mn, mx, amn = y.min(1), y.max(1), y.argmin(1) < y.argmax(1)
            out[f] = np.where(amn[:, None], np.column_stack([mn, mx]), np.column_stack([mx, mn])).ravel().round(2).tolist()
        return out

    # ---------- analysis ----------
    def _segments(self, x, nper, step):
        idx = np.arange(0, len(x) - nper + 1, step)[:, None] + np.arange(nper)
        return x[idx], idx

    def psd(self, field, t0=None, t1=None, nper=512):
        """Welch PSD in dB (numpy-only)."""
        x = self.cols[field][self.window(t0, t1)].astype(np.float64)
        if len(x) < nper:
            return {"f": [], "db": []}
        seg, _ = self._segments(x - x.mean(), nper, nper // 2)
        w = np.hanning(nper)
        p = (np.abs(np.fft.rfft(seg * w, axis=1)) ** 2).mean(0) / (self.fs * (w ** 2).sum())
        return {"f": np.fft.rfftfreq(nper, 1 / self.fs).round(2).tolist(), "db": (10 * np.log10(p + 1e-12)).round(2).tolist()}

    def _spec(self, field, mode, sl, nper, bins):
        x = self.cols[field][sl].astype(np.float64)
        hop = nper // 2 if mode == "time" else nper // 8  # dense hop → brief punch-outs still fill throttle bins
        seg, idx = self._segments(x, nper, hop)
        db = 10 * np.log10(np.abs(np.fft.rfft((seg - seg.mean(1, keepdims=True)) * np.hanning(nper), axis=1)) ** 2 + 1e-6)
        mot = [self.cols[k][sl] for k in self.cols if k.startswith("motorHz[")]
        m = np.mean(mot, axis=0)[idx].mean(1) if mot else None
        if mode == "time":  # average down to ≤ 600 rows to keep the payload small
            g = max(1, len(db) // 600)
            k = len(db) // g * g
            avg = lambda a: a[:k].reshape(-1, g, *a.shape[1:]).mean(1)
            return avg(self.t[sl][idx[:, nper // 2]]), avg(db), avg(m) if m is not None else None, np.full(k // g, g)
        b = np.clip((self.cols["throttle%"][sl][idx].mean(1) / 100 * bins).astype(int), 0, bins - 1)
        z, mh, cnt = np.full((bins, db.shape[1]), np.nan), np.full(bins, np.nan), np.bincount(b, minlength=bins)
        for i in np.unique(b):
            if cnt[i] >= 2:
                z[i] = db[b == i].mean(0)
                if m is not None:
                    mh[i] = m[b == i].mean()
        return (np.arange(bins) + 0.5) * 100 / bins, z, mh, cnt

    def spectrogram(self, field, mode="throttle", t0=None, t1=None, nper=256, bins=50):
        nper = int(min(2048, max(32, 2 ** round(np.log2(nper)))))
        """Noise heatmap, rows = throttle bins (always 0–100%) or time, cols = frequency.
        auto_clim comes from raw gyro so every source shares one colour scale."""
        sl = self.window(t0, t1)
        y, z, mh, cnt = self._spec(field, mode, sl, nper, bins)
        key = (mode, sl.start, sl.stop, nper)  # one auto colour scale per window & resolution: raw gyro, all axes
        if key not in self._clim:
            v = np.concatenate([r[np.isfinite(r)] for r in (self._spec(f"gyroUnfilt[{i}]", mode, sl, nper, bins)[1] for i in range(3))])
            self._clim[key] = [round(float(np.percentile(v, 2)), 1), round(float(np.percentile(v, 99.0)), 1)] if v.size else None
        nn = lambda a: np.where(np.isfinite(a), np.round(a, 1), None).tolist()
        return {"y": np.round(y, 3).tolist(), "f": np.fft.rfftfreq(nper, 1 / self.fs).round(1).tolist(), "z": nn(z),
                "motor_hz": nn(mh) if mh is not None else None, "count": cnt.tolist(),
                "auto_clim": self._clim[key]}

    def step_response(self, t0=None, t1=None, win_s=2.0, resp_s=0.5, min_sp=20.0, max_sp=2000.0,
                      thr_min=0.0, thr_max=100.0, reg=1e-4, n_curves=30, prop=None, blades=None, src="gyroADC"):
        """Wiener deconvolution of gyro vs setpoint per window; median + IQR, metrics and advice.
        A window is used when its peak stick rate is within [min_sp, max_sp] °/s and mean throttle within [thr_min, thr_max] %."""
        from tuning import step_metrics, step_advice, step_reliability
        sl = self.window(t0, t1)
        nper, nresp = int(win_s * self.fs), int(resp_s * self.fs)
        f, w = np.fft.rfftfreq(nper, 1 / self.fs), np.hanning(nper)
        t_ms = np.arange(nresp) / self.fs * 1000
        out = {"t_ms": t_ms.round(2).tolist()}
        thr = self.cols["throttle%"][sl]
        rng = np.random.default_rng(0)
        for ax in range(3):
            sp, gy = (self.cols[f"{k}[{ax}]"][sl].astype(np.float64) for k in ("setpoint", src if f"{src}[{ax}]" in self.cols else "gyroADC"))
            out[str(ax)] = None
            if len(sp) < nper:
                continue
            S, idx = self._segments(sp, nper, nper // 4)
            pk, th = np.abs(S).max(1), thr[idx].mean(1)
            keep = (pk >= min_sp) & (pk <= max_sp) & (th >= thr_min) & (th <= thr_max)
            seg_t = self.t[sl][idx[:, 0]]
            if keep.sum() < 3:
                out[str(ax)] = {"n": int(keep.sum()), "seg_t": seg_t.round(2).tolist(), "seg_used": keep.tolist(), "seg_stick": pk.round(0).tolist()}
                continue
            S, G = S[keep], gy[idx][keep]
            X = np.fft.rfft((S - S.mean(1, keepdims=True)) * w, axis=1)
            Y = np.fft.rfft((G - G.mean(1, keepdims=True)) * w, axis=1)
            lam = reg * (np.abs(X) ** 2).mean(1, keepdims=True) * (1 + (f / 50) ** 2)  # damp HF noise
            steps = np.cumsum(np.fft.irfft(X.conj() * Y / (np.abs(X) ** 2 + lam), n=nper, axis=1)[:, :nresp], axis=1)
            q25, med, q75 = np.percentile(steps, [25, 50, 75], axis=0)
            m = step_metrics(t_ms, med, q25, q75)
            rel = step_reliability(t_ms, steps, m, ax, rng)
            verdict, adv = step_advice(ax, m, int(len(steps)), self.headers, self.profile(prop, blades), rel)
            pick = rng.choice(len(steps), min(n_curves, len(steps)), replace=False)
            seg_peak = np.full(len(keep), np.nan)
            seg_peak[keep] = steps[:, : int(0.25 * self.fs)].max(1)
            out[str(ax)] = {"median": med.round(4).tolist(), "q25": q25.round(4).tolist(), "q75": q75.round(4).tolist(),
                            "n": int(len(steps)), "metrics": m, "reliability": rel, "verdict": verdict, "findings": adv,
                            "curves": steps[pick][:, ::2].round(3).tolist(), "seg_t": seg_t.round(2).tolist(),
                            "seg_used": keep.tolist(), "seg_peak": np.where(np.isfinite(seg_peak), seg_peak.round(3), None).tolist(),
                            "seg_stick": pk.round(0).tolist()}
        # PID suggestions (D-term noise decides whether "more D" is allowed)
        from tuning import pid_suggest, welch, band_rms
        from tuning import noise_budget, D_NOISY
        nb = noise_budget(self, sl)
        d_noisy = bool(nb and nb["d_frac"] >= D_NOISY)
        out["src"] = src
        # suggestions only from filtered gyro: what the PID loop acts on, and far less estimation noise than raw
        out["pid"] = pid_suggest({ax: out[str(ax)] for ax in range(3) if out[str(ax)]}, self.headers, self.profile(prop, blades), d_noisy) if src == "gyroADC" else None
        return out

    def playback(self, rate=250.0):
        """Block-averaged channels for the animated viewers (float32, channel-major).
        Block means make gyro integration exact (∫ω dt over each block) and keep the payload small."""
        c = self.cols
        k = max(1, int(round(self.fs / rate)))
        n = len(self.t) // k
        blk = lambda x: np.asarray(x[: n * k], np.float64).reshape(n, k).mean(1)
        one_g = float(self.headers.get("acc_1G", 2048) or 2048)
        chans = {"t": blk(self.t)}
        for i in range(3):
            chans[f"gyro[{i}]"] = blk(c[f"gyroADC[{i}]"])
            chans[f"gyroRaw[{i}]"] = blk(c[f"gyroUnfilt[{i}]"]) if f"gyroUnfilt[{i}]" in c else chans[f"gyro[{i}]"]
            chans[f"acc[{i}]"] = blk(c[f"accSmooth[{i}]"]) / one_g if f"accSmooth[{i}]" in c else np.zeros(n) + (i == 2)
            chans[f"sp[{i}]"] = blk(c[f"setpoint[{i}]"])
        # physically scaled motion for the 3D viewer, integrated in the frequency domain at the full log rate:
        #   wobble = rotation angle (rad) above 3 Hz, from the gyro (what attitude integration already contains)
        #   shake  = body displacement (m) above 8 Hz, from the accelerometer (vibration only: manoeuvres and the
        #            gravity vector rotating with attitude live below that and would otherwise dominate)
        for i in range(3):
            chans[f"wob[{i}]"] = blk(_band_int(c[f"gyroADC[{i}]"] * np.pi / 180, self.fs, 3.0, 1))
            chans[f"wobRaw[{i}]"] = blk(_band_int(c[f"gyroUnfilt[{i}]"] * np.pi / 180, self.fs, 3.0, 1)) if f"gyroUnfilt[{i}]" in c else chans[f"wob[{i}]"]
            chans[f"disp[{i}]"] = blk(_band_int(c[f"accSmooth[{i}]"] / one_g * 9.81, self.fs, 8.0, 2)) if f"accSmooth[{i}]" in c else np.zeros(n)
        chans["thr"] = blk(c["throttle%"])
        nm = 0
        for i in range(8):
            if f"motor%[{i}]" in c:
                chans[f"m%[{i}]"] = blk(c[f"motor%[{i}]"]); nm += 1
                chans[f"mHz[{i}]"] = blk(c[f"motorHz[{i}]"]) if f"motorHz[{i}]" in c else np.zeros(n)
        names = list(chans)
        return names, n, nm, np.stack([chans[k] for k in names]).astype(np.float32).tobytes()

    def profile(self, prop=None, blades=None):
        """Prop estimate (cached) + the size actually used (user value wins) + size-dependent reference values."""
        import quad
        if not hasattr(self, "_est"):
            self._est = quad.estimate(self)
        e = self._est
        inch = prop or e.get("inch") or 5.0
        bl = int(blades or e.get("blades") or 3)
        sp = quad.size_params(inch, bl)
        return {"estimate": e, "used": {"inch": inch, "blades": bl, "source": "user" if prop else "estimate"}, "params": sp,
                "compare": quad.compare_settings(self.headers, sp)}

    def motors(self, t0=None, t1=None, thr_min=0.0, thr_max=100.0):
        from motors import motor_report
        return motor_report(self, t0, t1, thr_min, thr_max)

    def noise(self, t0=None, t1=None, prop=None, blades=None, **kw):
        from tuning import noise_report
        return noise_report(self, t0, t1, prof=self.profile(prop, blades), **kw)

    def flight(self, kind, t0=None, t1=None, prop=None, blades=None, **kw):
        import flight
        fn = {"pidterms": flight.pid_report, "motorout": flight.motor_out_report, "propwash": flight.propwash_report}[kind]
        return fn(self, t0, t1, prof=self.profile(prop, blades), **(kw if kind == "propwash" else {}))

    def simmodel(self, prop=None, blades=None):
        """Identified closed-loop model for the PID simulator (slow: cached per prop size)."""
        import sim
        key = (prop, blades)
        if getattr(self, "_sim", (None, None))[0] != key:
            self._sim = (key, sim.model_report(self, self.profile(prop, blades)))
        return self._sim[1]

    def filterplan(self, t0=None, t1=None, prop=None, blades=None, **kw):
        from tuning import filter_plan
        return filter_plan(self, t0, t1, prof=self.profile(prop, blades), res_kw=kw)

    def resonances(self, t0=None, t1=None, **kw):
        from tuning import resonances
        return resonances(self, t0, t1, **kw)

def _band_int(x, fs, lo, order):
    """Integrate `order` times in the frequency domain, keeping only content above `lo` Hz (smooth taper 0.75–1.25·lo)."""
    from tuning import _fastlen
    x = np.asarray(x, np.float64)
    n = len(x); N = _fastlen(n)
    X = np.fft.rfft(x - x.mean(), N)
    f = np.fft.rfftfreq(N, 1 / fs)
    H = np.zeros(len(f), complex)
    nz = f > 0
    H[nz] = np.clip((f[nz] - 0.75 * lo) / (0.5 * lo), 0, 1) / (2j * np.pi * f[nz]) ** order
    return np.fft.irfft(X * H, N)[:n]


def list_logs(folder: Path):
    out = []
    for p in sorted(folder.glob("*"), key=lambda p: -p.stat().st_mtime):
        if p.suffix.lower() in (".bbl", ".bfl", ".txt"):
            with open(p, "rb") as fh:
                n = fh.read().count(b"H Product:Blackbox flight data recorder")
            out.append({"name": p.name, "size_mb": round(p.stat().st_size / 1e6, 1), "logs": n})
    return out
