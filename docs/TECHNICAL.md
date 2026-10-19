# BBX Analyzer: technical notes

A small Python backend (FastAPI + numpy) with a single-page Plotly frontend.

## Start it
See the main [README](../README.md). The launchers (`start.bat`, `start.command` → `start.sh`) create a private `.venv`
in the project folder with Python 3.10–3.13 (preferring 3.13 → 3.10), and add `numba` when a wheel exists for it (optional). If none is installed, or package install fails with
it, they fetch a private Python 3.12 with [uv](https://docs.astral.sh/uv/) into `.tools/`. Dependencies are reinstalled
only when `requirements.txt` changes. First successful start creates an app shortcut with the icon (Windows: Desktop +
folder `.lnk`; macOS: `BBX Analyzer.app` in the folder; Linux: `~/.local/share/applications/bbx-analyzer.desktop`).
Plotly is bundled in `static/vendor/`, so the app works offline after the first setup.

Drop `.BBL` files onto the page or into `logs/`. The first open decodes the log (a few seconds for a 9 MB log, with live progress).
After that it's cached as `logs/<name>.<n>.npz` and loads in under half a second.

## Layout
| file | what |
|---|---|
| `version.py` | the version, single source (API, header badge, PDF, CLI header, launchers check it) |
| `app.py` | API routes, decode lock, LRU of open logs, `/api/progress`, compiles the simulator kernels at start-up |
| `bbl.py` | `Log`: decode → numpy columns, units, derived fields, spectrogram, step response; caches (`.npz`, `.sim.json`); `progress()` / `Job` |
| `fastbbl.py` | specialised blackbox decoder, bit-identical to orangebox, ~4× faster; orangebox is the fallback |
| `debugmodes.py` | `debug_mode` enum tables per firmware (they differ: FFT_FREQ is 17 in 4.3–4.5, 16 in 2025.x), decoded debug channels |
| `tuning.py` | Betaflight filter models (PT1/PT2/PT3/biquad/notch/RPM/dyn-notch from the header), noise report, filter planner, step metrics and advice |
| `delay.py` | Filter delay tab: per-stage delay at the crossover, specs, closed-form explanations, what-ifs, reference setups, margins, sweeps, headroom, self-oscillation check |
| `flight.py` | PID-term balance, motor-output headroom, propwash after throttle chops, stick-to-motion latency |
| `sim.py` | PID simulator model: motor lag/delay from eRPM, effective P/D gains from the logged terms, plant fitted by closed-loop output error + frequency response; per-craft memory |
| `simcore.py` | numba kernels for the simulator's inner loops (optional; bit-identical to the numpy path) |
| `quad.py` | quad profile: prop size, blade count and all-up weight from the log, size-scaled references, typical dynamics |
| `motors.py` | motor & prop health: per-motor order tracking, load balance, speed per command, desyncs, battery waste |
| `plan.py` | tune plan (all findings in order, one CLI), scorecard, before → after comparison, report data |
| `static/app.js` | state → fetch → Plotly, tabs, busy/progress panel, tooltips |
| `static/delay.js`, `plan.js`, `compare.js`, `report.js` | Filter delay tab, Tune plan, Before → after, PDF report (jsPDF + DejaVu fonts in `static/vendor/`) |
| `static/pidsim.js` | browser-side closed-loop simulation at the PID loop rate, loop margins / sensitivity, auto-suggest |
| `static/player.js`, `timesync.js`, `video.js` | playback + 3D viewer, synced time navigation, DVR video |
| `static/creatures.js`, `creaturelooks.js` (per-creature look), `creaturearch.js` (parametric archetypes), `creature3d.js` (Avatar tab: 150 creatures, quad PiP, 8-axis `quadScores`, nearest-match, procedural 3D flier), `static/world.js`, `world3d.js`, `livecharts.js`, `demo.js`, `vendor/three.module.min.js` | the no-log splash: procedural toy world (100 object kinds), its autopilot and tricks, the Three.js renderer, the live plots |
| `static/planner.js`, `behaviour.js` | filter planner (Noise tab), PID-term behaviour |
| `static/glossary.js` | tooltip texts (TL;DR + detail) and sidebar grouping |
| `tools/release.py` | release checks, screenshots / banner / sample report from the app, the zip |
| `tests/` | decoder parity, units, debug modes, filter maths, compiled vs numpy simulator, model cache, all analyses, API |

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
- `simmodel?prop&blades&auw`: the learned plant per axis, measured motor dynamics (lag, delay, speed law), validation replay segment, typical-quad comparison
- `delay?prop&blades&ref=bf|size`: the Filter delay analysis (below)
- `plan`, `report`: the tune plan; everything the PDF needs. `/api/compare?a&b&ai&bi&…`: before → after
- `/api/progress?name&idx`: live steps of slow jobs (decode, sim, delay, plan, report, compare); `/api/version`

## How the advice works
All advice comes from heuristics. Treat it as a starting point, and change one thing at a time.
- **Filter delay (Noise tab)** = phase delay at 100 Hz of the low-pass stages, modelled at the window's mean throttle: a quick size guide. The Filter delay tab does it properly (below).
- **RPM filter check** tracks each motor's eRPM per 0.25 s window and compares raw vs filtered gyro at exactly those harmonics.
- **Frame resonances** = peaks that remain in the raw gyro after masking out all motor harmonics.
- **Step metrics** come from the 6 ms-smoothed median step response. Thresholds live in `tuning.step_advice`. The shaded band is the 95% CI of the median (1.2533·σ/√n, σ from the IQR) or the IQR itself. Filtered gyro is the default: it is what the PID loop sees and gives a tighter estimate; raw gyro shows the latency the filters add.
- **Suggested PIDs** (`tuning.pid_suggest`) take one cautious step from the filtered-gyro metrics: overshoot → more D (or less P when the D-term is already noisy), slow rise → more P/FF, ringing → more D or less P, steady-state error → I. Step size shrinks with prop size (12 % at 5″). Needs ≥ 10 windows per axis. Output includes a CLI snippet and slider equivalents when simplified tuning is on.

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
With no log open (or `/?demo=1`) the app shows a quad flying freestyle in a procedural 3D toy world until you drop a .BBL: trick names on screen, speed 0.1–1× and pause (Space), drag to orbit and wheel to zoom in every camera (Chase, Wide, FPV), prop-wash particles, an optional trail, a live view of the pilot's two sticks and three live plots. The flight never ends and never resets the view.

- `world.js` builds the world from a fixed seed: terrain `H(x,y)` (value noise, flattened under the town, a lake and a hill), 100 object kinds made of box/cylinder/sphere/prism/wedge/torus primitives, and a planned layout instead of random scatter: a 5×5 street grid (36 m pitch, 12 m streets) whose centre plaza is ringed by downtown towers, then midtown, with parks (a Ferris wheel or carousel), a skate block and residential blocks of houses with yards, a ring road lined with race gates, power poles and parked vehicles, radial roads out to four districts (farm, industry, lake, hill), and a forest of Poisson-spaced trees on a noise mask beyond the ring. This follows the usual procedural-city recipe of concentric land-use zones, a street grid with typed blocks, and blue-noise placement for vegetation. Kinds are dealt round-robin from per-role pools, and a final pass guarantees every kind appears at least twice, placing leftovers near their district or in a suburb strip along the ring road. It also provides the collision model (`sdf`, oriented boxes and cylinders in a spatial hash), `topAt` (highest thing at x,y) and a landmark list (gates, ramps, towers, lamps, cars, houses).
- `demo.js` `makeDemoGen()` (a generator; `makeDemo()` runs it to the end) flies a rigid-body quad through that world at 250 Hz and returns the same data layout as a decoded log, so the viewer code is shared. Flights are 60 s and **chain**: each is started from the previous one's end state (`d.cont`: attitude, velocity, PID and wind state, the landmarks already visited) and begins with that flight's last 5 s as history, so at the hand-over nothing moves. The page builds the next flight in 4 ms slices while the current one plays, then shifts the clock (`PB.t`, trail, live plots) by the overlap instead of resetting anything. The autopilot follows the terrain with an altitude look-ahead, plans a heading around obstacles (turn rate limited to what the speed allows, ~2.3 g), picks a landmark, passes it tangentially (gates and ramps along a line) and flies a trick there if the look-ahead clearance is at least 2.2 m. The cruise attitude is a coordinated bank: the thrust vector leans forward for the speed policy (25–46° of tilt depending on how much clear air is ahead) and sideways for the turn. A soft bumper is the last line of defence; flights are collision-free over every seed tested.
- The commanded body rates then go through a **rate PID loop** (P, I, D on the filtered gyro, smoothed FF) → mixer → motors with a 22 ms lag → torque → body rates, with gyro noise that grows with throttle, turbulence torque and a wind model (mean drift, Ornstein–Uhlenbeck turbulence and gusts) acting on drag. P/I/D/FF, gyro, motors and motor Hz are logged in the same channels the viewer reads (`pidP[0..2]`, `pidI`, `pidD`, `pidF`, `m%[i]`, `mHz[i]`). The look-ahead that validates tricks uses the ideal (no-controller) rates, and the 2.2 m margin covers the difference.
- `world3d.js` draws it with Three.js (vendored r168, loaded on demand): one InstancedMesh per kind, flat-shaded and desaturated, with feature edges drawn in the fragment shader from a barycentric attribute and a per-triangle crease mask (`addEdges`); terrain with a world-space 2 m / 10 m grid; a sky shader; a short render distance with fog that hides the world's end; water; the quad at 5× life size; a shadow; flat triangle wash particles and a trail drawn as a camera-facing ribbon (0.4 m wide at the quad, thinning and fading to its tail). Sim (x, y, z up) maps to three (x, z, −y). If WebGL or the import fails, the old 2D `drawViewer` is used.
- Sticks: `drawSticks()` shows a mode-2 pair of gimbals from the commanded setpoints (`sp[0..2]`, mapped through a soft curve) and the commanded throttle (`thrCmd`), with the last second of travel as a fading line. The motor and PID plots shade the spans where a trick is flown and name them, so the traces line up with the manoeuvres.
- `livecharts.js` draws the three live plots straight on canvas (about 2 ms per update, where Plotly took tens), with the analyzer's own colours and colour map. Their scales are fixed (4 s window, motors 0–100 %, PID ±150, spectrogram 0–400 Hz) so nothing rescales or wobbles. The 250 Hz flight cannot show motor noise, so the spectrogram runs a 2 kHz gyro made from the flight (the real rate, a harmonic series at each motor's phase-integrated speed, a 182 Hz frame resonance and a noise floor) through a real FFT (512 points, Hann, 40 ms hop). It is an illustration of what the tab shows, not a measurement.
- `tests/test_world.py` runs the world and flights headless in Node (skipped without Node).

