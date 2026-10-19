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
