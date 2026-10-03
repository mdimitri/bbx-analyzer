"""BBX — Betaflight blackbox analyzer. Run: uvicorn app:app --reload  (or: python app.py)"""
import math
from functools import lru_cache
from threading import Lock
from pathlib import Path
from fastapi import FastAPI, UploadFile, HTTPException, Query
from fastapi.staticfiles import StaticFiles
from fastapi.responses import FileResponse, Response
from bbl import Log, list_logs

ROOT = Path(__file__).parent
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


app = FastAPI(title="BBX", default_response_class=SafeJSON)


_lock = Lock()


def get(name: str, idx: int) -> Log:
    p = LOGS / Path(name).name
    if not p.exists():
        raise HTTPException(404, "log not found")
    with _lock:  # one decode at a time; concurrent requests wait for the cached result
        return _load(p, idx)


@lru_cache(maxsize=4)
def _load(p: Path, idx: int) -> Log:
    return Log(p, idx)


@app.get("/api/progress")
def progress_(name: str, idx: int = 1):
    import time
    from bbl import PROGRESS
    d = PROGRESS.get(f"{Path(name).name}|{idx}", {})
    return {k: {**v, "elapsed": round(time.time() - v["t0"], 1)} for k, v in list(d.items())}


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
def spectrogram(name: str, idx: int, field: str, mode: str = "throttle", t0: float = None, t1: float = None, nper: int = 256):
    return get(name, idx).spectrogram(field, mode, t0, t1, nper=nper)


@app.get("/api/{name}/{idx}/noise")
def noise(name: str, idx: int, t0: float = None, t1: float = None, res_prom: float = 6, res_persist: float = 40, res_mask: float = 4,
          res_fmax: float = None, nper: int = 512, prop: float = None, blades: int = None):
    nper = int(min(4096, max(128, 2 ** round(math.log2(max(nper, 2))))))
    return get(name, idx).noise(t0, t1, prop=prop, blades=blades, res_prom=res_prom, res_persist=res_persist, res_mask=res_mask, res_fmax=res_fmax, nper=nper)


@app.get("/api/{name}/{idx}/profile")
def profile(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    return get(name, idx).profile(prop, blades, auw)


@app.get("/api/{name}/{idx}/resonances")
def resonances(name: str, idx: int, t0: float = None, t1: float = None, prom: float = 6, persist: float = 40, mask: float = 4, fmax: float = None):
    return get(name, idx).resonances(t0, t1, prom=prom, persist=persist, mask=mask, fmax=fmax)


@app.get("/api/{name}/{idx}/playback")
def playback(name: str, idx: int, rate: float = 250):
    names, n, nm, buf = get(name, idx).playback(rate)
    return Response(buf, media_type="application/octet-stream",
                    headers={"X-Channels": ",".join(names), "X-N": str(n), "X-Motors": str(nm), "Access-Control-Expose-Headers": "X-Channels,X-N,X-Motors"})


@app.get("/api/{name}/{idx}/motors")
def motors(name: str, idx: int, t0: float = None, t1: float = None, thr_min: float = 0, thr_max: float = 100):
    return get(name, idx).motors(t0, t1, thr_min, thr_max)


@app.get("/api/{name}/{idx}/step")
def step(name: str, idx: int, t0: float = None, t1: float = None, win_s: float = 2.0, min_sp: float = 20,
         max_sp: float = 2000, thr_min: float = 0, thr_max: float = 100, prop: float = None, blades: int = None, src: str = "gyroADC"):
    src = src if src in ("gyroADC", "gyroUnfilt") else "gyroADC"
    return get(name, idx).step_response(t0, t1, win_s=win_s, min_sp=min_sp, max_sp=max_sp, thr_min=thr_min, thr_max=thr_max, prop=prop, blades=blades, src=src)


@app.get("/api/{name}/{idx}/filterplan")
def filterplan(name: str, idx: int, t0: float = None, t1: float = None, prom: float = 6, persist: float = 40, mask: float = 4, fmax: float = None,
               prop: float = None, blades: int = None):
    return get(name, idx).filterplan(t0, t1, prop=prop, blades=blades, prom=prom, persist=persist, mask=mask, fmax=fmax)


@app.get("/api/{name}/{idx}/simmodel")
def simmodel(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    return get(name, idx).simmodel(prop, blades, auw)


@app.get("/api/{name}/{idx}/plan")
def plan_(name: str, idx: int, prop: float = None, blades: int = None, auw: float = None):
    import plan
    return plan.build_plan(get(name, idx), prop, blades, auw)


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
    progress(b, bi, "compare", "Analysing the first flight", 0.05)
    ga = plan.gather(A, pa, ba, wa)
    progress(b, bi, "compare", "Analysing the second flight", 0.5)
    gb = plan.gather(B, pb, bb, wb)
    progress(b, bi, "compare", done=True)
    out = plan.compare(A, B, ga, gb)
    out["plan_b"] = plan.build_plan(B, pb, bb, wb, gb)
    return out


@app.get("/api/{name}/{idx}/{kind}")
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

