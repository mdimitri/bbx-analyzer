# Changelog

Every release lists what changed for pilots first, then fixes. Screenshots, the banner and `docs/sample-report.pdf` are
regenerated from the app for every release (`python tools/release.py all`).

## 2.0 · 2026-10-11

**New**
- **Filter delay tab.** Every filter's delay at the loop's crossover frequency as stacked bars, yours next to Betaflight's
  firmware defaults (values checked against the Betaflight source) or those defaults scaled for your prop size. Hover any
  filter for its settings next to the reference's, why it delays that much, and the exact phase margin after each
  possible change, with the CLI lines. Phase margin with and without filters, P/D headroom, sweeps of lighter/heavier
  filtering against the motor noise they'd cost, delay across the throttle range.
- **Self-oscillation check.** Finds a wobble that stands out of the tracking error while the sticks are centred, and
  says whether it sits at the loop's crossover (the model and the measurement agree the axis is at its stability edge).
- **Tune plan.** Every suggestion from every analysis in the order to apply it, conflicts resolved, one CLI block.
- **Before → after.** Open two flights: what changed in the settings, what got better or worse, what to try next.
- **PDF report**, now with one section per area: flight at a glance, stick response & PID terms, noise & filters
  (spectra, noise by throttle, filter delay, margins), propwash & stability, motors & power, the learned dynamics,
  the tune plan, before → after and all findings.
- **Debug modes understood** (FFT_FREQ, DYN_LPF, RPM_FILTER frequencies on the spectrogram; others as labelled traces).
- **Raw vs filtered gyro** on Tracking, gyro overlay on PID terms, P and I in the Noise and Spectrogram tabs, vertical
  scale control (auto / same / fixed) on Tracking and PID traces.
- **All-up weight** estimated from the flight and editable, used everywhere; typical-quad comparison in the simulator.
- **Progress you can read**: each slow job shows its steps, what it's computing, results as they arrive and time left.

**Faster**
- Log decoding ~4× faster (`fastbbl`, bit-identical to orangebox).
- Learning a quad's dynamics ~3–4× faster with `numba` (installed by the launchers when available; plain numpy otherwise),
  and cached next to the log, so reopening a log skips it.

**More accurate**
- Motor lag in the learned model is anchored to the eRPM measurement (±15%) instead of being fitted freely: free fits
  wandered between 26 and 68 ms on flights of the same quad, now they stay with the measured 36–43 ms. The phase margin
  is shown with the range over equally good fits.
- Motor lag now follows the measured speed dependence (much weaker than the old 1/speed assumption).
- Simulator filter chain: all 12 RPM notches per motor, static, dynamic and D-term notches, I term through the gyro filters.
- RPM notch frequencies capped at 0.48 × the PID loop rate, as the firmware does.

**Fixed**
- False "RPM dropout / possible desync" warnings on big quads: normal spin-down after a chop and speed swings during an
  oscillation were flagged. Dropouts are now measured against the speed the command predicts through the motor's lag.
- PID-term behaviour peaks taken from a different curve than the one drawn.
- Weight estimate pulled by the flight controller's board name.
- Analyses failing on logs without raw gyro (`gyroUnfilt`).
- Chart title clicks stopping working after visiting the filter planner.
- Auto vertical scale counting data outside the visible window.

## 1.x

Earlier releases: noise & filters, spectrogram, step response, propwash, PID simulator, motor health and battery waste,
3D replay and synced video.
