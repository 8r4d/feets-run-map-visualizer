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

test("me: the site's name and primary sport, from feets-config.php, even before logging in", async () => {
  const { body } = await new Client().call('me');
  assert.deepEqual(body.site, { name: 'feets dashboard', sport: 'run' }, 'the defaults when the config leaves them out');
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

test('cards: from here on, kept once with the date first found, private to each account', async () => {
  const a = await member(), b = await member();
  const start = (await a.client.call('cards')).body;
  assert.deepEqual(start.cards, []);
  const dayBack = Date.now() - 86400000;
  assert.ok(Math.abs(start.since - dayBack) < 60000, 'found from a day back, like XP');
  assert.equal((await a.client.call('cards')).body.since, start.since, 'set once');
  const first = (await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'Oak Street' }, { code: 'q:creatures:fox', detail: 'For a quest' }] })).body.cards;
  assert.deepEqual(first.map(c => [c.code, c.detail]).sort(), [['f:trees:oak', 'Oak Street'], ['q:creatures:fox', 'For a quest']]);
  const again = (await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'Oak Avenue' }, { code: '' }] })).body.cards;
  assert.equal(again.find(c => c.code === 'f:trees:oak').detail, 'Oak Street', 'the first find stays');
  assert.equal(again.length, 2);
  assert.deepEqual((await b.client.call('cards')).body.cards, [], "B doesn't see A's cards");
  const { client: viewer } = await member({ viewer: true });
  assert.equal((await viewer.call('cards')).status, 403, 'private, like XP');
});

test('cards: the cards found before they only counted from here on are cleared once, with their set trophies', async () => {
  const a = await member();
  await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'Oak Street' }] });
  await a.client.call('achievement_add', { achievements: [{ code: 'cards:trees', title: 'Arboretum set' }, { code: 'distance:100', title: '100 km' }] });
  // As the database was before: no cards_since column.
  execSync(`${process.env.FEETS_DB} -e "ALTER TABLE users DROP COLUMN cards_since"`);
  const after = (await a.client.call('cards')).body;
  assert.deepEqual(after.cards, [], 'cleared');
  assert.ok(after.since > 0, 'and counting from now');
  assert.deepEqual((await a.client.call('achievements')).body.map(t => t.code), ['distance:100'], 'only the set trophies go');
  await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'Oak Street' }] });
  assert.equal((await a.client.call('cards')).body.cards.length, 1, 'just once');
});

test('quests keep the month\'s boss and the streak shields', async () => {
  const a = await member();
  const empty = (await a.client.call('quests')).body;
  assert.deepEqual(empty.shields, { held: 0, used: [], earned: [] });
  assert.equal(empty.boss, null);
  const boss = { id: 'boss:2026-10', month: '2026-10', kind: 'long', target: 14000, since: 1, legend: 'horseman' };
  await a.client.call('quests_save', { week: '2026-10-19', quests: [], done: [], completed: 3, boss, bossDone: true,
    shields: { held: 5, used: ['2026-10-12'], earned: ['2026-10-05'] } });
  const kept = (await a.client.call('quests')).body;
  assert.deepEqual(kept.boss, boss);
  assert.equal(kept.bossDone, true);
  assert.deepEqual(kept.shields, { held: 2, used: ['2026-10-12'], earned: ['2026-10-05'] }, 'two at most');
  assert.equal(kept.expedition, null);
  const expedition = { id: 'exp:1', theme: 'sky', goal: 4, since: 1 };
  await a.client.call('quests_save', { ...kept, expedition, expeditionAt: 5, expeditionLast: 'garden', expeditions: 2 });
  const again = (await a.client.call('quests')).body;
  assert.deepEqual([again.expedition, again.expeditionAt, again.expeditionLast, again.expeditions], [expedition, 5, 'garden', 2]);
});

