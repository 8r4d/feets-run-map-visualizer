// The real page in headless Chrome: logging in, adding GPX, FIT and TCX
// files, miles, and dark mode. Skipped without Chrome (see chrome.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import fs from 'node:fs';
import os from 'node:os';
import { URL_BASE, member, fixture, gpxText } from './lib.mjs';
import { chromePath, launch } from './chrome.mjs';

const skip = !chromePath && 'Chrome or Chromium not found (set CHROME to its path)';
let page, account;

before(async () => {
  if (skip) return;
  account = await member();  // a fresh account, with no tracks yet
  page = await launch();
});
after(async () => { if (page) await page.close(); });

// FEETS_SCREENSHOTS=folder saves a picture of the page at a few points, to look at.
const snap = async name => {
  if (process.env.FEETS_SCREENSHOTS) await page.screenshot(path.join(process.env.FEETS_SCREENSHOTS, `${name}.png`));
};

const rows = () => page.eval(`[...document.querySelectorAll('#track-list li')].map(li => ({
  name: li.querySelector('strong').textContent, details: li.querySelector('small').textContent }))`);

test('log in', { skip }, async () => {
  await page.goto(URL_BASE);
  // Headless Chrome says it's US English, which would mean miles; start in km.
  await page.eval(`localStorage.setItem('feets-units', 'km')`);
  await page.reload();
  await page.waitFor(`!document.getElementById('auth').hidden && document.getElementById('auth-username').offsetParent`, { what: 'the login form' });
  await snap('login');
  await page.eval(`
    document.getElementById('auth-username').value = ${JSON.stringify(account.username)};
    document.getElementById('auth-password').value = ${JSON.stringify(account.password)};
    document.getElementById('auth-form').requestSubmit();`);
  await page.waitFor(`document.getElementById('auth').hidden`, { what: 'the login form to close' });
  assert.equal(await page.eval(`document.getElementById('user-name').textContent`), account.username);
});

test('add GPX, FIT and TCX files', { skip }, async () => {
  await page.setFiles('#file-input', [fixture('trail-run.fit'), fixture('walk.tcx'), fixture('../../samples/stanley-park.gpx')]);
  await page.waitFor(`document.querySelectorAll('#track-list li').length === 3`, { what: 'three tracks in the list' });
  assert.deepEqual(page.dialogs, [], 'no "could not be loaded" alert');
  const list = await rows();
  const fit = list.find(r => r.name === 'trail-run');
  assert.ok(fit, `the FIT file is listed under its file name: ${JSON.stringify(list)}`);
  assert.match(fit.details, /^Trail Run · /, 'its sport, as the server keeps it');
  assert.match(fit.details, /6\.2\d km/, 'about 2π km around the circle');
  assert.match(fit.details, /\d:\d\d \/km/, 'a pace, from its times');
  assert.match(fit.details, /↑ \d+ m/, 'a climb, from its heights');
  const walk = list.find(r => r.name === 'Morning walk to the seawall');
  assert.ok(walk, 'the TCX file is named from its notes');
  assert.match(walk.details, /^Walk · /);
  assert.match(walk.details, /0\.2\d km/);
  // Kept as GPX: that's what downloads.
  const kept = await page.eval(`fetch('api.php').then(r => r.json()).then(ts => ts.map(t => t.fileName).sort())`);
  assert.deepEqual(kept, ['stanley-park.gpx', 'trail-run.gpx', 'walk.gpx']);
});

