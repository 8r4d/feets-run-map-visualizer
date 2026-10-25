// Streaks and weekly quests: small reasons to go somewhere new.
//
// Both rest on firsts(): going through your activities in the primary sport
// (sport.js) in date order,
// the street each one covered for the first time. A week with at least
// STREAK_MIN metres of new street keeps the streak going. Each week (from
// Monday, as goals do) also gets three quests, made from your own gaps:
// new street in a neighbourhood, a street to finish, and new street anywhere.
//
// Streak shields: finishing every quest of a week earns one (up to
// SHIELD_MAX held). A week that ends without new street, while there's a
// streak to keep, uses one up (useShields): that week bridges the streak
// without adding to it.
//
// Each calendar month also has a boss (makeBoss): one bigger quest, a long
// run or a lot of new street, with that month's legend card for beating it.
//
// And there's always an expedition on the go (makeExpedition): a longer
// quest with no deadline, in a theme with its own cards (Night Sky: get out
// after dark a few times; Garden: get out on 8 different days…). Finishing
// one turns over a card from its theme, and the next comes straight away;
// giving one up brings the next a day later.
//
// Quest limits keep the quests that send you somewhere (a neighbourhood, a
// street, a boss in a neighbourhood) close to home: within a distance of it,
// or in neighbourhoods you tick. The gaps outside them can get one yearly
// quest (makeYearly), for when the streets close by are filling up.
const Quests = (() => {
  const STREAK_MIN = 100;    // metres of new street for a week to count
  const DAY = 86400000;

  // --- What each activity covered first ---

  // Map(track id -> { time, metres, ways: Map(OSM way id -> metres) }): the
  // street each activity in the primary sport covered before any earlier one had. A way in
  // two overlapping areas counts once. Yields to the browser now and then.
  async function firsts(tracks, areas) {
    const sorted = tracks.filter(t => t.time && Sport.counts(t)).sort((a, b) => a.time.localeCompare(b.time));
    const boxes = sorted.map(t => {
      let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const seg of t.segments) for (const [la, lo] of seg) {
        if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo;
      }
      return [s, w, n, e];
    });
    const out = new Map(sorted.map(t => [t.id, { time: t.time, metres: 0, ways: new Map() }]));
    let work = 0;
    for (const area of areas) {
      const prep = Coverage.prepared(area);
      const [bs, bw, bn, be] = prep.bounds;
      const streets = area.data.streets;
      const seen = new Uint8Array(prep.n);
      for (const [i, t] of sorted.entries()) {
        const [s, w, n, e] = boxes[i];
        if (s > bn || n < bs || w > be || e < bw) continue;
        const { visited } = Coverage.compute(prep, [t.segments]);
        const r = out.get(t.id);
        for (let k = 0; k < streets.length; k++) {
          if (prep.excluded[k]) continue;
          const a = prep.first[k], b = prep.first[k + 1];
          let added = 0;
          for (let j = a; j < b; j++) {
            if (visited[j] && !seen[j]) { added++; seen[j] = 1; }
          }
          if (!added) continue;
          const metres = streets[k].len * added / Math.max(1, b - a);
          const id = streets[k].id;
          r.ways.set(id, Math.max(r.ways.get(id) || 0, metres));
        }
        if (++work % 25 === 0) await new Promise(res => setTimeout(res));
      }
    }
    for (const r of out.values()) for (const m of r.ways.values()) r.metres += m;
    return out;
  }

  // --- Weeks and streaks ---

  // The Monday a date's week starts on, at local midnight.
  function weekStart(date) {
    const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }
  const weekId = date => {
    const d = weekStart(date);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };
  // The week before or after (n weeks), safe across daylight saving changes.
  const shiftWeek = (start, n) => new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7 * n);

  // New street per week: Map(week start ms -> metres).
  function byWeek(firstsMap) {
    const weeks = new Map();
    for (const r of firstsMap.values()) {
      if (!r.metres) continue;
      const k = weekStart(new Date(r.time)).getTime();
      weeks.set(k, (weeks.get(k) || 0) + r.metres);
    }
    return weeks;
  }

  // A week id (YYYY-MM-DD, its Monday) as that Monday's local midnight, in ms.
  const weekMs = id => { const [y, m, d] = id.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };

  // { current, best, thisWeek (metres), counted (this week counts yet) }.
  // A streak still running into this week isn't broken until the week ends.
  // shielded: week ids a streak shield covered; they bridge a streak but
  // don't add to it.
  function streak(firstsMap, now = new Date(), shielded = []) {
    const weeks = byWeek(firstsMap);
    const bridged = new Set(shielded.map(weekMs));
    const counts = d => (weeks.get(d.getTime()) || 0) >= STREAK_MIN;
    const thisWeek = weekStart(now);
    const counted = counts(thisWeek);
    let current = 0;
    for (let d = counted ? thisWeek : shiftWeek(thisWeek, -1); counts(d) || bridged.has(d.getTime()); d = shiftWeek(d, -1)) {
      if (counts(d)) current++;
    }
    // The best: the longest run of counting weeks, ever.
    const best = longestRun(countingWeeks(weeks), bridged);
    return { current, best: Math.max(best, current), thisWeek: weeks.get(thisWeek.getTime()) || 0, counted };
  }

  const countingWeeks = weeks => [...weeks.keys()].filter(k => weeks.get(k) >= STREAK_MIN).sort((a, b) => a - b);

  // --- Streak shields ---
  const SHIELD_MAX = 2;

  // The weeks from week id `from` up to (not including) `to` that a shield
  // covers: each that didn't count, while the week before it did (or was
  // shielded), as long as shields last. [week ids].
  function useShields(firstsMap, held, shielded, from, to) {
    const weeks = byWeek(firstsMap);
    const counts = ms => (weeks.get(ms) || 0) >= STREAK_MIN;
    const bridged = new Set(shielded.map(weekMs));
    const out = [];
    for (let d = new Date(weekMs(from)); d.getTime() < weekMs(to) && out.length < held; d = shiftWeek(d, 1)) {
      const before = shiftWeek(d, -1).getTime();
      if (counts(d.getTime()) || !(counts(before) || bridged.has(before))) continue;
      bridged.add(d.getTime());
      out.push(weekId(d));
    }
    return out;
  }

  // --- Streak trophies ---
  // All time: the best streak ever. Each year from Achievements.FIRST_YEAR:
  // the longest streak of weeks starting in that year. [{ code, title, detail }],
  // as Achievements.evaluate gives.
  const STREAK_TROPHIES = [4, 8, 12, 26, 52];

  // The longest run of counting weeks among week starts (ms, ascending).
  // Weeks in `bridged` (ms) join the counting weeks either side of them.
  function longestRun(starts, bridged = new Set()) {
    let best = 0, run = 0, prev = null;
    for (const k of starts) {
      let gap = prev === null ? null : shiftWeek(new Date(prev), 1);
      while (gap && gap.getTime() < k && bridged.has(gap.getTime())) gap = shiftWeek(gap, 1);
      run = gap && gap.getTime() === k ? run + 1 : 1;
      best = Math.max(best, run);
      prev = k;
    }
    return best;
  }

  function streakTrophies(firstsMap, shielded = []) {
    const weeks = byWeek(firstsMap);
    const starts = countingWeeks(weeks);
    const bridged = new Set(shielded.map(weekMs));
    const earned = [];
    const detail = n => `New streets every week for ${n} weeks`;
    const allTime = longestRun(starts, bridged);
    for (const n of STREAK_TROPHIES) if (allTime >= n) earned.push({ code: `streak:${n}`, title: `${n}-week streak`, detail: detail(n) });
    const years = [...new Set(starts.map(k => new Date(k).getFullYear()))].filter(y => y >= Achievements.FIRST_YEAR);
    for (const year of years) {
      const best = longestRun(starts.filter(k => new Date(k).getFullYear() === year), bridged);
      for (const n of STREAK_TROPHIES) {
        if (best >= n) earned.push({ code: `year:${year}:streak:${n}`, title: `${year}: ${n}-week streak`, detail: detail(n) });
      }
    }
    return earned;
  }

  // --- Quests ---
  // { id, kind, title, target (metres), areaId, hood (index, or -1 for the
  // whole area), name and cat (a street), place (a [lat, lon] to show) }:
  //   area: cover `target` metres of new street in a neighbourhood or area;
  //   street: finish a street you've mostly covered;
  //   any: cover `target` metres of new street anywhere.
  const AREA_TARGET = 1000;   // metres, at most
  const STREET_LEFT = 1500;   // metres: a street with more than this left isn't "nearly done"
  const STREET_MIN = 100;     // metres: ... and one with less isn't worth a quest
  const DONE = 0.9;           // as Coverage counts a street done (it allows for GPS drift)

  // A rough middle of some street points.
  function middleOf(runs) {
    let la = 0, lo = 0, n = 0;
    for (const run of runs) for (let i = 0; i < run.length; i += 4) { la += run[i][0]; lo += run[i][1]; n++; }
    return n ? [la / n, lo / n] : null;
  }
  const away = ([a, b], [c, d]) => Planner.distance(a, b, c, d);

  // The gaps quests are made from: neighbourhoods (or areas without any)
  // with new street left, and named streets mostly covered. coverageFor(area):
  // Coverage.compute's result for the area with every activity in the primary sport.
  // all: every neighbourhood (or area without any), gaps or not, with its
  // len and covered metres, for localShare.
  function gaps(areas, coverageFor) {
    const units = [], streetsLeft = [], all = [];
    for (const area of areas) {
      const prep = Coverage.prepared(area);
      const summary = Coverage.summarize(prep, coverageFor(area));
      const { streets, hoods } = area.data;
      const tally = t => Object.values(t).reduce((s, c) => ({ len: s.len + c.len, covered: s.covered + c.covered }), { len: 0, covered: 0 });
      const add = (hood, name, t) => {
        const runs = streets.filter(s => hood < 0 || s.hood === hood).flatMap(s => s.runs);
        const unit = { areaId: area.id, hood, name, left: t.len - t.covered, place: middleOf(runs) };
        all.push({ ...unit, len: t.len, covered: t.covered });
        if (unit.left < Sport.scaled(AREA_TARGET) / 2 || t.covered / Math.max(1, t.len) > 0.95) return;
        units.push(unit);
      };
      if (hoods.length) summary.byHood.forEach((t, h) => add(h, hoods[h].name, tally(t)));
      else add(-1, area.name, tally(summary.total));
      for (const g of summary.groups) {
        const left = g.len * DONE - g.covered;  // until it counts as done
        if (!g.name || g.done || g.covered / g.len < 0.3 || left > STREET_LEFT || left < STREET_MIN) continue;
        streetsLeft.push({ areaId: area.id, hood: g.hood, name: g.name, cat: g.cat, left, place: middleOf(g.ways.flatMap(w => streets[w].runs)) });
      }
    }
    return { units, streetsLeft, all };
  }

  const nearestTo = near => list => list.filter(x => x.place).sort((a, b) => away(a.place, near) - away(b.place, near))[0];

  // --- Quest limits ---
  // { mode, range, hoods, yearly } (saved with the quests; null is anywhere):
  //   mode 'range': only gaps whose middle is within `range` metres of home;
  //   mode 'hoods': only gaps in the ticked neighbourhoods, hoods: ['areaId:hood'],
  //   hood -1 for an area without any (or a street outside them);
  //   yearly: a yearly quest in the gaps outside (see makeYearly).
  // Anything else is anywhere. They only hold quests that send you somewhere:
  // new street anywhere, long runs and expeditions go wherever you do.
  const hoodKey = (areaId, hood) => `${areaId}:${hood}`;
  const limited = limits => Boolean(limits
    && ((limits.mode === 'range' && limits.range > 0) || (limits.mode === 'hoods' && limits.hoods && limits.hoods.length)));
  // Whether a gap (from gaps()) is inside the limits. home: [lat, lon].
  function inLimits(gap, limits, home) {
    if (!limited(limits)) return true;
    if (limits.mode === 'hoods') return limits.hoods.includes(hoodKey(gap.areaId, gap.hood));
    return Boolean(gap.place && home) && away(gap.place, home) <= limits.range;
  }

  // How much of the streets inside the limits is covered, 0 to 1: how full
  // close to home is getting. null with no limits, or no streets inside.
  function localShare(areas, coverageFor, limits, home) {
    if (!limited(limits)) return null;
    const inside = gaps(areas, coverageFor).all.filter(u => inLimits(u, limits, home));
    const len = inside.reduce((s, u) => s + u.len, 0);
    return len ? inside.reduce((s, u) => s + u.covered, 0) / len : null;
  }

  // New street in a usual recent week: the last 8 weeks' average, in metres.
  function usualWeek(firstsMap, now) {
    const weeks = byWeek(firstsMap);
    let sum = 0;
    for (let i = 1; i <= 8; i++) sum += weeks.get(shiftWeek(weekStart(now), -i).getTime()) || 0;
    return sum / 8;
  }

  // This week's quests. coverageFor(area): Coverage.compute's result for the
  // area with every activity in the primary sport. near: where to look first
  // ([lat, lon]), and home for the limits. With none left inside the limits,
  // there's no neighbourhood or street quest that week.
  function make(areas, coverageFor, firstsMap, near, now = new Date(), limits = null) {
    const week = weekId(now);
    const quests = [];
    const inside = g => inLimits(g, limits, near);
    const { units, streetsLeft } = gaps(areas, coverageFor);
    const nearest = nearestTo(near);

    const unit = nearest(units.filter(inside));
    if (unit) {
      const target = Math.max(200, Math.min(Sport.scaled(AREA_TARGET), Math.round(unit.left / 2 / 100) * 100));
      quests.push({ id: `${week}:area`, kind: 'area', title: `Cover ${kmText(target)} of new streets in ${unit.name}`, where: unit.name, target, areaId: unit.areaId, hood: unit.hood, place: unit.place });
    }
    const street = nearest(streetsLeft.filter(inside));
    if (street) {
      quests.push({ id: `${week}:street`, kind: 'street', title: `Finish ${street.name}`, target: Math.round(street.left), areaId: street.areaId, hood: street.hood, name: street.name, cat: street.cat, place: street.place });
    }
    // Anywhere: a little more than a usual recent week, rounded to half a km.
    const usual = usualWeek(firstsMap, now);
    const target = Math.min(Sport.scaled(10000), Math.max(Sport.scaled(1000), Math.round(usual * 1.2 / 500) * 500));
    quests.push({ id: `${week}:any`, kind: 'any', title: `Cover ${kmText(target)} of new streets anywhere`, target });
    return { week, quests };
  }

  // --- Monthly bosses ---
  // { id: boss:YYYY-MM, month, kind, target (metres), since (Unix ms),
  //   legend (a Cards legend id), areaId, hood, where, place }:
  //   long: one activity of `target` metres this month;
  //   area: `target` metres of new street in a neighbourhood or area;
  //   any: `target` metres of new street anywhere.
  // Which kind goes by the month, from the kinds there's data for. A boss
  // made partway through a month (the first one, say) is scaled to the days
  // left. Only activities from `since` count: from here on, like XP.
  // A long-run boss's distances come from the primary sport (sport.js):
  // for running, never more than a half marathon. Other targets are scaled
  // to it (Sport.scaled).
  const BOSS_KINDS = ['long', 'area', 'any'];
  const monthId = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  const monthEnd = d => new Date(d.getFullYear(), d.getMonth() + 1, 1);
  const round = (m, step) => Math.round(m / step) * step;

  // tracks: activities in the primary sport, for the long run. A boss in a
  // neighbourhood keeps to the limits, as the week's quests do.
  function makeBoss(areas, coverageFor, firstsMap, tracks, near, now = new Date(), limits = null) {
    const days = (monthEnd(now) - new Date(now.getFullYear(), now.getMonth(), 1)) / DAY;
    const share = Math.max(0.25, (monthEnd(now) - now) / DAY / days);
    const unit = nearestTo(near)(gaps(areas, coverageFor).units.filter(g => inLimits(g, limits, near)));
    // The longest of the last 90 days, a little further.
    const recent = tracks.filter(t => t.time && now - Date.parse(t.time) < 90 * DAY && Date.parse(t.time) <= now.getTime());
    const longest = Math.max(0, ...recent.map(t => t.distance));
    const long = Sport.current.bossLong;
    const options = {
      long: recent.length ? Math.min(long.max, Math.max(long.min, round(longest * 1.15, 1000))) : long.start,
      area: unit && Math.max(Sport.scaled(1000), Math.min(round(unit.left * 0.6, 500), round(Sport.scaled(5000) * share, 500))),
      any: areas.length ? Math.min(Sport.scaled(20000), Math.max(Sport.scaled(1000), round(usualWeek(firstsMap, now) * 4.3 * 1.5 * share, 500))) : null,
    };
    const kinds = BOSS_KINDS.filter(k => options[k]);
    const kind = kinds[now.getMonth() % kinds.length];
    const boss = { id: `boss:${monthId(now)}`, month: monthId(now), kind, target: options[kind], since: now.getTime(),
      legend: Cards.legend(now.getMonth()).id };
    if (kind === 'area') Object.assign(boss, { areaId: unit.areaId, hood: unit.hood, where: unit.name, place: unit.place });
    return boss;
  }

  function bossTask(boss) {
    if (boss.kind === 'long') return `Go ${kmText(boss.target)} in one go`;
    if (boss.kind === 'area') return `Cover ${kmText(boss.target)} of new streets in ${boss.where}`;
    return `Cover ${kmText(boss.target)} of new streets this month`;
  }

  // "🏔️ The Yeti: Go 12 km in one go"
  const bossTitle = boss => { const l = Cards.legend(Number(boss.month.slice(5)) - 1); return `${l.icon} ${l.name}: ${bossTask(boss)}`; };

  // How far along a boss is: { have, of, done } in metres; for a long run,
  // `have` is the longest so far.
  function bossProgress(boss, areas, firstsMap, tracks) {
    const [y, m] = boss.month.split('-').map(Number);
    const from = Math.max(boss.since, new Date(y, m - 1, 1).getTime()), to = new Date(y, m, 1).getTime();
    const within = time => { const t = Date.parse(time); return t >= from && t < to; };
    const have = boss.kind === 'long'
      ? Math.max(0, ...tracks.filter(t => t.time && within(t.time)).map(t => t.distance))
      : newStreet(firstsMap, from, to, boss.kind === 'area' ? hoodWays(boss, areas) : null);
    return { have, of: boss.target, done: have >= boss.target };
  }

  // The OSM way ids of a quest's neighbourhood (or whole area, hood -1): a Set.
  function hoodWays(q, areas) {
    const area = areas.find(a => a.id === q.areaId);
    return new Set(area ? area.data.streets.filter(s => q.hood < 0 || s.hood === q.hood).map(s => s.id) : []);
  }

  // Metres of new street from `from` until `to` (Unix ms), in `ways` (a Set
  // of OSM way ids), or anywhere when null.
  function newStreet(firstsMap, from, to, ways) {
    let have = 0;
    for (const r of firstsMap.values()) {
      const t = Date.parse(r.time);
      if (t < from || t >= to) continue;
      for (const [id, metres] of r.ways) if (!ways || ways.has(id)) have += metres;
    }
    return have;
  }

  // --- The yearly quest further afield ---
  // { id: year:YYYY, year, kind: 'area', target (metres), since (Unix ms),
  //   areaId, hood, where, place }: new street, any time that year, in the
  // nearest neighbourhood (or area) with gaps outside the quest limits. One
  // trip, or a few, to somewhere you wouldn't go on an average day. null
  // without limits, or with no gaps outside them. Only from `since`, like a boss.
  function makeYearly(areas, coverageFor, limits, near, now = new Date()) {
    if (!limited(limits)) return null;
    const unit = nearestTo(near)(gaps(areas, coverageFor).units.filter(g => !inLimits(g, limits, near)));
    if (!unit) return null;
    const target = Math.min(round(unit.left * 0.9, 100), Sport.scaled(4000), Math.max(Sport.scaled(1000), round(unit.left * 0.6, 500)));
    return { id: `year:${now.getFullYear()}`, year: now.getFullYear(), kind: 'area', target, since: now.getTime(),
      areaId: unit.areaId, hood: unit.hood, where: unit.name, place: unit.place };
  }

  const yearlyTitle = y => `Cover ${kmText(y.target)} of new streets in ${y.where} this year`;

  // How far along the yearly quest is: { have, of, done } in metres.
  function yearlyProgress(y, areas, firstsMap) {
    const from = Math.max(y.since, new Date(y.year, 0, 1).getTime()), to = new Date(y.year + 1, 0, 1).getTime();
    const have = newStreet(firstsMap, from, to, hoodWays(y, areas));
    return { have, of: y.target, done: have >= y.target };
  }

  // --- Expeditions ---
  // { id, theme, goal, since (Unix ms) }: the goal is in the theme's unit
  // (EXPEDITIONS), and only activities from `since` count. Goals in metres
  // (scaled) are for running, scaled to the primary sport when one is made.
  const EXPEDITIONS = {
    sky: { goal: 4, task: n => `Get out after dark ${n} times` },
    daybreak: { goal: 3, task: n => `Start ${n} ${Sport.current.nouns} around sunrise` },
    wild: { goal: 3000, task: m => `Cover ${kmText(m)} of trails`, km: true, scaled: true },
    mapmaker: { goal: 3000, task: m => `Cover ${kmText(m)} of streets you've never ${Sport.current.done}`, km: true, scaled: true },
    voyage: { goal: 40000, task: m => `Go ${kmText(m)} in all`, km: true, scaled: true },
    peaks: { goal: 400, task: m => `Climb ${m.toLocaleString()} m in all`, scaled: true },
    garden: { goal: 8, task: n => `Get out on ${n} different days` },
  };

  // How high the sun is, in degrees, at a time and place (a short version of
  // the usual almanac formulas: good to a degree or so, plenty for "is it dark").
  function sunAltitude(ms, lat, lon) {
    const rad = Math.PI / 180;
    const d = ms / DAY - 10957.5;  // days since noon, 1 January 2000 (UTC)
    const g = (357.529 + 0.98560028 * d) * rad;
    const ecliptic = (280.459 + 0.98564736 * d + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
    const tilt = (23.439 - 0.00000036 * d) * rad;
    const ra = Math.atan2(Math.cos(tilt) * Math.sin(ecliptic), Math.cos(ecliptic));
    const dec = Math.asin(Math.sin(tilt) * Math.sin(ecliptic));
    const hourAngle = ((18.697374558 + 24.06570982441908 * d) * 15 + lon) * rad - ra;
    return Math.asin(Math.sin(lat * rad) * Math.sin(dec) + Math.cos(lat * rad) * Math.cos(dec) * Math.cos(hourAngle)) / rad;
  }
  const DARK = -6;  // degrees: the sun this far below the horizon is the end of twilight

  const startOf = t => { const seg = (t.segments || []).find(g => g.length); return seg ? seg[0] : null; };
  // Dark at its start or its finish.
  function afterDark(t) {
    const at = startOf(t);
    if (!at) return false;
    const start = Date.parse(t.time), end = start + ((t.metrics && (t.metrics.elapsed || t.metrics.moving)) || 0) * 1000;
    return sunAltitude(start, at[0], at[1]) < DARK || sunAltitude(end, at[0], at[1]) < DARK;
  }
  // Started within about 45 minutes of sunrise: the sun low and climbing.
  function aroundSunrise(t) {
    const at = startOf(t);
    if (!at) return false;
    const ms = Date.parse(t.time), now = sunAltitude(ms, at[0], at[1]);
    return now > DARK && now < 6 && sunAltitude(ms + 900000, at[0], at[1]) > now;
  }

  // Metres of trail (dirt paths, cat 'trail') a run covered, in every area.
  function trailMetres(t, areas) {
    let m = 0;
    for (const area of areas) {
      const prep = Coverage.prepared(area);
      const { fraction } = Coverage.compute(prep, [t.segments]);
      area.data.streets.forEach((s, w) => { if (s.cat === 'trail' && !prep.excluded[w]) m += s.len * fraction[w]; });
    }
    return m;
  }

  // A new expedition: a theme with cards still to turn over, not `last`
  // (unless it's the only one), and only Wild Trails and Cartographer when
  // there are areas to do them in. null when every theme is complete.
  // themes: Cards.expeditionThemes.
  function makeExpedition(themes, areas, last = null, now = Date.now(), random = Math.random) {
    const hasTrails = areas.some(a => a.data.streets.some(s => s.cat === 'trail'));
    const usable = themes.filter(th => EXPEDITIONS[th.id] && (th.id !== 'wild' || hasTrails) && (th.id !== 'mapmaker' || areas.length));
    const fresh = usable.filter(th => th.id !== last);
    const pool = fresh.length ? fresh : usable;
    if (!pool.length) return null;
    const theme = pool[Math.floor(random() * pool.length)];
    const { goal, scaled } = EXPEDITIONS[theme.id];
    return { id: `exp:${now}`, theme: theme.id, goal: scaled ? Sport.scaled(goal, 100) : goal, since: now };
  }

  const expeditionTask = exp => EXPEDITIONS[exp.theme].task(exp.goal);

  // How far along an expedition is: { have, of, done }, in its unit. tracks:
  // activities in the primary sport; firstsMap: as from firsts(), for Cartographer.
  function expeditionProgress(exp, tracks, areas, firstsMap) {
    const runs = tracks.filter(t => t.time && Date.parse(t.time) >= exp.since);
    let have = 0;
    switch (exp.theme) {
      case 'sky': have = runs.filter(afterDark).length; break;
      case 'daybreak': have = runs.filter(aroundSunrise).length; break;
      case 'wild': for (const t of runs) have += trailMetres(t, areas); break;
      case 'mapmaker': for (const t of runs) have += (firstsMap.get(t.id) || { metres: 0 }).metres; break;
      case 'voyage': for (const t of runs) have += t.distance || 0; break;
      case 'peaks': for (const t of runs) have += (t.metrics && t.metrics.climb) || 0; break;
      case 'garden': {
        have = new Set(runs.map(t => { const d = new Date(t.time); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; })).size;
        break;
      }
      default: break;
    }
    return { have, of: exp.goal, done: have >= exp.goal, km: Boolean(EXPEDITIONS[exp.theme] && EXPEDITIONS[exp.theme].km) };
  }

  // Whether a quest's street has since been marked off-limits (all of it, as
  // marking a named street does): it can't be finished, so it's swapped out.
  function offLimits(quest, areas) {
    if (quest.kind !== 'street') return false;
    const area = areas.find(a => a.id === quest.areaId);
    if (!area) return false;
    const excluded = new Set(area.excluded || []);
    const ways = area.data.streets.filter(s => s.name === quest.name && s.cat === quest.cat && s.hood === quest.hood);
    return ways.length > 0 && ways.every(s => excluded.has(s.id));
  }

  // "450 m", "2 km", "1.5 km"; in miles "350 ft", "1.2 mi" (see units.js).
  const kmText = m => (Units.miles ? Units.short(Math.max(0, m))
    : m < 1000 ? `${Math.max(0, Math.round(m / 10) * 10)} m` : `${(m / 1000).toFixed(m % 1000 ? 1 : 0)} km`);

  // A quest's title in the chosen units. Saved titles are in the units of
  // whoever's browser made the quest; quests made before `where` was kept
  // fall back to theirs.
  function title(quest) {
    if (quest.kind === 'any') return `Cover ${kmText(quest.target)} of new streets anywhere`;
    if (quest.kind === 'area' && quest.where) return `Cover ${kmText(quest.target)} of new streets in ${quest.where}`;
    return quest.title;
  }

  // How far along a quest is: { have, of, done } in metres. For a street,
  // `have` is how much of it is covered now (all activities), else the new
  // street covered since the week started.
  function progress(quest, areas, coverageFor, firstsMap, now = new Date()) {
    const since = weekStart(now).getTime();
    if (quest.kind === 'street') {
      const area = areas.find(a => a.id === quest.areaId);
      if (!area) return { have: 0, of: quest.target, done: false };
      const summary = Coverage.summarize(Coverage.prepared(area), coverageFor(area));
      const g = summary.groups.find(x => x.name === quest.name && x.cat === quest.cat && x.hood === quest.hood);
      if (!g) return { have: 0, of: quest.target, done: false };
      // Out of the share that counts as done, so the bar fills when it is.
      return { have: Math.min(g.covered, g.len * DONE), of: g.len * DONE, done: g.done };
    }
    const have = newStreet(firstsMap, since, Infinity, quest.kind === 'area' ? hoodWays(quest, areas) : null);
    return { have, of: quest.target, done: have >= quest.target };
  }

  return { sunAltitude, makeExpedition, expeditionTask, expeditionProgress, STREAK_MIN, SHIELD_MAX, firsts, streak, streakTrophies, useShields, weekId, monthId, make, makeBoss, bossTitle,
    bossProgress, offLimits, progress, kmText, title, limited, inLimits, hoodKey, localShare, makeYearly, yearlyTitle, yearlyProgress };
})();
