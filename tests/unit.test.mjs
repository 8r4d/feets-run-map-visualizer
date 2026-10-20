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
test('cards: found by running: distances, months, times of day, streets and neighbourhoods', () => {
  const { Cards } = loadScripts(['coverage.js', 'cards.js']);
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
  const run = (name, time, km, segments = []) => ({ name, time, distance: km * 1000, segments });
  const tracks = [
    run('Long one', local(5, 5, 30), 21.2, [line(-50, 350, 0, 5)]),       // all of Oak Street
    run('Night jog', local(5, 22), 3, [line(0, 150, 200, 5), line(390, 470, 200, 5)]),  // half of 5th Avenue, all of Elm Close
    ...[6, 7, 8, 9, 10, 11].map(d => run(`Day ${d}`, local(d, 12), 1)),
  ];
  const found = new Map(Cards.evaluate(tracks, [area]).map(c => [c.code, c.detail]));
  const codes = [...found.keys()].sort();
  assert.deepEqual(codes, [
    'f:clock:double', 'f:clock:early', 'f:clock:lunch', 'f:clock:night', 'f:clock:week',
    'f:distance:10000', 'f:distance:15000', 'f:distance:21097', 'f:distance:5000',
    'f:month:1', 'f:trees:elm', 'f:trees:oak', 'f:types:close',
    'h:77:North', 'h:77:North:gold', 'h:77:South',
  ].sort(), 'not 5th Avenue: only 150 m of it, under STREET_RUN; not the half marathon card for a 3 km run');
  assert.equal(found.get('f:trees:oak'), 'Oak Street');
  assert.match(found.get('f:distance:21097'), /^Long one, /);
  assert.match(found.get('f:clock:double'), /^Long one and Night jog, /);

  // Shown by set; the neighbourhood set needs every card gold to be complete.
  const owned = new Map([...found].map(([code, detail]) => [code, { code, detail }]));
  const sets = Cards.sets(owned, [area]);
  const hoods = sets.find(s => s.kind === 'hood');
  assert.equal(JSON.stringify(hoods.cards.map(c => [c.name, c.owned, c.gold])), '[["North",true,true],["South",true,false]]');
  assert.equal(Cards.setTrophies(sets).length, 0);
  owned.set('h:77:South:gold', { detail: 'Every street done' });
  assert.equal(Cards.setTrophies(Cards.sets(owned, [area])).map(a => a.code).join(), 'cards:h77');
});

test('cards: quests turn over a card not yet had, seasonal sets only in their month', () => {
  const { Cards } = loadScripts(['coverage.js', 'cards.js']);
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
const questScripts = () => loadScripts(['units.js', 'stats.js', 'achievements.js', 'coverage.js', 'planner.js', 'cards.js', 'quests.js'],
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

