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
let mapMode = 'tracks';  // tracks, heatmap or streets
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
  const showTracks = !heatmap && !streetsMode;
  for (const { track, layer } of loaded.values()) {
    if (onMap(track) && showTracks) layer.addTo(map);
    else layer.remove();
  }
  if (heatmap) drawHeatmap();
  else if (heatLayer) heatLayer.remove();
  // Streets mode: coverage depends on which tracks are on the map.
  if (streetsMode) scheduleCoverage();
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
  mapMode = mode;
  document.getElementById('streets-panel').hidden = !streetsMode;
  for (const button of document.querySelectorAll('#mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
  try { localStorage.setItem('feets-mode', mode); } catch {}
  fadeInput.value = savedFade(mode);
  applyFade();
  syncLayers();
}

// --- Map fade ---
// Makes the base map partly transparent over a solid background (white for
// tracks, black for the heatmap), so the lines stand out more. Each mode
// remembers its own setting.
const fadeInput = document.getElementById('fade');
const FADE_DEFAULTS = { tracks: 0, heatmap: 30, streets: 50 };

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
  document.getElementById('summary').textContent = !all.length
    ? 'No tracks yet.'
    : `${filtered ? `${matching.length} of ${all.length}` : all.length} tracks · ${shown.length} on map · ${formatKm(km)}`;
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
  name.title = 'Zoom to track';
  const details = [
    track.sport && sportLabel(track.sport),
    track.time && new Date(track.time).toLocaleDateString(),
    formatKm(track.distance),
  ];
  name.innerHTML = '<strong></strong><small></small>';
  name.querySelector('strong').textContent = track.name;
  name.querySelector('small').textContent = details.filter(Boolean).join(' · ');
  name.onclick = () => {
    if (!track.visible) setVisible(track.id, true);
    map.fitBounds(layer.getBounds(), { padding: [30, 30] });
  };

  const download = document.createElement('button');
  download.className = 'download';
  download.textContent = '↓';
  download.title = 'Download original GPX';
  download.onclick = () => Store.downloadGpx(track).catch(err => alert(err.message));

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '×';
  del.title = 'Delete';
  del.onclick = () => removeTrack(track.id);

  li.append(checkbox, swatch, name, download, del);
  return li;
}

function show(track) {
  loaded.set(track.id, { track, layer: buildLayer(track) });
}

// View-only accounts can show and hide tracks too, but only in their own browser.
const readOnly = () => Boolean(currentUser && currentUser.readOnly);

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
      track.id = await Store.add({ ...track, gpx: text });
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
  activeArea = area ? { area, prep: Coverage.prepare(area, new Set(area.excluded || [])) } : null;
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
  if (!streetsMode || !activeArea) {
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
        .on('click', e => streetPopup(w, e.latlng)).addTo(streetLayer);
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
  box.querySelector('summary').textContent = `Unrunnable streets (${marked.size})`;
  box.querySelector('ul').replaceChildren(...[...marked.values()].map(m => {
    const li = document.createElement('li');
    const name = document.createElement('button');
    name.className = 'link-button';
    name.textContent = m.label;
    name.title = 'Show on map';
    name.onclick = () => showGroup(m);
    const info = document.createElement('small');
    info.textContent = ` ${CAT_NAMES[m.cat]} · ${km(m.len)} `;
    li.append(name, info);
    if (!readOnly()) {
      const again = document.createElement('button');
      again.className = 'link-button';
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

// Unfinished streets, nearest to the middle of the map first.
function renderTodo() {
  const list = document.getElementById('todo-list');
  const todo = document.getElementById('todo');
  if (!coverage) { todo.hidden = true; return; }
  const centre = map.getCenter();
  const { data } = activeArea.area;
  const items = coverage.summary.groups
    .filter(g => !g.done)
    .map(g => {
      let best = Infinity;
      for (const w of g.ways) for (const run of data.streets[w].runs) {
        for (let i = 0; i < run.length; i += 4) best = Math.min(best, centre.distanceTo(run[i]));
      }
      return { g, distance: best };
    })
    .sort((a, b) => a.distance - b.distance)
    .slice(0, TODO_LIMIT);
  todo.hidden = !items.length;
  list.replaceChildren(...items.map(({ g }) => {
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
let trophyCheck = Promise.resolve();

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

for (const button of document.querySelectorAll('#mode button')) {
  button.onclick = () => setMode(button.dataset.mode);
}
let startMode = 'tracks';
try {
  const saved = localStorage.getItem('feets-mode');
  if (['heatmap', 'streets'].includes(saved)) startMode = saved;
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

async function signedIn(user) {
  currentUser = user;
  auth.hidden = true;
  authForm.reset();
  if (location.search) history.replaceState(null, '', location.pathname);
  document.getElementById('user-name').textContent = user.readOnly
    ? `${user.username} (view-only: ${user.owner}'s map)` : user.username;
  document.body.classList.toggle('read-only', Boolean(user.readOnly));
  document.getElementById('invite').hidden = !user.isAdmin;
  document.getElementById('invite-viewer').hidden = !user.isAdmin;
  // View-only accounts have nothing to add and no settings.
  document.getElementById('import-box').hidden = Boolean(user.readOnly);
  document.getElementById('settings-box').hidden = Boolean(user.readOnly);
  document.querySelector('#settings-box summary').textContent = user.isAdmin ? 'Account & admin' : 'Account';
  document.getElementById('reset-link').hidden = !user.isAdmin;
  document.getElementById('user-bar').hidden = false;
  trophyBox.hidden = false;
  clearTracks();
  await loadTracks();
  await loadAreas();
  await loadTrophies();
  scheduleTrophies();
  await initStrava();
}

function signedOut() {
  currentUser = null;
  document.body.classList.remove('read-only');
  clearTimeout(stravaResumeTimer);
  clearTracks();
  clearAreas();
  clearTimeout(trophyTimer);
  trophies = [];
  trophyBox.hidden = true;
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
  } catch (err) {
    stravaStatus.textContent = `Strava import stopped after ${total}: ${err.message}`;
    refreshStrava().catch(() => {});
  } finally {
    stravaImporting = false;
    stravaImport.disabled = false;
  }
}

stravaImport.onclick = () => importFromStrava({ fit: true });

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
    const { user, needsSetup } = await Store.me();
    if (user) await signedIn(user);
    else showAuth(needsSetup ? 'setup' : inviteCode ? 'signup' : 'login');
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not reach the server: ' + err.message;
  }
})();
