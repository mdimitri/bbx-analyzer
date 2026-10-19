"""Compiled inner loops for the closed-loop simulator (sim.py). Optional: with numba installed the per-sample loops run
as machine code, one lane per thread (≈50–100× faster); without it sim.py falls back to its numpy version. Both compute
the same thing in the same order of operations (tests/test_simcore.py checks they agree).

Filter stages are flattened to "sections" with one row per lane:
  kind 0  PT1        s += k·(x − s)                     (PT2 / PT3 = 2 / 3 PT1 sections, as Betaflight runs them)
  kind 1  biquad     y = b0·x + b1·x1 + b2·x2 − a1·y1 − a2·y2, output y          (low-pass)
  kind 2  biquad     same, output x + w·(y − x)                                    (notch, RPM-notch fade weight w)
  per-lane "off" flag: output x (centre at or above 0.45·fs), the state still runs, as in sim.Stage
"""
import os
import numpy as np

try:
    if os.environ.get("BBX_NO_JIT"):
        raise ImportError("disabled by BBX_NO_JIT")
    import numba
    HAVE = True
except Exception:          # not installed, or no wheel for this platform
    numba = None
    HAVE = False


def pack(stages, L):
    """sim.Stage list → (kind[n], coef[L,n,6], state[L,n,4], off[L,n]); coef: b0 b1 b2 a1 a2 w (PT1: k first)."""
    K, C, Z, O = [], [], [], []
    for q in stages:
        if q.st["k"] == "pt":
            k = np.broadcast_to(np.asarray(q.kk, float), (L,))
            for s in q.s:
                c = np.zeros((6, L)); c[0] = k
                z = np.zeros((4, L)); z[2] = s                # PT state lives in the y1 slot
                K.append(0); C.append(c); Z.append(z); O.append(np.zeros(L, bool))
        else:
            c = np.zeros((6, L))
            for i, v in enumerate(list(q.b) + list(q.a) + [q.w]):
                c[i] = np.broadcast_to(np.asarray(v, float), (L,))
            K.append(2 if q.st["type"] == "notch" else 1); C.append(c)
            Z.append(np.stack([q.x1, q.x2, q.y1, q.y2]).astype(float)); O.append(np.broadcast_to(np.asarray(q.off, bool), (L,)).copy())
    n = len(K)
    if not n:
        return np.zeros(0, np.int64), np.zeros((L, 0, 6)), np.zeros((L, 0, 4)), np.zeros((L, 0), np.bool_)
    # lane-major (L, n, ·): each thread walks its own contiguous block
    return (np.array(K, np.int64), np.ascontiguousarray(np.stack(C).transpose(2, 0, 1)), np.ascontiguousarray(np.stack(Z).transpose(2, 0, 1)),
            np.ascontiguousarray(np.stack(O).T))


