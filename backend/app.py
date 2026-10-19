"""BBX — Betaflight blackbox analyzer. Run: uvicorn app:app --reload  (or: python app.py)"""
import math
from functools import lru_cache, wraps
from threading import Lock
from pathlib import Path
from fastapi import FastAPI, UploadFile, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from bbl import Log, list_logs

ROOT = Path(__file__).resolve().parent.parent   # the project folder (backend/ sits one level down)
LOGS = ROOT / "logs"
LOGS.mkdir(exist_ok=True)
class SafeJSON(Response):
    """JSON that turns NaN / ±inf (short or odd logs) into null instead of failing the whole request."""
    media_type = "application/json"

    def render(self, content) -> bytes:
        import json
        import numpy as np

        def clean(o):
            if isinstance(o, float):
                return o if math.isfinite(o) else None
            if isinstance(o, dict):
                return {k: clean(v) for k, v in o.items()}
            if isinstance(o, (list, tuple)):
                return [clean(v) for v in o]
            if isinstance(o, np.generic):
                return clean(o.item())
            return o
        return json.dumps(clean(content), separators=(",", ":"), allow_nan=False).encode()


from version import VERSION
app = FastAPI(title="BBX Analyzer", version=VERSION, default_response_class=SafeJSON)


def _warm():
    import threading
    import simcore
    threading.Thread(target=simcore.warmup, daemon=True).start()   # compile the simulator kernels while the browser opens


_warm()


_lock = Lock()


def get(name: str, idx: int) -> Log:
    p = LOGS / Path(name).name
    if not p.exists():
        raise HTTPException(404, "log not found")
    with _lock:  # one decode at a time; concurrent requests wait for the cached result
        return _load(p, idx)


def memo(fn):
    """Remember an analysis endpoint's answer for the open log (same arguments -> same answer): switching tabs, re-opening a
    tab and the summary's repeated requests then cost nothing. The memo lives and dies with the cached log."""
    @wraps(fn)
    def w(*a, **k):
        lg = get(k["name"], k["idx"])
        m = lg.__dict__.setdefault("_api_memo", {})
        key = (fn.__name__,) + tuple(sorted((x, repr(y)) for x, y in k.items()))
        if key not in m:
            if len(m) > 80:
                m.pop(next(iter(m)))
            m[key] = fn(*a, **k)
        return m[key]
    return w


@lru_cache(maxsize=4)
def _load(p: Path, idx: int) -> Log:
    return Log(p, idx)


@app.get("/api/progress")
def progress_(name: str, idx: int = 1):
    import time
    from bbl import PROGRESS
    d = PROGRESS.get(f"{Path(name).name}|{idx}", {})
    now = time.time()
    return {k: {**v, "elapsed": round(now - v["t0"], 1), "since": round(now - v.get("ts", now), 2), "in_step": round(now - v.get("tstep", now), 1)}
            for k, v in list(d.items())}


@app.get("/api/version")
def version_():
    return {"version": VERSION}


@app.get("/api/logs")
def logs():
    return list_logs(LOGS)


@app.post("/api/upload")
async def upload(file: UploadFile):
    (LOGS / Path(file.filename).name).write_bytes(await file.read())
    _load.cache_clear()
    return {"ok": True, "name": Path(file.filename).name}


@app.get("/api/{name}/{idx}/meta")
def meta(name: str, idx: int):
    return get(name, idx).meta()


@app.get("/api/{name}/{idx}/series")
def series(name: str, idx: int, fields: str, t0: float = None, t1: float = None, n: int = Query(2000, le=20000), smooth: float = Query(0, ge=0, le=50)):
    lg = get(name, idx)
    fs = [f for f in fields.split(",") if f in lg.cols]
    return lg.series(fs, t0, t1, n, smooth)


@app.get("/api/{name}/{idx}/psd")
def psd(name: str, idx: int, fields: str, t0: float = None, t1: float = None):
    lg = get(name, idx)
    return {f: lg.psd(f, t0, t1) for f in fields.split(",") if f in lg.cols}


