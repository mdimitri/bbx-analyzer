"""Betaflight debug modes: which mode a log used, and what each debug[] channel means.

The debug_mode header is a number whose meaning shifts between firmware versions (2025.x removed GYRO_SCALED, so
FFT_FREQ is 16 there and 17 on 4.3–4.5). The tables below are the debugType_e enums of the release tags, and the
channel meanings come from the DEBUG_SET calls in each firmware's source.
"""
import re
import numpy as np

ENUMS = {"4.3":["NONE","CYCLETIME","BATTERY","GYRO_FILTERED","ACCELEROMETER","PIDLOOP","GYRO_SCALED","RC_INTERPOLATION","ANGLERATE","ESC_SENSOR","SCHEDULER","STACK","ESC_SENSOR_RPM","ESC_SENSOR_TMP","ALTITUDE","FFT","FFT_TIME","FFT_FREQ","RX_FRSKY_SPI","RX_SFHSS_SPI","GYRO_RAW","DUAL_GYRO_RAW","DUAL_GYRO_DIFF","MAX7456_SIGNAL","MAX7456_SPICLOCK","SBUS","FPORT","RANGEFINDER","RANGEFINDER_QUALITY","LIDAR_TF","ADC_INTERNAL","RUNAWAY_TAKEOFF","SDIO","CURRENT_SENSOR","USB","SMARTAUDIO","RTH","ITERM_RELAX","ACRO_TRAINER","RC_SMOOTHING","RX_SIGNAL_LOSS","RC_SMOOTHING_RATE","ANTI_GRAVITY","DYN_LPF","RX_SPEKTRUM_SPI","DSHOT_RPM_TELEMETRY","RPM_FILTER","D_MIN","AC_CORRECTION","AC_ERROR","DUAL_GYRO_SCALED","DSHOT_RPM_ERRORS","CRSF_LINK_STATISTICS_UPLINK","CRSF_LINK_STATISTICS_PWR","CRSF_LINK_STATISTICS_DOWN","BARO","GPS_RESCUE_THROTTLE_PID","DYN_IDLE","FEEDFORWARD_LIMIT","FEEDFORWARD","BLACKBOX_OUTPUT","GYRO_SAMPLE","RX_TIMING","D_LPF","VTX_TRAMP","GHST","SCHEDULER_DETERMINISM","TIMING_ACCURACY","RX_EXPRESSLRS_SPI","RX_EXPRESSLRS_PHASELOCK","RX_STATE_TIME"],"4.4":["NONE","CYCLETIME","BATTERY","GYRO_FILTERED","ACCELEROMETER","PIDLOOP","GYRO_SCALED","RC_INTERPOLATION","ANGLERATE","ESC_SENSOR","SCHEDULER","STACK","ESC_SENSOR_RPM","ESC_SENSOR_TMP","ALTITUDE","FFT","FFT_TIME","FFT_FREQ","RX_FRSKY_SPI","RX_SFHSS_SPI","GYRO_RAW","DUAL_GYRO_RAW","DUAL_GYRO_DIFF","MAX7456_SIGNAL","MAX7456_SPICLOCK","SBUS","FPORT","RANGEFINDER","RANGEFINDER_QUALITY","LIDAR_TF","ADC_INTERNAL","RUNAWAY_TAKEOFF","SDIO","CURRENT_SENSOR","USB","SMARTAUDIO","RTH","ITERM_RELAX","ACRO_TRAINER","RC_SMOOTHING","RX_SIGNAL_LOSS","RC_SMOOTHING_RATE","ANTI_GRAVITY","DYN_LPF","RX_SPEKTRUM_SPI","DSHOT_RPM_TELEMETRY","RPM_FILTER","D_MIN","AC_CORRECTION","AC_ERROR","DUAL_GYRO_SCALED","DSHOT_RPM_ERRORS","CRSF_LINK_STATISTICS_UPLINK","CRSF_LINK_STATISTICS_PWR","CRSF_LINK_STATISTICS_DOWN","BARO","GPS_RESCUE_THROTTLE_PID","DYN_IDLE","FEEDFORWARD_LIMIT","FEEDFORWARD","BLACKBOX_OUTPUT","GYRO_SAMPLE","RX_TIMING","D_LPF","VTX_TRAMP","GHST","GHST_MSP","SCHEDULER_DETERMINISM","TIMING_ACCURACY","RX_EXPRESSLRS_SPI","RX_EXPRESSLRS_PHASELOCK","RX_STATE_TIME","GPS_RESCUE_VELOCITY","GPS_RESCUE_HEADING","GPS_RESCUE_TRACKING","ATTITUDE","VTX_MSP","GPS_DOP","FAILSAFE"],"4.5":["NONE","CYCLETIME","BATTERY","GYRO_FILTERED","ACCELEROMETER","PIDLOOP","GYRO_SCALED","RC_INTERPOLATION","ANGLERATE","ESC_SENSOR","SCHEDULER","STACK","ESC_SENSOR_RPM","ESC_SENSOR_TMP","ALTITUDE","FFT","FFT_TIME","FFT_FREQ","RX_FRSKY_SPI","RX_SFHSS_SPI","GYRO_RAW","DUAL_GYRO_RAW","DUAL_GYRO_DIFF","MAX7456_SIGNAL","MAX7456_SPICLOCK","SBUS","FPORT","RANGEFINDER","RANGEFINDER_QUALITY","LIDAR_TF","ADC_INTERNAL","RUNAWAY_TAKEOFF","SDIO","CURRENT_SENSOR","USB","SMARTAUDIO","RTH","ITERM_RELAX","ACRO_TRAINER","RC_SMOOTHING","RX_SIGNAL_LOSS","RC_SMOOTHING_RATE","ANTI_GRAVITY","DYN_LPF","RX_SPEKTRUM_SPI","DSHOT_RPM_TELEMETRY","RPM_FILTER","D_MIN","AC_CORRECTION","AC_ERROR","DUAL_GYRO_SCALED","DSHOT_RPM_ERRORS","CRSF_LINK_STATISTICS_UPLINK","CRSF_LINK_STATISTICS_PWR","CRSF_LINK_STATISTICS_DOWN","BARO","GPS_RESCUE_THROTTLE_PID","DYN_IDLE","FEEDFORWARD_LIMIT","FEEDFORWARD","BLACKBOX_OUTPUT","GYRO_SAMPLE","RX_TIMING","D_LPF","VTX_TRAMP","GHST","GHST_MSP","SCHEDULER_DETERMINISM","TIMING_ACCURACY","RX_EXPRESSLRS_SPI","RX_EXPRESSLRS_PHASELOCK","RX_STATE_TIME","GPS_RESCUE_VELOCITY","GPS_RESCUE_HEADING","GPS_RESCUE_TRACKING","GPS_CONNECTION","ATTITUDE","VTX_MSP","GPS_DOP","FAILSAFE","GYRO_CALIBRATION","ANGLE_MODE","ANGLE_TARGET","CURRENT_ANGLE","DSHOT_TELEMETRY_COUNTS","RPM_LIMIT","RC_STATS","MAG_CALIB","MAG_TASK_RATE","EZLANDING"],"2025.12":["NONE","CYCLETIME","BATTERY","GYRO_FILTERED","ACCELEROMETER","PIDLOOP","RC_INTERPOLATION","ANGLERATE","ESC_SENSOR","SCHEDULER","STACK","ESC_SENSOR_RPM","ESC_SENSOR_TMP","ALTITUDE","FFT","FFT_TIME","FFT_FREQ","RX_FRSKY_SPI","RX_SFHSS_SPI","GYRO_RAW","MULTI_GYRO_RAW","MULTI_GYRO_DIFF","MAX7456_SIGNAL","MAX7456_SPICLOCK","SBUS","FPORT","RANGEFINDER","RANGEFINDER_QUALITY","OPTICALFLOW","LIDAR_TF","ADC_INTERNAL","RUNAWAY_TAKEOFF","SDIO","CURRENT_SENSOR","USB","SMARTAUDIO","RTH","ITERM_RELAX","ACRO_TRAINER","RC_SMOOTHING","RX_SIGNAL_LOSS","RC_SMOOTHING_RATE","ANTI_GRAVITY","DYN_LPF","RX_SPEKTRUM_SPI","DSHOT_RPM_TELEMETRY","RPM_FILTER","D_MAX","AC_CORRECTION","AC_ERROR","MULTI_GYRO_SCALED","DSHOT_RPM_ERRORS","CRSF_LINK_STATISTICS_UPLINK","CRSF_LINK_STATISTICS_PWR","CRSF_LINK_STATISTICS_DOWN","BARO","AUTOPILOT_ALTITUDE","DYN_IDLE","FEEDFORWARD_LIMIT","FEEDFORWARD","BLACKBOX_OUTPUT","GYRO_SAMPLE","RX_TIMING","D_LPF","VTX_TRAMP","GHST","GHST_MSP","SCHEDULER_DETERMINISM","TIMING_ACCURACY","RX_EXPRESSLRS_SPI","RX_EXPRESSLRS_PHASELOCK","RX_STATE_TIME","GPS_RESCUE_VELOCITY","GPS_RESCUE_HEADING","GPS_RESCUE_TRACKING","GPS_CONNECTION","ATTITUDE","VTX_MSP","GPS_DOP","FAILSAFE","GYRO_CALIBRATION","ANGLE_MODE","ANGLE_TARGET","CURRENT_ANGLE","DSHOT_TELEMETRY_COUNTS","RPM_LIMIT","RC_STATS","MAG_CALIB","MAG_TASK_RATE","EZLANDING","TPA","S_TERM","SPA","TASK","GIMBAL","WING_SETPOINT","AUTOPILOT_POSITION","CHIRP","FLASH_TEST_PRBS","MAVLINK_TELEMETRY"]}

