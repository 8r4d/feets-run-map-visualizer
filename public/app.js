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

// --- Heatmap ---
// Every visible track is drawn as a faint line on one canvas, so routes you
// repeat stack up and glow brighter.
const HEAT_COLOR = '#ff5a1f';
const heatRenderer = L.canvas({ padding: 0.5 });
let heatLayer = null;
let heatmap = false;
let baseBeforeHeatmap = null;

function drawHeatmap() {
  if (heatLayer) heatLayer.remove();
  heatLayer = L.layerGroup();
  for (const { track } of loaded.values()) {
    if (!track.visible) continue;
    for (const seg of track.segments) {
      // A wide, very faint halo plus a thin core line.
      L.polyline(seg, { renderer: heatRenderer, interactive: false, color: HEAT_COLOR, weight: 8, opacity: 0.03 }).addTo(heatLayer);
      L.polyline(seg, { renderer: heatRenderer, interactive: false, color: HEAT_COLOR, weight: 2.5, opacity: 0.15 }).addTo(heatLayer);
    }
  }
  heatLayer.addTo(map);
}

// Puts the right layers on the map for the current mode and visibility.
function syncLayers() {
  for (const { track, layer } of loaded.values()) {
    if (track.visible && !heatmap) layer.addTo(map);
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
  syncLayers();
}

function buildLayer(track) {
  const group = L.featureGroup();
  for (const seg of track.segments) {
    L.polyline(seg, { color: track.color, weight: 4, opacity: 0.85 })
      .bindTooltip(track.name, { sticky: true })
      .addTo(group);
  }
  for (const wpt of track.waypoints) {
    L.circleMarker(wpt.latlng, { radius: 5, color: track.color, fillOpacity: 0.9 })
      .bindPopup(wpt.name || 'Waypoint')
      .addTo(group);
  }
  return group;
}

function formatKm(m) {
  return (m / 1000).toFixed(m < 10000 ? 2 : 1) + ' km';
}

function render() {
  const list = document.getElementById('track-list');
  list.innerHTML = '';
  let total = 0;
  let visibleCount = 0;

  for (const { track, layer } of loaded.values()) {
    if (track.visible) {
      total += track.distance;
      visibleCount++;
    }

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
    const date = track.time ? new Date(track.time).toLocaleDateString() + ' · ' : '';
    name.innerHTML = '<strong></strong><small></small>';
    name.querySelector('strong').textContent = track.name;
    name.querySelector('small').textContent = date + formatKm(track.distance);
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
    list.append(li);
  }

  document.getElementById('summary').textContent = loaded.size
    ? `${loaded.size} track${loaded.size === 1 ? '' : 's'} · ${formatKm(total)} shown (${visibleCount} visible)`
    : 'No tracks yet.';

  syncLayers();
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
  if (!confirm(`Delete "${entry.track.name}"?`)) return;
  entry.layer.remove();
  loaded.delete(id);
  await Store.remove(id);
  render();
}

function fitAll() {
  const bounds = L.latLngBounds([]);
  for (const { track, layer } of loaded.values()) {
    if (track.visible) bounds.extend(layer.getBounds());
  }
  if (bounds.isValid()) map.fitBounds(bounds, { padding: [30, 30] });
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

for (const button of document.querySelectorAll('#mode button')) {
  button.onclick = () => setMode(button.dataset.mode);
}
try {
  if (localStorage.getItem('feets-mode') === 'heatmap') setMode('heatmap');
} catch {}

// --- Accounts ---
const auth = document.getElementById('auth');
const authForm = document.getElementById('auth-form');
const authError = document.getElementById('auth-error');
const setupInput = document.getElementById('auth-setup');
const inviteCode = new URLSearchParams(location.search).get('invite');
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
  if (inviteCode) history.replaceState(null, '', location.pathname);
  document.getElementById('user-name').textContent = user.username;
  document.getElementById('invite').hidden = !user.isAdmin;
  document.getElementById('user-bar').hidden = false;
  clearTracks();
  await loadTracks();
}

function signedOut() {
  clearTracks();
  showAuth('login');
}

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