test('Questing: the modes\' new names, and the game in a column over the map', { skip }, async () => {
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#mode button')].map(b => b.innerText)`),
    ['Tracks', 'Heatmap', 'Questing', 'Road Fill', 'Planning']);
  const where = () => page.eval(`({ hud: !document.getElementById('quest-hud').hidden,
    inHud: document.getElementById('quest-hud').contains(document.getElementById('xp-box')),
    shown: !document.getElementById('questing-panel').hidden,
    boxes: [...document.querySelectorAll('#questing-panel > details')].map(d => d.id) })`);
  assert.equal((await where()).shown, false, 'not in Tracks mode');
  await page.eval(`document.querySelector('#mode [data-mode=fog]').click()`);
  const q = await where();
  assert.ok(q.shown && q.hud && q.inHud, JSON.stringify(q));
  assert.deepEqual(q.boxes, ['xp-box', 'quests-box', 'cards-box', 'trophies-box']);
  assert.ok(await page.eval(`!document.getElementById('sidebar').contains(document.getElementById('trophies-box'))`), 'gone from the sidebar');
  // On a phone there's no room beside the map: the panel under it has them.
  await page.send('Emulation.setDeviceMetricsOverride', { width: 400, height: 800, deviceScaleFactor: 2, mobile: true });
  await page.waitFor(`document.getElementById('quest-hud').hidden`, { what: 'the column to go on a phone' });
  assert.ok(await page.eval(`document.getElementById('sidebar').contains(document.getElementById('xp-box'))`), 'in the panel on a phone');
  assert.deepEqual(await page.eval(`[...document.querySelectorAll('#mode button')].map(b => b.innerText)`),
    ['Tracks', 'Heat', 'Quest', 'Roads', 'Plan'], 'shorter names on a phone');
  const fits = await page.eval(`document.getElementById('mode').getBoundingClientRect().right
    <= document.querySelector('.leaflet-control-layers').getBoundingClientRect().left`);
  assert.ok(fits, 'clear of the layers button');
  await snap('questing-phone');
  await page.send('Emulation.clearDeviceMetricsOverride');
  await page.waitFor(`!document.getElementById('quest-hud').hidden`, { what: 'the column back' });
  await page.eval(`document.querySelector('#mode [data-mode=tracks]').click()`);
  assert.equal((await where()).shown, false);
});

test('each mode keeps its own base map, and the layers menu opens over the Questing column', { skip }, async () => {
  const base = () => page.eval(`[...document.querySelectorAll('.leaflet-control-layers-base input')]
    .find(i => i.checked).nextSibling.textContent.trim()`);
  const mode = m => page.eval(`document.querySelector('#mode [data-mode=${m}]').click()`);
  const pick = name => page.eval(`[...document.querySelectorAll('.leaflet-control-layers-base label')]
    .find(l => l.textContent.trim() === ${JSON.stringify(name)}).querySelector('input').click()`);
  await mode('tracks');
  assert.equal(await base(), 'OpenStreetMap');
  await mode('heatmap');
  assert.equal(await base(), 'Dark', 'the heatmap starts on the dark map');
  await mode('fog');
  assert.equal(await base(), 'OpenStreetMap');
  await pick('OpenTopoMap');
  await mode('tracks');
  await pick('Dark');
  await mode('fog');
  assert.equal(await base(), 'OpenTopoMap', 'Questing kept its pick');
  await mode('tracks');
  assert.equal(await base(), 'Dark', 'and Tracks its own');
  await page.reload();
  await page.waitFor(`document.querySelector('.leaflet-control-layers-base input:checked')`);
  assert.equal(await base(), 'Dark', 'remembered');
  await mode('heatmap');
  assert.equal(await base(), 'Dark');

  // Questing: open the layers menu; it's on top where it overlaps the column.
  await mode('fog');
  await page.eval(`document.querySelector('.leaflet-control-layers').classList.add('leaflet-control-layers-expanded')`);
  const onTop = await page.eval(`(() => {
    const menu = document.querySelector('.leaflet-control-layers-list').getBoundingClientRect();
    const hud = document.getElementById('quest-hud').getBoundingClientRect();
    const x = Math.max(menu.left, hud.left) + 5, y = Math.max(menu.top, hud.top) + 5;
    const overlap = x < Math.min(menu.right, hud.right) && y < Math.min(menu.bottom, hud.bottom);
    return { overlap, top: document.elementFromPoint(x, y)?.closest('.leaflet-control-layers') !== null };
  })()`);
  assert.ok(onTop.overlap, 'they do overlap');
  assert.ok(onTop.top, 'and the menu is the one on top');
  await page.eval(`document.querySelector('.leaflet-control-layers').classList.remove('leaflet-control-layers-expanded')`);
  await pick('OpenStreetMap');
  await mode('tracks');
  await pick('OpenStreetMap');
});

