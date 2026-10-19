// Experience points and levels: a motivational extra, private to each account.
//
// XP only counts from here on: each account has a `since` (api.php sets it
// the first time feets opens after XP came in, to a day before, so that
// day's run still counts), and an activity only earns
// anything if it was recorded after that AND added within ADD_WINDOW of
// being recorded. So importing years of old runs, today or later, earns
// nothing; a run synced from your watch or Strava the same week does.
//
// Two kinds of event, each with a `ref` the server's ledger keeps once:
// - worked out from your data (events below), so any device finds the same
//   ones: each activity, the new streets it covered, a new best over 1K, 5K,
//   10K, half or marathon, a new best on a segment, and each week that kept
//   the new-streets streak going
// - awarded as they happen, by app.js: finishing a weekly quest, and earning
//   a trophy (not when a check earns more than TROPHY_BATCH at once, which is
//   an import, not a run)
// Deleting an activity takes away what it earned (api.php does that).
const Xp = (() => {
  const DAY = 86400000;
  const ADD_WINDOW = 7 * DAY;
  const POINTS = { quest: 50, streak: 25, trophy: 15, segment: 20, best: 40 };
  const TROPHY_BATCH = 3;
  const BEST_NAMES = { 1000: '1K', 5000: '5K', 10000: '10K', 21097: 'half marathon', 42195: 'marathon' };

  const timeOf = t => Date.parse(t.time);

  // Whether an activity earns XP: recorded after `since`, added within a week
  // of that, and with times (so not a planned route saved as GPX).
  function counts(track, since) {
    const at = timeOf(track);
    const added = track.addedAt ?? Date.now();
    return at >= since && added - at <= ADD_WINDOW && Boolean(track.metrics && track.metrics.moving);
  }

  // An activity's own points: 10, and more the longer it is, but less and
  // less for each extra km, so a long run doesn't outdo a week of short ones.
  // Rides count a third of the distance.
  function activityPoints(track, onFoot) {
    const km = track.distance / 1000 / (onFoot ? 1 : 3);
    return 10 + Math.round(10 * Math.sqrt(Math.max(0, km)));
  }

  // The events worked out from data: [{ kind, ref, track, points, detail }].
  //   tracks: every activity (all of it, old ones too: a best is a best
  //     against everything you've done)
  //   onFoot(track): whether it was on foot (Stats.onFoot)
  //   firsts: Quests.firsts' map, or null before it's worked out
  //   segments: [{ id, name, efforts: { track id: [[start, seconds], ...] } }]
  //   weekId(date) (the Monday it's in, as YYYY-MM-DD) and streakMin: from Quests
  function events({ since, tracks, onFoot, firsts = null, segments = [], weekId, streakMin }) {
    const out = [];
    const sorted = tracks.filter(t => t.time && !isNaN(timeOf(t))).sort((a, b) => timeOf(a) - timeOf(b) || a.id - b.id);
    // The same activity twice (from Strava and a file, say): only the first counts.
    const seen = [];
    const earning = new Set(sorted.filter(t => {
      if (!counts(t, since)) return false;
      if (seen.some(s => Math.abs(timeOf(s) - timeOf(t)) < 60000 && Math.abs(s.distance - t.distance) < 500)) return false;
      seen.push(t);
      return true;
    }).map(t => t.id));

    for (const t of sorted) {
      if (!earning.has(t.id)) continue;
      out.push({ kind: 'activity', ref: `activity:${t.id}`, track: t.id, points: activityPoints(t, onFoot(t)), detail: t.name });
      const fresh = firsts && firsts.get(t.id);
      const streetPoints = fresh ? Math.round(fresh.metres / 100) : 0;  // 10 a km
      if (streetPoints >= 1) {
        out.push({ kind: 'streets', ref: `streets:${t.id}`, track: t.id, points: streetPoints, detail: `New streets: ${t.name}` });
      }
    }

    // Bests over the standard distances, on foot: faster than every earlier
    // activity (the first time doesn't count: there's nothing to beat).
    const best = {};
    for (const t of sorted) {
      const efforts = (onFoot(t) && t.metrics && t.metrics.efforts) || {};
      for (const [d, seconds] of Object.entries(efforts)) {
        if (earning.has(t.id) && best[d] !== undefined && seconds < best[d]) {
          out.push({ kind: 'best', ref: `best:${d}:${t.id}`, track: t.id, points: POINTS.best, detail: `New ${BEST_NAMES[d] || `${d} m`} best: ${t.name}` });
        }
        if (best[d] === undefined || seconds < best[d]) best[d] = seconds;
      }
    }

    // Segment bests: faster than every earlier effort on that segment.
    const byId = new Map(tracks.map(t => [t.id, t]));
    for (const seg of segments) {
      const efforts = [];
      for (const [id, list] of Object.entries(seg.efforts || {})) {
        for (const [start, seconds] of list) if (byId.has(Number(id))) efforts.push({ id: Number(id), start, seconds });
      }
      efforts.sort((a, b) => a.start - b.start);
      let fastest = Infinity;
      for (const e of efforts) {
        if (earning.has(e.id) && fastest < Infinity && e.seconds < fastest) {
          out.push({ kind: 'segment', ref: `segment:${seg.id}:${e.id}:${e.start}`, track: e.id, points: POINTS.segment, detail: `Segment best: ${seg.name}` });
        }
        fastest = Math.min(fastest, e.seconds);
      }
    }

    // Streak weeks: a week since XP started whose earning activities covered
    // at least streakMin metres of new street.
    if (firsts) {
      const weeks = new Map();
      for (const t of sorted) {
        const r = earning.has(t.id) && firsts.get(t.id);
        if (!r || !r.metres) continue;
        const k = weekId(new Date(timeOf(t)));
        weeks.set(k, (weeks.get(k) || 0) + r.metres);
      }
      for (const [week, metres] of weeks) {
        if (metres >= streakMin) out.push({ kind: 'streak', ref: `streak:${week}`, points: POINTS.streak, detail: `New streets the week of ${week}` });
      }
    }
    return out;
  }

  // XP for quests just finished: Quests' quest objects.
  const questEvents = (quests, title) => quests.map(q => ({ kind: 'quest', ref: `quest:${q.id}`, points: POINTS.quest, detail: `Quest: ${title(q)}` }));

  // XP for trophies just earned, unless there are so many it's an import.
  const trophyEvents = trophies => (trophies.length > TROPHY_BATCH ? []
    : trophies.map(a => ({ kind: 'trophy', ref: `trophy:${a.code}`, points: POINTS.trophy, detail: `Trophy: ${a.title}` })));

  // XP from one level to the next: 200 for level 1 to 2, then 50 more each level.
  const toNext = level => 150 + 50 * level;

  // { level, into (XP into this level), need (XP this level takes) }.
  function level(total) {
    let lvl = 1, left = total;
    while (left >= toNext(lvl)) { left -= toNext(lvl); lvl++; }
    return { level: lvl, into: left, need: toNext(lvl) };
  }

  return { events, questEvents, trophyEvents, level, counts, activityPoints, POINTS, ADD_WINDOW, TROPHY_BATCH };
})();
