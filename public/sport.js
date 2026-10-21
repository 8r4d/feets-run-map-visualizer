// The primary sport: the one sport a feets site is set up for, chosen by the
// sysop in feets-config.php ('sport': run, walk or cycle) and handed over by
// api.php's `me` (app.js calls use() before anything is worked out). It
// decides which activities count for trophies, quests, cards, streaks, XP,
// fog and stats, and the distances those aim for. Activities of other types
// still go on the map; they just don't count.
//
// run is how feets always worked: its numbers and wording are the ones the
// game had before there was a choice, so a running site is unchanged.
// scale is how far a usual outing goes next to a run, for quest, boss and
// expedition targets. xp is what an activity's km are divided by for its XP:
// [the primary sport's, everything else's], so a ride and a run of about the
// same effort earn about the same.
const Sport = (() => {
  // Tracks with no type (most GPX uploads) count as the primary sport.
  const ON_FOOT = new Set(['Run', 'TrailRun', 'Walk', 'Hike']);
  const onFoot = track => ON_FOOT.has(track.sport);
  const riding = track => /Ride|Bike|Cycl|Velomobile|Handcycle/i.test(track.sport || '');

  const PROFILES = {
    run: {
      id: 'run',
      matches: onFoot,
      scale: 1,
      xp: [1, 3],
      speed: false,           // stats show a pace
      nouns: 'runs', verb: 'Run', done: 'run',
      onWhat: 'on foot',
      bossLong: { min: 5000, start: 8000, max: 21097 },  // never more than a half marathon
      longest: [[10000, '10K'], [21097, 'Half marathon'], [42195, 'Marathon'], [50000, 'Ultra']],
      totalKm: { allTime: [100, 250, 500, 1000, 2500, 5000], yearly: [100, 250, 500, 1000, 2000, 3000] },
      cards: [[5000, '5K', '👟'], [10000, '10K', '🏃'], [15000, '15K', '🌤️'], [21097, 'Half marathon', '🥈'],
        [30000, '30K', '⛰️'], [42195, 'Marathon', '🥇'], [50000, 'Ultra', '🦄', '50 km']],
      efforts: { 1000: '1K', 5000: '5K', 10000: '10K', 21097: 'half marathon', 42195: 'marathon' },
    },
    walk: {
      id: 'walk',
      matches: onFoot,
      scale: 0.5,
      xp: [1, 3],
      speed: false,
      nouns: 'walks', verb: 'Walk', done: 'walked',
      onWhat: 'on foot',
      bossLong: { min: 3000, start: 5000, max: 21097 },
      longest: [[5000, '5K'], [10000, '10K'], [21097, 'Half marathon'], [42195, 'Marathon']],
      totalKm: { allTime: [50, 100, 250, 500, 1000, 2500], yearly: [50, 100, 250, 500, 1000, 1500] },
      cards: [[3000, '3K', '👟'], [5000, '5K', '🚶'], [10000, '10K', '🌤️'], [15000, '15K', '🥾'],
        [21097, 'Half marathon', '🥈'], [30000, '30K', '⛰️'], [42195, 'Marathon', '🥇']],
      efforts: { 1000: '1K', 5000: '5K', 10000: '10K', 21097: 'half marathon', 42195: 'marathon' },
    },
    cycle: {
      id: 'cycle',
      matches: riding,
      scale: 3,
      xp: [3, 1],
      speed: true,            // stats show a speed
      nouns: 'rides', verb: 'Ride', done: 'ridden',
      onWhat: 'by bike',
      bossLong: { min: 15000, start: 25000, max: 100000 },
      longest: [[50000, '50 km'], [100000, '100 km'], [160934, 'Century'], [200000, '200 km'], [300000, '300 km']],
      totalKm: { allTime: [250, 500, 1000, 2500, 5000, 10000, 25000], yearly: [250, 500, 1000, 2500, 5000, 7500, 10000] },
      cards: [[20000, '20 km', '🚲'], [40000, '40 km', '🌤️'], [60000, '60 km', '🛤️'], [80000, '80 km', '⛰️'],
        [100000, '100 km', '🥈'], [160934, 'Century', '🥇', '100 miles'], [200000, '200 km', '🦄']],
      efforts: { 1000: '1 km', 5000: '5 km', 10000: '10 km', 21097: '21 km', 42195: '42 km' },
    },
  };

  let current = PROFILES.run;

  // Set from api.php's `me`; anything unknown stays as it was.
  function use(id) {
    if (PROFILES[id]) current = PROFILES[id];
  }

  // Whether an activity counts toward the primary sport.
  const counts = track => !track.sport || current.matches(track);

  // A distance target for a run, scaled to the primary sport and rounded to `step` metres.
  const scaled = (metres, step = 500) => Math.max(step, Math.round(metres * current.scale / step) * step);

  return { use, counts, scaled, PROFILES, get current() { return current; } };
})();
