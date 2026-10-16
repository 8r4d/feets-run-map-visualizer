// Route planning on the streets of your coverage areas (see osm.js), with no
// routing service: the areas' streets become a graph, and routes are the
// shortest paths through it.
//
// Points are rounded to ~1 m by osm.js, so where two OSM ways share a node
// they share a point here too, and that's where the graph joins them.
// Crossings and sidewalks aren't in the area data, so the end of a run is
// also joined to any street within BRIDGE metres, and a way cut up by area
// boundaries is joined back together (see build). Streets marked unrunnable
// are left out.
const Planner = (() => {
  const SNAP = 150;   // metres: a click must be this close to a street
  const BRIDGE = 15;  // metres: run ends this close to another street are joined
  const GAP = 500;    // metres: the most a way's pieces cut by a boundary are joined across
  const CELL = 50;    // grid cell size in metres for finding nearby points

  function distance(lat1, lon1, lat2, lon2) {
    const dy = (lat2 - lat1) * 111320;
    const dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * Math.PI / 180);
    return Math.hypot(dx, dy);
  }

  // Grid cells are about CELL metres square wherever the areas are.
  const cellOf = (lat, lon) => [
    Math.floor(lat * 111320 / CELL),
    Math.floor(lon * 111320 * Math.cos(lat * Math.PI / 180) / CELL),
  ];

  // areas: as from Store.areas(). The graph: point coordinates, and for each
  // point a flat list of [neighbour, metres, neighbour, metres, ...].
  function build(areas) {
    const index = new Map();
    const lat = [], lon = [], adj = [];
    const node = ([a, b]) => {
      const key = a + ',' + b;
      let i = index.get(key);
      if (i === undefined) {
        i = lat.length;
        index.set(key, i);
        lat.push(a);
        lon.push(b);
        adj.push([]);
      }
      return i;
    };
    const link = (a, b) => {
      const d = distance(lat[a], lon[a], lat[b], lon[b]);
      adj[a].push(b, d);
      adj[b].push(a, d);
    };

    const ends = [];
    const pieces = new Map();  // OSM way id -> [{ start, end }] of its runs, from every area
    const seen = new Set();
    for (const area of areas) {
      const excluded = new Set(area.excluded || []);
      for (const s of area.data.streets) {
        if (excluded.has(s.id)) continue;
        for (const run of s.runs) {
          const start = node(run[0]);
          const end = node(run[run.length - 1]);
          // Overlapping areas (a district and a neighbourhood in it) repeat runs.
          const key = `${s.id}:${start}:${end}:${run.length}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let prev = start;
          for (let i = 1; i < run.length; i++) {
            const cur = node(run[i]);
            if (cur !== prev) link(prev, cur);
            prev = cur;
          }
          ends.push(start, end);
          if (!pieces.has(s.id)) pieces.set(s.id, []);
          pieces.get(s.id).push({ start, end });
        }
      }
    }

    const grid = new Map();
    for (let i = 0; i < lat.length; i++) {
      const key = cellOf(lat[i], lon[i]).join(',');
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    const graph = { lat, lon, adj, grid };

    const linked = (a, b) => adj[a].some((n, k) => k % 2 === 0 && n === b);
    for (const e of new Set(ends)) {
      for (const i of near(graph, lat[e], lon[e], BRIDGE)) {
        if (i !== e && !linked(e, i)) link(e, i);
      }
    }

    // A way crossing an area boundary loses the piece between its last point
    // inside and its first point outside, which on a long straight road can
    // be hundreds of metres; a road along the boundary gets chopped up. An OSM
    // way is straight between its points, and its points keep their order in
    // every area, so each piece's end is joined to the nearest start of
    // another piece of the same way.
    for (const list of pieces.values()) {
      for (const a of list) {
        let best = -1, bestD = GAP;
        for (const b of list) {
          if (b === a || b.start === a.end) continue;
          const d = distance(lat[a.end], lon[a.end], lat[b.start], lon[b.start]);
          if (d < bestD) { bestD = d; best = b.start; }
        }
        if (best >= 0 && !linked(a.end, best)) link(a.end, best);
      }
    }
    return graph;
  }

  // Points within radius metres of lat, lon.
  function near(graph, la, lo, radius) {
    const [cy, cx] = cellOf(la, lo);
    const reach = Math.ceil(radius / CELL);
    const found = [];
    for (let y = cy - reach; y <= cy + reach; y++) {
      for (let x = cx - reach; x <= cx + reach; x++) {
        for (const i of graph.grid.get(y + ',' + x) || []) {
          if (distance(la, lo, graph.lat[i], graph.lon[i]) <= radius) found.push(i);
        }
      }
    }
    return found;
  }

  // The nearest point on a street to [lat, lon], or -1 if none is within SNAP.
  function snap(graph, [la, lo]) {
    let best = -1, bestD = Infinity;
    for (const i of near(graph, la, lo, SNAP)) {
      const d = distance(la, lo, graph.lat[i], graph.lon[i]);
      if (d < bestD) { bestD = d; best = i; }
    }
    return best;
  }

  // Shortest path between two points (A*). Returns [[lat, lon], ...] and its
  // length in metres, or null if the streets don't connect them.
  function route(graph, from, to) {
    const { lat, lon, adj } = graph;
    if (from === to) return { points: [[lat[from], lon[from]]], metres: 0 };
    const cost = new Map([[from, 0]]);
    const came = new Map();
    const done = new Set();
    const heap = new Heap();
    heap.push(from, distance(lat[from], lon[from], lat[to], lon[to]));
    while (heap.size) {
      const n = heap.pop();
      if (n === to) break;
      if (done.has(n)) continue;
      done.add(n);
      const base = cost.get(n);
      const edges = adj[n];
      for (let k = 0; k < edges.length; k += 2) {
        const m = edges[k], c = base + edges[k + 1];
        if (c < (cost.get(m) ?? Infinity)) {
          cost.set(m, c);
          came.set(m, n);
          heap.push(m, c + distance(lat[m], lon[m], lat[to], lon[to]));
        }
      }
    }
    if (!cost.has(to)) return null;
    const points = [];
    for (let n = to; n !== undefined; n = came.get(n)) points.push([lat[n], lon[n]]);
    return { points: points.reverse(), metres: cost.get(to) };
  }

  // Waypoints on the streets that retrace a recorded run: its corners (where
  // the line turns by more than TURN metres, by Douglas-Peucker) plus a point
  // at least every STEP metres, so the shortest path between neighbours keeps
  // to the way it went. Points not near a street are left out; if the run
  // ends near where it started, the route ends exactly at its start.
  // points: [[lat, lon], ...]. Returns [[lat, lon], ...] of street points.
  const TURN = 25, STEP = 250, LOOP = 50;
  function trace(graph, points) {
    if (!points.length) return [];
    // Flat metres around the first point are close enough for a run.
    const [la0, lo0] = points[0];
    const kx = 111320 * Math.cos(la0 * Math.PI / 180);
    const xy = points.map(([la, lo]) => [(lo - lo0) * kx, (la - la0) * 111320]);
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      const [ax, ay] = xy[a], [bx, by] = xy[b];
      const len = Math.hypot(bx - ax, by - ay);
      let far = -1, farD = TURN;
      for (let i = a + 1; i < b; i++) {
        const [px, py] = xy[i];
        const d = len ? Math.abs((bx - ax) * (ay - py) - (ax - px) * (by - ay)) / len : Math.hypot(px - ax, py - ay);
        if (d > farD) { farD = d; far = i; }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([a, far], [far, b]);
      }
    }
    let run = 0;
    for (let i = 1; i < points.length; i++) {
      run += Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]);
      if (run >= STEP) keep[i] = 1;
      if (keep[i]) run = 0;
    }

    const nodes = [];
    for (let i = 0; i < points.length; i++) {
      if (!keep[i]) continue;
      const n = snap(graph, points[i]);
      if (n >= 0 && n !== nodes[nodes.length - 1]) nodes.push(n);
    }
    const out = nodes.map(n => [graph.lat[n], graph.lon[n]]);
    const first = points[0], last = points[points.length - 1];
    if (out.length > 1 && distance(...first, ...last) < LOOP) {
      out[out.length - 1] = [...out[0]];
    }
    return out;
  }

  // A binary min-heap of ids by priority.
  class Heap {
    constructor() { this.ids = []; this.keys = []; }
    get size() { return this.ids.length; }
    push(id, key) {
      const { ids, keys } = this;
      let i = ids.length;
      ids.push(id);
      keys.push(key);
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (keys[p] <= keys[i]) break;
        [ids[p], ids[i]] = [ids[i], ids[p]];
        [keys[p], keys[i]] = [keys[i], keys[p]];
        i = p;
      }
    }
    pop() {
      const { ids, keys } = this;
      const top = ids[0];
      const lastId = ids.pop(), lastKey = keys.pop();
      if (ids.length) {
        ids[0] = lastId;
        keys[0] = lastKey;
        let i = 0;
        for (;;) {
          const l = 2 * i + 1, r = l + 1;
          let m = i;
          if (l < ids.length && keys[l] < keys[m]) m = l;
          if (r < ids.length && keys[r] < keys[m]) m = r;
          if (m === i) break;
          [ids[m], ids[i]] = [ids[i], ids[m]];
          [keys[m], keys[i]] = [keys[i], keys[m]];
          i = m;
        }
      }
      return top;
    }
  }

  // A route as a GPX file, for a watch or Strava.
  function gpx(name, points) {
    const esc = s => s.replace(/[<>&"]/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;' }[c]));
    const pts = points.map(([la, lo]) => `      <trkpt lat="${la}" lon="${lo}"></trkpt>`).join('\n');
    return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="feets" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${esc(name)}</name>
    <trkseg>
${pts}
    </trkseg>
  </trk>
</gpx>
`;
  }

  return { build, snap, route, trace, distance, gpx };
})();
