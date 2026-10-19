// The creature match: 129 flying creatures of myth, fantasy and folklore, each scored on the same eight axes as the quad,
// and the maths that scores the quad from its own flight log and finds its nearest creature.
//
// The eight axes (0-99 for a creature; the quad's own scores come from its log):
//   speed        how fast it can fly flat out             (quad: thrust-to-weight → estimated top speed)
//   power        thrust and lifting strength              (quad: thrust-to-weight)
//   agility      how fast it can rotate, flip and bank    (quad: fastest rotation flown, motor authority)
//   nimbleness   how quickly it answers a command         (quad: step-response rise time and motor lag)
//   endurance    how long it can stay up                  (quad: hover power per kg)
//   climb        how hard it can go straight up           (quad: thrust-to-weight surplus over gravity)
//   steadiness   how well it holds still in gusts         (quad: wobble after throttle chops)
//   smoothness   how clean and quiet the flight is        (quad: vibration reaching the motors and gyro)
// The creatures' numbers are invented for fun, but consistent: a roc is strong and slow to turn, a pixie is weak and impossibly quick.
const CR_AXES = [["spd", "Speed"], ["pwr", "Power"], ["agi", "Agility"], ["nim", "Nimbleness"], ["end", "Endurance"], ["clb", "Climb"], ["std", "Steadiness"], ["smo", "Smoothness"]];
const CR_KINDS = {
  "Dragon": { hue: 8, blurb: "Scaled sky-lords. Huge lungs, huge wings, and a flight style that says: I was here first." },
  "Legendary bird": { hue: 38, blurb: "Birds that carry a legend. They flap like real birds, only more so." },
  "Winged beast": { hue: 28, blurb: "Land animals that were given wings and kept the attitude." },
  "Fey": { hue: 300, blurb: "Tiny, quick, and not in the least bit afraid of a gust of wind." },
  "Insectoid": { hue: 95, blurb: "Many wings, no inertia worth mentioning. The original multirotors." },
  "Spirit": { hue: 195, blurb: "No wings, no weight: they fly by simply deciding to." },
  "Heavenly & infernal": { hue: 345, blurb: "Feathered or leathery, but always dramatic about it." },
  "Construct": { hue: 205, blurb: "Built, not born. Their flight follows a design sheet, which makes them oddly like a quad." },
  "Sky leviathan": { hue: 250, blurb: "Vast, slow and calm. They do not hurry; weather does it for them." },
  "Night wing": { hue: 265, blurb: "Silent, dark and quick to turn: they fly when the rest of the sky sleeps." },
};
// name | kind | body | size 1-5 | spd pwr agi nim end clb std smo
const CR_RAW = `
Western Dragon|Dragon|dragon|5|52 96 36 28 72 64 55 30
Wyvern|Dragon|dragon|4|70 74 64 56 58 66 32 24
Drake|Dragon|dragon|3|62 62 60 54 56 56 42 34
Sky Dragon (Long)|Dragon|serpent|5|58 82 58 46 92 54 76 72
Frost Wyrm|Dragon|dragon|5|44 92 26 20 78 48 62 40
Storm Drake|Dragon|dragon|4|84 80 68 62 52 72 24 14
Ember Whelp|Dragon|dragon|2|56 38 78 84 38 58 46 22
Elder Wyrm|Dragon|dragon|5|38 99 18 14 88 42 68 52
Shadow Dragon|Dragon|dragon|4|72 70 66 60 60 62 38 66
Crystal Dragon|Dragon|dragon|4|56 66 52 48 70 52 80 86
Magma Drake|Dragon|dragon|4|58 84 40 34 50 58 44 18
Swamp Wyvern|Dragon|dragon|3|46 58 44 36 64 40 50 28
Phoenix|Legendary bird|bird|4|74 80 70 66 90 82 48 52
Thunderbird|Legendary bird|bird|5|88 90 60 52 70 74 30 20
Roc|Legendary bird|bird|5|60 98 26 20 94 56 60 62
Simurgh|Legendary bird|bird|5|66 86 54 50 98 66 74 82
Fenghuang|Legendary bird|bird|4|64 66 62 60 86 62 70 90
Firebird|Legendary bird|bird|3|80 62 76 72 60 70 40 30
Garuda|Legendary bird|humanoid|4|94 88 72 66 62 80 28 24
Bennu|Legendary bird|bird|3|70 56 66 62 80 66 66 78
Ziz|Legendary bird|bird|5|52 94 28 22 90 50 70 44
Anzu|Legendary bird|bird|4|66 84 50 44 62 62 40 26
Stymphalian Bird|Legendary bird|bird|2|68 40 82 78 52 60 36 12
Caladrius|Legendary bird|bird|2|50 30 62 66 84 60 88 92
Alicanto|Legendary bird|bird|2|56 34 66 64 62 50 56 70
Huginn the Raven|Legendary bird|bird|2|62 38 80 84 76 58 60 74
Pegasus|Winged beast|beast|4|78 70 62 60 80 66 52 74
Griffin|Winged beast|beast|4|74 82 66 60 66 70 40 36
Hippogriff|Winged beast|beast|3|66 66 60 56 62 60 46 50
Chimera|Winged beast|beast|4|58 86 46 40 54 56 34 16
Manticore|Winged beast|beast|4|56 80 50 46 48 54 30 14
Sphinx|Winged beast|beast|4|60 74 54 50 72 54 72 72
Lamassu|Winged beast|beast|5|40 88 28 24 66 42 80 80
Peryton|Winged beast|beast|3|72 52 72 70 58 66 44 40
Winged Wolf|Winged beast|beast|3|76 58 74 74 64 62 36 44
Sky Stag|Winged beast|beast|3|70 56 64 62 74 58 54 72
Jersey Devil|Winged beast|beast|3|64 54 70 68 48 56 28 12
Thunder Ox|Winged beast|beast|5|50 94 24 20 56 50 50 26
Pixie|Fey|fairy|1|34 14 94 98 42 70 66 70
Sprite|Fey|fairy|1|30 12 96 99 36 66 62 62
Fairy|Fey|fairy|1|32 14 88 92 52 62 70 82
Will-o'-the-Wisp|Fey|orb|1|40 6 90 94 70 48 92 94
Sylph|Fey|fairy|2|52 20 90 90 66 72 82 92
Faerie Dragon|Fey|dragon|1|44 22 92 94 48 66 70 66
Imp|Fey|bat|1|52 26 88 88 44 62 50 28
Gossamer Elf|Fey|fairy|2|46 22 82 86 60 66 86 90
Dandelion Sprite|Fey|fairy|1|12 4 70 74 90 30 78 98
Firefly Fae|Fey|fairy|1|26 8 80 84 82 40 80 88
Snowflake Pixie|Fey|fairy|1|22 8 76 78 66 28 74 94
Leaf Sprite|Fey|fairy|1|28 8 78 80 70 36 66 86
Stardust Sprite|Fey|fairy|1|54 10 92 94 76 60 56 88
Tooth Fairy|Fey|fairy|1|44 14 86 90 60 62 64 80
Giant Dragonfly|Insectoid|insect|3|72 36 96 96 56 58 92 62
Hornet Knight|Insectoid|insect|3|66 64 84 82 40 62 70 14
Glass Moth|Insectoid|insect|2|28 14 66 62 84 36 70 90
Mothman|Insectoid|insect|4|82 62 66 62 70 76 46 26
Luna Moth Spirit|Insectoid|insect|2|36 14 70 66 90 40 76 94
Scarab Guardian|Insectoid|insect|3|34 84 36 30 48 40 40 20
Wasp Queen|Insectoid|insect|3|60 70 78 76 46 60 76 20
Mantis Lord|Insectoid|insect|3|52 62 76 72 52 52 62 52
Butterfly Oracle|Insectoid|insect|2|30 16 66 62 88 36 78 96
Firefly Swarm Lord|Insectoid|insect|3|34 40 72 74 90 40 70 70
Bee Matron|Insectoid|insect|2|42 56 62 60 82 50 90 50
Locust King|Insectoid|insect|3|60 66 50 52 96 54 50 24
Cicada Seer|Insectoid|insect|2|48 24 62 60 66 50 62 32
Wind Elemental|Spirit|orb|4|90 70 84 82 80 76 20 40
Storm Spirit|Spirit|orb|4|92 88 76 74 60 80 14 8
Air Djinn|Spirit|humanoid|4|78 90 78 72 70 84 68 62
Banshee|Spirit|humanoid|3|66 28 80 82 56 62 52 20
Wraith|Spirit|orb|3|62 30 82 80 70 56 66 70
Poltergeist|Spirit|orb|2|58 36 90 94 40 62 40 6
Zephyr|Spirit|orb|3|58 20 70 68 96 50 78 96
Cloud Sprite|Spirit|fairy|2|24 10 62 60 86 40 94 98
Lightning Sprite|Spirit|orb|1|98 40 94 98 14 90 10 4
Aurora Wisp|Spirit|orb|3|44 18 66 66 98 50 84 98
Ifrit|Spirit|humanoid|4|76 92 70 64 54 78 50 14
Ember Wisp|Spirit|orb|1|40 14 86 90 50 56 62 40
Frost Wraith|Spirit|orb|3|52 54 66 62 74 50 80 72
Spectral Eagle|Spirit|bird|3|82 44 76 76 78 70 66 90
Thunder Elemental|Spirit|orb|5|78 96 44 40 50 68 30 8
Mist Phantom|Spirit|orb|3|36 20 58 60 90 42 96 92
Winged Demon|Heavenly & infernal|humanoid|4|74 84 68 62 56 70 36 12
Balrog|Heavenly & infernal|humanoid|5|50 98 30 24 54 56 30 6
Fallen Angel|Heavenly & infernal|humanoid|3|70 72 72 70 68 68 56 60
Seraph|Heavenly & infernal|humanoid|4|80 82 74 72 90 80 80 92
Cherub|Heavenly & infernal|humanoid|1|40 18 80 82 70 52 82 88
Valkyrie|Heavenly & infernal|humanoid|3|82 74 78 74 74 74 56 54
Archangel|Heavenly & infernal|humanoid|4|86 90 80 76 92 82 78 90
Nightgaunt|Heavenly & infernal|bat|4|78 56 80 76 60 70 54 94
Harpy|Heavenly & infernal|humanoid|3|68 50 82 78 52 62 38 14
Siren Gull|Heavenly & infernal|bird|2|60 36 76 76 70 56 60 66
Skeletal Wyvern|Heavenly & infernal|dragon|4|64 66 56 50 80 54 48 54
Revenant Raven|Heavenly & infernal|bird|2|66 44 78 80 82 60 62 76
Lich Bat|Heavenly & infernal|bat|2|58 42 74 72 66 56 56 62
Hell Hawk|Heavenly & infernal|bird|3|88 58 82 80 54 72 42 16
Angelic Scout|Heavenly & infernal|humanoid|2|72 46 80 80 80 68 72 82
Kinnara|Heavenly & infernal|humanoid|3|58 42 66 66 82 56 84 88
Stone Gargoyle|Construct|construct|4|46 88 40 32 70 40 80 62
Clockwork Owl|Construct|construct|2|52 40 74 74 66 52 82 96
Brass Dragonfly|Construct|construct|2|62 36 88 90 50 54 86 56
Steam Wyvern|Construct|construct|4|58 82 46 40 60 52 56 18
Iron Griffin|Construct|construct|4|62 90 48 44 74 54 50 30
Crystal Glider|Construct|construct|3|50 44 58 56 88 44 70 90
Mechanical Hummingbird|Construct|construct|1|48 22 94 96 40 68 98 74
Windup Bat|Construct|construct|2|44 30 76 74 48 50 56 36
Gearwork Phoenix|Construct|construct|4|70 76 62 58 80 66 56 58
Rune Drone|Construct|construct|2|66 36 82 88 62 62 94 90
Cloud Whale|Sky leviathan|ray|5|26 98 14 10 99 34 90 98
Sky Manta|Sky leviathan|ray|4|58 62 56 52 90 48 84 96
Aether Jelly|Sky leviathan|jelly|3|18 26 36 40 90 30 90 90
Storm Ray|Sky leviathan|ray|4|80 84 48 44 72 62 40 20
Void Jellyfish|Sky leviathan|jelly|4|34 50 50 54 82 38 88 94
Star Whale|Sky leviathan|ray|5|50 96 16 12 99 40 80 96
Wind Serpent|Sky leviathan|serpent|4|70 56 82 76 76 62 58 62
Quetzalcoatl|Sky leviathan|serpent|5|72 84 62 58 86 64 70 82
Amaru|Sky leviathan|serpent|5|60 78 52 46 88 54 66 80
Thunder Eel|Sky leviathan|serpent|3|76 70 80 78 40 62 28 8
Zeppelin Whale|Sky leviathan|ray|5|20 90 12 8 96 26 98 98
Paper Crane Spirit|Sky leviathan|bird|2|36 12 66 62 92 42 82 98
Kite Dragon|Sky leviathan|serpent|3|50 36 70 66 74 40 72 70
Lantern Jelly|Sky leviathan|jelly|2|22 14 44 46 88 24 96 96
Giant Bat|Night wing|bat|3|58 52 84 82 66 60 52 40
Owl King|Night wing|bird|4|60 72 66 60 84 60 80 98
Night Moth|Night wing|insect|2|42 22 74 70 80 44 70 90
Shadow Bat|Night wing|bat|2|72 40 90 90 58 64 50 82
Cave Wyrmling|Night wing|dragon|2|44 52 62 56 52 46 46 38
Dusk Bat Swarm|Night wing|bat|2|66 44 80 82 70 54 60 52
Midnight Owl|Night wing|bird|3|56 54 70 66 88 52 78 98
Owl Sage|Night wing|bird|3|44 46 56 52 90 40 90 96
`;
const CREATURES = CR_RAW.trim().split("\n").map((l, id) => { const [name, kind, body, sz, st] = l.split("|"), v = st.split(" ").map(Number);
  return { id, name, kind, body, sz: +sz, s: Object.fromEntries(CR_AXES.map(([k], i) => [k, v[i]])), v }; });

