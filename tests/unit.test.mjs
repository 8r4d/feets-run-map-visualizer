// Browser scripts that don't need a page: units.js and convert.js (FIT).
// TCX and GPX need the browser's DOMParser, so they're in browser.test.mjs.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { loadScripts, fixture } from './lib.mjs';

const clock = s => `${Math.floor(Math.round(s) / 60)}:${String(Math.round(s) % 60).padStart(2, '0')}`;
const unitsFor = (picked, language = 'en-GB') => {
  const ctx = loadScripts([], { navigator: { language, languages: [language] } });
  if (picked) ctx.localStorage.setItem('feets-units', picked);
  return loadScripts(['units.js'], { localStorage: ctx.localStorage, navigator: ctx.navigator }).Units;
};

test('units: km by default, miles for US English', () => {
  assert.equal(unitsFor(null, 'en-GB').unit, 'km');
  assert.equal(unitsFor(null, 'fr-FR').unit, 'km');
  assert.equal(unitsFor(null, 'en-US').unit, 'mi');
  assert.equal(unitsFor('km', 'en-US').unit, 'km', 'a picked unit wins over the language');
  assert.equal(unitsFor('mi', 'en-GB').unit, 'mi');
});

test('units: kilometres and metres', () => {
  const U = unitsFor('km');
  assert.equal(U.dist(5210, 2, 10), '5.21 km');
  assert.equal(U.dist(12345, 2, 10), '12.3 km');
  assert.equal(U.short(450), '450 m');
  assert.equal(U.short(3200), '3.2 km');
  assert.equal(U.short(12400), '12 km');
  assert.equal(U.height(123.4), '123 m');
  assert.equal(U.pace(312, clock), '5:12 /km');
  assert.equal(U.speed(25 / 3.6), '25.0 km/h');
  assert.equal(U.fromUnit(5), 5000);
});

test('units: miles and feet', () => {
  const U = unitsFor('mi');
  assert.equal(U.dist(1609.344 * 3.25, 2, 10), '3.25 mi');
  assert.equal(U.short(100), '330 ft', 'under a tenth of a mile, in feet');
  assert.equal(U.short(1609.344 / 2), '0.5 mi');
  assert.equal(U.height(100), '328 ft');
  assert.equal(U.pace(300, clock), '8:03 /mi', '5:00 /km is 8:03 /mi');
  assert.equal(U.speed(1609.344 / 3600 * 15), '15.0 mph');
  assert.equal(Math.round(U.fromUnit(1)), 1609);
});

const fitText = name => {
  const { Convert } = loadScripts(['convert.js']);
  const buf = fs.readFileSync(fixture(name));
  return Convert.fit(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 'fallback name');
};
const trkpts = gpx => [...gpx.matchAll(/<trkpt lat="([-\d.]+)" lon="([-\d.]+)">(?:<ele>([-\d.]+)<\/ele>)?(?:<time>([^<]+)<\/time>)?/g)];

test('FIT activity: points, heights, times, sport', () => {
  const gpx = fitText('trail-run.fit');
  const pts = trkpts(gpx);
  assert.equal(pts.length, 201, 'the 3 records before a GPS fix are left out');
  assert.equal((gpx.match(/<trkseg>/g) || []).length, 2, 'the 15-minute stop starts a new segment');
  assert.match(gpx, /<type>trail_running<\/type>/);
  assert.match(gpx, /<name>fallback name<\/name>/, 'an activity has no name of its own');
  assert.match(gpx, /<metadata><name>fallback name<\/name><time>2026-10-01T15:00:03Z<\/time>/);
  const [, lat, lon, ele, time] = pts[0];
  assert.ok(Math.abs(lat - 49.3107) < 1e-4 && Math.abs(lon - -123.1417) < 1e-4, `first point ${lat},${lon}`);
  assert.equal(Number(ele), 10);
  assert.equal(time, '2026-10-01T15:00:03Z');
});

test('FIT course: its name, no times', () => {
  const gpx = fitText('course.fit');
  assert.match(gpx, /<trk><name>Seawall course<\/name>/);
  assert.equal(trkpts(gpx).length, 41);
  assert.ok(trkpts(gpx).every(p => !p[4]), 'its points have no times');
});

