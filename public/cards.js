// Cards: sets to collect in Questing, kept forever once found. Like
// trophies, they're worked out in the browser and api.php only remembers
// which were found, and when.
//
// It's meant to keep going for years, a little at a time, so most sets come
// round again: the kinds of set are
// - found by running (evaluate), a new edition every year: distances,
//   months, times of day, street names (a street counts once a run has
//   covered some of it: STREET_RUN), how far from home and which part of
//   the world (Globetrotter), climbs, and one set per area with
//   neighbourhoods: a card for each at HOOD_PCT of its streets that year,
//   turned gold when every street in it has been done that year. Last year's
//   cards stay, and show while this year's are still to find.
// - open-ended, found once and never complete: Passport, a stamp for each
//   country you run in, and Places, a card for each town. app.js looks up
//   where each run was (OSM.place).
//   A run finds at most one card in each set: of the ones it could, one at
//   random (the same one on every device). The rest wait for another run.
// - from quests (pack): each quest finished turns over one card you don't
//   have yet, from the quest set of the moment: the month's season while it
//   has cards left (each month has its own, back every year), then the first
//   evergreen set not yet complete. Which card is picked depends only on the
//   quest and what you have, so every device turns over the same one.
// - Legends: one per month, only for beating that month's boss (see
//   Quests.makeBoss). A legend missed comes round again the next year.
// - from expeditions: themed sets (Night Sky, Daybreak, Garden…), a card for
//   each expedition finished in that theme (see Quests.makeExpedition).
//
// Codes: f:SET:CARD@YEAR (found), h:OSM_ID:NEIGHBOURHOOD@YEAR and …@YEAR:gold,
// p:COUNTRY (two-letter code), t:COUNTRY:TOWN, q:SET:CARD (quests and
// legends). Finishing a set earns a trophy (setTrophies): for that year, for
// the yearly ones.
const Cards = (() => {
  const STREET_RUN = 200;  // metres of a street to cover for it to count, or most of it if shorter
  const HOOD_PCT = 25;

  // A street-name card: matches a whole word in a street's name. Its hint
  // says what to do in the primary sport (sport.js): "Run a street with…".
  const word = (name, icon, pattern = name, what = `a street with "${name}" in its name`) => ({
    id: name.toLowerCase().replace(/\W+/g, '-'), name, icon,
    get hint() { return `${Sport.current.verb} ${what}`; }, words: new RegExp(`\\b(${pattern})\\b`, 'i') });

  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  const MONTH_ICONS = ['❄️', '💘', '🍁', '🌱', '🌷', '☀️', '🏖️', '🌻', '🍎', '🎃', '🌨️', '🎄'];

  // Sets found by running. test(run, s) gives the detail to keep if this run
  // finds the card, or nothing; s.before is the runs before it (see evaluate).
  const FOUND = [
    // Its distances are the primary sport's (sport.js).
    { id: 'distance', name: 'Long Way Round', icon: '🛣️', color: '#e65100',
      get cards() {
        return Sport.current.cards.map(([m, name, icon, howFar = name]) => ({ id: String(m), name, icon, hint: `Go ${howFar} in one go`,
          test: (t, s) => (t.distance >= m ? s.detail(t) : null) }));
      } },
    { id: 'month', name: 'Twelve Months', icon: '📅', color: '#00897b',
      cards: MONTHS.map((name, i) => ({ id: String(i + 1), name, icon: MONTH_ICONS[i], hint: `Get out in ${name}`,
        test: (t, s) => (s.date(t).getMonth() === i ? s.detail(t) : null) })) },
    { id: 'clock', name: 'Around the Clock', icon: '🕰️', color: '#5e35b1',
      cards: [
        ['early', 'Early Bird', '🐦', 'Start before 6 am', h => h >= 3 && h < 6],
        ['morning', 'Morning Glory', '🌅', 'Start between 6 and 9 am', h => h >= 6 && h < 9],
        ['lunch', 'Lunch Break', '🥪', 'Start between 11 am and 2 pm', h => h >= 11 && h < 14],
        ['afternoon', 'Afternoon Tea', '🫖', 'Start between 2 and 5 pm', h => h >= 14 && h < 17],
        ['evening', 'Golden Hour', '🌇', 'Start between 5 and 9 pm', h => h >= 17 && h < 21],
        ['night', 'Night Owl', '🦉', 'Start after 9 pm', h => h >= 21 || h < 3],
      ].map(([id, name, icon, hint, hours]) => ({ id, name, icon, hint, test: (t, s) => (hours(s.date(t).getHours()) ? s.detail(t) : null) }))
        .concat([
          { id: 'double', name: 'Double Day', icon: '✌️', hint: 'Get out twice in one day', test: (t, s) => s.double(t) },
          { id: 'week', name: 'Seven Straight', icon: '🔥', hint: 'Get out seven days in a row', test: (t, s) => s.daysInARow(t, 7) },
        ]) },
    { id: 'trees', name: 'Arboretum', icon: '🌳', color: '#2e7d32',
      cards: [['Oak', '🌳'], ['Maple', '🍁'], ['Elm', '🌲'], ['Birch', '🪵'], ['Cedar', '🌲'], ['Pine', '🌲', 'Pine|Pines'],
        ['Willow', '🌿', 'Willow|Willows'], ['Ash', '🍃'], ['Spruce', '🎄'], ['Cherry', '🍒'], ['Poplar', '🌳'],
        ['Chestnut', '🌰']].map(([name, icon, pattern]) => word(name, icon, pattern)) },
    { id: 'birds', name: 'Aviary', icon: '🪶', color: '#0277bd',
      cards: [['Robin', '🐦'], ['Heron', '🦩'], ['Lark', '🐦'], ['Wren', '🐦'], ['Eagle', '🦅'], ['Hawk', '🦅'],
        ['Falcon', '🦅'], ['Swan', '🦢'], ['Sparrow', '🐦'], ['Finch', '🐤'], ['Owl', '🦉'], ['Raven', '🐦']]
        .map(([name, icon]) => word(name, icon)) },
    { id: 'numbers', name: 'Count Up', icon: '🔢', color: '#c62828',
      cards: ['First', 'Second', 'Third', 'Fourth', 'Fifth', 'Sixth', 'Seventh', 'Eighth', 'Ninth', 'Tenth'].map((name, i) => {
        const nth = `${i + 1}${['st', 'nd', 'rd'][i] || 'th'}`;  // 1st, 2nd, 3rd, 4th…
        return Object.assign(word(name, ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][i], `${name}|${nth}`,
          `a ${name} or ${nth} street`), { id: String(i + 1) });
      }) },
    { id: 'types', name: 'Street Types', icon: '🪧', color: '#6d4c41',
      cards: [['Avenue', '🏙️'], ['Road', '🛣️'], ['Drive', '🚗'], ['Lane', '🌾'], ['Way', '🧭'], ['Crescent', '🌙'],
        ['Close', '🏡'], ['Court', '⛲'], ['Boulevard', '🌴'], ['Place', '📍'], ['Terrace', '🏘️'], ['Trail', '🥾']]
        .map(([name, icon]) => word(name, icon, name, `a ${name}`)) },
    { id: 'land', name: 'Lay of the Land', icon: '🗺️', color: '#558b2f',
      cards: [['Hill', '⛰️', 'Hill|Hills'], ['Park', '🌳'], ['Lake', '🏞️'], ['River', '🌊'], ['Valley', '🏞️'],
        ['Ridge', '🏔️'], ['Creek', '💧'], ['View', '🔭', 'View|Vista'], ['Meadow', '🌼', 'Meadow|Meadows'], ['Bay', '⛵']]
        .map(([name, icon, pattern]) => word(name, icon, pattern)) },
    { id: 'globe', name: 'Globetrotter', icon: '🌐', color: '#1e88e5',
      cards: [
        ...[[25, 'Next Town Over', '🚌'], [100, 'Road Trip', '🚗'], [500, 'Long Haul', '🚆'], [2000, 'Far Afield', '✈️'],
          [5000, 'Overseas', '🌍'], [10000, 'Other Side of the World', '🌏']]
          .map(([km, name, icon]) => ({ id: `${km}km`, name, icon, hint: `Get out ${km.toLocaleString()} km or more from home`,
            test: (t, s) => (s.fromHome(t) >= km * 1000 ? `${Math.round(s.fromHome(t) / 1000).toLocaleString()} km from home · ${s.detail(t)}` : null) })),
        ...[['north', 'Northern Half', '⬆️', ([la]) => la >= 0], ['south', 'Southern Half', '⬇️', ([la]) => la < 0],
          ['east', 'Eastern Half', '➡️', ([, lo]) => lo >= 0], ['west', 'Western Half', '⬅️', ([, lo]) => lo < 0],
          ['tropics', 'The Tropics', '🌴', ([la]) => Math.abs(la) < 23.44], ['polar', 'Midnight Sun', '🧊', ([la]) => Math.abs(la) > 66.56]]
          .map(([id, name, icon, where]) => ({ id, name, icon,
            hint: { north: 'Get out north of the equator', south: 'Get out south of the equator', east: 'Get out east of Greenwich',
              west: 'Get out west of Greenwich', tropics: 'Get out in the tropics', polar: 'Get out north of the Arctic Circle (or south of the Antarctic)' }[id],
            test: (t, s) => (s.start(t) && where(s.start(t)) ? s.detail(t) : null) })),
      ] },
    { id: 'climb', name: 'Up and Over', icon: '⛰️', color: '#6d4c41',
      cards: [[50, 'Bump in the Road', '🪜'], [100, 'Hill Climb', '⛰️'], [200, 'Big Climb', '🧗'], [300, 'Mountain Goat', '🐐'],
        [500, 'Summit', '🏔️']].map(([m, name, icon]) => ({ id: String(m), name, icon, hint: `Climb ${m} m in one go`,
        test: (t, s) => ((t.metrics && t.metrics.climb) >= m ? `${Math.round(t.metrics.climb)} m up · ${s.detail(t)}` : null) })) },
  ];

  // Sets from expeditions (see Quests.makeExpedition): one card for each
  // expedition finished, from its theme.
  const EXPEDITION = [
    { id: 'sky', name: 'Night Sky', icon: '🌌', color: '#283593',
      cards: [['moon', 'Full Moon', '🌕'], ['crescent', 'Crescent Moon', '🌙'], ['star', 'Pole Star', '⭐'],
        ['shooting', 'Shooting Star', '🌠'], ['comet', 'Comet', '☄️'], ['milky', 'Milky Way', '🌌'], ['planet', 'Ringed Planet', '🪐'],
        ['eclipse', 'Eclipse', '🌑'], ['aurora', 'Aurora', '🎆'], ['dipper', 'Big Dipper', '✨']] },
    { id: 'daybreak', name: 'Daybreak', icon: '🌅', color: '#d81b60',
      cards: [['sunrise', 'Sunrise', '🌅'], ['chorus', 'Dawn Chorus', '🐦'], ['mist', 'Morning Mist', '🌫️'], ['dew', 'Dew', '💧'],
        ['rooster', 'Rooster', '🐓'], ['coffee', 'First Coffee', '☕'], ['light', 'First Light', '🌤️'], ['bread', 'Fresh Bread', '🍞']] },
    { id: 'wild', name: 'Wild Trails', icon: '🍄', color: '#33691e',
      cards: [['mushroom', 'Mushroom', '🍄'], ['fern', 'Fern', '🌿'], ['log', 'Fallen Log', '🪵'], ['prints', 'Paw Prints', '🐾'],
        ['berries', 'Wild Berries', '🫐'], ['boulder', 'Boulder', '🪨'], ['web', 'Spider Web', '🕸️'], ['pine', 'Old Pine', '🌲'],
        ['owl', 'Great Horned Owl', '🦉'], ['spring', 'Hidden Spring', '⛲']] },
    { id: 'mapmaker', name: 'Cartographer', icon: '🧭', color: '#5d4037',
      cards: [['compass', 'Compass', '🧭'], ['map', 'Old Map', '🗺️'], ['telescope', 'Telescope', '🔭'], ['scroll', 'Scroll', '📜'],
        ['anchor', 'Anchor', '⚓'], ['island', 'Island', '🏝️'], ['monolith', 'Monolith', '🗿'], ['castle', 'Castle', '🏰'],
        ['volcano', 'Volcano', '🌋'], ['lighthouse', 'Tower', '🗼']] },
    { id: 'voyage', name: 'Voyage', icon: '⛵', color: '#01579b',
      cards: [['sailboat', 'Sailboat', '⛵'], ['whale', 'Whale', '🐋'], ['wave', 'Big Wave', '🌊'], ['coral', 'Coral', '🪸'],
        ['octopus', 'Octopus', '🐙'], ['parrot', 'Parrot', '🦜'], ['treasure', 'Treasure', '💰'], ['mermaid', 'Mermaid', '🧜']] },
    { id: 'peaks', name: 'Peaks', icon: '🏔️', color: '#455a64',
      cards: [['peak', 'Snowy Peak', '🏔️'], ['goat', 'Mountain Goat', '🐐'], ['climber', 'Climber', '🧗'], ['gondola', 'Gondola', '🚠'],
        ['eagle', 'Golden Eagle', '🦅'], ['camp', 'Base Camp', '⛺'], ['rope', 'Rope', '🪢'], ['flag', 'Summit Flag', '🚩']] },
    { id: 'garden', name: 'Garden', icon: '🌻', color: '#7cb342',
      cards: [['seedling', 'Seedling', '🌱'], ['sunflower', 'Sunflower', '🌻'], ['carrot', 'Carrot', '🥕'], ['tomato', 'Tomato', '🍅'],
        ['bee', 'Busy Bee', '🐝'], ['pot', 'Potted Plant', '🪴'], ['tulip', 'Tulip', '🌷'], ['pea', 'Peas', '🫛'],
        ['strawberry', 'Strawberry', '🍓'], ['snail', 'Garden Snail', '🐌']] },
  ].map(set => ({ ...set, expedition: true, cards: set.cards.map(([id, name, icon]) => ({ id, name, icon, hint: `Finish a ${set.name} expedition` })) }));

  // Expedition themes with cards still to turn over.
  const expeditionThemes = owned => EXPEDITION.filter(set => set.cards.some(c => !owned.has(`q:${set.id}:${c.id}`)))
    .map(({ id, name, icon }) => ({ id, name, icon }));
  const expeditionTheme = id => EXPEDITION.find(set => set.id === id);
  // The card a finished expedition turns over: { code, detail }, or null if its theme is complete.
  function expeditionCard(exp, owned, title) {
    const set = expeditionTheme(exp.theme);
    const missing = set ? set.cards.filter(c => !owned.has(`q:${set.id}:${c.id}`)) : [];
    if (!missing.length) return null;
    const card = missing[hash(exp.id) % missing.length];
    return { code: `q:${set.id}:${card.id}`, detail: `For "${title}"` };
  }

  // The flag of a two-letter country code: its regional indicator letters.
  const flag = cc => (/^[a-z]{2}$/.test(cc) ? String.fromCodePoint(...[...cc.toUpperCase()].map(c => 0x1f1a5 + c.charCodeAt(0))) : '🏳️');

  // Sets from quests: art only, nothing to run but the quests themselves.
  const QUEST = [
    { id: 'creatures', name: 'Trail Creatures', icon: '🦊', color: '#ef6c00',
      cards: [['fox', 'Fox', '🦊'], ['deer', 'Deer', '🦌'], ['rabbit', 'Rabbit', '🐇'], ['squirrel', 'Squirrel', '🐿️'],
        ['hedgehog', 'Hedgehog', '🦔'], ['bear', 'Bear', '🐻'], ['raccoon', 'Raccoon', '🦝'], ['beaver', 'Beaver', '🦫'],
        ['frog', 'Frog', '🐸'], ['wolf', 'Wolf', '🐺']] },
    { id: 'weather', name: 'Any Weather', icon: '🌦️', color: '#00838f',
      cards: [['sun', 'Sunshine', '☀️'], ['cloud', 'Overcast', '☁️'], ['rain', 'Downpour', '🌧️'], ['storm', 'Thunderstorm', '⛈️'],
        ['wind', 'Headwind', '🌬️'], ['fog', 'Fog', '🌫️'], ['rainbow', 'Rainbow', '🌈'], ['heat', 'Heatwave', '🥵']] },
    // Seasons: one a month (month: 0 for January), back every year.
    { id: 'newyear', name: 'New Year', icon: '🎆', color: '#6a1b9a', month: 0,
      cards: [['fireworks', 'Fireworks', '🎆'], ['sparkler', 'Sparkler', '🎇'], ['confetti', 'Confetti', '🎊'], ['clock', 'Midnight', '🕛'],
        ['resolution', 'Resolution', '📝'], ['toast', 'A Toast', '🥂'], ['calendar', 'Fresh Calendar', '📅'], ['party', 'Party Hat', '🥳']] },
    { id: 'hearts', name: 'Hearts', icon: '💝', color: '#ad1457', month: 1,
      cards: [['heart', 'Heart', '❤️'], ['ribbon', 'Ribbon Heart', '💝'], ['rose', 'Rose', '🌹'], ['letter', 'Love Letter', '💌'],
        ['chocolate', 'Chocolates', '🍫'], ['arrow', "Cupid's Arrow", '💘'], ['ring', 'Ring', '💍'], ['bear', 'Teddy Bear', '🧸']] },
    // The seasons are a Canadian prairie year: March is still winter (and
    // maple syrup time), the thaw comes in April, and November is snow.
    { id: 'sugarshack', name: 'Sugar Shack', icon: '🍁', color: '#a1521f', month: 2,
      cards: [['syrup', 'Maple Syrup', '🍁'], ['pancakes', 'Pancakes', '🥞'], ['taffy', 'Taffy on Snow', '🍭'], ['sap', 'Sap Bucket', '🪣'],
        ['cabin', 'Sugar Shack', '🛖'], ['fiddle', 'Fiddler', '🎻'], ['snowshoes', 'Snowshoes', '🥾'], ['icicle', 'Icicles', '🧊']] },
    { id: 'thaw', name: 'Spring Thaw', icon: '🌱', color: '#558b2f', month: 3,
      cards: [['melt', 'Snowmelt', '💧'], ['puddle', 'Puddle Jumper', '🥾'], ['crocus', 'Prairie Crocus', '🌷'], ['geese', 'Geese Return', '🦆'],
        ['robin', 'First Robin', '🐦'], ['sprout', 'Sprout', '🌱'], ['worm', 'Worm', '🪱'], ['mud', 'Mud Season', '🟫']] },
    { id: 'bloom', name: 'In Bloom', icon: '🌸', color: '#d81b60', month: 4,
      cards: [['blossom', 'Cherry Blossom', '🌸'], ['bee', 'Bee', '🐝'], ['butterfly', 'Butterfly', '🦋'], ['sunflower', 'Daisy', '🌼'],
        ['hibiscus', 'Hibiscus', '🌺'], ['bouquet', 'Bouquet', '💐'], ['honey', 'Honey', '🍯'], ['caterpillar', 'Caterpillar', '🐛']] },
    { id: 'midsummer', name: 'Midsummer', icon: '🌞', color: '#f9a825', month: 5,
      cards: [['sun', 'Midsummer Sun', '🌞'], ['strawberry', 'Strawberries', '🍓'], ['lemonade', 'Lemonade', '🍋'], ['firefly', 'Firefly', '✨'],
        ['picnic', 'Picnic', '🧺'], ['kite', 'Kite', '🪁'], ['longday', 'Long Day', '🌅'], ['sunglasses', 'Sunglasses', '😎']] },
    { id: 'beach', name: 'Beach Days', icon: '🏖️', color: '#00838f', month: 6,
      cards: [['wave', 'Wave', '🌊'], ['shell', 'Shell', '🐚'], ['crab', 'Crab', '🦀'], ['icecream', 'Ice Cream', '🍦'],
        ['umbrella', 'Beach Umbrella', '⛱️'], ['surf', 'Surfboard', '🏄'], ['palm', 'Palm Tree', '🌴'], ['dolphin', 'Dolphin', '🐬']] },
    { id: 'campfire', name: 'Campfire', icon: '🏕️', color: '#bf360c', month: 7,
      cards: [['tent', 'Tent', '⛺'], ['fire', 'Campfire', '🔥'], ['lantern', 'Lantern', '🏮'], ['compass', 'Compass', '🧭'],
        ['canoe', 'Canoe', '🛶'], ['stars', 'Starry Night', '🌃'], ['backpack', 'Backpack', '🎒'], ['map', 'Trail Map', '🗺️']] },
    { id: 'harvest', name: 'Harvest', icon: '🌾', color: '#9e7700', month: 8,
      cards: [['wheat', 'Wheat', '🌾'], ['apple', 'Apple', '🍎'], ['corn', 'Corn', '🌽'], ['pear', 'Pear', '🍐'],
        ['grapes', 'Grapes', '🍇'], ['carrot', 'Carrot', '🥕'], ['scarecrow', 'Scarecrow', '👒'], ['pie', 'Pie', '🥧']] },
    { id: 'halloween', name: 'Halloween', icon: '🎃', color: '#e65100', month: 9,
      cards: [['pumpkin', 'Jack-o-lantern', '🎃'], ['ghost', 'Ghost', '👻'], ['bat', 'Bat', '🦇'], ['spider', 'Spider', '🕷️'],
        ['skull', 'Skull', '💀'], ['witch', 'Witch', '🧙'], ['candy', 'Candy', '🍬'], ['zombie', 'Zombie', '🧟']] },
    { id: 'freezeup', name: 'Freeze-Up', icon: '🌨️', color: '#546e7a', month: 10,
      cards: [['snowfall', 'First Snowfall', '🌨️'], ['frost', 'Frosty Window', '🪟'], ['toque', 'Toque', '🧶'], ['chickadee', 'Chickadee', '🐦'],
        ['hockey', 'Hockey Night', '🏒'], ['greycup', 'Grey Cup', '🏈'], ['soup', 'Hot Soup', '🍲'], ['longnight', 'Long Night', '🌃']] },
    { id: 'winter', name: 'Winter', icon: '☃️', color: '#1565c0', month: 11,
      cards: [['snowman', 'Snowman', '☃️'], ['snowflake', 'Snowflake', '❄️'], ['mitten', 'Mittens', '🧤'], ['scarf', 'Scarf', '🧣'],
        ['cocoa', 'Hot Cocoa', '☕'], ['sled', 'Sled', '🛷'], ['penguin', 'Penguin', '🐧'], ['skate', 'Ice Skate', '⛸️']] },
  ].map(set => ({ ...set, cards: set.cards.map(([id, name, icon]) => ({ id, name, icon, hint: set.month === undefined
    ? 'Finish a weekly quest to turn one over'
    : `Finish a weekly quest in ${MONTHS[set.month]} to turn one over` })) }));

  // Legends: the boss of each month (0: January), beaten for its card.
  const LEGENDS = [
    ['yeti', 'The Yeti', '🏔️'], ['sphinx', 'The Sphinx', '🦁'], ['greenman', 'The Green Man', '🍀'],
    ['thunderbird', 'Thunderbird', '⚡'], ['unicorn', 'The Unicorn', '🦄'], ['phoenix', 'The Phoenix', '🔥'],
    ['kraken', 'The Kraken', '🦑'], ['serpent', 'The Sea Serpent', '🐍'], ['griffin', 'The Griffin', '🦅'],
    ['horseman', 'The Headless Horseman', '🐎'], ['minotaur', 'The Minotaur', '🐂'], ['dragon', 'The Ice Dragon', '🐉'],
  ].map(([id, name, icon], month) => ({ id, name, icon, month }));
  const LEGEND_SET = { id: 'legends', name: 'Legends', icon: '🐉', color: '#7b1fa2', boss: true,
    cards: LEGENDS.map(l => ({ id: l.id, name: l.name, icon: l.icon, hint: `Beat ${MONTHS[l.month]}'s boss` })) };
  const legend = month => LEGENDS[month];
  // The legend card for beating a boss: { code, detail }.
  const legendCard = (boss, title) => ({ code: `q:legends:${boss.legend}`, detail: `Beat "${title}"` });

  const fmtDate = d => d.toLocaleDateString(undefined, { dateStyle: 'medium' });
  const dayKey = d => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

  // A run's first point, [lat, lon], or null.
  const startOf = t => { const seg = (t.segments || []).find(g => g.length); return seg ? seg[0] : null; };
  const metres = ([a, b], [c, d]) => {
    const r = Math.PI / 180, x = Math.sin((c - a) * r / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin((d - b) * r / 2) ** 2;
    return 2 * 6371000 * Math.asin(Math.sqrt(x));
  };

  // What a run's tests look at: the runs before it, and its own date, name,
  // start and distance from home. home: [lat, lon], or null. Dates are
  // shifted an hour for every 15° of longitude away from home, so a run on
  // a trip has (near enough) its own local time, not the browser's.
  function runStats(before, home) {
    const date = t => {
      const at = startOf(t);
      const hours = home && at ? Math.round((at[1] - home[1]) / 15) : 0;
      return new Date(Date.parse(t.time) + hours * 3600000);
    };
    const detail = t => `${t.name}, ${fmtDate(date(t))}`;
    return {
      before, date, detail,
      start: startOf,
      fromHome: t => (home && startOf(t) ? metres(home, startOf(t)) : 0),
      // Its second (or later) run of a day.
      double: t => {
        const other = before.find(o => dayKey(date(o)) === dayKey(date(t)));
        return other ? `${other.name} and ${t.name}, ${fmtDate(date(t))}` : null;
      },
      // Its day ends n days in a row out.
      daysInARow: (t, n) => {
        const days = new Set([...before, t].map(o => dayKey(date(o))));
        const d = date(t);
        for (let k = 1; k < n; k++) if (!days.has(dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() - k)))) return null;
        return `${fmtDate(new Date(d.getFullYear(), d.getMonth(), d.getDate() - n + 1))} to ${fmtDate(d)}`;
      },
    };
  }

  // Adds up road, path and trail.
  function combine(t) {
    const all = { len: 0, covered: 0, streets: 0, done: 0 };
    for (const c of Object.values(t)) for (const k in all) all[k] += c[k];
    return all;
  }

  // A run's streets: the names it covered some of itself (STREET_RUN, or most
  // of a short street), and the neighbourhood cards it could find: a card
  // where it covered something and the runs so far have HOOD_PCT, gold where
  // the runs so far have done every street. cover: per area id, the points
  // the runs before have visited; this run's are added to it.
  function runStreets(t, areas, cover, year) {
    const named = [];
    const hoods = new Map();  // set id (h + OSM id) -> [{ code, detail }]
    for (const area of areas) {
      const prep = Coverage.prepared(area);
      const key = `${year}:${area.id}`;  // each year's coverage starts again
      if (!cover.has(key)) cover.set(key, new Uint8Array(prep.n));
      const visited = cover.get(key);
      const own = Coverage.compute(prep, [t.segments]);
      if (!own.visited.some(Boolean)) continue;  // not here
      const mine = Coverage.summarize(prep, own);
      for (const g of mine.groups) {
        if (g.name && g.covered >= Math.min(STREET_RUN, g.len * 0.8) && !named.includes(g.name)) named.push(g.name);
      }
      for (let k = 0; k < prep.n; k++) if (own.visited[k]) visited[k] = 1;
      const fraction = new Float32Array(area.data.streets.length);
      for (let w = 0; w < fraction.length; w++) {
        let count = 0;
        for (let k = prep.first[w]; k < prep.first[w + 1]; k++) count += visited[k];
        fraction[w] = count / Math.max(1, prep.first[w + 1] - prep.first[w]);
      }
      const sofar = Coverage.summarize(prep, { visited, fraction });
      area.data.hoods.forEach((hood, i) => {
        if (!combine(mine.byHood[i]).covered) return;
        const all = combine(sofar.byHood[i]);
        if (!all.len || all.covered / all.len * 100 < HOOD_PCT) return;
        const code = `h:${area.osmId}:${hood.name}@${year}`;
        const list = hoods.get(`h${area.osmId}`) || [];
        list.push({ code, detail: `${Math.round(all.covered / all.len * 100)}% of its streets in ${year}` });
        if (all.streets > 0 && all.done === all.streets) list.push({ code: `${code}:gold`, detail: `Every street done in ${year}` });
        hoods.set(`h${area.osmId}`, list);
      });
    }
    return { named: named.sort((a, b) => a.localeCompare(b)), hoods };
  }

  // The found cards activities have found: [{ code, detail }]. tracks:
  // activities in the primary sport that count (see app.js). They're gone through oldest first,
  // each finding at most one card per set, picked by hashing the run's id
  // with the set's, so it's the same pick every time and on every device.
  // home: [lat, lon] for Globetrotter and local times; places: Map(track id ->
  // { cc, country, town } from OSM.place) for Passport and Places.
  function evaluate(tracks, areas, { home = null, places = new Map() } = {}) {
    const runs = tracks.filter(t => t.time && !Number.isNaN(Date.parse(t.time)))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time) || String(a.id).localeCompare(String(b.id)));
    const found = new Set();
    const out = [];
    const cover = new Map();
    const pick = (t, setId, options) => {
      const fresh = options.filter(o => !found.has(o.code));
      if (!fresh.length) return;
      const card = fresh[hash(`${t.id}:${setId}`) % fresh.length];
      found.add(card.code);
      out.push(card);
    };
    runs.forEach((t, i) => {
      const s = runStats(runs.slice(0, i), home);
      const year = s.date(t).getFullYear();
      const { named, hoods } = runStreets(t, areas, cover, year);
      for (const set of FOUND) {
        const options = [];
        for (const card of set.cards) {
          const detail = card.words ? named.find(n => card.words.test(n)) : card.test(t, s);
          if (detail) options.push({ code: `f:${set.id}:${card.id}@${year}`, detail });
        }
        pick(t, set.id, options);
      }
      // A neighbourhood's gold only once it has its card.
      for (const [setId, options] of hoods) {
        pick(t, setId, options.filter(o => !o.code.endsWith(':gold') || found.has(o.code.slice(0, -5))));
      }
      const where = places.get(t.id);
      if (where) {
        pick(t, 'passport', [{ code: `p:${where.cc}`, detail: `${where.country} · ${s.detail(t)}` }]);
        if (where.town) pick(t, 'places', [{ code: `t:${where.cc}:${where.town.toLowerCase()}`, detail: `${where.town}, ${where.country} · ${s.detail(t)}` }]);
      }
    });
    return out;
  }

  // Passport and Places from any activities, for the one-time look back at
  // past travels: each country and town once, from the first run there.
  // places: as evaluate takes. [{ code, detail }].
  function travels(tracks, places) {
    const out = new Map();
    const runs = tracks.filter(t => t.time && places.get(t.id)).sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    for (const t of runs) {
      const where = places.get(t.id);
      const run = `${t.name}, ${fmtDate(new Date(t.time))}`;
      const add = (code, detail) => { if (!out.has(code)) out.set(code, { code, detail }); };
      add(`p:${where.cc}`, `${where.country} · ${run}`);
      if (where.town) add(`t:${where.cc}:${where.town.toLowerCase()}`, `${where.town}, ${where.country} · ${run}`);
    }
    return [...out.values()];
  }

  // The quest set turning over now: a seasonal one in its month while it has
  // cards left, else the first evergreen one with cards left (null if none).
  function questSet(owned, now = new Date()) {
    const left = set => set.cards.some(c => !owned.has(`q:${set.id}:${c.id}`));
    return QUEST.find(s => s.month === now.getMonth() && left(s)) || QUEST.find(s => s.month === undefined && left(s)) || null;
  }

  // A small, steady hash: the same quest picks the same card everywhere.
  const hash = text => [...text].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) | 0, 7) >>> 0;

  // The card a finished quest turns over: { code, detail }, or null when
  // every quest set you can get now is complete. owned: Set of codes.
  function pack(quest, owned, title, now = new Date()) {
    const set = questSet(owned, now);
    if (!set) return null;
    const missing = set.cards.filter(c => !owned.has(`q:${set.id}:${c.id}`));
    const card = missing[hash(quest.id) % missing.length];
    return { code: `q:${set.id}:${card.id}`, detail: `For "${title}"` };
  }

  // Every set as it stands, to show: [{ id, name, icon, color, kind, yearly,
  // cards: [{ code, name, icon, hint, owned, gold, detail, years }] }]. kind:
  // quest, found, hood or open. For a yearly set, owned and gold are this
  // year's and code is this year's; years lists every year it was found.
  // owned: Map(code -> { detail, earnedAt }). Neighbourhood sets come from areas.
  function sets(owned, areas, year = new Date().getFullYear()) {
    const has = code => owned.get(code);
    // Every year a yearly card was found: base code (no @year) -> [years].
    const editions = new Map();
    for (const code of owned.keys()) {
      const m = /^(.*)@(\d{4})$/.exec(code);
      if (!m) continue;
      if (!editions.has(m[1])) editions.set(m[1], []);
      editions.get(m[1]).push(Number(m[2]));
    }
    const lifetime = (set, c) => {
      const code = `q:${set.id}:${c.id}`;
      return { code, name: c.name, icon: c.icon, hint: c.hint, owned: Boolean(has(code)), detail: (has(code) || {}).detail || '' };
    };
    const yearly = (base, c, extra = {}) => {
      const years = (editions.get(base) || []).sort();
      const now = has(`${base}@${year}`);
      const latest = now || has(`${base}@${years[years.length - 1]}`);
      return { code: `${base}@${year}`, name: c.name, icon: c.icon, hint: c.hint, owned: Boolean(now), years,
        detail: (latest || {}).detail || '', ...extra };
    };
    const out = [
      ...[...QUEST, ...EXPEDITION, LEGEND_SET].map(set => ({ id: set.id, name: set.name, icon: set.icon, color: set.color, kind: 'quest',
        month: set.month, boss: Boolean(set.boss), expedition: Boolean(set.expedition), cards: set.cards.map(c => lifetime(set, c)) })),
      ...FOUND.map(set => ({ id: set.id, name: set.name, icon: set.icon, color: set.color, kind: 'found', yearly: true,
        cards: set.cards.map(c => yearly(`f:${set.id}:${c.id}`, c)) })),
    ];
    // The open-ended ones: what's been found, oldest first, and one face down for the next.
    const opened = (prefix, icon) => [...owned.entries()].filter(([code]) => code.startsWith(prefix))
      .sort(([, a], [, b]) => String(a.earnedAt || '').localeCompare(String(b.earnedAt || '')))
      .map(([code, c]) => ({ code, name: (c.detail || '').split(' · ')[0], icon: icon(code), hint: '', owned: true, detail: c.detail || '' }));
    out.push({ id: 'passport', name: 'Passport', icon: '🛂', color: '#00695c', kind: 'open',
      cards: [...opened('p:', code => flag(code.slice(2))), { code: '', name: '', icon: '?', hint: 'Get out in a new country', owned: false }] });
    out.push({ id: 'places', name: 'Places', icon: '📍', color: '#ad1457', kind: 'open',
      cards: [...opened('t:', () => '📍'), { code: '', name: '', icon: '?', hint: 'Get out in a new town or city', owned: false }] });
    const seen = new Set();
    for (const area of areas) {
      if (area.data.hoods.length < 2 || seen.has(area.osmId)) continue;
      seen.add(area.osmId);
      out.push({ id: `h${area.osmId}`, name: area.name, icon: '🏘️', color: '#455a64', kind: 'hood', yearly: true,
        cards: area.data.hoods.map(hood => {
          const base = `h:${area.osmId}:${hood.name}`;
          return yearly(base, { name: hood.name, icon: '🏘️', hint: `Cover ${HOOD_PCT}% of its streets this year; every street turns it gold` },
            { gold: Boolean(has(`${base}@${year}:gold`)) });
        }) });
    }
    return out;
  }

  // Trophies for sets just completed: [{ code, title, detail }], a yearly
  // set's for this year. A neighbourhood set is complete once every card is
  // gold; the open-ended ones never are.
  function setTrophies(list, year = new Date().getFullYear()) {
    return list.filter(set => set.kind !== 'open' && set.cards.length && set.cards.every(c => (set.kind === 'hood' ? c.gold : c.owned)))
      .map(set => ({ code: set.yearly ? `cards:${set.id}@${year}` : `cards:${set.id}`,
        title: `${set.icon} ${set.name} ${set.yearly ? year : 'set'}`,
        detail: set.kind === 'hood' ? `Every neighbourhood card turned gold in ${year}`
          : set.yearly ? `All ${set.cards.length} cards found in ${year}` : `All ${set.cards.length} cards collected` }));
  }

  return { evaluate, travels, expeditionThemes, expeditionTheme, expeditionCard, pack, questSet, sets, setTrophies, legend, legendCard, flag, STREET_RUN, HOOD_PCT };
})();
