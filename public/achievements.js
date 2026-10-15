// Achievements: milestones worked out from your tracks and street coverage
// areas. api.php only remembers which ones were earned, so once earned they're
// kept even if coverage later drops (a refreshed area gains new streets, say).
//
// They always count every on-foot track, whatever the filters or checkboxes
// say, so hiding tracks can't take a trophy away or earn one.
const Achievements = (() => {
  // Tracks with no type (most GPX uploads) count too.
  const ON_FOOT = new Set(['Run', 'TrailRun', 'Walk', 'Hike']);
  const counts = track => !track.sport || ON_FOOT.has(track.sport);

  const AREA_STEPS = [25, 50, 75];       // % of an area's length; 100 means every street done
  const HOOD_STEPS = [50];
  const STREET_KM = [5, 10, 25, 50, 100, 250, 500];  // unique km of street covered, all areas
  const HOODS_DONE = [1, 5, 10, 25];
  const TOTAL_KM = [100, 250, 500, 1000, 2500, 5000];
  const LONGEST = [[10000, '10K'], [21097, 'Half marathon'], [42195, 'Marathon'], [50000, 'Ultra']];

  // Coverage.prepare is slow-ish, so keep it per area until the area changes.
  const preps = new WeakMap();
  function prepOf(area) {
    const key = JSON.stringify(area.excluded || []);
    const cached = preps.get(area);
    if (cached && cached.key === key) return cached.prep;
    const prep = Coverage.prepare(area, new Set(area.excluded || []));
    preps.set(area, { key, prep });
    return prep;
  }

  // Adds up road, path and trail.
  function combine(t) {
    const all = { len: 0, covered: 0, streets: 0, done: 0 };
    for (const c of Object.values(t)) for (const k in all) all[k] += c[k];
    return all;
  }

  const pct = t => (t.len ? (t.covered / t.len) * 100 : 0);
  const allDone = t => t.streets > 0 && t.done === t.streets;
  const allStreets = t => (t.streets === 1 ? 'Its one street' : `All ${t.streets} streets`);
  const fmtKm = m => (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km';

  // tracks: every loaded track; areas: as from Store.areas().
  // Returns every achievement currently met: [{ code, title, detail }].
  function evaluate(tracks, areas) {
    const segments = tracks.filter(counts).map(t => t.segments);
    const earned = [];
    const add = (code, title, detail) => earned.push({ code, title, detail });

    const wayCover = new Map();  // OSM way id -> covered metres; areas can overlap
    const hoodsDone = new Set();
    for (const area of areas) {
      const prep = prepOf(area);
      const result = Coverage.compute(prep, segments);
      const summary = Coverage.summarize(prep, result);
      area.data.streets.forEach((s, w) => {
        if (prep.excluded[w]) return;
        wayCover.set(s.id, Math.max(wayCover.get(s.id) || 0, s.len * result.fraction[w]));
      });

      const total = combine(summary.total);
      for (const step of AREA_STEPS) {
        if (pct(total) >= step) add(`area:${area.osmId}:${step}`, `${area.name} ${step}%`, `${fmtKm(total.covered)} of ${fmtKm(total.len)}`);
      }
      if (allDone(total)) add(`area:${area.osmId}:100`, `${area.name} complete`, allStreets(total));

      area.data.hoods.forEach((hood, i) => {
        const t = combine(summary.byHood[i]);
        if (!t.len) return;
        for (const step of HOOD_STEPS) {
          if (pct(t) >= step) add(`hood:${area.osmId}:${hood.name}:${step}`, `${hood.name} ${step}%`, `${fmtKm(t.covered)} of ${fmtKm(t.len)}`);
        }
        if (allDone(t)) {
          add(`hood:${area.osmId}:${hood.name}:100`, `${hood.name} complete`, allStreets(t));
          hoodsDone.add(hood.name);
        }
      });
    }

    let streetM = 0;
    for (const m of wayCover.values()) streetM += m;
    for (const n of STREET_KM) {
      if (streetM >= n * 1000) add(`streets:${n}`, `${n} km of streets`, 'Unique streets, paths and trails covered');
    }
    for (const n of HOODS_DONE) {
      if (hoodsDone.size >= n) add(`hoods:${n}`, n === 1 ? 'First neighbourhood' : `${n} neighbourhoods`, 'Every street run');
    }

    const onFoot = tracks.filter(counts);
    const totalM = onFoot.reduce((sum, t) => sum + t.distance, 0);
    for (const n of TOTAL_KM) {
      if (totalM >= n * 1000) add(`distance:${n}`, `${n.toLocaleString()} km`, 'Total distance on foot');
    }
    for (const [m, label] of LONGEST) {
      const first = onFoot.filter(t => t.distance >= m)
        .sort((a, b) => (a.time || '9').localeCompare(b.time || '9'))[0];
      if (first) add(`longest:${m}`, label, `First: ${first.name}`);
    }
    return earned;
  }

  return { evaluate };
})();