test('FIT: refuses what isn\'t one', () => {
  const { Convert } = loadScripts(['convert.js']);
  assert.throws(() => Convert.fit(new TextEncoder().encode('<gpx>not a fit file at all</gpx>').buffer, 'x'), /Not a FIT file/);
  const buf = fs.readFileSync(fixture('trail-run.fit'));
  const cut = buf.buffer.slice(buf.byteOffset, buf.byteOffset + 600);
  assert.throws(() => Convert.fit(cut, 'x'), /cut short|damaged/);
});

test('read: .fit.gz is unpacked and kept as .gpx', async () => {
  const { Convert } = loadScripts(['convert.js']);
  const file = new File([zlib.gzipSync(fs.readFileSync(fixture('trail-run.fit')))], 'Morning_Run.fit.gz');
  const { text, name, fileName } = await Convert.read(file);
  assert.equal(name, 'Morning_Run');
  assert.equal(fileName, 'Morning_Run.gpx');
  assert.equal(trkpts(text).length, 201);
  assert.ok(Convert.ACCEPT.test('a.tcx.gz') && Convert.ACCEPT.test('b.FIT') && !Convert.ACCEPT.test('c.zip'));
});

// --- Cards (cards.js), with the street coverage they look at ---
test('cards: found by running, at most one per set per run, the same picks every time', () => {
  const { Cards } = loadScripts(['sport.js', 'coverage.js', 'cards.js']);
  const O = [53.45, -113.55];
  const at = (e, n) => [O[0] + n / 111320, O[1] + e / (111320 * Math.cos(O[0] * Math.PI / 180))];
  // A street from (e1, n) to (e2, n), with a point every 20 m, and a run along part of it.
  const line = (e1, e2, n, step = 20) => Array.from({ length: Math.round(Math.abs(e2 - e1) / step) + 1 },
    (_, i) => at(e1 + Math.sign(e2 - e1) * i * step, n));
  const street = (id, name, hood, e1, e2, n) => ({ id, name, cat: 'road', hood, len: Math.abs(e2 - e1), runs: [line(e1, e2, n)] });
  const area = { id: 1, osmId: 77, name: 'Riverbend', excluded: [], data: {
    boundary: [], hoods: [{ name: 'North', lines: [] }, { name: 'South', lines: [] }],
    streets: [street(1, 'Oak Street', 0, 0, 300, 0), street(2, '5th Avenue', 1, 0, 300, 200), street(3, 'Elm Close', 1, 400, 460, 200)],
  } };
  const local = (d, h, m = 0) => new Date(2026, 0, d, h, m).toISOString();
  const run = (name, time, km, segments = []) => ({ id: name, name, time, distance: km * 1000, segments });
  const tracks = [
    run('Long one', local(5, 5, 30), 21.2, [line(-50, 350, 0, 5)]),       // all of Oak Street
    run('Night jog', local(5, 22), 3, [line(0, 150, 200, 5), line(390, 470, 200, 5)]),  // half of 5th Avenue, all of Elm Close
    ...[6, 7, 8, 9, 10, 11].map(d => run(`Day ${d}`, local(d, 12), 1)),
  ];
  const list = Cards.evaluate(tracks, [area]);
  const found = new Map(list.map(c => [c.code, c.detail]));
  const codes = [...found.keys()];
  assert.equal(JSON.stringify(Cards.evaluate(tracks, [area])), JSON.stringify(list), 'the same picks every time');
  // The long run: one card in each set it could find any in, not all four distances.
  assert.equal(codes.filter(c => c.startsWith('f:distance:')).length, 1, 'one distance card, though it was long enough for four');
  for (const c of ['f:month:1@2026', 'f:clock:early@2026', 'f:trees:oak@2026', 'h:77:North@2026']) assert.ok(found.has(c), c);
  assert.equal(found.get('f:trees:oak@2026'), 'Oak Street');
  // The night jog: Night Owl or Double Day, not both; and Elm Close for two sets.
  assert.equal(codes.filter(c => c === 'f:clock:night@2026' || c === 'f:clock:double@2026').length, 1);
  for (const c of ['f:trees:elm@2026', 'f:types:close@2026', 'h:77:South@2026']) assert.ok(found.has(c), c);
  assert.ok(!found.has('f:month:1@2026') || codes.filter(c => c.startsWith('f:month:')).length === 1, 'January once');
  // The lunchtime runs: Lunch Break, then Seven Straight on the seventh day.
  assert.ok(found.has('f:clock:lunch@2026'));
  assert.match(found.get('f:clock:week@2026'), / to /);
  assert.ok(!codes.some(c => c.startsWith('f:numbers:')), 'not 5th Avenue: only 150 m of it, under STREET_RUN');
  assert.ok(!found.has('h:77:North@2026:gold'), 'gold only from a run after the card, covering it again');
  // One more run of Oak Street turns North gold (and the other distance cards wait for their own runs).
  const again = Cards.evaluate([...tracks, run('Oak again', local(12, 7), 2, [line(-50, 350, 0, 5)])], [area]).map(c => c.code);
  assert.ok(again.includes('h:77:North@2026:gold'));
  assert.equal(again.filter(c => c.startsWith('f:distance:')).length, 1, 'a 2 km run finds no distance card');
  found.set('h:77:North@2026:gold', 'Every street done');

  // Shown by set; the neighbourhood set needs every card gold to be complete.
  const owned = new Map([...found].map(([code, detail]) => [code, { code, detail }]));
  const sets = Cards.sets(owned, [area], 2026);
  const hoods = sets.find(s => s.kind === 'hood');
  assert.equal(JSON.stringify(hoods.cards.map(c => [c.name, c.owned, c.gold])), '[["North",true,true],["South",true,false]]');
  assert.equal(Cards.setTrophies(sets, 2026).length, 0);
  owned.set('h:77:South@2026:gold', { detail: 'Every street done' });
  assert.equal(Cards.setTrophies(Cards.sets(owned, [area], 2026), 2026).map(a => a.code).join(), 'cards:h77@2026');
});