# channel: (label, unit, scale) — value shown = logged / scale. "dbg" = the axis chosen by gyro_debug_axis.
CHANNELS = {
    "FFT_FREQ": {"2025": {0: ("gyro before the dynamic notch (dbg axis)", "°/s", 1), **{i: (f"dynamic notch {i} centre", "Hz", 1) for i in range(1, 8)}},
                 "4": {0: ("dynamic notch 1 centre", "Hz", 1), 1: ("dynamic notch 2 centre", "Hz", 1), 2: ("dynamic notch 3 centre", "Hz", 1), 3: ("gyro before the dynamic notch (dbg axis)", "°/s", 1)}},
    "DYN_LPF": {0: ("gyro before filtering (dbg axis)", "°/s", 1), 1: ("dynamic notch 1 centre", "Hz", 1), 2: ("dynamic gyro low-pass cutoff", "Hz", 1), 3: ("gyro after the dynamic notch (dbg axis)", "°/s", 1)},
    "RPM_FILTER": {i: (f"motor {i + 1} rotation (RPM-filter input)", "Hz", 1) for i in range(4)},
    "D_MAX": {0: ("D max: gyro factor", "%", 1), 1: ("D max: setpoint factor", "%", 1), 2: ("effective D (after the D max boost)", "", 10), 3: ("D max multiplier", "%", 1)},
    "D_MIN": {0: ("D min: gyro factor", "%", 1), 1: ("D min: setpoint factor", "%", 1), 2: ("effective D roll", "", 10), 3: ("effective D pitch", "", 10)},
    "FEEDFORWARD": {0: ("setpoint (dbg axis)", "°/s", 1), 1: ("setpoint speed", "°/s²÷100", 1), 2: ("feedforward boost", "", 1), 3: ("stick change", "×10", 1),
                    4: ("jitter attenuation", "%", 1), 5: ("duplicate RC packet", "", 1), 6: ("yaw feedforward", "", 1), 7: ("yaw feedforward with hold", "", 1)},
    "FEEDFORWARD_LIMIT": {0: ("jitter attenuation", "%", 1), 1: ("max setpoint rate", "°/s", 1), 2: ("setpoint for FF (unsmoothed)", "°/s", 1), 3: ("feedforward (unsmoothed)", "", 1),
                          4: ("setpoint speed, unsmoothed", "", 1), 5: ("setpoint speed, smoothed", "", 1), 6: ("smoothing k", "×1000", 1), 7: ("RX rate (smoothed)", "Hz", 1)},
    "RC_SMOOTHING": {0: ("RX rate", "Hz", 1), 1: ("RX rate used for cutoffs", "Hz", 1), 2: ("setpoint smoothing cutoff", "Hz", 1), 3: ("throttle smoothing cutoff", "Hz", 1),
                     4: ("smoothing k", "×1000", 1), 5: ("RX rate (smoothed)", "Hz", 1), 6: ("RX outliers", "", 1), 7: ("RX valid frames", "", 1)},
    "DYN_IDLE": {0: ("dynamic idle P", "×10⁴", 1), 1: ("dynamic idle I", "×10⁴", 1), 2: ("dynamic idle D", "×10⁴", 1), 3: ("minimum motor speed", "rev/s", 10)},
    "TPA": {0: ("TPA factor", "", 1000), 1: ("roll attitude", "°", 10), 2: ("pitch attitude", "°", 10), 3: ("throttle for TPA", "‰", 1), 4: ("speed for TPA", "", 10), 5: ("TPA argument", "", 1000)},
    "ANTI_GRAVITY": {0: ("throttle change rate", "×100", 1), 1: ("throttle change rate", "×100", 1), 2: ("I boost (pitch)", "×1000", 1), 3: ("P boost", "×1000", 1)},
    "ITERM_RELAX": {0: ("setpoint high-pass", "°/s", 1), 1: ("I-term relax factor", "%", 1), 2: ("I-term error rate", "°/s", 1), 3: ("absolute control correction", "", 10)},
    "GYRO_FILTERED": {0: ("gyro roll, filtered", "°/s", 1), 1: ("gyro pitch, filtered", "°/s", 1), 2: ("gyro yaw, filtered", "°/s", 1)},
    "GYRO_SCALED": {0: ("gyro roll, before filtering", "°/s", 1), 1: ("gyro pitch, before filtering", "°/s", 1), 2: ("gyro yaw, before filtering", "°/s", 1)},
    "GYRO_RAW": {0: ("gyro roll, sensor counts", "", 1), 1: ("gyro pitch, sensor counts", "", 1), 2: ("gyro yaw, sensor counts", "", 1), 3: ("gyro calibration noise", "", 1)},
}
FREQ_MODES = {"FFT_FREQ", "DYN_LPF", "RPM_FILTER"}   # modes with frequencies to draw on the spectrogram


