// api.php against a real (throwaway) database: accounts, password guessing,
// who can see and change what, view links, and tracks. Run by tests/run.sh.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execSync } from 'node:child_process';
import { Client, admin, member, ADMIN, SETUP_PASSWORD, gpxText } from './lib.mjs';

// Forgets every password try, so one test's lock doesn't spill into the next.
const forgetTries = () => execSync(`${process.env.FEETS_DB} -e "DELETE FROM login_attempts"`);

const trackBody = (gpx, extra = {}) => ({
  name: 'Test run', sport: 'running', time: '2026-10-01T15:00:00Z', fileName: 'test.gpx',
  color: '#e6194b', visible: true, distance: 1180, waypoints: [],
  segments: [[[49.28, -123.12], [49.2906, -123.12]]], gpx, ...extra,
});

test('setup makes the admin once', async () => {
  await admin();  // makes it if this is a fresh database
  const again = await new Client().call('setup', { setupPassword: SETUP_PASSWORD, username: 'second', password: 'whatever-123' });
  assert.equal(again.status, 403);
});

test('login: right and wrong passwords', async () => {
  forgetTries();
  const c = new Client();
  assert.equal((await c.login(ADMIN.username, 'wrong-password')).status, 403);
  const ok = await c.login(ADMIN.username, ADMIN.password);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.isAdmin, true);
  assert.equal((await c.call('me')).body.user.username, ADMIN.username);
});

test('password guessing: 5 tries per username, then even the right password waits', async () => {
  forgetTries();
  const { username, password } = await member();
  const guesser = new Client();
  const codes = [];
  for (let i = 0; i < 7; i++) codes.push((await guesser.login(username, `guess-${i}`)).status);
  assert.deepEqual(codes, [403, 403, 403, 403, 403, 429, 429]);
  // From anywhere else too: the lock is on the username.
  const owner = new Client();
  const locked = await owner.login(username.toUpperCase(), password);
  assert.equal(locked.status, 429, 'the right password, in any case, is refused while locked');
  assert.match(locked.body.error, /Too many tries/);
  forgetTries();
  assert.equal((await owner.login(username, password)).status, 200, 'and works once the window has passed');
});

test('password guessing: many at once only get 5 checked', async () => {
  forgetTries();
  const { username } = await member();
  const results = await Promise.all(Array.from({ length: 25 }, (_, i) => new Client().login(username, `burst-${i}`)));
  const checked = results.filter(r => r.status === 403).length;
  assert.ok(checked <= 5, `${checked} guesses were checked`);
  assert.equal(results.filter(r => r.status === 429).length, 25 - checked);
});

test('password guessing: 20 tries per IP, across usernames', async () => {
  forgetTries();
  const c = new Client();
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await c.login(`nobody${i}`, 'wrong')).status);
  assert.deepEqual(codes.slice(0, 20), Array(20).fill(403));
  assert.deepEqual(codes.slice(20), [429, 429]);
  assert.equal((await new Client().login(ADMIN.username, ADMIN.password)).status, 200, 'another IP is unaffected');
});

test('password guessing: "Forgot password" still unlocks a guessed-at admin', async () => {
  forgetTries();
  const guesser = new Client();
  for (let i = 0; i < 6; i++) await guesser.login(ADMIN.username, `guess-${i}`);
  assert.equal((await new Client().login(ADMIN.username, ADMIN.password)).status, 429);
  const r = await new Client().call('recover', { username: ADMIN.username, setupPassword: SETUP_PASSWORD, password: ADMIN.password });
  assert.equal(r.status, 200);
  assert.equal((await new Client().login(ADMIN.username, ADMIN.password)).status, 200, 'the lock is cleared');
  forgetTries();
});

test('password guessing: the setup password is limited per IP', async () => {
  forgetTries();
  const c = new Client();
  const codes = [];
  for (let i = 0; i < 22; i++) codes.push((await c.call('recover', { username: ADMIN.username, setupPassword: `nope-${i}`, password: 'x-new-password' })).status);
  assert.equal(codes.filter(s => s === 403).length, 20);
  assert.equal(codes.filter(s => s === 429).length, 2);
  forgetTries();
});