test('cards: a new edition every year, Passport and Places, Globetrotter, climbs, and local time on a trip', () => {
  const { Cards } = loadScripts(['sport.js', 'coverage.js', 'cards.js']);
  const edmonton = [53.5, -113.5], paris = [48.86, 2.35], lima = [-12.05, -77.04];
  // A run from a place: a 1 km line north from it.
  const run = (id, at, when, { km = 5, climb = 0 } = {}) => ({ id, name: id, time: when.toISOString(), distance: km * 1000,
    metrics: { climb }, segments: [[at, [at[0] + 0.009, at[1]]]] });
  const day = (y, m, d, h = 12) => new Date(y, m - 1, d, h);
  const home = { home: edmonton };
  const y1 = Cards.evaluate([run('a', edmonton, day(2026, 11, 2), { climb: 120 })], [], home).map(c => c.code);
  assert.ok(y1.includes('f:month:11@2026') && y1.includes('f:distance:5000@2026'), y1.join());
  assert.ok(y1.some(c => /^f:climb:(50|100)@2026$/.test(c)), 'one climb card: 50 m or 100 m');
  const both = Cards.evaluate([run('a', edmonton, day(2026, 11, 2)), run('b', edmonton, day(2027, 11, 3))], [], home).map(c => c.code);
  assert.ok(both.includes('f:month:11@2026') && both.includes('f:month:11@2027'), 'November again, the next year');

  // Shown: this year's, with the years it's been found in; last year's faded until found again.
  const owned = new Map([['f:month:11@2026', { detail: 'a' }], ['f:month:11@2027', { detail: 'b' }], ['f:month:3@2026', { detail: 'c' }]]);
  const months = Cards.sets(owned, [], 2027).find(s => s.id === 'month');
  const nov = months.cards[10], mar = months.cards[2];
  assert.equal(JSON.stringify([nov.owned, nov.years, nov.code]), '[true,[2026,2027],"f:month:11@2027"]');
  assert.equal(JSON.stringify([mar.owned, mar.years]), '[false,[2026]]');

  // A trip: Passport and Places once each, a Globetrotter card a run, and its own local time.
  const places = new Map([['p1', { cc: 'fr', country: 'France', town: 'Paris' }], ['p2', { cc: 'fr', country: 'France', town: 'Paris' }],
    ['p3', { cc: 'pe', country: 'Peru', town: 'Lima' }]]);
  // 10 pm by the browser's clock is about 6 am in Paris: 8 hours on, for 116° of longitude.
  const trip = [run('p1', paris, day(2026, 12, 1, 22)), run('p2', paris, day(2026, 12, 2, 22)), run('p3', lima, day(2026, 12, 10))];
  const found = Cards.evaluate(trip, [], { home: edmonton, places });
  const codes = found.map(c => c.code);
  assert.equal(codes.filter(c => /^[pt]:/.test(c)).sort().join(), 'p:fr,p:pe,t:fr:paris,t:pe:lima');
  assert.match(found.find(c => c.code === 'p:fr').detail, /^France · p1, /);
  assert.ok(!codes.includes('f:clock:night@2026'), 'not a night run: it was morning in Paris');
  assert.equal(codes.filter(c => c.startsWith('f:globe:')).length, 3, 'one Globetrotter card a run');
  const globe = Cards.evaluate([run('x', lima, day(2026, 12, 10))], [], home).find(c => c.code.startsWith('f:globe:'));
  assert.match(globe.code, /^f:globe:(25km|100km|500km|2000km|5000km|north|south|west|tropics)@2026$/);
  const travels = Cards.sets(new Map(found.map(c => [c.code, { detail: c.detail, earnedAt: '2026-12-01' }])), [], 2026);
  const passport = travels.find(s => s.id === 'passport');
  assert.equal(passport.cards.map(c => c.name).join('|'), 'France|Peru|', 'and one face down for the next country');
  assert.equal(passport.cards[0].icon, '🇫🇷');
  assert.equal(Cards.setTrophies(travels, 2026).filter(t => /passport|places/.test(t.code)).length, 0, 'never complete');
});

