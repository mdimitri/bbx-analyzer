// PID tuning simulator: the quad's own dynamics (identified from this log, see sim.py) closed with a Betaflight-accurate
// PID controller and filter chain. Everything runs here at the flight controller's PID loop rate, so edits update live.
const SIMK = { KP: 0.032029, KI: 0.244381, KD: 0.000529, KF: 0.013754 };
const PTC = { 1: 1, 2: 1.553773974, 3: 1.961459177 };
const SIMAX = ["roll", "pitch", "yaw"];
const SIMV = { view: store.get("sim.view", "step"), step: store.get("sim.step", 300), noise: store.get("sim.noise", true), gmul: 1, dmul: 1, gains: null, M: null, key: null };

// ---------- filters (time domain + frequency response, identical to Betaflight's filter.c) ----------
function mkStage(st, fs, mul = 1) {
  if (st.k === "pt") {
    const om = 2 * Math.PI * st.fc * mul * PTC[st.order] / fs, k = om / (om + 1), s = new Float64Array(st.order);
    return { f: x => { for (let i = 0; i < s.length; i++) { s[i] += k * (x - s[i]); x = s[i]; } return x; }, reset: v => s.fill(v),
             H: z1 => { let h = { re: 1, im: 0 }; const one = cdiv({ re: k, im: 0 }, csub({ re: 1, im: 0 }, cmul({ re: 1 - k, im: 0 }, z1))); for (let i = 0; i < st.order; i++) h = cmul(h, one); return h; } };
  }
  const fc = st.type === "lpf" ? st.fc * mul : st.fc, off = fc >= fs * 0.45, w0 = 2 * Math.PI * Math.min(fc, fs * 0.45) / fs, al = Math.sin(w0) / (2 * st.q), cs = Math.cos(w0), a0 = 1 + al;
  const b = st.type === "lpf" ? [(1 - cs) / 2 / a0, (1 - cs) / a0, (1 - cs) / 2 / a0] : [1 / a0, -2 * cs / a0, 1 / a0], a = [-2 * cs / a0, (1 - al) / a0], w = st.w ?? 1;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  return { f: x => { if (off) return x; const y = b[0] * x + b[1] * x1 + b[2] * x2 - a[0] * y1 - a[1] * y2; x2 = x1; x1 = x; y2 = y1; y1 = y; return st.type === "notch" ? x + w * (y - x) : y; },
           reset: v => { x1 = x2 = v; y1 = y2 = v; },
           H: z1 => { if (off) return { re: 1, im: 0 }; const z2 = cmul(z1, z1);
             const h = cdiv(cadd(cadd({ re: b[0], im: 0 }, cscale(z1, b[1])), cscale(z2, b[2])), cadd(cadd({ re: 1, im: 0 }, cscale(z1, a[0])), cscale(z2, a[1])));
             return st.type === "notch" ? cadd({ re: 1 - w, im: 0 }, cscale(h, w)) : h; } };
}
const cadd = (a, b) => ({ re: a.re + b.re, im: a.im + b.im }), csub = (a, b) => ({ re: a.re - b.re, im: a.im - b.im });
const cmul = (a, b) => ({ re: a.re * b.re - a.im * b.im, im: a.re * b.im + a.im * b.re }), cscale = (a, k) => ({ re: a.re * k, im: a.im * k });
const cdiv = (a, b) => { const d = b.re * b.re + b.im * b.im; return { re: (a.re * b.re + a.im * b.im) / d, im: (a.im * b.re - a.re * b.im) / d }; };
const cabs = a => Math.hypot(a.re, a.im), cexpj = p => ({ re: Math.cos(p), im: Math.sin(p) });
const pt1k = (fc, fs) => { const om = 2 * Math.PI * fc / fs; return om / (om + 1); };

// ---------- closed-loop time simulation of one axis ----------
// Mirror of sim.py closed_loop(). Plant: dω/dt = b·(m + λ·(u_d − m)) − a·ω, τ·dm/dt = u_d − m, u_d = u(t − delay) − trim.
// inp: { sp: Float64Array (stick setpoint before RC smoothing, or already-smoothed logged setpoint with smoothed:true),
//        dist: optional torque disturbance (°/s² at each step), noise: optional measured noise (°/s, log rate),
//        F: optional logged feedforward (log rate, scaled by the FF gain ratio), w0, I0, P0, m0, uhist, trim, kp_mul, kd_mul }
const gainMul = (pl, C) => ({ p: pl.kp_mul ?? C.tpa_p, d: pl.kd_mul ?? C.tpa_d });
function simAxis(ax, g, inp, o = {}) {
  const M = SIMV.M, pl = M.axes[SIMAX[ax]], C = M.ctl, fs = C.fs_pid, T = 1 / fs, n = inp.sp.length;
  const G = M.filters.gyro.map(s => mkStage(s, fs, o.gmul ?? SIMV.gmul)), D = M.filters.dterm.map(s => mkStage(s, fs, o.dmul ?? SIMV.dmul));
  const w0 = inp.w0 || 0; G.forEach(s => s.reset(w0)); D.forEach(s => s.reset(w0));
  const gm = gainMul(pl, C), pm = inp.kp_mul ?? gm.p, dmul = inp.kd_mul ?? gm.d;
  const kp = SIMK.KP * g.P * pm, ki = SIMK.KI * g.I, kd = SIMK.KD * g.D * dmul, kdm = SIMK.KD * Math.max(g.D, g.Dmax) * dmul, kf = SIMK.KF * g.FF / 100;
  const lim = C.limit[ax], ilim = C.iterm_limit || 400, lam = pl.lam || 0;
  const rcK = pt1k(C.rc_hz * PTC[3], fs), relK = pt1k(C.relax_hz, fs), yawK = ax === 2 && C.yaw_lp > 0 ? pt1k(C.yaw_lp, fs) : 1;
  const b1 = pt1k(85 * PTC[2], fs), b2 = pt1k(35 * PTC[2], fs), dgain = 0.00008 * C.dmax_gain / 35, sgain = 0.00008 * C.dmax_gain * C.dmax_adv / 100 / 35;
  const dN = Math.max(0, Math.round(pl.delay_ms / 1000 * fs)), kt = 1 - Math.exp(-T / (pl.tau_ms / 1000)), trim = inp.trim || 0;
  // delay line: oldest first. From a log the PID sums just before the start fill it, otherwise the starting output
  const buf = new Float64Array(dN + 1).fill(inp.u0 ?? trim);
  if (inp.uhist && inp.uhist.length) { const fl = M.fs_log, uh = inp.uhist;
    for (let j = 0; j <= dN; j++) { const back = Math.round((dN - j + 1) / fs * fl); buf[j] = uh[Math.max(0, uh.length - Math.max(1, back))]; } }
  let w = w0, m = inp.m0 ?? (inp.u0 ?? trim) - trim, I = inp.I0 || 0, dprev = w0, r1 = inp.sp[0], r2 = r1, r3 = r1, rl = r1, ffprev = r1, yp = inp.P0 || 0, bb = [0, 0, 0, 0];
  const out = { gyro: new Float64Array(n), w: new Float64Array(n), u: new Float64Array(n), sp: new Float64Array(n), P: new Float64Array(n), D: new Float64Array(n), I: new Float64Array(n), F: new Float64Array(n) };
  const nz = inp.noise, nr = inp.noiseRate || 1000, Fl = inp.F, fl = M.fs_log, fr = SIMV.cur && SIMV.cur[SIMAX[ax]].FF ? g.FF / SIMV.cur[SIMAX[ax]].FF : 1;
  for (let k = 0; k < n; k++) {
    // RC smoothing (PT3) of the stick → setpoint; the logged setpoint is already smoothed
    let sp;
    if (inp.smoothed) sp = inp.sp[k]; else { r1 += rcK * (inp.sp[k] - r1); r2 += rcK * (r1 - r2); r3 += rcK * (r2 - r3); sp = r3; }
    let meas = w;
    if (nz) { const x = (k * T * nr) % (nz.length - 1), i = x | 0; meas += nz[i] + (nz[i + 1] - nz[i]) * (x - i); }
    let gf = meas; for (const s of G) gf = s.f(gf);
    let df = gf; for (const s of D) df = s.f(df);
    const e = sp - gf;
    let P = kp * e; if (yawK < 1) { yp += yawK * (P - yp); P = yp; }
    // I-term relax (roll/pitch): stops I from winding up while the setpoint moves
    let eI = e;
    rl += relK * (sp - rl);
    if (C.relax >= 1 && ax < 2) { const hp = Math.abs(sp - rl);
      if (C.relax_type === 0) { const x = rl - gf; eI = Math.abs(x) < hp ? 0 : x - Math.sign(x) * hp; } else eI = e * Math.max(0, 1 - hp / 40); }
    I = Math.max(-ilim, Math.min(ilim, I + ki * eI * T));
    // D on measurement with D-max boost (gyro acceleration and setpoint change)
    const dgd = (df - dprev) * fs; dprev = df;
    bb[0] += b1 * (dgd - bb[0]); bb[1] += b1 * (bb[0] - bb[1]);
    const sfac = Math.abs((sp - ffprev) * fs) * sgain, boost = Math.max(Math.abs(bb[1]) * dgain, sfac);
    bb[2] += b2 * (boost - bb[2]); bb[3] += b2 * (bb[2] - bb[3]);
    const Dt = -(kd + (kdm - kd) * Math.min(1, bb[3])) * dgd;
    // feedforward: the logged one when replaying a flight (exact, scaled by the FF gain change), else from the setpoint
    let F;
    if (Fl) { const x = k * T * fl, i = Math.min(Fl.length - 2, x | 0); F = (Fl[i] + (Fl[i + 1] - Fl[i]) * Math.min(1, x - i)) * fr; } else F = kf * (sp - ffprev) * fs;
    ffprev = sp;
    let u = P + I + Dt + F; u = Math.max(-lim, Math.min(lim, u));
    // plant: delay → motor/prop lag → rate (yaw: part of the torque comes straight from the props spinning up)
    buf.copyWithin(0, 1); buf[dN] = u;
    const ud = buf[0] - trim;
    m += kt * (ud - m);
    w += (pl.b * (m + lam * (ud - m)) - pl.a * w + (inp.dist ? inp.dist[k] : 0)) * T;
    if (!isFinite(w) || Math.abs(w) > 1e5) { out.unstable = true; for (let j = k; j < n; j++) out.gyro[j] = out.w[j] = NaN; break; }
    out.gyro[k] = gf; out.w[k] = w; out.u[k] = u; out.sp[k] = sp; out.P[k] = P; out.I[k] = I; out.D[k] = Dt; out.F[k] = F;
  }
  return out;
}