// a sentence about how it flies, from its own numbers: its two best axes and its worst
function crLore(c) {
  const lab = { spd: ["fast", "slow"], pwr: ["powerful", "frail"], agi: ["acrobatic", "ponderous in a turn"], nim: ["quick to answer a command", "slow to react"], end: ["tireless", "short of breath"], clb: ["a fierce climber", "a reluctant climber"], std: ["rock-steady in a gust", "tossed about by every gust"], smo: ["silky smooth", "rough and noisy"] };
  const r = CR_AXES.map(([k], i) => [k, c.v[i]]).sort((a, b) => b[1] - a[1]), best = r.slice(0, 2).map(x => lab[x[0]][0]), worst = r[r.length - 1];
  return `${CR_KINDS[c.kind].blurb} This one is ${best.join(" and ")}${worst[1] < 40 ? `, but ${lab[worst[0]][1]}` : ""}.`;
}

// ---------- the quad's own eight scores, from its log ----------
const crClamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const crMap = (x, lo, hi) => crClamp((x - lo) / (hi - lo));      // lo → 0, hi → 1
function quadScores(R, stats) {
  const sc = R.score || {}, pr = (R.profile && R.profile.derived) || {}, used = (R.profile && R.profile.used) || {}, m = (R.model && R.model.axes) || {}, why = {}, out = {};
  const twr = sc.twr || pr.twr, kg = used.auw_kg, avg = (...a) => { const v = a.filter(x => x != null && isFinite(x)); return v.length ? v.reduce((p, q) => p + q, 0) / v.length : null; };
  const vtop = twr ? 11 * Math.sqrt(Math.max(0, twr - 1)) : null;                    // flat-out speed with the thrust vector tilted until it just holds height: about 11 m/s per √(T/W−1)
  out.spd = vtop == null ? null : crMap(vtop, 8, 60) ** 0.9; why.spd = vtop == null ? "no thrust estimate" : `≈${Math.round(vtop * 3.6)} km/h flat out (estimated from thrust-to-weight ${twr}×)`;
  out.pwr = twr == null ? null : crMap(twr, 2, 14) ** 0.8; why.pwr = twr == null ? "no thrust estimate" : `thrust-to-weight ${twr}×`;
  const maxr = stats && stats.max_rate_dps, auth = avg(m.roll && m.roll.b, m.pitch && m.pitch.b);
  out.agi = maxr == null ? null : (0.7 * crMap(maxr, 80, 1000) ** 0.8 + 0.3 * (auth == null ? crMap(maxr, 80, 1000) : crMap(auth, 30, 260))); why.agi = `fastest rotation flown ${maxr == null ? "–" : Math.round(maxr)} °/s${auth == null ? "" : ` · motor authority ${Math.round(auth)}`}`;
  const rise = avg(sc.rise_roll, sc.rise_pitch), tau = R.model && R.model.motor && R.model.motor.tau_ms;
  out.nim = rise == null && tau == null ? null : avg(rise == null ? null : 1 - crMap(rise, 10, 80), tau == null ? null : 1 - crMap(tau, 18, 80)); why.nim = `${rise == null ? "" : `rise ${rise.toFixed(0)} ms`}${rise != null && tau != null ? " · " : ""}${tau == null ? "" : `motor lag ${Math.round(tau)} ms`}`;
  const hw = pr.hover_w, wkg = hw && kg ? hw / kg : null;
  out.end = wkg == null ? null : 1 - crMap(wkg, 40, 250); why.end = wkg == null ? "no hover power estimate" : `hover power ${Math.round(wkg)} W/kg`;
  out.clb = twr == null ? null : crMap(twr - 1, 0, 12); why.clb = twr == null ? "no thrust estimate" : `${(9.81 * (twr - 1)).toFixed(0)} m/s² of vertical surplus`;
  out.std = sc.pw_ratio == null ? null : 0.7 * (1 - crMap(sc.pw_ratio, 1, 6)) + 0.3 * (1 - crMap(sc.pw_bad ?? 30, 0, 80)); why.std = sc.pw_ratio == null ? "no throttle chops to measure" : `wobble after throttle chops ${sc.pw_ratio}× calm`;
  const nm = sc.motor_hf == null ? null : 1 - crMap(sc.motor_hf, 0.3, 4), ng = sc.gyro_hf == null ? null : 1 - crMap(sc.gyro_hf, 0.5, 6);
  out.smo = avg(nm, ng); why.smo = `noise reaching the motors ${sc.motor_hf ?? "–"}% RMS · gyro noise ${sc.gyro_hf ?? "–"} °/s`;
  const miss = []; CR_AXES.forEach(([k]) => { if (out[k] == null) { miss.push(k); out[k] = 0.5; } else out[k] = crClamp(out[k]); });
  return { v: CR_AXES.map(([k]) => Math.round(out[k] * 99)), why, miss, vtop };
}

// the nearest creatures: weighted distance over the eight axes, turned into a 0-100 "how alike" figure
function crMatch(q, weights = null) {
  const w = weights || CR_AXES.map(() => 1), wsum = w.reduce((a, b) => a + b, 0);
  return CREATURES.map(c => { let d = 0; for (let i = 0; i < 8; i++) d += w[i] * (q[i] - c.v[i]) ** 2; d = Math.sqrt(d / wsum);   // RMS gap in score points
    return { c, d, like: Math.round(100 * Math.exp(-d / 28)) }; }).sort((a, b) => a.d - b.d);
}
if (typeof module !== "undefined") module.exports = { CREATURES, CR_AXES, CR_KINDS, quadScores, crMatch, crLore };
