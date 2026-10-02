# BBX Analyzer: technical notes

A small Python backend (FastAPI + numpy) with a single-page Plotly frontend.

## Start it
See the main [README](../README.md). The launchers (`start.bat`, `start.command` → `start.sh`) create a private `.venv`
in the project folder with Python 3.10–3.13 (preferring 3.13 → 3.10). If none is installed, or package install fails with
it, they fetch a private Python 3.12 with [uv](https://docs.astral.sh/uv/) into `.tools/`. Dependencies are reinstalled
only when `requirements.txt` changes. First successful start creates an app shortcut with the icon (Windows: Desktop +
folder `.lnk`; macOS: `BBX Analyzer.app` in the folder; Linux: `~/.local/share/applications/bbx-analyzer.desktop`).
Plotly is bundled in `static/vendor/`, so the app works offline after the first setup.

Drop `.BBL` files onto the page or into `logs/`. The first open decodes the log (~10 s for a 9 MB log, with live progress).
After that it's cached as `logs/<name>.<n>.npz` and loads in under half a second.

## Layout
| file | what |
|---|---|
| `app.py` | API routes, decode lock, LRU of open logs |
| `bbl.py` | decode → numpy columns, derived fields, spectrogram, step response |
| `tuning.py` | Betaflight filter models (PT1/PT2/PT3/biquad/notch/RPM/dyn-notch from header), noise report, step metrics and the advice rules |
| `flight.py` | PID-term balance (I bias, wind-up, PID-sum clipping, D/P noise share, FF jitter), motor-output headroom (100 % / minimum hits, hover output, command buzz), propwash after throttle chops and stick-to-motion latency |
| `sim.py` | PID simulator model: motor lag/delay measured from eRPM, effective P/D gains measured from the logged terms, plant (authority, damping, yaw spin-up torque) fitted by closed-loop output error + frequency response; per-craft memory for axes a flight didn't exercise |
| `static/pidsim.js` | browser-side closed-loop simulation at the PID loop rate, loop margins / sensitivity, auto-suggest |
| `quad.py` | quad profile: prop size & blade count estimated from the log (hover motor speed + weight prior, blade-pass harmonics), size-scaled reference values |
| `motors.py` | motor & prop health: per-motor order tracking (1×/2×/3×), load balance (CG / yaw / single motor), RPM-per-command, desync detection |
| `static/player.js` | playback: timeline player (play/pause, drag-scrub, speed/zoom), canvas 3D quad viewer (Mahony attitude, wobble & shake layers), live hooks |
| `static/timesync.js` | synced time navigation: drag-to-pan on every time chart; click a chart, then the wheel zooms; all time axes and the docked playback strip share one view window; during playback the playhead stays centred and the data scrolls |
| `static/planner.js` | Noise tab → Filter planner: what-if notches / low-pass changes on the measured spectra, delay, CLI |
| `static/behaviour.js` | PID terms → Behaviour: still-stick term spectra, oscillation type, D vibration, P–D / FF balance |
| `static/about.js` | About dialog (author, thanks, licence) |
| `static/glossary.js` | tooltip texts (TL;DR + detailed) and sidebar grouping. Edit freely |
| `static/` | `index.html`, `style.css` (light/dark tokens), `app.js` (state → fetch → Plotly) |

## API (`/api/{file}/{sublog}/…`, all take optional `t0,t1` seconds)
- `meta`: stats, field list, all headers, key tuning headers
- `series?fields=a,b&n=2000`: min/max-envelope decimated time series (spikes survive)
- `psd?fields=…`: Welch PSD in dB
- `noise`: PSDs (raw/filtered/D-term), modelled filter responses, noise bands, filter delay, findings
- `spectrogram?field=…&mode=throttle|time`: heatmap (rows = throttle 0–100% or time, cols = frequency), motor Hz overlay, shared auto colour limits
- `playback?rate=250`: block-averaged float32 channels (binary) for the player and 3D viewer
- `resonances?prom&persist&mask`: frame-resonance detector (fixed-frequency peaks across throttle bands, motor harmonics masked)
- `profile?prop&blades`: prop estimate with evidence and confidence, the size used, size-scaled thresholds and typical settings
- `motors`: per-motor vibration by order, vs speed and over time, load offsets, RPM deviation, dropouts, diagnosis
- `pidterms`, `motorout`, `propwash` (all take `t0,t1,prop,blades`): interpretation layers for the PID terms (incl. `behaviour`), Motors and Propwash tabs. `propwash` also takes the detection settings `chop` (%/s), `drop` (%), `win` (s), `stick` (°/s²), `skip` (ms), `flo`/`fhi` (Hz), `minev`
- `filterplan?prom&persist&mask&fmax`: spectra, current filter stages, notch proposals, RPM-fade fix for the filter planner
- `step?win_s&min_sp&max_sp&thr_min&thr_max&src`: step response (`src=gyroADC` filtered, default, or `gyroUnfilt` raw), median + IQR + n per axis, metrics, verdict, costed suggestions, suggested PIDs

## How the advice works
All advice comes from heuristics. Treat it as a starting point, and change one thing at a time.
- **Filter delay** = phase delay at 100 Hz of the low-pass stages, modelled at the window's mean throttle.
- **RPM filter check** tracks each motor's eRPM per 0.25 s window and compares raw vs filtered gyro at exactly those harmonics.
- **Frame resonances** = peaks that remain in the raw gyro after masking out all motor harmonics.
- **Step metrics** come from the 6 ms-smoothed median step response. Thresholds live in `tuning.step_advice`. The shaded band is the 95% CI of the median (1.2533·σ/√n, σ from the IQR) or the IQR itself. Filtered gyro is the default: it is what the PID loop sees and gives a tighter estimate; raw gyro shows the latency the filters add.
- **Suggested PIDs** (`tuning.pid_suggest`) take one cautious step from the filtered-gyro metrics: overshoot → more D (or less P when the D-term is already noisy), slow rise → more P/FF, ringing → more D or less P, steady-state error → I. Step size shrinks with prop size (12 % at 5″). Needs ≥ 10 windows per axis. Output includes a CLI snippet and slider equivalents when simplified tuning is on.

## Derived fields
`throttle%`, `motor%[i]` (from `motorOutput` range), `motorHz[i]` (bidir eRPM ÷ pole pairs).

## Adding an analysis
1. Add a method on `Log` in `bbl.py` that returns JSON-able dicts.
2. Add a route in `app.py`.
3. Add a `renderX()` in `app.js`, then register it in `RENDER` and add a tab button.
- **Motor health** demodulates the raw gyro at each motor's own eRPM-integrated phase (order tracking), so vibration is attributed to a specific motor. Motors are compared only at equal RPM. It assumes Betaflight's default Quad X motor order.
- **3D viewer**: attitude = gyro integrated with gentle accelerometer levelling (Mahony, gated to ~1 g). Axes are body FLU exactly as Betaflight logs them. Yaw has no magnetometer, so it drifts slowly.
- **Frame resonances**: every motor harmonic up to Nyquist (from eRPM, ± mask %) is masked out of the raw gyro spectrum of each throttle band. A peak that stays at the same frequency (drift ≤ 4 %) in at least 4 bands, in the consistency share of the throttle span where it shows, and sticks out of a frequency-scaled local baseline by the prominence, is structural. The whole spectrum is searched by default (adjustable).
- **Where extra battery goes** (Motor health): an electrical model per flight (duty = a·speed + b·speed², back-EMF + resistive part, fitted on steady flight) turns the motor command swings you make while holding attitude into extra battery power: swings faster than the rotor can follow move current back and forth through the resistance (heat, not thrust). Split 3–80 Hz / above 80 Hz, with a range from refitting on each third of the flight, and a cost-by-frequency chart that names the source (resonance, motor order, loop, noise). Prop side: at equal thrust, unequal motor speeds cost ≈ 1.5 × the variance of relative speed (steady imbalance). Thrust-to-weight = (full-throttle / hover speed)², measured or (only when the motors got close to full) extrapolated.
- **Prop size** comes from hover physics: each motor carries ¼ of the weight and thrust = Ct·ρ·n²·D⁴, so the measured hover speed gives the diameter once the weight is known. Only flight data is used (never the craft or board name). Weight comes from the typical weight for that size (D ∝ W^¼, so weight errors shrink). Blade count comes from which blade-pass harmonic (2× or 3×) dominates. When the evidence disagrees, the app asks you to confirm. Your value then drives expected rise time, filter-delay guidance, resonance search range and typical-settings comparisons.

## Viewer physics
- **Rotation** is the gyro integrated to attitude (Mahony filter). **Wobble** is the part above 3 Hz, integrated at the full log rate; 1× = exact.
- **Shake** is accelerometer content above 8 Hz, double-integrated in the frequency domain at the full log rate (vibration only: slower content is manoeuvres and gravity rotating with the quad). The model is drawn at the prop size (wheelbase ≈ 45 mm per inch), so 1× is true to scale. Real vibration is micrometres, so use 100–1000× to see it.

## Flight video
🎬 Video on the timeline loads a DVR / action-cam file locally (never uploaded) and plays it in sync behind the charts or in a corner window. Video time = log time + offset; nudge the offset once to line them up.

## No log yet
With no logs in `logs/` (or `/?demo=1`) the app shows the 3D quad flying a synthetic freestyle routine until you drop a .BBL: trick names on screen, speed 0.1–1× and pause (Space), drag to orbit and wheel to zoom in every camera, prop-wash particles.

## Licence
© Martin Dimitrievski. Free to use, reuse, modify and share for non-commercial purposes; see `LICENSE`.

## PID simulator
The **PID simulator** tab learns each axis' rotation dynamics from the log (a blocking warning explains its limits the first time it is opened for each log):
`dω/dt = b·m − a·ω`, `τ·dm/dt = u(t − delay) − m`, with `u` the Betaflight PID sum (the logged units).
b (control authority), τ (motor + prop lag), the delay and a (aero damping) are found by **closed-loop output error**:
the logged setpoint drives a Betaflight-accurate controller closed around a candidate plant, and the candidate whose
simulated gyro best matches the logged gyro wins (vectorised grid search, refined twice, ~20 s, cached). Driving the
model from the sticks rather than from the logged PID output avoids the bias that disturbance feedback puts on open-loop
fits (checked: open-loop and equation-error fits on the same data came out unstable/meaningless).
On the sample log the model reproduces the logged gyro from the sticks at 75 / 77 / 52 % (roll / pitch / yaw) over 32
one-second pieces, and 79–93 % on the 3 s replay windows. The controller model was checked against the logged terms:
P scale 0.0320 (BF 0.032029), D scale 0.00052–0.00058 (BF 0.000529), FF 0.016 on clean stick moves (BF 0.0165 at FF 120).
In the browser, edits run through the same loop at the PID loop rate: step response (vs the measured one), disturbance
kick, replay of your real stick inputs (vs the real gyro), and linear loop analysis (Ms, phase / gain margin, |S|).
Size-aware: motor-lag prior 4 ms/inch + 4 ms, poor fits are pulled toward it and flagged.