test('cards: the look back for past travels: each country and town once, from the first run there', () => {
  const { Cards } = loadScripts(['sport.js', 'coverage.js', 'cards.js']);
  const run = (id, iso) => ({ id, name: id, time: iso, distance: 5000, segments: [[[0, 0], [0.01, 0]]] });
  const places = new Map([['a', { cc: 'fr', country: 'France', town: 'Paris' }], ['b', { cc: 'fr', country: 'France', town: 'Lyon' }],
    ['c', { cc: 'fr', country: 'France', town: 'Paris' }], ['d', { cc: 'jp', country: 'Japan', town: '' }]]);
  const found = Cards.travels([run('c', '2019-05-03T08:00:00Z'), run('a', '2019-05-01T08:00:00Z'), run('b', '2019-05-02T08:00:00Z'),
    run('d', '2023-01-01T08:00:00Z'), run('e', '2024-01-01T08:00:00Z')], places);
  assert.equal(found.map(c => c.code).join(), 'p:fr,t:fr:paris,t:fr:lyon,p:jp');
  assert.match(found[0].detail, /^France · a, /, 'from the first run in France');
});

test('cards: quests turn over a card not yet had, seasonal sets only in their month', () => {
  const { Cards } = loadScripts(['sport.js', 'coverage.js', 'cards.js']);
  const oct = new Date(2026, 9, 20), mar = new Date(2027, 2, 1);
  const q = { id: '2026-10-19:any' };
  const first = Cards.pack(q, new Set(), 'Cover 5 km', oct);
  assert.match(first.code, /^q:halloween:/, "October's set");
  assert.equal(Cards.pack(q, new Set(), 'Cover 5 km', oct).code, first.code, 'the same quest turns over the same card everywhere');
  assert.equal(first.detail, 'For "Cover 5 km"');
  // Never one already had; a set runs out after its last card.
  const owned = new Set();
  for (let i = 0; i < 8; i++) owned.add(Cards.pack({ id: `w${i}` }, owned, 'x', oct).code);
  assert.equal([...owned].filter(c => c.startsWith('q:halloween:')).length, 8);
  assert.match(Cards.pack({ id: 'w9' }, owned, 'x', oct).code, /^q:creatures:/, 'Halloween done: the first evergreen set');
  assert.match(Cards.pack(q, new Set(), 'x', mar).code, /^q:sugarshack:/, "March has its own season, Halloween doesn't come");
  const sets = Cards.sets(new Map(), []);
  assert.equal(sets.filter(s => s.month !== undefined).length, 12, 'a season a month');
  const everything = new Set(sets.filter(s => s.kind === 'quest' && (s.month === undefined || s.month === 2) && !s.boss)
    .flatMap(s => s.cards.map(c => c.code)));
  assert.equal(Cards.pack(q, everything, 'x', mar), null, 'every set you can get now is complete');
  assert.match(Cards.pack(q, everything, 'x', new Date(2027, 11, 5)).code, /^q:winter:/, 'but Winter comes round in December');
  for (let i = 0; i < 40; i++) assert.ok(!Cards.pack({ id: `x${i}` }, new Set(), 'x', mar).code.startsWith('q:legends:'), 'legends only from bosses');
  assert.equal(Cards.legend(0).name, 'The Yeti');
});

