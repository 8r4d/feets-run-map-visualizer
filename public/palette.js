// What "seasonal" in the palette picker shows on a given day: the season
// (northern, by month), or for a few days around some holidays a palette of
// their own that the picker doesn't list. Loaded in the <head> of index.html
// and race.html, before anything draws; app.js uses it too.
const Palette = (() => {
  // Easter Sunday (Gregorian), as [month 0-11, day].
  function easter(y) {
    const a = y % 19, b = Math.floor(y / 100), c = y % 100;
    const d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
    const n = h + l - 7 * m + 114;
    return [Math.floor(n / 31) - 1, n % 31 + 1];
  }

  // Each holiday: its day, and how many days before and after it shows.
  const HOLIDAYS = [
    { palette: 'newyear', on: () => [0, 1], before: 2, after: 1 },
    { palette: 'valentine', on: () => [1, 14], before: 2, after: 0 },
    { palette: 'stpatrick', on: () => [2, 17], before: 2, after: 0 },
    { palette: 'easter', on: easter, before: 2, after: 1 },  // Good Friday to Easter Monday
    { palette: 'canada', on: () => [6, 1], before: 2, after: 1 },
    { palette: 'halloween', on: () => [9, 31], before: 4, after: 0 },
    { palette: 'christmas', on: () => [11, 25], before: 5, after: 1 },
  ];

  const DAY = 86400000;
  function holiday(date = new Date()) {
    const today = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
    for (const h of HOLIDAYS) {
      // This year's, and next year's for New Year's Eve.
      for (const y of [date.getFullYear(), date.getFullYear() + 1]) {
        const [m, d] = h.on(y);
        const off = (today - Date.UTC(y, m, d)) / DAY;
        if (off >= -h.before && off <= h.after) return h.palette;
      }
    }
    return null;
  }

  const season = (date = new Date()) => ['winter', 'spring', 'summer', 'autumn'][Math.floor((date.getMonth() + 1) % 12 / 3)];
  const seasonal = (date = new Date()) => holiday(date) || season(date);
  // A palette picked (or ''), as it shows today.
  const resolve = (choice, date = new Date()) => (choice === 'seasonal' ? seasonal(date) : choice);

  return { holiday, season, seasonal, resolve, easter };
})();