// ---------- linear loop analysis: margins and sensitivity ----------
function loopAnalysis(ax, g, useDmax = false) {
  const M = SIMV.M, pl = M.axes[SIMAX[ax]], C = M.ctl, fs = C.fs_pid, T = 1 / fs;
  const G = M.filters.gyro.map(s => mkStage(s, fs, SIMV.gmul)), D = M.filters.dterm.map(s => mkStage(s, fs, SIMV.dmul));
  const gmu = gainMul(pl, C), kp = SIMK.KP * g.P * gmu.p, ki = SIMK.KI * g.I, kd = SIMK.KD * (useDmax ? Math.max(g.D, g.Dmax) : g.D) * gmu.d;
  const f = [], mag = [], ph = [], S = [];
  let prevPh = null, pm = null, gm = null, fc = null, f180 = null, ms = 0, fms = 0;
  for (let i = 0; i < 360; i++) {
    const fr = 0.5 * Math.pow((fs * 0.45) / 0.5, i / 359), om = 2 * Math.PI * fr, z1 = cexpj(-om * T);
    let Gg = { re: 1, im: 0 }; for (const s of G) Gg = cmul(Gg, s.H(z1));
    let Gd = Gg; for (const s of D) Gd = cmul(Gd, s.H(z1));
    const one = { re: 1, im: 0 }, dz = csub(one, z1);
    let Pp = { re: kp, im: 0 }; if (ax === 2 && C.yaw_lp > 0) { const k = pt1k(C.yaw_lp, fs); Pp = cscale(cdiv({ re: k, im: 0 }, csub(one, cscale(z1, 1 - k))), kp); }
    const Cfb = cadd(cadd(cmul(Pp, Gg), cscale(cdiv(one, dz), ki * T)), cmul(cscale(dz, kd * fs), Gd));
    // plant (continuous) incl. delay, motor lag, rate damping, + one PID loop of computation delay
    const s = { re: 0, im: om }, tau = pl.tau_ms / 1000, lead = cadd(one, cscale(s, (pl.lam || 0) * tau));   // (1 + λτs)/(τs + 1): yaw spin-up torque
    const Gp = cdiv(cmul(cscale(cexpj(-om * (pl.delay_ms / 1000 + 1.5 * T)), pl.b), lead), cmul(cadd(one, cscale(s, tau)), cadd(s, { re: pl.a, im: 0 })));
    const L = cmul(Gp, Cfb), Lm = cabs(L);
    let p = Math.atan2(L.im, L.re) * 180 / Math.PI;
    if (prevPh != null) { while (p - prevPh > 180) p -= 360; while (p - prevPh < -180) p += 360; }
    if (i === 0) while (p > 0) p -= 360;
    const Sv = 1 / cabs(cadd(one, L));
    if (i && fc == null && mag[i - 1] >= 1 && Lm < 1) { fc = fr; pm = 180 + p; }
    if (i && f180 == null && ph[i - 1] > -180 && p <= -180) { f180 = fr; gm = -20 * Math.log10(Lm); }
    if (Sv > ms) { ms = Sv; fms = fr; }
    f.push(fr); mag.push(Lm); ph.push(p); S.push(Sv); prevPh = p;
  }
  return { f, mag, ph, S, pm, gm, fc, f180, ms, fms };
}

// ---------- test signals ----------
function stepInput(ax, amp, dur = 0.5) {
  const fs = SIMV.M.ctl.fs_pid, n = Math.round(dur * fs), sp = new Float64Array(n), t0 = 0.01 * fs, rr = 0.02 * fs;   // 20 ms stick flick
  for (let k = 0; k < n; k++) sp[k] = k < t0 ? 0 : k < t0 + rr ? amp * (k - t0) / rr : amp;
  return { sp };
}
function impulseInput(dur = 0.5) {   // a torque kick that would spin the free quad up by 100 °/s in 5 ms (propwash / gust-like hit)
  const fs = SIMV.M.ctl.fs_pid, n = Math.round(dur * fs), dist = new Float64Array(n), k0 = Math.round(0.01 * fs), kn = Math.round(0.005 * fs);
  for (let k = k0; k < k0 + kn; k++) dist[k] = 100 / 0.005;
  return { sp: new Float64Array(n), dist };
}
function replayInput(ax) {
  const v = SIMV.M.axes[SIMAX[ax]].val; if (!v) return null;
  const fs = SIMV.M.ctl.fs_pid, fl = SIMV.M.fs_log, n = Math.floor((v.sp.length - 1) / fl * fs), sp = new Float64Array(n);
  for (let k = 0; k < n; k++) { const x = k / fs * fl, i = x | 0; sp[k] = v.sp[i] + (v.sp[i + 1] - v.sp[i]) * (x - i); }
  return { sp, smoothed: true, w0: v.gyro0, I0: v.I0, P0: v.P0, m0: v.m0, uhist: v.uhist, trim: v.trim, F: v.F, kp_mul: v.kp_mul, kd_mul: v.kd_mul };
}