// --- Streak shields and monthly bosses (quests.js) ---
const questScripts = () => loadScripts(['units.js', 'sport.js', 'stats.js', 'achievements.js', 'coverage.js', 'planner.js', 'cards.js', 'quests.js'],
  { navigator: { language: 'en-CA', languages: ['en-CA'] } });
// firsts() as quests.js makes it, for a few weeks: each record a run's new street that week.
const weekFirsts = (weeks, metres = 500) => new Map(weeks.map((w, i) => {
  const [y, m, d] = w.split('-').map(Number);
  return [i, { time: new Date(y, m - 1, d, 12).toISOString(), metres, ways: new Map([[i, metres]]) }];
}));

test('streak shields: a week without new street bridges the streak, without adding to it', () => {
  const { Quests } = questScripts();
  // Weeks of Mondays in October and November 2026; nothing the week of 10-19.
  const f = weekFirsts(['2026-10-05', '2026-10-12', '2026-10-26', '2026-11-02']);
  const now = new Date(2026, 10, 4);
  assert.equal(Quests.streak(f, now).current, 2, 'broken by the empty week');
  assert.deepEqual([...Quests.useShields(f, 1, [], '2026-10-19', '2026-11-02')], ['2026-10-19']);
  assert.deepEqual([...Quests.useShields(f, 0, [], '2026-10-19', '2026-11-02')], [], 'none held');
  assert.deepEqual([...Quests.useShields(f, 1, [], '2026-10-26', '2026-11-09')], [], 'only for a week that missed');
  const kept = Quests.streak(f, now, ['2026-10-19']);
  assert.equal(kept.current, 4, 'kept going: 4 weeks with new street, the shielded one not counted');
  assert.equal(kept.best, 4);
  // No streak to keep: an empty week after an empty week doesn't use one.
  const gap = weekFirsts(['2026-10-05']);
  assert.deepEqual([...Quests.useShields(gap, 2, [], '2026-10-12', '2026-10-26')], ['2026-10-12', '2026-10-19'], 'one a week while they last');
  assert.deepEqual([...Quests.useShields(gap, 2, [], '2026-10-19', '2026-10-26')], [], 'the week before had nothing');
  // Trophies count bridged streaks too.
  const four = weekFirsts(['2026-10-05', '2026-10-12', '2026-10-26', '2026-11-02']);
  assert.ok(!Quests.streakTrophies(four).some(t => t.code === 'streak:4'));
  assert.ok(Quests.streakTrophies(four, ['2026-10-19']).some(t => t.code === 'streak:4'));
});