test('cards: found by running cleared once more for one a set per run, quest and boss cards kept, two weeks back', async () => {
  const a = await member();
  await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'x' }, { code: 'h:77:North', detail: 'x' },
    { code: 'q:creatures:fox', detail: 'x' }, { code: 'q:legends:horseman', detail: 'x' }] });
  await a.client.call('achievement_add', { achievements: [{ code: 'cards:trees', title: 'Arboretum set' }, { code: 'cards:h77', title: 'Riverbend set' },
    { code: 'cards:creatures', title: 'Trail Creatures set' }] });
  // As before 1.18.4.
  execSync(`${process.env.FEETS_DB} -e "DELETE FROM settings WHERE name = 'cards_per_run'"`);
  const after = (await a.client.call('cards')).body;
  assert.deepEqual(after.cards.map(c => c.code).sort(), ['q:creatures:fox', 'q:legends:horseman']);
  assert.ok(Math.abs(after.since - (Date.now() - 14 * 86400000)) < 120000, 'counting from two weeks back');
  assert.deepEqual((await a.client.call('achievements')).body.map(t => t.code), ['cards:creatures']);
  await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'x' }] });
  assert.equal((await a.client.call('cards')).body.cards.length, 3, 'just once');
});

test('cards: running cards found before yearly editions become editions of the year they were found', async () => {
  const a = await member();
  await a.client.call('card_add', { cards: [{ code: 'f:trees:oak', detail: 'x' }, { code: 'h:77:North', detail: 'x' },
    { code: 'h:77:North:gold', detail: 'x' }, { code: 'q:creatures:fox', detail: 'x' }] });
  execSync(`${process.env.FEETS_DB} -e "UPDATE cards SET earned_at = '2026-10-18 12:00:00'; DELETE FROM settings WHERE name = 'cards_yearly'"`);
  const codes = (await a.client.call('cards')).body.cards.map(c => c.code).sort();
  assert.deepEqual(codes, ['f:trees:oak@2026', 'h:77:North@2026', 'h:77:North@2026:gold', 'q:creatures:fox']);
  await a.client.call('card_add', { cards: [{ code: 'f:trees:elm', detail: 'x' }] });
  assert.ok((await a.client.call('cards')).body.cards.some(c => c.code === 'f:trees:elm'), 'just once');
});

test('cards: the look back for past travels is once only', async () => {
  const a = await member();
  assert.equal((await a.client.call('cards')).body.lookedBack, false);
  const done = (await a.client.call('cards_looked_back', {})).body;
  assert.equal(done.lookedBack, true);
  assert.equal((await a.client.call('cards')).body.lookedBack, true);
  const { client: viewer } = await member({ viewer: true });
  assert.equal((await viewer.call('cards_looked_back', {})).status, 403);
});

test('finding areas: a turn every 6 hours, given back when OpenStreetMap was busy, and how it went kept', async () => {
  const a = await member();
  // Not a new account any more, so turns are 6 hours apart.
  execSync(`${process.env.FEETS_DB} -e "UPDATE users SET created_at = NOW() - INTERVAL 1 DAY WHERE username = '${a.username}'"`);
  assert.equal((await a.client.call('area_scan_claim', {})).body.go, true);
  assert.equal((await a.client.call('area_scan_claim', {})).body.go, false, 'one turn');
  await a.client.call('area_scan_save', { result: 'OpenStreetMap was busy, so it will try again in an hour.', retry: true });
  const last = () => JSON.parse(execSync(`${process.env.FEETS_DB} -N -e "SELECT area_scan FROM users WHERE username = '${a.username}'"`)).last;
  assert.ok(Math.abs(last() - (Date.now() / 1000 - 5 * 3600)) < 60, 'the next turn in an hour, not 6');
  assert.equal((await a.client.call('area_scan_claim', {})).body.go, false, 'not straight away');
  const me = (await a.client.call('me')).body.user;
  assert.equal(me.autoAreasLast.text, 'OpenStreetMap was busy, so it will try again in an hour.');
  assert.ok(Math.abs(me.autoAreasLast.at - Date.now()) < 60000);
});

test('finding areas: places found nothing for are skipped for a month', async () => {
  const a = await member();
  execSync(`${process.env.FEETS_DB} -e "UPDATE users SET created_at = NOW() - INTERVAL 1 DAY WHERE username = '${a.username}'"`);
  const old = Math.floor(Date.now() / 1000) - 31 * 86400;
  // The old list of plain keys is kept, counting from now; an expired place is tried again.
  const setScan = state => execSync(`${process.env.FEETS_DB} -e "UPDATE users SET area_scan = '${JSON.stringify(state).replace(/"/g, '\\"')}' WHERE username = '${a.username}'"`);
  setScan({ skip: ['5354,-11339'] });
  await a.client.call('area_scan_save', { skip: ['5355,-11340'] });
  const scan = () => JSON.parse(execSync(`${process.env.FEETS_DB} -N -e "SELECT area_scan FROM users WHERE username = '${a.username}'"`));
  const s = scan();
  s.skipped['5300,-11300'] = old;
  setScan(s);
  const claim = (await a.client.call('area_scan_claim', {})).body;
  assert.equal(claim.go, true);
  assert.deepEqual(claim.skip.sort(), ['5354,-11339', '5355,-11340']);
  assert.equal(scan().skip, undefined, 'the old list is gone');
});