// ---------- metrics ----------
function stepMetrics(o, amp) {
  const fs = SIMV.M.ctl.fs_pid, y = o.gyro, n = y.length, t0 = 0.01;
  if (o.unstable) return { unstable: true };
  const k0 = Math.round(t0 * fs); let k10 = -1, k90 = -1, pk = -1e9, kpk = 0;
  for (let k = k0; k < n; k++) { const v = y[k] / amp; if (k10 < 0 && v >= 0.1) k10 = k; if (k90 < 0 && v >= 0.9) k90 = k; if (v > pk) { pk = v; kpk = k; } }
  let ks = n - 1; for (let k = n - 1; k >= k0; k--) if (Math.abs(y[k] / amp - 1) > 0.05) { ks = k; break; }
  let osc = 0, prev = 0; for (let k = kpk; k < n; k++) { const e = y[k] / amp - 1, s = Math.sign(e); if (s && prev && s !== prev) osc++; if (s) prev = s; }
  const tail = y.slice(Math.round(n * 0.8)); const ss = tail.reduce((a, b) => a + b, 0) / tail.length / amp;
  return { rise: k10 >= 0 && k90 >= 0 ? (k90 - k10) / fs * 1000 : null, delay: k10 >= 0 ? (k10 - k0) / fs * 1000 : null, over: Math.max(0, (pk - 1) * 100),
           settle: (ks - k0) / fs * 1000, osc, steady: ss };
}
function impulseMetrics(o) {
  const fs = SIMV.M.ctl.fs_pid, y = o.gyro; if (o.unstable) return { unstable: true };
  let pk = 0; for (const v of y) pk = Math.max(pk, Math.abs(v));
  let ks = 0; for (let k = y.length - 1; k >= 0; k--) if (Math.abs(y[k]) > 0.1 * pk) { ks = k; break; }
  let iae = 0; for (const v of y) iae += Math.abs(v) / fs;
  return { peak: pk, settle: (ks / fs - 0.01) * 1000, iae };
}
function noiseToMotor(ax, g) {   // RMS of the fast (>80 Hz) PID output when the measured gyro noise is fed in: motor heat proxy
  const nz = SIMV.M.axes[SIMAX[ax]].noise; if (!nz) return null;
  const fs = SIMV.M.ctl.fs_pid, n = Math.round(1.0 * fs), o = simAxis(ax, g, { sp: new Float64Array(n), noise: nz, noiseRate: SIMV.M.fs_log });
  if (o.unstable) return null;
  const k = pt1k(80, fs); let lp = 0, s = 0, c = 0;
  for (let i = 0; i < n; i++) { lp += k * (o.u[i] - lp); if (i > n / 5) { s += (o.u[i] - lp) ** 2; c++; } }
  return Math.sqrt(s / c);
}
// zero-phase low-pass: 2nd-order Butterworth forward + backward, ends padded by reflection (identical to sim.py lp_zero)
function lpZero(x, fs, fc) {
  const n = x.length, pad = Math.min(n - 1, Math.round(0.1 * fs)), N = n + 2 * pad, z = new Float64Array(N);
  for (let i = 0; i < pad; i++) { z[i] = 2 * x[0] - x[pad - i]; z[pad + n + i] = 2 * x[n - 1] - x[n - 2 - i]; }
  for (let i = 0; i < n; i++) z[pad + i] = x[i];
  const K = Math.tan(Math.PI * Math.min(fc, 0.45 * fs) / fs), q = Math.SQRT2, nrm = 1 / (1 + K * q + K * K);
  const b0 = K * K * nrm, b1 = 2 * b0, b2 = b0, a1 = 2 * (K * K - 1) * nrm, a2 = (1 - K * q + K * K) * nrm;
  const run = (v, rev) => { const y = new Float64Array(N); let i0 = rev ? N - 1 : 0, st = rev ? -1 : 1, x1 = v[i0], x2 = x1, y1 = x1, y2 = x1;
    for (let c = 0, i = i0; c < N; c++, i += st) { const o = b0 * v[i] + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2; x2 = x1; x1 = v[i]; y2 = y1; y1 = o; y[i] = o; } return y; };
  return run(run(z, false), true).subarray(pad, pad + n);
}
// fit: 100·(1 − rms(error) / std(real)), both low-passed at the model's fit band (FIT_HZ, see sim.py), at log rate
function fitPct(sim, real, fl, fs) {
  const n = Math.min(real.length, Math.floor(sim.length / fs * fl)), s = new Float64Array(n), r = new Float64Array(n), fc = SIMV.M.fit_hz || 30;
  for (let i = 0; i < n; i++) { const v = sim[Math.min(sim.length - 1, Math.round(i / fl * fs))]; if (!isFinite(v)) return null; s[i] = v; r[i] = real[i]; }
  const S_ = lpZero(s, fl, fc), R_ = lpZero(r, fl, fc); let se = 0, sv = 0, mu = 0, c = 0;
  const k0 = Math.round(0.05 * fl); for (let i = k0; i < n; i++) mu += R_[i]; mu /= Math.max(1, n - k0);
  for (let i = k0; i < n; i++) { se += (S_[i] - R_[i]) ** 2; sv += (R_[i] - mu) ** 2; c++; }
  return 100 * (1 - Math.sqrt(Math.min(4, se / Math.max(sv, 1e-9))));
}

function evaluate(ax, g) {
  const amp = SIMV.step, st = simAxis(ax, g, stepInput(ax, amp)), im = simAxis(ax, g, impulseInput());
  const la = loopAnalysis(ax, g), lx = g.Dmax > g.D ? loopAnalysis(ax, g, true) : la;
  return { st, im, sm: stepMetrics(st, amp), imm: impulseMetrics(im), la, lx, noise: SIMV.noise ? noiseToMotor(ax, g) : null };
}

