// Cards: sets to collect in Questing, kept forever once found. Like
// trophies, they're worked out in the browser and api.php only remembers
// which were found, and when.
//
// Two kinds of set:
// - found by running (evaluate): distances, months, times of day, street
//   names (a street counts once you've covered some of it: STREET_RUN), and
//   one set per area with neighbourhoods: a card for each at HOOD_PCT
//   coverage, turned gold when every street in it is done
// - from quests (pack): each quest finished turns over one card you don't
//   have yet, from the quest set of the moment: the month's season while it
//   has cards left (each month has its own, back every year), then the first
//   evergreen set not yet complete. Which card is picked depends only on the
//   quest and what you have, so every device turns over the same one.
// - Legends: one per month, only for beating that month's boss (see
//   Quests.makeBoss). A legend missed comes round again the next year.
//
// Codes: f:SET:CARD (found), q:SET:CARD (quests), h:OSM_ID:NEIGHBOURHOOD and
// h:…:gold. Finishing a set earns a trophy (setTrophies).
const Cards = (() => {
  const STREET_RUN = 200;  // metres of a street to cover for it to count, or most of it if shorter
  const HOOD_PCT = 25;

  // A street-name card: matches a whole word in a street's name.
  const word = (name, icon, pattern = name) => ({ id: name.toLowerCase().replace(/\W+/g, '-'), name, icon,
    hint: `Run a street with "${name}" in its name`, words: new RegExp(`\\b(${pattern})\\b`, 'i') });

  const DISTANCES = [[5000, '5K', '👟'], [10000, '10K', '🏃'], [15000, '15K', '🌤️'], [21097, 'Half marathon', '🥈'],
    [30000, '30K', '⛰️'], [42195, 'Marathon', '🥇'], [50000, 'Ultra', '🦄']];
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October',
    'November', 'December'];
  const MONTH_ICONS = ['❄️', '💘', '🍁', '🌱', '🌷', '☀️', '🏖️', '🌻', '🍎', '🎃', '🌨️', '🎄'];

  // Sets found by running. test(stats) gives the detail to keep, or nothing.
  const FOUND = [
    { id: 'distance', name: 'Long Way Round', icon: '🛣️', color: '#e65100',
      cards: DISTANCES.map(([m, name, icon]) => ({ id: String(m), name, icon, hint: `Go ${name === 'Ultra' ? '50 km' : name} in one go`,
        test: s => s.first(t => t.distance >= m) })) },
    { id: 'month', name: 'Twelve Months', icon: '📅', color: '#00897b',
      cards: MONTHS.map((name, i) => ({ id: String(i + 1), name, icon: MONTH_ICONS[i], hint: `Get out in ${name}`,
        test: s => s.first(t => s.date(t).getMonth() === i) })) },
    { id: 'clock', name: 'Around the Clock', icon: '🕰️', color: '#5e35b1',
      cards: [
        ['early', 'Early Bird', '🐦', 'Start before 6 am', h => h >= 3 && h < 6],
        ['morning', 'Morning Glory', '🌅', 'Start between 6 and 9 am', h => h >= 6 && h < 9],
        ['lunch', 'Lunch Break', '🥪', 'Start between 11 am and 2 pm', h => h >= 11 && h < 14],
        ['afternoon', 'Afternoon Tea', '🫖', 'Start between 2 and 5 pm', h => h >= 14 && h < 17],
        ['evening', 'Golden Hour', '🌇', 'Start between 5 and 9 pm', h => h >= 17 && h < 21],
        ['night', 'Night Owl', '🦉', 'Start after 9 pm', h => h >= 21 || h < 3],
      ].map(([id, name, icon, hint, hours]) => ({ id, name, icon, hint, test: s => s.first(t => hours(s.date(t).getHours())) }))
        .concat([
          { id: 'double', name: 'Double Day', icon: '✌️', hint: 'Get out twice in one day', test: s => s.double() },
          { id: 'week', name: 'Seven Straight', icon: '🔥', hint: 'Get out seven days in a row', test: s => s.daysInARow(7) },
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
        return { ...word(name, ['1️⃣', '2️⃣', '3️⃣', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣', '9️⃣', '🔟'][i], `${name}|${nth}`),
          id: String(i + 1), hint: `Run a ${name} or ${nth} street` };
      }) },
    { id: 'types', name: 'Street Types', icon: '🪧', color: '#6d4c41',
      cards: [['Avenue', '🏙️'], ['Road', '🛣️'], ['Drive', '🚗'], ['Lane', '🌾'], ['Way', '🧭'], ['Crescent', '🌙'],
        ['Close', '🏡'], ['Court', '⛲'], ['Boulevard', '🌴'], ['Place', '📍'], ['Terrace', '🏘️'], ['Trail', '🥾']]
        .map(([name, icon]) => ({ ...word(name, icon), hint: `Run a ${name}` })) },
    { id: 'land', name: 'Lay of the Land', icon: '🗺️', color: '#558b2f',
      cards: [['Hill', '⛰️', 'Hill|Hills'], ['Park', '🌳'], ['Lake', '🏞️'], ['River', '🌊'], ['Valley', '🏞️'],
        ['Ridge', '🏔️'], ['Creek', '💧'], ['View', '🔭', 'View|Vista'], ['Meadow', '🌼', 'Meadow|Meadows'], ['Bay', '⛵']]
        .map(([name, icon, pattern]) => word(name, icon, pattern)) },
  ];

  // Sets from quests: art only, nothing to run but the quests themselves.
  const QUEST = [
    { id: 'creatures', name: 'Trail Creatures', icon: '🦊', color: '#ef6c00',
      cards: [['fox', 'Fox', '🦊'], ['deer', 'Deer', '🦌'], ['rabbit', 'Rabbit', '🐇'], ['squirrel', 'Squirrel', '🐿️'],
        ['hedgehog', 'Hedgehog', '🦔'], ['bear', 'Bear', '🐻'], ['raccoon', 'Raccoon', '🦝'], ['beaver', 'Beaver', '🦫'],
        ['frog', 'Frog', '🐸'], ['wolf', 'Wolf', '🐺']] },
    { id: 'sky', name: 'Night Sky', icon: '🌌', color: '#283593',
      cards: [['moon', 'Full Moon', '🌕'], ['crescent', 'Crescent Moon', '🌙'], ['star', 'Pole Star', '⭐'],
        ['shooting', 'Shooting Star', '🌠'], ['comet', 'Comet', '☄️'], ['milky', 'Milky Way', '🌌'], ['planet', 'Ringed Planet', '🪐'],
        ['eclipse', 'Eclipse', '🌑'], ['aurora', 'Aurora', '🎆'], ['sunrise', 'Sunrise', '🌄']] },
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

  // What the found sets look at: on-foot activities oldest first, with a
  // detail naming the first one to do something.
  function trackStats(tracks) {
    const timed = tracks.filter(t => t.time && !Number.isNaN(Date.parse(t.time)))
      .sort((a, b) => Date.parse(a.time) - Date.parse(b.time));
    const date = t => new Date(t.time);
    const detail = t => `${t.name}, ${fmtDate(date(t))}`;
    const days = [...new Set(timed.map(t => dayKey(date(t))))];
    return {
      date,
      first: match => { const t = timed.find(match); return t ? detail(t) : null; },
      double: () => {
        const seen = new Map();
        for (const t of timed) {
          const k = dayKey(date(t));
          if (seen.has(k)) return `${seen.get(k).name} and ${t.name}, ${fmtDate(date(t))}`;
          seen.set(k, t);
        }
        return null;
      },
      daysInARow: n => {
        const have = new Set(days);
        for (const t of timed) {
          const d = date(t);
          let k = 1;
          while (k < n && have.has(dayKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + k)))) k++;
          if (k === n) return `From ${fmtDate(d)}`;
        }
        return null;
      },
    };
  }

  // Adds up road, path and trail.
  function combine(t) {
    const all = { len: 0, covered: 0, streets: 0, done: 0 };
    for (const c of Object.values(t)) for (const k in all) all[k] += c[k];
    return all;
  }

  // The street names you've covered some of (STREET_RUN, or most of a short
  // one), and the neighbourhood cards: [{ code, detail }].
  function streetsAndHoods(tracks, areas) {
    const named = new Set();
    const hoods = [];
    const segments = tracks.map(t => t.segments);
    for (const area of areas) {
      const prep = Coverage.prepared(area);
      const summary = Coverage.summarize(prep, Coverage.compute(prep, segments));
      for (const g of summary.groups) {
        if (g.name && g.covered >= Math.min(STREET_RUN, g.len * 0.8)) named.add(g.name);
      }
      area.data.hoods.forEach((hood, i) => {
        const t = combine(summary.byHood[i]);
        if (!t.len || t.covered / t.len * 100 < HOOD_PCT) return;
        const code = `h:${area.osmId}:${hood.name}`;
        hoods.push({ code, detail: `${Math.round(t.covered / t.len * 100)}% of its streets` });
        if (t.streets > 0 && t.done === t.streets) hoods.push({ code: `${code}:gold`, detail: 'Every street done' });
      });
    }
    return { named: [...named].sort((a, b) => a.localeCompare(b)), hoods };
  }

  // Every found card met now: [{ code, detail }]. tracks: on-foot activities.
  function evaluate(tracks, areas) {
    const stats = trackStats(tracks);
    const { named, hoods } = streetsAndHoods(tracks, areas);
    const out = [];
    for (const set of FOUND) {
      for (const card of set.cards) {
        const detail = card.words ? named.find(n => card.words.test(n)) : card.test(stats);
        if (detail) out.push({ code: `f:${set.id}:${card.id}`, detail });
      }
    }
    return out.concat(hoods);
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

  // Every set as it stands, to show: [{ id, name, icon, color, kind, cards:
  // [{ code, name, icon, hint, owned, gold, detail }] }]. kind: quest, found or
  // hood. Neighbourhood sets come from areas.
  function sets(owned, areas) {
    const has = code => owned.get(code);
    const card = (set, prefix, c) => ({ code: `${prefix}:${set.id}:${c.id}`, name: c.name, icon: c.icon, hint: c.hint,
      owned: Boolean(has(`${prefix}:${set.id}:${c.id}`)), detail: (has(`${prefix}:${set.id}:${c.id}`) || {}).detail || '' });
    const out = [
      ...[...QUEST, LEGEND_SET].map(set => ({ id: set.id, name: set.name, icon: set.icon, color: set.color, kind: 'quest',
        month: set.month, boss: Boolean(set.boss), cards: set.cards.map(c => card(set, 'q', c)) })),
      ...FOUND.map(set => ({ id: set.id, name: set.name, icon: set.icon, color: set.color, kind: 'found',
        cards: set.cards.map(c => card(set, 'f', c)) })),
    ];
    const seen = new Set();
    for (const area of areas) {
      if (area.data.hoods.length < 2 || seen.has(area.osmId)) continue;
      seen.add(area.osmId);
      out.push({ id: `h${area.osmId}`, name: area.name, icon: '🏘️', color: '#455a64', kind: 'hood',
        cards: area.data.hoods.map(hood => {
          const code = `h:${area.osmId}:${hood.name}`;
          return { code, name: hood.name, icon: '🏘️', hint: `Cover ${HOOD_PCT}% of its streets; every street turns it gold`,
            owned: Boolean(has(code)), gold: Boolean(has(`${code}:gold`)), detail: (has(`${code}:gold`) || has(code) || {}).detail || '' };
        }) });
    }
    return out;
  }

  // Trophies for sets just completed: [{ code, title, detail }]. A
  // neighbourhood set is complete once every card is gold.
  function setTrophies(list) {
    return list.filter(set => set.cards.length && set.cards.every(c => (set.kind === 'hood' ? c.gold : c.owned)))
      .map(set => ({ code: `cards:${set.id}`, title: `${set.icon} ${set.name} set`,
        detail: set.kind === 'hood' ? `Every neighbourhood card turned gold` : `All ${set.cards.length} cards collected` }));
  }

  return { evaluate, pack, questSet, sets, setTrophies, legend, legendCard, STREET_RUN, HOOD_PCT };
})();