// --- Virtual races ---
// Places as [east, north] metres from a point in Vancouver, and runs along them.
const ORIGIN = [49.28, -123.12];
const at = ([e, n]) => [ORIGIN[0] + n / 111320, ORIGIN[1] + e / (111320 * Math.cos(ORIGIN[0] * Math.PI / 180))];
// A line through `corners` with a point every `step` metres.
function along(corners, step = 10) {
  const out = [corners[0]];
  for (let i = 1; i < corners.length; i++) {
    const [[e1, n1], [e2, n2]] = [corners[i - 1], corners[i]];
    const k = Math.max(1, Math.round(Math.hypot(e2 - e1, n2 - n1) / step));
    for (let j = 1; j <= k; j++) out.push([e1 + (e2 - e1) * j / k, n1 + (n2 - n1) * j / k]);
  }
  return out;
}
// A GPX of points [east, north], `seconds` apart, from `from` (Unix ms).
const runGpx = (points, from, seconds = 2) => '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>'
  + points.map((p, i) => { const [lat, lon] = at(p); return `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}">`
    + `<time>${new Date(from + i * seconds * 1000).toISOString()}</time></trkpt>`; }).join('') + '</trkseg></trk></gpx>';
const still = (p, n) => Array(n).fill(p);  // standing about: n points in one place

// A 400 m by 300 m loop (1400 m), starting and finishing at its south-west corner.
const LOOP = [[0, 0], [400, 0], [400, 300], [0, 300], [0, 0]];

