// Route planning on the streets of your coverage areas (see osm.js), with no
// routing service: the areas' streets become a graph, and routes are the
// shortest paths through it.
//
// Points are rounded to ~1 m by osm.js, so where two OSM ways share a node
// they share a point here too, and that's where the graph joins them.
// Crossings and sidewalks aren't in the area data, so the end of a run is
// also joined to any street within BRIDGE metres, and a way cut up by area
// boundaries is joined back together (see build). Streets marked unrunnable
// stay in, so a route can still use the parts of them you can run, but cost
// AVOID times their length unless the route says otherwise (see route).
const Planner = (() => {
  const SNAP = 150;   // metres: a click must be this close to a street
  const BRIDGE = 15;  // metres: run ends this close to another street are joined
  const GAP = 500;    // metres: the most a way's pieces cut by a boundary are joined across
  const CELL = 50;    // grid cell size in metres for finding nearby points
  const AVOID = 3;    // an unrunnable street is taken only if going round is this many times longer

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
  // point a flat list of [neighbour, metres, unrunnable, neighbour, ...].
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
    const link = (a, b, unrunnable = false) => {
      const d = distance(lat[a], lon[a], lat[b], lon[b]);
      adj[a].push(b, d, unrunnable);
      adj[b].push(a, d, unrunnable);
    };

    const ends = [];
    const pieces = new Map();  // OSM way id -> [{ start, end }] of its runs, from every area
    const seen = new Set();
    // Unrunnable in any area is unrunnable here, as overlapping areas share runs.
    const excluded = new Set(areas.flatMap(a => a.excluded || []));
    for (const area of areas) {
      for (const s of area.data.streets) {
        const unrunnable = excluded.has(s.id);
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
            if (cur !== prev) link(prev, cur, unrunnable);
            prev = cur;
          }
          ends.push(start, end);
          if (!pieces.has(s.id)) pieces.set(s.id, []);
          pieces.get(s.id).push({ start, end, unrunnable });
        }
      }
    }

    const grid = new Map();
    for (let i = 0; i < lat.length; i++) {
      const key = cellOf(lat[i], lon[i]).join(',');
      if (!grid.has(key)) grid.set(key, []);
      grid.get(key).push(i);
    }
    const graph = { lat, lon, adj, grid, index };

    const linked = (a, b) => adj[a].some((n, k) => k % 3 === 0 && n === b);
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
        if (best >= 0 && !linked(a.end, best)) link(a.end, best, a.unrunnable);
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

  // Shortest path between two points (A*), counting unrunnable streets as
  // AVOID times longer unless avoid is false. Returns [[lat, lon], ...] and
  // its length in metres, or null if the streets don't connect them.
  function route(graph, from, to, avoid = true) {
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
      for (let k = 0; k < edges.length; k += 3) {
        const m = edges[k], c = base + edges[k + 1] * (avoid && edges[k + 2] ? AVOID : 1);
        if (c < (cost.get(m) ?? Infinity)) {
          cost.set(m, c);
          came.set(m, n);
          heap.push(m, c + distance(lat[m], lon[m], lat[to], lon[to]));
        }
      }
    }
    if (!cost.has(to)) return null;
    const points = [];
    let metres = 0;
    for (let n = to; n !== undefined; n = came.get(n)) {
      if (came.has(n)) metres += distance(lat[n], lon[n], lat[came.get(n)], lon[came.get(n)]);
      points.push([lat[n], lon[n]]);
    }
    return { points: points.reverse(), metres };
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

  // --- Exploring: a loop over streets you haven't run ---

  const USED = 1.5;   // a street the route already ran counts this much longer, so it tries new ways back
  const FRESH = 0.7;  // and one not run yet counts this much shorter, so getting about picks some up too

  // Dijkstra from `from`, over points reachable within `limit` cost. Cost is
  // metres, times AVOID on unrunnable streets, USED on edges in `used`, and
  // FRESH between two points flagged in `fresh`. Returns cost, real metres
  // and the previous point on each best path.
  function search(graph, from, limit, used, fresh) {
    const { adj } = graph;
    const n = graph.lat.length;
    const cost = new Float64Array(n).fill(Infinity);
    const metres = new Float64Array(n).fill(Infinity);
    const prev = new Int32Array(n).fill(-1);
    cost[from] = 0;
    metres[from] = 0;
    const heap = new Heap();
    heap.push(from, 0);
    while (heap.size) {
      const a = heap.pop();
      const base = cost[a];
      if (base > limit) break;
      const edges = adj[a];
      for (let k = 0; k < edges.length; k += 3) {
        const b = edges[k];
        let c = edges[k + 1];
        if (edges[k + 2]) c *= AVOID;
        if (used && used.has(edgeKey(a, b, n))) c *= USED;
        else if (fresh && fresh[a] && fresh[b]) c *= FRESH;
        if (base + c < cost[b]) {
          cost[b] = base + c;
          metres[b] = metres[a] + edges[k + 1];
          prev[b] = a;
          heap.push(b, base + c);
        }
      }
    }
    return { cost, metres, prev };
  }

  const edgeKey = (a, b, n) => (a < b ? a * n + b : b * n + a);

  // The points from search()'s start to `to`, in order.
  function pathTo(prev, to) {
    const path = [];
    for (let i = to; i >= 0; i = prev[i]) path.push(i);
    return path.reverse();
  }

  // A loop from `start` (a graph point) back to it, of at most `budget`
  // metres, that runs as many of `chains` as it can. Each chain is a list of
  // neighbouring graph points along a street not yet run, e.g. from
  // Planner.chains. Greedy: from where it is, it goes for the chain with the
  // most new street per metre of getting there and along it, as long as it
  // can still get home; then the next, until none fits. Going out too far
  // can leave only the same way back, so it's tried with a few shorter
  // reaches and the loop with the most new street wins. Calls
  // `progress(try, tries)` before each and yields to the browser between chains.
  // Resolves to { waypoints, legs, metres, fresh } (a waypoint at each
  // chain's ends, as for a drawn route), or null if no chain fits.
  const REACHES = [1, 0.9, 0.8, 0.7];

  async function explore(graph, start, chains, budget, progress = () => {}) {
    const home = search(graph, start, budget / 2, null).metres;  // nothing further than halfway is any use
    let best = null;
    for (const [i, reach] of REACHES.entries()) {
      progress(i + 1, REACHES.length);
      const loop = await greedy(graph, start, chains, budget, budget * reach, home);
      if (loop && (!best || loop.fresh > best.fresh + 1)) best = loop;
    }
    return best;
  }

  // One greedy loop: chains are taken while they fit in `limit`, then home
  // within `budget`.
  async function greedy(graph, start, chains, budget, limit, home) {
    const { lat, lon } = graph;
    const n = lat.length;
    const ran = new Uint8Array(n);  // points the route passes
    const used = new Set();
    const unrun = new Uint8Array(n);  // chain points the route hasn't passed yet
    for (const c of chains) for (const i of c) unrun[i] = 1;
    const onChain = unrun.slice();
    const lengths = chains.map(c => {
      let m = 0;
      for (let i = 1; i < c.length; i++) m += distance(lat[c[i - 1]], lon[c[i - 1]], lat[c[i]], lon[c[i]]);
      return m;
    });
    // Metres of a chain the route hasn't run yet.
    const fresh = (c, len) => {
      let m = 0;
      for (let i = 1; i < c.length; i++) if (!ran[c[i - 1]] || !ran[c[i]]) m += len / (c.length - 1);
      return m;
    };
    const point = i => [lat[i], lon[i]];
    let metres = 0, freshMetres = 0;
    const follow = path => {
      for (let i = 0; i < path.length; i++) {
        if (i) {
          const a = path[i - 1], b = path[i], key = edgeKey(a, b, n), d = distance(lat[a], lon[a], lat[b], lon[b]);
          metres += d;
          if (onChain[a] && onChain[b] && !used.has(key)) freshMetres += d;
          used.add(key);
        }
        ran[path[i]] = 1;
        unrun[path[i]] = 0;
      }
    };

    const waypoints = [point(start)], legs = [];
    let at = start, spent = 0, taken = 0;
    for (;;) {
      const s = search(graph, at, limit - spent, used, unrun);
      let best = null;
      chains.forEach((c, ci) => {
        const len = lengths[ci];
        const value = fresh(c, len);
        if (value < len / 2) return;  // mostly run already, by this route
        for (const [entry, exit] of [[0, c.length - 1], [c.length - 1, 0]]) {
          const reach = s.metres[c[entry]];
          if (spent + reach + len + home[c[exit]] > limit) continue;
          const score = value / (reach + len + 1);
          if (!best || score > best.score) best = { score, ci, entry, reach, len };
        }
      });
      if (!best) break;
      const c = chains[best.ci];
      const there = pathTo(s.prev, c[best.entry]);
      const along = best.entry === 0 ? c : [...c].reverse();
      if (there.length > 1) {
        legs.push(there.map(point));
        waypoints.push(point(there[there.length - 1]));
      }
      legs.push(along.map(point));
      waypoints.push(point(along[along.length - 1]));
      follow(there);
      follow(along);
      spent += best.reach + best.len;
      at = along[along.length - 1];
      taken++;
      await new Promise(r => setTimeout(r));
    }
    if (!taken) return null;
    // Home: by new streets if that still fits the budget, else avoiding
    // repeats, else the shortest way (which always fits: every chain was
    // only taken if home[] was in reach).
    if (at !== start) {
      let back;
      for (const [u, f] of [[used, unrun], [used, null], [null, null]]) {
        const s = search(graph, at, Infinity, u, f);
        back = pathTo(s.prev, start);
        if (spent + s.metres[start] <= budget) break;
      }
      legs.push(back.map(point));
      waypoints.push(point(start));
      follow(back);
    }
    return { waypoints, legs, metres, fresh: freshMetres };
  }

  const PIECE = 400;     // metres: longer unrun stretches are cut up, so a route can take part of a long road
  const MIN_PIECE = 40;  // metres: shorter ones are left out (often just GPS missing a corner)

  // The stretches of the areas' streets not yet run, as chains of graph
  // points for explore(). visitedFor(area): Coverage.compute's visited flags
  // for that area. Unrunnable streets are left out; stretches shared by
  // overlapping areas are counted once.
  function chains(graph, areas, visitedFor) {
    const out = [], seen = new Set();
    for (const area of areas) {
      const visited = visitedFor(area);
      const excluded = new Set(area.excluded || []);
      let k = 0;  // point index, in Coverage.prepare's order
      for (const s of area.data.streets) {
        for (const run of s.runs) {
          let piece = [], metres = 0;
          const finish = () => {
            const key = piece.length > 1 && `${Math.min(piece[0], piece[piece.length - 1])}:${Math.max(piece[0], piece[piece.length - 1])}`;
            if (key && metres >= MIN_PIECE && !seen.has(key)) {
              seen.add(key);
              out.push(piece);
            }
            piece = [];
            metres = 0;
          };
          for (const [a, b] of run) {
            const node = graph.index.get(a + ',' + b);
            const done = visited[k++];
            if (done || excluded.has(s.id) || node === undefined) {
              finish();
              continue;
            }
            if (piece.length) {
              const last = piece[piece.length - 1];
              if (node === last) continue;
              metres += distance(graph.lat[last], graph.lon[last], a, b);
            }
            piece.push(node);
            if (metres >= PIECE) {
              finish();
              piece.push(node);  // the next piece starts where this one ended
            }
          }
          finish();
        }
      }
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

  return { build, snap, route, trace, explore, chains, distance, gpx };
})();