## Units and logging
`gyro_scale` is stored as a float bit pattern; with `blackbox_high_resolution` gyro, raw gyro, setpoint and rcCommand are
logged ×10 (0.1 °/s steps) and divided back. PID terms are in Betaflight's internal units; the mixer moves a motor by
PID sum / 10 %. Derived: `throttle%`, `motor%[i]` (from the `motorOutput` range), `motorHz[i]` (bidirectional eRPM ÷ pole pairs).

## Filter delay
- Every stage is evaluated with Betaflight's own difference equations at the rate it really runs (gyro LPF2 at the gyro
  rate; LPF1, notches, RPM filter, every D-term filter at the PID rate), dynamic low-passes at the hover throttle
  (`dynLpfCutoffFreq`, or `dynThrottle` when expo = 0), RPM notches at each motor's median speed with the firmware's
  fade-in (weight = margin / fade range above `rpm_filter_min_hz`) and cap (0.48 × PID rate), dynamic notches at the
  logged centres (FFT_FREQ), else the residual noise peaks, else the minimum.
- Phase delay of a stage at f: τφ = −∠H/ω. Delays of cascaded stages add, and a stage takes exactly 360°·f·τφ of phase,
  so the stacked bar is the phase budget. Each stage also gets the closed-form rule (PT1 ≈ 1/(2π·fc), PTn ≈ n/(2π·k·fc)
  with Betaflight's cutoff correction k, biquad ≈ √2/(2π·fc), notch ≈ weight/(Q·2π·f0) below its centre).
- Open loop L = plant × PID: plant b·e^(−s(d+1.5T))·(1+λτs)/((1+τs)(s+a)) from the simulator; PID on measurement
  C = (P + I·T/(1−z⁻¹) + D·(1−z⁻¹)/T·F_D)·F_G. Crossover where |L| = 1, phase margin 180° + ∠L there, gain margin,
  peak sensitivity max |1/(1+L)|. The model range repeats this on the equally good fits at the ends of the allowed motor-lag range.
- **Reference**: Betaflight's firmware defaults (sensors/gyro.h, flight/pid.h, pg/dyn_notch.c, pg/rpm_filter.c: gyro
  LPF1 PT1 250–500 Hz dynamic, LPF2 PT1 500 Hz, D-term LPF1 PT1 75–150 Hz dynamic, LPF2 PT1 150 Hz, 3 dynamic notches
  Q 3.0 100–600 Hz, RPM 3 harmonics Q 5.0 from 100 Hz fade 50 Hz, yaw P low-pass 100 Hz), or those with the low-pass
  cutoffs and notch minimums × (5/size)^0.8. Run on this quad's loop rates, motors and plant, so only the filters differ;
  its dynamic notches go where a tracker would put them on your spectrum.
