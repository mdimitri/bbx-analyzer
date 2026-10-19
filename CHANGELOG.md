# Changelog

Every release lists what changed for pilots first, then fixes. Screenshots, the banner and `docs/sample-report.pdf` are
regenerated from the app for every release (`python tools/release.py all`).

## 2.6 · 2026-10-19

**New**
- **Avatar tab** (was Creature): 150 creatures, now with their own 3D models (parametric archetypes, far more variety and detail) including a new "Absurd & unlikely" group (flying pig and friends, usually matched to a poor tune). A small copy of your quad flies the same flight in the bottom-right corner for comparison.
- **Tab groups.** The top bar is now Summary · Tune · Tracking · Noise & filters · Motors · Propwash · Avatar; the related views sit in a pill bar underneath.
- **Splash exhaust streaks.** Motor particles are fast lines whose speed and number follow each motor's thrust, still diffusing in direction.
- **Tune plan** opens with a table of the settings to change (Setting · Now · Suggested · Why); the CLI block is collapsed.

## 2.5.1 · 2026-10-19

**Changed**
- **Splash: paler world, a quad that stands out.** The wireframe world is softer (dimmer lines and shading, lighter road markings); the quad and its LEDs now use the spectrogram's colormap, its motors glow by speed, and the trail is thinner and fainter.
- **Splash: sticks in the middle** (smaller, bottom centre) in the accent colour; the trick name is back in the accent colour.
- **PID simulator: ✨ Suggest is repeatable and safe.** It now always searches around the gains the log was flown with (it used to start from the editor's current values, so pressing it again compounded and drifted towards zero). Candidates must be stable and keep robustness (Ms), phase margin, overshoot and motor noise within limits, and must beat the logged tune by a margin; if nothing does, it says so.
- **Faster:** the Tune plan, Motors and PID simulator analyses are warmed in the background after a log opens, and the motor report is cached.

## 2.5 · 2026-10-19

**New**
- **Creature tab.** Scores the flight on eight axes, matches it to the nearest of 129 mythical creatures and shows it in 3D (rotatable, wind particles, wingtip trails, radar and stats).
- **Summary: filter-latency card and collapsible cards.** Cards open with the visual and main findings; expand for details.
- **Better/worse arrows** (▲/▼) on every metric in the app and in the PDF report.
- **Splash: black-and-white shaded wireframe** with textured windows, roofs and glass, analytic road markings, true scale (quad against buildings), cars on their lanes, walking people and cyclists.
- **Tracking: drag anywhere** in the plot area (including between traces) to scroll.

**Fixed**
- Scrolling the tracking traces when unzoomed.
- Object shapes, positions and orientations in the toy world (wheels, doors, windmills, lane directions); PDF tile text truncation.

## 2.4 · 2026-10-13

**New**
- **Splash: it never stops.** The flight is now one endless run: the next flight is built in the background from where the current one ends, so the quad, the camera, the trail and the plots carry on without a cut or a reset.
- **Splash: the pilot's sticks.** Two gimbals at the bottom of the viewer show the left (throttle, yaw) and right (pitch, roll) stick in real time, with the last second of travel as a line, so you can see how each trick is flown. Toggle with the *Sticks* chip.
- **Splash: a clearer trail.** The trail is a ribbon that is thick next to the quad and thins out towards its tail.
- **Splash: plots tied to the tricks.** The motor and PID plots shade and name each trick as it is flown.

**Fixed**
- The PID plot no longer changes shape as it scrolls (it was drawing every other sample, and which ones shifted with the window).

## 2.3 · 2026-10-12

**New**
- **Splash: a world with a plan.** The toy world is now a small town instead of scattered props: a street grid with a plaza, downtown towers, midtown, parks, a skatepark and residential blocks, a ring road with race gates, and farm, industry, lake and hill districts, all inside a forest. Shorter render distance and fewer objects make it lighter.
- **Splash: faster live plots.** The three plots are drawn directly on canvas, many times faster than before, and their scales are fixed so they no longer wobble.
- **Splash: cleaner effects.** The trail is a plain line and the prop-wash particles are flat triangles.

## 2.2 · 2026-10-12

**New**
- **Splash: faster, more natural flying.** Cruise speed is now around 18 m/s (it was 10), with banked, coordinated turns, tangential passes around towers
  and houses, a wandering cruise height, and a speed that eases off in tight spots and opens up in clear air.
- **Splash: a quad that is actually controlled.** The flight now runs through a rate PID loop, a mixer and lagging motors, with gyro noise, turbulence
  and gusts of wind acting on it, so the lines wobble and correct the way a real flight does.
- **Splash: three live plots** under the viewer, in the analyzer's own style: motor outputs, PID terms (roll / pitch / yaw) and an endlessly scrolling gyro
  spectrogram with the motor lines drawn dotted. Toggle them with the *Live plots* chip.
- **Splash: a new look.** A night-grid world: muted faces with crease-edge wireframe, a terrain grid, a horizon fog that hides the world's end, and a
  blueprint version for the light theme. The Wide camera now moves out of the way of buildings.

## 2.1 · 2026-10-12

**New**
- **A toy world on the splash screen.** With no log open, the quad now flies through a procedurally built 3D world:
  undulating terrain with a lake, a town, a skatepark, an industrial yard and a farm, filled from a catalogue of 100
  object kinds (houses, towers, trees, ramps, gates, lamps, cars, silos, windmills, toys…) that repeat around the map.
  The autopilot follows the terrain, picks a ramp, gate, tower, house, car or lamp, flies to it and does a trick there
  ("SNAP ROLL · at the square gate"). Same world every time, a different flight every loop; it never hits anything.
- Chase, Wide and FPV cameras, a Trail toggle, and the existing speed, pause, particles and orbit controls.
- Without WebGL the old flat-ground viewer is used.

**Under the hood**
- Three.js r168 (MIT) is vendored in `static/vendor/` and loaded only for the splash; nothing else in the app uses it.

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