test('races: a course from a route, timed from start to finish along it, best time per entrant', async () => {
  const host = await member(), other = await member();
  const legs = LOOP.slice(1).map((c, i) => along([LOOP[i], c], 25).map(at));
  const route = (await host.client.call('route_save', { name: 'Block loop', distance: 1400,
    data: { waypoints: LOOP.map(at), legs, straight: legs.map(() => false) } })).body;
  const now = Date.now();
  const created = await host.client.call('race_create', { routeId: route.id, name: 'Lunch loop', startsAt: now - 86400000, endsAt: now + 86400000 });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const race = created.body;
  assert.equal(race.name, 'Lunch loop');
  assert.ok(Math.abs(race.distance - 1400) < 5, `distance ${race.distance}`);
  assert.equal((await other.client.call('race_create', { routeId: route.id, name: 'x', startsAt: now, endsAt: now + 1000 })).status, 404,
    "not someone else's route");

  // Anyone with the code, no login: the course and an empty leaderboard.
  const anyone = new Client();
  const key = 'a'.repeat(32), key2 = 'b'.repeat(32);
  const info = (await anyone.call('race', undefined, `&code=${race.code}`)).body;
  assert.equal(info.host, host.username);
  assert.ok(info.course.length >= 4);
  assert.deepEqual(info.entries, []);
  assert.equal(info.mine, false);
  assert.equal((await anyone.call('race', undefined, '&code=' + '0'.repeat(24))).status, 404);

  const enter = (gpx, entrant = key, name = 'Sam') => anyone.call('race_enter', { name, entrant, gpx }, `&code=${race.code}`);
  const hourAgo = now - 3600000;
  // From 200 m away, 30 s about at the start, the loop at 5 m/s, 20 s at the finish, and off again.
  const warmup = along([[-200, 0], [0, 0]]);
  const good = [...warmup, ...still([0, 0], 15), ...along(LOOP).slice(1), ...still([0, 0], 10), ...along([[0, 0], [-200, 0]]).slice(1)];
  const first = (await enter(runGpx(good, hourAgo))).body;
  assert.equal(first.counted, true, JSON.stringify(first));
  assert.ok(first.seconds >= 276 && first.seconds <= 284, `about 1400 m at 5 m/s, not counting the standing about: ${first.seconds}`);
  assert.equal(first.best, true);
  assert.deepEqual(first.race.entries.map(e => [e.name, e.yours]), [['Sam', true]]);

  // Stopping halfway round; cutting across a corner (start to finish, but missing a side).
  assert.equal((await enter(runGpx(along(LOOP.slice(0, 3)), hourAgo), key2)).body.why, 'no-finish');
  const cut = along([[0, 0], [400, 0], [0, 300], [0, 0]]);
  assert.equal((await enter(runGpx(cut, hourAgo), key2)).body.why, 'off-course');
  // Round a bigger block instead: start to finish, but not along the course.
  const wide = along([[0, 0], [0, -150], [450, -150], [450, 350], [0, 350], [0, 0]]);
  assert.equal((await enter(runGpx(wide, hourAgo), key2)).body.why, 'off-course');
  assert.equal((await enter(runGpx(along([[1000, 1000], [2000, 1000]]), hourAgo), key2)).body.why, 'no-start');
  assert.equal((await enter(runGpx(good, now - 3 * 86400000), key2)).body.why, 'outside', 'run before the race');
  assert.equal((await enter(good.map(() => '').join('') + '<gpx></gpx>', key2)).body.why, 'no-times');

  // Two laps, the second faster (1 s a point): the faster lap counts.
  const laps = [...along(LOOP), ...along(LOOP).slice(1).map(p => p)];
  const lapsGpx = '<?xml version="1.0"?><gpx version="1.1"><trk><trkseg>' + laps.map((p, i) => {
    const [lat, lon] = at(p);
    const t = hourAgo + (i <= 140 ? i * 2 : 280 + (i - 140)) * 1000;
    return `<trkpt lat="${lat.toFixed(7)}" lon="${lon.toFixed(7)}"><time>${new Date(t).toISOString()}</time></trkpt>`;
  }).join('') + '</trkseg></trk></gpx>';
  const second = (await enter(lapsGpx, key2, 'Alex')).body;
  assert.equal(second.counted, true, JSON.stringify(second));
  assert.ok(second.seconds >= 136 && second.seconds <= 144, `the faster lap: ${second.seconds}`);
  assert.deepEqual(second.race.entries.map(e => [e.name, e.yours]), [['Alex', true], ['Sam', false]], 'fastest first');

  // Slower than Sam's best: the time stays, the name changes.
  const slow = (await enter(runGpx(good, hourAgo, 3), key, 'Sam B')).body;
  assert.equal(slow.counted, true);
  assert.equal(slow.best, false);
  assert.deepEqual(slow.race.entries.map(e => [e.name, e.seconds]), [['Alex', second.seconds], ['Sam B', first.seconds]]);

  // The host's list and page; only the host takes times off.
  const mine = (await host.client.call('races')).body;
  assert.deepEqual(mine.map(r => [r.name, r.entries]), [['Lunch loop', 2]]);
  assert.equal((await host.client.call('race', undefined, `&code=${race.code}`)).body.mine, true);
  const alex = slow.race.entries[0].id;
  await other.client.call('race_entry_delete', { id: alex });
  assert.equal((await anyone.call('race', undefined, `&code=${race.code}`)).body.entries.length, 2, "others can't");
  await host.client.call('race_entry_delete', { id: alex });
  assert.deepEqual((await anyone.call('race', undefined, `&code=${race.code}`)).body.entries.map(e => e.name), ['Sam B']);

  // Ended: runs from the race still go in for a couple of days, then uploads close.
  assert.equal((await host.client.call('race_update', { endsAt: now - 7200000 }, `&id=${race.id}`)).status, 200);
  assert.equal((await enter(runGpx(good, hourAgo), key2, 'Late')).body.why, 'outside', 'ran after it ended');
  await host.client.call('race_update', { startsAt: now - 10 * 86400000, endsAt: now - 3 * 86400000 }, `&id=${race.id}`);
  assert.equal((await enter(runGpx(good, now - 5 * 86400000), key2)).status, 400, 'uploads closed');
  assert.equal((await host.client.call('race_update', { endsAt: now - 20 * 86400000 }, `&id=${race.id}`)).status, 400, 'ends before it starts');

  // Viewers can't see or make races; deleting one ends its link.
  const { client: viewer } = await member({ viewer: true });
  assert.equal((await viewer.call('races')).status, 403);
  assert.equal((await other.client.call('race_delete', {}, `&id=${race.id}`)).status, 200);
  assert.equal((await anyone.call('race', undefined, `&code=${race.code}`)).status, 200, "others can't delete it");
  await host.client.call('race_delete', {}, `&id=${race.id}`);
  assert.equal((await anyone.call('race', undefined, `&code=${race.code}`)).status, 404);
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
