// Stats for a set of tracks (app.js passes the ones matching the filters, so
// the Year filter is the time frame). Tracks have a distance, a start time, a
// type and, once api.php has worked them out, metrics: moving and elapsed
// seconds, climb in metres and best efforts (null where the GPX had no times
// or elevations). Days are local calendar days; tracks without a time count
// toward distance but not toward days, streaks, weeks or months.
//
// Also distance goals per week or month (see goal), and which tracks count as
// on foot: pace and fastest times only make sense for those.
const Stats = (() => {
  const DAY = 86400000;
  // Tracks with no type (most GPX uploads) count as on foot, as in achievements.js.
  const ON_FOOT = new Set(['Run', 'TrailRun', 'Walk', 'Hike']);
  const onFoot = track => !track.sport || ON_FOOT.has(track.sport);
  const EFFORTS = [1000, 5000, 10000, 21097, 42195];  // as in api.php

  // A local calendar day as a whole number, safe across daylight saving changes.
  const dayNumber = date => Math.round(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / DAY);
  const dateOf = n => new Date(n * DAY);  // midnight UTC: format with timeZone 'UTC'

  // Days in a row with at least one activity: the longest run, and the one
  // ending today or yesterday (so it's still alive).
  function streaks(days, today) {
    let longest = { days: 0, start: 0, end: 0 };
    let start = null;
    for (let i = 0; i < days.length; i++) {
      if (i === 0 || days[i] !== days[i - 1] + 1) start = days[i];
      const length = days[i] - start + 1;
      if (length > longest.days) longest = { days: length, start, end: days[i] };
    }
    let current = 0;
    const last = days[days.length - 1];
    if (last !== undefined && today - last <= 1) {
      current = 1;
      for (let i = days.length - 1; i > 0 && days[i - 1] === days[i] - 1; i--) current++;
    }
    return { longest: { days: longest.days, start: dateOf(longest.start), end: dateOf(longest.end) }, current };
  }

  // tracks: { distance (metres), time, sport, name }. now: today, for the
  // current streak and weekly average. Returns { count, metres, average,
  // weeklyAverage, activeDays, longestTrack, streaks: { longest: { days,
  // start, end }, current }, bestWeek: { start, metres }, bestMonth: { month
  // ('YYYY-MM'), metres }, byType: [{ sport, count, metres }], moving: {
  // seconds, count }, pace (seconds per km on foot), climb: { metres, count,
  // most }, fastest: [{ metres, seconds, track }] }, with null (or nothing in
  // a list) for anything there's no data for.
  function summarize(tracks, now = new Date()) {
    const metres = tracks.reduce((sum, t) => sum + t.distance, 0);
    const longestTrack = tracks.reduce((best, t) => (!best || t.distance > best.distance ? t : best), null);

    const byDay = new Map();  // day number -> metres
    const byWeek = new Map();  // Monday's day number -> metres
    const byMonth = new Map();  // 'YYYY-MM' -> metres
    for (const t of tracks) {
      if (!t.time) continue;
      const date = new Date(t.time);
      const day = dayNumber(date);
      byDay.set(day, (byDay.get(day) || 0) + t.distance);
      const monday = day - ((date.getDay() + 6) % 7);
      byWeek.set(monday, (byWeek.get(monday) || 0) + t.distance);
      const month = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      byMonth.set(month, (byMonth.get(month) || 0) + t.distance);
    }
    const days = [...byDay.keys()].sort((a, b) => a - b);
    const best = map => [...map.entries()].reduce((b, e) => (!b || e[1] > b[1] ? e : b), null);

    const types = new Map();
    for (const t of tracks) {
      const key = t.sport || '';
      const entry = types.get(key) || { sport: t.sport, count: 0, metres: 0 };
      entry.count++;
      entry.metres += t.distance;
      types.set(key, entry);
    }

    // Weekly average over the weeks from the first activity to the last (or
    // to today, if the last was recent enough to still be "now").
    const today = dayNumber(now);
    let weeklyAverage = null;
    if (days.length) {
      const end = today - days[days.length - 1] <= 7 ? today : days[days.length - 1];
      weeklyAverage = metres / Math.max(1, (end - days[0] + 1) / 7);
    }

    // Time and pace: only tracks whose GPX had times.
    const timed = tracks.filter(t => t.metrics && t.metrics.moving);
    const moving = timed.length ? { seconds: timed.reduce((sum, t) => sum + t.metrics.moving, 0), count: timed.length } : null;
    const timedFoot = timed.filter(onFoot);
    const footSeconds = timedFoot.reduce((sum, t) => sum + t.metrics.moving, 0);
    const footMetres = timedFoot.reduce((sum, t) => sum + t.distance, 0);
    const climbed = tracks.filter(t => t.metrics && t.metrics.climb !== null && t.metrics.climb !== undefined);
    const climb = climbed.length ? {
      metres: climbed.reduce((sum, t) => sum + t.metrics.climb, 0),
      count: climbed.length,
      most: climbed.reduce((b, t) => (!b || t.metrics.climb > b.metrics.climb ? t : b), null),
    } : null;
    const fastest = [];
    for (const m of EFFORTS) {
      let top = null;
      for (const t of tracks) {
        const s = onFoot(t) && t.metrics && t.metrics.efforts && t.metrics.efforts[m];
        if (s && (!top || s < top.seconds)) top = { metres: m, seconds: s, track: t };
      }
      if (top) fastest.push(top);
    }

    const week = best(byWeek), month = best(byMonth);
    return {
      count: tracks.length,
      metres,
      average: tracks.length ? metres / tracks.length : 0,
      weeklyAverage,
      activeDays: days.length,
      longestTrack,
      streaks: streaks(days, today),
      bestWeek: week && { start: dateOf(week[0]), metres: week[1] },
      bestMonth: month && { month: month[0], metres: month[1] },
      byType: [...types.values()].sort((a, b) => b.metres - a.metres),
      moving,
      pace: footMetres > 0 ? footSeconds / (footMetres / 1000) : null,
      climb,
      fastest,
    };
  }

  // --- Goals ---
  // Periods are local: weeks start on Monday, as for bestWeek above.
  function periodStart(date, period) {
    const d = new Date(date.getFullYear(), date.getMonth(), period === 'month' ? 1 : date.getDate());
    if (period === 'week') d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return d;
  }

  function shift(start, period, n) {
    const d = new Date(start);
    if (period === 'month') d.setMonth(d.getMonth() + n);
    else d.setDate(d.getDate() + 7 * n);
    return d;
  }

  // Distance on foot in this week or month (period), and in the `past` ones
  // before it. Counts every on-foot track, whatever the filters say, so a
  // goal doesn't change with them. Returns { start, metres, daysLeft (today
  // included), history: [{ start, metres }] oldest first }.
  function goal(tracks, period, now = new Date(), past = 8) {
    const starts = [];
    for (let i = -past; i <= 1; i++) starts.push(shift(periodStart(now, period), period, i).getTime());
    const metres = new Array(past + 1).fill(0);
    for (const t of tracks) {
      if (!t.time || !onFoot(t)) continue;
      const ms = new Date(t.time).getTime();
      for (let i = past; i >= 0; i--) {
        if (ms >= starts[i]) {
          if (ms < starts[i + 1]) metres[i] += t.distance;
          break;
        }
      }
    }
    const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    return {
      start: new Date(starts[past]),
      metres: metres[past],
      daysLeft: Math.round((starts[past + 1] - today) / DAY),
      history: metres.slice(0, past).map((m, i) => ({ start: new Date(starts[i]), metres: m })),
    };
  }

  return { summarize, goal, onFoot };
})();