def family(h):
    rev = str(h.get("Firmware revision", ""))
    if "Betaflight" not in str(h.get("Firmware type", "Betaflight")) and "Betaflight" not in rev:
        return None
    m = re.search(r"Betaflight\s+(\d+)\.(\d+)", rev)
    if not m:
        return "2025.12"
    a, b = int(m.group(1)), int(m.group(2))
    if a >= 2025:
        return "2025.12"
    return {3: "4.3", 4: "4.4"}.get(b, "4.5") if a == 4 and b >= 3 else "4.3" if a == 4 else "2025.12"


def mode(h):
    """(name, family) of the log's debug mode, or (None, family) when off / unknown."""
    fam = family(h)
    try:
        n = int(float(h.get("debug_mode", 0) or 0))
    except ValueError:
        return None, fam
    E = ENUMS.get(fam or "2025.12")
    return (E[n] if 0 < n < len(E) else None), fam


def channels(name, fam):
    c = CHANNELS.get(name)
    if c is None:
        return None
    if "2025" in c or "4" in c:
        return c["2025" if (fam or "").startswith("2025") else "4"]
    return c


def report(lg):
    """The debug channels of this log with their meaning, plus derived checks for the frequency modes."""
    h, c = lg.headers, lg.cols
    name, fam = mode(h)
    present = [i for i in range(8) if f"debug[{i}]" in c and np.any(c[f"debug[{i}]"] != 0)]
    out = dict(mode=name, family=fam, number=int(float(h.get("debug_mode", 0) or 0)), axis=int(float(h.get("gyro_debug_axis", 0) or 0)), channels=[], freq=None)
    if not name or not present:
        return out
    ch = channels(name, fam) or {}
    for i in present:
        lab, unit, sc = ch.get(i, (f"debug[{i}]", "", 1))
        out["channels"].append(dict(i=i, field=f"debug[{i}]", label=lab, unit=unit, scale=sc))
    if name in FREQ_MODES:
        fi = [x for x in out["channels"] if x["unit"] == "Hz"]
        thr = c["throttle%"]; air = thr > 8
        bins = np.arange(0, 101, 5)
        lines = []
        for x in fi:
            v = c[x["field"]].astype(float) / x["scale"]
            ok = air & (v > 0)
            if ok.sum() < lg.fs:
                continue
            med = [float(np.median(v[ok & (thr >= a) & (thr < a + 5)])) if (ok & (thr >= a) & (thr < a + 5)).sum() > 20 else None for a in bins[:-1]]
            lines.append(dict(label=x["label"], field=x["field"], thr=(bins[:-1] + 2.5).tolist(), hz=[None if m is None else round(m, 1) for m in med],
                              median=round(float(np.median(v[ok])), 1), lo=round(float(np.percentile(v[ok], 5)), 1), hi=round(float(np.percentile(v[ok], 95)), 1)))
        out["freq"] = lines
        out["findings"] = _notch_checks(lg, name, lines)
    return out