// ---------- verdicts ----------
function simVerdict(ax, E, E0) {
  const out = [], rok = S.profile ? S.profile.params.rise_ok_ms : 30, AXN = AX[ax];
  const lv = (x, a, b) => x < a ? "good" : x < b ? "warning" : "serious";
  if (E.sm.unstable || E.la.pm != null && E.la.pm < 0) return [{ level: "serious", title: `${AXN}: unstable`, tldr: "The simulated loop oscillates and grows: this tune would shake violently or flip out." }];
  const ms = Math.max(E.la.ms, E.lx.ms);
  const pl = SIMV.M.axes[SIMAX[ax]], ex = pl.excited_hz, xtr = pl.status !== "ok" || (ex && E.la.fc && E.la.fc > 1.25 * ex);
  out.push({ level: lv(ms, 1.7, 2.1), title: `${AXN}: robustness Ms ${ms.toFixed(2)} (phase margin ${E.la.pm != null ? E.la.pm.toFixed(0) + "°" : "–"}, gain margin ${E.la.gm != null ? E.la.gm.toFixed(1) + " dB" : "∞"})`,
            tldr: (ms < 1.7 ? "Comfortable distance from oscillation." : ms < 2.1 ? "Getting close to oscillation: expect ringing, hot motors in propwash." : "Too close to oscillation: likely audible oscillation / hot motors.")
              + (xtr ? ` Less certain: ${pl.status !== "ok" ? "this axis wasn't learned from this flight" : `the loop crosses over at ${E.la.fc.toFixed(0)} Hz but your sticks only excited it up to ${ex.toFixed(0)} Hz, so this rests on the measured motor lag rather than on observed oscillation behaviour`}.` : ""),
            detail: `Ms is the largest amplification of disturbances by the control loop (peak of |1/(1+L)|, here at ${E.la.fms.toFixed(0)} Hz). 1.3–1.7 is a well-damped tune; above 2 the loop amplifies disturbances near that frequency and small model errors can make it oscillate. Phase margin should stay above ~35°, gain margin above ~6 dB.` });
  out.push({ level: E.sm.over > 30 ? "serious" : E.sm.over > 15 ? "warning" : "good", title: `${AXN}: ${E.sm.over.toFixed(0)}% overshoot, rise ${E.sm.rise != null ? E.sm.rise.toFixed(0) : "–"} ms`,
            tldr: E.sm.rise > rok * 1.3 ? "Slow for this prop size: more P or FF." : E.sm.over > 15 ? "Overshoots: more D or less P / FF." : "Crisp and well damped.",
            detail: `For ${S.profile ? S.profile.used.inch : "?"}″ props a 10→90% rise under ~${rok} ms is normal. Settling (±5%): ${E.sm.settle.toFixed(0)} ms.` });
  if (E0 && E.noise != null && E0.noise) { const r = E.noise / E0.noise;
    if (r > 1.15) out.push({ level: r > 1.5 ? "serious" : "warning", title: `${AXN}: ${((r - 1) * 100).toFixed(0)}% more noise to the motors`, tldr: "Hotter motors: check temperature after the first flight.", detail: "The log's measured gyro noise was fed through both tunes; this is the fast (>80 Hz) part of the PID output, which only heats the motors." });
    else if (r < 0.87) out.push({ level: "good", title: `${AXN}: ${((1 - r) * 100).toFixed(0)}% less noise to the motors`, tldr: "Cooler motors than the current tune." }); }
  if (E0 && E.imm.peak) { const r = E.imm.peak / E0.imm.peak, rs = E.imm.settle / Math.max(1, E0.imm.settle);
    out.push({ level: r < 0.97 && rs < 1.05 ? "good" : r > 1.05 || rs > 1.3 ? "warning" : "info", title: `${AXN}: disturbance kick ${E.imm.peak.toFixed(0)} °/s peak, settles in ${E.imm.settle.toFixed(0)} ms`,
              tldr: `${r < 1 ? "Better" : "Worse"} than now at rejecting hits (propwash, gusts): ${(r * 100).toFixed(0)}% of the current peak, ${(rs * 100).toFixed(0)}% of its settling time.` }); }
  return out;
}

// ---------- automatic suggestion: small search around the current gains ----------
function suggestTune() {
  const res = {};
  for (let ax = 0; ax < 3; ax++) {
    const g0 = SIMV.gains[SIMAX[ax]], E0 = evaluate(ax, g0), rok = S.profile ? S.profile.params.rise_ok_ms : 30;
    let best = null;
    const cost = (g) => { const E = evaluate(ax, g); if (E.sm.unstable) return 1e9;
      const ms = Math.max(E.la.ms, E.lx.ms); let c = E.imm.iae / Math.max(1e-6, E0.imm.iae) + 0.6 * (E.sm.settle / Math.max(1, E0.sm.settle));
      c += Math.max(0, E.sm.over - 10) * 0.04 + Math.max(0, (E.sm.rise || 999) - rok) / rok * 0.5 + Math.max(0, ms - 1.7) * 6;
      if (E.noise && E0.noise) c += Math.max(0, E.noise / E0.noise - 1.15) * 4;
      return c; };
    for (const pm of [0.8, 0.9, 1, 1.1, 1.2]) for (const dm of ax === 2 && !g0.D ? [1] : [0.85, 1, 1.15, 1.3]) for (const im of [0.85, 1, 1.2]) {
      const g = { ...g0, P: Math.round(g0.P * pm), I: Math.round(g0.I * im), D: Math.round(g0.D * dm), Dmax: Math.round(g0.Dmax * dm) };
      const c = cost(g); if (!best || c < best.c) best = { c, g };
    }
    res[SIMAX[ax]] = best.g;
  }
  return res;
}

// ---------- first-open warning (once per log) ----------
function simGate() {
  const k = `sim.ack:${S.file}|${S.sub}`;
  if (S.simAck === k) return Promise.resolve(true);   // acknowledged for this log session only (reset on every log load / page reload)
  if (SIMV._gate && SIMV._gate.k === k) return SIMV._gate.p;   // already showing (render can run twice)
  const p = new Promise(res => {
    const el = document.createElement("div"); el.className = "modal-back"; el.id = "simGate";
    el.innerHTML = `<div class="modal" role="alertdialog" aria-modal="true" aria-labelledby="sgT">
      <div class="modal-ico">⚠</div><h2 id="sgT">Before you use the PID simulator</h2>
      <p>This tool <b>learns a model of your quad from this log</b>: how much rotation each motor command produces (authority, which depends on weight, arm length and props), how fast the motors spin up (motor lag, measured from eRPM), the system delay and the damping. It then replays your sticks through that model with the PIDs and filters you choose.</p>
      <ul><li>The model is fitted to <b>one flight, a small data sample</b>. It cannot know about conditions you did not fly: different batteries, wind, props, weight or temperature.</li>
        <li>Everything it shows (step responses, stability margins, the <b>✨ Suggest</b> button) is <b>illustrative only and has low confidence</b>. A good-looking simulation does not mean the tune is safe.</li>
        <li><b>Never copy the recommended PIDs to your quad blindly.</b> Change one thing at a time, in small steps, hover-test first, and check motor temperature after every flight. Too much P or D can cause violent oscillation, hot or burnt motors and loss of control.</li></ul>
      <p class="hint">You are responsible for what you flash to your flight controller. This message appears every time you open a log and then this tab.</p>
      <div class="modal-btns"><button class="btn ghost" id="sgNo">Take me back</button><button class="btn primary" id="sgOk">I understand the risks and wish to proceed</button></div></div>`;
    document.body.appendChild(el); document.body.classList.add("modal-open");
    const done = ok => { el.remove(); document.body.classList.remove("modal-open"); if (ok) S.simAck = k; SIMV._gate = null; res(ok); };
    el.querySelector("#sgOk").onclick = () => done(true);
    el.querySelector("#sgNo").onclick = () => done(false);
    el.addEventListener("keydown", e => { if (e.key === "Escape") done(false); });
    setTimeout(() => el.querySelector("#sgOk").focus(), 30);
  });
  SIMV._gate = { k, p };
  return p;
}

