"""The compiled simulator loops (simcore, numba) compute exactly what the numpy version does."""
import numpy as np
import pytest

import sim
import simcore

pytestmark = pytest.mark.skipif(not simcore.HAVE, reason="numba not installed: only the numpy path runs")


def test_compiled_closed_loop_is_identical(short_lg, monkeypatch):
    h = short_lg.headers
    for ax in range(3):
        seg, W = sim._segments(short_lg, ax, n=8, win=1.0, min_std=0)
        if not seg:
            continue
        g = sim.pids(h)[sim.AXN[ax]]
        prm = dict(b=np.array([150., 600.]), tau=np.array([.03, .05]), d=np.array([3, 6]), a=np.array([0., 5.]), lam=np.array([0., .8]))
        kf = sim.gain_factors(short_lg, ax, seg, W, h, g)
        fast = sim.closed_loop(short_lg, ax, seg, W, h, g, prm, kf)[0]
        monkeypatch.setattr(simcore, "HAVE", False)
        kf0 = sim.gain_factors(short_lg, ax, seg, W, h, g)
        slow = sim.closed_loop(short_lg, ax, seg, W, h, g, prm, kf0)[0]
        lp0 = sim.lp_zero(slow, short_lg.fs)
        pt0 = sim._pt(slow[0], 40, short_lg.fs, 2)
        monkeypatch.setattr(simcore, "HAVE", True)
        assert np.array_equal(kf[0], kf0[0]) and np.array_equal(kf[1], kf0[1])
        assert np.allclose(fast, slow, rtol=1e-12, atol=1e-9, equal_nan=True)
        assert np.allclose(sim.lp_zero(slow, short_lg.fs), lp0, rtol=1e-12, atol=1e-9)
        assert np.allclose(sim._pt(slow[0], 40, short_lg.fs, 2), pt0, rtol=1e-12, atol=1e-9)


def test_model_cache_round_trip(short_lg):
    M = short_lg.simmodel(7.0, 2)
    assert short_lg.sim_cached(7.0, 2)
    from bbl import Log
    lg2 = Log(short_lg.path, short_lg.idx)
    assert lg2.sim_cached(7.0, 2)
    M2 = lg2.simmodel(7.0, 2)
    assert M2["axes"]["roll"]["b"] == M["axes"]["roll"]["b"] and M2["axes"]["roll"]["tau_ms"] == M["axes"]["roll"]["tau_ms"]
