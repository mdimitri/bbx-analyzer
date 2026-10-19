// Avatar tab: tooltip one-liners. Pure fun, not a measurement. Nothing here names the creature (the card already does).
// Quad voice (CR_DRONE): 8 axes x 30 levels, mechanical and droney, crQuip(axis, score 0..99).
// Creature voice: 8 axes x 30 levels of dry one-liners (CR_TPL), some levels with a per-creature variant that uses what the creature is known for
// ({act}: its habit, {foe}: who it bothers, {thing}: its signature item) from a 150-entry lexicon of folklore facts, crCreatureQuip(creature, axis, score 0..99).
const CR_DRONE = {
 "spd": [
  "Groundspeed: negligible. Bird overtaking detected.",
  "Velocity nominal for a lawn ornament.",
  "Cruise speed below minimum viable commute.",
  "Throttle response: leisurely. ETA: unknown.",
  "Speed envelope: shopping trolley.",
  "Forward flight achieved. Excitement not detected.",
  "Pace: scheduled maintenance walk.",
  "Airspeed within safe, polite limits.",
  "Velocity adequate for light errands.",
  "Speed profile: suburban. Mild.",
  "Cruise speed meets expectations. Barely.",
  "Airspeed: respectable. Log entry made.",
  "Forward velocity: good. Wind noted, not blamed.",
  "Speed: above median. Proceeding briskly.",
  "Groundspeed healthy. Props at 80%.",
  "Velocity: commuter-grade. Zero delays.",
  "Airspeed exceeds spec by a polite margin.",
  "Overtaking manoeuvre complete. No mirrors needed.",
  "Velocity warning: speeding ticket queued.",
  "Speed envelope expanded. Bugs file complaints.",
  "Groundspeed high. Bird-avoidance protocol engaged.",
  "Airspeed: sports-car class. Brakes judged.",
  "Horizon approach rate: concerning.",
  "Velocity: blink-and-miss. Vapour trail logged.",
  "Speed exceeds comfortable physics. Warning issued.",
  "Terminal velocity exceeded. Manual unread.",
  "Arrival timestamp precedes departure. Clock error.",
  "Speed: bus-hazard class. Incident report open.",
  "Friction heating detected on frame. Nominal, apparently.",
  "Velocity: warp. Safety margin deleted."
 ],
 "pwr": [
  "Thrust-to-weight: apologetic.",
  "Max thrust: marginal. Payload: optimistic.",
  "Motors report: \"we tried\".",
  "Power output below hover-with-confidence threshold.",
  "Thrust margin: thin as a spec sheet.",
  "Motors present, enthusiastic, undersized.",
  "Thrust: enough to lift own pride. Barely.",
  "TWR: marginal. Climb not recommended.",
  "Propulsion adequate for light hobby use.",
  "Thrust acceptable. No heroics scheduled.",
  "TWR: sensible. Battery acknowledges.",
  "Power reserve: healthy. Payload tolerated.",
  "Thrust margin comfortable. Motors unbothered.",
  "Propulsion nominal. Gravity noted.",
  "Thrust: confident. Hardware agrees.",
  "TWR high. Lifting capacity: surprising.",
  "Propulsion at 40% for hover. Reserves large.",
  "Thrust margin: generous. Gravity negotiating.",
  "TWR exceeds sensible. Props uneasy.",
  "Motors report spare capacity, then laugh.",
  "Thrust: sufficient to embarrass a small car.",
  "Propulsion reserve: huge. Payload: any.",
  "TWR > 10. Frame stress alert, quietly.",
  "Motors flexing in the log file.",
  "Thrust: ridiculous. Documented.",
  "Power margin: rocket-adjacent. Props pleading.",
  "Gravity override authorised.",
  "Thrust levels: orbital. Authorisation: none.",
  "Power: overwhelming. Fuses sweating.",
  "Thrust exceeds physics requirements. Request denied."
 ],
 "agi": [
  "Yaw authority: glacial. Course changes by committee.",
  "Turn rate: cruise-ship class.",
  "Steering input acknowledged. Execution: pending.",
  "Roll rate: fridge-grade.",
  "Corner entry computed. Corner exit: eventually.",
  "Rotation rate: bureaucratic.",
  "Pivot subsystem requests extra runway.",
  "Dodge routine: delayed, but sincere.",
  "Angular rate: modest. Effort: noted.",
  "Turning possible with advance notice.",
  "Roll/pitch/yaw: sensible hatchback.",
  "Cornering within normal limits. No screaming.",
  "Angular rate: agile enough for tight rooms.",
  "Weave routine nominal. Traffic cones intact.",
  "Turn rate adequate. Radius: a big coin.",
  "Pivot executed. Apology queued.",
  "Roll rate: quick. Slipper avoided.",
  "Spin rate high. Win condition met.",
  "Angular rate: snappy. Heading: reconsidered.",
  "Flip response: startled cat equivalent.",
  "Cornering exceeds spec. Showing off detected.",
  "Turn radius: one dime. Change returned.",
  "Rotation rate flagged: dizziness likely.",
  "Heading and intent changed concurrently.",
  "Slalom routine: shadow avoided.",
  "Orientation envelope: decorative.",
  "Angular rate: dime-stealing class.",
  "Roll rate beyond gimbal comfort.",
  "Attitude: rumour only.",
  "Rotation exceeds sensor ceiling. Gyro reports sadness."
 ],
 "nim": [
  "Response latency: landline.",
  "Control latency high. Commands queued by post.",
  "Input accepted. Response: some day.",
  "Loop delay stacked on loop delay.",
  "Latency long enough for a brew.",
  "Stick-to-gyro lag: administrative.",
  "Response sluggish but orderly.",
  "Reaction time: second coffee required.",
  "Latency modest. Awake, mostly.",
  "Stick response: polite, unhurried.",
  "Latency acceptable. Sobriety confirmed.",
  "Response precedes stick end. Impressive.",
  "Control latency: goalkeeper-class.",
  "Draw fast, holster slow. Filters blamed.",
  "Response snappy. Baguette fresh.",
  "Stick-to-gyro latency low. Mind read, approximately.",
  "Twitch response: helpful.",
  "Latency minimal. Caffeine simulated.",
  "Response arrives before request completes.",
  "Reflex loop: sharper than audit.",
  "Latency: sub-chopstick.",
  "Response lands between two heartbeats.",
  "Latency negligible. Time dilates to keep up.",
  "Reply sent before the command. Clocks disputing.",
  "Reflex loop: feline, minus naps.",
  "Input read like gossip. Response instant.",
  "Latency faster than regret.",
  "Lag not found. Search completed.",
  "Latency beyond measurement. Instrument embarrassed.",
  "Response predicts future input. Policy review pending."
 ],
 "end": [
  "Battery state: anxious.",
  "Flight time: one sigh.",
  "Endurance: fumes and prayer.",
  "Power budget exhausted before the pre-flight check.",
  "Landing to rest is scheduled. Again.",
  "Battery: one stressed AA equivalent.",
  "Endurance: sprint class.",
  "Cell voltage sagging by minute three.",
  "Duty cycle: short bursts, long recovery.",
  "Endurance: metered, like a taxi.",
  "Flight time adequate for a short podcast.",
  "Battery reserve: acceptable. Snacks not included.",
  "Endurance: tortoise with sponsor.",
  "Flight time exceeds coffee supply.",
  "Battery lasts a playlist. Repeat unavailable.",
  "Endurance: neighbourhood laps, no complaints.",
  "Power use efficient. Accountant pleased.",
  "Current draw: sipping.",
  "Endurance: all afternoon. Pilot's thumbs, uncertain.",
  "Efficiency improves per kilometre.",
  "Marathon class. Smug firmware.",
  "Endurance exceeds three battery packs.",
  "Power bills afraid. Battery smug.",
  "Hover time: hours. Sweat: none.",
  "Efficiency: spite-based.",
  "Flight time ruins pilot's afternoon.",
  "Battery requests early retirement.",
  "Thermodynamics circumvented. Logged.",
  "Endurance: until park closes.",
  "Flight time: until heat death. Charger idle."
 ],
 "clb": [
  "Climb rate: gravity wins.",
  "Ascent: soufflé-grade.",
  "Altitude gain: stairs with handrail.",
  "Climb rate: suggested.",
  "Ascent happened by accident.",
  "Vertical speed: elevator music.",
  "Hill classified as major event.",
  "Altitude rises in a heavy sigh.",
  "Climb clears fence. Barely.",
  "Ascent with sensible payload.",
  "Climb nominal. No drama.",
  "Vertical rate: tree-hop.",
  "Altitude gain: keen hiker.",
  "Rooftop attainable on a good day.",
  "Climb confident. Spring in the step.",
  "Vertical speed high. Bargain detected.",
  "Ascent rate takes lifts personally.",
  "Ceiling located. Request for more.",
  "Climb: beef with gravity logged.",
  "Treeline cleared. Ears popping.",
  "Vertical metres consumed at breakfast rate.",
  "Lift replaced by catapult.",
  "Ascent: secret-spreading speed.",
  "Clouds underdressed on arrival.",
  "Altitude is only a number. Number bored.",
  "Vertical: bad-idea class.",
  "Stairs, lift and building bypassed.",
  "Launch pad: conceptual.",
  "Orbit as courtesy. Permit pending.",
  "Gravity resigned. Letter filed."
 ],
 "std": [
  "Hover stability: shopping trolley in gale.",
  "Attitude hold: jelly on spin cycle.",
  "Oscillation: rollercoaster by choice.",
  "Position hold: general vicinity.",
  "Dancing to internal clock. Gyro dissenting.",
  "Hover shakes. Intern behaviour.",
  "Stability: acceptable if squinting.",
  "Wiggle confident. Loops flagged.",
  "Attitude: tipsy but charming.",
  "Hover: waiter at midnight.",
  "Level mostly. Occasionally spirited.",
  "Line holding: toddler with crayon.",
  "Stability: lidded tea compatible.",
  "Sway: hammock. Gentle.",
  "Stability calm. Mischief at 2%.",
  "Hold steady. Sunday afternoon mode.",
  "Level-headed. Unlike the pilot.",
  "Waiter with soup. No spills.",
  "Attitude held in gusts.",
  "Throttle chops absorbed.",
  "Gust rejection: diplomatic.",
  "Rock-solid. Rock flies.",
  "Soup carrier, grade A, no splash.",
  "No wobble detected, even on request.",
  "Attitude pinned with invisible screws.",
  "Zen monk with soup. Stillness verified.",
  "Spirit level jealous.",
  "Immovable and unbothered. Wind noted.",
  "Wind complaint rejected.",
  "Stillness so deep it echoes."
 ],
 "smo": [
  "Noise floor: shopping cart with a grudge.",
  "Vibration: hornets in a spreadsheet.",
  "Vibrations beyond physics approval.",
  "Gyro log: coffee grinder with feelings.",
  "Vibration level: filling-rattling.",
  "Noise floor: everything, everywhere.",
  "Spin cycle detected in gyro trace.",
  "Jitter high. Phone on silent in church.",
  "Grit detected in the signal.",
  "Sandpaper in the gyro spectrum.",
  "Signal quality: chunky.",
  "Gravel notes in gyro output.",
  "Hum pleasant. Mostly polite.",
  "Gyro trace clean enough to serve dinner on.",
  "Quiet. Suspiciously. Sensors checking.",
  "Smoother than an apology.",
  "Gyro: well-oiled drawer.",
  "Silky signal, small side of silk.",
  "Noise low. Self-respect high.",
  "Signal like midnight jazz.",
  "Butter on warm knife detected.",
  "Satin signal. No fingerprints.",
  "Glass-smooth. Spectrogram bored.",
  "Hover clean enough to be illegal.",
  "Noise: ninja whisper.",
  "Smooth enough to confuse the spectrogram.",
  "Silk on butter. Sensors blush.",
  "Gravity slips off the signal.",
  "Noise: not found.",
  "Friction: nil. Air jealous."
 ]
};
const CR_TPL = {
 "spd": [
  "Outrun by a thoughtful snail.",
  "Speed limit: whatever the wind allows.",
  "Arrives eventually, apologising.",
  "Brisk, if you count a brisk shuffle.",
  "Moves like it's carrying a full cup of tea.",
  "A pensioner on a mobility scooter, with dignity.",
  "Late for the bus, and the next one.",
  "Cruising at \"I'll get there when I get there\".",
  "Fast enough to overtake a cyclist, barely.",
  "Speedy for a sofa.",
  "Respectable. Mum would be proud.",
  "Gets the shopping done before the shop closes.",
  "Quick enough to beat the kettle.",
  "Making the green light, most of the time.",
  "Faster than your WiFi on a good day.",
  "Commuter-train energy, minus the delays.",
  "Leaves a polite little breeze.",
  "Overtakes without even checking the mirror.",
  "Speeding ticket: pending.",
  "Fast enough that bugs file complaints.",
  "Bird-scaring velocity unlocked.",
  "Makes sports cars feel judged.",
  "The horizon is getting nervous.",
  "Blink and you've missed the vapour trail.",
  "Physics is sending strongly worded letters.",
  "Arrives before it left. Paperwork is a mess.",
  "The bus is now a crime scene.",
  "Gets a tan from friction.",
  "Outruns its own shadow, and the shadow sulks.",
  "Warp speed with a side of audacity."
 ],
 "pwr": [
  "Pushes like a wet noodle.",
  "Could lift a feather, with encouragement.",
  "Strong as a motivational poster.",
  "Skipped leg day, arm day and most days.",
  "Needs both hands to hold a sandwich.",
  "Muscles mostly decorative.",
  "Can open a yoghurt, mostly.",
  "Lifts its own weight, just about.",
  "Gym membership: unused but paid.",
  "A decent shove, nothing more.",
  "Pulls its weight, and a bit more.",
  "Carries the groceries in one trip. Proudly.",
  "Mildly intimidating at a barbecue.",
  "Could win a tug-of-war against a toddler.",
  "Opens jars for the whole family.",
  "Solid thrust, solid confidence.",
  "Eats protein for breakfast, lunch and fear.",
  "Lifts a sofa and calls it cardio.",
  "Throws its weight around, politely.",
  "Pushes back at gravity, and gravity blinks.",
  "Bench-presses a small car on a whim.",
  "Thrust to spare, and a spare of the spare.",
  "Treats its own weight as a rounding error.",
  "Flexes when nobody's looking.",
  "Has a gym buddy called Hulk.",
  "Rocket-science-adjacent shoulders.",
  "Gravity has applied for a transfer.",
  "Could launch a piano into orbit.",
  "Power overwhelming. Ask nicely first.",
  "Bends physics, mostly for fun."
 ],
 "agi": [
  "Turns like a cruise ship in treacle.",
  "Steering is more of a suggestion.",
  "Takes a roundabout in three business days.",
  "Corners with the grace of a fridge.",
  "Turns left by committing to a long right.",
  "A U-turn needs a risk assessment.",
  "Pivots like a shopping trolley with a bad wheel.",
  "Dodges, eventually.",
  "Slow-motion reflexes, heroic effort.",
  "Can turn, given a postcode and some warning.",
  "Handles like a sensible hatchback.",
  "Takes bends without screaming.",
  "Nimble enough for a crowded pub.",
  "Weaves through traffic, politely.",
  "Turns on a coin, a big coin.",
  "Quick pivot, quicker apology.",
  "Dodges the thrown slipper.",
  "Spins to win, and wins.",
  "Doesn't turn so much as reconsider direction.",
  "Flicks around like a startled cat.",
  "Corners with a hint of showing off.",
  "Can turn on a dime and keep the change.",
  "Spins like it's late for another spin.",
  "Changes mind and heading simultaneously.",
  "Slaloms around its own shadow.",
  "Corners like gravity is optional.",
  "Turns on a dime, steals the dime, and is gone.",
  "Pirouettes through a keyhole.",
  "Orientation is a rumour.",
  "Redefines \"turning\" as a quantum event."
 ],
 "nim": [
  "Responds eventually, like a landline.",
  "Reacts at the speed of bureaucracy.",
  "Thinks about moving. Sometimes it does.",
  "A sloth with a delay on the delay.",
  "Lag so long you can make tea.",
  "Commands arrive by post.",
  "Sluggish, but with a dignified pause.",
  "Awake after the second coffee.",
  "A hummingbird with a mortgage.",
  "Responds when it feels respected.",
  "Reasonably prompt, mostly sober.",
  "Answers the stick before the stick finishes.",
  "Reaction time of a well-rested goalkeeper.",
  "Quick on the draw, slow on the holster.",
  "Snappy as a fresh baguette.",
  "Responds like it read your mind, on a good day.",
  "Twitchy in a helpful way.",
  "Caffeinated hummingbird.",
  "Reacts before the thought finishes loading.",
  "Reflexes sharper than a tax inspector.",
  "Catches flies with chopsticks, mid-spin.",
  "Responds in the gap between two heartbeats.",
  "Time slows down just to keep up.",
  "Gets the message before it's sent.",
  "Cat-like reflexes, minus the napping.",
  "Reads the stick like a gossip column.",
  "Responds faster than regret.",
  "Lag? Never met her.",
  "Reflexes that make lightning look lazy.",
  "Reacts to the future, politely."
 ],
 "end": [
  "Needs a nap after take-off.",
  "Runs on fumes and optimism.",
  "Battery anxiety: chronic.",
  "Runs out of puff before the introduction.",
  "Lands to catch its breath. And again.",
  "Powered by a single, stressed AA.",
  "A sprinter with a pension plan.",
  "Gasping by minute three.",
  "Short bursts, long recoveries.",
  "Flies like it's paying by the minute.",
  "Decent stamina, mediocre snacks.",
  "Can last a whole podcast.",
  "Doesn't need to stop for a sandwich. Yet.",
  "Steady, like a tortoise with a sponsor.",
  "Will outlast your coffee.",
  "Cruises through a full playlist.",
  "Laps the neighbourhood and asks for more.",
  "Efficient, like a Scottish accountant.",
  "Sips power like fine whisky.",
  "Could do this all afternoon.",
  "Gets better with every kilometre.",
  "Marathon runner with a smug smile.",
  "Outlasts three batteries and a bad mood.",
  "Energy companies fear it.",
  "Hovers for hours without breaking a sweat.",
  "Powered by spite and clean aerodynamics.",
  "Ruins your afternoon for hours.",
  "Its battery has filed for early retirement.",
  "Defies thermodynamics, politely.",
  "Flies until the heat death of the park."
 ],
 "clb": [
  "Gravity wins every argument.",
  "Rises like a sulking soufflé.",
  "Takes the stairs. Slowly. Holding the rail.",
  "Climb rate: gentle suggestion.",
  "Goes up, mostly by accident.",
  "Elevator music, no elevator.",
  "A hill is a major life event.",
  "Ascends like a heavy sigh.",
  "Makes it over the fence. Just.",
  "Climbs with a sensible backpack.",
  "Decent lift, no dramatics.",
  "Hops up a tree without a fuss.",
  "Gains height like a keen hiker.",
  "Scales a rooftop on a good day.",
  "Up it goes, with a spring in its step.",
  "Zooms up like it saw a bargain.",
  "Takes lifts personally.",
  "Finds the ceiling and asks for more.",
  "Climbs like it has beef with gravity.",
  "Rockets past the treeline.",
  "Eats vertical metres for breakfast.",
  "Elevator? No. Catapult.",
  "Going up like a shared secret.",
  "Leaves clouds feeling underdressed.",
  "Altitude is just a number, and it's bored.",
  "Vertical like a bad idea.",
  "Skips the stairs, the lift and the building.",
  "Launch pad is a state of mind.",
  "Orbit, but as a courtesy.",
  "Gravity resigns quietly."
 ],
 "std": [
  "A shopping trolley in a gale.",
  "Wobbles like a jelly on a washing machine.",
  "Flies like it's on a rollercoaster. By choice.",
  "Hovers in a general vicinity. Optimistic.",
  "Dances to a beat only it hears.",
  "Shakes like a nervous intern.",
  "Steady if you squint and are generous.",
  "Wiggles with confidence.",
  "Slightly tipsy, still charming.",
  "A waiter with a full tray, after midnight.",
  "Mostly level, occasionally spirited.",
  "Holds a line like a toddler holds a crayon.",
  "Steady enough for a cup of tea. Lidded.",
  "Gentle sway, like a hammock.",
  "Calm, with a tiny hint of mischief.",
  "Steady as a Sunday afternoon.",
  "Level-headed, unlike its owner.",
  "Waiter carrying soup.",
  "Stays put, even when the wind misbehaves.",
  "Doesn't flinch at throttle chops.",
  "Handles gusts like a diplomat.",
  "Rock-solid, but a flying rock.",
  "Soup carrier, grade A.",
  "Doesn't wobble, even when asked nicely.",
  "Nailed to the sky with invisible screws.",
  "A Buddhist monk carrying soup.",
  "Smooth as a spirit level's best day.",
  "Immovable, and unbothered.",
  "Wind files a complaint, gets ignored.",
  "Stillness so deep it has an echo."
 ],
 "smo": [
  "A shopping cart with a grudge.",
  "Buzzes like an angry hornet's nest.",
  "Vibrates in ways physics did not approve.",
  "Sounds like a coffee grinder with feelings.",
  "Rattles the fillings out of passing clouds.",
  "Noise floor: all of it.",
  "Feels like a washing machine on spin.",
  "Jittery, like a phone on silent in church.",
  "Gritty. Like sand in a sandwich.",
  "A touch of sandpaper in the signal.",
  "Not smooth, not crunchy: chunky.",
  "Smooth-ish, with notes of gravel.",
  "Pleasant hum, mostly polite.",
  "Clean enough to serve dinner on.",
  "Quiet. Suspiciously quiet.",
  "Smoother than a politician's apology.",
  "Gliding like a well-oiled drawer.",
  "Silky, with a small side of silk.",
  "Low noise, high self-respect.",
  "Smooth like a jazz saxophone at midnight.",
  "Butter on a warm knife.",
  "Satin pyjamas in motion.",
  "Glass-smooth, no fingerprints.",
  "A hover so clean it feels illegal.",
  "Silent as a ninja's whisper.",
  "Smooth enough to confuse the spectrogram.",
  "Butter on silk.",
  "So smooth gravity slips off.",
  "Noise? Never heard of it.",
  "Frictionless. Even the air is jealous."
 ]
};
const CR_VAR = {"spd": {"0": "Overtaken by {foe}. On foot.", "2": "Too busy {act} to hurry.", "3": "Even {thing} had time to get bored.", "5": "{foe} could catch it with a sandwich and patience.", "16": "{foe} notice it only after it has passed.", "19": "Fast enough that {foe} start running early.", "20": "{foe} have to hold on to their hats.", "26": "{foe} file complaints, retroactively.", "27": "Even {thing} had trouble keeping up."}, "pwr": {"9": "A decent shove, enough to bother {foe}.", "13": "Would beat {foe} in a tug-of-war. Probably.", "18": "Throws its weight around, mostly at {foe}.", "23": "{foe} flinch when it flexes.", "19": "Pushes back at gravity while {act}, and gravity blinks."}, "agi": {"13": "Weaves around {foe}, politely.", "25": "{foe} try to follow and end up dizzy.", "7": "Dodges {foe}, eventually.", "20": "Corners with a hint of showing off to {foe}."}, "nim": {"6": "Sluggish, but dignified, even while {act}.", "17": "{foe} blink, and it has already reacted.", "24": "Cat-like reflexes, even while {act}.", "12": "Reacts faster than {foe} can say \"look out\".", "3": "Reaction delay long enough to finish {act}."}, "end": {"19": "Could keep {act} all afternoon.", "26": "{foe} give up and go home first.", "12": "Doesn't need to stop {act} for a sandwich. Yet.", "22": "Outlasts three batteries, a bad mood and {foe}.", "7": "Gasping by minute three of {act}."}, "clb": {"4": "Goes up mostly by accident, usually while {act}.", "16": "Takes lifts personally, especially around {foe}.", "19": "Rockets past the treeline, {foe} left far below.", "23": "Leaves clouds feeling underdressed, and {foe} very small.", "13": "Scales a rooftop on a good day, to the alarm of {foe}."}, "std": {"4": "Dances to a beat only it hears, usually while {act}.", "16": "Level-headed, unlike most {foe}.", "18": "Stays put while {act}, even when the wind misbehaves.", "5": "Shakes like a nervous intern near {foe}.", "27": "Immovable, and unbothered by {foe}."}, "smo": {"9": "A touch of sandpaper in the signal, mostly while {act}.", "14": "Quiet. Suspiciously quiet. {foe} are worried.", "17": "Silky, even while {act}.", "22": "Glass-smooth, no fingerprints from {foe}.", "24": "Silent as a ninja, which {foe} never notice."}};
const CR_LEX = {
"Western Dragon": [
"its hoard",
"guarding gold",
"knights"
],
"Wyvern": [
"its barbed tail",
"sulking on a crag",
"shepherds"
],
"Drake": [
"its smoulder",
"showing off",
"pigeons"
],
"Sky Dragon (Long)": [
"its pearl",
"coiling through clouds",
"thunderclouds"
],
"Frost Wyrm": [
"its frost",
"freezing lakes",
"snowmen"
],
"Storm Drake": [
"its lightning",
"scolding the sky",
"umbrellas"
],
"Ember Whelp": [
"its tiny flames",
"toasting marshmallows",
"candles"
],
"Elder Wyrm": [
"its centuries",
"napping on mountains",
"heroes"
],
"Shadow Dragon": [
"its shadow",
"lurking in caves",
"torches"
],
"Crystal Dragon": [
"its facets",
"sparkling at nothing",
"jewellers"
],
"Magma Drake": [
"its lava",
"melting boots",
"volcanologists"
],
"Swamp Wyvern": [
"its mud",
"wallowing",
"frogs"
],
"Hydra": [
"its extra heads",
"arguing with itself",
"heroes"
],
"Phoenix": [
"its ashes",
"rising again",
"fire alarms"
],
"Thunderbird": [
"its thunderclap",
"flapping up storms",
"forecasters"
],
"Roc": [
"its elephant snack",
"carrying elephants",
"sailors"
],
"Simurgh": [
"its wisdom",
"teaching other birds",
"philosophers"
],
"Fenghuang": [
"its grace",
"strutting politely",
"dull emperors"
],
"Firebird": [
"its glowing feather",
"being stolen from",
"feather thieves"
],
"Garuda": [
"its snake grudge",
"hunting serpents",
"snakes"
],
"Bennu": [
"its sunrise",
"greeting the sun",
"owls"
],
"Ziz": [
"its wingspan",
"blotting out the sun",
"sunbathers"
],
"Anzu": [
"its stolen tablet",
"meddling with destiny",
"gods"
],
"Stymphalian Bird": [
"its bronze feathers",
"raining feathers",
"heroes"
],
"Caladrius": [
"its bedside manner",
"diagnosing the sick",
"newsreaders"
],
"Alicanto": [
"its glowing wings",
"guiding miners",
"gold diggers"
],
"Huginn the Raven": [
"its thoughts",
"gossiping with gods",
"secrets"
],
"Pegasus": [
"its mane",
"trotting on clouds",
"carts"
],
"Griffin": [
"its claws",
"guarding treasure",
"thieves"
],
"Hippogriff": [
"its pride",
"demanding a bow",
"rude wizards"
],
"Chimera": [
"its three opinions",
"three-way arguments",
"single-minded things"
],
"Manticore": [
"its stinger",
"taking offence",
"travellers"
],
"Sphinx": [
"its riddle",
"asking riddles",
"tourists"
],
"Lamassu": [
"its gateway",
"guarding doors",
"trespassers"
],
"Peryton": [
"its antlers",
"casting the wrong shadow",
"hunters"
],
"Winged Wolf": [
"its pack",
"howling above clouds",
"sheep"
],
"Sky Stag": [
"its antlers",
"posing nobly",
"hunters"
],
"Jersey Devil": [
"its scream",
"haunting the Pine Barrens",
"campers"
],
"Thunder Ox": [
"its hooves",
"stomping on clouds",
"fences"
],
"Jackalope": [
"its antlers",
"pretending to be a rabbit",
"taxidermists"
],
"Pixie": [
"its dust",
"sprinkling dust",
"bees"
],
"Sprite": [
"its mischief",
"tripping travellers",
"clocks"
],
"Fairy": [
"its wand",
"granting small wishes",
"teeth"
],
"Will-o'-the-Wisp": [
"its glow",
"leading folk astray",
"map readers"
],
"Sylph": [
"its breeze",
"riding drafts",
"kites"
],
"Faerie Dragon": [
"its prank",
"setting up pranks",
"wizards"
],
"Imp": [
"its pitchfork",
"causing minor chaos",
"clerks"
],
"Gossamer Elf": [
"its cobweb cloak",
"drifting silently",
"spiders"
],
"Dandelion Sprite": [
"its fluff",
"drifting wherever",
"lawnmowers"
],
"Firefly Fae": [
"its lantern",
"blinking in code",
"moths"
],
"Snowflake Pixie": [
"its sparkle",
"melting at the thought",
"sunbeams"
],
"Leaf Sprite": [
"its leaf",
"falling stylishly",
"autumn winds"
],
"Stardust Sprite": [
"its stardust",
"twinkling",
"astronomers"
],
"Tooth Fairy": [
"its pliers",
"collecting molars",
"dentists"
],
"Kitsune": [
"its nine tails",
"tricking travellers",
"lesser foxes"
],
"Giant Dragonfly": [
"its four wings",
"hovering on a whim",
"mosquitoes"
],
"Hornet Knight": [
"its sting",
"jousting at lunchtime",
"picnics"
],
"Glass Moth": [
"its transparency",
"being see-through",
"lamps"
],
"Mothman": [
"its red eyes",
"watching bridges",
"reporters"
],
"Luna Moth Spirit": [
"its moon glow",
"fluttering at moonlight",
"porch lights"
],
"Scarab Guardian": [
"its shell",
"rolling the sun",
"tomb raiders"
],
"Wasp Queen": [
"its throne",
"bossing the hive",
"picnickers"
],
"Mantis Lord": [
"its scythes",
"praying menacingly",
"dinner guests"
],
"Butterfly Oracle": [
"its prophecy",
"predicting hurricanes",
"hurricanes"
],
"Firefly Swarm Lord": [
"its swarm",
"blinking in unison",
"night strollers"
],
"Bee Matron": [
"its honey",
"fussing over the hive",
"bears"
],
"Locust King": [
"its swarm",
"eating fields",
"farmers"
],
"Cicada Seer": [
"its seventeen years",
"screaming after naps",
"summer evenings"
],
"Wind Elemental": [
"its gale",
"huffing and puffing",
"hats"
],
"Storm Spirit": [
"its fury",
"sulking in clouds",
"picnics"
],
"Air Djinn": [
"its three wishes",
"reading wish fine print",
"lamp owners"
],
"Banshee": [
"its wail",
"wailing at midnight",
"light sleepers"
],
"Wraith": [
"its chill",
"haunting corridors",
"candles"
],
"Poltergeist": [
"its crockery",
"throwing crockery",
"tableware"
],
"Zephyr": [
"its breeze",
"caressing sails",
"candles"
],
"Cloud Sprite": [
"its fluff",
"napping on cumulus",
"airliners"
],
"Lightning Sprite": [
"its spark",
"zapping at random",
"tall trees"
],
"Aurora Wisp": [
"its colours",
"draping the sky",
"tourists"
],
"Ifrit": [
"its smoke",
"scorching the neighbours",
"lamp rubbers"
],
"Ember Wisp": [
"its glow",
"smouldering gently",
"damp logs"
],
"Frost Wraith": [
"its icy breath",
"chilling spines",
"hot drinks"
],
"Spectral Eagle": [
"its see-through wings",
"patrolling the afterlife",
"ghostly mice"
],
"Thunder Elemental": [
"its rumble",
"drumming on clouds",
"dogs"
],
"Mist Phantom": [
"its vapour",
"lingering on moors",
"shortcuts"
],
"Winged Demon": [
"its pitchfork",
"upselling souls",
"lost souls"
],
"Balrog": [
"its whip",
"shouting at bridges",
"wizards"
],
"Fallen Angel": [
"its halo",
"brooding dramatically",
"angels"
],
"Seraph": [
"its six wings",
"glowing smugly",
"sinners"
],
"Cherub": [
"its tiny bow",
"matchmaking",
"wedding planners"
],
"Valkyrie": [
"its spear",
"choosing the slain",
"slackers"
],
"Archangel": [
"its trumpet",
"announcing things",
"apocalypses"
],
"Nightgaunt": [
"its tickling",
"hunting without a face",
"dreamers"
],
"Harpy": [
"its talons",
"screeching at sailors",
"sailors"
],
"Siren Gull": [
"its song",
"stealing chips",
"chip owners"
],
"Skeletal Wyvern": [
"its ribs",
"rattling bones",
"archaeologists"
],
"Revenant Raven": [
"its grudge",
"holding a grudge",
"the living"
],
"Lich Bat": [
"its phylactery",
"hanging around",
"adventurers"
],
"Hell Hawk": [
"its brimstone",
"burning rubber",
"small devils"
],
"Angelic Scout": [
"its clipboard",
"scouting heaven",
"clouds"
],
"Kinnara": [
"its melody",
"playing divine music",
"bad singers"
],
"Stone Gargoyle": [
"its gutter",
"glaring from rooftops",
"pigeons"
],
"Clockwork Owl": [
"its mainspring",
"ticking wisely",
"nightingales"
],
"Brass Dragonfly": [
"its brass wings",
"polishing itself",
"mosquitoes"
],
"Steam Wyvern": [
"its boiler",
"venting steam",
"kettles"
],
"Iron Griffin": [
"its rivets",
"clanking nobly",
"tin openers"
],
"Crystal Glider": [
"its prisms",
"scattering rainbows",
"chandeliers"
],
"Mechanical Hummingbird": [
"its tiny gears",
"hovering over flowers",
"real hummingbirds"
],
"Windup Bat": [
"its key",
"needing a wind-up",
"spiders"
],
"Gearwork Phoenix": [
"its cogs",
"rebuilding from spare parts",
"rust patches"
],
"Rune Drone": [
"its runes",
"compiling spells",
"bugs"
],
"Cloud Whale": [
"its blubber",
"sailing sleepy skies",
"airliners"
],
"Sky Manta": [
"its wings",
"gliding gracefully",
"sardines"
],
"Aether Jelly": [
"its tendrils",
"floating philosophically",
"poets"
],
"Storm Ray": [
"its static",
"crackling along",
"lightning rods"
],
"Void Jellyfish": [
"its void",
"drifting through nothing",
"stars"
],
"Star Whale": [
"its starlight",
"humming through constellations",
"comets"
],
"Wind Serpent": [
"its coils",
"slithering through gales",
"weather vanes"
],
"Quetzalcoatl": [
"its feathers",
"sulking as a god",
"conquistadors"
],
"Amaru": [
"its two heads",
"joining sky and earth",
"borders"
],
"Thunder Eel": [
"its voltage",
"zapping everything",
"metal objects"
],
"Zeppelin Whale": [
"its helium",
"floating pompously",
"pins"
],
"Paper Crane Spirit": [
"its folds",
"folding politely",
"rain clouds"
],
"Kite Dragon": [
"its string",
"tangling in trees",
"gusts"
],
"Lantern Jelly": [
"its glow",
"lighting the way",
"dark corners"
],
"Sky Squid": [
"its tentacles",
"multitasking",
"sky whales"
],
"Giant Bat": [
"its echolocation",
"squeaking at walls",
"moths"
],
"Owl King": [
"its crown",
"ruling by hoot",
"mice"
],
"Night Moth": [
"its dusk",
"fluttering at lamps",
"porch lights"
],
"Shadow Bat": [
"its shadow",
"hanging in the dark",
"spotlights"
],
"Midnight Owl": [
"its night shift",
"working nights",
"mice"
],
"Owl Sage": [
"its wisdom",
"pondering",
"fools"
],
"Flying Pig": [
"its bacon dreams",
"defying proverbs",
"sceptics"
],
"Winged Cow": [
"its milk",
"mooing above clouds",
"burger fans"
],
"Flying Brick": [
"its brickness",
"falling with intent",
"windows"
],
"Rubber Duck Squadron": [
"its squeak",
"flying in formation",
"bathtubs"
],
"Flying Toaster": [
"its crumbs",
"popping upward",
"bread rolls"
],
"Penguin Glider": [
"its tuxedo",
"belly-flopping through air",
"fish"
],
"Pet Rock With Wings": [
"its rockiness",
"sitting",
"physicists"
],
"Anvil Falcon": [
"its anvil",
"plummeting in cartoons",
"coyotes"
],
"Wild Turkey": [
"its gobble",
"flapping in a fluster",
"pilgrims"
],
"Dodo Airlines": [
"its in-flight service",
"reassuring passengers",
"fossils"
],
"Sleepy Sloth": [
"its naps",
"hanging about",
"deadlines"
],
"Flying Spaghetti Monster": [
"its noodly appendages",
"blessing meatballs",
"colanders"
],
"Hot-Air Balloon": [
"its basket",
"drifting with a view",
"power lines"
],
"Flying Carpet": [
"its tassels",
"vacuuming the sky",
"lamp rubbers"
],
"Witch's Broom": [
"its bristles",
"sweeping the clouds",
"dust bunnies"
],
"Shopping Cart Rocket": [
"its dodgy wheel",
"veering left",
"car park kerbs"
],
"Paper Plane": [
"its folds",
"gliding on hope",
"desk fans"
],
"Rubber Chicken": [
"its squawk",
"flapping floppily",
"punchlines"
],
"Bumblebee (Allegedly)": [
"its aerodynamics",
"defying engineers",
"physicists"
]
};
const crLvl = (L, v) => Math.max(0, Math.min(L.length - 1, Math.floor(Math.max(0, Math.min(99, v)) / 100 * L.length)));
const crQuip = (k, v) => { const L = CR_DRONE[k]; return L ? L[crLvl(L, v)] : ""; };
const crCreatureQuip = (c, k, v) => { const L = CR_TPL[k]; if (!L) return "";
  const i = crLvl(L, v), x = CR_LEX[c.name], t = x && CR_VAR[k] && CR_VAR[k][i];
  if (!t) return L[i];
  return t.replace(/\{thing\}/g, x[0]).replace(/\{act\}/g, x[1]).replace(/\{foe\}/g, x[2]).replace(/(^|[.!?] )([a-z])/g, (m, a, b) => a + b.toUpperCase()); };
const crDeltaWord = d => Math.abs(d) < 3 ? "about the same" : d > 0 ? `${d} ahead` : `${-d} behind`;
