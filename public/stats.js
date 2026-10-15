// Stats for a set of tracks (app.js passes the ones matching the filters, so
// the Year filter is the time frame). Tracks have a distance, a start time and
// a type, but no duration, so there's nothing about pace or time spent.
// Days are local calendar days; tracks without a time count toward distance
// but not toward days, streaks, weeks or months.
const Stats = (() => {
  const DAY = 86400000;

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
    };
  }

  return { summarize };
})();