test('XP: old activities earn none, a new run does', { skip }, async () => {
  await page.eval(`document.querySelector('#mode [data-mode=fog]').click()`);
  const xp = () => page.eval(`({ shown: !document.getElementById('xp-box').hidden,
    level: document.getElementById('xp-level').textContent, progress: document.getElementById('xp-progress').textContent })`);
  await page.waitFor(`!document.getElementById('xp-box').hidden`, { what: 'the XP box' });
  await new Promise(r => setTimeout(r, 3000));  // quests (and so XP) are checked after a pause
  assert.match((await xp()).progress, /^0 of 200 XP/, 'the files above were recorded before XP started');

  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feets-xp-')), 'This morning.gpx');
  // Recorded just after this account's XP started (a day before the login above).
  const since = await page.eval(`xpState.since`);
  fs.writeFileSync(file, gpxText({ name: 'This morning', n: 300, step: 15, seconds: 5, at: since + 1000 }));
  await page.setFiles('#file-input', [file]);
  const progress = await page.waitFor(`(t => /^[1-9]\\d* of 200 XP/.test(t) && t)(document.getElementById('xp-progress').textContent)`,
    { what: 'XP for the new run', timeout: 15000 });
  assert.match(progress, /XP in all/);
  assert.match(await page.eval(`document.getElementById('xp-recent').textContent`), /This morning\+\d+/);
  assert.ok(page.dialogs.length === 0);
  await page.eval(`document.getElementById('xp-box').open = true`);
  await snap('xp');
  // Deleting it takes its XP away again (and keeps the other tests' three tracks).
  await page.eval(`fetch('api.php').then(r => r.json()).then(ts => ts.find(t => t.name === 'This morning').id)
    .then(id => fetch('api.php?action=delete&id=' + id, { method: 'POST', body: '{}' }))`);
  await page.reload();
  await page.waitFor(`/^0 of 200 XP/.test(document.getElementById('xp-progress').textContent)`, { what: 'the XP to go' });
  await page.eval(`document.querySelector('#mode [data-mode=tracks]').click()`);
});

test('cards: only from runs recorded from here on, shown by set in Questing', { skip }, async () => {
  await page.eval(`document.querySelector('#mode [data-mode=fog]').click()`);
  await page.waitFor(`!document.getElementById('cards-box').hidden && cardsSince !== null`, { what: 'the cards box' });
  await new Promise(r => setTimeout(r, 2500));  // cards are checked with the trophies, after a pause
  // The 6 km trail run was recorded before cards started: no 5K card from it. (The XP test's
  // run, recorded since, may have found a card or two: cards stay once found.)
  assert.ok(!(await page.eval(`cards.map(c => c.code)`)).includes('f:distance:5000'), 'old files find no cards');
  // A 5.1 km run recorded just after cards started.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feets-cards-')), 'Card run.gpx');
  fs.writeFileSync(file, gpxText({ name: 'Card run', n: 341, step: 15, seconds: 5, at: (await page.eval(`cardsSince`)) + 1000 }));
  await page.setFiles('#file-input', [file]);
  await page.waitFor(`cards.some(c => c.code === 'f:distance:5000')`, { what: 'a 5K card', timeout: 15000 });
  const codes = await page.eval(`cards.map(c => c.code)`);
  assert.ok(codes.some(c => c.startsWith('f:month:')), JSON.stringify(codes));
  assert.match(await page.eval(`document.getElementById('cards-count').textContent`), /^\d+\/\d+$/);
  await page.eval(`document.getElementById('cards-box').open = true;
    document.querySelectorAll('.card-set').forEach(d => { if (/Long Way Round|Halloween/.test(d.textContent)) d.open = true; })`);
  const faces = await page.eval(`[...document.querySelectorAll('.card-set[open] .card')].map(c => c.className + ':' + c.querySelector('strong').textContent)`);
  assert.ok(faces.includes('card:5K'), JSON.stringify(faces));
  assert.ok(faces.includes('card missing:'), 'cards not found yet are face down');
  assert.match(await page.eval(`document.getElementById('cards-note').textContent`), /Each quest you finish turns over a.*legend/);
  // This month's boss, above the quests.
  await page.waitFor(`!document.getElementById('boss').hidden`, { what: "the month's boss" });
  const legend = await page.eval(`Cards.legend(new Date().getMonth()).name`);
  assert.match(await page.eval(`document.getElementById('boss').textContent.replace(/\\s+/g, ' ')`), new RegExp(`${legend} ?Plan it .* days? left`));
  await snap('cards');
  await page.eval(`document.getElementById('cards-box').open = false; document.getElementById('quests-box').open = true`);
  await snap('boss');
  // Taken out again, so the tests after this see the three files they expect.
  await page.eval(`fetch('api.php').then(r => r.json()).then(ts => ts.find(t => t.name === 'Card run').id)
    .then(id => fetch('api.php?action=delete&id=' + id, { method: 'POST', body: '{}' }))`);
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#track-list li').length === 3`, { what: 'the three tracks again' });
  await page.eval(`document.querySelector('#mode [data-mode=tracks]').click()`);
});

