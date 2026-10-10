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
        assert all(r["verdict"] in ("good", "warning", "serious", "inactive") for r in A["rows"])
        assert all(r["verdict"] == "inactive" for r in A["rows"] if r["chain"] == "dterm" and A["d_off"])
        for r in A["rows"]:
            assert r["spec"] and r["why"]
            off = [w for w in r["whatif"] if w["label"] == "off"]
            if off:                                       # switching a stage off removes exactly its own delay
                assert off[0]["ms"] == 0 and abs(off[0]["d_ms"] + r["ms"]) < 2e-3
            if len(r["parts"]) > 1 and r["key"] != "rpm":   # independent notches: their parts add up to the stage
                assert abs(sum(p[1] for p in r["parts"]) - r["ms"]) < 2e-3
            if r["typ"]:
                assert r["typ"]["spec"] and r["typ"]["src"]
    assert D["findings"]
    json.dumps(delay.analyse(short_lg, short_lg.profile(7.0, 2), M, noise, ref="size"))


def test_reference_is_the_betaflight_firmware_default():
    """Values from the Betaflight source (sensors/gyro.h, flight/pid.h, pg/dyn_notch.c, pg/rpm_filter.c)."""
    H, src = delay.typical_headers({"looptime": 125, "pid_process_denom": 2}, 7.0, True, "bf")
    assert H["gyro_lpf1_dyn_hz"] == "250,500" and H["gyro_lpf1_type"] == 0 and H["gyro_lpf1_dyn_expo"] == 5
    assert H["gyro_lpf2_static_hz"] == 500 and H["gyro_lpf2_type"] == 0
    assert H["dterm_lpf1_dyn_hz"] == "75,150" and H["dterm_lpf1_type"] == 0 and H["dterm_lpf1_dyn_expo"] == 5
    assert H["dterm_lpf2_static_hz"] == 150 and H["dterm_lpf2_type"] == 0 and H["yaw_lowpass_hz"] == 100
    assert (H["dyn_notch_count"], H["dyn_notch_q"], H["dyn_notch_min_hz"], H["dyn_notch_max_hz"]) == (3, 300, 100, 600)
    assert (H["rpm_filter_harmonics"], H["rpm_filter_q"], H["rpm_filter_min_hz"], H["rpm_filter_fade_range_hz"]) == (3, 500, 100, 50)
    assert H["rpm_filter_weights"] == "100,100,100"
    assert delay.typical_headers({}, 7.0, False, "bf")[0]["rpm_filter_harmonics"] == 0     # no bidirectional DShot: no RPM filter
    Hs, _ = delay.typical_headers({}, 5.0, True, "size")
    assert Hs["gyro_lpf1_dyn_hz"] == "250,500" and Hs["dterm_lpf1_dyn_hz"] == "75,150"     # 5″ is the baseline the defaults are tuned for


def test_filters_match_an_independent_implementation():
    """lpf()/notch() against the Betaflight difference equations written out by hand and evaluated as polynomials in z⁻¹."""
    fs, f = 4000.0, np.array([5.0, 17.0, 60.0, 200.0])
    z = np.exp(-2j * np.pi * f / fs)
    for t, n, corr in ((0, 1, 1.0), (2, 2, 1.553773974), (3, 3, 1.961459177)):        # filter.c: CUTOFF_CORRECTION_PT2 / PT3
        w = 2 * np.pi * 80 * corr / fs; k = w / (w + 1)                                  # pt1FilterGain
        assert np.allclose(lpf(f, fs, 80, t), (k / (1 - (1 - k) * z)) ** n, rtol=1e-6)
    w0 = 2 * np.pi * 150 / fs; al = np.sin(w0) / (2 * 4.0); cs = np.cos(w0)              # biquadFilterInit, FILTER_NOTCH
    Hn = (1 - 2 * cs * z + z * z) / ((1 + al) - 2 * cs * z + (1 - al) * z * z)
    assert np.allclose(notch(f, fs, 150, 4.0), Hn)
    assert np.allclose(notch(f, fs, 150, 4.0, 0.3), 0.3 * Hn + 0.7)                      # RPM-notch fade: weight·out + (1−weight)·in


def test_rpm_notch_follows_the_firmware():
    from tuning import rpm_notch
    h = {"looptime": 125, "pid_process_denom": 2, "rpm_filter_min_hz": 100, "rpm_filter_fade_range_hz": 50}
    assert rpm_notch(h, 300) == (300, 1.0)
    assert rpm_notch(h, 125) == (125, pytest.approx(0.5))          # inside the fade range: weight = margin / fade range
    assert rpm_notch(h, 80) == (100, 0.0)                          # held at the minimum, faded out
    f, w = rpm_notch(h, 2500)                                      # capped at 0.48 × the 4 kHz PID loop rate
    assert f == pytest.approx(1920) and w == 1.0


def test_explanations_quote_the_closed_form_rule():
    S = delay.stages({"looptime": 125, "pid_process_denom": 2, "gyro_lpf2_type": 0, "gyro_lpf2_static_hz": 500}, 0.3, None, [])
    st = S[0]; ms = delay.delay_at(st["H"], 17.0)
    txt = delay.explain(st, 17.0, ms)
    assert f"{1000 / (2 * np.pi * 500):.2f} ms" in txt and f"{ms:.2f} ms" in txt

