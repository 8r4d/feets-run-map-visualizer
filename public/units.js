// Units: kilometres and metres, or miles and feet. Everything is stored in
// metres (or km); only what's shown, and typed into boxes, is converted.
//
// The units: the ones picked (feets-units), else miles for a browser set to
// US or Liberian English, else km. Picking reloads the page, as the language
// picker does, so nothing drawn in the old units is left behind.
const Units = (() => {
  const MILE = 1609.344, FOOT = 0.3048;
  const NAMES = { km: 'Kilometres', mi: 'Miles' };

  let system = null;
  try { system = localStorage.getItem('feets-units'); } catch {}
  if (!NAMES[system]) {
    const lang = (navigator.languages || [navigator.language || ''])[0] || '';
    system = /^en-(US|LR)$/i.test(lang) ? 'mi' : 'km';
  }
  const miles = system === 'mi';

  const unit = miles ? 'mi' : 'km';              // a long distance
  const perUnit = miles ? MILE : 1000;            // metres in one of those
  const toUnit = m => m / perUnit;                // metres -> km or miles
  const fromUnit = n => n * perUnit;              // km or miles -> metres

  const height = m => (miles ? `${Math.round(m / FOOT).toLocaleString()} ft` : `${Math.round(m).toLocaleString()} m`);

  // "5.21 km": `digits` decimals, or fewer once it's past `fewerFrom` units.
  const dist = (m, digits = 1, fewerFrom = Infinity) => {
    const n = toUnit(m);
    return `${n.toFixed(n < fewerFrom ? digits : Math.max(0, digits - 1))} ${unit}`;
  };

  // A distance that can be short: "450 m", or "0.3 mi" (or "350 ft" when
  // that's under a tenth of a mile), past which it's as dist(m, 1, 10).
  const short = (m, step = 10) => {
    if (!miles) return m < 1000 ? `${Math.round(m / step) * step} m` : dist(m, 1, 10);
    if (m < MILE / 10) return `${Math.round(m / FOOT / step) * step} ft`;
    return dist(m, 1, 10);
  };

  // A pace from seconds per km: "5:12 /km" or "8:22 /mi".
  const pace = (secondsPerKm, clock) => `${clock(secondsPerKm * perUnit / 1000)} /${unit}`;
  // A speed from metres per second: "24.3 km/h" or "15.1 mph".
  const speed = metresPerSecond => (miles
    ? `${(metresPerSecond * 3600 / MILE).toFixed(1)} mph`
    : `${(metresPerSecond * 3.6).toFixed(1)} km/h`);

  // Fills in the page's unit words: <span class="unit">km</span>.
  function applyToPage(root = document) {
    for (const el of root.querySelectorAll('.unit')) el.textContent = unit;
  }

  // A units picker: a <select> that reloads the page in the ones picked.
  function picker() {
    const select = document.createElement('select');
    select.setAttribute('aria-label', 'Units');
    for (const [code, name] of Object.entries(NAMES)) select.append(new Option(t(name), code));
    select.value = system;
    select.onchange = () => {
      try { localStorage.setItem('feets-units', select.value); } catch {}
      location.reload();
    };
    return select;
  }

  return { miles, unit, perUnit, toUnit, fromUnit, dist, short, height, pace, speed, applyToPage, picker, MILE, FOOT };
})();