test('miles', { skip }, async () => {
  await page.eval(`localStorage.setItem('feets-units', 'mi')`);
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#track-list li').length === 3`, { what: 'the list again' });
  const fit = (await rows()).find(r => r.name === 'trail-run');
  assert.match(fit.details, /3\.8\d mi/);
  assert.match(fit.details, /\d:\d\d \/mi/);
  assert.match(fit.details, /↑ \d+ ft/);
  assert.match(await page.eval(`document.getElementById('summary').textContent`), / mi$/);
  assert.match(await page.eval(`document.querySelector('.leaflet-control-scale-line').textContent`), /\b(ft|mi)$/, 'the map scale too');
  assert.equal(await page.eval(`document.querySelector('#plan-explore .unit').textContent`), 'mi');
  assert.match(await page.eval(`document.getElementById('goal-week').parentNode.textContent`), /^Miles per week/);
  assert.equal(await page.eval(`[...document.querySelectorAll('.lang-row select')].find(s => s.getAttribute('aria-label') === 'Units').value`), 'mi');
  // A track's popup, with its pace and elevation chart.
  await page.eval(`document.getElementById('stats-box').open = true;
    [...document.querySelectorAll('#track-list li .name')].find(n => n.textContent.startsWith('trail-run')).click()`);
  const popup = await page.waitFor(`document.querySelector('.track-popup')?.textContent`, { what: 'the popup' });
  assert.match(popup, /mi/);
  await page.waitFor(`document.querySelector('.leaflet-popup .elevation')`, { what: 'the elevation chart' });
  assert.match(await page.eval(`document.querySelector('.leaflet-popup .elevation').textContent`), /\d+ ft.*mi/);
  await snap('miles');
  await page.eval(`document.getElementById('settings-box').open = true; document.getElementById('settings-box').scrollIntoView()`);
  await snap('account');
  await page.eval(`localStorage.setItem('feets-units', 'km')`);
  await page.reload();
  await page.waitFor(`document.querySelectorAll('#track-list li').length === 3`);
  assert.match((await rows()).find(r => r.name === 'trail-run').details, /6\.2\d km/);
});

test('dark mode', { skip }, async () => {
  const theme = () => page.eval(`document.documentElement.dataset.theme`);
  const before = await theme();
  await page.eval(`document.getElementById('theme-toggle').click()`);
  const flipped = before === 'dark' ? 'light' : 'dark';
  assert.equal(await theme(), flipped);
  await page.reload();
  assert.equal(await theme(), flipped, 'remembered');
  const bg = await page.eval(`getComputedStyle(document.getElementById('sidebar')).backgroundColor`);
  assert.equal(bg, flipped === 'dark' ? 'rgb(24, 26, 27)' : 'rgb(250, 250, 250)');
  await snap(flipped);
});

test('installable, and opens offline', { skip }, async () => {
  const manifest = await page.eval(`fetch(document.querySelector('link[rel=manifest]').href).then(r => r.json())`);
  assert.equal(manifest.display, 'standalone');
  for (const icon of manifest.icons) {
    assert.equal(await page.eval(`fetch(${JSON.stringify(icon.src)}).then(r => r.status)`), 200, icon.src);
  }
  await page.waitFor(`navigator.serviceWorker.ready.then(r => Boolean(r.active))`, { what: 'the service worker' });
  await page.reload();  // now the worker sees the page and its scripts
  await page.waitFor(`Boolean(navigator.serviceWorker.controller)`);
  await page.waitFor(`document.querySelectorAll('#track-list li').length === 3`);

  await page.setOffline(true);
  try {
    // The worker's own requests are offline too: one it has no copy of fails.
    assert.equal(await page.eval(`fetch('help/overview.html?probe=' + Date.now()).then(() => 'fetched', () => 'failed')`), 'failed');
    await page.reload();
    assert.equal(await page.eval(`document.querySelector('#sidebar h1').textContent`), 'feets dashboard', 'the page, from its copy');
    assert.equal(await page.eval(`typeof L`), 'object', 'and Leaflet');
    await page.waitFor(`/Could not reach the server/.test(document.body.textContent)`, { what: "the can't-reach-the-server note" });
    const kept = await page.eval(`caches.keys().then(ks => Promise.all(ks.map(k => caches.open(k).then(c => c.keys()))))
      .then(all => all.flat().map(r => r.url))`);
    assert.ok(!kept.some(u => u.includes('api.php')), 'nothing from api.php is kept');
    assert.ok(kept.some(u => /app\.js\?v=/.test(u)));
  } finally {
    await page.setOffline(false);
  }
});

