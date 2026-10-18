// Segments: short stretches you time yourself on, like a favourite climb or a
// fast straight. A segment is cut from one of your activities (its points,
// [[lat, lon], ...], in the direction you went); an effort is any time an
// on-foot activity went from its start to its end, along it.
//
// Finding efforts is done in two steps, so most activities are ruled out
// cheaply: candidate() checks an activity's stored (simplified) line passes
// near both ends and follows most of the segment; only then are its timed
// points fetched and efforts() looks for each pass, start to end, timing it.
const Segments = (() => {
  const NEAR = 30;      // metres: passing this close to a segment's start or end counts
  const FOLLOW = 0.8;   // share of a segment an effort must stay along...
  const STRAY = 40;     // ... within this many metres
  const LENGTH = [0.85, 1.4];  // an effort's distance, as a share of the segment's
  const STEP = 10;      // metres between the points lines are compared at
  const MIN = 100;      // metres: shorter segments aren't worth timing
  const MAX = 20000;
  const CELL = STRAY;   // grid cell for finding nearby points

  const gap = (a, b) => Planner.distance(a[0], a[1], b[0], b[1]);

  // A line's length in metres.
  function length(points) {
    let m = 0;
    for (let i = 1; i < points.length; i++) m += gap(points[i - 1], points[i]);
    return m;
  }

  // Points every STEP metres along a line.
  function dense(points) {
    const out = [points[0]];
    for (let i = 1; i < points.length; i++) {
      const d = gap(points[i - 1], points[i]);
      const n = Math.ceil(d / STEP);
      for (let k = 1; k <= n; k++) {
        const f = k / n;
        out.push([points[i - 1][0] + (points[i][0] - points[i - 1][0]) * f, points[i - 1][1] + (points[i][1] - points[i - 1][1]) * f]);
      }
    }
    return out;
  }

  // Whether a point is within `radius` of a line: a function, from a grid of
  // the line's dense points.
  function nearLine(points, radius = STRAY) {
    const lat0 = points[0][0], ky = 111320, kx = 111320 * Math.cos(lat0 * Math.PI / 180);
    const key = (la, lo) => `${Math.floor(la * ky / CELL)},${Math.floor(lo * kx / CELL)}`;
    const grid = new Map();
    for (const p of dense(points)) {
      const k = key(p[0], p[1]);
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(p);
    }
    const reach = Math.ceil(radius / CELL);
    return ([la, lo]) => {
      const cy = Math.floor(la * ky / CELL), cx = Math.floor(lo * kx / CELL);
      for (let y = cy - reach; y <= cy + reach; y++) {
        for (let x = cx - reach; x <= cx + reach; x++) {
          for (const q of grid.get(`${y},${x}`) || []) if (gap([la, lo], q) <= radius) return true;
        }
      }
      return false;
    };
  }

  // Whether a track's stored line might have efforts on a segment: it passes
  // near the start and the end, and follows most of the segment.
  function candidate(segment, track) {
    const lines = track.segments.filter(s => s.length > 1);
    if (!lines.length) return false;
    const start = segment.points[0], end = segment.points[segment.points.length - 1];
    const all = lines.flat();
    // A quick look at the line's bounds first.
    let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const [la, lo] of all) { if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo; }
    const pad = 0.001;
    const inside = ([la, lo]) => la > s - pad && la < n + pad && lo > w - pad && lo < e + pad;
    if (!inside(start) || !inside(end)) return false;
    const onTrack = lines.map(l => nearLine(l, STRAY + NEAR));
    const near = p => onTrack.some(f => f(p));
    if (!near(start) || !near(end)) return false;
    const along = dense(segment.points);
    return along.filter(near).length >= along.length * FOLLOW;
  }

  // Every pass of an activity along a segment: [[start (Unix seconds),
  // seconds], ...]. timed: the activity's points, [[lat, lon, segment, time], ...].
  function efforts(segment, timed) {
    const pts = timed.filter(p => p[3] != null);
    if (pts.length < 2) return [];
    const start = segment.points[0], end = segment.points[segment.points.length - 1];
    const L = segment.distance || length(segment.points);
    const onSegment = nearLine(segment.points);
    const along = dense(segment.points);
    const found = [];
    let i = 0;
    while (i < pts.length) {
      if (gap(pts[i], start) > NEAR) { i++; continue; }
      // The closest approach to the start, in this pass by it.
      let a = i;
      while (i < pts.length && gap(pts[i], start) <= NEAR) {
        if (gap(pts[i], start) < gap(pts[a], start)) a = i;
        i++;
      }
      // Then on to the end, if it gets there within reason.
      let d = 0, j = a + 1, b = -1;
      for (; j < pts.length; j++) {
        d += gap(pts[j - 1], pts[j]);
        if (d > L * LENGTH[1]) break;
        if (gap(pts[j], end) <= NEAR) {
          b = j;
          while (j + 1 < pts.length && gap(pts[j + 1], end) <= NEAR) {
            j++;
            if (gap(pts[j], end) < gap(pts[b], end)) b = j;
          }
          break;
        }
      }
      if (b < 0) continue;
      const path = pts.slice(a, b + 1);
      const metres = length(path);
      const onPath = nearLine(path.map(p => [p[0], p[1]]));
      // Along the segment (not a short cut), and the whole of it (not just its ends).
      if (metres >= L * LENGTH[0] && metres <= L * LENGTH[1]
        && path.filter(onSegment).length >= path.length * FOLLOW
        && along.filter(onPath).length >= along.length * FOLLOW) {
        found.push([pts[a][3], pts[b][3] - pts[a][3]]);
        i = b + 1;
      } else {
        i = a + 1;
      }
    }
    return found.filter(([, s]) => s > 0);
  }

  // A segment cut from an activity's points, from index `from` to `to`:
  // { points, distance }, thinned to a point every few metres.
  function cut(timed, from, to) {
    const [a, b] = from < to ? [from, to] : [to, from];
    const points = [];
    for (let i = a; i <= b; i++) {
      const p = [timed[i][0], timed[i][1]];
      if (!points.length || i === b || gap(points[points.length - 1], p) >= 5) points.push(p);
    }
    return { points, distance: length(points) };
  }

  return { NEAR, MIN, MAX, candidate, efforts, cut, length };
})();