test('view links: 7 days for members, the admin chooses', async () => {
  const day = 86400000;
  const { client } = await member();
  const made = await client.call('view_link_create', { label: 'Club', days: 300 });
  assert.equal(made.status, 200);
  assert.equal(made.body.days, 7, 'a member asking for 300 days gets 7');
  const forever = await client.call('view_link_create', { label: 'Forever', days: 0 });
  assert.equal(forever.body.days, 7, 'and no "never expires" either');
  const links = (await client.call('view_links')).body;
  for (const l of links) assert.ok(Math.abs(l.expiresAt - (Date.now() + 7 * day)) < day / 24, `${l.label} expires in 7 days`);

  const a = await admin();
  assert.equal((await a.call('view_link_create', { label: 'Admin long', days: 30 })).body.days, 30);
  assert.equal((await a.call('view_link_create', { label: 'Admin forever', days: 0 })).body.days, 0);
  const adminLinks = (await a.call('view_links')).body;
  assert.equal(adminLinks.find(l => l.label === 'Admin forever').expiresAt, null);
  assert.equal((await a.call('view_link_create', { label: 'Too long', days: 400 })).status, 400);
});

test('a view link only shows routes', async () => {
  const { client } = await member();
  const { body: { code } } = await client.call('view_link_create', { label: 'Friends' });
  const viewer = new Client();
  assert.equal((await viewer.call('routes', undefined, `&view=${code}`)).status, 200);
  assert.equal((await viewer.call('', undefined, `&view=${code}`)).status, 403, 'not the tracks');
  assert.equal((await viewer.call('areas', undefined, `&view=${code}`)).status, 403, 'nor the areas');
  assert.equal((await viewer.call('add', trackBody(gpxText()), `&view=${code}`)).status, 403, 'and changes nothing');
});

test('tracks: added with pace and climb, and only their owner sees them', async () => {
  const a = await member(), b = await member();
  const added = await a.client.call('add', trackBody(gpxText({ n: 60, step: 20, seconds: 6 })));
  assert.equal(added.status, 200);
  const { id, metrics } = added.body;
  assert.equal(metrics.moving, 354, '59 steps of 6 s');
  assert.equal(added.body.sport, 'Run', 'the sport as kept');
  assert.ok(metrics.climb >= 50 && metrics.climb <= 59, `climb ${metrics.climb}`);

  const mine = (await a.client.call('')).body;
  assert.deepEqual(mine.map(t => t.id), [id]);
  assert.equal(mine[0].sport, 'Run');
  assert.deepEqual((await b.client.call('')).body, [], "B doesn't see A's track");
  // Nor delete it, or its segment times (which deleting a track clears).
  execSync(`${process.env.FEETS_DB} -e "INSERT INTO segment_efforts VALUES (999, ${id}, '[]')"`);
  await b.client.call('delete', {}, `&id=${id}`);
  assert.deepEqual((await a.client.call('')).body.map(t => t.id), [id], "B can't delete A's track");
  const efforts = () => Number(execSync(`${process.env.FEETS_DB} -N -e "SELECT COUNT(*) FROM segment_efforts WHERE track_id = ${id}"`));
  assert.equal(efforts(), 1, "nor its segment times");
  assert.equal((await a.client.call('delete', {}, `&id=${id}`)).status, 200);
  assert.deepEqual((await a.client.call('')).body, []);
  assert.equal(efforts(), 0, "the owner's delete clears them");
});

test('view-only accounts read their inviter\'s tracks and change nothing', async () => {
  const a = await admin();
  const added = await a.call('add', trackBody(gpxText({ name: 'Admin run' })));
  const { client } = await member({ viewer: true });
  const list = (await client.call('')).body;
  assert.ok(list.some(t => t.id === added.body.id));
  assert.equal((await client.call('add', trackBody(gpxText()))).status, 403);
  assert.equal((await client.call('delete', {}, `&id=${added.body.id}`)).status, 403);
  assert.equal((await client.call('view_link_create', { label: 'x' })).status, 403);
  await a.call('delete', {}, `&id=${added.body.id}`);
});

test('way names: yours alone, renamed or taken off, and readable by your viewers', async () => {
  const a = await member(), b = await member();
  assert.deepEqual((await a.client.call('way_names')).body, {});
  assert.deepEqual((await a.client.call('way_names_save', { ways: [11, 12], name: '  Fern Trail ' })).body,
    { 11: 'Fern Trail', 12: 'Fern Trail' }, 'trimmed');
  assert.deepEqual((await a.client.call('way_names_save', { ways: [12], name: 'Moss Path' })).body,
    { 11: 'Fern Trail', 12: 'Moss Path' });
  assert.deepEqual((await a.client.call('way_names_save', { ways: [11], name: '' })).body, { 12: 'Moss Path' });
  assert.deepEqual((await b.client.call('way_names')).body, {}, "B doesn't see A's names");

  const owner = await admin();
  await owner.call('way_names_save', { ways: [7], name: 'Admin Lane' });
  const { client } = await member({ viewer: true });
  assert.equal((await client.call('way_names')).body[7], 'Admin Lane');
  assert.equal((await client.call('way_names_save', { ways: [7], name: 'x' })).status, 403);
  await owner.call('way_names_save', { ways: [7], name: '' });
});