test('naming an unnamed path: its pieces become one street, kept after a reload, renamed and taken off together', { skip }, async () => {
  // A small square area off Stanley Park with two unnamed paths and a named road.
  const box = [[49.30, -123.15], [49.30, -123.14], [49.31, -123.14], [49.31, -123.15], [49.30, -123.15]];
  const street = (id, name, cat, lat) => ({ id, name, cat, hood: -1, len: 500, runs: [[[lat, -123.148], [lat, -123.142]]] });
  const data = { boundary: [box], hoods: [], streets: [street(101, '', 'path', 49.302), street(102, '', 'path', 49.304), street(103, 'Test Road', 'road', 49.306)] };
  const id = await page.eval(`Store.saveArea({ osmId: 999001, name: 'Test Square', data: ${JSON.stringify(data)} }).then(a => a.id)`);
  await page.reload();
  await page.waitFor(`areas.some(a => a.id === ${id})`, { what: 'the area to load' });
  await page.eval(`document.querySelector('#mode [data-mode=streets]').click(); setActiveArea('${id}')`);
  await page.waitFor(`coverage && activeArea.area.id === ${id}`, { what: 'the coverage' });
  const groups = () => page.eval(`coverage.summary.groups.map(g => [g.name, g.ways.length]).sort()`);
  assert.deepEqual(await groups(), [['', 1], ['', 1], ['Test Road', 1]]);

  // Names a path from its popup: w is its index in the area, button the one to press.
  let offered = [];  // the names the dialog offered
  const name = async (w, button, text) => {
    await page.eval(`streetPopup(${w}, L.latLng(49.30, -123.145))`);
    await page.eval(`[...document.querySelectorAll('.street-popup button')].find(b => b.textContent === ${JSON.stringify(button)}).click()`);
    if (text === undefined) return;
    await page.waitFor(`document.getElementById('name-dialog').open`, { what: 'the name dialog' });
    offered = await page.eval(`[...document.querySelectorAll('#name-dialog-list option')].map(o => o.value)`);
    await page.eval(`document.getElementById('name-dialog-input').value = ${JSON.stringify(text)};
      document.getElementById('name-dialog-ok').click()`);
  };
  await name(0, 'Name it', 'Fern Trail');
  await page.waitFor(`coverage.summary.groups.some(g => g.name === 'Fern Trail')`, { what: 'the first piece named' });
  await name(1, 'Name it', 'Fern Trail');
  assert.deepEqual(offered, ['Fern Trail'], 'offered for the next piece');
  await page.waitFor(`coverage.summary.groups.some(g => g.name === 'Fern Trail' && g.ways.length === 2)`, { what: 'one street of two pieces' });
  assert.equal(await page.eval(`[...document.querySelectorAll('.street-popup button')].length`), 0, 'the popup closes');

  await page.reload();
  await page.waitFor(`areas.some(a => a.id === ${id})`, { what: 'the area to load again' });
  await page.eval(`document.querySelector('#mode [data-mode=streets]').click(); setActiveArea('${id}')`);
  await page.waitFor(`coverage && activeArea.area.id === ${id}`, { what: 'the coverage again' });
  assert.deepEqual(await groups(), [['Fern Trail', 2], ['Test Road', 1]], 'kept on the server');
  assert.equal(await page.eval(`(streetPopup(2, L.latLng(49.30, -123.145)),
    [...document.querySelectorAll('.street-popup button')].some(b => /Name it|Rename/.test(b.textContent)))`), false,
    "OSM's own names can't be changed");

  await name(1, 'Rename', 'Moss Path');
  await page.waitFor(`coverage.summary.groups.some(g => g.name === 'Moss Path' && g.ways.length === 2)`, { what: 'both pieces renamed' });
  await name(0, 'Remove the name');
  await page.waitFor(`coverage.summary.groups.filter(g => g.name === '').length === 2`, { what: 'both names off' });
  assert.deepEqual(await page.eval(`Store.wayNames()`), {});

  await page.eval(`Store.deleteArea(${id})`);
  await page.reload();
  await page.waitFor(`!areas.length`, { what: 'the area to go' });
  await page.eval(`document.querySelector('#mode [data-mode=tracks]').click()`);
});

