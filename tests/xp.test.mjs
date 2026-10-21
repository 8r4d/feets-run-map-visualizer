// xp.js: what earns experience points, and levels. In Node, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './lib.mjs';

const { Xp } = loadScripts(['sport.js', 'xp.js']);
const DAY = 86400000;
const since = Date.UTC(2026, 9, 1);
const iso = ms => new Date(ms).toISOString();
let nextId = 1;
const run = ({ at, km = 5, added = at + 3600000, moving = 1800, efforts = {}, sport = 'Run', name = `Run ${nextId}` } = {}) =>
  ({ id: nextId++, name, sport, time: iso(at), addedAt: added, distance: km * 1000, metrics: moving ? { moving, efforts } : null });
const primary = t => t.sport !== 'Ride';
const weekId = d => d.toISOString().slice(0, 10);  // good enough here: one id per day
const events = (tracks, extra = {}) => [...Xp.events({ since, tracks, primary, weekId, streakMin: 100, ...extra })];
const kinds = list => list.map(e => e.kind);
const plain = v => JSON.parse(JSON.stringify(v));  // objects made in the script's own context, as ordinary ones

test('only activities recorded after XP started, and added within a week, count', () => {
  const old = run({ at: since - 10 * DAY });
  const fresh = run({ at: since + DAY });
  const late = run({ at: since + DAY, added: since + 20 * DAY });  // backdated: added long after
  const planned = run({ at: since + 2 * DAY, moving: null });       // a route saved as GPX: no times
  const got = events([old, fresh, late, planned]);
  assert.deepEqual(got.map(e => e.ref), [`activity:${fresh.id}`]);
  assert.equal(got[0].points, 10 + Math.round(10 * Math.sqrt(5)));
  assert.equal(got[0].track, fresh.id);
});

test('an import of years of old runs earns nothing', () => {
  const imported = Array.from({ length: 500 }, (_, i) => run({ at: since - (i + 1) * DAY, added: since + 5 * DAY }));
  assert.deepEqual(events(imported), []);
});

test('longer is worth more, but less per km; rides count a third', () => {
  const p = (km, sport = 'Run') => Xp.activityPoints({ distance: km * 1000 }, sport !== 'Ride');
  assert.ok(p(10) > p(5) && p(5) > p(1));
  assert.ok(p(40) < 4 * p(10), 'one 40 km run earns less than four 10 km ones');
  assert.equal(p(30, 'Ride'), p(10));
});

test('the same activity twice only counts once', () => {
  const a = run({ at: since + DAY });
  const b = { ...run({ at: since + DAY + 20000 }), distance: a.distance + 100 };
  assert.deepEqual(kinds(events([a, b])), ['activity']);
});

test('new bests beat every earlier activity, old ones too; the first time is no best', () => {
  const old = run({ at: since - 30 * DAY, efforts: { 5000: 1500 } });
  const slower = run({ at: since + DAY, efforts: { 5000: 1600 } });
  const faster = run({ at: since + 2 * DAY, efforts: { 5000: 1450, 10000: 3100 } });
  const got = events([old, slower, faster]).filter(e => e.kind === 'best');
  assert.deepEqual(got.map(e => e.ref), [`best:5000:${faster.id}`], '10K was a first, so no best');
  assert.match(got[0].detail, /5K best/);
});

test('new streets: 10 XP a km, and a streak week', () => {
  const a = run({ at: since + DAY });
  const firsts = new Map([[a.id, { time: a.time, metres: 1234 }]]);
  const got = events([a], { firsts });
  const streets = got.find(e => e.kind === 'streets');
  assert.equal(streets.points, 12);
  assert.equal(got.filter(e => e.kind === 'streak').length, 1);
});

test('segment bests: faster than an earlier effort', () => {
  const old = run({ at: since - 5 * DAY });
  const fresh = run({ at: since + DAY });
  const start = s => Math.floor(Date.parse(s.time) / 1000);
  const segments = [{ id: 7, name: 'Hill', efforts: { [old.id]: [[start(old), 300]], [fresh.id]: [[start(fresh), 280]] } }];
  const got = events([old, fresh], { segments }).filter(e => e.kind === 'segment');
  assert.equal(got.length, 1);
  assert.equal(got[0].track, fresh.id);
  const first = [{ id: 8, name: 'New', efforts: { [fresh.id]: [[start(fresh), 280]] } }];
  assert.equal(events([fresh], { segments: first }).filter(e => e.kind === 'segment').length, 0, 'a first effort is no best');
});

