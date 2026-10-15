// Street coverage: which streets of an area (see osm.js) a set of tracks covers.
//
// Every street has a point at least every 20 m. A point is visited when a
// track passes within RADIUS metres of it, heading the same way (within
// MAX_ANGLE, either direction) - so crossing a street doesn't count it. When
// several streets are in range, only the nearest gets credit, which keeps a
// path from being ticked off by running the road right beside it. A street is
// done when DONE of its points are visited, which allows for GPS drift.
// Streets marked unrunnable are left out entirely: they get no credit, can't
// take credit from the street beside them, and don't count in the totals.
const Coverage = (() => {
  const RADIUS = 20;
  const CELL = 25;        // grid cell size in metres; must be >= RADIUS
  const STEP = 10;        // metres between samples along a track
  const MAX_ANGLE = 40 * Math.PI / 180;
  const DONE = 0.9;

  // Projects to metres on a flat plane centred on the area, and indexes
  // every street point in a grid. excludedIds: OSM way ids marked unrunnable.
  function prepare(area, excludedIds = new Set()) {
    const streets = area.data.streets;
    let n = 0, lat0 = 0, lon0 = 0;
    for (const s of streets) for (const r of s.runs) for (const [lat, lon] of r) { lat0 += lat; lon0 += lon; n++; }
    lat0 /= n || 1;
    lon0 /= n || 1;
    const kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const ky = 111320;

    const x = new Float64Array(n), y = new Float64Array(n), angle = new Float64Array(n), owner = new Int32Array(n);
    const first = new Int32Array(streets.length + 1);  // street w's points are first[w] .. first[w+1]-1
    const grid = new Map();
    let i = 0;
    streets.forEach((s, w) => {
      first[w] = i;
      for (const run of s.runs) {
        const start = i;
        for (const [lat, lon] of run) {
          x[i] = (lon - lon0) * kx;
          y[i] = (lat - lat0) * ky;
          owner[i] = w;
          i++;
        }
        // Direction at each point: along the street, from its neighbours.
        for (let k = start; k < i; k++) {
          const a = Math.max(start, k - 1), b = Math.min(i - 1, k + 1);
          angle[k] = Math.atan2(y[b] - y[a], x[b] - x[a]);
        }
      }
    });
    first[streets.length] = i;
    const excluded = new Uint8Array(streets.length);
    streets.forEach((s, w) => { excluded[w] = excludedIds.has(s.id) ? 1 : 0; });
    for (let k = 0; k < n; k++) {
      if (excluded[owner[k]]) continue;  // not in the grid, so never matched
      const key = cellKey(Math.floor(x[k] / CELL), Math.floor(y[k] / CELL));
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(k);
    }

    let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity;
    for (const s of streets) for (const r of s.runs) for (const [lat, lon] of r) {
      minLat = Math.min(minLat, lat); maxLat = Math.max(maxLat, lat);
      minLon = Math.min(minLon, lon); maxLon = Math.max(maxLon, lon);
    }
    const pad = 0.001;  // ~100 m
    return { area, excluded, lat0, lon0, kx, ky, x, y, angle, owner, first, grid, n,
             bounds: [minLat - pad, minLon - pad, maxLat + pad, maxLon + pad] };
  }

  const cellKey = (cx, cy) => cx * 1000003 + cy;

  function sameDirection(a, b) {
    let d = Math.abs(a - b) % Math.PI;
    return Math.min(d, Math.PI - d) < MAX_ANGLE;
  }

  // segmentsList: every track's segments, i.e. [[[lat, lon], ...], ...] per track.
  // Returns visited point flags and each street's visited fraction.
  function compute(prep, segmentsList) {
    const { x, y, angle, owner, grid, kx, ky, lat0, lon0, bounds } = prep;
    const visited = new Uint8Array(prep.n);
    const nearby = [];
    const r2 = RADIUS * RADIUS;

    function sample(sx, sy, heading) {
      const cx = Math.floor(sx / CELL), cy = Math.floor(sy / CELL);
      let best = -1, bestD = r2;
      nearby.length = 0;
      for (let gx = cx - 1; gx <= cx + 1; gx++) {
        for (let gy = cy - 1; gy <= cy + 1; gy++) {
          const cell = grid.get(cellKey(gx, gy));
          if (!cell) continue;
          for (const k of cell) {
            const dx = x[k] - sx, dy = y[k] - sy, d = dx * dx + dy * dy;
            if (d > r2 || !sameDirection(angle[k], heading)) continue;
            nearby.push(k);
            if (d < bestD) { bestD = d; best = k; }
          }
        }
      }
      if (best < 0) return;
      // Credit only the nearest street.
      for (const k of nearby) if (owner[k] === owner[best]) visited[k] = 1;
    }

    for (const segments of segmentsList) {
      for (const seg of segments) {
        for (let i = 1; i < seg.length; i++) {
          const [lat1, lon1] = seg[i - 1], [lat2, lon2] = seg[i];
          // Skip parts of the track nowhere near the area.
          if ((lat1 < bounds[0] && lat2 < bounds[0]) || (lat1 > bounds[2] && lat2 > bounds[2])
            || (lon1 < bounds[1] && lon2 < bounds[1]) || (lon1 > bounds[3] && lon2 > bounds[3])) continue;
          const ax = (lon1 - lon0) * kx, ay = (lat1 - lat0) * ky;
          const bx = (lon2 - lon0) * kx, by = (lat2 - lat0) * ky;
          const length = Math.hypot(bx - ax, by - ay);
          if (length === 0) continue;
          const heading = Math.atan2(by - ay, bx - ax);
          const steps = Math.ceil(length / STEP);
          for (let s = 0; s <= steps; s++) sample(ax + (bx - ax) * s / steps, ay + (by - ay) * s / steps, heading);
        }
      }
    }

    const streets = prep.area.data.streets;
    const fraction = new Float32Array(streets.length);
    for (let w = 0; w < streets.length; w++) {
      let count = 0;
      for (let k = prep.first[w]; k < prep.first[w + 1]; k++) count += visited[k];
      fraction[w] = count / Math.max(1, prep.first[w + 1] - prep.first[w]);
    }
    return { visited, fraction };
  }

  // prepare() for an area, kept until its unrunnable streets change. Shared
  // by Streets mode, achievements.js and route planning.
  const prepCache = new WeakMap();
  function prepared(area) {
    const key = JSON.stringify(area.excluded || []);
    const cached = prepCache.get(area);
    if (cached && cached.key === key) return cached.prep;
    const prep = prepare(area, new Set(area.excluded || []));
    prepCache.set(area, { key, prep });
    return prep;
  }

  // What segmentsList would add to an earlier compute() result: metres per
  // street (by OSM way id), each street's length times the extra share of its
  // points visited.
  function gain(prep, base, segmentsList) {
    const extra = compute(prep, segmentsList);
    const streets = prep.area.data.streets;
    const metres = new Map();
    for (let w = 0; w < streets.length; w++) {
      if (prep.excluded[w]) continue;
      let added = 0;
      for (let k = prep.first[w]; k < prep.first[w + 1]; k++) if (extra.visited[k] && !base.visited[k]) added++;
      if (added) metres.set(streets[w].id, streets[w].len * added / Math.max(1, prep.first[w + 1] - prep.first[w]));
    }
    return metres;
  }

  const isDone = f => f >= DONE;

  // Totals per category, overall and per neighbourhood, plus the groups the
  // "still to run" list is made of: a named street within one neighbourhood,
  // or a single unnamed way.
  function summarize(prep, result) {
    const { streets, hoods } = prep.area.data;
    const blank = () => ({ road: tally(), path: tally(), trail: tally() });
    const total = blank();
    const byHood = hoods.map(blank);
    const groups = new Map();
    streets.forEach((s, w) => {
      if (prep.excluded[w]) return;
      const f = result.fraction[w];
      for (const t of [total, byHood[s.hood]]) {
        if (!t) continue;
        const c = t[s.cat];
        c.len += s.len;
        c.covered += s.len * f;
      }
      const key = s.name ? `${s.cat}|${s.name}|${s.hood}` : `#${s.id}`;
      if (!groups.has(key)) groups.set(key, { name: s.name, cat: s.cat, hood: s.hood, ways: [], len: 0, covered: 0 });
      const g = groups.get(key);
      g.ways.push(w);
      g.len += s.len;
      g.covered += s.len * f;
    });
    // A street group counts as done when its visited share reaches DONE.
    for (const g of groups.values()) {
      g.done = g.len > 0 && isDone(g.covered / g.len);
      for (const t of [total, byHood[g.hood]]) {
        if (!t) continue;
        t[g.cat].streets++;
        if (g.done) t[g.cat].done++;
      }
    }
    return { total, byHood, groups: [...groups.values()] };
  }

  function tally() {
    return { len: 0, covered: 0, streets: 0, done: 0 };
  }

  return { prepare, prepared, compute, gain, summarize, isDone, RADIUS };
})();
