// The real page in headless Chrome: logging in, adding GPX, FIT and TCX
// files, miles, and dark mode. Skipped without Chrome (see chrome.mjs).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { URL_BASE, member, fixture } from './lib.mjs';
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

test('no errors on the page', { skip }, async () => {
  assert.deepEqual(page.errors.map(e => e.exception?.description || e.text), []);
});