// ---------- tab ----------
async function renderPidSim() {
  if (!(await simGate())) { const b = document.querySelector('#tabs [data-tab="summary"]'); if (b) b.click(); return; }
  if (S.tab !== "pidsim") return;
  const key = [S.file, S.sub, S.prop && S.prop.inch].join("|");
  if (SIMV.key !== key) {
    $("controls").innerHTML = tbar(`<h3>PID simulator</h3><span class="hint">Learning this quad's dynamics from the log (closed-loop identification, ~20 s the first time)…</span>`, []);
    Plotly.purge("main"); $("findings").innerHTML = "";
    SIMV.M = await api("simmodel"); SIMV.key = key;
    SIMV.cur = JSON.parse(JSON.stringify(SIMV.M.pids));
    SIMV.gains = store.get("sim.gains:" + key, null) || JSON.parse(JSON.stringify(SIMV.M.pids));
    SIMV.gmul = SIMV.dmul = 1; SIMV._e0k = null;
    for (const a of SIMAX) if (!SIMV.M.axes[a]) SIMV.M.axes[a] = null;
    SIMV.meas = await api("step", {}).catch(() => null);
    if (S.tab !== "pidsim") return;
    SIMV.tkey = key + "|" + (S.auw || "");
  }
  // the "typical quad" comparison depends on the weight in use: cheap to refresh (the learned model is cached)
  if (SIMV.tkey !== key + "|" + (S.auw || "")) { const M2 = await api("simmodel"); SIMV.M.typical = M2.typical; SIMV.tkey = key + "|" + (S.auw || ""); if (S.tab !== "pidsim") return; }
  const M = SIMV.M;
  const views = [["step", "Step response"], ["impulse", "Disturbance kick"], ["replay", "Your flight replay"], ["freq", "Stability (frequency)"], ["check", "Model check"]];
  const vhint = SIMV.view === "check" ? "the model vs your flight, analysed the same way: dots = real, line = model · top: step response from your own stick moves · bottom: closed-loop response (|gyro / setpoint|), faded where your sticks didn't excite that frequency"
    : `dashed = current tune · solid = your edits${SIMV.view === "step" ? " · dots = measured from your own stick moves (slower and smoother than this sharp flick, and partly in angle mode, so the first ~20 ms can differ; Model check compares like for like)" : SIMV.view === "replay" ? " · grey = what the quad really did · fit compares content below " + (SIMV.M.fit_hz || 30) + " Hz" : ""}`;
  $("controls").innerHTML = tbar(`<h3 data-tip="tab_sim">PID simulator</h3><span class="badge lv-warning" data-tip="sim_model">illustrative · low confidence</span><span class="hint">${vhint}</span>`, [
    tg("View", `<span class="seg" id="simView">${views.map(([v, l]) => `<button data-v="${v}" class="${SIMV.view === v ? "on" : ""}">${l}</button>`).join("")}</span>`),
    tg("Test input", `<label class="ctl" data-tip="sim_step">Step <input id="simAmp" type="number" min="50" max="1200" step="50" value="${SIMV.step}" style="width:64px"> °/s</label>
      ${chip("noise", "Real gyro noise", SIMV.noise, { tip: "sim_noise" })}`)]);
  $("simView").onclick = e => { const v = e.target.dataset.v; if (!v) return; SIMV.view = v; store.set("sim.view", v); renderPidSim(); };
  $("simAmp").onchange = e => { SIMV.step = Math.max(20, +e.target.value || 300); store.set("sim.step", SIMV.step); simRun(); };
  $("controls").querySelector('[data-k="noise"]').onclick = e => { SIMV.noise = !SIMV.noise; store.set("sim.noise", SIMV.noise); e.currentTarget.classList.toggle("on", SIMV.noise); simRun(); };
  simPanel();
  await simRun();
}

function simPanel() {
  const M = SIMV.M, key = SIMV.key, keys = ["P", "I", "D", "Dmax", "FF"];
  const model = SIMAX.map((a, i) => { const p = M.axes[a]; if (!p) return `<tr><td>${AX[i]}</td><td colspan="6" class="hint">no model</td></tr>`;
    const lv = p.conf === "high" ? "good" : p.conf === "medium" ? "info" : "warning";
    const fit = p.status === "ok" ? `<span class="badge lv-${lv}">${p.fit_pct.toFixed(0)}%</span>` : p.status === "borrowed" ? `<span class="badge lv-info" title="from ${p.source}">borrowed</span>` : `<span class="badge lv-warning">no data</span>`;
    return `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td><td>${p.b.toFixed(0)}</td><td>${p.tau_ms.toFixed(0)} ms</td><td>${p.delay_ms.toFixed(1)} ms</td><td>${p.a.toFixed(0)}</td><td>${i === 2 ? (p.lam || 0).toFixed(1) : "–"}</td><td>${fit}</td></tr>`; }).join("");
  const notes = SIMAX.map((a, i) => { const p = M.axes[a]; if (!p) return "";
    if (p.status === "borrowed") return `<li>${AX[i]}: this flight barely moved it (stick std ${p.sp_std} °/s), so its dynamics come from <b>${p.source}</b>, the best-fitting flight of the same craft with matching motor dynamics.</li>`;
    if (p.status === "no_excitation") return `<li>${AX[i]}: this flight barely moved it (stick std ${p.sp_std} °/s) and no other flight of this craft has been analysed yet, so it uses the measured motor lag with a rough authority estimate. <b>Don't trust ${AX[i].toLowerCase()} predictions</b>: fly a few sharp ${AX[i].toLowerCase()} moves, or open another flight of this craft in the simulator first.</li>`;
    return p.excited_hz != null ? `<li>${AX[i]}: your sticks excited it up to ≈${p.excited_hz.toFixed(0)} Hz${p.frf_pct != null ? `, where the model matches the measured closed-loop response to ${p.frf_pct.toFixed(0)}%` : ""}.</li>` : ""; }).join("");
  const mot = M.motor ? `Motor lag ${M.motor.tau_ms} ms and delay ${M.motor.delay_ms} ms measured from the motor commands vs. eRPM at ${M.motor.hz.toFixed(0)} Hz (${(M.motor.hz * 60).toFixed(0)} RPM, coherence ${M.motor.coh}); each axis may refine τ by ±30%.` : "No eRPM telemetry: motor lag is a prop-size estimate.";
  const rows = SIMAX.map((a, i) => `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}</td>${keys.map(k => { const c = SIMV.cur[a][k], v = SIMV.gains[a][k];
    return `<td><input class="gin ${v !== c ? (v > c ? "up" : "down") : ""}" data-a="${a}" data-k="${k}" type="number" min="0" max="250" step="1" value="${Math.round(v)}"><small>${Math.round(c)}</small></td>`; }).join("")}</tr>`).join("");
  $("findings").innerHTML = `<div class="fh" data-tip="sim_model">Learned dynamics</div>
    <table class="cmp simmodel"><tr><th></th><th data-tip="sim_b">authority</th><th data-tip="sim_tau">motor lag</th><th data-tip="sim_delay">delay</th><th data-tip="sim_a">damping</th><th data-tip="sim_lam">λ</th><th data-tip="sim_fit">fit</th></tr>${model}</table>
    <div class="hint">${mot} The logged sticks drive this model with your current PIDs; the fit is how closely it reproduces the logged gyro (below ${M.fit_hz || 30} Hz) on the stick-active pieces.</div>
    ${notes ? `<ul class="hint simnotes">${notes}</ul>` : ""}
    ${typicalHTML(M.typical)}
    <div class="fh" data-tip="pid_sug">Try new PIDs</div>
    <table class="pidt gtab"><tr><th></th>${keys.map(k => `<th data-tip="${k}">${k}</th>`).join("")}</tr>${rows}</table>
    <div class="simf"><label class="ctl" data-tip="sim_gmul">Gyro LPF × <input id="simG" type="range" min="0.5" max="2" step="0.05" value="${SIMV.gmul}"><b id="simGv">${SIMV.gmul.toFixed(2)}</b></label>
      <label class="ctl" data-tip="sim_dmul">D-term LPF × <input id="simD" type="range" min="0.5" max="2" step="0.05" value="${SIMV.dmul}"><b id="simDv">${SIMV.dmul.toFixed(2)}</b></label></div>
    <div class="simbtns"><button class="btn sm" id="simSug" data-tip="sim_suggest">✨ Suggest</button><button class="btn sm ghost" id="simReset">Reset to current</button><button class="btn sm ghost" id="simCli">Copy CLI</button></div>
    <div id="simOut"></div>`;
  $("findings").querySelectorAll(".gin").forEach(el => el.oninput = () => { SIMV.gains[el.dataset.a][el.dataset.k] = Math.max(0, +el.value || 0);
    el.classList.toggle("up", SIMV.gains[el.dataset.a][el.dataset.k] > SIMV.cur[el.dataset.a][el.dataset.k]); el.classList.toggle("down", SIMV.gains[el.dataset.a][el.dataset.k] < SIMV.cur[el.dataset.a][el.dataset.k]);
    store.set("sim.gains:" + key, SIMV.gains); clearTimeout(SIMV._t); SIMV._t = setTimeout(simRun, 60); });
  $("simG").oninput = e => { SIMV.gmul = +e.target.value; $("simGv").textContent = SIMV.gmul.toFixed(2); clearTimeout(SIMV._t); SIMV._t = setTimeout(simRun, 60); };
  $("simD").oninput = e => { SIMV.dmul = +e.target.value; $("simDv").textContent = SIMV.dmul.toFixed(2); clearTimeout(SIMV._t); SIMV._t = setTimeout(simRun, 60); };
  $("simReset").onclick = () => { SIMV.gains = JSON.parse(JSON.stringify(SIMV.cur)); SIMV.gmul = SIMV.dmul = 1; store.set("sim.gains:" + key, null); simPanel(); simRun(); };
  $("simSug").onclick = () => { $("simSug").textContent = "…"; setTimeout(() => { SIMV.gains = suggestTune(); store.set("sim.gains:" + key, SIMV.gains); simPanel(); simRun(); }, 20); };
  $("simCli").onclick = () => { const L = [];
    SIMAX.forEach((a, i) => { const g = SIMV.gains[a], c = SIMV.cur[a], n = ["roll", "pitch", "yaw"][i];
      [["P", "p"], ["I", "i"], ["D", "d"], ["Dmax", "d_max"], ["FF", "f"]].forEach(([k, cli]) => { if (Math.round(g[k]) !== Math.round(c[k])) L.push(`set ${cli}_${n} = ${Math.round(g[k])}`); }); });
    if (SIMV.gmul !== 1) L.push(`set simplified_gyro_filter_multiplier = ${Math.round(100 * SIMV.gmul)}`);
    if (SIMV.dmul !== 1) L.push(`set simplified_dterm_filter_multiplier = ${Math.round(100 * SIMV.dmul)}`);
    L.push("save"); navigator.clipboard && navigator.clipboard.writeText(L.join("\n")); $("simCli").textContent = L.length > 1 ? "Copied ✓" : "No changes"; };
}

