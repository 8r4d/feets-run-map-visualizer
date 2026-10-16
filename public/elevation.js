// Elevation: profiles for planned routes, and the small chart that shows a
// profile (a track's comes from api.php, worked out from its GPX).
// A profile is [[km, metres], ...] along the line.
//
// Routes have no elevations of their own, so they're looked up from
// Open-Meteo's free elevation API (a ~90 m terrain model, no key needed):
// points every 50 m or so, up to 100 per request. Its free tier has a daily
// limit per address, and every point counts towards it, so points are
// snapped to a GRID and each one's height is kept in this browser
// (localStorage): later edits, and other routes nearby, mostly ask for
// nothing new. Heights it can't get (over the limit, offline) are estimated
// from the ones either side.
const Elevation = (() => {
  const API = 'https://api.open-meteo.com/v1/elevation';
  const STEP = 50;          // metres between looked-up points
  const MAX_POINTS = 300;   // per route, so a long one is 3 requests
  const CLIMB_STEP = 2;     // metres: the terrain model is smooth, so less than api.php's 3
  const GRID = 0.0005;      // degrees: ~55 m north-south, still finer than the terrain model
  const STORE = 'feets-elevation', STORE_MAX = 20000;  // ~20k heights is ~0.5 MB

  // "lat,lon" of a grid point -> metres, oldest first.
  const cache = (() => {
    try { return new Map(JSON.parse(localStorage.getItem(STORE)) || []); } catch { return new Map(); }
  })();
  function save() {
    try { localStorage.setItem(STORE, JSON.stringify([...cache].slice(-STORE_MAX))); } catch {}
  }

  function distance([lat1, lon1], [lat2, lon2]) {
    const dy = (lat2 - lat1) * 111320;
    const dx = (lon2 - lon1) * 111320 * Math.cos((lat1 + lat2) / 2 * Math.PI / 180);
    return Math.sqrt(dx * dx + dy * dy);
  }

  // Points at equal steps along a line: [{ at (metres), p: [lat, lon] }].
  function samples(points) {
    const along = [0];
    for (let i = 1; i < points.length; i++) along.push(along[i - 1] + distance(points[i - 1], points[i]));
    const length = along[along.length - 1];
    const n = Math.min(MAX_POINTS, Math.max(2, Math.ceil(length / STEP) + 1));
    const out = [];
    let k = 0;
    for (let s = 0; s < n; s++) {
      const at = length * s / (n - 1);
      while (k < points.length - 2 && along[k + 1] < at) k++;
      const span = along[k + 1] - along[k];
      const f = span > 0 ? Math.min(1, (at - along[k]) / span) : 0;
      const [a, b] = [points[k], points[k + 1]];
      out.push({ at, p: [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f] });
    }
    return out;
  }

  const snap = v => (Math.round(v / GRID) * GRID).toFixed(4);
  const key = ([lat, lon]) => `${snap(lat)},${snap(lon)}`;

  // Heights of points, from the cache or Open-Meteo: { metres, error }, with
  // undefined in metres for any it couldn't get, and why in error.
  async function lookUp(points) {
    const keys = points.map(key);
    const missing = [...new Set(keys)].filter(k => !cache.has(k));
    let error = null;
    for (let i = 0; i < missing.length && !error; i += 100) {
      const chunk = missing.slice(i, i + 100).map(k => k.split(','));
      const url = `${API}?latitude=${chunk.map(c => c[0]).join(',')}&longitude=${chunk.map(c => c[1]).join(',')}`;
      try {
        const res = await fetch(url);
        if (res.status === 429) throw new Error("the elevation service's free daily limit is used up");
        if (!res.ok) throw new Error(`the elevation service answered ${res.status}`);
        const { elevation } = await res.json();
        chunk.forEach((c, j) => { if (Number.isFinite(elevation[j])) cache.set(c.join(','), elevation[j]); });
      } catch (err) {
        error = err.message.startsWith('the elevation') ? err : new Error("the elevation service couldn't be reached");
      }
    }
    if (missing.length) save();
    return { metres: keys.map(k => cache.get(k)), error };
  }

  // Fills in missing heights (undefined) along the line: straight between the
  // known ones either side, or level with the nearest at the ends. at: each
  // point's distance along. Returns how many were filled in, or -1 if none were known.
  function fill(metres, at) {
    const known = metres.map((m, i) => (m === undefined ? -1 : i)).filter(i => i >= 0);
    if (!known.length) return -1;
    let filled = 0, k = 0;
    for (let i = 0; i < metres.length; i++) {
      if (metres[i] !== undefined) continue;
      while (k < known.length - 1 && known[k + 1] < i) k++;
      const a = known[k] < i ? known[k] : null;
      const b = known.find(j => j > i);
      metres[i] = a === null ? metres[b] : b === undefined ? metres[a]
        : metres[a] + (metres[b] - metres[a]) * (at[i] - at[a]) / (at[b] - at[a]);
      filled++;
    }
    return filled;
  }

  // Metres climbed: only rises of `step` or more count, so noise doesn't add up.
  function climb(metres, step = CLIMB_STEP) {
    let total = 0;
    let ref = metres[0];
    for (const v of metres) {
      if (v - ref >= step) {
        total += v - ref;
        ref = v;
      } else if (ref - v >= step) {
        ref = v;
      }
    }
    return total;
  }

  // A route's elevation: resolves to { profile, climb, estimated }, where
  // estimated is the share of heights filled in (0 when all were looked up)
  // and why, if any were. Rejects if no heights at all could be had.
  async function forRoute(points) {
    const s = samples(points);
    const { metres, error } = await lookUp(s.map(x => x.p));
    const filled = fill(metres, s.map(x => x.at));
    if (filled < 0) throw error || new Error('no heights found');
    return {
      profile: s.map((x, i) => [Math.round(x.at) / 1000, Math.round(metres[i] * 10) / 10]),
      climb: Math.round(climb(metres)),
      estimated: filled / metres.length,
      ...(filled && error ? { why: error.message } : {}),
    };
  }

  // --- Chart ---
  const SVG = 'http://www.w3.org/2000/svg';
  const W = 260, H = 84, LEFT = 34, BOTTOM = 14, TOP = 4;

  function el(name, attrs = {}) {
    const node = document.createElementNS(SVG, name);
    for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
    return node;
  }

  // An SVG chart of a profile, with the lowest and highest points marked and
  // a readout of the height under the pointer. Styled by .elevation in style.css.
  function chart(profile) {
    const km = profile[profile.length - 1][0] || 1;
    const heights = profile.map(p => p[1]);
    let lo = Math.min(...heights), hi = Math.max(...heights);
    // At least 20 m of range, so a flat route looks flat.
    if (hi - lo < 20) {
      const mid = (hi + lo) / 2;
      lo = mid - 10;
      hi = mid + 10;
    }
    const x = d => LEFT + (d / km) * (W - LEFT - 2);
    const y = m => TOP + (1 - (m - lo) / (hi - lo)) * (H - TOP - BOTTOM);
    const line = profile.map(([d, m], i) => `${i ? 'L' : 'M'}${x(d).toFixed(1)},${y(m).toFixed(1)}`).join('');

    const svg = el('svg', { class: 'elevation', viewBox: `0 0 ${W} ${H}`, role: 'img' });
    svg.setAttribute('aria-label', `Elevation: ${Math.round(Math.min(...heights))} to ${Math.round(Math.max(...heights))} m over ${km.toFixed(1)} km`);
    svg.append(
      el('path', { class: 'area', d: `${line}L${x(km).toFixed(1)},${H - BOTTOM}L${LEFT},${H - BOTTOM}Z` }),
      el('path', { class: 'line', d: line }),
      el('line', { class: 'axis', x1: LEFT, x2: W - 2, y1: H - BOTTOM, y2: H - BOTTOM }),
    );
    const label = (text, attrs) => {
      const t = el('text', attrs);
      t.textContent = text;
      svg.append(t);
      return t;
    };
    label(`${Math.round(hi)} m`, { x: LEFT - 4, y: TOP + 8, 'text-anchor': 'end' });
    label(`${Math.round(lo)} m`, { x: LEFT - 4, y: H - BOTTOM, 'text-anchor': 'end' });
    label('0', { x: LEFT, y: H - 2 });
    label(`${km.toFixed(1)} km`, { x: W - 2, y: H - 2, 'text-anchor': 'end' });

    // Pointer readout: a line at the nearest point and its distance and height.
    const cursor = el('line', { class: 'cursor', y1: TOP, y2: H - BOTTOM, visibility: 'hidden' });
    const readout = label('', { class: 'readout', x: W - 2, y: TOP + 8, 'text-anchor': 'end' });
    svg.append(cursor);
    svg.addEventListener('pointermove', e => {
      const box = svg.getBoundingClientRect();
      const d = Math.max(0, Math.min(km, ((e.clientX - box.left) / box.width * W - LEFT) / (W - LEFT - 2) * km));
      const [pd, pm] = profile.reduce((b, p) => (Math.abs(p[0] - d) < Math.abs(b[0] - d) ? p : b));
      cursor.setAttribute('x1', x(pd));
      cursor.setAttribute('x2', x(pd));
      cursor.setAttribute('visibility', 'visible');
      readout.textContent = `${pd.toFixed(1)} km · ${Math.round(pm)} m`;
    });
    svg.addEventListener('pointerleave', () => {
      cursor.setAttribute('visibility', 'hidden');
      readout.textContent = '';
    });
    return svg;
  }

  return { forRoute, chart, climb };
})();
