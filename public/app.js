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
};
baseLayers['OpenStreetMap'].addTo(map);
L.control.layers(baseLayers).addTo(map);
L.control.scale().addTo(map);

// id -> { track, layer }
const loaded = new Map();

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

    const download = document.createElement('a');
    download.className = 'download';
    download.href = Store.gpxUrl(track.id);
    download.textContent = '↓';
    download.title = 'Download original GPX';

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
}

function show(track) {
  const layer = buildLayer(track);
  if (track.visible) layer.addTo(map);
  loaded.set(track.id, { track, layer });
}

async function setVisible(id, visible) {
  const entry = loaded.get(id);
  entry.track.visible = visible;
  visible ? entry.layer.addTo(map) : entry.layer.remove();
  await Store.update(entry.track);
  render();
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
  const files = Array.from(e.dataTransfer.files).filter(f => /\.gpx$/i.test(f.name));
  if (files.length) addFiles(files);
});

document.getElementById('fit-all').onclick = fitAll;

// --- Startup: restore saved tracks ---
(async () => {
  try {
    const tracks = await Store.all();
    tracks.forEach(show);
    render();
    fitAll();
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not load tracks: ' + err.message;
  }
})();