async function simRun() {
  if (!SIMV.M || S.tab !== "pidsim") return;
  const M = SIMV.M, fs = M.ctl.fs_pid, axes = [0, 1, 2].filter(i => M.axes[SIMAX[i]]);
  const E = {}, E0 = {};
  const k0 = [SIMV.step, SIMV.noise, SIMV.gmul, SIMV.dmul].join("|");
  if (SIMV._e0k !== k0) { SIMV._e0 = {}; for (const i of axes) SIMV._e0[i] = evaluate(i, SIMV.cur[SIMAX[i]]); SIMV._e0k = k0; }
  for (const i of axes) { E0[i] = SIMV._e0[i]; E[i] = evaluate(i, SIMV.gains[SIMAX[i]]); }
  const L = cols(3, AX.map((a, i) => M.axes[SIMAX[i]] ? `${a}` : `${a} (no model)`),
    { step: "time after the stick flick (ms)", impulse: "time after the kick (ms)", replay: "flight time (s)", freq: "frequency (Hz)" }[SIMV.view], { hovermode: "x unified", margin: { l: 46, r: 8, t: 40, b: 36 } });
  const tr = [], xs = n => Array.from({ length: n }, (_, k) => k / fs * 1000);
  const sub = (i, k) => ({ xaxis: `x${i ? i + 1 : ""}`, yaxis: `y${i ? i + 1 : ""}`, legendgroup: k, showlegend: i === axes[0] });
  for (const i of axes) {
    const c = axc(i), a = SIMAX[i];
    if (SIMV.view === "step") {
      const n = E[i].st.gyro.length, amp = SIMV.step;
      tr.push({ type: "scatter", mode: "lines", x: xs(n), y: Array.from(E[i].st.sp, v => v / amp), name: "setpoint", line: { color: css("--muted"), width: 1, dash: "dot" }, ...sub(i, "sp") });
      tr.push({ type: "scatter", mode: "lines", x: xs(n), y: Array.from(E0[i].st.gyro, v => v / amp), name: "current tune", line: { color: c, width: 1.6, dash: "dash" }, ...sub(i, "cur") });
      tr.push({ type: "scatter", mode: "lines", x: xs(n), y: Array.from(E[i].st.gyro, v => v / amp), name: "your edits", line: { color: c, width: 2.6 }, ...sub(i, "new") });
      const ms = SIMV.meas && SIMV.meas[i] && SIMV.meas[i].median;
      // the measured response is to an ideal step: line it up with the moment the simulated setpoint passes 50%
      let k50 = 0; while (k50 < n && E[i].st.sp[k50] < amp / 2) k50++;
      const sh = k50 / fs * 1000;
      if (ms) tr.push({ type: "scatter", mode: "markers", x: SIMV.meas.t_ms.filter((_, k) => k % 6 === 0).map(t => t + sh), y: ms.filter((_, k) => k % 6 === 0), name: "measured in flight", marker: { size: 4, color: css("--ink2") }, ...sub(i, "meas") });
      L[`yaxis${i ? i + 1 : ""}`].range = [0, 1.6]; L[`xaxis${i ? i + 1 : ""}`].range = [0, 400];
      L.shapes = (L.shapes || []).concat([{ type: "line", xref: `x${i ? i + 1 : ""} domain`, yref: `y${i ? i + 1 : ""}`, x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), dash: "dash", width: 1 } }]);
    } else if (SIMV.view === "impulse") {
      const n = E[i].im.gyro.length;
      tr.push({ type: "scatter", mode: "lines", x: xs(n), y: Array.from(E0[i].im.gyro), name: "current tune", line: { color: c, width: 1.6, dash: "dash" }, ...sub(i, "cur") });
      tr.push({ type: "scatter", mode: "lines", x: xs(n), y: Array.from(E[i].im.gyro), name: "your edits", line: { color: c, width: 2.6 }, ...sub(i, "new") });
      L[`yaxis${i ? i + 1 : ""}`].title = { text: "rotation (°/s)", font: { size: 10 } };
    } else if (SIMV.view === "replay") {
      const inp = replayInput(i); if (!inp) continue;
      const v = M.axes[a].val, fl = M.fs_log, o0 = simAxis(i, SIMV.cur[a], inp), o1 = simAxis(i, SIMV.gains[a], inp);
      const tl = v.gyro.map((_, k) => v.t0 + k / fl), ts = Array.from({ length: o0.gyro.length }, (_, k) => v.t0 + k / fs), dec = a => Array.from(a).filter((_, k) => k % 4 === 0);
      tr.push({ type: "scatter", mode: "lines", x: tl, y: v.sp, name: "setpoint (sticks)", line: { color: css("--ink2"), width: 1, dash: "dot" }, ...sub(i, "sp") });
      tr.push({ type: "scatter", mode: "lines", x: tl, y: v.gyro, name: "real gyro", line: { color: css("--muted"), width: 2.4 }, opacity: 0.8, ...sub(i, "real") });
      tr.push({ type: "scatter", mode: "lines", x: dec(ts), y: dec(o0.gyro), name: "sim · current tune", line: { color: c, width: 1.4, dash: "dash" }, ...sub(i, "cur") });
      tr.push({ type: "scatter", mode: "lines", x: dec(ts), y: dec(o1.gyro), name: "sim · your edits", line: { color: c, width: 2.2 }, ...sub(i, "new") });
      const ft = fitPct(o0.gyro, v.gyro, fl, fs);
      L.annotations.push({ text: `sim vs real: ${ft != null ? ft.toFixed(0) + "% fit" : "diverged"}`, xref: `x${i ? i + 1 : ""} domain`, yref: `y${i ? i + 1 : ""} domain`, x: 1, y: 1, xanchor: "right", yanchor: "top", showarrow: false,
        font: { size: 11, color: css("--ink") }, bgcolor: rgba(LVC(ft > 60 ? "good" : ft > 35 ? "info" : "warning"), 0.2) });
    } else if (SIMV.view === "check") {
      // like-for-like validation: same analysis on the real gyro and on the model replaying this flight
      const ll = M.axes[a].step_ll, fr = M.axes[a].frf, xs_ = i ? i + 1 : "", xb = i + 4;
      if (ll) {
        tr.push({ type: "scatter", mode: "markers", x: ll.t_ms, y: ll.real, name: "real flight", marker: { size: 4, color: css("--ink2") }, ...sub(i, "real") });
        tr.push({ type: "scatter", mode: "lines", x: ll.t_ms, y: ll.model, name: "model", line: { color: c, width: 2.4 }, ...sub(i, "model") });
        L.annotations.push({ text: `step match ±${(ll.rms * 100).toFixed(0)}% (0–150 ms)`, xref: `x${xs_} domain`, yref: `y${xs_} domain`, x: 1, y: 1, xanchor: "right", yanchor: "top", showarrow: false,
          font: { size: 11, color: css("--ink") }, bgcolor: rgba(LVC(ll.rms < 0.1 ? "good" : ll.rms < 0.2 ? "info" : "warning"), 0.2) });
      } else { const dm = L[`xaxis${xs_}`].domain, st_ = M.axes[a].status;
        L.annotations.push({ text: st_ === "ok" ? "not enough stick moves to compare" : st_ === "borrowed" ? `borrowed from another flight:<br>nothing to compare on this one` : "not learned from this flight",
          xref: "paper", yref: "paper", x: (dm[0] + dm[1]) / 2, y: 0.76, showarrow: false, font: { size: 12, color: css("--muted") } }); }
      L[`xaxis${xs_}`].range = [0, 300]; L[`yaxis${xs_}`].range = [-0.1, 1.8]; L[`xaxis${xs_}`].title = { text: "ms after a setpoint step", font: { size: 10 } };
      L[`xaxis${xb}`] = { ...L[`xaxis${xs_}`], domain: L[`xaxis${xs_}`].domain, anchor: `y${xb}`, title: { text: "Hz", font: { size: 10 } }, range: null, type: "linear" };
      L[`yaxis${xb}`] = { ...L[`yaxis${xs_}`], domain: [0, 0.38], anchor: `x${xb}`, range: [0, 2.2], title: { text: i ? "" : "|gyro / setpoint|", font: { size: 10 } } };
      L[`yaxis${xs_}`].domain = [0.52, 1];
      if (fr) {
        const mag = ([re, im]) => re.map((r, k) => Math.hypot(r, im[k]));
        tr.push({ type: "scatter", mode: "markers", x: fr.f, y: mag(fr.real), name: "real flight", marker: { size: 6, color: css("--ink2"), opacity: fr.coh.map(q => 0.15 + 0.85 * Math.min(1, q / 0.6)) }, xaxis: `x${xb}`, yaxis: `y${xb}`, legendgroup: "real", showlegend: false,
          hovertemplate: "%{x:.0f} Hz · |T| %{y:.2f}<extra>real</extra>" });
        tr.push({ type: "scatter", mode: "lines", x: fr.f, y: mag(fr.sim), name: "model", line: { color: c, width: 2.2 }, xaxis: `x${xb}`, yaxis: `y${xb}`, legendgroup: "model", showlegend: false });
        const ex = M.axes[a].excited_hz;
        if (ex) L.shapes = (L.shapes || []).concat([{ type: "rect", xref: `x${xb}`, yref: `y${xb} domain`, x0: ex, x1: Math.max(...fr.f), y0: 0, y1: 1, fillcolor: rgba(css("--muted"), 0.08), line: { width: 0 }, layer: "below" }]);
        if (ex) L.annotations.push({ text: `sticks excite ≤ ${ex.toFixed(0)} Hz`, xref: `x${xb}`, yref: `y${xb} domain`, x: ex, y: 1, xanchor: "left", yanchor: "top", showarrow: false, font: { size: 10, color: css("--muted") } });
      }
    } else {
      const la0 = E0[i].la, la = E[i].la;
      tr.push({ type: "scatter", mode: "lines", x: la0.f, y: la0.S, name: "current |S|", line: { color: c, width: 1.6, dash: "dash" }, ...sub(i, "cur") });
      tr.push({ type: "scatter", mode: "lines", x: la.f, y: la.S, name: "your edits |S|", line: { color: c, width: 2.6 }, ...sub(i, "new") });
      const xa = `xaxis${i ? i + 1 : ""}`, ya = `yaxis${i ? i + 1 : ""}`;
      L[xa].type = "log"; L[xa].range = [0, Math.log10(fs * 0.45)]; L[ya].range = [0, 3]; L[ya].title = { text: "disturbance gain |S|", font: { size: 10 } };
      L.shapes = (L.shapes || []).concat([{ type: "rect", xref: `x${i ? i + 1 : ""}`, yref: `y${i ? i + 1 : ""}`, x0: 0.5, x1: fs, y0: 1, y1: 3, fillcolor: rgba(css("--serious"), 0.06), line: { width: 0 }, layer: "below" },
        { type: "line", xref: `x${i ? i + 1 : ""} domain`, yref: `y${i ? i + 1 : ""}`, x0: 0, x1: 1, y0: 1, y1: 1, line: { color: css("--axis"), width: 1 } }]);
      L.annotations.push({ text: `Ms ${la0.ms.toFixed(2)} → <b>${la.ms.toFixed(2)}</b> · PM ${la0.pm != null ? la0.pm.toFixed(0) : "–"}° → <b>${la.pm != null ? la.pm.toFixed(0) : "–"}°</b>`, xref: `x${i ? i + 1 : ""} domain`, yref: `y${i ? i + 1 : ""} domain`,
        x: 1, y: 1, xanchor: "right", yanchor: "top", showarrow: false, font: { size: 11, color: css("--ink") }, bgcolor: rgba(LVC(la.ms < 1.7 ? "good" : la.ms < 2.1 ? "warning" : "serious"), 0.2) });
    }
  }
  fitMain(SIMV.view === "check" ? 560 : 460);
  await Plotly.react("main", tr, L, CFG);
  // metrics table + verdicts
  const row = (lbl, tip, f, better) => `<tr><td data-tip="${tip}">${lbl}</td>${axes.map(i => { const a = f(E0[i]), b = f(E[i]);
    const cls = a == null || b == null || Math.abs(b - a) < 1e-9 * (1 + Math.abs(a)) ? "" : (better(b, a) ? "up" : "down");
    return `<td class="${cls}">${a == null ? "–" : a.toFixed(a < 10 ? 2 : 0)} → <b>${b == null ? "–" : b.toFixed(b < 10 ? 2 : 0)}</b></td>`; }).join("")}</tr>`;
  const lt = (x, y) => x < y, gt = (x, y) => x > y;
  const tbl = `<table class="pidt simm"><tr><th></th>${axes.map(i => `<th style="color:${axc(i)}">${AX[i]}</th>`).join("")}</tr>
    ${row("rise ms", "rise", e => e.sm.rise, lt)}${row("overshoot %", "overshoot", e => e.sm.over, lt)}${row("settle ms", "settle", e => e.sm.settle, lt)}
    ${row("kick peak °/s", "sim_kick", e => e.imm.peak, lt)}${row("kick settle ms", "sim_kick", e => e.imm.settle, lt)}
    ${row("Ms", "sim_ms", e => Math.max(e.la.ms, e.lx.ms), lt)}${row("phase margin °", "sim_ms", e => e.la.pm, gt)}${row("bandwidth Hz", "sim_bw", e => e.la.fc, gt)}
    ${SIMV.noise ? row("noise → motors", "sim_noise", e => e.noise, lt) : ""}</table>`;
  const ver = axes.flatMap(i => simVerdict(i, E[i], E0[i]));
  const lowc = axes.filter(i => M.axes[SIMAX[i]].conf === "low").map(i => AX[i]);
  $("simOut").innerHTML = `<div class="fh">Current → your edits</div>${tbl}` + (lowc.length ? `<div class="hint" style="color:var(--warn-ink)">⚠ ${lowc.join(", ")}: the model fits the flight poorly, so treat those predictions as rough. Log a flight with more flips and rolls.</div>` : "") +
    findingsHTML(ver, `<div class="fh">Prediction</div>`);
  if (typeof fitSide === "function") fitSide();
}

