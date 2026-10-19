# BBX: handoff context (paste into a new chat with bbx.zip) — v17 (public release prep)

BBX Analyzer (public name): Betaflight blackbox analyzer: FastAPI + numpy backend, vanilla JS + Plotly frontend, one folder. Run: `start.sh` / `start.command` / `start.bat` (installs deps, unpacks the orangebox wheel, opens http://127.0.0.1:8000). Logs live in `logs/`; decoded logs are cached as `.npz`, simulator models as `.model.json`. Author: Martin Dimitrievski; non-commercial licence (LICENSE, About button).

## Backend
- **app.py**: routes `/api/{log}/{idx}/…`: meta, series, psd, spectrogram, noise, profile, resonances, filterplan, playback (binary float32), motors (thr_min/thr_max), step (src = gyroADC/gyroUnfilt), simmodel, and pidterms | motorout | propwash (propwash takes chop, drop, win, stick, skip, flo, fhi, minev).
- **bbl.py**: the `Log` class: decoding (truncated logs keep every frame before the break, header `_truncated`), derived columns (motor%, motorHz, throttle%), series (min/max decimation), spectrogram (auto colour range = 2nd–99th percentile of raw gyro, all axes), step_response, playback, profile, simmodel (cached), filterplan.
- **tuning.py**: Betaflight filter models, welch, noise_report, `resonances()`, `filter_plan()`, step_metrics/advice, pid_suggest, finding().
  - **Resonance detector (v15)**: per throttle band, Welch at ~2 Hz resolution; every motor harmonic up to Nyquist masked ±mask % (≥ 2 bins) as NaN (not removed); baseline = NaN-aware median over a frequency-scaled half-width clip(0.35 f, 15, 30) Hz; peaks ≥ prom dB, parabolic refinement; clustered across bands; needs ≥ 4 bands seen, persistence counted inside the cluster's own throttle span, drift ≤ max(3 bins, 4 % f). Outputs bands_seen / bands_observable / drift_hz. Validated by eye on spectrograms: Fawkes 54–56 Hz (+82–87, 135, 175), Phoenix 39–40 and 69–74 Hz, El Chupacabra 129 Hz (roll) and 76 Hz (yaw).
  - **filter_plan**: per-axis raw / filtered / P / D PSD, current low-pass stages and static notches (raw excess, "useful"), noise budget, settings; notch proposals for resonances the filters remove < 15 dB: centre = resonance, Q from the −3 dB width in that resonance's throttle span × 0.8 clipped 1.5–8, BF cutoff = fc(√(1+4Q²)−1)/2Q, slot 1/2 or an idle existing notch (`replaces`), warning below 80 Hz; RPM fade fix CLI.
- **quad.py**: prop-size estimate from hover speed (7″ ≈ 104 Hz, 2.5″ ≈ 430 Hz), blade-pass for blade count.
- **motors.py**: per-motor order tracking, relative vibration, load, RPM per command, desyncs, throttle band. **motor_power electrical model (v16)**: duty (motor[]/2047) = a·ω + b·ω² fitted on steady flight (3 Hz low-passed, R² 0.96–0.997; 1/a ≈ KV×Vbat, e.g. 7″ ≈ 500 Hz). Battery power ∝ d·(d − aω); extra from command swings with sticks still = mean(d̃(d̃ − aω̃)) per band (3–80 Hz with eRPM band-passed 3–60 Hz, >80 Hz command only; eRPM above ~60 Hz is telemetry jitter, coherence ≈ 0) over the smooth part. Range = refit per third of the flight. Cost spectrum = Re cross-spectrum d × (d − aω) on still windows, peak (≥ 8 Hz) attributed to resonance / motor order / loop / noise. Reference: Fawkes 0.4–2.4 %, Phoenix 2–34 % (74–76 Hz frame resonance driven into the motors on 08-08 #3), El Chupacabra 0.2 %. **Prop-side (v15)**: prop power ∝ ω³, thrust ∝ ω², so at equal thrust unequal speeds cost ≈ 1.5·var(Δω/ω); exact total from eRPM over samples with all motors well spinning, split by band (steady < 0.2 Hz = imbalance/CG, 0.2–3 manoeuvres, 3–80 PID corrections, > 80 vibration) and scaled to the exact total; motor-command buzz > 80 Hz (heat, not in the %); T/W = (full/hover speed)² — "seen" when all motors ≥ 97 % together, "extrapolated" (quadratic cmd→speed) only if the mean command reached ≥ 85 %, otherwise unknown. Typical: Fawkes 0.3–2 %, Phoenix 2–4 % (mostly steady imbalance), tune part ≤ 0.45 %.
- **flight.py**: pid_report + **pid_behaviour (v15)**: still-stick spectra of P/I/D/FF/error; strongest error peak 1–60 Hz (≥ 4 dB) classified as vibration (on a resonance or motor order), "pi" (≤ 6 Hz and |I|/|P| ≥ 0.8 at that frequency), "loop" (2.5 Hz … max(15, 150/inch) Hz) or "other"; D vibration share > 80 Hz with source; in stick moves D/P effort 2–30 Hz, FF share, FF delivered vs nominal by stick speed (acro samples only). motor_out_report; propwash_report with adjustable detection (PW_DEFAULTS).
  - **Flight modes**: flightModeFlags bit0 ARM, bit1 ANGLE, bit2 HORIZON; acro = (fm & 6) == 0. Many 7″ flights are partly angle mode; FF on roll/pitch differs there, so FF analysis uses acro samples only.
- **sim.py**: plant per axis `dω/dt = b·(m + λ(u_d − m)) − aω`, `τ·dm/dt = u_d − m`. Motor lag/delay measured from command vs eRPM; P/D multipliers from logged terms; b, a, λ, ±30 % τ fitted closed-loop (time error < 30 Hz + FRF 3–30 Hz). Axes without excitation borrowed from another flight of the same craft with matching motor dynamics. Fit 85/83/90 % (r/p/y) over 17 flights.
- **Performance (v16)**: `_band` and `_band_int` zero-pad to a 5-smooth FFT length (prime-length FFTs were ~50× slower); `resonances()` memoised per log window + settings; `_nanmedfilt` vectorised.
- **Findings rules**: step metrics have bootstrap 90 % ranges and a reliability gate; noise findings name the knobs actually active; resonance and power findings hedged; no absolute "typical settings".

## Frontend (static/)
- **app.js**: state S, tabs, findings. Client cache of analysis responses (`API_CACHE`, 60 URLs). Flight summary: first section of the left "Flight & craft" panel (collapses with it; no top/flyout modes since v16.2). No timeline on the Summary tab. Motor health: verdict strip (props, weight balance, motors & ESCs, efficiency), motor cards + map, battery panel (v16.2: headline "about X% wasted", three plain rows twitching / buzzing / uneven load with tiny/small/worth fixing badges, maths + cost spectrum in a fold-out); vibration charts and full findings folded behind a button (S.hDetail). **Grouped toolbars (v15)**: `tbar(head, groups)`, `tg(label, html)` (titled group box), `tpop(id, label, html)` (popover for advanced settings, open state kept across re-renders, closes on outside click), `prow()`.
- **planner.js**: per-stage responses memoised; BF has 2 static gyro notch slots: `fpAssign` gives slots to existing notches left on, then switched-on proposals in order, then the manual notch; extras show "no slot". Noise tab → "Filter planner": toggle proposed / existing notches, manual notch (f, Q), gyro & D-term low-pass ×; prediction by the ratio method with `mkStage().H` (filtered × |H_new/H_now|², D also through its own chain), motor HF = budget × √(Σ share × ratio), phase delay at 20/50/100 Hz, CLI (notches, `filter_knob`-style LPF, RPM fade).
- **behaviour.js**: PID terms → "Behaviour": log-frequency spectra per axis with loop range / vibration bands and oscillation marker, plus verdict cards (oscillation, P vs I, D vibration, P–D balance, FF).
- **player.js**: timeline strip fills the dock, controls float on a shaded band; 3D viewer (cameras heading / world / chase / flight); air particles (splash only, v16.3): shot along each rotor's −z at v ∝ √thrust (thrust ≈ cmd^1.4, so punch ≈ 2× hover), inherit the quad's velocity + rotor swirl, born back-dated within the frame (no clumps); then linear+quadratic drag to still air, curl-noise eddies and an age-growing random walk; no gravity.
- **timesync.js**: shared time view; frequency zoom/pan for Noise (`_freq = true`, S.nfr) and Spectrogram (`_freq = "spectro"`, S.fr). Vs-time spectrogram has its own time window S.stime (default whole flight / selected range, not synced to S.view): ctrl+wheel scrolls time, shift+wheel zooms time.
- **pidsim.js**: browser simulation; blocking warning shown once per log session (S.simAck, reset on every log load and page reload).
- **demo.js**: ground at −9 m; every trick is flown ahead on a copy of the state (+1.5 s recovery) and only started if it keeps ≥ 2.5 m clearance, otherwise the autopilot climbs first (zRef) — the quad never touches the grid. 23 tricks (incl. triple roll, double flip, trippy spin, tornado, power dive, knife edge, rubik's cube, sbang, stall tumble). Flight camera locked on the interpolated position (the old spring ran ahead in slow motion). splash: full-window viewer, speed (0.1–1×, pause, Space), trick names in FPV slang, orbit/zoom in all cameras, prop-wash particles.
- **about.js**: About dialog. **glossary.js**: tooltips. **video.js**: synced video.

## Reference flights
- Fawkes and Phoenix 7: 7″ 2-blade, SUB250 RedFox F722, BF 2025.12; gentle flying, partly angle mode; motor τ 38–60 ms.
- El Chupacabra: 2.5″, SpeedyBee F405, hover ≈ 430 Hz, τ ≈ 28 ms, 100 % acro.
- FF delivered vs nominal is measured in acro only (earlier "jitter attenuation 10–65 %" mixed in angle-mode samples and was wrong).

## Open ideas
- Dynamic notch is not in the simulator or planner (left unchanged). Planner predictions assume same props/flying style.
- Power figures are prop power only; without current logging no watts.

## Release / packaging (v17)
- Launchers: `start.bat` (CRLF, goto-based, no blocks around paths), `start.command` → `bash start.sh` (bash 3.2-safe). Python 3.10–3.13 preferred (3.13→3.10, py launcher on Windows); else / on package failure a private Python 3.12 via uv into `.tools/` (UV_INSTALL_DIR, UV_PYTHON_INSTALL_DIR, UV_CACHE_DIR). Detects running from inside a zip (Windows Temp) / read-only folder. macOS clears quarantine on its folder after the first approved run and creates `BBX Analyzer.app` (icon `static/brand/bbx.icns`); Windows makes Desktop + folder `.lnk` with `bbx.ico`; Linux a `.desktop` entry. `open_browser.py` opens the browser when the server answers. Tested on Linux with fresh installs on Python 3.10, 3.12, 3.13 and the no-Python failure path; uv download path and Windows/macOS not executable in the build sandbox.
- Plotly vendored at `static/vendor/plotly.min.js` (2.35.2, MIT) → offline after setup. requirements: lower bounds only.
- Brand: `static/brand/` icon.svg (quad X + step-response OSD), icon-small.svg (16–48 px), logo.svg / logo-light.svg (wordmark "bbx" where the x is the quad + ANALYZER), PNGs, bbx.ico, bbx.icns. Header + favicon + About use them.
- README rewritten for GitHub (banner `docs/banner.png`, screenshots `docs/img/`), old README → `docs/TECHNICAL.md`.
- Progress: `bbl.progress(name, idx, task, detail, frac)` → `/api/progress`; decode reports frames/position, simulator per axis; frontend `busy(fn, label)` shows title, detail, % bar or indeterminate bar, elapsed.
- Motor health battery rows show trace clips (`power.samples`: twitch 1 s, buzz 0.15 s, uneven 3 s) vs the battery-optimal line, waste shaded.
- Release zip excludes CONTEXT.md, caches, .venv/.tools.

## v17.1
- Tagline: "Betaflight blackbox logs, turned into answers" (README, banner, launchers, page title).
- Plotly hook flags now live on gd._ev (`hooked/markHooked` in app.js): any purge or react→newPlot fallback drops the emitter, so hooks re-attach automatically. Fixes title-click focus / time sync / propwash hover dying after planner, health-detail, behaviour, pidsim view switches.
- S.fr / S.nfr no longer persisted; reset on log load → full spectrum by default.
- Timeline: --strip/--dock darker in light, brighter in dark; throttle drawn in theme ink (grey).

## v17.2
- PID terms › Behaviour: chart + peak search share one log-banded spectrum (flight._logbands/_logbin); peak = most prominent true local max (topographic prominence within ±1 octave, flight._best_peak). Old median-baseline picked slopes/edges and unplotted bins.
- Plotly hover shows full trace names (hoverlabel.namelength −1 in base() and line()); legends left-aligned (toolbar sits top-right).
- Noise: filtered gyro width 2.4. Planner: "D-term spectrum" chip (S.fp.dOn, default on) shows D now/planned.
- AUW: quad.auw_estimate (hover speed × Ct by blade count, current sensor if logged; size-typical weight only as fallback; craft-name weight hints only, not board name). Typical weight w_typ(d, blades) = thrust at the calibrated hover law n_pl(d), so size estimate / AUW / sim "typical" agree. User override S.auw (store "auw:<craft>"), sent only to profile + simmodel.
- profile.derived: hover_w (momentum theory, eff 0.45), twr/thrust_g from quad.headroom (shared with Motor health power.tw). Hover speed/command/throttle defined once in quad.estimate (hover_hz/hover_cmd/hover_thr) and reused by Motors, Motor health, sim.
- PID sim: sim.typical_report → typical b (α/Δn = 2g/(n κ² y), κ 0.6, wheelbase 44 mm/inch, Δcmd = u/1000 × G), motor lag prior, implied inertia, hover-implied weight vs AUW in use.
- Motor health battery waste also in watts (× hover power).

## v17.3
- Units: Log._derive applies gyro_scale (float bit pattern, BF) and blackbox_high_resolution (÷10 on gyroADC, gyroUnfilt, setpoint[0..2], rcCommand[0..3]; not setpoint[3]) exactly like Blackbox Explorer; meta.units {gyro_scale, high_res, step_dps}. Integer °/s steps in normal logs are real data (BBE smooths gyro 3 ms by default).
- Tracking: S.trk {sp, filt, raw, smooth} (store "trk"); raw = gyroUnfilt grey under filtered; series?smooth=ms → server-side centred moving average on gyro* fields before decimation.
- 3D viewer toggle now resizes the chart.

## v18
- plan.py: gather() (memoised analyses per log), build_plan() (steps log/mech/filters/pids/feel/later, cli_pairs() parses "set a = b" text, one value per key, notes, checklist), scorecard()/compare() (METRICS with rel + ABS_MIN thresholds, settings diff over SETTING_KEYS, _ideas, overlays), report_data(). Endpoints /plan, /report, /compare (registered before the /{kind} catch-all).
- Frontend: plan.js (Tune plan tab; planState per log: on/filt/pids; sendToPlan from planner "Use in tune plan" and PID sim), compare.js (Compare… dialog, Compare tab, overlays), report.js (jsPDF + DejaVu fonts lazily loaded from static/vendor; off-screen Plotly → PNG). Step tab CLI box replaced by link to the plan. Timeline hidden on summary/plan/compare. Planner: notches with a warning start off (same as the plan).
- debugmodes.py: enum tables per BF family (4.3/4.4/4.5/2025.12, from release tags), channel meanings from DEBUG_SET sources; meta.debug; spectrogram overlay lines (dbg axis for FFT_FREQ/DYN_LPF, all axes for RPM_FILTER); tracking debug panel; notch-at-limit findings.
- fastbbl.py: codegen decoder, bit-identical to orangebox (quirks kept), ~4× faster; bbl.Log uses it with orangebox fallback; cache written in a background thread. tests/ (pytest, 22 tests) + tests/data/short.bbl; requirements-dev.txt.

## v18.1
- Vertical scale (Tracking + PID traces): S.ysc[tab] {mode auto|same|fixed, v} (store "ysc"); applyYsc() computes ranges from the visible window r (Plotly autorange counted off-screen prefetch margins — fixed); log slider 5..4000.
- PID traces: S.pidGy off|filt|raw → grey gyro on overlay axes yaxis11..13 (right, °/s).
- Noise: per-axis pterm/iterm spectra (tuning.noise_report) + overlay chips ppsd/ipsd/dpsd. Spectrogram signals axisP/axisI.
- Robustness: gyroUnfilt optional everywhere (tuning, quad, motors, bbl clim fall back to gyroADC); spectrogram src fallback; test_log_without_raw_gyro.
- Player: a newly opened log starts with the playhead at span/2 (view starts at t = 0).

## v19
- delay.py + /api/{name}/{idx}/delay (memoised as ("delay",prop,blades)): stages() with exact BF rates (LPF2 gyro rate; LPF1, notches, RPM (per motor × harmonic), dyn notch, D-term at PID rate); delay_at() unwrapped phase delay; loop() = learned plant × BF PID on measurement (+1.5 T); margins() interpolated; typical_headers() (BF defaults, LPF1 scaled by size_params); sweeps (both/gyro/dterm × 0.5–2), P/D-scale PM curves, throttle dependence, noise prediction from filtered-gyro PSD validated vs logged PID-sum HF (measured_pid_noise), propwash-frequency cross-check, findings → plan (optional, filters step).
- Filter-model fixes: gyro LPF1 + static notches at PID rate (tuning.filter_model); dyn_cutoff expo=0 branch (dynThrottle); sim.filters complete (static/dyn/D notches, per-motor RPM notches, faded notches kept with w=0, per-segment w); MODEL_V 3; pidsim.js I path through gyro filters. Python vs JS loop analysis agree < 1° PM.
- UI: static/delay.js "Filter delay" tab (stacked bars by verdict vs typical, 4 small-multiple panels, tiles, method details), glossary dly_*; tabs wrap instead of scrolling.
- tests/test_delay.py (closed-form PT1/notch/margins, additivity, firmware dyn cutoff, full analysis).

## Version 2.0 ("v2")
- version.py VERSION = "2.0" is the single source: /api/version, FastAPI version, header badge (#ver), About title, tune-plan CLI header, PDF header/footer, launcher banners (start.sh/start.bat), macOS app CFBundleShortVersionString, README.

## v2.0 additions (filter delay detail, speed, progress)
- delay.py: stages carry spec rows (with CLI names), parts (each notch / harmonic), explain() closed-form "why", whatifs() header changes → exact PM per option.
  Reference = Betaflight firmware defaults (BF_DEFAULTS, verified against sensors/gyro.h, flight/pid.h, pg/dyn_notch.c, pg/rpm_filter.c) or 'size' scaling; ref param on /delay.
  Reference dyn notches placed by typical_dyn(): logged centres, then noise peaks (dyn_cand), then highest residual points (dyn_tops), then min.
  rpm_notch clamps to 0.48·PID rate (rpm_filter.c). D-term rows on axes with D=0 are "inactive".
- simcore.py: numba kernels (closed loop, cascade, PT, biquad rows), bit-identical to the numpy path (tests/test_simcore.py); BBX_NO_JIT=1 disables; warmed up at server start; nogil so /api/progress answers during a fit.
- bbl.Log.simmodel caches the learned model in <log>.<idx>.sim.json keyed by sim.code_id() (hash of the model code).
- Progress: bbl.progress(... steps, step, nxt, eta, note) and bbl.Job; frontend busyTick glides the bar between frac and nxt with the eta, shows steps with results and nests an inner task (sim inside delay).
- Motor lag pinned: identify() searches τ within ±LAG_ROOM (15%) of the eRPM measurement; per-segment scale (f_ref/f)^k with k measured only on a clean monotonic 3-band trend (else 0.5); alt fits at the range ends → delay pm_range. MODEL_V 4.
- delay.calm_oscillation(): 10–40 Hz tracking-error peak with sticks centred (≥12 dB, ≥2 °/s → finding). Verified on 2026-10-10 12:27 flight (18.7 Hz, model PM < 10°).
- motors.py dropouts: measured speed < 60% of the speed predicted from the command through the measured motor lag + flight command→speed map (old 30 ms rule flagged spin-down/oscillation on 7").
- Report: sections Flight at a glance / Stick response & PID / Noise & filters (+spectrogram, filter delay, margins) / Propwash & stability (+calm check) / Motors & power / Learned dynamics / Tune plan / Before→after / Findings; plan.report_data adds timeline, spectro, pidterms, motors, model, delay.

## Release rule (Martin, 2026-10-11: "now and always, consistent for production")
Every zip handed over must come from `python tools/release.py all` (or docs → check → zip): README, CHANGELOG entry,
docs/TECHNICAL.md, screenshots, banner and docs/sample-report.pdf updated for every change. `check` fails on stale docs
(docs/.docs-stamp fingerprint), version mismatches or failing tests. Only the demo log ships in logs/.