if HAVE:
    @numba.njit(cache=True, nogil=True, inline="always")
    def _sec(kind, coef, state, offm, i, l, x):
        kd = kind[i]
        if kd == 0:
            s = state[l, i, 2]
            s += coef[l, i, 0] * (x - s)
            state[l, i, 2] = s
            return s
        y = coef[l, i, 0] * x + coef[l, i, 1] * state[l, i, 0] + coef[l, i, 2] * state[l, i, 1] - coef[l, i, 3] * state[l, i, 2] - coef[l, i, 4] * state[l, i, 3]
        state[l, i, 1] = state[l, i, 0]; state[l, i, 0] = x; state[l, i, 3] = state[l, i, 2]; state[l, i, 2] = y
        if offm[l, i]:                     # centre at or above 0.45·fs: the stage passes its input
            return x
        if kd == 1:
            return y
        return x + coef[l, i, 5] * (y - x)

    @numba.njit(cache=True, nogil=True)
    def cascade(x, kind, coef, state, offm):
        """One lane (lane 0) through a section cascade."""
        y = np.empty(len(x))
        for k in range(len(x)):
            v = x[k]
            for i in range(len(kind)):
                v = _sec(kind, coef, state, offm, i, 0, v)
            y[k] = v
        return y

    @numba.njit(cache=True, nogil=True)
    def pt_run(x, k, order):
        y = x.copy()
        for _ in range(order):
            s = y[0]
            for i in range(len(y)):
                s += k * (y[i] - s); y[i] = s
        return y

    @numba.njit(cache=True, parallel=True, nogil=True)
    def biquad_rows(z, b0, b1, b2, a1, a2):
        """Direct-form-I biquad over each row of z, state started at the row's first value (lp_zero's run())."""
        R, N = z.shape
        y = np.empty_like(z)
        for r in numba.prange(R):
            x1 = z[r, 0]; x2 = z[r, 0]; y1 = z[r, 0]; y2 = z[r, 0]
            for k in range(N):
                v = z[r, k]
                o = b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
                x2 = x1; x1 = v; y2 = y1; y1 = o; y[r, k] = o
        return y

    @numba.njit(cache=True, parallel=True, nogil=True)
    def loop(gk, gc, gs, go, dk, dc, ds, do, sp, F, kp, kd, kdmax, ki, lim, ilim, yk, ys, relk, relax, relax_type,
             sgain, dgain, k85, k35, buf, H, dl, trim, m, kt, b, a, lam, w0, I0, fs):
        """sim.closed_loop's per-sample loop, lanes in parallel. Returns the simulated filtered gyro (L × W)."""
        L, W = sp.shape
        out = np.empty((L, W))
        for l in numba.prange(L):
            w = w0[l]; I = I0[l]; rl = sp[l, 0]; spprev = sp[l, 0]; mm = m[l]
            dprev = 0.0; first = True
            b1a = 0.0; b1b = 0.0; b2a = 0.0; b2b = 0.0; yst = ys[l]
            for k in range(W):
                gf = w
                for i in range(len(gk)):
                    gf = _sec(gk, gc, gs, go, i, l, gf)
                df = gf
                for i in range(len(dk)):
                    df = _sec(dk, dc, ds, do, i, l, df)
                if first:
                    dprev = df; first = False
                dgd = (df - dprev) * fs; dprev = df
                e = sp[l, k] - gf
                pterm = kp[l] * e
                if yk > 0.0:
                    yst += yk * (pterm - yst); pterm = yst
                rl += relk * (sp[l, k] - rl)
                if relax:
                    hp = abs(sp[l, k] - rl)
                    if relax_type == 0:
                        xx = rl - gf
                        eI = 0.0 if abs(xx) < hp else xx - np.sign(xx) * hp
                    else:
                        eI = e * max(0.0, 1 - hp / 40)
                else:
                    eI = e
                I = min(max(I + ki * eI / fs, -ilim), ilim)
                sfac = abs((sp[l, k] - spprev) * fs) * sgain; spprev = sp[l, k]
                b1a += k85 * (dgd - b1a); b1b += k85 * (b1a - b1b)
                v = max(abs(b1b) * dgain, sfac)
                b2a += k35 * (v - b2a); b2b += k35 * (b2a - b2b)
                boost = min(1.0, b2b)
                u = min(max(pterm + I - (kd[l] + (kdmax[l] - kd[l]) * boost) * dgd + F[l, k], -lim), lim)
                buf[l, H + k] = u
                ud = buf[l, H + k - dl[l]] - trim[l]
                mm += kt[l] * (ud - mm)
                w = w + (b[l] * (mm + lam[l] * (ud - mm)) - a[l] * w) / fs
                out[l, k] = gf
        return out


def warmup():
    """Compile (or load from numba's cache) every kernel on tiny inputs, so the first real analysis doesn't wait for it.
    Run in a background thread when the server starts."""
    if not HAVE:
        return
    try:
        L, W = 1, 4
        k = np.zeros(1, np.int64); c = np.zeros((L, 1, 6)); c[:, :, 0] = 0.5; z = np.zeros((L, 1, 4)); o = np.zeros((L, 1), np.bool_)
        f = np.ones(L)
        loop(k, c, z.copy(), o, k, c, z.copy(), o, np.zeros((L, W)), np.zeros((L, W)), f, f, f, 0.1, 500.0, 400.0, 0.0, f, 0.1, True, 0, 0.0, 0.0,
             0.1, 0.1, np.zeros((L, W + 3)), 2, np.ones(L, np.int64), f, f, f, f, f, f, f, f, 1000.0)
        cascade(np.zeros(W), k, np.zeros((1, 1, 6)), np.zeros((1, 1, 4)), np.zeros((1, 1), np.bool_))
        pt_run(np.zeros(W), 0.1, 2)
        biquad_rows(np.zeros((2, W)), 0.1, 0.2, 0.1, -0.5, 0.2)
    except Exception:
        pass