test('a virtual race: made from a route, then entered on its own page', { skip }, async () => {
  // A 1.4 km loop round a block, as a saved route.
  const loop = [[49.28, -123.12], [49.28, -123.1145], [49.2827, -123.1145], [49.2827, -123.12], [49.28, -123.12]];
  const legs = loop.slice(1).map((p, i) => [loop[i], p]);
  await page.eval(`Store.saveRoute({ name: 'Block loop', distance: 1400, data: { waypoints: ${JSON.stringify(loop)},
    legs: ${JSON.stringify(legs)}, straight: [false, false, false, false] } }).then(r => raceDialog({ route: r }))`);
  await page.waitFor(`document.getElementById('race-dialog').open`, { what: 'the race dialog' });
  assert.equal(await page.eval(`document.getElementById('race-dialog-name').value`), 'Block loop', "named for the route");
  page.answers.push(true);  // the prompt with the link
  await page.eval(`document.getElementById('race-dialog-name').value = 'Lunch loop'; document.getElementById('race-dialog-ok').click()`);
  await page.waitFor(`!document.getElementById('race-list').hidden`, { what: 'the race under Account' });
  assert.match(await page.eval(`document.getElementById('race-list').textContent`), /Lunch loop.*open.*0 times/);
  assert.match(page.dialogs.at(-1), /"Lunch loop" is ready/);
  const code = await page.eval(`Store.races().then(rs => rs[0].code)`);

  await page.goto(`${URL_BASE}race.html?code=${code}`);
  await page.waitFor(`document.getElementById('race-name').textContent === 'Lunch loop'`, { what: 'the race page' });
  assert.equal(await page.eval(`!document.getElementById('race-map').hidden && !!document.querySelector('#race-map .leaflet-interactive')`), true, 'the course on a map');
  assert.match(await page.eval(`document.getElementById('race-empty').textContent`), /No times yet/);
  // A run of it, a little while ago, at 2 s a point.
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'feets-race-')), 'Lunch run.gpx');
  const points = [];
  for (let i = 1; i < loop.length; i++) {
    for (let k = i === 1 ? 0 : 1; k <= 40; k++) points.push(loop[i - 1].map((v, j) => v + (loop[i][j] - v) * k / 40));
  }
  const from = Date.now() - 3600000;
  fs.writeFileSync(file, '<gpx><trk><trkseg>' + points.map(([la, lo], i) =>
    `<trkpt lat="${la.toFixed(7)}" lon="${lo.toFixed(7)}"><time>${new Date(from + i * 2000).toISOString()}</time></trkpt>`).join('') + '</trkseg></trk></gpx>');
  await page.setFiles('#race-file', [file]);
  await page.eval(`document.getElementById('race-runner').value = 'Sam'; document.getElementById('race-form').requestSubmit()`);
  const result = await page.waitFor(`(t => /^Your time/.test(t) && t)(document.getElementById('race-result').textContent)`, { what: 'a time' });
  assert.match(result, /^Your time: \d+:\d\d \(.+\/km\)\. That's 1st of 1\.$/);
  const rows = await page.eval(`[...document.querySelectorAll('#race-board tbody tr')].map(tr => [...tr.cells].map(td => td.textContent))`);
  assert.equal(rows.length, 1);
  assert.equal(rows[0][1], 'Sam (you)');
  assert.equal(rows[0][5], 'Remove', 'the host, logged in, can take times off');
  await snap('race');
  await page.goto(URL_BASE);
  await page.waitFor(`document.getElementById('auth').hidden`, { what: 'the app again' });
});

test('no errors on the page', { skip }, async () => {
  assert.deepEqual(page.errors.map(e => e.exception?.description || e.text), []);
});
