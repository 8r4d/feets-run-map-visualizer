// Street data for coverage areas, fetched from OpenStreetMap's Overpass API
// straight from the browser: Overpass can take a couple of minutes when it's
// busy, longer than shared hosting lets PHP run. The prepared area is then
// stored on the server (Store.saveArea).
//
// An area is an OSM administrative boundary (e.g. a neighbourhood). Its data:
//   boundary: [[[lat, lon], ...], ...]   the boundary's member ways, as lines
//   hoods:    [{name, lines}]            finer boundaries inside it, e.g. neighbourhoods
//   streets:  [{id, name, cat, hood, len, runs}]
// where cat is road, path or trail, hood indexes hoods (-1 if none), len is in
// metres, and runs are the parts of the OSM way inside the boundary, with a
// point at least every SPACING metres.
const OSM = (() => {
  const SERVERS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];
  const SPACING = 20;
  const ROAD_TYPES = ['residential', 'living_street', 'unclassified', 'tertiary', 'secondary', 'primary'];
  const PATH_TYPES = ['footway', 'cycleway', 'path', 'pedestrian', 'track', 'bridleway'];
  const TRAIL_SURFACES = ['dirt', 'ground', 'earth', 'grass', 'mud', 'sand', 'woodchips', 'unpaved', 'rock', 'roots'];
  const LEVELS = '["boundary"="administrative"]["admin_level"~"^(7|8|9|10|11)$"]';

  // Runs a query, alternating between the main Overpass server and the
  // mirror, and waiting a little longer after each failure: when Overpass is
  // busy (HTTP 429 or 504) a retry a few seconds later often works.
  async function overpass(query, timeoutSeconds) {
    let problem = '';
    for (let attempt = 0; attempt < 4; attempt++) {
      if (attempt) await new Promise(resolve => setTimeout(resolve, attempt * 4000));
      const abort = new AbortController();
      const timer = setTimeout(() => abort.abort(), timeoutSeconds * 1000);
      try {
        const res = await fetch(SERVERS[attempt % SERVERS.length], {
          method: 'POST', body: new URLSearchParams({ data: query }), signal: abort.signal,
        });
        const data = res.ok ? await res.json() : null;
        // A busy server can answer 200 with a "runtime error" remark instead of data.
        if (data && !(data.remark || '').includes('error')) return data;
        problem = res.ok ? data.remark : `HTTP ${res.status}`;
      } catch (err) {
        problem = err.name === 'AbortError' ? 'timed out' : err.message;
      } finally {
        clearTimeout(timer);
      }
    }
    throw new Error(`OpenStreetMap's Overpass service is busy (${problem}). Try again in a minute.`);
  }

  function distance(lat1, lon1, lat2, lon2) {
    const dy = (lat2 - lat1) * 111320;
    const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot(dx, dy);
  }

  const round5 = x => Math.round(x * 1e5) / 1e5;

  // Point-in-polygon for a boundary given as its member ways, in any order.
  // Counting crossings over all of them works without joining them into
  // rings, and handles holes. Segments are bucketed into latitude bands so
  // each test only checks a few.
  function makePolygon(lines) {
    const p = { minLat: Infinity, maxLat: -Infinity, minLon: Infinity, maxLon: -Infinity, bands: 256 };
    for (const line of lines) {
      for (const [lat, lon] of line) {
        p.minLat = Math.min(p.minLat, lat);
        p.maxLat = Math.max(p.maxLat, lat);
        p.minLon = Math.min(p.minLon, lon);
        p.maxLon = Math.max(p.maxLon, lon);
      }
    }
    p.h = Math.max((p.maxLat - p.minLat) / p.bands, 1e-9);
    p.index = Array.from({ length: p.bands }, () => []);
    for (const line of lines) {
      for (let i = 1; i < line.length; i++) {
        const s = [line[i - 1][0], line[i - 1][1], line[i][0], line[i][1]];
        const lo = Math.max(0, Math.floor((Math.min(s[0], s[2]) - p.minLat) / p.h));
        const hi = Math.min(p.bands - 1, Math.floor((Math.max(s[0], s[2]) - p.minLat) / p.h));
        for (let b = lo; b <= hi; b++) p.index[b].push(s);
      }
    }
    return p;
  }

  function contains(p, lat, lon) {
    if (lat < p.minLat || lat > p.maxLat || lon < p.minLon || lon > p.maxLon) return false;
    const band = Math.min(p.bands - 1, Math.floor((lat - p.minLat) / p.h));
    let inside = false;
    for (const [lat1, lon1, lat2, lon2] of p.index[band]) {
      if ((lat1 > lat) !== (lat2 > lat) && lon < lon1 + (lat - lat1) * (lon2 - lon1) / (lat2 - lat1)) {
        inside = !inside;
      }
    }
    return inside;
  }

  // A boundary relation's member ways as [[lat, lon], ...] lines.
  function relationLines(relation) {
    const lines = [];
    for (const member of relation.members || []) {
      if (member.type !== 'way' || !['outer', 'inner', ''].includes(member.role)) continue;
      const line = (member.geometry || []).filter(Boolean).map(pt => [round5(pt.lat), round5(pt.lon)]);
      if (line.length >= 2) lines.push(line);
    }
    return lines;
  }

  // road, path, trail, or null for what doesn't count: sidewalks drawn beside
  // roads (running the road covers them), crossings, private ways, and
  // highway types not listed (motorways, alleys, driveways, parking aisles).
  function category(t) {
    const h = t.highway || '';
    const footOk = ['yes', 'designated', 'permissive'].includes(t.foot);
    if ((['private', 'no'].includes(t.access) && !footOk) || ['private', 'no'].includes(t.foot)
      || t.area === 'yes' || t.indoor === 'yes') return null;
    if (ROAD_TYPES.includes(h)) return 'road';
    if (!PATH_TYPES.includes(h)
      || ['sidewalk', 'crossing', 'traffic_island', 'access_aisle'].includes(t.footway)
      || ['sidewalk', 'crossing'].includes(t.path) || ['sidewalk', 'crossing'].includes(t.cycleway)) return null;
    return h === 'track' || t['mtb:scale'] !== undefined || TRAIL_SURFACES.includes(t.surface) ? 'trail' : 'path';
  }

  // Adds points so they're at most SPACING apart, and rounds to ~1 m.
  function densify(run) {
    const out = [[round5(run[0][0]), round5(run[0][1])]];
    for (let i = 1; i < run.length; i++) {
      const [lat1, lon1] = run[i - 1];
      const [lat2, lon2] = run[i];
      const steps = Math.ceil(distance(lat1, lon1, lat2, lon2) / SPACING);
      for (let k = 1; k <= steps; k++) {
        out.push([round5(lat1 + (lat2 - lat1) * k / steps), round5(lon1 + (lon2 - lon1) * k / steps)]);
      }
    }
    return out;
  }

  function linesCentre(lines) {
    let lat = 0, lon = 0, n = 0;
    for (const line of lines) for (const pt of line) { lat += pt[0]; lon += pt[1]; n++; }
    return [lat / n, lon / n];
  }

  // Administrative boundaries in or around a map view: [{osmId, name, level,
  // distance}], distance in metres from the middle of the view to the middle
  // of the boundary. Boundaries that merely touch the view count too, so
  // callers should prefer the nearest.
  async function candidates(south, west, north, east) {
    const bbox = [south, west, north, east].map(x => x.toFixed(5)).join(',');
    const [lat, lon] = [(south + north) / 2, (west + east) / 2];
    const result = await overpass(`[out:json][timeout:25];
      is_in(${lat.toFixed(5)},${lon.toFixed(5)})->.here;
      ( rel${LEVELS}(${bbox}); rel(pivot.here)${LEVELS}; );
      out tags center;`, 60);
    const found = new Map();
    for (const el of result.elements || []) {
      if (el.type === 'relation' && el.tags && el.tags.name && el.tags.admin_level && el.center) {
        found.set(el.id, {
          osmId: el.id, name: el.tags.name, level: Number(el.tags.admin_level),
          distance: Math.round(distance(lat, lon, el.center.lat, el.center.lon)),
        });
      }
    }
    return [...found.values()].sort((a, b) => a.distance - b.distance);
  }

  // The boundaries a point is inside: [{osmId, name, level}]. Lighter than
  // candidates(), for the background search for places you run (app.js).
  async function containing(lat, lon) {
    const result = await overpass(`[out:json][timeout:25];
      is_in(${lat.toFixed(5)},${lon.toFixed(5)})->.here;
      rel(pivot.here)${LEVELS};
      out tags;`, 60);
    return (result.elements || [])
      .filter(el => el.type === 'relation' && el.tags && el.tags.name && el.tags.admin_level)
      .map(el => ({ osmId: el.id, name: el.tags.name, level: Number(el.tags.admin_level) }));
  }

  // Whether a point is inside a stored area's boundary.
  const polygons = new WeakMap();
  function inArea(area, lat, lon) {
    if (!polygons.has(area)) polygons.set(area, makePolygon(area.data.boundary));
    return contains(polygons.get(area), lat, lon);
  }

  // Whether a point is inside neighbourhood h of a stored area (its data.hoods).
  const hoodPolygons = new WeakMap();
  function inHood(area, h, lat, lon) {
    if (!hoodPolygons.has(area)) hoodPolygons.set(area, area.data.hoods.map(hood => makePolygon(hood.lines)));
    return contains(hoodPolygons.get(area)[h], lat, lon);
  }

  // A boundary's outline, name and admin level. Nominatim (OSM's search
  // service) usually answers in about a second; Overpass is the fallback,
  // since it can take far longer for a single boundary.
  async function fetchBoundary(osmId) {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/lookup?osm_ids=R${osmId}&format=json&polygon_geojson=1&extratags=1`);
      const place = res.ok ? (await res.json())[0] : null;
      const geo = place && place.geojson;
      if (geo && (geo.type === 'Polygon' || geo.type === 'MultiPolygon')) {
        const polygons = geo.type === 'Polygon' ? [geo.coordinates] : geo.coordinates;
        // GeoJSON rings are [lon, lat]; any ring order works for makePolygon.
        const lines = polygons.flat().map(ring => ring.map(([lon, lat]) => [round5(lat), round5(lon)]));
        return { name: place.name, level: Number((place.extratags || {}).admin_level || 0), lines };
      }
    } catch (err) {
      // fall through to Overpass
    }
    const result = await overpass(`[out:json][timeout:60]; rel(${osmId}); out geom;`, 120);
    const relation = (result.elements || []).find(el => el.type === 'relation' && el.id === osmId);
    if (!relation) return null;
    return { name: relation.tags.name, level: Number(relation.tags.admin_level || 0), lines: relationLines(relation) };
  }

  // Fetches an area: { name, data } (see the top of this file).
  // onProgress gets short status messages. maxKm2: refuse a boundary whose
  // bounding box is bigger than this before fetching any streets (an error
  // whose message says "too big").
  async function buildArea(osmId, onProgress = () => {}, maxKm2 = Infinity) {
    // The boundary, then everything in its bounding box, trimmed to the
    // boundary here: much quicker than asking Overpass for everything inside
    // the boundary, which can take minutes.
    onProgress('Fetching the boundary from OpenStreetMap…');
    const found = await fetchBoundary(osmId);
    const boundary = found ? found.lines.filter(line => line.length >= 2) : [];
    if (!boundary.length) throw new Error('OpenStreetMap has no usable boundary with that id');
    const level = found.level;
    const area = makePolygon(boundary);
    const km2 = distance(area.minLat, area.minLon, area.maxLat, area.minLon) / 1000
      * distance(area.minLat, area.minLon, area.minLat, area.maxLon) / 1000;
    if (km2 > maxKm2) throw new Error(`${found.name || 'That area'} is too big (${Math.round(km2)} km²).`);

    onProgress('Fetching streets, paths and trails…');
    const bbox = [area.minLat, area.minLon, area.maxLat, area.maxLon].map(x => x.toFixed(5)).join(',');
    const finer = Array.from({ length: Math.max(0, 12 - level) }, (_, i) => level + 1 + i).join('|');
    const types = [...ROAD_TYPES, ...PATH_TYPES].join('|');
    const second = await overpass(`[out:json][timeout:120][bbox:${bbox}];
      rel["boundary"="administrative"]["admin_level"~"^(${finer || 'none'})$"];
      out geom;
      way["highway"~"^(${types})$"];
      out tags geom;`, 180);

    onProgress('Preparing streets…');
    // Neighbourhoods: of the finer boundary levels inside this area, the one
    // with the most boundaries (e.g. Edmonton's level 10 inside Riverbend).
    const byLevel = {};
    for (const el of second.elements || []) {
      if (el.type !== 'relation' || !el.tags || !el.tags.name) continue;
      const lines = relationLines(el);
      if (!lines.length || !contains(area, ...linesCentre(lines))) continue;
      (byLevel[el.tags.admin_level] = byLevel[el.tags.admin_level] || []).push({ name: el.tags.name, lines });
    }
    const hoods = Object.values(byLevel)
      .reduce((best, list) => (list.length > best.length ? list : best), [])
      .sort((a, b) => a.name.localeCompare(b.name));
    const hoodPolygons = hoods.map(h => makePolygon(h.lines));

    const streets = [];
    for (const way of second.elements || []) {
      if (way.type !== 'way') continue;
      const cat = category(way.tags || {});
      if (!cat) continue;
      // Keep the parts of the way inside the boundary.
      const runs = [];
      let run = [];
      for (const pt of way.geometry || []) {
        if (pt && contains(area, pt.lat, pt.lon)) {
          run.push([pt.lat, pt.lon]);
        } else if (run.length) {
          runs.push(run);
          run = [];
        }
      }
      if (run.length) runs.push(run);
      const kept = runs.filter(r => r.length >= 2).map(densify);
      if (!kept.length) continue;
      let len = 0;
      for (const r of kept) for (let i = 1; i < r.length; i++) len += distance(r[i - 1][0], r[i - 1][1], r[i][0], r[i][1]);
      const middle = kept[0][Math.floor(kept[0].length / 2)];
      const hood = hoodPolygons.findIndex(p => contains(p, middle[0], middle[1]));
      streets.push({ id: way.id, name: (way.tags && way.tags.name) || '', cat, hood, len: Math.round(len), runs: kept });
    }
    if (streets.length > 15000) throw new Error('That area is too big. Pick a smaller one, like a neighbourhood.');
    return { name: found.name || `OSM area ${osmId}`, data: { boundary, hoods, streets } };
  }

  // The country and town a point is in, from Nominatim's reverse lookup:
  // { cc (two letters, lower case), country, town } (town '' when there's
  // none), or null where it can't say (out at sea, say). For cards.js's
  // Passport and Places; app.js keeps each run's answer, so a run is only
  // looked up once.
  async function place(lat, lon) {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=10&addressdetails=1`
      + `&lat=${lat.toFixed(4)}&lon=${lon.toFixed(4)}&accept-language=en`);
    if (!res.ok) throw new Error(`OpenStreetMap's place lookup answered ${res.status}`);
    const a = (await res.json()).address;
    if (!a || !a.country_code) return null;
    return { cc: a.country_code.toLowerCase(), country: a.country || a.country_code.toUpperCase(),
      town: a.city || a.town || a.village || a.municipality || a.hamlet || a.county || '' };
  }

  return { candidates, containing, inArea, inHood, buildArea, place };
})();
