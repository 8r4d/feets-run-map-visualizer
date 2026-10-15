// Achievements: milestones worked out from your tracks and street coverage
// areas. api.php only remembers which ones were earned, so once earned they're
// kept even if coverage later drops (a refreshed area gains new streets, say).
//
// They always count every on-foot track, whatever the filters or checkboxes
// say, so hiding tracks can't take a trophy away or earn one.
//
// There are two sets: all-time, and per calendar year from FIRST_YEAR on.
// A year's trophies count only that year's tracks, so "Brander Gardens
// complete" for 2026 means every street run again within 2026.
const Achievements = (() => {
  // Tracks with no type (most GPX uploads) count too.
  const ON_FOOT = new Set(['Run', 'TrailRun', 'Walk', 'Hike']);
  const counts = track => !track.sport || ON_FOOT.has(track.sport);

  const FIRST_YEAR = 2026;  // years before this get no yearly trophies

  const LONGEST = [[10000, '10K'], [21097, 'Half marathon'], [42195, 'Marathon'], [50000, 'Ultra']];
  const ALL_TIME = {
    areaSteps: [25, 50, 75],  // % of an area's length; complete means every street done
    hoodSteps: [50],
    streetKm: [5, 10, 25, 50, 100, 250, 500],  // unique km of street covered, all areas
    hoodsDone: [1, 5, 10, 25],
    totalKm: [100, 250, 500, 1000, 2500, 5000],
    longest: LONGEST,
  };
  const YEARLY = {
    areaSteps: [],
    hoodSteps: [],
    streetKm: [5, 10, 25, 50, 100, 250],
    hoodsDone: [1, 3, 5, 10],
    totalKm: [100, 250, 500, 1000, 2000, 3000],
    longest: LONGEST,
  };

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
  const yearOf = track => (track.time ? new Date(track.time).getFullYear() : null);

  // The milestones in rules that tracks meet. Codes and titles start with
  // prefix and label, e.g. "year:2026:" and "2026: ".
  function milestones(tracks, areas, rules, prefix, label) {
    const earned = [];
    const add = (code, title, detail) => earned.push({ code: prefix + code, title: label + title, detail });
    const segments = tracks.map(t => t.segments);

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
      for (const step of rules.areaSteps) {
        if (pct(total) >= step) add(`area:${area.osmId}:${step}`, `${area.name} ${step}%`, `${fmtKm(total.covered)} of ${fmtKm(total.len)}`);
      }
      if (allDone(total)) add(`area:${area.osmId}:100`, `${area.name} complete`, allStreets(total));

      area.data.hoods.forEach((hood, i) => {
        const t = combine(summary.byHood[i]);
        if (!t.len) return;
        for (const step of rules.hoodSteps) {
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
    for (const n of rules.streetKm) {
      if (streetM >= n * 1000) add(`streets:${n}`, `${n} km of streets`, 'Unique streets, paths and trails covered');
    }
    for (const n of rules.hoodsDone) {
      if (hoodsDone.size >= n) add(`hoods:${n}`, n === 1 ? 'First neighbourhood' : `${n} neighbourhoods`, 'Every street run');
    }

    const totalM = tracks.reduce((sum, t) => sum + t.distance, 0);
    for (const n of rules.totalKm) {
      if (totalM >= n * 1000) add(`distance:${n}`, `${n.toLocaleString()} km`, 'Total distance on foot');
    }
    for (const [m, name] of rules.longest) {
      const first = tracks.filter(t => t.distance >= m)
        .sort((a, b) => (a.time || '9').localeCompare(b.time || '9'))[0];
      if (first) add(`longest:${m}`, name, `First: ${first.name}`);
    }
    return earned;
  }

  // tracks: every loaded track; areas: as from Store.areas().
  // Returns every achievement currently met: [{ code, title, detail }].
  function evaluate(tracks, areas) {
    const onFoot = tracks.filter(counts);
    const earned = milestones(onFoot, areas, ALL_TIME, '', '');
    const years = [...new Set(onFoot.map(yearOf))].filter(y => y >= FIRST_YEAR).sort();
    for (const year of years) {
      earned.push(...milestones(onFoot.filter(t => yearOf(t) === year), areas, YEARLY, `year:${year}:`, `${year}: `));
    }
    return earned;
  }

  // The year a code belongs to, or null for an all-time one.
  const yearOfCode = code => {
    const m = /^year:(\d{4}):/.exec(code);
    return m ? Number(m[1]) : null;
  };

  return { evaluate, yearOfCode };
})();