test('trophies earn XP, unless a check earns so many it must be an import', () => {
  const t = n => Array.from({ length: n }, (_, i) => ({ code: `c${i}`, title: `T${i}` }));
  assert.equal(Xp.trophyEvents(t(2)).length, 2);
  assert.equal(Xp.trophyEvents(t(12)).length, 0);
  const q = Xp.questEvents([{ id: '2026-10-19:any' }], () => 'Cover 2 km');
  assert.deepEqual(JSON.parse(JSON.stringify(q)), [{ kind: 'quest', ref: 'quest:2026-10-19:any', points: 50, detail: 'Quest: Cover 2 km' }]);
});

test('levels: 200 XP to level 2, then 50 more each level', () => {
  assert.deepEqual({ ...Xp.level(0) }, { level: 1, into: 0, need: 200 });
  assert.deepEqual({ ...Xp.level(199) }, { level: 1, into: 199, need: 200 });
  assert.deepEqual({ ...Xp.level(200) }, { level: 2, into: 0, need: 250 });
  assert.deepEqual({ ...Xp.level(450) }, { level: 3, into: 0, need: 300 });
  assert.equal(Xp.level(9199).level, 16);
  assert.equal(Xp.level(9200).level, 17, 'level n takes 150(n-1) + 25n(n-1) XP in all');
});

// --- Losing XP ---
const localDay = (y, m, d) => new Date(y, m - 1, d).getTime();

test('idle days: a week free, then a little more each day, up to 50', () => {
  const start = localDay(2026, 10, 1);
  const got = Xp.idleEvents({ since: start, tracks: [], now: localDay(2026, 10, 30) + 3600000 });
  // Oct 1–7 are the free week (days 1–7); Oct 8 is the 8th idle day.
  assert.equal(got[0].ref, 'idle:2026-10-08');
  assert.deepEqual(plain(got.slice(0, 4).map(e => e.points)), [-5, -10, -15, -20]);
  assert.equal(got.at(-1).ref, 'idle:2026-10-29', 'not today: it isn\'t over');
  assert.ok(got.every(e => e.points >= -50));
  assert.equal(got.at(-1).points, -50);
});

test('idle days: an activity starts the week again', () => {
  const start = localDay(2026, 10, 1);
  const ran = run({ at: localDay(2026, 10, 10) + 8 * 3600000, added: localDay(2026, 10, 10) + 9 * 3600000 });
  const got = Xp.idleEvents({ since: start, tracks: [ran], now: localDay(2026, 10, 20) + 3600000 });
  assert.deepEqual(plain(got.map(e => e.ref)), ['idle:2026-10-08', 'idle:2026-10-09', 'idle:2026-10-18', 'idle:2026-10-19']);
  assert.deepEqual(plain(got.slice(2).map(e => e.points)), [-5, -10], 'and the slide starts small again');
});

test('idle days: old imported runs don\'t count as being active', () => {
  const start = localDay(2026, 10, 1);
  const backdated = run({ at: localDay(2026, 10, 5), added: localDay(2026, 10, 20) });
  assert.equal(Xp.idleEvents({ since: start, tracks: [backdated], now: localDay(2026, 10, 12) }).length, 4);
});

test('losses never take you below the start of your level', () => {
  // 450 is the start of level 3; 470 is 20 into it.
  const lose = (...points) => points.map((p, i) => ({ kind: 'idle', ref: `idle:${i}`, points: p }));
  assert.deepEqual(plain(Xp.floor(470, lose(-5, -10, -15)).map(e => e.points)), [-5, -10, -5]);
  assert.deepEqual(plain(Xp.floor(450, lose(-25)).map(e => e.points)), [0], 'kept as 0, so it isn\'t counted again');
  const withGain = [{ kind: 'activity', ref: 'activity:1', points: 40 }, ...lose(-50)];
  assert.deepEqual(plain(Xp.floor(470, withGain).map(e => e.points)), [40, -50], 'gains in the same batch count first');
  assert.equal(Xp.level(470 + 40 - 50).level, 3);
});

test('missed quests cost 20 each', () => {
  const got = Xp.missedEvents([{ id: '2026-10-12:any' }, { id: '2026-10-12:street' }], q => q.id);
  assert.deepEqual(plain(got.map(e => [e.ref, e.points])), [['missed:2026-10-12:any', -20], ['missed:2026-10-12:street', -20]]);
});
