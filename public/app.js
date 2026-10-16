const COLORS = ['#e6194b', '#3cb44b', '#4363d8', '#f58231', '#911eb4', '#42d4f4', '#f032e6', '#9a6324', '#000075', '#808000'];

const map = L.map('map').setView([20, 0], 2);

const baseLayers = {
  'OpenStreetMap': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),
  'OpenTopoMap': L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    maxZoom: 17,
    attribution: '&copy; OpenStreetMap contributors, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)',
  }),
  // OpenStreetMap tiles darkened with a CSS filter (see .dark-tiles in style.css).
  'Dark': L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19,
    className: 'dark-tiles',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  }),
};
let baseLayer = baseLayers['OpenStreetMap'].addTo(map);
map.on('baselayerchange', e => { baseLayer = e.layer; });
L.control.layers(baseLayers).addTo(map);
L.control.scale().addTo(map);

// Leaflet only notices window resizes; the map also changes size when the
// phone panel folds away (below) or the sidebar's contents change.
new ResizeObserver(() => map.invalidateSize()).observe(map.getContainer());

// Phones: fold the panel under the map away for a full-screen map. Remembered per browser.
const panelToggle = document.getElementById('panel-toggle');
function setPanelCollapsed(collapsed) {
  document.body.classList.toggle('panel-collapsed', collapsed);
  panelToggle.textContent = collapsed ? 'Show panel' : 'Hide panel';
  panelToggle.setAttribute('aria-expanded', String(!collapsed));
  try { localStorage.setItem('feets-panel', collapsed ? 'collapsed' : 'open'); } catch {}
}
panelToggle.onclick = () => setPanelCollapsed(!document.body.classList.contains('panel-collapsed'));
try { if (localStorage.getItem('feets-panel') === 'collapsed') setPanelCollapsed(true); } catch {}