test('bosses: one a month, scaled to the days left, only counting from when it was made', () => {
  const { Quests } = questScripts();
  const run = (km, at) => ({ id: at, name: 'Run', time: new Date(at).toISOString(), distance: km * 1000, segments: [] });
  const oct20 = new Date(2026, 9, 20, 9);
  const tracks = [run(10, new Date(2026, 8, 1).getTime()), run(12.4, new Date(2026, 9, 1).getTime())];
  // No areas: only the long run can be the boss.
  const boss = Quests.makeBoss([], () => null, new Map(), tracks, [53.5, -113.5], oct20);
  assert.equal(boss.id, 'boss:2026-10');
  assert.equal(boss.kind, 'long');
  assert.equal(boss.target, 14000, 'the longest of the last 90 days (12.4 km), 15% further, to the km');
  assert.equal(boss.legend, 'horseman');
  assert.match(Quests.bossTitle(boss), /^🐎 The Headless Horseman: Go 14 km in one go$/);
  const long = Quests.makeBoss([], () => null, new Map(), [run(20, new Date(2026, 9, 5).getTime())], [53.5, -113.5], oct20);
  assert.equal(long.target, 21097, 'never past a half marathon');
  // The 12.4 km run was before the boss: it doesn't count. One after does.
  assert.equal(Quests.bossProgress(boss, [], new Map(), tracks).have, 0);
  const after = [...tracks, run(14.2, oct20.getTime() + 86400000)];
  assert.deepEqual({ ...Quests.bossProgress(boss, [], new Map(), after) }, { have: 14200, of: 14000, done: true });
  // ...but not next month's.
  assert.equal(Quests.bossProgress(boss, [], new Map(), [run(20, new Date(2026, 10, 2).getTime())]).have, 0);

  // New street anywhere, scaled to the 12 days of October left.
  const area = { id: 1, osmId: 1, name: 'Here', excluded: [], data: { boundary: [], hoods: [], streets: [] } };
  const busy = new Map(Array.from({ length: 8 }, (_, i) => [i, { time: new Date(2026, 9, 12 - 7 * i, 12).toISOString(), metres: 2000, ways: new Map([[i, 2000]]) }]));
  const nov = Quests.makeBoss([area], () => ({ fraction: [], visited: [] }), busy, [], [0, 0], new Date(2026, 10, 1, 8));
  assert.equal(nov.kind, ['long', 'any'][10 % 2], "by the month, from the kinds there's data for");
});