- **What-ifs** rebuild the whole filter chain with one change and recompute the loop (exact for the model, not a delay estimate).
- **Checks against the log**: predicted vs logged PID noise above 80 Hz; the model's sensitivity peak vs the measured
  propwash ringing; and the self-oscillation check: the strongest 10–40 Hz component of gyro − setpoint with the sticks
  within ±15 °/s of centre; ≥ 12 dB above the band and ≥ 2 °/s counts as self-sustained (flagged with the model's margin).

## PID simulator
The **PID simulator** tab learns each axis' rotation dynamics from the log (a blocking warning explains its limits the first time it is opened for each log):
`dω/dt = b·(m + λ·(u_d − m)) − a·ω`, `τ·dm/dt = u_d − m`, with `u_d` the Betaflight PID sum (logged units) after the delay.
- **Motor lag τ and delay** come from motor command vs eRPM (frequency response on the band where they're coherent,
  ≈2 % steps). τ shortens with rotor speed: τ ∝ speed^−k, k measured from the flight's slowest, middle and fastest thirds
  when they show a clean monotonic trend over a ×1.3 speed span, else 0.5; applied to every flight segment.
- **Authority b, damping a, yaw spin-up λ** are found by closed-loop output error: the logged setpoint drives a
  Betaflight-accurate controller (P, I with relax, D with D-max boost, logged FF, TPA and gains measured from the logged
  terms, the full filter chain incl. every RPM notch) around candidate plants; the best match to the logged gyro below
  30 Hz plus the setpoint → gyro frequency response (3–30 Hz) wins. Grid search refined twice.
- **τ may move only ±15 % from the measurement.** Stick inputs (excited to ~8–16 Hz) can't separate lag from authority:
  left free, the fit slid along a flat optimum (fit within 1 % from 23 to 62 ms) and landed between 26 and 68 ms on
  flights of the same quad. Pinned, roll/pitch/yaw stay with the measured 36–43 ms at no measurable cost in fit.
- On the demo log the model reproduces the logged gyro from the sticks at 89 / 86 / 90 % (roll / pitch / yaw).
  The controller model was checked against the logged terms: P scale 0.0320 (BF 0.032029), D scale 0.00052–0.00058
  (BF 0.000529), FF 0.016 on clean stick moves (BF 0.0165 at FF 120).
- In the browser, edits run through the same loop at the PID loop rate: step response (vs the measured one),
  disturbance kick, replay of your real stick inputs (vs the real gyro), linear loop analysis (Ms, phase / gain margin, |S|).
- Without eRPM the lag is a size prior (4 ms/inch + 17 ms), fitted per axis, and flagged as less certain.

## Motor health: desyncs
A dropout is the measured speed falling below 60 % of the speed the command predicts for ≥ 5 ms. The prediction runs
the command through the motor's measured delay and lag and the flight's own command → speed map, so a prop spinning
down after a chop or speed swings lagging the command in an oscillation don't count. Exact zeros that recover within
10 ms are telemetry glitches.

## Speed and caching
- Decoded logs: `logs/<name>.<n>.npz` (rebuilt when the log is newer).
- Learned models: `logs/<name>.<n>.sim.json`, keyed by a fingerprint of the model code, so a code change invalidates it.
- `numba` (optional) compiles the simulator loops (one lane per thread, no GIL, so progress polling keeps answering);
  `BBX_NO_JIT=1` forces the numpy path. Kernels are compiled in the background at start-up and cached by numba.
- Typical times on a 4.5-minute 1 kHz log, 2 cores: learning the model ~4 s (15 s without numba), Filter delay
  analysis ~0.6 s, the whole Filter delay tab cold ~5.5 s, after a restart ~1.7 s.

## Progress
`bbl.progress(name, idx, task, detail, frac, steps=, step=, nxt=, eta=, note=)`: frac is where the task is, nxt where the
current piece of work ends and eta how long it should take, so the browser glides the bar between them; steps get a
one-line result (note) and their time. A task started inside another (the model inside the Filter delay analysis or the
report) shows nested under the outer task's current step.

## PDF report
Made in the browser from `/report`: page 1 profile, key numbers, priorities, flight timeline; then stick response & PID
terms, noise & filters (spectra, noise-by-throttle heatmaps, filter delay vs the defaults, margins), propwash &
stability, motors & power, the learned dynamics, the tune plan with its CLI, before → after, all findings.

## Licence
© Martin Dimitrievski. Free to use, reuse, modify and share for non-commercial purposes; see `LICENSE`.


## 2.5 additions

- **Splash world:** `world.js` also builds routes and agents (cars on clockwise per-block loops, ring-road lanes, out-and-back radials, sidewalk walkers, bike lanes); `agentPose` gives position/heading per clock. `world3d.js` renders monochrome (shaded greys, barycentric edge shader, per-vertex texture ids for windows/roofs/glass) with road markings drawn analytically in the terrain shader. Scale factor QS = 3.
- **Avatar tab:** `quadScores(R, stats)` maps log metrics to 8 axes (0-99); `crMatch` ranks creatures by RMS gap, similarity `100*exp(-d/28)`.
- **Summary:** collapsible cards (state kept in `sumOpen`), filter-latency card. **Tracking:** `timesync.js` drag-scroll over the whole plot area. **Arrows:** ▲/▼ helpers `DIR` (UI) and `UP`/`DN` (PDF).

- **Tab groups:** `TGROUPS` in `app.js` currently holds one group, Tracking (tracking/pid/motors as hidden legacy buttons, `#subtabs` pill bar). `suggestTune()` in `pidsim.js` always searches around the logged gains with hard constraints, so repeated use is idempotent.