// --- Locate me ---
// A button under the zoom controls drops a dot where the device is. It only
// asks on a tap (no watching), so pressing it again updates the dot.
// Streets mode's "Still to run" list sorts from it while it's in view.
const youAreHere = L.layerGroup().addTo(map);
let lastFix = null;  // L.LatLng of the dot
const LocateControl = L.Control.extend({
  options: { position: 'topleft' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'leaflet-bar');
    const button = L.DomUtil.create('a', 'locate-button', bar);
    button.href = '#';
    button.role = 'button';
    button.title = 'Show my location';
    button.setAttribute('aria-label', 'Show my location');
    button.innerHTML = '&#8982;';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, 'click', e => {
      L.DomEvent.preventDefault(e);
      button.classList.add('locating');
      map.locate({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
    this.button = button;
    return bar;
  },
});
const locateControl = new LocateControl().addTo(map);

map.on('locationfound', e => {
  locateControl.button.classList.remove('locating');
  youAreHere.clearLayers();
  L.circle(e.latlng, { radius: e.accuracy, color: '#2a7fff', weight: 1, fillOpacity: 0.1, interactive: false })
    .addTo(youAreHere);
  L.circleMarker(e.latlng, { radius: 7, color: '#fff', weight: 2, fillColor: '#2a7fff', fillOpacity: 1 })
    .bindTooltip(`You are here (±${Math.round(e.accuracy)} m)`)
    .addTo(youAreHere);
  lastFix = e.latlng;
  // Keep the current zoom if it is already close in; otherwise zoom to street level.
  map.setView(e.latlng, Math.max(map.getZoom(), 16));
  if (streetsMode && coverage) renderTodo();
});

map.on('locationerror', e => {
  locateControl.button.classList.remove('locating');
  alert(e.code === 1 ? 'Location permission was denied.' : `Couldn't get your location: ${e.message}`);
});

function setBaseLayer(layer) {
  if (layer === baseLayer) return;
  map.removeLayer(baseLayer);
  map.addLayer(layer); // fires baselayerchange, which updates baseLayer and the layer control
}

// id -> { track, layer }
const loaded = new Map();

// Tracks mode draws on one canvas too: thousands of SVG paths make panning crawl.
const trackRenderer = L.canvas({ padding: 0.5, tolerance: 4 });

// --- Filters ---
// Narrow the list and the map (both modes) to tracks matching a search, year
// and activity type. Saved per browser; the checkboxes are saved on the server.
const NO_SPORT = '_none';
const filters = { text: '', year: '', sport: '' };
try { Object.assign(filters, JSON.parse(localStorage.getItem('feets-filters')) || {}); } catch {}

const yearOf = track => (track.time ? String(new Date(track.time).getFullYear()) : '');
const sportLabel = sport => (sport === NO_SPORT ? 'Other' : sport.replace(/([a-z])([A-Z])/g, '$1 $2'));

function matches(track) {
  return (!filters.text || track.name.toLowerCase().includes(filters.text.toLowerCase()))
    && (!filters.year || yearOf(track) === filters.year)
    && (!filters.sport || (track.sport || NO_SPORT) === filters.sport);
}

const onMap = track => track.visible && matches(track);

// --- Heatmap ---
// Every visible track is drawn as a faint line on one canvas, so routes you
// repeat stack up and glow brighter.
const HEAT_COLOR = '#ff5a1f';
const heatRenderer = L.canvas({ padding: 0.5 });
let heatLayer = null;
let heatmap = false;
let streetsMode = false;
let planMode = false;
let mapMode = 'tracks';  // tracks, heatmap, streets or plan
let trackVersion = 0;    // bumped whenever the tracks on the map may have changed
// Plan mode can hide the coloured streets (Streets mode always shows them).
let planStreets = true;
try { planStreets = localStorage.getItem('feets-plan-streets') !== 'off'; } catch {}
const showStreets = () => streetsMode || (planMode && planStreets);
let baseBeforeHeatmap = null;

// Opacity per line, scaled to how many tracks are shown: where all of them
// overlap, the stacked lines reach ~90% opacity (1 - (1 - a)^n = 0.9).
// Clamped so a lone track isn't harsh and a one-off route never vanishes.
function heatOpacity(n) {
  return Math.min(0.6, Math.max(0.06, 1 - Math.pow(0.1, 1 / Math.max(n, 1))));
}

function drawHeatmap() {
  if (heatLayer) heatLayer.remove();
  heatLayer = L.layerGroup();
  const visible = [...loaded.values()].filter(({ track }) => onMap(track));
  const opacity = heatOpacity(visible.length);
  for (const { track } of visible) {
    for (const seg of track.segments) {
      // A wide, very faint halo plus a thin core line.
      L.polyline(seg, { renderer: heatRenderer, interactive: false, color: HEAT_COLOR, weight: 8, opacity: opacity / 5 }).addTo(heatLayer);
      L.polyline(seg, { renderer: heatRenderer, interactive: false, color: HEAT_COLOR, weight: 2.5, opacity }).addTo(heatLayer);
    }
  }
  heatLayer.addTo(map);
}

// Puts the right layers on the map for the current mode and visibility.
function syncLayers() {
  trackVersion++;
  const showTracks = !heatmap && !streetsMode && !planMode;
  for (const { track, layer } of loaded.values()) {
    if (onMap(track) && showTracks) layer.addTo(map);
    else layer.remove();
  }
  if (heatmap) drawHeatmap();
  else if (heatLayer) heatLayer.remove();
  // Streets and plan mode: coverage depends on which tracks are on the map.
  if (showStreets()) scheduleCoverage();
  else if (streetLayer) streetLayer.remove();
}

function setMode(mode) {
  const heat = mode === 'heatmap';
  if (heat !== heatmap) {
    if (heat) {
      baseBeforeHeatmap = baseLayer;
      setBaseLayer(baseLayers['Dark']);
    } else if (baseBeforeHeatmap) {
      setBaseLayer(baseBeforeHeatmap);
    }
  }
  heatmap = heat;
  streetsMode = mode === 'streets';
  planMode = mode === 'plan';
  mapMode = mode;
  document.getElementById('streets-panel').hidden = !streetsMode;
  document.getElementById('plan-panel').hidden = !planMode;
  map.getContainer().classList.toggle('planning', planMode);
  for (const button of document.querySelectorAll('#mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
  if (!publicView()) {
    try { localStorage.setItem('feets-mode', mode); } catch {}
  }
  fadeInput.value = savedFade(mode);
  applyFade();
  syncLayers();
  drawPlan();
  if (planMode) renderPlan();
}

// --- Map fade ---
// Makes the base map partly transparent over a solid background (white for
// tracks, black for the heatmap), so the lines stand out more. Each mode
// remembers its own setting.
const fadeInput = document.getElementById('fade');
const FADE_DEFAULTS = { tracks: 0, heatmap: 30, streets: 50, plan: 50 };

function savedFade(mode) {
  try {
    const value = localStorage.getItem('feets-fade-' + mode);
    if (value !== null) return Number(value);
  } catch {}
  return FADE_DEFAULTS[mode];
}

function applyFade() {
  const percent = Number(fadeInput.value);
  const container = map.getContainer();
  container.style.setProperty('--map-fade', percent / 100);
  container.style.setProperty('--fade-color', heatmap ? '#000' : '#fff');
  document.getElementById('fade-value').textContent = percent + '%';
}

fadeInput.oninput = () => {
  applyFade();
  try { localStorage.setItem('feets-fade-' + mapMode, fadeInput.value); } catch {}
};

function buildLayer(track) {
  const group = L.featureGroup();
  for (const seg of track.segments) {
    L.polyline(seg, { renderer: trackRenderer, color: track.color, weight: 4, opacity: 0.85 })
      .bindTooltip(track.name, { sticky: true })
      .on('click', e => trackPopup(track, e.latlng))
      .addTo(group);
  }
  for (const wpt of track.waypoints) {
    L.circleMarker(wpt.latlng, { renderer: trackRenderer, radius: 5, color: track.color, fillOpacity: 0.9 })
      .bindPopup(wpt.name || 'Waypoint')
      .addTo(group);
  }
  return group;
}

function formatKm(m) {
  return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
}

// --- Pace, time and elevation ---
// api.php works them out from each track's GPX (track.metrics; null until it
// has, see backfillMetrics). Rides get a speed instead of a pace.
const isRide = track => /Ride|Bike|Cycl/i.test(track.sport || '');

// 52:07, or 1:04:09 with hours.
function clock(seconds) {
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
}

// 42 h 10 min, for totals.
function hours(seconds) {
  const h = Math.floor(seconds / 3600), m = Math.round(seconds / 60) % 60;
  return h ? `${h.toLocaleString()} h ${m} min` : `${m} min`;
}

const paceText = secondsPerKm => `${clock(secondsPerKm)} /km`;
const climbText = m => `↑ ${Math.round(m).toLocaleString()} m`;

// "5:12 /km", or "24.3 km/h" for a ride; null without times.
function speedText(track) {
  const moving = track.metrics && track.metrics.moving;
  if (!moving || !track.distance) return null;
  return isRide(track) ? `${(track.distance / moving * 3.6).toFixed(1)} km/h` : paceText(moving / (track.distance / 1000));
}

const EFFORT_LABELS = { 1000: '1K', 5000: '5K', 10000: '10K', 21097: 'Half', 42195: 'Marathon' };

// Profiles are fetched when a popup first needs one: id -> promise of [[km, metres]] or null.
const profiles = new Map();

// Clicking a track: its numbers and an elevation chart.
function trackPopup(track, latlng) {
  const m = track.metrics;
  const box = document.createElement('div');
  box.className = 'track-popup';
  const title = document.createElement('strong');
  title.textContent = track.name;
  const sub = document.createElement('small');
  sub.textContent = [
    track.sport && sportLabel(track.sport),
    track.time && new Date(track.time).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' }),
  ].filter(Boolean).join(' · ');
  const facts = document.createElement('dl');
  const fact = (label, value) => {
    if (!value) return;
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    facts.append(dt, dd);
  };
  fact('Distance', formatKm(track.distance));
  if (m) {
    fact('Moving', m.moving && clock(m.moving));
    // Elapsed only when stops made a real difference.
    fact('Elapsed', m.elapsed && m.moving && m.elapsed - m.moving >= 60 && clock(m.elapsed));
    fact(isRide(track) ? 'Speed' : 'Pace', speedText(track));
    fact('Climb', m.climb !== null && m.climb !== undefined && climbText(m.climb));
    if (!isRide(track)) {
      const efforts = Object.entries(m.efforts || {}).map(([d, s]) => `${EFFORT_LABELS[d] || d} ${clock(s)}`);
      fact('Best', efforts.join(' · '));
    }
  }
  box.append(title, sub, facts);
  const note = document.createElement('small');
  if (!m) note.textContent = 'Pace and elevation are still being worked out.';
  else if (!m.moving && m.climb === null) note.textContent = 'This GPX has no times or elevations.';
  if (note.textContent) box.append(note);

  const chart = document.createElement('div');
  chart.className = 'chart';
  box.append(chart);
  if (m && m.climb !== null && m.climb !== undefined) {
    if (!profiles.has(track.id)) profiles.set(track.id, Store.profile(track.id).catch(() => null));
    profiles.get(track.id).then(profile => {
      if (!profile || profile.length < 2) return;
      chart.append(Elevation.chart(profile));
      if (popup.isOpen()) popup.update();  // it's taller now: re-pan so it all shows
    });
  }
  const popup = L.popup({ maxWidth: 300, minWidth: 240 }).setLatLng(latlng).setContent(box).openOn(map);
}

// The list shows the newest matching tracks, PAGE at a time.
const PAGE = 100;
let listLimit = PAGE;
const yearSelect = document.getElementById('filter-year');
const sportSelect = document.getElementById('filter-sport');
const moreButton = document.getElementById('more');

// Rebuilds a filter menu when the set of values changes. Drops a saved choice
// that no longer exists (once tracks have loaded).
function fillSelect(select, values, allLabel, labelOf, key) {
  const signature = values.join('|');
  if (select.dataset.signature !== signature) {
    select.dataset.signature = signature;
    select.replaceChildren(new Option(allLabel, ''), ...values.map(v => new Option(labelOf(v), v)));
  }
  if (filters[key] && !values.includes(filters[key]) && loaded.size) filters[key] = '';
  select.value = filters[key];
}

function render() {
  renderList();
  syncLayers();
}

// --- Stats ---
// Totals for the tracks matching the filters, so the Year filter sets the
// time frame. stats.js does the sums.
const statKm = m => (m / 1000).toFixed(m < 100000 ? 1 : 0) + ' km';

// --- Calendar ---
// A small calendar per month, each day shaded by the distance covered: the
// filters' year, or else the last 12 months. Hovering or tapping a day says
// what was done; clicking one with activities zooms the map to them.
const CAL_BINS = [  // km below `to` get `color`: one blue, light to dark (checked with the dataviz validator)
  { to: 5, color: '#86b6ef', label: '<5' },
  { to: 10, color: '#3987e5', label: '5–10' },
  { to: 20, color: '#1c5cab', label: '10–20' },
  { to: Infinity, color: '#0d366b', label: '20+' },
];
const dayKey = d => `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
const calColor = metres => CAL_BINS.find(b => metres / 1000 < b.to).color;

function renderCalendar(tracks) {
  const box = document.getElementById('calendar');
  const byDay = new Map();  // dayKey -> { metres, tracks }
  for (const t of tracks) {
    if (!t.time) continue;
    const key = dayKey(new Date(t.time));
    const day = byDay.get(key) || { metres: 0, tracks: [] };
    day.metres += t.distance;
    day.tracks.push(t);
    byDay.set(key, day);
  }
  const now = new Date();
  const first = filters.year ? new Date(Number(filters.year), 0, 1) : new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const readout = document.createElement('small');
  readout.className = 'calendar-readout';
  const idle = filters.year ? `${filters.year}` : 'Last 12 months';
  readout.textContent = idle;
  const describe = (date, day) => date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })
    + (!day ? ': nothing' : ` · ${statKm(day.metres)} · ${day.tracks.length === 1 ? day.tracks[0].name : `${day.tracks.length} activities`}`);

  const months = document.createElement('div');
  months.className = 'calendar-months';
  for (let m = 0; m < 12; m++) {
    const start = new Date(first.getFullYear(), first.getMonth() + m, 1);
    const block = document.createElement('div');
    block.className = 'calendar-month';
    const name = document.createElement('span');
    name.textContent = start.toLocaleDateString(undefined, { month: 'short' }) + (start.getMonth() === 0 && !filters.year ? ` ${start.getFullYear()}` : '');
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';
    // Weeks start on Monday: blank cells before the 1st.
    for (let i = 0; i < (start.getDay() + 6) % 7; i++) grid.append(document.createElement('i'));
    let active = 0, metres = 0;
    for (const date = new Date(start); date.getMonth() === start.getMonth(); date.setDate(date.getDate() + 1)) {
      const day = byDay.get(dayKey(date));
      const cell = document.createElement('span');
      if (date > today) cell.className = 'future';
      else if (day) {
        cell.style.background = calColor(day.metres);
        active++;
        metres += day.metres;
      }
      const text = describe(date, day);
      cell.title = text;
      cell.onpointerenter = () => { readout.textContent = text; };
      if (day) {
        cell.classList.add('active');
        cell.onclick = () => {
          readout.textContent = text;
          const bounds = L.latLngBounds([]);
          for (const t of day.tracks) {
            const entry = loaded.get(t.id);
            if (entry && onMap(t)) bounds.extend(entry.layer.getBounds());
          }
          if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30], maxZoom: 16 });
        };
      }
      grid.append(cell);
    }
    block.setAttribute('aria-label', `${start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: `
      + `${active} active ${active === 1 ? 'day' : 'days'}, ${statKm(metres)}`);
    block.append(name, grid);
    months.append(block);
  }
  months.onpointerleave = () => { readout.textContent = idle; };

  const legend = document.createElement('div');
  legend.className = 'calendar-legend';
  legend.innerHTML = '<span class="none"></span>0' + CAL_BINS.map(b => `<span style="background:${b.color}"></span>${b.label}`).join('') + ' km';
  box.replaceChildren(months, readout, legend);
}

function renderStats(tracks) {
  renderCalendar(tracks);
  const s = Stats.summarize(tracks);
  const period = [filters.year || 'All time', filters.sport && sportLabel(filters.sport), filters.text && `"${filters.text}"`]
    .filter(Boolean).join(' · ');
  document.getElementById('stats-summary').textContent = `${period} · ${statKm(s.metres)}`;
  // Dates from stats.js are midnight UTC; show the year only when it isn't the filter's.
  const date = d => d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: filters.year ? undefined : 'numeric', timeZone: 'UTC' });
  const plural = (n, one, many = one + 's') => `${n.toLocaleString()} ${n === 1 ? one : many}`;
  // Each row: a label, a main value, and smaller detail lines under it.
  const rows = [];
  const row = (label, value, ...details) => rows.push([label, value, details.filter(Boolean)]);
  if (!s.count) {
    row('Activities', 'None for these filters');
  } else {
    row('Distance', statKm(s.metres));
    row('Activities', s.count.toLocaleString(), s.activeDays && `on ${plural(s.activeDays, 'day')}`);
    row('Average', `${statKm(s.average)} each`, s.weeklyAverage !== null && `${statKm(s.weeklyAverage)} a week`);
    if (s.moving) row('Time', hours(s.moving.seconds), `moving, over ${plural(s.moving.count, 'activity', 'activities')} with times`);
    if (s.pace) row('Pace', paceText(s.pace), 'average on foot');
    if (s.climb) {
      const most = s.climb.most;
      row('Climb', `${s.climb.metres.toLocaleString()} m`, most.metrics.climb && `most: ${most.metrics.climb.toLocaleString()} m, ${most.name}`);
    }
    if (s.fastest.length) {
      const [first, ...others] = s.fastest.map(f => `${EFFORT_LABELS[f.metres]} ${clock(f.seconds)}`
        + (f.track.time ? ` · ${new Date(f.track.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: filters.year ? undefined : 'numeric' })}` : ''));
      row('Fastest', first, ...others);
    }
    const t = s.longestTrack;
    row('Longest', statKm(t.distance), [t.name, t.time && new Date(t.time).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: filters.year ? undefined : 'numeric' })].filter(Boolean).join(' · '));
    const { longest, current } = s.streaks;
    if (longest.days) row('Longest streak', plural(longest.days, 'day'), longest.days > 1 ? `${date(longest.start)} – ${date(longest.end)}` : date(longest.start));
    if (current) row('Current streak', plural(current, 'day'), 'through today or yesterday');
    if (s.bestWeek) row('Best week', statKm(s.bestWeek.metres), `week of ${date(s.bestWeek.start)}`);
    if (s.bestMonth) {
      const [y, m] = s.bestMonth.month.split('-').map(Number);
      row('Best month', statKm(s.bestMonth.metres), new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString(undefined, { month: 'long', year: filters.year ? undefined : 'numeric', timeZone: 'UTC' }));
    }
    if (s.byType.length > 1) {
      const [first, ...others] = s.byType.map(x => `${x.sport ? sportLabel(x.sport) : 'Other'} ${statKm(x.metres)} (${x.count})`);
      row('By type', first, ...others);
    }
  }
  document.getElementById('stats-list').replaceChildren(...rows.flatMap(([label, value, details]) => {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.textContent = value;
    for (const text of details) {
      const small = document.createElement('small');
      small.textContent = text;
      dd.append(small);
    }
    return [dt, dd];
  }));
}

function renderList() {
  const all = [...loaded.values()];
  const years = [...new Set(all.map(e => yearOf(e.track)).filter(Boolean))].sort().reverse();
  const sports = [...new Set(all.map(e => e.track.sport || NO_SPORT))]
    .sort((a, b) => (a === NO_SPORT) - (b === NO_SPORT) || a.localeCompare(b));
  fillSelect(yearSelect, years, 'All years', y => y, 'year');
  fillSelect(sportSelect, sports, 'All types', sportLabel, 'sport');

  const matching = all
    .filter(e => matches(e.track))
    .sort((a, b) => (b.track.time || '').localeCompare(a.track.time || '') || b.track.id - a.track.id);
  const shown = matching.filter(e => e.track.visible);
  const km = shown.reduce((sum, e) => sum + e.track.distance, 0);

  document.getElementById('track-list').replaceChildren(...matching.slice(0, listLimit).map(listItem));
  moreButton.hidden = matching.length <= listLimit;
  moreButton.textContent = `Show more (${matching.length - listLimit} more)`;

  const filtered = filters.text || filters.year || filters.sport;
  renderStats(matching.map(e => e.track));

  document.getElementById('summary').textContent = !all.length
    ? 'No tracks yet.'
    : `${filtered ? `${matching.length} of ${all.length}` : all.length} tracks · ${shown.length} on map · ${formatKm(km)}`
      + (metricsLeft ? ` · working out pace and climb, ${metricsLeft} to go` : '');
  renderGoals();
}

// Tracks stored before feets kept pace and elevation get them here, a batch
// per request, after the list has loaded. View-only accounts can't ask; their
// owner's next visit fills them in.
let metricsLeft = 0;

async function backfillMetrics() {
  const user = currentUser;
  metricsLeft = [...loaded.values()].filter(e => e.track.metrics === null).length;
  if (readOnly() || !metricsLeft) {
    metricsLeft = 0;
    return;
  }
  try {
    while (metricsLeft && currentUser === user) {
      const { metrics, remaining } = await Store.trackMetrics();
      for (const [id, m] of Object.entries(metrics)) {
        const entry = loaded.get(Number(id));
        if (entry) entry.track.metrics = m;
      }
      metricsLeft = Object.keys(metrics).length ? remaining : 0;
      renderList();
    }
  } catch (err) {
    console.error('Pace and elevation:', err);
    metricsLeft = 0;
    renderList();
  }
}

function listItem({ track, layer }) {
  const li = document.createElement('li');

  const checkbox = document.createElement('input');
  checkbox.type = 'checkbox';
  checkbox.checked = track.visible;
  checkbox.title = 'Show / hide';
  checkbox.onchange = () => setVisible(track.id, checkbox.checked);

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = track.color;

  const name = document.createElement('div');
  name.className = 'name';
  name.title = 'Zoom to track and show its details';
  const details = [
    track.sport && sportLabel(track.sport),
    track.time && new Date(track.time).toLocaleDateString(),
    formatKm(track.distance),
    speedText(track),
    track.metrics && track.metrics.climb ? climbText(track.metrics.climb) : null,
  ];
  name.innerHTML = '<strong></strong><small></small>';
  name.querySelector('strong').textContent = track.name;
  name.querySelector('small').textContent = details.filter(Boolean).join(' · ');
  name.onclick = () => {
    if (!track.visible) setVisible(track.id, true);
    map.fitBounds(layer.getBounds(), { padding: [30, 30] });
    // The popup sits halfway along the longest segment, on the line. It
    // opens once the zoom has finished, or its panning would fight the zoom;
    // the timer covers a map that was already there and doesn't move.
    const seg = track.segments.reduce((a, b) => (b.length > a.length ? b : a), []);
    if (!seg.length || mapMode !== 'tracks') return;
    const half = lineMetres(seg) / 2;
    let i = 1, m = 0, d = 0;
    for (; i < seg.length; i++) {
      d = Planner.distance(...seg[i - 1], ...seg[i]);
      if (m + d >= half) break;
      m += d;
    }
    const a = seg[i - 1], b = seg[Math.min(i, seg.length - 1)], f = d ? (half - m) / d : 0;
    const middle = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
    let opened = false;
    const open = () => {
      if (opened) return;
      opened = true;
      map.off('moveend', open);
      trackPopup(track, middle);
    };
    map.once('moveend', open);
    setTimeout(open, 700);
  };

  const download = document.createElement('button');
  download.className = 'download';
  download.textContent = '↓';
  download.title = 'Download original GPX';
  download.onclick = () => Store.downloadGpx(track).catch(err => alert(err.message));

  const toRoute = document.createElement('button');
  toRoute.className = 'to-route';
  toRoute.textContent = '⤳';
  toRoute.title = 'Plan a route from this run';
  toRoute.onclick = () => routeFromTrack(track);

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '×';
  del.title = 'Delete';
  del.onclick = () => removeTrack(track.id);

  li.append(checkbox, swatch, name, toRoute, download, del);
  return li;
}

function show(track) {
  loaded.set(track.id, { track, layer: buildLayer(track) });
}

// View-only accounts can show and hide tracks too, but only in their own browser.
const readOnly = () => Boolean(currentUser && currentUser.readOnly);

// Opened with a view link: a page of shared routes and nothing else (see
// signedIn). A function declaration, as setMode runs before currentUser exists.
function publicView() {
  return document.body.classList.contains('public-view');
}

async function setVisible(id, visible) {
  const entry = loaded.get(id);
  entry.track.visible = visible;
  render();
  if (!readOnly()) await Store.update(entry.track);
}

async function removeTrack(id) {
  const entry = loaded.get(id);
  if (!confirm(`Delete "${entry.track.name}"?\n\nThis can't be undone. A track imported from Strava won't be imported again.`)) return;
  entry.layer.remove();
  loaded.delete(id);
  await Store.remove(id);
  render();
}

function fitAll() {
  const bounds = L.latLngBounds([]);
  for (const { track, layer } of loaded.values()) {
    if (onMap(track)) bounds.extend(layer.getBounds());
  }
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
}

// "Show all" / "Hide all" apply to the tracks matching the filters.
async function setVisibleMatching(visible) {
  const ids = [];
  for (const { track } of loaded.values()) {
    if (matches(track) && track.visible !== visible) {
      track.visible = visible;
      ids.push(track.id);
    }
  }
  if (!ids.length) return;
  render();
  if (!readOnly()) await Store.setVisible(ids, visible).catch(err => alert(err.message));
}

function setFilter(key, value) {
  filters[key] = value;
  try { localStorage.setItem('feets-filters', JSON.stringify(filters)); } catch {}
  listLimit = PAGE;
  render();
}

async function addFiles(files) {
  const errors = [];
  let added = 0;
  for (const file of files) {
    try {
      const text = await file.text();
      const parsed = GPX.parse(text, file.name.replace(/\.gpx$/i, ''));
      const track = {
        ...parsed,
        fileName: file.name,
        color: COLORS[(loaded.size + added) % COLORS.length],
        visible: true,
        addedAt: new Date().toISOString(),
      };
      Object.assign(track, await Store.add({ ...track, gpx: text }));  // id and metrics
      show(track);
      added++;
    } catch (err) {
      errors.push(`${file.name}: ${err.message}`);
    }
  }
  render();
  if (added) {
    fitAll();
    scheduleTrophies();
  }
  if (errors.length) alert('Some files could not be loaded:\n\n' + errors.join('\n'));
}

// --- Upload wiring ---
const dropzone = document.getElementById('dropzone');
const fileInput = document.getElementById('file-input');

fileInput.onchange = () => {
  addFiles(Array.from(fileInput.files));
  fileInput.value = '';
};

// Allow dropping anywhere on the page, not just the dropzone.
document.addEventListener('dragover', e => {
  e.preventDefault();
  dropzone.classList.add('over');
  // Show the drop zone if its box is collapsed.
  const box = document.getElementById('import-box');
  if (!box.hidden) box.open = true;
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) dropzone.classList.remove('over');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('over');
  if (!auth.hidden || readOnly()) return;
  const files = Array.from(e.dataTransfer.files).filter(f => /\.gpx$/i.test(f.name));
  if (files.length) addFiles(files);
});

document.getElementById('fit-all').onclick = fitAll;

// Edit mode: delete buttons only appear while it's on. Always starts off.
const editToggle = document.getElementById('edit-toggle');
editToggle.onclick = () => {
  const editing = editToggle.getAttribute('aria-pressed') !== 'true';
  editToggle.setAttribute('aria-pressed', String(editing));
  editToggle.textContent = editing ? 'Done' : 'Edit';
  editToggle.title = editing ? 'Hide delete buttons' : 'Show delete buttons';
  document.getElementById('track-list').classList.toggle('editing', editing);
};
document.getElementById('show-all').onclick = () => setVisibleMatching(true);
document.getElementById('hide-all').onclick = () => setVisibleMatching(false);
moreButton.onclick = () => {
  listLimit += PAGE;
  renderList();
};

const filterText = document.getElementById('filter-text');
filterText.value = filters.text;
let filterTimer;
filterText.oninput = () => {
  // Wait for a pause in typing: re-filtering redraws thousands of tracks.
  clearTimeout(filterTimer);
  filterTimer = setTimeout(() => setFilter('text', filterText.value.trim()), 250);
};
yearSelect.onchange = () => setFilter('year', yearSelect.value);
sportSelect.onchange = () => setFilter('sport', sportSelect.value);

// --- Streets mode: street coverage ---
// Pick an OSM area (e.g. a neighbourhood); its roads, paths and trails are
// coloured by how much of each the tracks on the map have covered.
// osm.js fetches areas, coverage.js does the matching.
const STREET_COLORS = { done: '#2e9e44', started: '#f0a020', todo: '#d64545', unrunnable: '#8a8a8a' };
const CAT_LABELS = { road: 'Roads', path: 'Paths', trail: 'Trails' };
const CAT_NAMES = { road: 'road', path: 'path', trail: 'trail' };
const TODO_LIMIT = 30;
const streetRenderer = L.canvas({ padding: 0.5, tolerance: 5 });
const areaSelect = document.getElementById('area-select');
const areaStatus = document.getElementById('area-status');
let areas = [];
let activeArea = null;   // { area, prep }
let coverage = null;     // { result, summary }
let streetLayer = null;
let highlightLayer = null;
let coverageTimer = null;

const areaKind = level => (level <= 8 ? 'district' : level === 9 ? 'community' : level === 10 ? 'neighbourhood' : 'sub-area');
const km = m => (m < 1000 ? `${Math.round(m / 10) * 10} m` : (m / 1000).toFixed(m < 10000 ? 1 : 0) + ' km');
const streetColor = f => (Coverage.isDone(f) ? STREET_COLORS.done : f > 0.05 ? STREET_COLORS.started : STREET_COLORS.todo);

function groupLabel(g) {
  return g.name || `Unnamed ${CAT_NAMES[g.cat]}`;
}

function hoodName(index) {
  return index >= 0 && activeArea ? activeArea.area.data.hoods[index].name : '';
}

async function loadAreas() {
  try {
    areas = await Store.areas();
  } catch (err) {
    areas = [];
    areaStatus.textContent = 'Could not load areas: ' + err.message;
  }
  let saved = '';
  try { saved = localStorage.getItem('feets-area') || ''; } catch {}
  fillAreaSelect();
  setActiveArea(areas.some(a => String(a.id) === saved) ? saved : areas[0] ? String(areas[0].id) : '');
}

function clearAreas() {
  areas = [];
  setActiveArea('');
}

function fillAreaSelect() {
  areaSelect.replaceChildren(
    new Option(areas.length ? 'Choose an area…' : 'No areas yet: add one', ''),
    ...areas.map(a => new Option(a.name, String(a.id)))
  );
}

function setActiveArea(id) {
  const area = areas.find(a => String(a.id) === String(id));
  areaSelect.value = area ? String(area.id) : '';
  try { localStorage.setItem('feets-area', area ? String(area.id) : ''); } catch {}
  activeArea = area ? { area, prep: Coverage.prepared(area) } : null;
  coverage = null;
  document.getElementById('area-tools').hidden = !area;
  if (!area) {
    if (streetLayer) streetLayer.remove();
    streetLayer = null;
    renderCoverage();
  }
  scheduleCoverage();
}

// Recomputing redraws every street, so wait for a pause in changes.
function scheduleCoverage() {
  clearTimeout(coverageTimer);
  coverageTimer = setTimeout(updateCoverage, 200);
}

function updateCoverage() {
  if (!showStreets() || !activeArea) {
    if (streetLayer) streetLayer.remove();
    if (streetsMode) renderCoverage();
    return;
  }
  const shown = [...loaded.values()].filter(e => onMap(e.track));
  const result = Coverage.compute(activeArea.prep, shown.map(e => e.track.segments));
  coverage = { result, summary: Coverage.summarize(activeArea.prep, result), tracks: shown.length };
  drawStreets();
  renderCoverage();
}

function drawStreets() {
  if (streetLayer) streetLayer.remove();
  streetLayer = L.layerGroup();
  const { data } = activeArea.area;
  for (const hood of data.hoods) {
    for (const line of hood.lines) {
      L.polyline(line, { renderer: streetRenderer, color: '#777', weight: 1, opacity: 0.6, interactive: false }).addTo(streetLayer);
    }
  }
  for (const line of data.boundary) {
    L.polyline(line, { renderer: streetRenderer, color: '#333', weight: 2.5, dashArray: '8 6', interactive: false }).addTo(streetLayer);
  }
  data.streets.forEach((s, w) => {
    const f = coverage.result.fraction[w];
    const unrunnable = activeArea.prep.excluded[w];
    const style = unrunnable
      ? { renderer: streetRenderer, color: STREET_COLORS.unrunnable, weight: 3, opacity: 0.8, dashArray: '2 6' }
      : {
        renderer: streetRenderer,
        color: streetColor(f),
        weight: s.cat === 'road' ? 4 : 3,
        opacity: 0.9,
        dashArray: s.cat === 'trail' ? '4 5' : null,
      };
    const tip = `${s.name || `Unnamed ${CAT_NAMES[s.cat]}`} · ${unrunnable ? 'unrunnable' : Math.round(f * 100) + '%'}`;
    for (const run of s.runs) {
      L.polyline(run, style).bindTooltip(tip, { sticky: true })
        .on('click', e => { if (!planMode) streetPopup(w, e.latlng); }).addTo(streetLayer);  // plan mode: map click adds a point
    }
  });
  streetLayer.addTo(map);
}

function progressRow(label, t) {
  const share = t.len ? t.covered / t.len : 0;
  const row = document.createElement('div');
  row.className = 'progress';
  row.innerHTML = '<span class="progress-label"></span><span class="bar"><span></span></span><strong></strong><small></small>';
  row.querySelector('.progress-label').textContent = label;
  row.querySelector('.bar span').style.width = (share * 100).toFixed(1) + '%';
  row.querySelector('strong').textContent = Math.round(share * 100) + '%';
  row.querySelector('small').textContent =
    `${km(t.covered)} of ${km(t.len)} · ${t.done} of ${t.streets} ${t.streets === 1 ? 'street' : 'streets'} done`;
  return row;
}

function renderCoverage() {
  const box = document.getElementById('coverage');
  const hoodBox = document.getElementById('hood-coverage');
  if (!activeArea || !coverage) {
    box.replaceChildren();
    hoodBox.hidden = true;
    document.getElementById('todo').hidden = true;
    return;
  }
  const { summary, tracks } = coverage;
  const cats = ['road', 'path', 'trail'].filter(c => summary.total[c].len > 0);
  const legend = document.createElement('div');
  legend.className = 'legend';
  legend.innerHTML = `<span style="--c:${STREET_COLORS.done}">done</span><span style="--c:${STREET_COLORS.started}">started</span>`
    + `<span style="--c:${STREET_COLORS.todo}">not yet</span><span class="dashed">trail</span>`
    + `<span class="dotted">unrunnable</span>`;
  const note = document.createElement('small');
  note.className = 'coverage-note';
  note.textContent = `Counting the ${tracks} ${tracks === 1 ? 'track' : 'tracks'} on the map. ` +
    'Use the filters below to count only some, e.g. runs.' +
    (readOnly() ? '' : ' Click a street to mark it unrunnable.');
  box.replaceChildren(...cats.map(c => progressRow(CAT_LABELS[c], summary.total[c])), legend, note);

  const hoods = activeArea.area.data.hoods;
  hoodBox.hidden = !hoods.length;
  const head = '<tr><th></th>' + cats.map(c => `<th>${CAT_LABELS[c]}</th>`).join('') + '</tr>';
  const rows = hoods.map((h, i) => {
    const cells = cats.map(c => {
      const t = summary.byHood[i][c];
      return `<td>${t.len ? Math.round((t.covered / t.len) * 100) + '%' : '–'}</td>`;
    });
    return `<tr><th></th>${cells.join('')}</tr>`;
  });
  const table = hoodBox.querySelector('table');
  table.innerHTML = head + rows.join('');
  table.querySelectorAll('tr + tr th').forEach((th, i) => { th.textContent = hoods[i].name; });
  renderUnrunnable();
  renderTodo();
}

// The streets marked unrunnable, each with a way to count it again.
function renderUnrunnable() {
  const box = document.getElementById('unrunnable');
  const { streets } = activeArea.area.data;
  const marked = new Map();
  streets.forEach((s, w) => {
    if (!activeArea.prep.excluded[w]) return;
    const key = s.name ? `${s.cat}|${s.name}` : `#${s.id}`;
    if (!marked.has(key)) marked.set(key, { label: s.name || `Unnamed ${CAT_NAMES[s.cat]}`, cat: s.cat, ways: [], len: 0 });
    marked.get(key).ways.push(w);
    marked.get(key).len += s.len;
  });
  box.hidden = !marked.size;
  box.querySelector('.count').textContent = `(${marked.size})`;
  box.querySelector('ul').replaceChildren(...[...marked.values()].map(m => {
    const li = document.createElement('li');
    const name = document.createElement('button');
    name.className = 'link-button name';
    name.textContent = m.label;
    name.title = 'Show on map';
    name.onclick = () => showGroup(m);
    const info = document.createElement('small');
    info.textContent = `${CAT_NAMES[m.cat]} · ${km(m.len)}`;
    li.append(name, info);
    if (!readOnly()) {
      const again = document.createElement('button');
      again.className = 'link-button again';
      again.textContent = 'Count again';
      again.onclick = () => setUnrunnable(m.ways[0], false);
      li.append(again);
    }
    return li;
  }));
}

// Clicking a street: what it is, and (unless view-only) a way to mark it
// unrunnable or count it again.
function streetPopup(w, latlng) {
  const s = activeArea.area.data.streets[w];
  const unrunnable = activeArea.prep.excluded[w];
  const box = document.createElement('div');
  box.className = 'street-popup';
  const title = document.createElement('strong');
  title.textContent = s.name || `Unnamed ${CAT_NAMES[s.cat]}`;
  const info = document.createElement('div');
  info.textContent = unrunnable
    ? 'Marked unrunnable'
    : `${CAT_NAMES[s.cat]} · ${Math.round(coverage.result.fraction[w] * 100)}% run`;
  box.append(title, info);
  if (!readOnly()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unrunnable ? 'Count it again' : 'Mark unrunnable';
    if (s.name) button.title = `Applies to all of ${s.name} in this area`;
    button.onclick = () => setUnrunnable(w, !unrunnable);
    box.append(button);
  }
  L.popup().setLatLng(latlng).setContent(box).openOn(map);
}

// Marks a street unrunnable, or counts it again. A named street changes
// everywhere in the area (a big road often crosses several neighbourhoods);
// an unnamed path or trail just where it is.
async function setUnrunnable(w, unrunnable) {
  const { area } = activeArea;
  const s = area.data.streets[w];
  const ways = s.name
    ? area.data.streets.filter(o => o.name === s.name && o.cat === s.cat).map(o => o.id)
    : [s.id];
  try {
    area.excluded = (await Store.excludeWays(area.id, ways, unrunnable)).excluded;
    map.closePopup();
    setActiveArea(area.id);  // re-index without (or with) those streets, then recount
    scheduleTrophies();
  } catch (err) {
    alert(err.message);
  }
}

// Unfinished streets, nearest first: to you, if "Show my location" put a dot
// on the map that's still in view, otherwise to the middle of the map.
function renderTodo() {
  const list = document.getElementById('todo-list');
  const todo = document.getElementById('todo');
  if (!coverage) { todo.hidden = true; return; }
  const here = lastFix && map.getBounds().contains(lastFix) ? lastFix : null;
  const centre = here || map.getCenter();
  todo.querySelector('.hint').textContent = here
    ? 'Nearest to you first'
    : 'Nearest to the middle of the map first. Tap ⌖ on the map to sort from where you are.';
  const { data } = activeArea.area;
  const unfinished = coverage.summary.groups.filter(g => !g.done);
  todo.hidden = !unfinished.length;
  todo.querySelector('.count').textContent = `(${unfinished.length})`;
  if (!todo.open) return;  // sorting by distance can wait until it's opened
  const items = unfinished
    .map(g => {
      let best = Infinity;
      for (const w of g.ways) for (const run of data.streets[w].runs) {
        for (let i = 0; i < run.length; i += 4) best = Math.min(best, centre.distanceTo(run[i]));
      }
      return { g, distance: best };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, TODO_LIMIT);
  list.replaceChildren(...items.map(({ g, distance }) => {
    const li = document.createElement('li');
    const share = g.len ? g.covered / g.len : 0;
    li.innerHTML = '<span class="swatch"></span><div class="name"><strong></strong><small></small></div>'
      + '<button class="link-button skip" type="button" title="Mark unrunnable">Skip</button>';
    li.querySelector('.skip').onclick = e => {
      e.stopPropagation();
      setUnrunnable(g.ways[0], true);
    };
    li.querySelector('.swatch').style.background = streetColor(share);
    li.querySelector('strong').textContent = groupLabel(g);
    li.querySelector('small').textContent = [
      CAT_NAMES[g.cat], hoodName(g.hood), `${Math.round(share * 100)}%`, `${km(g.len - g.covered)} left`,
      here && `${km(distance)} away`,
    ].filter(Boolean).join(' · ');
    li.title = 'Show on map';
    li.onclick = () => showGroup(g);
    return li;
  }));
}

// Zooms to a street and flashes it.
function showGroup(g) {
  const { data } = activeArea.area;
  const lines = g.ways.flatMap(w => data.streets[w].runs);
  if (highlightLayer) highlightLayer.remove();
  highlightLayer = L.layerGroup(lines.map(line =>
    L.polyline(line, { renderer: streetRenderer, color: '#1a73e8', weight: 9, opacity: 0.55, interactive: false })
  )).addTo(map);
  map.fitBounds(L.latLngBounds(lines.flat()), { padding: [60, 60], maxZoom: 17 });
  setTimeout(() => { if (highlightLayer) highlightLayer.remove(); }, 4000);
}

map.on('moveend', () => { if (streetsMode && coverage) renderTodo(); });

// The "Still to run", "Unrunnable streets" and "Saved routes" boxes remember
// whether they're open.
for (const id of ['todo', 'unrunnable', 'routes', 'stats-box', 'goals-box']) {
  const box = document.getElementById(id);
  try {
    const saved = localStorage.getItem(`feets-${id}-open`);
    if (saved) box.open = saved === 'yes';
  } catch {}
  box.addEventListener('toggle', () => {
    try { localStorage.setItem(`feets-${id}-open`, box.open ? 'yes' : 'no'); } catch {}
    if (id === 'todo' && box.open && streetsMode && coverage) renderTodo();
  });
}

areaSelect.onchange = () => {
  setActiveArea(areaSelect.value);
  if (activeArea) map.fitBounds(L.latLngBounds(activeArea.area.data.boundary.flat()), { padding: [20, 20] });
};

// Adding an area: list the OSM boundaries around the current view, then
// fetch the chosen one's streets and save it.
document.getElementById('area-add').onclick = async () => {
  if (map.getZoom() < 12) {
    areaStatus.textContent = 'Zoom in to the area you want first, then click Add area.';
    return;
  }
  const b = map.getBounds();
  areaStatus.textContent = 'Looking up areas here…';
  try {
    const found = await OSM.candidates(b.getSouth(), b.getWest(), b.getNorth(), b.getEast());
    if (!found.length) {
      areaStatus.textContent = 'OpenStreetMap has no neighbourhood boundaries here.';
      return;
    }
    // Grouped by kind, nearest first: the bigger kinds come first because
    // they include their neighbourhoods.
    const groups = new Map();
    for (const c of found) {
      const kind = areaKind(c.level);
      if (!groups.has(kind)) groups.set(kind, []);
      if (groups.get(kind).length < 8) groups.get(kind).push(c);
    }
    const order = ['district', 'community', 'neighbourhood', 'sub-area'];
    document.getElementById('area-candidates').replaceChildren(...order.filter(k => groups.has(k)).map(kind => {
      const group = document.createElement('optgroup');
      group.label = { district: 'Districts', community: 'Communities', neighbourhood: 'Neighbourhoods', 'sub-area': 'Sub-areas' }[kind];
      group.append(...groups.get(kind).map(c => new Option(c.name, String(c.osmId))));
      return group;
    }));
    // Preselect the nearest neighbourhood-sized area, or else the nearest of any kind.
    const best = found.find(c => areaKind(c.level) === 'neighbourhood') || found[0];
    document.getElementById('area-candidates').value = String(best.osmId);
    document.getElementById('area-picker').hidden = false;
    areaStatus.textContent = 'Pick one. Bigger areas include their neighbourhoods.';
  } catch (err) {
    areaStatus.textContent = err.message;
  }
};

document.getElementById('area-cancel').onclick = () => {
  document.getElementById('area-picker').hidden = true;
  areaStatus.textContent = '';
};

async function fetchAndSaveArea(osmId) {
  const buttons = ['area-add', 'area-confirm', 'area-refresh'].map(id => document.getElementById(id));
  buttons.forEach(b => { b.disabled = true; });
  try {
    const built = await OSM.buildArea(osmId, message => { areaStatus.textContent = message; });
    areaStatus.textContent = 'Saving…';
    const saved = await Store.saveArea({ osmId, name: built.name, data: built.data });
    areas = [...areas.filter(a => a.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
    fillAreaSelect();
    setActiveArea(saved.id);
    scheduleTrophies();
    document.getElementById('area-picker').hidden = true;
    map.fitBounds(L.latLngBounds(saved.data.boundary.flat()), { padding: [20, 20] });
    areaStatus.textContent = `${saved.name}: ${saved.data.streets.length} streets, paths and trails.`;
  } catch (err) {
    areaStatus.textContent = err.message;
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
}

document.getElementById('area-confirm').onclick = () =>
  fetchAndSaveArea(Number(document.getElementById('area-candidates').value));

document.getElementById('area-refresh').onclick = () => {
  if (activeArea) fetchAndSaveArea(activeArea.area.osmId);
};

document.getElementById('area-remove').onclick = async () => {
  if (!activeArea || !confirm(`Remove ${activeArea.area.name}? Your tracks aren't affected.`)) return;
  try {
    await Store.deleteArea(activeArea.area.id);
    areas = areas.filter(a => a.id !== activeArea.area.id);
    fillAreaSelect();
    setActiveArea(areas[0] ? areas[0].id : '');
    areaStatus.textContent = '';
  } catch (err) {
    alert(err.message);
  }
};

// --- Achievements ---
// achievements.js decides what's earned. Here they're checked after tracks or
// areas change, announced, and listed in the Trophies box.
const trophyBox = document.getElementById('trophies-box');
let trophies = [];  // as from Store.achievements()
let trophyTimer = null;
let trophyCheck = Promise.resolve();  // checks run one after another, never two at once

async function loadTrophies() {
  try {
    trophies = await Store.achievements();
  } catch {
    trophies = [];
  }
  renderTrophies();
}

// Waits for a pause in changes: a Strava import adds tracks in batches.
function scheduleTrophies() {
  if (!currentUser || readOnly()) return;
  clearTimeout(trophyTimer);
  trophyTimer = setTimeout(() => {
    trophyCheck = trophyCheck.then(checkTrophies).catch(err => console.error('Achievements:', err));
  }, 1500);
}

// Works out every trophy currently earned, saves the new ones (the server
// ignores codes it already has) and announces them.
async function checkTrophies() {
  const known = new Set(trophies.map(a => a.code));
  const fresh = Achievements.evaluate([...loaded.values()].map(e => e.track), areas)
    .filter(a => !known.has(a.code));
  if (!fresh.length) return;
  trophies = await Store.addAchievements(fresh);
  renderTrophies();
  // The first check finds everything already run; one note is enough for that.
  if (!known.size && fresh.length > 3) {
    toast(`🏆 ${fresh.length} trophies from your past activities`, 'See them under Trophies.');
  } else {
    fresh.slice(0, 3).forEach(a => toast(`🏆 ${a.title}`, a.detail));
    if (fresh.length > 3) toast(`🏆 ${fresh.length - 3} more`, 'See them under Trophies.');
  }
}

// Shows this year's trophies, then all-time ones. Earlier years' are kept on
// the server but not listed.
function renderTrophies() {
  const year = new Date().getFullYear();
  const groups = [[year, []], [null, []]];
  for (const a of [...trophies].reverse()) {  // newest first
    const group = groups.find(([y]) => y === Achievements.yearOfCode(a.code));
    if (group) group[1].push(a);
  }
  const shown = groups[0][1].length + groups[1][1].length;
  document.getElementById('trophy-count').textContent = shown ? String(shown) : '';
  const list = document.getElementById('trophy-list');
  if (!shown) {
    const empty = document.createElement('li');
    empty.className = 'trophy-empty';
    empty.textContent = 'None yet. Add a street area and go run it.';
    list.replaceChildren(empty);
    return;
  }
  const items = [];
  for (const [y, group] of groups) {
    if (!group.length) continue;
    const heading = document.createElement('li');
    heading.className = 'trophy-group';
    heading.textContent = y ? String(y) : 'All time';
    items.push(heading);
    for (const a of group) {
      const li = document.createElement('li');
      li.innerHTML = '<strong></strong><time></time><small></small>';
      // The heading already says which year.
      li.querySelector('strong').textContent = y ? a.title.replace(/^\d{4}: /, '') : a.title;
      li.querySelector('small').textContent = a.detail || '';
      li.querySelector('time').textContent = new Date(a.earnedAt.replace(' ', 'T')).toLocaleDateString();
      items.push(li);
    }
  }
  list.replaceChildren(...items);
}

// A note in the corner of the map that goes away by itself, or when clicked.
function toast(title, detail) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.innerHTML = '<strong></strong><small></small>';
  el.querySelector('strong').textContent = title;
  el.querySelector('small').textContent = detail || '';
  el.onclick = () => el.remove();
  document.getElementById('toasts').append(el);
  setTimeout(() => el.remove(), 8000);
}

// --- Goals ---
// A distance to cover each week and/or month, on foot. Stats.goal does the
// sums; the goals themselves are saved on the server, so they follow you
// between devices. Reaching one while the page is open gets a note.
const GOAL_PERIODS = { week: { label: 'Week', every: 'week' }, month: { label: 'Month', every: 'month' } };
let goals = { week: null, month: null };
let goalsMet = {};  // period -> whether it was met at the last render, to notice reaching it

async function loadGoals() {
  try {
    goals = await Store.goals();
  } catch {
    goals = { week: null, month: null };
  }
  goalsMet = {};
  renderGoals();
}

function renderGoals() {
  const box = document.getElementById('goals-box');
  if (box.hidden) return;
  const tracks = [...loaded.values()].map(e => e.track);
  const rows = [];
  const summary = [];
  for (const [period, { label, every }] of Object.entries(GOAL_PERIODS)) {
    const target = goals[period] && goals[period] * 1000;
    if (!target) continue;
    const g = Stats.goal(tracks, period);
    const share = g.metres / target;
    const met = share >= 1;
    if (goalsMet[period] === false && met && loaded.size) {
      toast(`🎯 ${label}ly goal reached`, `${statKm(g.metres)} this ${every}`);
    }
    goalsMet[period] = met;
    summary.push(met ? `${label} ✓` : `${label} ${Math.round(share * 100)}%`);

    const row = document.createElement('div');
    row.className = 'progress goal';
    row.classList.toggle('met', met);
    row.innerHTML = '<span class="progress-label"></span><span class="bar"><span></span></span><strong></strong><small></small>';
    row.querySelector('.progress-label').textContent = label;
    row.querySelector('.bar span').style.width = Math.min(100, share * 100).toFixed(1) + '%';
    row.querySelector('strong').textContent = Math.round(share * 100) + '%';
    const daysLeft = g.daysLeft === 1 ? 'last day' : `${g.daysLeft} days left`;
    row.querySelector('small').textContent = met
      ? `${statKm(g.metres)} of ${statKm(target)}: done 🎉`
      : `${statKm(g.metres)} of ${statKm(target)} · ${statKm(target - g.metres)} to go · ${daysLeft}`;

    // The ones before: a bar each, full height at the goal, green if it was met.
    const history = document.createElement('div');
    history.className = 'goal-history';
    const hit = g.history.filter(h => h.metres >= target).length;
    const top = Math.max(target, ...g.history.map(h => h.metres));
    for (const h of g.history) {
      const bar = document.createElement('span');
      bar.classList.toggle('met', h.metres >= target);
      bar.style.height = Math.max(4, (h.metres / top) * 100) + '%';
      bar.title = `${period === 'week' ? 'Week of ' + h.start.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
        : h.start.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}: ${statKm(h.metres)}`;
      history.append(bar);
    }
    const line = document.createElement('div');
    line.className = 'goal-past';
    const text = document.createElement('small');
    text.textContent = `Met ${hit} of last ${g.history.length}`;
    text.title = `Goal met in ${hit} of the last ${g.history.length} ${every}s`;
    line.append(history, text);
    rows.push(row, line);
  }
  if (!rows.length) {
    const empty = document.createElement('small');
    empty.className = 'hint';
    empty.textContent = readOnly() ? 'No goals set.' : 'No goals yet. Set a distance to cover each week or month.';
    rows.push(empty);
  }
  document.getElementById('goals-progress').replaceChildren(...rows);
  document.getElementById('goals-summary').textContent = summary.join(' · ');
}

const goalsForm = document.getElementById('goals-form');
document.getElementById('goals-edit').onclick = () => {
  document.getElementById('goal-week').value = goals.week || '';
  document.getElementById('goal-month').value = goals.month || '';
  goalsForm.hidden = false;
  document.getElementById('goals-edit').hidden = true;
  document.getElementById('goal-week').focus();
};
const closeGoalsForm = () => {
  goalsForm.hidden = true;
  document.getElementById('goals-edit').hidden = false;
};
document.getElementById('goals-cancel').onclick = closeGoalsForm;
goalsForm.onsubmit = async e => {
  e.preventDefault();
  try {
    goals = await Store.saveGoals({
      week: Number(document.getElementById('goal-week').value) || null,
      month: Number(document.getElementById('goal-month').value) || null,
    });
    goalsMet = {};  // a new target isn't "reaching" it
    closeGoalsForm();
    renderGoals();
  } catch (err) {
    alert(err.message);
  }
};

// --- Plan mode: route planning ---
// Click the map to add points; planner.js routes between them along the
// streets of your areas. The active area's streets are coloured by coverage,
// as in Streets mode, so you can aim for the ones you haven't run.
const planStatus = document.getElementById('plan-status');
let routes = [];  // saved, as from Store.routes()
// The route being drawn. waypoints: [[lat, lon]] on streets; legs[i] joins
// waypoints i and i+1, straight[i] when no streets connect them, or 'direct'
// when you made it straight (see legPopup).
const plan = { id: null, name: '', waypoints: [], legs: [], straight: [], dirty: false };
let planLayer = null;
let graph = null;
let graphKey = '';
const planBase = new WeakMap();  // prep -> { version, result }: coverage of the tracks on the map

// The street graph, rebuilt when areas or their unrunnable streets change.
function planGraph() {
  const key = areas.map(a => `${a.id}@${a.fetchedAt}:${(a.excluded || []).join('.')}`).join('|');
  if (!graph || key !== graphKey) {
    graph = Planner.build(areas);
    graphKey = key;
  }
  return graph;
}

// The part of the route from a to b: along the streets if they connect, or a
// straight line (drawn dashed) if they don't. avoid: steer off unrunnable
// streets (a route retraced from a run goes where the run went).
function legBetween(a, b, avoid = true) {
  const g = planGraph();
  const from = Planner.snap(g, a), to = Planner.snap(g, b);
  const found = from >= 0 && to >= 0 && Planner.route(g, from, to, avoid);
  return found ? { points: found.points, straight: false } : { points: [a, b], straight: true };
}

// The whole route as one line. Each leg starts where the last one ended, so
// that shared point is dropped. data: the plan, or a saved route's data.
const routePoints = data => (data.legs.length ? data.legs.flatMap((leg, i) => (i ? leg.slice(1) : leg)) : data.waypoints);

function lineMetres(points) {
  let m = 0;
  for (let i = 1; i < points.length; i++) m += Planner.distance(...points[i - 1], ...points[i]);
  return m;
}

// A click's nearest street point, or null (with a message) if there isn't one.
function snapClick(latlng) {
  if (!areas.length) {
    planStatus.textContent = 'Add an area in Streets mode first: routes follow its streets.';
    return null;
  }
  const g = planGraph();
  const i = Planner.snap(g, [latlng.lat, latlng.lng]);
  if (i < 0) {
    planStatus.textContent = "There's no street of your areas near there. Click closer to one.";
    return null;
  }
  return [g.lat[i], g.lon[i]];
}

function addWaypoint(p) {
  if (plan.waypoints.length) {
    const leg = legBetween(plan.waypoints[plan.waypoints.length - 1], p);
    plan.legs.push(leg.points);
    plan.straight.push(leg.straight);
  }
  plan.waypoints.push(p);
  planChanged();
}

// After a drag: re-routes the legs into and out of point i.
function moveWaypoint(i, latlng) {
  const p = snapClick(latlng);
  if (p) {
    plan.waypoints[i] = p;
    for (const k of [i - 1, i]) {
      if (k < 0 || k >= plan.legs.length) continue;
      if (plan.straight[k] === 'direct') {
        plan.legs[k] = [plan.waypoints[k], plan.waypoints[k + 1]];
        continue;
      }
      const leg = legBetween(plan.waypoints[k], plan.waypoints[k + 1]);
      plan.legs[k] = leg.points;
      plan.straight[k] = leg.straight;
    }
  }
  planChanged();  // redraws, which also puts a point that couldn't move back
}

// Clicking the line: a part that wanders off can be a straight line between
// its two points instead (straight[i] 'direct'), and back again.
function legPopup(i, latlng) {
  const direct = plan.straight[i] === 'direct';
  const box = document.createElement('div');
  box.className = 'street-popup';
  const button = document.createElement('button');
  button.type = 'button';
  button.textContent = direct ? 'Follow the streets' : 'Straight line here';
  button.onclick = () => {
    map.closePopup();
    const [a, b] = [plan.waypoints[i], plan.waypoints[i + 1]];
    const leg = direct ? legBetween(a, b) : { points: [a, b], straight: 'direct' };
    plan.legs[i] = leg.points;
    plan.straight[i] = leg.straight;
    planChanged();
  };
  box.append(button);
  L.popup().setLatLng(latlng).setContent(box).openOn(map);
}

// Removing the first or last point drops its one leg; removing a middle point
// replaces its two legs with one straight from its neighbours.
function removeWaypoint(i) {
  const last = plan.waypoints.length - 1;
  if (i === 0 || i === last) {
    const k = i === 0 ? 0 : last - 1;
    plan.legs.splice(k, 1);
    plan.straight.splice(k, 1);
  } else {
    const leg = legBetween(plan.waypoints[i - 1], plan.waypoints[i + 1]);
    plan.legs.splice(i - 1, 2, leg.points);
    plan.straight.splice(i - 1, 2, leg.straight);
  }
  plan.waypoints.splice(i, 1);
  planChanged();
}

function planChanged() {
  plan.dirty = true;
  planStatus.textContent = '';
  scheduleElevation();
  drawPlan();
  renderPlan();
}

// The route's elevation, from Elevation.forRoute: { profile, climb }, or
// 'loading' / 'failed'. Looked up after a pause in changes; a saved route
// keeps its own, so opening one needs no lookup.
let planElevation = null;
let elevationTimer = null;
let elevationRun = 0;  // only the newest lookup's answer is used

function scheduleElevation() {
  clearTimeout(elevationTimer);
  const run = ++elevationRun;
  planElevation = plan.waypoints.length > 1 ? 'loading' : null;
  if (!planElevation) return;
  elevationTimer = setTimeout(async () => {
    let result;
    try {
      result = await Elevation.forRoute(routePoints(plan));
    } catch (err) {
      console.error('Elevation:', err);
      result = 'failed';
    }
    if (run !== elevationRun) return;
    planElevation = result;
    renderPlan();
  }, 700);
}

// Starts a new, empty route, or (with route) opens a saved one. The saved
// points are copied so editing doesn't change the copy in the routes list.
function resetPlan(route = null) {
  const data = route ? route.data : { waypoints: [], legs: [], straight: [] };
  Object.assign(plan, {
    id: route ? route.id : null,
    name: route ? route.name : '',
    waypoints: data.waypoints.map(p => [...p]),
    legs: data.legs.map(leg => leg.map(p => [...p])),
    straight: [...(data.straight || data.legs.map(() => false))],
    dirty: false,
  });
  planStatus.textContent = '';
  if (data.elevation) {
    clearTimeout(elevationTimer);
    elevationRun++;
    planElevation = data.elevation;
  } else {
    scheduleElevation();  // routes saved before elevation existed
  }
  drawPlan();
  renderPlan();
}

// Starts a new route that retraces a run along the streets of your areas (see
// Planner.trace), ready to change and save like one you drew.
function routeFromTrack(track) {
  if (!mayDiscard()) return;
  setMode('plan');
  resetPlan();
  if (!areas.length) return;  // renderPlan says to add an area first
  const waypoints = Planner.trace(planGraph(), track.segments.flat());
  if (waypoints.length < 2) {
    planStatus.textContent = `"${track.name}" isn't on the streets of your areas.`;
    return;
  }
  for (let i = 1; i < waypoints.length; i++) {
    const leg = legBetween(waypoints[i - 1], waypoints[i], false);
    plan.legs.push(leg.points);
    plan.straight.push(leg.straight);
  }
  plan.waypoints = waypoints;
  plan.name = `${track.name} (copy)`;
  planChanged();
  map.invalidateSize();
  map.fitBounds(L.latLngBounds(routePoints(plan)), { padding: [40, 40], maxZoom: 17 });
}

// Asks before throwing away a route that hasn't been saved.
const mayDiscard = () => !plan.dirty || plan.waypoints.length < 2 || confirm('Discard the route you were drawing?');

// The route line, plus draggable markers for its points: green start, red
// finish, small white ones in between.
function drawPlan() {
  if (planLayer) planLayer.remove();
  planLayer = null;
  if (arrowLayer) arrowLayer.remove();
  arrowLayer = null;
  if (!planMode || !plan.waypoints.length) return;
  planLayer = L.layerGroup();
  plan.legs.forEach((leg, i) => {
    const line = L.polyline(leg, {
      color: '#1a73e8', weight: 5, opacity: 0.85, dashArray: plan.straight[i] ? '6 8' : null,
      className: 'plan-leg', interactive: !publicView(), bubblingMouseEvents: false,  // not a map click: that adds a point
    }).addTo(planLayer);
    line.on('click', e => legPopup(i, e.latlng));
  });
  const last = plan.waypoints.length - 1;
  plan.waypoints.forEach((p, i) => {
    const kind = i === 0 ? 'start' : i === last ? 'end' : 'via';
    if (publicView() && kind === 'via') return;  // nothing to edit, so just the ends
    const marker = L.marker(p, {
      draggable: !publicView(),
      title: publicView() ? (kind === 'start' ? 'Start' : 'Finish') : 'Drag to move, click to remove',
      interactive: !publicView(),
      icon: L.divIcon({ className: `plan-point ${kind}`, iconSize: kind === 'via' ? [12, 12] : [16, 16] }),
      zIndexOffset: kind === 'end' ? 200 : kind === 'start' ? 100 : 0,
    });
    marker.on('dragend', () => moveWaypoint(i, marker.getLatLng()));
    marker.on('click', () => removeWaypoint(i));
    marker.addTo(planLayer);
  });
  planLayer.addTo(map);
  drawArrows();
}

// Arrows along the route showing which way it goes: every ARROW_EVERY metres,
// or further apart when zoomed out so they stay ARROW_GAP pixels apart.
// Redrawn on zoom; they ignore clicks, which go to the line or the map.
const ARROW_EVERY = 200, ARROW_GAP = 60;
let arrowLayer = null;

function drawArrows() {
  if (arrowLayer) arrowLayer.remove();
  arrowLayer = null;
  if (!planLayer || plan.waypoints.length < 2) return;
  const points = routePoints(plan);
  const lat = map.getCenter().lat;
  const metresPerPixel = 40075016 * Math.cos(lat * Math.PI / 180) / 2 ** (map.getZoom() + 8);
  const every = Math.max(ARROW_EVERY, ARROW_GAP * metresPerPixel);
  arrowLayer = L.layerGroup();
  let next = every / 2;  // the first one a little way from the start marker
  let along = 0;
  for (let i = 1; i < points.length; i++) {
    const [a, b] = [points[i - 1], points[i]];
    const d = Planner.distance(...a, ...b);
    // Web Mercator keeps angles, so the compass bearing is the angle on screen.
    const bearing = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
    while (d > 0 && next <= along + d) {
      const f = (next - along) / d;
      L.marker([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f], {
        interactive: false,
        keyboard: false,
        zIndexOffset: -1000,  // under the route's points
        icon: L.divIcon({ className: 'plan-arrow', iconSize: [14, 14], html: `<span style="transform: rotate(${bearing.toFixed(0)}deg)"></span>` }),
      }).addTo(arrowLayer);
      next += every;
    }
    along += d;
  }
  arrowLayer.addTo(map);
}

map.on('zoomend', () => { if (planLayer) drawArrows(); });

// Coverage of an area by the tracks on the map. It only changes when they
// do, so it's kept between clicks.
function trackCoverage(area) {
  const prep = Coverage.prepared(area);
  let base = planBase.get(prep);
  if (!base || base.version !== trackVersion) {
    const shown = [...loaded.values()].filter(e => onMap(e.track)).map(e => e.track.segments);
    base = { version: trackVersion, result: Coverage.compute(prep, shown) };
    planBase.set(prep, base);
  }
  return base.result;
}

// Metres of the route on streets the tracks on the map haven't covered.
function newStreetMetres(points) {
  const byWay = new Map();  // areas can overlap, so count each street once
  for (const area of areas) {
    const prep = Coverage.prepared(area);
    for (const [id, m] of Coverage.gain(prep, trackCoverage(area), [[points]])) byWay.set(id, Math.max(byWay.get(id) || 0, m));
  }
  let metres = 0;
  for (const m of byWay.values()) metres += m;
  return metres;
}

// The Plan panel: the route's name, distance and help text, and which buttons work.
function renderPlan() {
  const n = plan.waypoints.length;
  const title = document.getElementById('plan-title');
  title.textContent = (plan.name || 'New route') + (plan.dirty && n > 1 ? ' (not saved)' : '');
  const stats = document.getElementById('plan-stats');
  const climb = n < 2 || !planElevation ? ''
    : planElevation === 'loading' ? ' · climb…'
      : planElevation === 'failed' ? ' · climb unavailable' : ` · ${climbText(planElevation.climb)}`;
  const chart = document.getElementById('plan-elevation');
  chart.replaceChildren(...(n > 1 && planElevation && planElevation.profile ? [Elevation.chart(planElevation.profile)] : []));
  if (publicView()) {
    stats.textContent = n > 1 ? km(lineMetres(routePoints(plan))) + climb : routes.length ? 'Pick a route below.' : 'No routes shared yet.';
  } else if (n < 2) {
    stats.textContent = !areas.length ? 'Add an area in Streets mode first: routes follow its streets.'
      : n ? 'Now click where to go next.' : 'Click the map to start a route. Each click adds a point, '
        + 'routed along the streets of your areas. Drag a point to move it, click it to remove it. '
        + 'Click the line to make a part of it straight.';
  } else {
    const points = routePoints(plan);
    const metres = lineMetres(points);
    // Street lengths are shared out by their points, so a short route can come out a little over.
    const fresh = Math.min(metres, newStreetMetres(points));
    stats.textContent = `${km(metres)}${climb} · ${km(fresh)} on streets you haven't run`
      + (plan.straight.some(Boolean) ? '. Dashed parts are straight lines.' : '');
  }
  document.getElementById('plan-undo').disabled = !n;
  document.getElementById('plan-loop').disabled = n < 2;
  document.getElementById('plan-clear').disabled = !n;
  document.getElementById('plan-save').disabled = n < 2;  // view-only accounts don't see it (style.css)
  document.getElementById('plan-gpx').disabled = n < 2;
  renderRouteList();
}

function renderRouteList() {
  const box = document.getElementById('routes');
  box.hidden = !routes.length;
  box.querySelector('.count').textContent = `(${routes.length})`;
  document.getElementById('route-list').replaceChildren(...routes.map(r => {
    const li = document.createElement('li');
    li.classList.toggle('current', r.id === plan.id);
    // Name and distance, then the actions on a line of their own.
    li.innerHTML = '<button class="link-button name" type="button" title="Open"></button><small></small>'
      + '<span class="actions"></span>';
    li.querySelector('.name').textContent = r.name;
    li.querySelector('.name').onclick = () => openRoute(r);
    li.querySelector('small').textContent = km(r.distance) + (r.data.elevation ? ` · ${climbText(r.data.elevation.climb)}` : '');
    const actions = li.querySelector('.actions');
    const action = (label, onclick, title) => {
      const button = document.createElement('button');
      button.className = 'link-button';
      button.type = 'button';
      button.textContent = label;
      if (title) button.title = title;
      button.onclick = onclick;
      actions.append(button);
    };
    action('GPX', () => downloadRoute(r.name, r.data));
    if (!readOnly()) {
      action('Link', () => shareRoute(r), 'A link that opens this route, no login needed');
      action('Rename', () => renameRoute(r));
      action('Delete', () => deleteRoute(r));
    }
    return li;
  }));
}

// Clicking a saved route: opens it for editing (or just viewing, on a view
// link) and zooms to it.
function openRoute(r) {
  if (r.id === plan.id && !plan.dirty) return;
  if (!mayDiscard()) return;
  resetPlan(r);
  const points = routePoints(r.data);
  if (points.length) {
    map.invalidateSize();  // the panel may have just changed size (on a phone it sits under the map)
    map.fitBounds(L.latLngBounds(points), { padding: [40, 40], maxZoom: 17 });
  }
}

async function deleteRoute(r) {
  if (!confirm(`Delete the route "${r.name}"?`)) return;
  try {
    await Store.deleteRoute(r.id);
    routes = routes.filter(o => o.id !== r.id);
    if (plan.id === r.id) {
      plan.id = null;  // what's drawn stays, as a new unsaved route
      plan.dirty = true;
    }
    renderPlan();
  } catch (err) {
    alert(err.message);
  }
}

// Saves a route as a .gpx file, built in the browser. Characters that aren't
// allowed in file names are dropped from the name.
function downloadRoute(name, data) {
  const blob = new Blob([Planner.gpx(name, routePoints(data))], { type: 'application/gpx+xml' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (name.replace(/[\\/:*?"<>|]+/g, '').trim() || 'route') + '.gpx';
  a.click();
  URL.revokeObjectURL(a.href);
}

async function loadRoutes() {
  try {
    routes = await Store.routes();
  } catch {
    routes = [];
  }
  renderRouteList();
}

map.on('click', e => {
  if (!planMode || publicView()) return;
  const p = snapClick(e.latlng);
  if (p) addWaypoint(p);
});

document.getElementById('plan-undo').onclick = () => {
  if (plan.waypoints.length) removeWaypoint(plan.waypoints.length - 1);
};
document.getElementById('plan-loop').onclick = () => addWaypoint([...plan.waypoints[0]]);
document.getElementById('plan-clear').onclick = () => {
  if (mayDiscard()) resetPlan();
};
document.getElementById('plan-gpx').onclick = () => downloadRoute(plan.name || 'feets route', plan);
// Asks for a name in a small dialog; resolves to the trimmed name, or null if cancelled.
function askName(title, value, okLabel) {
  const dialog = document.getElementById('name-dialog');
  const input = document.getElementById('name-dialog-input');
  document.getElementById('name-dialog-title').textContent = title;
  document.getElementById('name-dialog-ok').textContent = okLabel;
  input.value = value;
  dialog.returnValue = '';
  dialog.showModal();
  input.select();
  return new Promise(resolve => {
    dialog.addEventListener('close', () => {
      resolve(dialog.returnValue === 'ok' && input.value.trim() ? input.value.trim() : null);
    }, { once: true });
  });
}

async function renameRoute(r) {
  const name = await askName('Rename route', r.name, 'Rename');
  if (!name || name === r.name) return;
  try {
    const saved = await Store.renameRoute(r.id, name);
    routes = routes.map(o => (o.id === saved.id ? saved : o));
    if (plan.id === saved.id) plan.name = saved.name;
    renderPlan();
  } catch (err) {
    alert(err.message);
  }
}

// "Fill with unrun streets": a loop of about the chosen length over streets
// the tracks on the map haven't covered (see Planner.explore). It starts at
// the route's first point if there is one, else where you are if the ⌖ dot is
// in view, else the middle of the map. The result is an ordinary route to
// edit, save or download.
const exploreKm = document.getElementById('explore-km');
try { exploreKm.value = localStorage.getItem('feets-explore-km') || exploreKm.value; } catch {}

document.getElementById('plan-explore').onsubmit = async e => {
  e.preventDefault();
  const target = Number(exploreKm.value);
  if (!(target > 0)) return;
  try { localStorage.setItem('feets-explore-km', exploreKm.value); } catch {}
  if (!areas.length) {
    planStatus.textContent = 'Add an area in Streets mode first: routes follow its streets.';
    return;
  }
  const here = lastFix && map.getBounds().contains(lastFix);
  const [from, where] = plan.waypoints.length ? [plan.waypoints[0], 'the first point']
    : here ? [[lastFix.lat, lastFix.lng], 'you'] : [[map.getCenter().lat, map.getCenter().lng], 'the middle of the map'];
  const g = planGraph();
  const start = Planner.snap(g, from);
  if (start < 0) {
    planStatus.textContent = `There's no street of your areas near ${where}.`;
    return;
  }
  if (!mayDiscard()) return;
  const button = document.getElementById('explore');
  button.disabled = true;
  planStatus.textContent = "Looking for streets you haven't run…";
  try {
    const chains = Planner.chains(g, areas, area => trackCoverage(area).visited);
    const found = await Planner.explore(g, start, chains, target * 1000, (i, n) => {
      planStatus.textContent = `Looking for streets you haven't run… (try ${i} of ${n})`;
    });
    if (!found) {
      planStatus.textContent = `No unrun streets fit in a ${target} km loop from ${where}. Try a longer one.`;
      return;
    }
    resetPlan();
    Object.assign(plan, { waypoints: found.waypoints, legs: found.legs, straight: found.legs.map(() => false), name: `Unrun streets, ${target} km` });
    planChanged();
    planStatus.textContent = `A loop from ${where}. Change it like any route: drag points, or click them to remove them.`;
    map.fitBounds(L.latLngBounds(routePoints(plan)), { padding: [40, 40], maxZoom: 17 });
  } finally {
    button.disabled = false;
  }
};

document.getElementById('plan-streets').checked = planStreets;
document.getElementById('plan-streets').onchange = e => {
  planStreets = e.target.checked;
  try { localStorage.setItem('feets-plan-streets', planStreets ? 'on' : 'off'); } catch {}
  syncLayers();
};

// A route you opened is saved over under its name; a new one asks for a name.
document.getElementById('plan-save').onclick = async () => {
  const name = plan.id ? plan.name : await askName('Save route', plan.name || `Route ${new Date().toLocaleDateString()}`, 'Save');
  if (!name) return;
  try {
    const saved = await Store.saveRoute({
      id: plan.id, name, distance: lineMetres(routePoints(plan)),
      data: {
        waypoints: plan.waypoints, legs: plan.legs, straight: plan.straight,
        // Kept with the route if the lookup has finished; otherwise it's looked up when opened.
        ...(planElevation && planElevation.profile ? { elevation: planElevation } : {}),
      },
    });
    routes = [saved, ...routes.filter(r => r.id !== saved.id)];
    Object.assign(plan, { id: saved.id, name: saved.name, dirty: false });
    planStatus.textContent = `Saved "${saved.name}".`;
    renderPlan();
  } catch (err) {
    alert(err.message);
  }
};

for (const button of document.querySelectorAll('#mode button')) {
  button.onclick = () => setMode(button.dataset.mode);
}
let startMode = 'tracks';
try {
  const saved = localStorage.getItem('feets-mode');
  if (['heatmap', 'streets', 'plan'].includes(saved)) startMode = saved;
} catch {}
setMode(startMode);

// --- Accounts ---
const auth = document.getElementById('auth');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const setupInput = document.getElementById('auth-setup');
// Query parameters: ?invite=CODE from an invite link, ?strava=connected|error&message=…
// when Strava sends the browser back after the approval screen.
const params = new URLSearchParams(location.search);
const inviteCode = params.get('invite');
const resetCode = params.get('reset');  // ?reset=CODE from a password reset link
// ?view=CODE from a view link: the owner's map, view-only, with no login.
// &route=ID opens that saved route in Plan mode.
const viewCode = params.get('view');
const routeParam = Number(params.get('route')) || null;
Store.setViewCode(viewCode);
let stravaResult = params.get('strava');
const stravaMessage = params.get('message');
let authMode = 'login';

// fields: which inputs each form shows. "change" opens over the signed-in app
// and can be cancelled; the rest stand in front of the app until done.
const AUTH_MODES = {
  setup: {
    title: 'Create your account',
    intro: 'First run: enter the app_password from feets-config.php, then choose your username and password. You will be the admin.',
    button: 'Create account',
    fields: ['setup', 'username', 'password'],
  },
  signup: {
    title: 'Join feets',
    intro: "You've been invited. Choose a username and password.",
    button: 'Create account',
    fields: ['username', 'password'],
  },
  login: { title: 'Log in', intro: '', button: 'Log in', fields: ['username', 'password'], forgot: true },
  recover: {
    title: 'Reset a password',
    intro: 'Locked out? Enter the app_password from feets-config.php, the username, and a new password. ' +
      'Anyone else: ask the admin for a reset link.',
    button: 'Reset and log in',
    fields: ['setup', 'username', 'password'],
    cancel: true,
  },
  reset: {
    title: 'Choose a new password',
    intro: 'This will log you out on your other devices.',
    button: 'Save and log in',
    fields: ['username', 'password'],
  },
  change: {
    title: 'Change your password',
    intro: 'This will log you out on your other devices.',
    button: 'Change password',
    fields: ['current', 'password'],
    cancel: true,
  },
};

const currentInput = document.getElementById('auth-current');
const usernameInput = document.getElementById('auth-username');
const passwordInput = document.getElementById('auth-password');

// options.username pre-fills (and locks) the username, for reset links.
function showAuth(mode, options = {}) {
  authMode = mode;
  const m = AUTH_MODES[mode];
  authForm.reset();
  document.getElementById('auth-title').textContent = m.title;
  document.getElementById('auth-intro').textContent = m.intro;
  document.getElementById('auth-submit').textContent = m.button;
  const inputs = { setup: setupInput, current: currentInput, username: usernameInput, password: passwordInput };
  for (const [field, input] of Object.entries(inputs)) {
    input.hidden = !m.fields.includes(field);
    input.required = !input.hidden;
  }
  usernameInput.readOnly = Boolean(options.username);
  if (options.username) usernameInput.value = options.username;
  passwordInput.placeholder = mode === 'login' ? 'Password' : 'New password (8+ characters)';
  passwordInput.autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  document.getElementById('auth-forgot').hidden = !m.forgot;
  document.getElementById('auth-cancel').hidden = !m.cancel;
  authError.textContent = '';
  if (mode !== 'change') {
    for (const id of ['user-bar', 'settings-box', 'import-box']) document.getElementById(id).hidden = true;
  }
  auth.hidden = false;
  m.fields.map(f => inputs[f]).find(input => !input.readOnly).focus();
}

function clearTracks() {
  for (const { layer } of loaded.values()) layer.remove();
  loaded.clear();
  render();
}

async function loadTracks() {
  try {
    (await Store.all()).forEach(show);
    render();
    fitAll();
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not load tracks: ' + err.message;
  }
}

let currentUser = null;

// A view link: the owner's saved routes on a plain map, with the one in the
// link (or the newest) open. The server sends nothing else to a view link.
async function showPublicView(user) {
  document.getElementById('user-name').textContent = user.owner;
  document.getElementById('user-bar').firstElementChild.firstChild.textContent = 'Routes shared by ';
  setMode('plan');
  fadeInput.value = 0;
  applyFade();
  await loadRoutes();
  const route = routes.find(r => r.id === routeParam) || routes[0];
  if (route) openRoute(route);
  else renderPlan();
}

async function signedIn(user) {
  currentUser = user;
  auth.hidden = true;
  authForm.reset();
  // A view link keeps its code in the address, so it can be bookmarked.
  if (location.search && !user.viewLink) history.replaceState(null, '', location.pathname);
  document.getElementById('user-name').textContent = user.viewLink ? `${user.owner}'s map`
    : user.readOnly ? `${user.username} (view-only: ${user.owner}'s map)` : user.username;
  document.getElementById('user-bar').firstElementChild.firstChild.textContent = user.viewLink ? 'Viewing ' : 'Signed in as ';
  document.getElementById('logout').textContent = user.viewLink ? 'Log in' : 'Log out';
  document.body.classList.toggle('read-only', Boolean(user.readOnly));
  document.body.classList.toggle('public-view', Boolean(user.viewLink));
  document.getElementById('invite').hidden = !user.isAdmin;
  document.getElementById('invite-viewer').hidden = !user.isAdmin;
  // View-only accounts have nothing to add and no settings.
  document.getElementById('import-box').hidden = Boolean(user.readOnly);
  document.getElementById('settings-box').hidden = Boolean(user.readOnly);
  document.querySelector('#settings-box summary').textContent = user.isAdmin ? 'Account & admin' : 'Account';
  document.getElementById('reset-link').hidden = !user.isAdmin;
  document.getElementById('user-bar').hidden = false;
  if (user.viewLink) {
    await showPublicView(user);
    return;
  }
  trophyBox.hidden = false;
  document.getElementById('stats-box').hidden = false;
  document.getElementById('goals-box').hidden = false;
  clearTracks();
  await loadTracks();
  await loadGoals();
  backfillMetrics();  // in the background
  await loadAreas();
  await loadTrophies();
  scheduleTrophies();
  await loadRoutes();
  if (planMode) renderPlan();
  if (!user.readOnly) loadViewLinks();
  await initStrava();
  const shared = routeParam && routes.find(r => r.id === routeParam);
  if (shared) {
    setMode('plan');
    openRoute(shared);
  }
}

function signedOut() {
  currentUser = null;
  document.body.classList.remove('public-view');
  Store.setViewCode('');  // a turned-off view link: logging in works normally
  document.body.classList.remove('read-only');
  clearTimeout(stravaResumeTimer);
  clearTracks();
  clearAreas();
  clearTimeout(trophyTimer);
  trophies = [];
  trophyBox.hidden = true;
  document.getElementById('stats-box').hidden = true;
  document.getElementById('goals-box').hidden = true;
  goals = { week: null, month: null };
  metricsLeft = 0;
  routes = [];
  resetPlan();
  stravaBox.hidden = true;
  showAuth('login');
}

// --- Strava ---
const stravaBox = document.getElementById('strava');
const stravaStatus = document.getElementById('strava-status');
const stravaImport = document.getElementById('strava-import');
const stravaAutoToggle = document.getElementById('strava-auto-toggle');
let stravaImporting = false;
let stravaResumeTimer = null;
let stravaAutoImport = false;

// --- Collapsible boxes ---
// "Account" and "Add tracks" start collapsed and remember whether they were
// left open. While "Add tracks" is collapsed, its heading repeats the Strava
// status so import progress stays visible.
for (const id of ['settings-box', 'import-box']) {
  const box = document.getElementById(id);
  try { box.open = localStorage.getItem('feets-open-' + id) === '1'; } catch {}
  box.addEventListener('toggle', () => {
    try { localStorage.setItem('feets-open-' + id, box.open ? '1' : '0'); } catch {}
  });
}
new MutationObserver(() => {
  document.getElementById('import-summary').textContent = stravaStatus.textContent;
}).observe(stravaStatus, { childList: true, characterData: true, subtree: true });

async function refreshStrava() {
  const status = await Store.stravaStatus();
  stravaBox.hidden = !status.configured;
  document.getElementById('strava-connect').hidden = status.connected;
  document.getElementById('strava-connected').hidden = !status.connected;
  stravaStatus.textContent = status.connected ? `Connected as ${status.athlete}` : '';

  // Automatic import (Strava's webhook) is one switch for the whole site: the admin flips it.
  stravaAutoImport = status.autoImport;
  const isAdmin = Boolean(currentUser && currentUser.isAdmin);
  document.getElementById('strava-auto').hidden = !status.connected || !(status.autoImport || isAdmin);
  document.getElementById('strava-auto-text').textContent = status.autoImport
    ? 'New Strava activities are imported automatically.'
    : 'Automatic import is off.';
  stravaAutoToggle.hidden = !isAdmin;
  stravaAutoToggle.textContent = status.autoImport ? 'Turn off' : 'Turn on';
  return status;
}

async function initStrava() {
  try {
    const status = await refreshStrava();
    // Just came back from Strava's approval screen?
    if (stravaResult === 'error') stravaStatus.textContent = stravaMessage || 'Could not connect to Strava.';
    // Pick up where the last import stopped, and anything new since.
    if (status.connected) importFromStrava({ fit: stravaResult === 'connected' });
    stravaResult = null;
  } catch (err) {
    stravaBox.hidden = true;
  }
}

// Strava's 15-minute rate limit windows reset at :00, :15, :30 and :45.
function resumeAfterRateLimit(total) {
  const now = new Date();
  const next = new Date(now);
  next.setMinutes(Math.floor(now.getMinutes() / 15) * 15 + 15, 30, 0);
  const at = next.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  stravaStatus.textContent = `Imported ${total}. Strava's rate limit was reached: continuing at ${at} while this page stays open.`;
  clearTimeout(stravaResumeTimer);
  stravaResumeTimer = setTimeout(() => importFromStrava(), next - now);
}

// Imports in batches (one request each) until Strava has nothing new.
// fit: zoom to all tracks afterwards (not for the quiet check on page load).
async function importFromStrava({ fit = false } = {}) {
  if (stravaImporting) return;
  clearTimeout(stravaResumeTimer);
  stravaImporting = true;
  stravaImport.disabled = true;
  let total = 0;
  try {
    for (;;) {
      stravaStatus.textContent = `Checking Strava… ${total} imported so far`;
      const result = await Store.stravaSync();
      result.tracks.forEach(show);
      total += result.tracks.length;
      render();
      if (result.tracks.length) scheduleTrophies();
      if (result.rateLimited) {
        resumeAfterRateLimit(total);
        return;
      }
      if (result.done) break;
    }
    stravaStatus.textContent = total
      ? `Imported ${total} new ${total === 1 ? 'activity' : 'activities'} from Strava.`
      : 'Up to date with Strava.';
    if (total && fit) fitAll();
    // Renames on Strava: the newest 200 are checked on each visit.
    refreshStravaNames({ all: false });
  } catch (err) {
    stravaStatus.textContent = `Strava import stopped after ${total}: ${err.message}`;
    refreshStrava().catch(() => {});
  } finally {
    stravaImporting = false;
    stravaImport.disabled = false;
  }
}

stravaImport.onclick = () => importFromStrava({ fit: true });

// Names and types changed on Strava since import. Strava's webhook would say
// so as it happens, but Cloudflare (or any firewall in front of the site) can
// keep Strava from reaching it, so feets asks instead: the newest 200
// activities on every visit, or all of them (all: true), 200 per request.
let stravaRefreshing = false;

async function refreshStravaNames({ all }) {
  if (stravaRefreshing) return;
  stravaRefreshing = true;
  const button = document.getElementById('strava-refresh');
  button.disabled = true;
  const user = currentUser;
  let before = 0, checked = 0, renamed = 0;
  try {
    for (;;) {
      if (all) stravaStatus.textContent = `Checking names on Strava… ${checked} activities so far`;
      const result = await Store.stravaRefresh(before);
      if (currentUser !== user) return;
      checked += result.checked;
      for (const { id, name, sport } of result.changed) {
        const entry = loaded.get(id);
        if (!entry) continue;
        Object.assign(entry.track, { name, sport });
        entry.layer.remove();
        entry.layer = buildLayer(entry.track);  // its tooltip shows the name
        renamed++;
      }
      if (result.changed.length) render();  // puts the rebuilt layers back on the map
      if (result.rateLimited) {
        if (all) stravaStatus.textContent = `Strava's rate limit was reached after ${checked} activities. Try again in 15 minutes.`;
        return;
      }
      before = result.next;
      if (!all || !before) break;
    }
    if (all) {
      stravaStatus.textContent = `Checked ${checked} activities: ${renamed ? `${renamed} renamed or retyped.` : 'all names up to date.'}`;
    } else if (renamed) {
      stravaStatus.textContent = `Up to date with Strava, and picked up ${renamed} ${renamed === 1 ? 'rename' : 'renames'}.`;
    }
  } catch (err) {
    if (all) stravaStatus.textContent = `Couldn't check names: ${err.message}`;
    else console.error('Strava names:', err);
  } finally {
    stravaRefreshing = false;
    button.disabled = false;
  }
}

document.getElementById('strava-refresh').onclick = () => refreshStravaNames({ all: true });

document.getElementById('strava-disconnect').onclick = async () => {
  if (!confirm('Disconnect Strava? Tracks you already imported stay in feets.')) return;
  try {
    clearTimeout(stravaResumeTimer);
    await Store.stravaDisconnect();
    await refreshStrava();
  } catch (err) {
    alert(err.message);
  }
};

stravaAutoToggle.onclick = async () => {
  const turnOn = !stravaAutoImport;
  if (!turnOn && !confirm('Turn off automatic import? New activities will then only arrive when someone opens feets.')) return;
  stravaAutoToggle.disabled = true;
  try {
    await Store.stravaAutoImport(turnOn);
    await refreshStrava();
  } catch (err) {
    alert(err.message);
  } finally {
    stravaAutoToggle.disabled = false;
  }
};

Store.onLoggedOut(signedOut);

authForm.onsubmit = async e => {
  e.preventDefault();
  const username = usernameInput.value.trim();
  const password = passwordInput.value;
  const button = document.getElementById('auth-submit');
  button.disabled = true;
  authError.textContent = '';
  try {
    if (authMode === 'change') {
      await Store.changePassword(currentInput.value, password);
      auth.hidden = true;
      authForm.reset();
      alert('Your password has been changed.');
      return;
    }
    let user;
    if (authMode === 'setup') user = await Store.setup(setupInput.value, username, password);
    else if (authMode === 'signup') user = await Store.signup(inviteCode, username, password);
    else if (authMode === 'recover') user = await Store.recover(setupInput.value, username, password);
    else if (authMode === 'reset') user = await Store.resetPassword(resetCode, password);
    else user = await Store.login(username, password);
    await signedIn(user);
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    button.disabled = false;
  }
};

document.getElementById('logout').onclick = async () => {
  // Someone on a view link has no session: "Log in" just drops the link.
  if (currentUser && currentUser.viewLink) {
    location.href = location.pathname;
    return;
  }
  await Store.logout().catch(() => {});
  signedOut();
};

async function invite(viewer) {
  try {
    const code = await Store.createInvite(viewer);
    prompt(
      viewer
        ? "Send this link to the person you're inviting. They'll see your tracks and areas but can't change, " +
          'import, download or delete anything. It works once, within 7 days:'
        : "Send this link to the person you're inviting. It works once, within 7 days:",
      `${location.origin}${location.pathname}?invite=${code}`
    );
  } catch (err) {
    alert(err.message);
  }
}

// View links: the map for people without an account, e.g. a running club.
async function loadViewLinks() {
  let links = [];
  try {
    links = await Store.viewLinks();
  } catch {}
  const list = document.getElementById('view-link-list');
  list.hidden = !links.length;
  list.replaceChildren(...links.map(link => {
    const li = document.createElement('li');
    li.innerHTML = '<span></span><button class="link-button" type="button">Copy link</button>'
      + '<button class="link-button" type="button">Turn off</button>';
    li.querySelector('span').textContent = link.label;
    const [copy, off] = li.querySelectorAll('button');
    copy.onclick = () => prompt('Anyone with this link can see your map, tracks and routes:', viewUrl(link.code));
    off.onclick = async () => {
      if (!confirm(`Turn off the "${link.label}" link? Anyone using it will see the login screen instead.`)) return;
      await Store.deleteViewLink(link.code).catch(err => alert(err.message));
      loadViewLinks();
    };
    return li;
  }));
  return links;
}

const viewUrl = (code, routeId) => `${location.origin}${location.pathname}?view=${code}` + (routeId ? `&route=${routeId}` : '');

// Asks for a name and makes a view link; resolves to its code, or null.
async function createViewLink() {
  const label = prompt("Name this link, e.g. who it's for. Anyone with it can see your map, tracks and routes "
    + 'without logging in, until you turn it off.', 'Run club');
  if (!label || !label.trim()) return null;
  try {
    const code = await Store.createViewLink(label.trim());
    loadViewLinks();
    return code;
  } catch (err) {
    alert(err.message);
    return null;
  }
}

document.getElementById('view-link-create').onclick = async () => {
  const code = await createViewLink();
  if (code) prompt('Send this link. It works until you turn it off under Account:', viewUrl(code));
};

// A link that opens one saved route, made from your newest view link.
async function shareRoute(r) {
  let links = [];
  try {
    links = await Store.viewLinks();
  } catch {}
  const code = links.length ? links[0].code
    : confirm('Sharing a route needs a view link, which also shows your whole map. Make one?') && await createViewLink();
  if (code) prompt(`Send this link to open "${r.name}". It works until you turn off its view link under Account:`, viewUrl(code, r.id));
}

document.getElementById('invite').onclick = () => invite(false);
document.getElementById('invite-viewer').onclick = () => invite(true);

document.getElementById('change-password').onclick = () => showAuth('change');
document.getElementById('auth-forgot').onclick = () => showAuth('recover');
document.getElementById('auth-cancel').onclick = () => {
  if (authMode === 'change') {
    auth.hidden = true;
    authForm.reset();
  } else {
    showAuth('login');
  }
};

document.getElementById('reset-link').onclick = async () => {
  const username = prompt('Make a password reset link for which username?');
  if (!username || !username.trim()) return;
  try {
    const result = await Store.createResetLink(username.trim());
    prompt(
      `Send this link to ${result.username}. It works once, within 48 hours, and lets them choose a new password:`,
      `${location.origin}${location.pathname}?reset=${result.code}`
    );
  } catch (err) {
    alert(err.message);
  }
};

// --- Startup ---
(async () => {
  // A password reset link comes first, even if this browser is logged in as someone else.
  if (resetCode) {
    try {
      const { username } = await Store.resetInfo(resetCode);
      showAuth('reset', { username });
      return;
    } catch (err) {
      history.replaceState(null, '', location.pathname);
      showAuth('login');
      authError.textContent = err.message;
      return;
    }
  }
  try {
    const { user, needsSetup, viewLinkOff } = await Store.me();
    if (user) {
      await signedIn(user);
    } else {
      if (viewLinkOff) Store.setViewCode('');
      showAuth(needsSetup ? 'setup' : inviteCode ? 'signup' : 'login');
      if (viewLinkOff) authError.textContent = 'That view link has been turned off. Log in, or ask for a new link.';
    }
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not reach the server: ' + err.message;
  }
})();