@app.get("/api/{name}/{idx}/spectrogram")
@memo
def spectrogram(name: str, idx: int, field: str, mode: str = "throttle", t0: float = None, t1: float = None, nper: int = 256):
    return get(name, idx).spectrogram(field, mode, t0, t1, nper=nper)


@app.get("/api/{name}/{idx}/noise")
@memo
def noise(name: str, idx: int, t0: float = None, t1: float = None, res_prom: float = 6, res_persist: float = 40, res_mask: float = 4,
          res_fmax: float = None, nper: int = 512, prop: float = None, blades: int = None):
    nper = int(min(4096, max(128, 2 ** round(math.log2(max(nper, 2))))))
    return get(name, idx).noise(t0, t1, prop=prop, blades=blades, res_prom=res_prom, res_persist=res_persist, res_mask=res_mask, res_fmax=res_fmax, nper=nper)


@app.get("/api/{name}/{idx}/profile")
def profile(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    return get(name, idx).profile(prop, blades, auw)


@app.get("/api/{name}/{idx}/resonances")
@memo
def resonances(name: str, idx: int, t0: float = None, t1: float = None, prom: float = 6, persist: float = 40, mask: float = 4, fmax: float = None):
    return get(name, idx).resonances(t0, t1, prom=prom, persist=persist, mask=mask, fmax=fmax)


@app.get("/api/{name}/{idx}/playback")
def playback(name: str, idx: int, rate: float = 250):
    names, n, nm, buf = get(name, idx).playback(rate)
    return Response(buf, media_type="application/octet-stream",
                    headers={"X-Channels": ",".join(names), "X-N": str(n), "X-Motors": str(nm), "Access-Control-Expose-Headers": "X-Channels,X-N,X-Motors"})


@app.get("/api/{name}/{idx}/motors")
@memo
def motors(name: str, idx: int, t0: float = None, t1: float = None, thr_min: float = 0, thr_max: float = 100):
    return get(name, idx).motors(t0, t1, thr_min, thr_max)


@app.get("/api/{name}/{idx}/step")
@memo
def step(name: str, idx: int, t0: float = None, t1: float = None, win_s: float = 2.0, min_sp: float = 20,
         max_sp: float = 2000, thr_min: float = 0, thr_max: float = 100, prop: float = None, blades: int = None, src: str = "gyroADC"):
    src = src if src in ("gyroADC", "gyroUnfilt") else "gyroADC"
    return get(name, idx).step_response(t0, t1, win_s=win_s, min_sp=min_sp, max_sp=max_sp, thr_min=thr_min, thr_max=thr_max, prop=prop, blades=blades, src=src)


@app.get("/api/{name}/{idx}/filterplan")
@memo
def filterplan(name: str, idx: int, t0: float = None, t1: float = None, prom: float = 6, persist: float = 40, mask: float = 4, fmax: float = None,
               prop: float = None, blades: int = None):
    return get(name, idx).filterplan(t0, t1, prop=prop, blades=blades, prom=prom, persist=persist, mask=mask, fmax=fmax)


@app.get("/api/{name}/{idx}/simmodel")
def simmodel(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    return get(name, idx).simmodel(prop, blades, auw)


@app.get("/api/{name}/{idx}/plan")
def plan_(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    import plan
    lg = get(name, idx)
    return plan.build_plan(lg, prop, blades, auw, plan.gather(lg, prop, blades, auw, task="plan"))


@app.get("/api/{name}/{idx}/delay")
def delay_(name: str, idx: int, prop: float = None, blades: int = None, ref: str = "bf"):
    """Filter-delay analysis: per-stage phase delay at each axis's crossover, margins with the learned plant, sweeps.
    ref: what 'typical' means: 'bf' Betaflight firmware defaults, 'size' those defaults scaled for the prop size."""
    import delay, plan
    from bbl import Job
    lg = get(name, idx)
    memo = lg.__dict__.setdefault("_memo", {})
    if ("delay", prop, blades, ref) in memo:
        return memo[("delay", prop, blades, ref)]
    with Job(lg, "delay", [("Gyro noise spectrum", 1), ("Propwash events", 1), ("This quad's dynamics, learned from the flight", 8),
                           ("Filter stages, crossover and margins", 2)]) as j:
        j.step(0, "Welch spectra of the raw and filtered gyro, residual noise peaks after the RPM filter", eta=0.6)
        noise = plan._memo(lg, ("noise", prop, blades), lambda: lg.noise(prop=prop, blades=blades))
        j.note(f"{len(noise.get('dyn_cand') or [])} residual noise peaks" if isinstance(noise, dict) else "")
        j.step(1, "Finding the throttle chops and measuring the wobble after each", eta=0.6)
        pw = plan._memo(lg, ("propwash", prop, blades), lambda: lg.flight("propwash", prop=prop, blades=blades))
        if isinstance(pw, dict) and pw.get("pw_freq"):
            j.note(f"rings at {pw['pw_freq']:.0f} Hz")
        cached = lg.sim_cached(prop, blades)
        j.step(2, "Loaded from the cache" if cached else "Fitting authority, motor lag, delay and damping per axis to your stick inputs", eta=0.2 if cached else sim_eta(lg))
        M = lg.simmodel(prop, blades)
        j.note("from cache" if cached else "fit " + ", ".join(f"{a} {r['fit_pct']:.0f}%" for a, r in (M.get("axes") or {}).items() if r.get("fit_pct") is not None))
        j.step(3, "Delay of each filter at the crossover, what-ifs, sweeps and headroom", eta=1.0)
        D = delay.analyse(lg, lg.profile(prop, blades), M, noise, pw, ref=ref, prog=lambda fr, d: j.sub(fr, d, min(1.0, fr + 1 / 3 * 0.4), 0.3))
        memo[("delay", prop, blades, ref)] = D
        return D


def sim_eta(lg):
    """Rough time to learn the dynamics (s): measured work rate × the lanes the search runs."""
    import sim
    return sim.expected_seconds(lg)


@app.get("/api/{name}/{idx}/report")
def report_(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    import plan
    return plan.report_data(get(name, idx), prop, blades, auw)


@app.get("/api/compare")
def compare_(a: str, b: str, ai: int = 1, bi: int = 1, pa: float = None, ba: int = None, wa: float = None,
             pb: float = None, bb: int = None, wb: float = None):
    """Before (a) vs after (b). Each flight is analysed with its own prop size / weight (as set for its craft)."""
    import plan
    from bbl import progress
    A, B = get(a, ai), get(b, bi)
    st = [f"Before: {Path(a).name}", f"After: {Path(b).name}", "Scorecard, differences and the next plan"]
    try:
        progress(b, bi, "compare", "Noise, step response, motors, PID terms, propwash and the filter proposal", 0.0, steps=st, step=0, nxt=0.45, eta=4)
        ga = plan.gather(A, pa, ba, wa, task="cmp")
        progress(b, bi, "compare", "The same analyses on the second flight", 0.45, steps=st, step=1, nxt=0.9, eta=4)
        gb = plan.gather(B, pb, bb, wb, task="cmp")
        progress(b, bi, "compare", "Matching the metrics and building the plan for the next flight", 0.9, steps=st, step=2, nxt=1.0, eta=0.5)
        out = plan.compare(A, B, ga, gb)
        out["plan_b"] = plan.build_plan(B, pb, bb, wb, gb)
        return out
    finally:
        progress(b, bi, "compare", done=True)


@app.get("/api/{name}/{idx}/{kind}")
@memo
def flight(name: str, idx: int, kind: str, t0: float = None, t1: float = None, prop: float = None, blades: int = None,
           chop: float = None, drop: float = None, win: float = None, stick: float = None, skip: float = None, flo: float = None, fhi: float = None, minev: int = None):
    if kind not in ("pidterms", "motorout", "propwash"):
        raise HTTPException(404, "unknown analysis")
    return get(name, idx).flight(kind, t0, t1, prop, blades, chop=chop, drop=drop, win=win, stick=stick, skip=skip, flo=flo, fhi=fhi, minev=minev)


app.mount("/static", StaticFiles(directory=ROOT / "static"), name="static")


@app.get("/")
def index():
    return FileResponse(ROOT / "static" / "index.html")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8000)

