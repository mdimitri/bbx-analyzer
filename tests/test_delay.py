"""Filter-delay analysis: the maths checked against closed-form results, and the full analysis on a real log."""
import json

import numpy as np
import pytest

import delay
from tuning import lpf, notch, dyn_cutoff


def test_margins_on_a_textbook_loop():
    """L = K·e^(−sτ)/s: crossover at K/2π, phase margin 90° − 360°·f_c·τ, gain margin at f180 = 1/(4τ)."""
    K, tau = 2 * np.pi * 20, 0.004
    f = np.geomspace(0.5, 2000, 4000)
    s = 2j * np.pi * f
    m = delay.margins(K * np.exp(-s * tau) / s, f)
    assert m["fc"] == pytest.approx(20, rel=1e-3)
    assert m["pm"] == pytest.approx(90 - 360 * 20 * tau, abs=0.05)
    assert m["f180"] == pytest.approx(1 / (4 * tau), rel=1e-3)
    assert m["gm"] == pytest.approx(-20 * np.log10(K / (2 * np.pi * m["f180"])), abs=0.02)


def test_pt1_phase_delay_matches_closed_form():
    """Betaflight PT1 (k = ω/(ω+1), ω = 2π·fc/fs): exact phase of k / (1 − (1−k)·z⁻¹)."""
    fs, fc, f0 = 4000.0, 100.0, 15.0
    w = 2 * np.pi * fc / fs; k = w / (w + 1)
    th = 2 * np.pi * f0 / fs
    ph = -np.arctan2((1 - k) * np.sin(th), 1 - (1 - k) * np.cos(th))
    expected = -ph / (2 * np.pi * f0) * 1000
    assert delay.delay_at(lambda f: lpf(f, fs, fc, 0), f0) == pytest.approx(expected, rel=1e-6)


def test_notch_delays_low_frequencies_by_about_one_over_q_omega():
    fs, f0, q = 4000.0, 200.0, 5.0
    d = delay.delay_at(lambda f: notch(f, fs, f0, q), 5.0)
    assert d == pytest.approx(1000 / (q * 2 * np.pi * f0), rel=0.05)


def test_phase_delays_add_up():
    h = {"looptime": 125, "pid_process_denom": 2, "gyro_lpf1_type": 0, "gyro_lpf1_dyn_hz": "200,400", "gyro_lpf2_type": 0, "gyro_lpf2_static_hz": 500,
         "gyro_notch_hz": "150,0", "gyro_notch_cutoff": "120,0", "dterm_lpf1_type": 2, "dterm_lpf1_dyn_hz": "60,120", "dterm_lpf2_type": 0,
         "dterm_lpf2_static_hz": 150, "rpm_filter_harmonics": 3, "dshot_bidir": 1, "rpm_filter_q": 500, "rpm_filter_min_hz": 80, "dyn_notch_count": 1, "dyn_notch_q": 500}
    S = delay.stages(h, 0.3, [120, 125, 118, 122], [180])
    fc = 17.0
    total = delay.delay_at(lambda f: delay.chain(S, f, ("gyro", "dterm")), fc)
    parts = sum(delay.delay_at(s["H"], fc) for s in S if s["chain"] in ("gyro", "dterm"))
    assert total == pytest.approx(parts, rel=1e-9)
    keys = {s["key"] for s in S}
    assert {"gyro_lpf1", "gyro_lpf2", "gyro_notch", "rpm", "dyn_notch", "dterm_lpf1", "dterm_lpf2"} <= keys


def test_dynamic_lowpass_cutoff_follows_the_firmware():
    assert dyn_cutoff(0.5, 200, 400, 5) == pytest.approx(200 * (0.5 * 0.5 * 0.5 + 0.5) + 200)        # dynLpfCutoffFreq
    t = 0.4
    assert dyn_cutoff(t, 200, 400, 0) == pytest.approx(max(t * (1 - t * t / 3) * 1.5 * 400, 200))     # dynThrottle branch
    assert dyn_cutoff(0.05, 200, 400, 0) == 200


def test_full_analysis_on_a_real_log(short_lg):
    import plan
    noise = plan._memo(short_lg, ("noise", 7.0, 2), lambda: short_lg.noise(prop=7.0, blades=2))
    M = short_lg.simmodel(7.0, 2)
    D = delay.analyse(short_lg, short_lg.profile(7.0, 2), M, noise)
    json.dumps(D)                                       # JSON-ready (no numpy scalars)
    assert D["axes"], "no axis analysed"
    for a, A in D["axes"].items():
        assert A["fc"] > 0 and A["margins"]["now"]["pm"] is not None
        assert A["margins"]["none"]["pm"] >= A["margins"]["now"]["pm"] - 1e-6     # filters never add phase margin
        assert abs(A["d_ms"] - sum(r["ms"] for r in A["rows"] if r["chain"] in ("gyro", "dterm"))) < 1e-2
        assert len(A["sweep"]) == 3 and len(A["sweep"][0]["pm"]) == len(A["mults"])
        assert all(r["verdict"] in ("good", "warning", "serious") for r in A["rows"])
    assert D["findings"]
