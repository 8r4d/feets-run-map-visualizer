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
  for (const { track, layer } of loaded.values()) {
    if (onMap(track) && !heatmap) layer.addTo(map);
    else layer.remove();
  }
  if (heatmap) drawHeatmap();
  else if (heatLayer) heatLayer.remove();
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
const FADE_DEFAULTS = { tracks: 0, heatmap: 30 };

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
  try { localStorage.setItem('feets-fade-' + (heatmap ? 'heatmap' : 'tracks'), fadeInput.value); } catch {}
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

async function setVisible(id, visible) {
  const entry = loaded.get(id);
  entry.track.visible = visible;
  render();
  await Store.update(entry.track);
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
  await Store.setVisible(ids, visible).catch(err => alert(err.message));
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
  if (added) fitAll();
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
});
document.addEventListener('dragleave', e => {
  if (!e.relatedTarget) dropzone.classList.remove('over');
});
document.addEventListener('drop', e => {
  e.preventDefault();
  dropzone.classList.remove('over');
  if (!auth.hidden) return;
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

for (const button of document.querySelectorAll('#mode button')) {
  button.onclick = () => setMode(button.dataset.mode);
}
let startMode = 'tracks';
try {
  if (localStorage.getItem('feets-mode') === 'heatmap') startMode = 'heatmap';
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
let stravaResult = params.get('strava');
const stravaMessage = params.get('message');
let authMode = 'login';

const AUTH_MODES = {
  setup: {
    title: 'Create your account',
    intro: 'First run: enter the app_password from feets-config.php, then choose your username and password. You will be the admin.',
    button: 'Create account',
  },
  signup: {
    title: 'Join feets',
    intro: "You've been invited. Choose a username and password.",
    button: 'Create account',
  },
  login: { title: 'Log in', intro: '', button: 'Log in' },
};

function showAuth(mode) {
  authMode = mode;
  const m = AUTH_MODES[mode];
  document.getElementById('auth-title').textContent = m.title;
  document.getElementById('auth-intro').textContent = m.intro;
  document.getElementById('auth-submit').textContent = m.button;
  setupInput.hidden = mode !== 'setup';
  setupInput.required = mode === 'setup';
  document.getElementById('auth-password').autocomplete = mode === 'login' ? 'current-password' : 'new-password';
  authError.textContent = '';
  document.getElementById('user-bar').hidden = true;
  auth.hidden = false;
  (mode === 'setup' ? setupInput : document.getElementById('auth-username')).focus();
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

async function signedIn(user) {
  auth.hidden = true;
  authForm.reset();
  if (location.search) history.replaceState(null, '', location.pathname);
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('invite').hidden = !user.isAdmin;
  document.getElementById('user-bar').hidden = false;
  clearTracks();
  await loadTracks();
  await initStrava();
}

function signedOut() {
  clearTracks();
  stravaBox.hidden = true;
  showAuth('login');
}

// --- Strava ---
const stravaBox = document.getElementById('strava');
const stravaStatus = document.getElementById('strava-status');
const stravaImport = document.getElementById('strava-import');
let stravaImporting = false;

async function refreshStrava() {
  const status = await Store.stravaStatus();
  stravaBox.hidden = !status.configured;
  document.getElementById('strava-connect').hidden = status.connected;
  document.getElementById('strava-connected').hidden = !status.connected;
  stravaStatus.textContent = status.connected ? `Connected as ${status.athlete}` : '';
  return status;
}

async function initStrava() {
  try {
    const status = await refreshStrava();
    // Just came back from Strava's approval screen?
    if (stravaResult === 'error') stravaStatus.textContent = stravaMessage || 'Could not connect to Strava.';
    if (stravaResult === 'connected' && status.connected) importFromStrava();
    stravaResult = null;
  } catch (err) {
    stravaBox.hidden = true;
  }
}

// Imports in batches (one request each) until Strava has nothing new.
async function importFromStrava() {
  if (stravaImporting) return;
  stravaImporting = true;
  stravaImport.disabled = true;
  let total = 0;
  try {
    for (;;) {
      stravaStatus.textContent = `Importing from Strava… ${total} so far`;
      const result = await Store.stravaSync();
      result.tracks.forEach(show);
      total += result.tracks.length;
      render();
      if (result.rateLimited) {
        stravaStatus.textContent = `Imported ${total}. Strava's rate limit was reached: click Import again in 15 minutes to continue.`;
        return;
      }
      if (result.done) break;
    }
    stravaStatus.textContent = total
      ? `Imported ${total} new ${total === 1 ? 'activity' : 'activities'} from Strava.`
      : 'Up to date with Strava.';
    if (total) fitAll();
  } catch (err) {
    stravaStatus.textContent = `Strava import stopped after ${total}: ${err.message}`;
    refreshStrava().catch(() => {});
  } finally {
    stravaImporting = false;
    stravaImport.disabled = false;
  }
}

stravaImport.onclick = importFromStrava;

document.getElementById('strava-disconnect').onclick = async () => {
  if (!confirm('Disconnect Strava? Tracks you already imported stay in feets.')) return;
  try {
    await Store.stravaDisconnect();
    await refreshStrava();
  } catch (err) {
    alert(err.message);
  }
};

Store.onLoggedOut(signedOut);

authForm.onsubmit = async e => {
  e.preventDefault();
  const username = document.getElementById('auth-username').value.trim();
  const password = document.getElementById('auth-password').value;
  const button = document.getElementById('auth-submit');
  button.disabled = true;
  authError.textContent = '';
  try {
    let user;
    if (authMode === 'setup') user = await Store.setup(setupInput.value, username, password);
    else if (authMode === 'signup') user = await Store.signup(inviteCode, username, password);
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

document.getElementById('invite').onclick = async () => {
  try {
    const code = await Store.createInvite();
    prompt(
      'Send this link to the person you are inviting. It works once, within 7 days:',
      `${location.origin}${location.pathname}?invite=${code}`
    );
  } catch (err) {
    alert(err.message);
  }
};

// --- Startup ---
(async () => {
  try {
    const { user, needsSetup } = await Store.me();
    if (user) await signedIn(user);
    else showAuth(needsSetup ? 'setup' : inviteCode ? 'signup' : 'login');
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not reach the server: ' + err.message;
  }
})();
