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
  // How strictly a route keeps to its shape, from 1 (loose) to 5 (strict),
  // 3 being the middle: detail, the share of the shape's size within which
  // small wiggles are smoothed away (0: none); every, metres between the
  // points a route is made to go through; corridor, metres off the shape that
  // double what a street costs (see Planner.followShape). Looser lets the
  // route take easier streets; stricter hugs every corner, zig-zags and all.
  const RIGOR = {
    1: { detail: 0.05, every: 250, corridor: 45 },
    2: { detail: 0.025, every: 160, corridor: 30 },
    3: { detail: 0, every: 100, corridor: 20 },
    4: { detail: 0, every: 70, corridor: 14 },
    5: { detail: 0, every: 50, corridor: 10 },
  };
  const rigor = level => RIGOR[level] || RIGOR[3];
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

  // A shape the same on both sides, from its half-width at heights going up:
  // [[y, halfWidth], ...]. Up the right side, back down the left.
  const profile = rows => {
    const right = rows.map(([y, w]) => [0.5 + w, y]);
    const left = [...rows].reverse().map(([y, w]) => [0.5 - w, y]);
    return [...right, ...left, right[0]];
  };
  // A shape the same on both sides, from its right half (x from 0.5 to 1, in
  // order, starting and ending on the middle line).
  const mirror = right => [...right, ...right.slice(1, -1).reverse().map(([x, y]) => [1 - x, y]), right[0]];
  const rows = (from, to, step, f) => {
    const out = [];
    for (let y = from; y <= to + 1e-9; y += step) out.push([y, f(y)]);
    return out;
  };
  const circleWidth = (cy, r) => y => Math.sqrt(Math.max(0, r * r - (y - cy) ** 2));

  // --- Bubble letters ---
  // Each letter is drawn as the strokes you'd write it with (lines in a box
  // about 0.6 wide and 1 high, y up), and its bubble outline worked out from
  // them: the strokes are painted BUBBLE thick on a grid, and the edge traced
  // (marching squares), which rounds every end and corner. A hole (in A, B,
  // O, ...) is joined to the outside by a short spoke, there and back, so the
  // letter can be run in one go.
  const BUBBLE = 0.11;    // half the thickness of a letter's strokes
  const GRID = 0.01;      // tracing grid step
  const ellipse = (cx, cy, rx, ry, from, to, n = 16) =>
    Array.from({ length: n + 1 }, (_, i) => {
      const a = (from + (to - from) * i / n) * Math.PI / 180;
      return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)];
    });
  const STROKES = {
    A: [[[0, 0], [0.3, 1], [0.6, 0]], [[0.12, 0.35], [0.48, 0.35]]],
    B: [[[0, 0], [0, 1], [0.36, 1], ...ellipse(0.36, 0.76, 0.22, 0.24, 90, -90), [0, 0.52]], [[0, 0.52], [0.38, 0.52], ...ellipse(0.38, 0.26, 0.24, 0.26, 90, -90), [0, 0]]],
    C: [ellipse(0.32, 0.5, 0.32, 0.5, 45, 315, 24)],
    D: [[[0, 0], [0, 1], [0.24, 1], ...ellipse(0.24, 0.5, 0.36, 0.5, 90, -90, 20), [0, 0]]],
    E: [[[0.56, 1], [0, 1], [0, 0], [0.56, 0]], [[0, 0.5], [0.44, 0.5]]],
    F: [[[0.56, 1], [0, 1], [0, 0]], [[0, 0.5], [0.44, 0.5]]],
    G: [[...ellipse(0.32, 0.5, 0.32, 0.5, 45, 320, 24), [0.6, 0.45], [0.36, 0.45]]],
    H: [[[0, 0], [0, 1]], [[0.6, 0], [0.6, 1]], [[0, 0.5], [0.6, 0.5]]],
    I: [[[0.3, 0], [0.3, 1]], [[0.08, 1], [0.52, 1]], [[0.08, 0], [0.52, 0]]],
    J: [[[0.6, 1], [0.6, 0.3], ...ellipse(0.3, 0.3, 0.3, 0.3, 0, -180), [0, 0.38]]],
    K: [[[0, 0], [0, 1]], [[0.58, 1], [0, 0.42]], [[0.2, 0.62], [0.6, 0]]],
    L: [[[0, 1], [0, 0], [0.55, 0]]],
    M: [[[0, 0], [0, 1], [0.3, 0.45], [0.6, 1], [0.6, 0]]],
    N: [[[0, 0], [0, 1], [0.6, 0], [0.6, 1]]],
    O: [ellipse(0.3, 0.5, 0.3, 0.5, 0, 360, 32)],
    P: [[[0, 0], [0, 1], [0.34, 1], ...ellipse(0.34, 0.74, 0.26, 0.26, 90, -90), [0, 0.48]]],
    Q: [ellipse(0.3, 0.5, 0.3, 0.5, 0, 360, 32), [[0.36, 0.26], [0.66, -0.06]]],
    R: [[[0, 0], [0, 1], [0.34, 1], ...ellipse(0.34, 0.74, 0.26, 0.26, 90, -90), [0, 0.48]], [[0.26, 0.48], [0.6, 0]]],
    S: [[...ellipse(0.3, 0.75, 0.3, 0.25, 20, 270), ...ellipse(0.3, 0.25, 0.3, 0.25, 90, -160)]],
    T: [[[0, 1], [0.6, 1]], [[0.3, 1], [0.3, 0]]],
    U: [[[0, 1], [0, 0.3], ...ellipse(0.3, 0.3, 0.3, 0.3, 180, 360), [0.6, 1]]],
    V: [[[0, 1], [0.3, 0], [0.6, 1]]],
    W: [[[0, 1], [0.15, 0], [0.3, 0.6], [0.45, 0], [0.6, 1]]],
    X: [[[0, 1], [0.6, 0]], [[0, 0], [0.6, 1]]],
    Y: [[[0, 1], [0.3, 0.5], [0.6, 1]], [[0.3, 0.5], [0.3, 0]]],
    Z: [[[0, 1], [0.6, 1], [0, 0], [0.6, 0]]],
    0: [ellipse(0.3, 0.5, 0.27, 0.5, 0, 360, 32)],
    1: [[[0.08, 0.78], [0.34, 1], [0.34, 0]], [[0.08, 0], [0.6, 0]]],
    2: [[...ellipse(0.3, 0.7, 0.3, 0.3, 160, -30), [0, 0], [0.6, 0]]],
    3: [[...ellipse(0.3, 0.75, 0.27, 0.25, 160, -90), ...ellipse(0.3, 0.25, 0.3, 0.25, 90, -160)]],
    4: [[[0.45, 0], [0.45, 1], [0, 0.32], [0.62, 0.32]]],
    5: [[[0.56, 1], [0.06, 1], [0.02, 0.56], ...ellipse(0.3, 0.32, 0.3, 0.3, 130, -150)]],
    6: [ellipse(0.32, 0.5, 0.3, 0.5, 60, 200), ellipse(0.3, 0.28, 0.28, 0.28, 0, 360, 24)],
    7: [[[0, 1], [0.6, 1], [0.2, 0]]],
    8: [ellipse(0.3, 0.76, 0.22, 0.24, 0, 360, 24), ellipse(0.3, 0.27, 0.28, 0.27, 0, 360, 24)],
    9: [ellipse(0.3, 0.72, 0.28, 0.28, 0, 360, 24), [[0.58, 0.72], [0.48, 0]]],
  };

  // Distance from a point to a line segment.
  function segmentGap([px, py], [ax, ay], [bx, by]) {
    const dx = bx - ax, dy = by - ay, len2 = dx * dx + dy * dy;
    const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
    return Math.hypot(px - ax - t * dx, py - ay - t * dy);
  }

  // The closed outlines where f(x, y) = 0 on a grid (marching squares), each
  // as a list of points, with f negative inside.
  function contours(f, x0, y0, cols, rows, step) {
    const v = new Float64Array((cols + 1) * (rows + 1));
    for (let r = 0; r <= rows; r++) for (let c = 0; c <= cols; c++) v[r * (cols + 1) + c] = f(x0 + c * step, y0 + r * step);
    const at = (c, r) => v[r * (cols + 1) + c];
    // Where the edge between two corners crosses zero, keyed so that cells
    // sharing an edge find each other.
    const cross = (c1, r1, c2, r2) => {
      const a = at(c1, r1), b = at(c2, r2), t = a / (a - b);
      return { key: `${c1},${r1},${c2},${r2}`, p: [x0 + (c1 + (c2 - c1) * t) * step, y0 + (r1 + (r2 - r1) * t) * step] };
    };
    const next = new Map(), points = new Map();
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const bl = at(c, r) < 0, br = at(c + 1, r) < 0, tr = at(c + 1, r + 1) < 0, tl = at(c, r + 1) < 0;
        const edges = [];
        // Edges in order round the cell, with whether the outline crosses each.
        const B = bl !== br && cross(c, r, c + 1, r), R = br !== tr && cross(c + 1, r, c + 1, r + 1);
        const T = tr !== tl && cross(c, r + 1, c + 1, r + 1), L = tl !== bl && cross(c, r, c, r + 1);
        const found = [B, R, T, L].filter(Boolean);
        if (found.length === 2) edges.push(found);
        else if (found.length === 4) {
          // A saddle: pair the crossings by the middle of the cell.
          const middle = (at(c, r) + at(c + 1, r) + at(c + 1, r + 1) + at(c, r + 1)) / 4 < 0;
          edges.push(...(middle === bl ? [[B, R], [T, L]] : [[B, L], [R, T]]));
        }
        for (const [a, b] of edges) {
          points.set(a.key, a.p);
          points.set(b.key, b.p);
          if (!next.has(a.key)) next.set(a.key, []);
          if (!next.has(b.key)) next.set(b.key, []);
          next.get(a.key).push(b.key);
          next.get(b.key).push(a.key);
        }
      }
    }
    // Link the pieces into loops.
    const loops = [], used = new Set();
    for (const start of next.keys()) {
      if (used.has(start)) continue;
      const loop = [];
      let prev = null, cur = start;
      while (cur && !used.has(cur)) {
        used.add(cur);
        loop.push(points.get(cur));
        const [a, b] = next.get(cur);
        const go = a !== prev && !used.has(a) ? a : b !== prev && !used.has(b) ? b : null;
        prev = cur;
        cur = go;
      }
      if (loop.length > 3) loops.push([...loop, loop[0]]);
    }
    return loops;
  }

  const loopArea = loop => loop.reduce((sum, [x, y], i) => (i ? sum + (loop[i - 1][0] * y - x * loop[i - 1][1]) : sum), 0) / 2;

  // Douglas-Peucker: drops points within `tolerance` of the line through
  // their neighbours.
  function simplify(points, tolerance) {
    if (points.length < 3) return points;
    const keep = new Uint8Array(points.length);
    keep[0] = keep[points.length - 1] = 1;
    const stack = [[0, points.length - 1]];
    while (stack.length) {
      const [a, b] = stack.pop();
      let far = -1, farGap = tolerance;
      for (let i = a + 1; i < b; i++) {
        const gap = segmentGap(points[i], points[a], points[b]);
        if (gap > farGap) { farGap = gap; far = i; }
      }
      if (far >= 0) {
        keep[far] = 1;
        stack.push([a, far], [far, b]);
      }
    }
    return points.filter((_, i) => keep[i]);
  }

  // A letter's bubble outline, as one line: the outside, with each hole
  // reached by a spoke from the nearest point and back.
  function bubble(strokes) {
    const segments = strokes.flatMap(line => line.slice(1).map((p, i) => [line[i], p]));
    const xs = strokes.flat().map(p => p[0]), ys = strokes.flat().map(p => p[1]);
    const pad = BUBBLE + 2 * GRID;
    const x0 = Math.min(...xs) - pad, y0 = Math.min(...ys) - pad;
    const cols = Math.ceil((Math.max(...xs) + pad - x0) / GRID), rows = Math.ceil((Math.max(...ys) + pad - y0) / GRID);
    const f = (x, y) => {
      let gap = Infinity;
      for (const [a, b] of segments) gap = Math.min(gap, segmentGap([x, y], a, b));
      return gap - BUBBLE;
    };
    const loops = contours(f, x0, y0, cols, rows, GRID)
      .map(loop => simplify(loop, GRID * 0.3))
      .sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
    return joinLoops(loops[0], loops.slice(1).filter(hole => Math.abs(loopArea(hole)) >= GRID * GRID * 20));  // not specks where strokes cross
  }

  // One line through a loop and others: each reached by a spoke from the
  // nearest point of the line so far, once round it, and back.
  function joinLoops(path, others) {
    for (const loop of others) {
      let best = [0, 0, Infinity];
      path.forEach((p, i) => loop.forEach((q, j) => {
        const d = Math.hypot(p[0] - q[0], p[1] - q[1]);
        if (d < best[2]) best = [i, j, d];
      }));
      const [i, j] = best;
      const ring = [...loop.slice(j, -1), ...loop.slice(0, j), loop[j]];
      path = [...path.slice(0, i + 1), ...ring, ...path.slice(i)];
    }
    return path;
  }

  // --- Your own shapes, from SVG files ---
  // An SVG is drawn into a small image and its silhouette traced: everything
  // the drawing encloses counts as inside, so an outline drawing and a filled
  // one come out the same, and all the detail within is left out, as it
  // couldn't be run anyway. Pieces apart from the biggest are reached by
  // spokes (as a letter's holes are); specks are dropped. The outline is
  // simplified until it has at most TRACE_POINTS points. Nothing of the SVG
  // is kept but that line, so its scripts and links never run.
  const TRACE_SIZE = 240;    // pixels along the image's longer side
  const TRACE_POINTS = 160;
  const TRACE_PIECE = 0.03;  // pieces smaller than this share of the biggest are dropped
  const TRACE_PIECES = 6;

  async function trace(svgText) {
    const doc = new DOMParser().parseFromString(svgText, 'image/svg+xml');
    const svg = doc.documentElement;
    if (doc.querySelector('parsererror') || svg.localName !== 'svg') throw new Error("That file isn't an SVG drawing");
    let box = (svg.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    if (box.length !== 4 || !box.every(Number.isFinite) || box[2] <= 0 || box[3] <= 0) {
      const w = parseFloat(svg.getAttribute('width')), h = parseFloat(svg.getAttribute('height'));
      if (!(w > 0 && h > 0)) throw new Error('The SVG has no size (no viewBox, width or height)');
      box = [0, 0, w, h];
      svg.setAttribute('viewBox', box.join(' '));
    }
    const k = TRACE_SIZE / Math.max(box[2], box[3]);
    const w = Math.max(1, Math.round(box[2] * k)), h = Math.max(1, Math.round(box[3] * k));
    svg.setAttribute('width', w);
    svg.setAttribute('height', h);
    svg.setAttribute('preserveAspectRatio', 'none');

    const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(doc)], { type: 'image/svg+xml' }));
    const img = new Image();
    try {
      img.src = url;
      await img.decode();
    } catch {
      throw new Error("The SVG couldn't be drawn");
    } finally {
      URL.revokeObjectURL(url);
    }
    // A clear pixel all round, so every outline closes.
    const W = w + 4, H = h + 4;
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 2, 2, w, h);
    const alpha = ctx.getImageData(0, 0, W, H).data;

    // Inside: everything not reached from the edge without crossing ink.
    const inside = new Uint8Array(W * H).fill(1);
    const queue = [0];
    inside[0] = 0;
    while (queue.length) {
      const p = queue.pop();
      const x = p % W, y = (p - x) / W;
      for (const q of [x > 0 && p - 1, x < W - 1 && p + 1, y > 0 && p - W, y < H - 1 && p + W]) {
        if (q === false || !inside[q] || alpha[q * 4 + 3] >= 64) continue;
        inside[q] = 0;
        queue.push(q);
      }
    }
    if (!inside.some(Boolean)) throw new Error('There was nothing to trace in that SVG');

    // Softened a little (each pixel with its neighbours), so the outline
    // runs between pixels rather than in steps; negative inside.
    const f = (x, y) => {
      let sum = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        sum += inside[yy * W + xx];
        n++;
      }
      return 0.5 - sum / n;
    };
    const loops = contours(f, 0, 0, W - 1, H - 1, 1)
      .map(loop => loop.map(([x, y]) => [x, H - y]))  // y up
      .sort((a, b) => Math.abs(loopArea(b)) - Math.abs(loopArea(a)));
    if (!loops.length) throw new Error('There was nothing to trace in that SVG');
    const biggest = Math.abs(loopArea(loops[0]));
    const pieces = loops.slice(1, TRACE_PIECES).filter(loop => Math.abs(loopArea(loop)) >= biggest * TRACE_PIECE);
    const line = joinLoops(loops[0], pieces);

    let points = line;
    for (let tolerance = 0.75; ; tolerance *= 1.4) {
      points = simplify(line, tolerance);
      if (points.length <= TRACE_POINTS) break;
    }
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const x0 = Math.min(...xs), y0 = Math.min(...ys);
    const size = Math.max(Math.max(...xs) - x0, Math.max(...ys) - y0) || 1;
    return {
      points: points.map(([x, y]) => [Math.round((x - x0) / size * 1e4) / 1e4, Math.round((y - y0) / size * 1e4) / 1e4]),
      pieces: pieces.length + 1,
      dropped: loops.length - 1 - pieces.length,
    };
  }

  // theme: which set of the picker it's in (everyday if not given).
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
    // Eyes and smile are reached by short spokes in from the face and back
    // out again, so no line crosses the face.
    { id: 'smiley', name: 'Smiley', points: [
      ...arc(0.5, 0.5, 0.5, -90, 45, 14), [0.64, 0.66], ...arc(0.5, 0.5, 0.5, 45, 135, 10),  // up the right; right eye
      [0.36, 0.66], ...arc(0.5, 0.5, 0.5, 135, 270, 14),                                   // left eye; down the left
      ...arc(0.5, 0.5, 0.3, 270, 330, 5), ...arc(0.5, 0.5, 0.3, 330, 210, 10), ...arc(0.5, 0.5, 0.3, 210, 270, 5),  // the smile
      [0.5, 0],
    ] },
    { id: 'bird', name: 'Bird', points: [[0, 0.6], [0.15, 0.8], [0.32, 0.82], [0.45, 0.65], [0.5, 0.5], [0.55, 0.65], [0.68, 0.82], [0.85, 0.8], [1, 0.6]] },

    // Halloween
    // Six lobes, with deep creases between them (one at the top, under the stem).
    { id: 'pumpkin', name: 'Pumpkin', theme: 'halloween', points: [
      ...ring(72, t => { const r = 0.84 + 0.16 * Math.abs(Math.sin(3 * t)); return [0.62 * r * Math.sin(t), 0.46 * r * Math.cos(t)]; }),
      [-0.06, 0.4], [-0.05, 0.6], [0.09, 0.66], [0.06, 0.4], [0, 0.3864],  // the stem, and back
    ] },
    { id: 'ghost', name: 'Ghost', theme: 'halloween', points: [
      ...arc(0.5, 0.6, 0.4, 0, 180, 16),
      [0.1, 0], [0.23, 0.12], [0.36, 0], [0.5, 0.12], [0.64, 0], [0.77, 0.12], [0.9, 0], [0.9, 0.6],
    ] },
    { id: 'bat', name: 'Bat', theme: 'halloween', points: mirror([
      [0.5, 0.6], [0.54, 0.72], [0.57, 0.6], [0.65, 0.66], [0.82, 0.74], [1, 0.52],
      [0.9, 0.44], [0.84, 0.5], [0.76, 0.38], [0.69, 0.46], [0.62, 0.32], [0.57, 0.4], [0.53, 0.26], [0.5, 0.24],
    ]) },
    { id: 'hat', name: 'Witch hat', theme: 'halloween', points: [[0, 0.05], [0.35, 0.12], [0.42, 0.6], [0.55, 0.85], [0.85, 1], [0.62, 0.72], [0.6, 0.12], [1, 0.05], [0.5, -0.02], [0, 0.05]] },

    // Christmas
    { id: 'xmastree', name: 'Christmas tree', theme: 'christmas', points: [
      [0.45, 0], [0.45, 0.12], [0.1, 0.12], [0.33, 0.37], [0.2, 0.37], [0.4, 0.6], [0.3, 0.6], [0.5, 0.8],
      ...ring(10, t => { const r = Math.round(t / (Math.PI / 5)) % 2 ? 0.11 : 0.04; return [0.5 + r * Math.sin(t + Math.PI), 0.9 + r * Math.cos(t + Math.PI)]; }),
      [0.5, 0.8], [0.7, 0.6], [0.6, 0.6], [0.8, 0.37], [0.67, 0.37], [0.9, 0.12], [0.55, 0.12], [0.55, 0], [0.45, 0],
    ] },
    { id: 'cane', name: 'Candy cane', theme: 'christmas', points: [
      [0.3, 0], [0.3, 0.7], ...arc(0.6, 0.7, 0.3, 180, 0, 16), [0.9, 0.5], [0.72, 0.5], ...arc(0.6, 0.7, 0.12, 0, 180, 10), [0.48, 0], [0.3, 0],
    ] },
    { id: 'stocking', name: 'Stocking', theme: 'christmas', points: [
      [0.3, 0.85], [0.3, 1], [0.72, 1], [0.72, 0.85], [0.3, 0.85],  // the cuff
      [0.3, 0.15], [0.4, 0.02], [0.6, 0], [0.85, 0.02], [0.95, 0.12], [0.9, 0.28], [0.7, 0.42], [0.7, 0.85], [0.3, 0.85],
    ] },
    { id: 'snowman', name: 'Snowman', theme: 'christmas', points: profile(rows(0, 1, 0.02, y => Math.max(
      circleWidth(0.25, 0.25)(y), circleWidth(0.62, 0.17)(y), circleWidth(0.88, 0.12)(y)))) },
    { id: 'gift', name: 'Gift', theme: 'christmas', points: [
      [0.1, 0], [0.9, 0], [0.9, 0.65], [0.5, 0.65],
      [0.75, 0.72], [0.88, 0.86], [0.7, 0.92], [0.5, 0.65],  // the bow
      [0.3, 0.92], [0.12, 0.86], [0.25, 0.72], [0.5, 0.65],
      [0.5, 0], [0.5, 0.65], [0.1, 0.65], [0.1, 0],
    ] },
    { id: 'bell', name: 'Bell', theme: 'christmas', points: profile([
      [0, 0.5], [0.06, 0.47], [0.14, 0.38], [0.3, 0.32], [0.5, 0.28], [0.66, 0.22], [0.76, 0.15], [0.8, 0.07], [0.86, 0.07], [0.9, 0.04],
    ]) },
    { id: 'gingerbread', name: 'Gingerbread', theme: 'christmas', points: mirror([
      [0.5, 1], ...arc(0.5, 0.82, 0.18, 90, -40, 8).slice(1), [0.6, 0.64],
      [0.92, 0.62], [0.96, 0.52], [0.9, 0.46], [0.63, 0.48], [0.65, 0.28],
      [0.86, 0.06], [0.8, 0], [0.62, 0.02], [0.5, 0.2],
    ]) },
    { id: 'ornament', name: 'Ornament', theme: 'christmas', points: profile([
      ...rows(0, 0.8, 0.04, circleWidth(0.4, 0.4)).map(([y, w]) => [y, Math.max(w, 0.08)]),
      [0.8, 0.1], [0.9, 0.1], [0.9, 0.04], [1, 0.04],
    ]) },

    // Letters and numbers
    ...[...'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'].map(ch => ({ id: `letter-${ch}`, name: ch, theme: 'letters', points: () => bubble(STROKES[ch]) })),
  ];

  // Scaled into a unit box (the longer side 1), centred, with each point's
  // distance along the line. closed: whether it ends where it starts.
  // Worked out the first time a shape is used: letters take a moment each.
  // makeShape does the same for one of your own: { id, name, theme, points }.
  function makeShape({ id, name, theme = 'everyday', points }) {
    const shape = { id, name, theme };
    let done = null;
    const get = () => done || (done = finish(typeof points === 'function' ? points() : points));
    for (const key of ['points', 'along', 'length', 'closed']) {
      Object.defineProperty(shape, key, { get: () => get()[key], enumerable: true });
    }
    return shape;
  }
  const SHAPES = LIBRARY.map(makeShape);

  // A shape as loose or strict as `level` (see RIGOR): the same shape when
  // nothing is smoothed away, otherwise a simpler one with the same id and name.
  const smoothed = new Map();
  function atRigor(shape, level) {
    const { detail } = rigor(level);
    if (!detail) return shape;
    const key = `${shape.id}:${level}`;
    if (!smoothed.has(key) || smoothed.get(key).from !== shape) {
      smoothed.set(key, { from: shape, shape: makeShape({ id: shape.id, name: shape.name, theme: shape.theme, points: () => simplify(shape.points, detail) }) });
    }
    return smoothed.get(key).shape;
  }

  function finish(points) {
    const xs = points.map(p => p[0]), ys = points.map(p => p[1]);
    const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
    const k = 1 / Math.max(x1 - x0, y1 - y0);
    const pts = points.map(([x, y]) => [(x - (x0 + x1) / 2) * k, (y - (y0 + y1) / 2) * k]);
    const along = [0];
    for (let i = 1; i < pts.length; i++) along.push(along[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]));
    const first = pts[0], last = pts[pts.length - 1];
    return { points: pts, along, length: along[along.length - 1], closed: Math.hypot(first[0] - last[0], first[1] - last[1]) < 0.01 };
  }

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
  // Metres across a shape for a route of about `km`, and the reverse.
  const sizeFor = (shape, km) => km * 1000 * OVERHEAD / shape.length;
  const kmFor = (shape, s) => s * shape.length / OVERHEAD / 1000;

  // The placed shape as [lat, lon] points, for drawing.
  const outline = (field, shape, placement) =>
    place(resample(shape, Math.max(60, Math.ceil(shape.length * placement.s / 25))), placement).map(field.toLatLon);

  async function fit(field, shape, { km, free = false }, progress = () => {}) {
    const coarse = resample(shape, SAMPLES), fine = resample(shape, FINE);
    const judge = (points, placement) => score(field, points, placement) + (free ? 0 : UPRIGHT * Math.abs(placement.rot));
    const size = sizeFor(shape, km);  // metres across, for that length
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

  // What Planner.followShape needs for a placement, as strict as `level`
  // (see RIGOR): { targets (graph points to go through, in order), near (each
  // graph point's distance to the shape), corridor, outline ([lat, lon] of
  // the placed shape, for drawing) }.
  function routeInput(graph, field, shape, placement, level = 3) {
    const { every, corridor } = rigor(level);
    const metres = shape.length * placement.s;
    const dense = place(resample(shape, Math.max(2, Math.ceil(metres / 10))), placement);
    const shapeField = distanceField(field.cols, field.rows, dense);
    const near = new Float32Array(graph.lat.length).fill(CAP);
    for (const i of field.nodes) {
      const cell = cellAt(field, field.toXY(graph.lat[i], graph.lon[i]));
      if (cell >= 0) near[i] = Math.min(CAP * 4, shapeField.dist[cell]);
    }
    // Targets: the shape's corners, and points every `every` metres between.
    const unit = place(shape.points, placement);
    const stops = [];
    for (let i = 0; i < unit.length; i++) {
      stops.push(unit[i]);
      if (i < unit.length - 1) {
        const [a, b] = [unit[i], unit[i + 1]];
        const gaps = Math.floor(Math.hypot(b[0] - a[0], b[1] - a[1]) / every);
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
    return { targets, near, corridor, outline: dense.map(field.toLatLon), shapeField };
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

  // The share of a placed shape with a street within NEAR_STREET metres: low
  // when much of it lies off the area's streets (outside it, or in a park).
  const NEAR_STREET = 60;
  function onStreets(field, shape, placement) {
    const points = place(resample(shape, SAMPLES), placement);
    return points.filter(p => streetGap(field, p) <= NEAR_STREET).length / points.length;
  }

  // A small SVG of a shape, for the picker.
  function icon(shape) {
    const pts = shape.points.map(([x, y]) => `${(x + 0.5) * 20 + 2},${(0.5 - y) * 20 + 2}`).join(' ');
    return `<svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true"><polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/></svg>`;
  }

  return { SHAPES, makeShape, atRigor, trace, prepare, fit, routeInput, fidelity, onStreets, icon, outline, sizeFor, kmFor };
})();