// ---- learned dynamics vs a typical quad of the same prop size (typical weight for that size, same motors) ----
function typicalHTML(T) {
  if (!T) return "";
  if (!T.t) return `<div class="fh" data-tip="sim_typ">Compared with a typical ${T.inch}″ quad</div><div class="hint">${esc(T.why || "")}</div>`;
  const t = T.t, g = kg => `${Math.round(kg * 1000)} g`;
  const rel = (r, hi, lo) => r >= 1.25 ? hi : r <= 0.8 ? lo : "about typical";
  const pill = r => `<span class="badge lv-${Math.abs(Math.log(r)) < Math.log(1.25) ? "good" : "info"}">${r.toFixed(1)}×</span>`;
  const rows = SIMAX.map((a, i) => { const r = T.axes && T.axes[a]; if (!r) return "";
    const unsure = r.status !== "ok" ? ` <span class="hint">(${r.status === "borrowed" ? "borrowed" : "not learned"})</span>` : "";
    return `<tr><td><span class="sw" style="background:${axc(i)}"></span>${AX[i]}${unsure}</td>
      <td>${r.b.toFixed(0)}<small> / ${r.b_typ.toFixed(0)}</small> ${pill(r.b_ratio)}</td>
      <td>${r.tau_ms.toFixed(0)}<small> / ${r.tau_typ.toFixed(0)} ms</small> ${pill(r.tau_ratio)}</td>
      <td>${r.delay_ms.toFixed(1)}<small> / ${t.delay_ms[0]}–${t.delay_ms[1]}</small></td></tr>`; }).join("");
  const rp = ["roll", "pitch"].map(a => T.axes && T.axes[a]).filter(r => r && r.status === "ok");
  const bR = rp.length ? rp.reduce((s, r) => s + Math.log(r.b_ratio), 0) / rp.length : null, tR = rp.length ? rp.reduce((s, r) => s + Math.log(r.tau_ratio), 0) / rp.length : null;
  const inr = rp.map(r => r.inertia_gcm2).filter(Boolean), inrR = inr.length ? inr.reduce((a, b) => a + b, 0) / inr.length / T.inertia_typ_at_auw : null;
  const says = [];
  if (bR != null) says.push(`Roll/pitch authority is <b>${rel(Math.exp(bR), "higher than typical", "lower than typical")}</b> (${Math.exp(bR).toFixed(2)}×): ${Math.exp(bR) >= 1.25 ? `the same PIDs act stronger on this quad, so it needs <b>less P and D</b> than a typical ${T.inch}″ tune` : Math.exp(bR) <= 0.8 ? `the same PIDs act weaker, so it needs <b>more P and D</b> than a typical ${T.inch}″ tune` : `a typical ${T.inch}″ tune is a fair starting point`}.`);
  if (T.hover_hz && t.hover_hz) { const kh = T.kg_hover, off = kh ? T.auw_kg / kh : 1, slow = T.hover_hz < t.hover_hz;
    says.push(`It hovers at ${T.hover_hz.toFixed(0)} Hz motor speed vs ≈${t.hover_hz.toFixed(0)} Hz for a typical ${g(t.kg)} ${T.inch}″ (${slow ? "lighter for its props: more authority" : "heavier for its props: less authority"}).`
      + (kh ? (Math.abs(Math.log(off)) < Math.log(1.3) ? ` That hover speed matches the ${g(T.auw_kg)} all-up weight${T.auw_source === "user" ? " you set" : ""}.`
        : ` <b>That hover speed points to ≈${g(kh)} on ${T.inch}″ ${T.blades}-blade props, not the ${g(T.auw_kg)}${T.auw_source === "user" ? " you set" : " in use"}</b>: check the weight, or the prop size and blade count in the Quad profile (props with unusual pitch also shift this by about ±30%).`) : "")); }
  if (tR != null) says.push(`Motors respond ${Math.exp(tR) <= 0.8 ? "<b>faster</b> than" : Math.exp(tR) >= 1.25 ? "<b>slower</b> than" : "about as fast as"} typical ${T.inch}″ ones (${Math.exp(tR).toFixed(2)}× the lag)${Math.exp(tR) >= 1.25 ? ": heavier props or low motor speed; it limits how much P and D can go up" : Math.exp(tR) <= 0.8 ? ": it leaves room for a tighter tune" : ""}.`);
  if (inrR != null) says.push(`At ${g(T.auw_kg)}, the learned authority implies ${inrR >= 1.3 ? "<b>more</b> rotational inertia than" : inrR <= 0.75 ? "<b>less</b> rotational inertia than" : "about the rotational inertia of"} a typical layout of that weight (${inrR.toFixed(2)}×)${inrR >= 1.3 ? ": mass far from the centre (battery or camera out front/top, long arms)" : inrR <= 0.75 ? ": mass packed near the centre, or the weight is set too high" : ""}.`);
  return `<div class="fh" data-tip="sim_typ">Compared with a typical ${T.inch}″ ${T.blades}-blade quad (${g(t.kg)}, ${t.wheelbase_mm} mm, same motors)</div>
    <table class="cmp simmodel simtyp"><tr><th></th><th data-tip="sim_b">authority <small>yours / typ.</small></th><th data-tip="sim_tau">motor lag</th><th data-tip="sim_delay">delay, ms</th></tr>${rows}</table>
    <ul class="hint simnotes">${says.map(x => `<li>${x}</li>`).join("")}</ul>`;
}
