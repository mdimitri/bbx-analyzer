"""Units (gyro_scale, high-resolution logging) and debug-mode tables."""
import struct

import numpy as np
import pytest

import debugmodes


class FakeLog:
    """Just enough of bbl.Log for _derive and debugmodes.report."""
    def __init__(self, headers, cols):
        self.headers, self.cols, self.fs = headers, cols, 1000.0


def derive(headers, cols):
    from bbl import Log
    lg = FakeLog(headers, cols)
    Log._derive(lg)
    return lg


def base_cols(n=100):
    return {"setpoint[3]": np.full(n, 500, np.float32), **{f"{k}[{i}]": np.full(n, 123, np.float32) for k in ("gyroADC", "gyroUnfilt", "setpoint", "rcCommand") for i in range(3)},
            "rcCommand[3]": np.full(n, 1500, np.float32)}


def test_normal_resolution_is_left_alone():
    lg = derive({"Firmware type": "Betaflight", "gyro_scale": 0x3F800000, "blackbox_high_resolution": 0}, base_cols())
    assert lg.cols["gyroADC[0]"][0] == 123 and lg.units["step_dps"] == 1.0


def test_high_resolution_divides_by_ten_like_blackbox_explorer():
    lg = derive({"Firmware type": "Betaflight", "gyro_scale": 0x3F800000, "blackbox_high_resolution": 1}, base_cols())
    assert lg.cols["gyroADC[0]"][0] == pytest.approx(12.3)
    assert lg.cols["gyroUnfilt[2]"][0] == pytest.approx(12.3)
    assert lg.cols["setpoint[1]"][0] == pytest.approx(12.3)
    assert lg.cols["rcCommand[3]"][0] == pytest.approx(150.0)
    assert lg.cols["throttle%"][0] == pytest.approx(50.0)       # setpoint[3] (0–1000) is NOT scaled
    assert lg.units["high_res"] and lg.units["step_dps"] == pytest.approx(0.1)


def test_gyro_scale_float_bit_pattern():
    gs = struct.unpack("<I", struct.pack("<f", 0.5))[0]
    lg = derive({"Firmware type": "Betaflight", "gyro_scale": gs, "blackbox_high_resolution": 0}, base_cols())
    assert lg.cols["gyroADC[0]"][0] == pytest.approx(61.5)


@pytest.mark.parametrize("rev,num,name", [
    ("Betaflight 2025.12.0-RC4 (37800445d) STM32F7X2", 16, "FFT_FREQ"),
    ("Betaflight 4.5.1 (77d01ba3b) STM32F405", 17, "FFT_FREQ"),
    ("Betaflight 4.4.3 (738127e7e) STM32F7X2", 46, "RPM_FILTER"),
    ("Betaflight 4.3.2 (aa7b2b0e8) STM32F405", 59, "FEEDFORWARD"),
    ("Betaflight 2025.12.1 (x) STM32H743", 47, "D_MAX"),
    ("Betaflight 4.5.0 (x) STM32F7X2", 47, "D_MIN"),
])
def test_debug_mode_numbers_follow_the_firmware(rev, num, name):
    assert debugmodes.mode({"Firmware revision": rev, "Firmware type": "Betaflight", "debug_mode": num})[0] == name


def test_fft_freq_channels_and_stuck_notch_check():
    n = 4000
    thr = np.linspace(10, 80, n).astype(np.float32)
    cols = {"throttle%": thr, "debug[0]": np.random.default_rng(0).normal(0, 20, n).astype(np.float32),
            "debug[1]": (150 + 3 * thr).astype(np.float32), "debug[2]": np.full(n, 150, np.float32)}
    lg = FakeLog({"Firmware revision": "Betaflight 2025.12.0", "Firmware type": "Betaflight", "debug_mode": 16, "gyro_debug_axis": 0,
                  "dyn_notch_min_hz": 150, "dyn_notch_max_hz": 600}, cols)
    r = debugmodes.report(lg)
    assert r["mode"] == "FFT_FREQ"
    assert [c["label"] for c in r["channels"]][:2] == ["gyro before the dynamic notch (dbg axis)", "dynamic notch 1 centre"]
    titles = " | ".join(f["title"] for f in r["findings"])
    assert "notch 1 centre moves with the noise" in titles
    assert "notch 2 centre sits at its minimum" in titles


def test_no_debug_fields_is_quiet():
    lg = FakeLog({"Firmware revision": "Betaflight 2025.12.0", "debug_mode": 0}, {"throttle%": np.zeros(10)})
    r = debugmodes.report(lg)
    assert r["mode"] is None and r["channels"] == []