test('not logged in: nothing but the login', async () => {
  const c = new Client();
  assert.equal((await c.call('')).status, 401);
  assert.equal((await c.call('routes')).status, 401);
  assert.equal((await c.call('add', trackBody(gpxText()))).status, 401);
});

test('XP: a start date, a ledger that counts each thing once, and deletes take points away', async () => {
  const a = await member(), b = await member();
  const first = (await a.client.call('xp')).body;
  assert.ok(Math.abs(first.since - (Date.now() - 86400000)) < 60000, 'XP counts from a day before it was first asked');
  assert.equal(first.total, 0);
  await new Promise(r => setTimeout(r, 1100));
  assert.equal((await a.client.call('xp')).body.since, first.since, "and the start date doesn't move");

  const { body: { id } } = await a.client.call('add', trackBody(gpxText()));
  const { body: other } = await b.client.call('add', trackBody(gpxText()));
  const r = await a.client.call('xp_add', { events: [
    { kind: 'activity', ref: `activity:${id}`, track: id, points: 32, detail: 'Test run' },
    { kind: 'quest', ref: 'quest:2026-10-19:any', points: 50, detail: 'Quest' },
    { kind: 'quest', ref: 'quest:2026-10-19:any', points: 50, detail: 'Quest, again' },
    { kind: 'cheating', ref: 'x', points: 50 },
    { kind: 'trophy', ref: 'trophy:huge', points: 100000 },
    { kind: 'activity', ref: `activity:${other.id}`, track: other.id, points: 30 },
  ] });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.added, [`activity:${id}`, 'quest:2026-10-19:any'], "duplicates, unknown kinds, silly points and others' tracks are left out");
  assert.equal(r.body.total, 82);
  assert.deepEqual(r.body.refs.sort(), [`activity:${id}`, 'quest:2026-10-19:any']);
  assert.equal(r.body.recent.length, 2);
  assert.equal((await a.client.call('xp_add', { events: [{ kind: 'quest', ref: 'quest:2026-10-19:any', points: 50 }] })).body.added.length, 0);
  assert.equal((await b.client.call('xp')).body.total, 0, "B's XP is B's own");

  await a.client.call('delete', {}, `&id=${id}`);
  const after = (await a.client.call('xp')).body;
  assert.equal(after.total, 50, "deleting the activity takes its XP; the quest's stays");
  await b.client.call('delete', {}, `&id=${other.id}`);
});

test('XP is private: view-only accounts and view links get none', async () => {
  const { client } = await member({ viewer: true });
  assert.equal((await client.call('xp')).status, 403);
  assert.equal((await client.call('xp_add', { events: [] })).status, 403);
});

test('XP losses: kept as 0 or less, and only idle days can be taken back', async () => {
  const { client } = await member();
  await client.call('xp');
  let r = await client.call('xp_add', { events: [
    { kind: 'quest', ref: 'quest:w:any', points: 50 },
    { kind: 'idle', ref: 'idle:2026-10-08', points: -5, detail: '8 days without an activity' },
    { kind: 'missed', ref: 'missed:w:street', points: -20 },
    { kind: 'idle', ref: 'idle:2026-10-09', points: 0 },
    { kind: 'idle', ref: 'idle:bad', points: 10 },          // a loss can't be a gain
    { kind: 'quest', ref: 'quest:w:neg', points: -10 },     // nor a gain a loss
  ] });
  assert.deepEqual(r.body.added, ['quest:w:any', 'idle:2026-10-08', 'missed:w:street', 'idle:2026-10-09']);
  assert.equal(r.body.total, 25);
  assert.deepEqual({ ...r.body.idle }, { 'idle:2026-10-08': -5, 'idle:2026-10-09': 0 });
  r = await client.call('xp_add', { events: [], retract: ['idle:2026-10-08', 'missed:w:street', 'quest:w:any'] });
  assert.equal(r.body.total, 30, 'the idle day comes back; the missed quest and the quest stay');
  assert.ok(!r.body.refs.includes('idle:2026-10-08'));
});