test('quest limits: neighbourhood quests and bosses keep close to home; the yearly quest goes beyond', () => {
  const { Quests, Coverage } = questScripts();
  const home = [53.5, -113.5];
  // Three neighbourhoods north of home, ~0.6, ~3.3 and ~11 km away, each a 2 km street not yet run.
  const street = (id, hood, lat) => ({ id, name: `Street ${id}`, cat: 'road', hood, len: 2000,
    runs: [Array.from({ length: 9 }, (_, i) => [lat, home[1] + i * 0.004])] });
  const area = { id: 7, osmId: 7, name: 'City', excluded: [], data: { boundary: [],
    hoods: [{ name: 'Near', lines: [] }, { name: 'Middle', lines: [] }, { name: 'Far', lines: [] }],
    streets: [street(1, 0, 53.505), street(2, 1, 53.53), street(3, 2, 53.6)] } };
  const coverageFor = a => Coverage.compute(Coverage.prepared(a), []);
  const oct20 = new Date(2026, 9, 20, 9);
  const where = limits => Quests.make([area], coverageFor, new Map(), [53.54, home[1]], oct20, limits).quests.find(q => q.kind === 'area');

  // Anywhere: the nearest to where it's looking, wherever that is.
  assert.equal(where(null).where, 'Middle');
  assert.equal(where({ mode: 'range', range: 0 }).where, 'Middle', 'no distance is anywhere');
  // Within 2 km of home (looked for from home, as app.js does).
  const near2 = { mode: 'range', range: 2000 };
  assert.equal(Quests.make([area], coverageFor, new Map(), home, oct20, near2).quests.find(q => q.kind === 'area').where, 'Near');
  assert.equal(Quests.make([area], coverageFor, new Map(), home, oct20, { mode: 'range', range: 300 }).quests.some(q => q.kind === 'area'), false,
    'nothing inside: no neighbourhood quest that week');
  // Ticked neighbourhoods.
  assert.equal(where({ mode: 'hoods', hoods: ['7:2'] }).where, 'Far');
  assert.equal(where({ mode: 'hoods', hoods: [] }).where, 'Middle', 'none ticked is anywhere');
  assert.ok(Quests.make([area], coverageFor, new Map(), home, oct20, near2).quests.some(q => q.kind === 'any'), 'new street anywhere stays');

  // A boss in a neighbourhood keeps to them too (November's is in one, from the kinds there's data for).
  const boss = Quests.makeBoss([area], coverageFor, new Map(), [], home, new Date(2026, 10, 1, 8), { mode: 'hoods', hoods: ['7:1'] });
  assert.equal(boss.kind, 'area');
  assert.equal(boss.where, 'Middle');

  // How full inside is getting.
  assert.equal(Quests.localShare([area], coverageFor, near2, home), 0);
  assert.equal(Quests.localShare([area], coverageFor, null, home), null, 'no limits, no share');

  // The yearly quest: the nearest outside them, all year, from when it was made.
  assert.equal(Quests.makeYearly([area], coverageFor, null, home, oct20), null, 'only with limits');
  const yearly = Quests.makeYearly([area], coverageFor, near2, home, oct20);
  assert.equal(yearly.id, 'year:2026');
  assert.equal(yearly.where, 'Middle');
  assert.equal(yearly.target, 1000, "60% of what's left, to the half km, at least 1 km");
  assert.equal(Quests.yearlyTitle(yearly), 'Cover 1 km of new streets in Middle this year');
  const firsts = new Map([
    ['before', { time: new Date(2026, 9, 1).toISOString(), metres: 900, ways: new Map([[2, 900]]) }],
    ['after', { time: new Date(2026, 11, 30).toISOString(), metres: 600, ways: new Map([[2, 600], [1, 400]]) }],
    ['next year', { time: new Date(2027, 0, 2).toISOString(), metres: 900, ways: new Map([[2, 900]]) }],
  ]);
  assert.deepEqual({ ...Quests.yearlyProgress(yearly, [area], firsts) }, { have: 600, of: 1000, done: false },
    'only its own neighbourhood, from when it was made until the year is out');
});

test('expeditions: a theme with cards left (not the last one), progress in its own terms, and a card for finishing', () => {
  const { Quests, Cards } = questScripts();
  const edmonton = [53.5, -113.5];
  const all = Cards.expeditionThemes(new Set());
  assert.equal(all.map(t => t.id).join(), 'sky,daybreak,wild,mapmaker,voyage,peaks,garden');
  // No areas: no Wild Trails or Cartographer; never the theme just done.
  const picks = new Set(Array.from({ length: 50 }, (_, i) => Quests.makeExpedition(all, [], 'sky', 1, () => i / 50).theme));
  assert.equal([...picks].sort().join(), 'daybreak,garden,peaks,voyage');
  assert.equal(Quests.makeExpedition([], [], null), null, 'every theme complete');
  const only = Quests.makeExpedition(all.filter(t => t.id === 'sky'), [], 'sky', 5);
  assert.equal(only.theme, 'sky', 'the last one again, if it is all that is left');
  assert.equal(JSON.stringify(only), '{"id":"exp:5","theme":"sky","goal":4,"since":5}');

  // A run from Edmonton at a UTC time, of km, climbing m.
  const run = (id, utc, { km = 5, climb = 0 } = {}) => ({ id, name: id, time: new Date(utc).toISOString(), distance: km * 1000,
    metrics: { climb, elapsed: 1800 }, segments: [[edmonton, [edmonton[0] + 0.01, edmonton[1]]]] });
  const since = Date.UTC(2026, 11, 1);
  const runs = [
    run('noon', Date.UTC(2026, 11, 1, 19), { km: 10, climb: 150 }),     // noon in Edmonton in December
    run('dusk', Date.UTC(2026, 11, 2, 0, 30), { km: 6, climb: 100 }),   // 5:30 pm: dark already
    run('dawn', Date.UTC(2026, 11, 2, 15, 30), { km: 7 }),               // 8:30 am, sunrise near 8:45
    run('old', Date.UTC(2026, 10, 1, 5), { km: 30 }),                    // before the expedition
  ];
  const progress = (theme, goal, extra = {}) => Quests.expeditionProgress({ id: 'e', theme, goal, since }, runs, extra.areas || [], extra.firsts || new Map());
  assert.equal(progress('sky', 4).have, 1, 'only the 5:30 pm run was in the dark');
  assert.equal(progress('daybreak', 3).have, 1);
  assert.equal(progress('voyage', 40000).have, 23000, 'not the run before it started');
  assert.equal(progress('peaks', 400).have, 250);
  assert.equal(progress('garden', 8).have, 2, 'two different days');
  assert.equal(progress('mapmaker', 3000, { firsts: new Map([['noon', { metres: 1200 }], ['old', { metres: 5000 }]]) }).have, 1200);
  const done = progress('garden', 2);
  assert.equal(done.done, true);
  assert.equal(Quests.expeditionTask({ theme: 'voyage', goal: 40000 }), 'Go 40 km in all');

  // The card: one not had yet from its theme; never from the weekly packs.
  const exp = { id: 'exp:9', theme: 'garden' };
  const card = Cards.expeditionCard(exp, new Set(), 'Garden: Get out on 8 different days');
  assert.match(card.code, /^q:garden:/);
  const garden = Cards.sets(new Map(), [], 2026).find(st => st.id === 'garden');
  assert.equal(Cards.expeditionCard(exp, new Set(garden.cards.map(c => c.code)), 'x'), null, 'a complete theme turns over nothing');
  for (let i = 0; i < 40; i++) assert.ok(!/^q:(sky|garden|daybreak):/.test(Cards.pack({ id: `w${i}` }, new Set(), 'x', new Date(2027, 2, 1)).code));
});

