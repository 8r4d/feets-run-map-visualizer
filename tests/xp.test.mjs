// xp.js: what earns experience points, and levels. In Node, no server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadScripts } from './lib.mjs';

const { Xp } = loadScripts(['xp.js']);
const DAY = 86400000;
const since = Date.UTC(2026, 9, 1);
const iso = ms => new Date(ms).toISOString();
let nextId = 1;
const run = ({ at, km = 5, added = at + 3600000, moving = 1800, efforts = {}, sport = 'Run', name = `Run ${nextId}` } = {}) =>
  ({ id: nextId++, name, sport, time: iso(at), addedAt: added, distance: km * 1000, metrics: moving ? { moving, efforts } : null });
const onFoot = t => t.sport !== 'Ride';
const weekId = d => d.toISOString().slice(0, 10);  // good enough here: one id per day
const events = (tracks, extra = {}) => [...Xp.events({ since, tracks, onFoot, weekId, streakMin: 100, ...extra })];
const kinds = list => list.map(e => e.kind);

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