def _notch_checks(lg, name, lines):
    """Dynamic notches pinned at their limits = the noise they should chase is outside dyn_notch_min/max_hz."""
    from tuning import finding, hnum
    F = []
    if name not in ("FFT_FREQ", "DYN_LPF"):
        return F
    lo, hi = hnum(lg.headers, "dyn_notch_min_hz", 0)[0], hnum(lg.headers, "dyn_notch_max_hz", 0)[0]
    thr = lg.cols["throttle%"]; air = thr > 8
    for ln in lines:
        if "notch" not in ln["label"]:
            continue
        v = lg.cols[ln["field"]].astype(float)[air]
        v = v[v > 0]
        if len(v) < lg.fs or not lo:
            continue
        at_lo, at_hi = float(np.mean(v <= lo + 2)), float(np.mean(v >= hi - 2)) if hi else 0.0
        if at_lo > 0.4:
            F.append(finding("warning" if at_lo > 0.7 else "info", f"{ln['label'].capitalize()} sits at its minimum ({lo:.0f} Hz) {at_lo * 100:.0f}% of the time",
                             "The noise it should follow is below dyn_notch_min_hz, or there is nothing strong enough to track.",
                             "A notch pinned at its limit only adds delay. If the Spectrogram shows the noise lower down, lower dyn_notch_min_hz; if there is nothing to track (RPM filter on), use fewer dynamic notches.",
                             f"Check the Spectrogram (debug lines on) before changing it: set dyn_notch_min_hz = {max(50, int(lo * 0.8))} or set dyn_notch_count = 1.", "A lower notch costs more delay where the PID loop works."))
        elif at_hi > 0.4:
            F.append(finding("info", f"{ln['label'].capitalize()} sits at its maximum ({hi:.0f} Hz) {at_hi * 100:.0f}% of the time",
                             "The noise it should follow is above dyn_notch_max_hz.", "Raise dyn_notch_max_hz if the Spectrogram shows strong noise above it.",
                             f"set dyn_notch_max_hz = {int(min(1000, hi * 1.3))}", "A wider search range makes the tracking a little less precise."))
        else:
            F.append(finding("good", f"{ln['label'].capitalize()} moves with the noise ({ln['lo']:.0f}–{ln['hi']:.0f} Hz)",
                             "It stays inside its range and follows the throttle; the Spectrogram's debug lines show where.", "", "", ""))
    return F
