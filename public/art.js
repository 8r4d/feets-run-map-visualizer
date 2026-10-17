// GPS art: routes that draw a picture on the map. A shape from the library is
// tried at many places, sizes and angles in an area; the placements that lie
// closest to its streets are routed along them (Planner.followShape), and
// scored by how closely the route matches the shape.
//
// Everything is worked out on a field: a grid over the area, CELL metres
// square, where each cell knows how far it is to the nearest street point
// (and which point that is), so judging a placement is a few lookups.
const Art = (() => {
  const CELL = 15;        // metres
  const CAP = 120;        // metres: a point further than this from a street counts as this far
  const SAMPLES = 96;     // points along a shape when trying placements
  const FINE = 240;       // ... when polishing the best ones
  const TARGET_EVERY = 100;  // metres between the points a route is made to go through
  const OVERHEAD = 0.85;  // a route comes out longer than its shape (streets go round corners)
  const UPRIGHT = 0.1;    // metres of score per degree of tilt, unless rotating freely: shapes read best upright

  // --- Shapes ---
  // Each a line of [x, y] points (y up), closed if it ends where it starts.
  // Drawn so they can be run in one go; any shape is scaled to a unit box.
  const ring = (n, f) => Array.from({ length: n + 1 }, (_, i) => f(2 * Math.PI * i / n));
  const arc = (cx, cy, r, from, to, n) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (from + (to - from) * i / n) * Math.PI / 180;
      return [cx + r * Math.cos(a), cy + r * Math.sin(a)];
    });

  const LIBRARY = [
    { id: 'heart', name: 'Heart', points: ring(48, t => [16 * Math.sin(t) ** 3, 13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t)]) },
    { id: 'star', name: 'Star', points: ring(10, t => { const r = Math.round(t / (Math.PI / 5)) % 2 ? 0.4 : 1; return [r * Math.sin(t), r * Math.cos(t)]; }) },
    { id: 'arrow', name: 'Arrow', points: [[0, 0.35], [0.6, 0.35], [0.6, 0.1], [1, 0.5], [0.6, 0.9], [0.6, 0.65], [0, 0.65], [0, 0.35]] },
    { id: 'bolt', name: 'Lightning', points: [[0.55, 1], [0.15, 0.45], [0.45, 0.45], [0.3, 0], [0.85, 0.6], [0.55, 0.6], [0.75, 1], [0.55, 1]] },
    { id: 'house', name: 'House', points: [[0.1, 0], [0.1, 0.55], [0, 0.55], [0.5, 1], [1, 0.55], [0.9, 0.55], [0.9, 0], [0.6, 0], [0.6, 0.3], [0.4, 0.3], [0.4, 0], [0.1, 0]] },
    { id: 'tree', name: 'Tree', points: [[0.45, 0], [0.45, 0.15], [0.1, 0.15], [0.35, 0.45], [0.2, 0.45], [0.4, 0.7], [0.28, 0.7], [0.5, 1], [0.72, 0.7], [0.6, 0.7], [0.8, 0.45], [0.65, 0.45], [0.9, 0.15], [0.55, 0.15], [0.55, 0], [0.45, 0]] },
    { id: 'fish', name: 'Fish', points: [[0, 0.5], [0.15, 0.75], [0.4, 0.85], [0.65, 0.75], [0.78, 0.55], [1, 0.85], [1, 0.15], [0.78, 0.45], [0.65, 0.25], [0.4, 0.15], [0.15, 0.25], [0, 0.5]] },
    { id: 'cat', name: 'Cat', points: [[0.5, 0], [0.8, 0.08], [0.95, 0.3], [0.97, 0.55], [0.92, 0.75], [0.95, 1], [0.7, 0.85], [0.5, 0.88], [0.3, 0.85], [0.05, 1], [0.08, 0.75], [0.03, 0.55], [0.05, 0.3], [0.2, 0.08], [0.5, 0]] },
    { id: 'rocket', name: 'Rocket', points: [[0.5, 1], [0.65, 0.8], [0.68, 0.45], [0.85, 0.25], [0.85, 0.05], [0.65, 0.2], [0.6, 0.1], [0.4, 0.1], [0.35, 0.2], [0.15, 0.05], [0.15, 0.25], [0.32, 0.45], [0.35, 0.8], [0.5, 1]] },
    { id: 'moon', name: 'Moon', points: [...arc(0.5, 0.5, 0.5, 60, 300, 24), ...arc(0.85, 0.5, 0.444, -103, -257, 16), [0.75, 0.933]] },
    { id: 'smiley', name: 'Smiley', points: [
      ...arc(0.5, 0.5, 0.5, -90, 270, 32),          // face, from the chin
      [0.5, 0.15], ...arc(0.5, 0.45, 0.28, 215, 325, 8),  // up to the smile
      [0.66, 0.62], [0.66, 0.74], [0.66, 0.62],      // right eye
      [0.34, 0.62], [0.34, 0.74], [0.34, 0.62],      // left eye
      [0.27, 0.29], [0.5, 0.15], [0.5, 0],          // back down to the chin
    ] },
    { id: 'bird', name: 'Bird', points: [[0, 0.6], [0.15, 0.8], [0.32, 0.82], [0.45, 0.65], [0.5, 0.5], [0.55, 0.65], [0.68, 0.82], [0.85, 0.8], [1, 0.6]] },
  ];

  // Scaled into a unit box (the longer side 1), centred, with each point's
  // distance along the line. closed: whether it ends where it starts.
  const SHAPES = LIBRARY.map(({ id, name, points }) => {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = 1 / Math.max(x1 - x0, y1 - y0);
    const pts = points.map(([x, y]) => [(x - (x0 + x1) / 2) * k, (y - (y0 + y1) / 2) * k]);
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const first = pts[0], last = pts[pts.length - 1];
    return { id, name, points: pts, along, length: along[along.length - 1], closed: Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01 };
  });

  // n points at equal steps along a shape (unit coordinates).
  function resample(shape, n) {
    const { points, along, length } = shape;
    const out = [];
    let k = 0;
    for (let i = 0; i < n; i++) {
      const at = length * i / (n - 1);
      while (k < points.length - 2 && along[k + 1] < at) k++;
      const span = along[k + 1] - along[k];
      const f = span ? Math.min(1, (at - along[k]) / span) : 0;
      out.push([points[k][0] + (points[k + 1][0] - points[k][0]) * f, points[k][1] + (points[k + 1][1] - points[k][1]) * f]);
    }
    return out;
  }

  // A placement: centre (cx, cy in field metres), size s (metres across the
  // longer side) and angle rot (degrees, anticlockwise). Unit points to metres.
  function place(points, { cx, cy, s, rot }) {
    const c = Math.cos(rot * Math.PI / 180), si = Math.sin(rot * Math.PI / 180);
    return points.map(([x, y]) => [cx + (x * c - y * si) * s, cy + (x * si + y * c) * s]);
  }

  // --- The field ---

  // Distances on a grid from seed points: for each cell, how far (metres) to
  // the nearest seed and which seed it is, by sweeping the grid twice (a
  // close approximation to the true nearest). seeds: [[x, y], ...] in metres.
  function distanceField(cols, rows, seeds) {
    const n = cols * rows;
    const near = new Int32Array(n).fill(-1);
    const dist = new Float32Array(n).fill(Infinity);
    const at = (i, s) => {
      const x = (i % cols + 0.5) * CELL, y = (Math.floor(i / cols) + 0.5) * CELL;
      return Math.hypot(x - seeds[s][0], y - seeds[s][1]);
    };
    seeds.forEach(([x, y], s) => {
      const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
      if (c < 0 || r < 0 || c >= cols || r >= rows) return;
      const i = r * cols + c, d = at(i, s);
      if (d < dist[i]) { dist[i] = d; near[i] = s; }
    });
    const look = (i, j) => {
      const s = near[j];
      if (s < 0) return;
      const d = at(i, s);
      if (d < dist[i]) { dist[i] = d; near[i] = s; }
    };
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const i = r * cols + c;
        if (c > 0) look(i, i - 1);
        if (r > 0) {
          look(i, i - cols);
          if (c > 0) look(i, i - cols - 1);
          if (c < cols - 1) look(i, i - cols + 1);
        }
      }
    }
    for (let r = rows - 1; r >= 0; r--) {
      for (let c = cols - 1; c >= 0; c--) {
        const i = r * cols + c;
        if (c < cols - 1) look(i, i + 1);
        if (r < rows - 1) {
          look(i, i + cols);
          if (c < cols - 1) look(i, i + cols + 1);
          if (c > 0) look(i, i + cols - 1);
        }
      }
    }
    return { dist, near };
  }

  // The field for the graph points `allowed` allows (an area's streets):
  // { toLatLon, toXY, cols, rows, width, height, dist, near (graph points),
  // nodes: the allowed graph points }.
  function prepare(graph, allowed) {
    const nodes = [];
    for (let i = 0; i < allowed.length; i++) if (allowed[i]) nodes.push(i);
    let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
    for (const i of nodes) {
      s = Math.min(s, graph.lat[i]); n = Math.max(n, graph.lat[i]);
      w = Math.min(w, graph.lon[i]); e = Math.max(e, graph.lon[i]);
    }
    const ky = 111320, kx = 111320 * Math.cos((s + n) / 2 * Math.PI / 180);
    const margin = 2 * CELL;
    const lat0 = s - margin / ky, lon0 = w - margin / kx;
    const toXY = (lat, lon) => [(lon - lon0) * kx, (lat - lat0) * ky];
    const toLatLon = ([x, y]) => [lat0 + y / ky, lon0 + x / kx];
    const width = (e - w) * kx + 2 * margin, height = (n - s) * ky + 2 * margin;
    const cols = Math.ceil(width / CELL), rows = Math.ceil(height / CELL);
    const { dist, near } = distanceField(cols, rows, nodes.map(i => toXY(graph.lat[i], graph.lon[i])));
    return { toXY, toLatLon, cols, rows, width, height, dist, near: Int32Array.from(near, k => (k < 0 ? -1 : nodes[k])), nodes };
  }

  const cellAt = (field, [x, y]) => {
    const c = Math.floor(x / CELL), r = Math.floor(y / CELL);
    return c < 0 || r < 0 || c >= field.cols || r >= field.rows ? -1 : r * field.cols + c;
  };
  const streetGap = (field, p) => {
    const i = cellAt(field, p);
    return i < 0 ? CAP : Math.min(CAP, field.dist[i]);
  };

  // How well a placement's points lie on streets: the root mean square of
  // their distance to the nearest street (capped), in metres. Lower is better.
  function score(field, unitPoints, placement) {
    let sum = 0;
    for (const p of place(unitPoints, placement)) {
      const d = streetGap(field, p);
      sum += d * d;
    }
    return Math.sqrt(sum / unitPoints.length);
  }

  // --- Finding the best placements ---

  // The best placements of `shape` in the field, best first, for a route of
  // about `km`. free: any angle, rather than within 30° of upright. Calls
  // progress(fraction) and yields to the browser as it goes. Returns
  // [{ cx, cy, s, rot, score }], or [] if the shape doesn't fit at that size.
  async function fit(field, shape, { km, free = false }, progress = () => {}) {
    const coarse = resample(shape, SAMPLES), fine = resample(shape, FINE);
    const judge = (points, placement) => score(field, points, placement) + (free ? 0 : UPRIGHT * Math.abs(placement.rot));
    const size = km * 1000 * OVERHEAD / shape.length;  // metres across, for that length
    const sizes = [0.88, 0.94, 1, 1.06].map(f => size * f);
    const angles = free ? Array.from({ length: 24 }, (_, i) => i * 15) : [-30, -20, -10, 0, 10, 20, 30];
    const best = [];  // the KEEP best found, best first
    const KEEP = 60;
    const consider = c => {
      if (best.length === KEEP && c.score >= best[KEEP - 1].score) return;
      let i = best.length;
      while (i > 0 && best[i - 1].score > c.score) i--;
      best.splice(i, 0, c);
      if (best.length > KEEP) best.pop();
    };
    let done = 0;
    const total = sizes.length * angles.length;
    for (const s of sizes) {
      if (s > Math.max(field.width, field.height) * 1.1) { done += angles.length; continue; }
      const stepXY = Math.max(CELL * 3, s / 25);
      for (const rot of angles) {
        for (let cy = s * 0.3; cy <= field.height - s * 0.3; cy += stepXY) {
          for (let cx = s * 0.3; cx <= field.width - s * 0.3; cx += stepXY) {
            const placement = { cx, cy, s, rot };
            consider({ ...placement, score: judge(coarse, placement) });
          }
        }
        progress(++done / total * 0.8);
        await new Promise(r => setTimeout(r));
      }
    }
    // Polish the best few, each in its own spot: small nudges, kept if better.
    const distinct = [];
    for (const c of best) {
      if (distinct.every(d => Math.hypot(d.cx - c.cx, d.cy - c.cy) > c.s / 5 || Math.abs(d.rot - c.rot) > 15)) distinct.push(c);
      if (distinct.length === 12) break;
    }
    const polished = [];
    for (const [k, start] of distinct.entries()) {
      let cur = { ...start, score: judge(fine, start) };
      let step = Math.max(CELL, start.s / 50);
      for (let round = 0; round < 40; round++) {
        const angle = (free ? 6 : 3) * (round < 20 ? 1 : 0.5);
        const tries = [
          { ...cur, cx: cur.cx + step }, { ...cur, cx: cur.cx - step }, { ...cur, cy: cur.cy + step }, { ...cur, cy: cur.cy - step },
          { ...cur, rot: cur.rot + angle }, { ...cur, rot: cur.rot - angle },
          { ...cur, s: cur.s * 1.02 }, { ...cur, s: cur.s * 0.98 },
        ].filter(t => free || Math.abs(t.rot) <= 30);
        let improved = false;
        for (const t of tries) {
          t.score = judge(fine, t);
          if (t.score < cur.score) { cur = t; improved = true; }
        }
        if (!improved) step /= 2;
        if (step < 3) break;
      }
      polished.push(cur);
      progress(0.8 + (k + 1) / distinct.length * 0.2);
      await new Promise(r => setTimeout(r));
    }
    return polished.sort((a, b) => a.score - b.score);
  }

  // --- Routing and judging a placement ---

  // What Planner.followShape needs for a placement: { targets (graph points
  // to go through, in order), near (each graph point's distance to the
  // shape), outline ([lat, lon] of the placed shape, for drawing) }.
  function routeInput(graph, field, shape, placement) {
    const metres = shape.length * placement.s;
    const dense = place(resample(shape, Math.max(2, Math.ceil(metres / 10))), placement);
    const shapeField = distanceField(field.cols, field.rows, dense);
    const near = new Float32Array(graph.lat.length).fill(CAP);
    for (const i of field.nodes) {
      const cell = cellAt(field, field.toXY(graph.lat[i], graph.lon[i]));
      if (cell >= 0) near[i] = Math.min(CAP * 4, shapeField.dist[cell]);
    }
    // Targets: the shape's corners, and points every TARGET_EVERY metres between.
    const unit = place(shape.points, placement);
    const stops = [];
    for (let i = 0; i < unit.length; i++) {
      stops.push(unit[i]);
      if (i < unit.length - 1) {
        const [a, b] = [unit[i], unit[i + 1]];
        const gaps = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / TARGET_EVERY);
        for (let k = 1; k <= gaps; k++) stops.push([a[0] + (b[0] - a[0]) * k / (gaps + 1), a[1] + (b[1] - a[1]) * k / (gaps + 1)]);
      }
    }
    const targets = [];
    for (const p of stops) {
      const cell = cellAt(field, p);
      const node = cell >= 0 ? field.near[cell] : -1;
      if (node >= 0 && node !== targets[targets.length - 1]) targets.push(node);
    }
    if (shape.closed && targets.length > 1 && targets[0] !== targets[targets.length - 1]) targets.push(targets[0]);
    return { targets, near, outline: dense.map(field.toLatLon), shapeField };
  }

  // How closely a route ([lat, lon] points) matches its shape, both ways: how
  // far the route strays from the shape, and how far the shape is from the
  // route (so skipping a detail counts too). { mean, worst } in metres, worst
  // being the 95th percentile.
  function fidelity(field, input, routePoints) {
    const xy = routePoints.map(([la, lo]) => field.toXY(la, lo));
    // The route, filled in every few metres, as seeds for a field of its own.
    const dense = [];
    for (let i = 1; i < xy.length; i++) {
      const [a, b] = [xy[i - 1], xy[i]];
      const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
      for (let k = 0; k < n; k++) dense.push([a[0] + (b[0] - a[0]) * k / n, a[1] + (b[1] - a[1]) * k / n]);
    }
    dense.push(xy[xy.length - 1]);
    const routeField = distanceField(field.cols, field.rows, dense);
    const gaps = [];
    for (const p of dense) {
      const c = cellAt(field, p);
      gaps.push(c < 0 ? CAP : input.shapeField.dist[c]);
    }
    for (const [la, lo] of input.outline) {
      const c = cellAt(field, field.toXY(la, lo));
      gaps.push(c < 0 ? CAP : routeField.dist[c]);
    }
    gaps.sort((a, b) => a - b);
    return { mean: gaps.reduce((a, b) => a + b, 0) / gaps.length, worst: gaps[Math.floor(gaps.length * 0.95)] };
  }

  // A small SVG of a shape, for the picker.
  function icon(shape) {
    const pts = shape.points.map(([x, y]) => `${(x + 0.5) * 20 + 2},${(0.5 - y) * 20 + 2}`).join(' ');
    return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  return { SHAPES, prepare, fit, routeInput, fidelity, icon };
})();