// --- The primary sport (sport.js) ---
test('primary sport: running is the default; walking and cycling count their own and scale their targets', () => {
  const { Sport, Quests, Achievements, Cards, Stats } = questScripts();
  const at = (sport, km, day = 5) => ({ id: `${sport}${km}${day}`, name: sport, sport, time: new Date(2026, 9, day, 9).toISOString(),
    distance: km * 1000, segments: [] });
  const oct20 = new Date(2026, 9, 20, 9);
  assert.equal(Sport.current.id, 'run');
  assert.ok(Sport.counts(at('Run', 5)) && Sport.counts(at('Hike', 5)) && Sport.counts(at(null, 5)), 'on foot, or no type');
  assert.ok(!Sport.counts(at('Ride', 5)));
  assert.equal(Sport.scaled(10000), 10000, 'running targets as they always were');

  Sport.use('cycle');
  assert.ok(Sport.counts(at('Ride', 40)) && Sport.counts(at('GravelRide', 40)) && Sport.counts(at(null, 40)));
  assert.ok(!Sport.counts(at('Run', 10)));
  const rides = [at('Ride', 60, 10), at('Run', 30, 11)];
  const codes = Achievements.evaluate(rides, []).map(a => a.code);
  assert.ok(codes.includes('longest:50000'), 'a 60 km ride is the 50 km trophy');
  assert.ok(!codes.includes('longest:10000'), "running's distances aren't a cycling site's");
  assert.equal(Stats.goal(rides, 'month', oct20).metres, 60000, 'the run is left out');
  const boss = Quests.makeBoss([], () => null, new Map(), [at('Ride', 200, 15)], [53.5, -113.5], oct20);
  assert.equal(boss.target, 100000, 'a cycling long boss tops out at 100 km');
  assert.equal(Cards.sets(new Map(), []).find(s => s.id === 'distance').cards[0].hint, 'Go 20 km in one go');
  assert.match(Cards.sets(new Map(), []).find(s => s.id === 'birds').cards[0].hint, /^Ride a street/);

  Sport.use('walk');
  assert.ok(Sport.counts(at('Walk', 3)) && !Sport.counts(at('Ride', 3)));
  assert.equal(Sport.scaled(10000), 5000);
  Sport.use('swim');
  assert.equal(Sport.current.id, 'walk', 'an unknown sport changes nothing');
});
