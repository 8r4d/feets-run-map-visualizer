// The page in the chosen language (see i18n.js), with a picker in Account
// and on the login screen.
I18n.translatePage();
for (const at of [document.querySelector('#settings-box .panel-body'), document.querySelector('#auth .credits')]) {
  const label = document.createElement('label');
  label.className = 'lang-row';
  label.append(t('Language') + ' ', I18n.picker());
  at.prepend(label);
}

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
  panelToggle.textContent = collapsed ? t('Show panel') : t('Hide panel');
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
    button.title = t('Show my location');
    button.setAttribute('aria-label', t('Show my location'));
    button.innerHTML = '&#8982;';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.on(button, 'click', e => {
      L.DomEvent.preventDefault(e);
      button.classList.add('locating');
      map.locate({ enableHighAccuracy: true, maximumAge: 0, timeout: 15000 });
    });
    // Back to home (see setHome): only in the bar while there is one, so the
    // bar's rounded corners stay right.
    const homeButton = L.DomUtil.create('a', 'home-button');
    homeButton.href = '#';
    homeButton.role = 'button';
    homeButton.title = t('Go to home');
    homeButton.setAttribute('aria-label', t('Go to home'));
    homeButton.innerHTML = '&#8962;';
    L.DomEvent.on(homeButton, 'click', e => {
      L.DomEvent.preventDefault(e);
      goHome();
    });
    this.button = button;
    this.homeButton = homeButton;
    return bar;
  },
});
const locateControl = new LocateControl().addTo(map);

// --- Home ---
// Where the map opens, at a set zoom, rather than zoomed out to every track.
// Saved on the account; view-only accounts get their owner's.
let home = null;  // { lat, lon, zoom }

function setHome(value) {
  home = value || null;
  const { button, homeButton } = locateControl;
  if (home) button.after(homeButton);
  else homeButton.remove();
  document.getElementById('home-clear').hidden = !home;
}

function goHome() {
  if (home) map.setView([home.lat, home.lon], home.zoom);
}

document.getElementById('home-set').onclick = async () => {
  const c = map.getCenter().wrap();
  try {
    setHome((await Store.saveHome({ lat: c.lat, lon: c.lng, zoom: map.getZoom() })).home);
    alert('Home set: the map will open here.');
  } catch (err) {
    alert(err.message);
  }
};

document.getElementById('home-clear').onclick = async () => {
  try {
    setHome((await Store.saveHome(null)).home);
  } catch (err) {
    alert(err.message);
  }
};

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
const sportLabel = sport => t(sport === NO_SPORT ? 'Other' : sport.replace(/([a-z])([A-Z])/g, '$1 $2'));

function matches(track) {
  return (!filters.text || track.name.toLowerCase().includes(filters.text.toLowerCase()))
    && (!filters.year || yearOf(track) === filters.year)
    && (!filters.sport || (track.sport || NO_SPORT) === filters.sport);
}

// One track on its own (the ◎ button): just this browser, for now, and the
// tracks' own show/hide settings are left as they were.
let soloId = null;

const onMap = track => (soloId !== null ? track.id === soloId : track.visible && matches(track));

// --- Heatmap ---
// Every visible track is drawn as a faint line on one canvas, so routes you
// repeat stack up and glow brighter.
const HEAT_COLOR = '#ff5a1f';
const heatRenderer = L.canvas({ padding: 0.5 });
let heatLayer = null;
let heatmap = false;
let streetsMode = false;
let planMode = false;
let mapMode = 'tracks';  // tracks, heatmap, fog, streets or plan
let fogMode = false;
let trackVersion = 0;    // bumped whenever the tracks on the map may have changed
// Plan mode can hide the coloured streets (Streets mode always shows them).
let planStreets = true;
let pointEdit = null;    // the track whose stray points are being removed (see editPoints)
let race = null;         // a ghost race on the map (see startRace)
let segmentPick = null;  // making a segment (see startSegmentPick)
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
  const showTracks = !heatmap && !fogMode && !streetsMode && !planMode;
  for (const { track, layer } of loaded.values()) {
    if (onMap(track) && showTracks && !(pointEdit && pointEdit.id === track.id)) layer.addTo(map);
    else layer.remove();
  }
  if (heatmap) drawHeatmap();
  else if (heatLayer) heatLayer.remove();
  if (fogMode) fogLayer.addTo(map).redraw();
  else fogLayer.remove();
  // Streets and plan mode: coverage depends on which tracks are on the map.
  if (showStreets()) scheduleCoverage();
  else if (streetLayer) streetLayer.remove();
  // Each canvas renderer is its own <canvas>, and only the top one gets
  // clicks, so one left over from another mode would swallow clicks on the
  // tracks under it. Clicks pass through the ones not in use.
  passClicks(heatRenderer, true);
  passClicks(streetRenderer, !showStreets());
  passClicks(pointRenderer, !pointEdit);
}

function passClicks(renderer, pass) {
  if (renderer._container) renderer._container.style.pointerEvents = pass ? 'none' : '';
}

// --- Fog of war ---
// Fog mode hides the map under a dark layer, cleared fogWidth metres wide
// (the Clearing slider) along every on-foot activity on the map (the filters and checkboxes count),
// so the places you've never been stand out as the dark bits. A canvas over
// the view, redrawn when the map stops moving, half a view beyond each edge
// so a pan doesn't show its edge before the redraw.
//
// With "Fog grows back" set, a clearing stays clear for a while after the
// activity, then thins back to fog until it's gone (see FOG_REGROW).
// Each spot is as clear as its most recent visit: the clearings are drawn
// light on dark into a mask, each line as light as it is fresh, keeping the
// lighter where they cross ('lighten'), and the fog is made from the mask.
// Each line is drawn in a few passes, widest and faintest first, for soft edges.
// A patch of fog smaller than FOG_GAP with clearings all round it is cleared
// too, as clear as the least clear clearing around it (see fillFogGaps).
const FOG_WIDTH = 250;    // metres cleared along each activity, unless the Clearing slider says otherwise
let fogWidth = FOG_WIDTH;
try { fogWidth = Number(localStorage.getItem('feets-fog-width')) || FOG_WIDTH; } catch {}
const FOG_COLOR = [16, 20, 31];
const FOG_PAD = 0.5;
const FOG_PASSES = [[1.6, 0.2], [1.3, 0.45], [1, 1]];  // [width, strength]
// "Fog grows back": [days a clearing stays clear, days until it's fog again].
const FOG_REGROW = { month: [7, 30], quarter: [30, 91], half: [61, 182], year: [182, 365] };
const FOG_LEVELS = 20;    // steps of freshness
const FOG_GAP = 20000;    // square metres: enclosed patches of fog smaller than this are cleared
const FOG_EDGE = 128;     // mask pixels darker than this count as fog when looking for gaps

let fogRegrow = '';       // '' (never) or a FOG_REGROW key
try {
  const saved = localStorage.getItem('feets-fog-regrow');
  fogRegrow = saved === 'on' ? 'quarter' : FOG_REGROW[saved] ? saved : '';  // 'on': the old checkbox, now 3 months
} catch {}

// How clear an activity leaves the fog, 0 to 1, by its age.
function fogClearness(track, now = Date.now()) {
  if (!fogRegrow || !track.time) return 1;
  const [fresh, gone] = FOG_REGROW[fogRegrow];
  const days = (now - new Date(track.time).getTime()) / 86400000;
  return Math.max(0, Math.min(1, (gone - days) / (gone - fresh)));
}

// Clears the small patches of fog in the mask (one byte in four, as from
// getImageData) that clearings shut in on every side: patches of fog under
// maxPixels that don't reach the edge, where there might be more fog beyond.
// Each is lightened to the least clear pixel around it, so with "Fog grows
// back" it fades with its clearings. That pixel is read one step further out
// as well, past the anti-aliased edge of the line, to get the line's own value.
const FOG_STEPS = [[-1, 0], [1, 0], [0, -1], [0, 1]];
function fillFogGaps(light, w, h, maxPixels) {
  const seen = new Uint8Array(w * h);
  const queue = new Int32Array(w * h);
  for (let start = 0; start < w * h; start++) {
    if (seen[start] || light[start * 4] >= FOG_EDGE) continue;
    let head = 0, tail = 0, edge = false, rim = 255;
    seen[start] = 1;
    queue[tail++] = start;
    while (head < tail) {
      const p = queue[head++];
      const x = p % w, y = (p - x) / w;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) edge = true;
      for (const [dx, dy] of FOG_STEPS) {
        const qx = x + dx, qy = y + dy;
        if (qx < 0 || qy < 0 || qx >= w || qy >= h) continue;
        const q = qy * w + qx;
        if (light[q * 4] >= FOG_EDGE) {
          const rx = qx + dx, ry = qy + dy;
          const beyond = rx < 0 || ry < 0 || rx >= w || ry >= h ? 0 : light[(ry * w + rx) * 4];
          rim = Math.min(rim, Math.max(light[q * 4], beyond));
        } else if (!seen[q]) {
          seen[q] = 1;
          queue[tail++] = q;
        }
      }
    }
    if (edge || tail >= maxPixels) continue;
    for (let i = 0; i < tail; i++) {
      const p = queue[i] * 4;
      if (light[p] < rim) light[p] = rim;
    }
  }
}

const FogLayer = L.Layer.extend({
  initialize() {
    this.opacity = 0.8;
    this.boxes = new WeakMap();  // track -> [south, west, north, east]
  },
  onAdd(m) {
    if (!m.getPane('fog')) {
      const pane = m.createPane('fog');
      pane.style.zIndex = 350;  // over the map, under markers and popups
      pane.style.pointerEvents = 'none';
    }
    this.canvas = L.DomUtil.create('canvas', 'fog-layer leaflet-zoom-hide', m.getPane('fog'));
    this.canvas.style.opacity = this.opacity;
    this.mask = document.createElement('canvas');
    m.on('moveend zoomend resize viewreset', this.redraw, this);
    this.redraw();
  },
  onRemove(m) {
    m.off('moveend zoomend resize viewreset', this.redraw, this);
    this.canvas.remove();
    this.canvas = null;
  },
  setOpacity(opacity) {
    this.opacity = opacity;
    if (this.canvas) this.canvas.style.opacity = opacity;
    return this;
  },
  box(track) {
    if (!this.boxes.has(track)) {
      let [s, w, n, e] = [Infinity, Infinity, -Infinity, -Infinity];
      for (const seg of track.segments) for (const [la, lo] of seg) {
        if (la < s) s = la; if (la > n) n = la; if (lo < w) w = lo; if (lo > e) e = lo;
      }
      this.boxes.set(track, [s, w, n, e]);
    }
    return this.boxes.get(track);
  },
  redraw() {
    if (!this.canvas || !this._map) return this;
    const m = this._map;
    const size = m.getSize();
    const pad = size.multiplyBy(FOG_PAD).round();
    const full = size.add(pad.multiplyBy(2));
    const origin = m.containerPointToLayerPoint(pad.multiplyBy(-1));
    L.DomUtil.setPosition(this.canvas, origin);
    // The fog is soft anyway, so one canvas pixel per screen pixel will do.
    for (const c of [this.canvas, this.mask]) {
      c.width = full.x;
      c.height = full.y;
    }
    this.canvas.style.width = full.x + 'px';
    this.canvas.style.height = full.y + 'px';

    // The activities in view, by how clear they leave the fog.
    const view = L.latLngBounds(m.containerPointToLatLng(pad.multiplyBy(-1)), m.containerPointToLatLng(size.add(pad)));
    const [s, w, n, e] = [view.getSouth(), view.getWest(), view.getNorth(), view.getEast()];
    const levels = new Map();  // level -> lines of points
    const now = Date.now();
    for (const { track } of loaded.values()) {
      if (!onMap(track) || !Stats.onFoot(track)) continue;
      const level = Math.round(fogClearness(track, now) * FOG_LEVELS);
      if (!level) continue;
      const [ts, tw, tn, te] = this.box(track);
      if (ts > n || tn < s || tw > e || te < w) continue;
      if (!levels.has(level)) levels.set(level, []);
      for (const seg of track.segments) levels.get(level).push(seg.map(p => m.latLngToLayerPoint(p).subtract(origin)));
    }

    // The mask: black, with the clearings drawn in grey to white.
    const metresPerPixel = 40075016.686 * Math.cos(m.getCenter().lat * Math.PI / 180) / 2 ** (m.getZoom() + 8);
    const width = Math.max(2, fogWidth / metresPerPixel);
    const mask = this.mask.getContext('2d');
    mask.globalCompositeOperation = 'source-over';
    mask.fillStyle = '#000';
    mask.fillRect(0, 0, full.x, full.y);
    mask.globalCompositeOperation = 'lighten';
    mask.lineCap = mask.lineJoin = 'round';
    for (const [k, strength] of FOG_PASSES) {
      for (const [level, lines] of levels) {
        const v = Math.round(255 * strength * level / FOG_LEVELS);
        mask.strokeStyle = `rgb(${v},${v},${v})`;
        mask.lineWidth = width * k;
        mask.beginPath();
        for (const line of lines) {
          mask.moveTo(line[0].x, line[0].y);
          for (let i = 1; i < line.length; i++) mask.lineTo(line[i].x, line[i].y);
        }
        mask.stroke();
      }
    }
    // The fog: its colour, as thick as the mask is dark.
    const light = mask.getImageData(0, 0, full.x, full.y).data;
    const gapPixels = FOG_GAP / metresPerPixel ** 2;
    if (gapPixels > 1) fillFogGaps(light, full.x, full.y, gapPixels);
    const ctx = this.canvas.getContext('2d');
    const fog = ctx.createImageData(full.x, full.y);
    const out = fog.data;
    const [r, g, b] = FOG_COLOR;
    for (let i = 0; i < out.length; i += 4) {
      out[i] = r; out[i + 1] = g; out[i + 2] = b;
      out[i + 3] = 255 - light[i];
    }
    ctx.putImageData(fog, 0, 0);
    return this;
  },
});
const fogLayer = new FogLayer();

// --- Mode bar ---
// On a wide screen, the Streets and Plan panels move out of the sidebar into a
// bar under the map, laid out across. The same elements move, so their
// buttons keep working. They stay in the sidebar on phones and windows under
// 1300px (too tight for four columns), and Plan's on a view link, where it's
// all the sidebar shows. A comment marks each one's place in the sidebar.
const modeBar = document.getElementById('mode-bar');
const wideScreen = matchMedia('(min-width: 1300px)');
const barPanels = ['streets-panel', 'plan-panel'].map(id => {
  const panel = document.getElementById(id);
  const home = document.createComment(id);
  panel.before(home);
  return { panel, home };
});

function placePanels() {
  let any = false;
  for (const { panel, home } of barPanels) {
    const out = wideScreen.matches && (panel.id === 'streets-panel' ? streetsMode : planMode && !publicView());
    if (out && panel.parentElement !== modeBar) modeBar.append(panel);
    if (!out && panel.parentElement === modeBar) home.after(panel);
    any ||= out;
  }
  modeBar.hidden = !any;
}
wideScreen.addEventListener('change', placePanels);
new ResizeObserver(() => {
  document.documentElement.style.setProperty('--mode-bar-height', modeBar.offsetHeight + 'px');
}).observe(modeBar);

function setMode(mode) {
  if (pointEdit && mode !== 'tracks') endPointEdit();
  if (race && mode !== 'tracks') stopRace();
  if (segmentPick && mode !== 'tracks') stopSegmentPick();
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
  fogMode = mode === 'fog';
  streetsMode = mode === 'streets';
  planMode = mode === 'plan';
  mapMode = mode;
  document.getElementById('streets-panel').hidden = !streetsMode;
  document.getElementById('plan-panel').hidden = !planMode;
  placePanels();
  map.getContainer().classList.toggle('planning', planMode);
  for (const button of document.querySelectorAll('#mode button')) {
    button.setAttribute('aria-pressed', String(button.dataset.mode === mode));
  }
  if (!publicView()) {
    try { localStorage.setItem('feets-mode', mode); } catch {}
  }
  // Plan mode keeps the map unfaded: a faded tile pane kept blanking while panning.
  document.getElementById('fade-control').hidden = planMode;
  fadeInput.value = planMode ? 0 : savedFade(mode);
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
const FADE_DEFAULTS = { tracks: 0, heatmap: 30, streets: 50, fog: 80 };

function savedFade(mode) {
  try {
    const value = localStorage.getItem('feets-fade-' + mode);
    if (value !== null) return Number(value);
  } catch {}
  return FADE_DEFAULTS[mode];
}

// In Fog mode the same slider sets how dark the fog is, and the map itself
// isn't faded, so the cleared parts look like the plain map.
function applyFade() {
  document.getElementById('fog-options').hidden = !fogMode;
  const percent = Number(fadeInput.value);
  const container = map.getContainer();
  container.style.setProperty('--map-fade', fogMode ? 0 : percent / 100);
  container.style.setProperty('--fade-color', heatmap ? '#000' : '#fff');
  fogLayer.setOpacity(percent / 100);
  document.getElementById('fade-label').textContent = fogMode ? t('Fog') : t('Fade map');
  document.getElementById('fade-value').textContent = percent + '%';
}

const fogWidthInput = document.getElementById('fog-width');
const showFogWidth = () => { document.getElementById('fog-width-value').textContent = `${fogWidth} m`; };
fogWidthInput.value = fogWidth;
showFogWidth();
fogWidthInput.oninput = () => {
  fogWidth = Number(fogWidthInput.value);
  showFogWidth();
};
// Redrawn when the slider is let go, not at every step of a drag.
fogWidthInput.onchange = () => {
  try { localStorage.setItem('feets-fog-width', String(fogWidth)); } catch {}
  fogLayer.redraw();
};

const fogRegrowSelect = document.getElementById('fog-regrow');
fogRegrowSelect.value = fogRegrow;
fogRegrowSelect.onchange = () => {
  fogRegrow = fogRegrowSelect.value;
  try { localStorage.setItem('feets-fog-regrow', fogRegrow || 'off'); } catch {}
  fogLayer.redraw();
};

fadeInput.oninput = () => {
  applyFade();
  try { localStorage.setItem('feets-fade-' + mapMode, fadeInput.value); } catch {}
};

// --- Track colours ---
// Each track keeps its own colour, but they can all be drawn in one instead.
// Saved per browser.
const ONE_COLORS = { Red: '#e6194b', Blue: '#4363d8', Green: '#3cb44b', Orange: '#f58231', Purple: '#911eb4', Black: '#000' };
const trackColorSelect = document.getElementById('track-color');
trackColorSelect.append(...Object.entries(ONE_COLORS).map(([name, color]) => new Option(`All ${name.toLowerCase()}`, color)));
try { trackColorSelect.value = localStorage.getItem('feets-track-color') || ''; } catch {}
if (trackColorSelect.selectedIndex < 0) trackColorSelect.value = '';
const trackColor = track => trackColorSelect.value || track.color;

trackColorSelect.onchange = () => {
  try { localStorage.setItem('feets-track-color', trackColorSelect.value); } catch {}
  for (const { track, layer } of loaded.values()) layer.setStyle({ color: trackColor(track) });
  renderList();  // the swatches
};

function buildLayer(track) {
  const group = L.featureGroup();
  for (const seg of track.segments) {
    L.polyline(seg, { renderer: trackRenderer, color: trackColor(track), weight: 4, opacity: 0.85 })
      .bindTooltip(track.name, { sticky: true })
      .on('click', e => trackPopup(track, e.latlng))
      .addTo(group);
  }
  for (const wpt of track.waypoints) {
    L.circleMarker(wpt.latlng, { renderer: trackRenderer, radius: 5, color: trackColor(track), fillOpacity: 0.9 })
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
  const toRoute = document.createElement('button');
  toRoute.className = 'link-button';
  toRoute.type = 'button';
  toRoute.textContent = t('Create route from this activity');
  toRoute.onclick = () => {
    map.closePopup(popup);
    routeFromTrack(track);
  };
  box.append(toRoute);
  if (!readOnly() && m && m.moving) {
    const race = document.createElement('button');
    race.className = 'link-button';
    race.type = 'button';
    race.textContent = t('Race a past run');
    race.onclick = () => offerRaces(track, box, popup);
    const segment = document.createElement('button');
    segment.className = 'link-button';
    segment.type = 'button';
    segment.textContent = t('Make a segment');
    segment.title = t('Pick a stretch of this activity to time yourself on');
    segment.onclick = () => {
      map.closePopup(popup);
      startSegmentPick(track).catch(err => alert(err.message));
    };
    box.append(race, segment);
  }
  if (!readOnly()) {
    const fix = document.createElement('button');
    fix.className = 'link-button';
    fix.type = 'button';
    fix.textContent = t('Remove stray points');
    fix.onclick = () => {
      map.closePopup(popup);
      editPoints(track.id);
    };
    box.append(fix);
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
  fillSelect(yearSelect, years, t('All years'), y => y, 'year');
  fillSelect(sportSelect, sports, t('All types'), sportLabel, 'sport');

  const matching = all
    .filter(e => matches(e.track))
    .sort((a, b) => (b.track.time || '').localeCompare(a.track.time || '') || b.track.id - a.track.id);
  const shown = all.filter(e => onMap(e.track));
  const km = shown.reduce((sum, e) => sum + e.track.distance, 0);

  document.getElementById('track-list').replaceChildren(...matching.slice(0, listLimit).map(listItem));
  moreButton.hidden = matching.length <= listLimit;
  moreButton.textContent = t('Show more ({n} more)', { n: matching.length - listLimit });

  const filtered = filters.text || filters.year || filters.sport;
  renderStats(matching.map(e => e.track));

  document.getElementById('summary').textContent = !all.length
    ? 'No tracks yet.'
    : `${filtered ? `${matching.length} of ${all.length}` : all.length} tracks · ${shown.length} on map · ${formatKm(km)}`
      + (metricsLeft ? ` · working out pace and climb, ${metricsLeft} to go` : '');
  renderGoals();
  updateWelcome();
}

// --- Welcome ---
// A new account, its tracks loaded and none there, gets a welcome card at the
// top of the sidebar: Strava and GPX buttons, the Getting Started page, and a
// language picker. The boxes that would only be empty are hidden meanwhile
// (.no-tracks in style.css), and "Add tracks" is opened. All of it goes as
// soon as the first track arrives. Not for view-only accounts.
let tracksLoaded = false;  // set once the track list has come from the server
const welcome = document.getElementById('welcome');
{
  const label = document.createElement('label');
  label.className = 'lang-row';
  label.append(t('Language') + ' ', I18n.picker());
  welcome.append(label);
}
document.getElementById('welcome-gpx').onclick = () => fileInput.click();
document.getElementById('welcome-strava-import').onclick = () => importFromStrava({ fit: true });

function updateWelcome() {
  const fresh = tracksLoaded && Boolean(currentUser) && !readOnly() && !loaded.size;
  if (fresh && welcome.hidden) document.getElementById('import-box').open = true;
  welcome.hidden = !fresh;
  document.body.classList.toggle('no-tracks', fresh);
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
  checkbox.title = t('Show / hide');
  checkbox.onchange = () => setVisible(track.id, checkbox.checked);

  const swatch = document.createElement('span');
  swatch.className = 'swatch';
  swatch.style.background = trackColor(track);

  const name = document.createElement('div');
  name.className = 'name';
  name.title = t('Zoom to track and show its details');
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

  const solo = document.createElement('button');
  solo.className = 'solo';
  solo.textContent = '◎';
  solo.title = soloId === track.id ? 'Show the other tracks again' : 'Show only this track on the map';
  solo.setAttribute('aria-pressed', String(soloId === track.id));
  solo.onclick = () => {
    soloId = soloId === track.id ? null : track.id;
    if (soloId !== null && mapMode !== 'tracks' && mapMode !== 'heatmap') setMode('tracks');
    render();
    if (soloId !== null) map.fitBounds(layer.getBounds(), { padding: [30, 30] });
  };

  const download = document.createElement('button');
  download.className = 'download';
  download.textContent = '↓';
  download.title = t('Download original GPX');
  download.onclick = () => Store.downloadGpx(track).catch(err => alert(err.message));

  const toRoute = document.createElement('button');
  toRoute.className = 'to-route';
  toRoute.textContent = '⤳';
  toRoute.title = t('Plan a route from this activity');
  toRoute.onclick = () => routeFromTrack(track);

  const fixPoints = document.createElement('button');
  fixPoints.className = 'edit-points';
  fixPoints.textContent = '✎';
  fixPoints.title = t('Remove stray GPS points');
  fixPoints.onclick = () => editPoints(track.id);

  const del = document.createElement('button');
  del.className = 'delete';
  del.textContent = '×';
  del.title = t('Delete');
  del.onclick = () => removeTrack(track.id);

  li.append(checkbox, swatch, name, solo, toRoute, fixPoints, download, del);
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
  soloId = null;  // ticking a box means the usual tracks again
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
  if (soloId === id) soloId = null;
  await Store.remove(id);
  render();
}

// --- Removing stray points ---
// Shows every point in a track's GPX. Clicking one marks it to go (red) and
// the line redraws without it; clicking it again keeps it. Shift-dragging a
// box marks every point in it. Saving takes the marked points out of the
// stored GPX, and the server works out the track again.
const pointRenderer = L.canvas({ padding: 0.5, tolerance: 6 });

async function editPoints(id) {
  if (pointEdit) endPointEdit();
  if (mapMode !== 'tracks') setMode('tracks');
  map.closePopup();
  let points;
  try {
    points = await Store.trackPoints(id);
  } catch (err) {
    alert(err.message);
    return;
  }
  const entry = loaded.get(id);
  if (!entry) return;
  if (!entry.track.visible) setVisible(id, true);
  const removed = new Set();
  const color = trackColor(entry.track);
  const layer = L.layerGroup().addTo(map);
  const line = L.polyline([], { renderer: pointRenderer, color, weight: 3, opacity: 0.8, interactive: false }).addTo(layer);
  const redraw = () => {
    const segments = [];
    points.forEach(([lat, lon, seg], i) => {
      if (removed.has(i)) return;
      if (!segments.length || segments[segments.length - 1].seg !== seg) segments.push(Object.assign([], { seg }));
      segments[segments.length - 1].push([lat, lon]);
    });
    line.setLatLngs(segments);
    count.textContent = removed.size ? `${removed.size} point${removed.size === 1 ? '' : 's'} to remove` : '';
    save.disabled = !removed.size;
  };
  const KEEP = { radius: 3, color, weight: 1, fillColor: '#fff', fillOpacity: 1 };
  const REMOVE = { radius: 6, color: '#c00', weight: 2, fillColor: '#c00', fillOpacity: 0.6 };
  // A GPS that gets stuck records the same spot again and again: one marker
  // for all of them, or the ones underneath would be left behind.
  const spots = new Map();  // "lat,lon" -> { indexes, marker }
  points.forEach(([lat, lon], i) => {
    const key = `${lat},${lon}`;
    if (!spots.has(key)) spots.set(key, { latlng: L.latLng(lat, lon), indexes: [] });
    spots.get(key).indexes.push(i);
  });
  const mark = (spot, remove) => {
    for (const i of spot.indexes) remove ? removed.add(i) : removed.delete(i);
    spot.marker.setStyle(remove ? REMOVE : KEEP);
  };
  let boxed = false;  // the click that ends a box isn't a point click
  for (const spot of spots.values()) {
    spot.marker = L.circleMarker(spot.latlng, { renderer: pointRenderer, ...KEEP }).addTo(layer);
    spot.marker.on('click', () => {
      if (boxed) return;
      mark(spot, !removed.has(spot.indexes[0]));
      redraw();
    });
  }

  // Shift-drag: a box in place of the map's own shift-drag zoom. Caught on
  // the way down, before Leaflet's dragging sees it.
  const container = map.getContainer();
  let start = null, box = null;
  const onDown = e => {
    if (!e.shiftKey || e.button !== 0 || e.target.closest('.leaflet-control')) return;
    e.preventDefault();
    e.stopPropagation();
    start = map.mouseEventToLatLng(e);
    box = L.rectangle([start, start], { color: '#c00', weight: 1, dashArray: '4 4', fillOpacity: 0.1, interactive: false }).addTo(layer);
  };
  const onMove = e => { if (start) box.setBounds([start, map.mouseEventToLatLng(e)]); };
  const onUp = () => {
    if (!start) return;
    const bounds = box.getBounds();
    box.remove();
    start = box = null;
    for (const spot of spots.values()) if (bounds.contains(spot.latlng)) mark(spot, true);
    redraw();
    boxed = true;
    setTimeout(() => { boxed = false; });
  };
  container.addEventListener('mousedown', onDown, true);
  document.addEventListener('mousemove', onMove);
  document.addEventListener('mouseup', onUp);
  const unlisten = () => {
    container.removeEventListener('mousedown', onDown, true);
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
  };

  const control = L.control({ position: 'topright' });
  const panel = L.DomUtil.create('div', 'point-edit');
  panel.innerHTML = '<strong></strong><span>Click stray points to remove them, or again to keep them. '
    + 'Shift-drag a box to remove every point in it.</span>'
    + '<span class="count"></span><div><button type="button">Save</button>'
    + '<button class="link-button" type="button">Cancel</button></div>';
  panel.querySelector('strong').textContent = entry.track.name;
  const count = panel.querySelector('.count');
  const [save, cancel] = panel.querySelectorAll('button');
  L.DomEvent.disableClickPropagation(panel);
  L.DomEvent.disableScrollPropagation(panel);
  control.onAdd = () => panel;
  control.addTo(map);
  cancel.onclick = () => endPointEdit();
  save.onclick = async () => {
    save.disabled = true;
    try {
      const track = await Store.removePoints(id, [...removed]);
      Object.assign(entry.track, track);
      entry.layer.remove();
      entry.layer = buildLayer(entry.track);
      profiles.delete(id);
      endPointEdit();
    } catch (err) {
      alert(err.message);
      save.disabled = false;
    }
  };

  pointEdit = { id, layer, control, unlisten };
  redraw();
  syncLayers();  // takes the track's own line off while it's edited
  map.fitBounds(line.getBounds(), { padding: [30, 30] });
}

function endPointEdit() {
  pointEdit.layer.remove();
  pointEdit.control.remove();
  pointEdit.unlisten();
  pointEdit = null;
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
  const hadSolo = soloId !== null;
  soloId = null;
  const ids = [];
  for (const { track } of loaded.values()) {
    if (matches(track) && track.visible !== visible) {
      track.visible = visible;
      ids.push(track.id);
    }
  }
  if (!ids.length) {
    if (hadSolo) render();
    return;
  }
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
  editToggle.textContent = editing ? t('Done') : t('Edit');
  editToggle.title = editing ? t('Hide the editing buttons') : t('Show the delete, plan-a-route, fix-points and download buttons');
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
  await syncUnrunnable();
  let saved = '';
  try { saved = localStorage.getItem('feets-area') || ''; } catch {}
  fillAreaSelect();
  setActiveArea(areas.some(a => String(a.id) === saved) ? saved : areas[0] ? String(areas[0].id) : '');
}

// Streets marked unrunnable in one area but not in another that has them too
// (marked before areas were kept in step, or an area added since) get marked
// there as well: unrunnable anywhere is unrunnable everywhere.
async function syncUnrunnable() {
  if (readOnly() || areas.length < 2) return;
  const marked = new Set(areas.flatMap(a => a.excluded || []));
  for (const a of areas) {
    const have = new Set(a.excluded || []);
    const missing = [...new Set(a.data.streets.map(s => s.id))].filter(id => marked.has(id) && !have.has(id));
    if (!missing.length) continue;
    try {
      a.excluded = (await Store.excludeWays(a.id, missing, true)).excluded;
    } catch (err) {
      console.error('Unrunnable streets:', err);
    }
  }
}

function clearAreas() {
  areas = [];
  setActiveArea('');
}

// Areas in the menu: each one under the smallest other area it sits inside,
// with a dash per level, e.g. a neighbourhood under its city. Areas don't
// record their parent, so it's worked out from where their streets are.
const NEST_SAMPLES = 24;   // street points of an area tested against the others
const NEST_INSIDE = 0.8;   // the share of them that must be inside a parent

function areaParents() {
  const box = a => {
    const b = { s: Infinity, w: Infinity, n: -Infinity, e: -Infinity };
    for (const line of a.data.boundary) for (const [lat, lon] of line) {
      b.s = Math.min(b.s, lat); b.n = Math.max(b.n, lat); b.w = Math.min(b.w, lon); b.e = Math.max(b.e, lon);
    }
    b.size = (b.n - b.s) * (b.e - b.w);
    return b;
  };
  const boxes = new Map(areas.map(a => [a, box(a)]));
  const samples = a => {
    const points = a.data.streets.flatMap(s => s.runs.map(r => r[Math.floor(r.length / 2)]));
    const step = Math.max(1, Math.floor(points.length / NEST_SAMPLES));
    return points.filter((_, i) => i % step === 0).slice(0, NEST_SAMPLES);
  };
  const parent = new Map();
  for (const child of areas) {
    const points = samples(child);
    if (!points.length) continue;
    let best = null;
    for (const a of areas) {
      if (a === child || boxes.get(a).size <= boxes.get(child).size) continue;
      const inside = points.filter(([lat, lon]) => OSM.inArea(a, lat, lon)).length;
      if (inside >= points.length * NEST_INSIDE && (!best || boxes.get(a).size < boxes.get(best).size)) best = a;
    }
    if (best) parent.set(child, best);
  }
  return parent;
}

function fillAreaSelect() {
  const parent = areaParents();
  const nested = [];  // [area, depth], in menu order
  const add = (a, depth) => {
    nested.push([a, depth]);
    for (const child of areas) if (parent.get(child) === a) add(child, depth + 1);
  };
  for (const a of areas) if (!parent.has(a)) add(a, 0);  // areas is sorted by name
  const label = (a, depth) => `${'\u2013 '.repeat(depth)}${a.name}`;
  areaSelect.replaceChildren(new Option(areas.length ? 'Choose an area…' : 'No areas yet: add one', ''),
    ...nested.map(([a, depth]) => new Option(label(a, depth), String(a.id))));
  // Plan's "Stay within": each area, and the neighbourhoods inside it. The
  // saved choice wins: the menu was empty when the page first set it.
  let within = exploreWithin.value;
  try { within = localStorage.getItem('feets-explore-within') ?? within; } catch {}
  exploreWithin.replaceChildren(new Option('anywhere', ''), ...nested.flatMap(([a, depth]) => [
    new Option(label(a, depth), `a:${a.id}`),
    ...a.data.hoods.map((h, i) => new Option(`\u00a0\u00a0\u00a0· ${h.name}`, `h:${a.id}:${i}`)),
  ]));
  exploreWithin.value = within;
  if (exploreWithin.selectedIndex < 0) exploreWithin.value = '';
  summarizeExplore();
  // GPS art's area: the same choices, but somewhere has to be picked.
  const artValue = artArea.value || (() => { try { return localStorage.getItem('feets-art-area'); } catch { return null; } })();
  artArea.replaceChildren(...[...exploreWithin.options].filter(o => o.value).map(o => new Option(o.text, o.value)));
  if (artValue) artArea.value = artValue;
  if (artArea.selectedIndex < 0 && artArea.options.length) artArea.selectedIndex = 0;
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
    const tip = `${s.name || `Unnamed ${CAT_NAMES[s.cat]}`} · ${unrunnable ? 'off-limits' : Math.round(f * 100) + '%'}`;
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
    + `<span class="dotted">off-limits</span>`;
  const note = document.createElement('small');
  note.className = 'coverage-note';
  note.textContent = `Counting the ${tracks} ${tracks === 1 ? 'track' : 'tracks'} on the map. ` +
    'Use the filters below to count only some, e.g. one activity type.' +
    (readOnly() ? '' : ' Click a street to mark it off-limits.');
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
    name.title = t('Show on map');
    name.onclick = () => showGroup(m);
    const info = document.createElement('small');
    info.textContent = `${CAT_NAMES[m.cat]} · ${km(m.len)}`;
    li.append(name, info);
    if (!readOnly()) {
      const again = document.createElement('button');
      again.className = 'link-button again';
      again.textContent = t('Count again');
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
    ? 'Marked off-limits'
    : `${CAT_NAMES[s.cat]} · ${Math.round(coverage.result.fraction[w] * 100)}% covered`;
  box.append(title, info);
  if (!readOnly()) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = unrunnable ? t('Count it again') : t('Mark off-limits');
    if (s.name) button.title = `Applies to all of ${s.name} in this area`;
    button.onclick = () => setUnrunnable(w, !unrunnable);
    box.append(button);
  }
  L.popup().setLatLng(latlng).setContent(box).openOn(map);
}

// Marks a street unrunnable, or counts it again. A named street changes
// everywhere in the area (a big road often crosses several neighbourhoods);
// an unnamed path or trail just where it is.
// A street is marked in every area that has it (the same OSM ways), so an
// area and its sub-areas agree.
async function setUnrunnable(w, unrunnable) {
  const { area } = activeArea;
  const s = area.data.streets[w];
  const ways = new Set(s.name
    ? area.data.streets.filter(o => o.name === s.name && o.cat === s.cat).map(o => o.id)
    : [s.id]);
  try {
    for (const a of areas) {
      const here = a === area ? [...ways] : a.data.streets.filter(o => ways.has(o.id)).map(o => o.id);
      if (here.length) a.excluded = (await Store.excludeWays(a.id, here, unrunnable)).excluded;
    }
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
      + '<button class="link-button skip" type="button" title="Mark off-limits">Skip</button>';
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
    li.title = t('Show on map');
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
    await syncUnrunnable();
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
  scheduleQuests();
  scheduleSegments();
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
    empty.textContent = 'None yet. Add a street area and go explore it.';
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
// artShape: for GPS art, the shape it was made from ([lat, lon] points), drawn faintly underneath;
// art: its placement, for moving it by hand (see drawArtHandles).
const plan = { id: null, name: '', waypoints: [], legs: [], straight: [], dirty: false, artShape: null, art: null };
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
  button.textContent = direct ? t('Follow the streets') : t('Straight line here');
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

// The route's elevation, from Elevation.forRoute: { profile, climb,
// estimated }, or 'loading', or { error } if there are no heights at all.
// Looked up after a pause in changes; a saved route keeps its own, so opening
// one needs no lookup unless some of it was estimated.
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
      result = { error: err.message };
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
    artShape: null,
    art: null,
  });
  planStatus.textContent = '';
  if (data.elevation) {
    clearTimeout(elevationTimer);
    elevationRun++;
    planElevation = data.elevation;
    if (data.elevation.estimated) scheduleElevation();  // the missing heights may be available now
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
  stopTrace();
  if (planLayer) planLayer.remove();
  planLayer = null;
  if (arrowLayer) arrowLayer.remove();
  arrowLayer = null;
  if (!planMode || !plan.waypoints.length) return;
  planLayer = L.layerGroup();
  if (plan.artShape) {
    const outline = L.polyline(plan.artShape, { color: '#8e24aa', weight: 6, opacity: 0.3, interactive: false }).addTo(planLayer);
    drawArtHandles(planLayer, outline);
  }
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
  traceControl.show(plan.waypoints.length > 1);
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

// --- Tracing a route ---
// ▶ on the map sends a marker along the route from start to finish, leaving
// a bright trail behind it, so where a route crosses or doubles back on
// itself you can see which way it goes each time. At 1× a route takes about
// TRACE_SECONDS, however long it is; the map follows the marker.
const TRACE_SECONDS = 20;
const TRACE_SPEEDS = [0.5, 1, 2, 4];
let trace = null;  // { points, along, total, at, layer, marker, trail, frame, last, playing }
let traceSpeed = 1;
try { traceSpeed = TRACE_SPEEDS.includes(Number(localStorage.getItem('feets-trace-speed'))) ? Number(localStorage.getItem('feets-trace-speed')) : 1; } catch {}

const TraceControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'trace-control leaflet-bar');
    bar.innerHTML = '<button type="button" class="trace-play" title="Trace the route from start to finish">▶</button>'
      + '<button type="button" class="trace-speed" title="Speed"></button>'
      + '<span class="trace-km"></span>';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    [this.play, this.speed] = bar.querySelectorAll('button');
    this.km = bar.querySelector('.trace-km');
    this.play.onclick = () => toggleTrace();
    this.speed.onclick = () => {
      traceSpeed = TRACE_SPEEDS[(TRACE_SPEEDS.indexOf(traceSpeed) + 1) % TRACE_SPEEDS.length];
      try { localStorage.setItem('feets-trace-speed', String(traceSpeed)); } catch {}
      this.update();
    };
    this.bar = bar;
    this.show(false);
    this.update();
    return bar;
  },
  show(on) {
    this.bar.hidden = !on;
  },
  // The buttons and the distance, from the trace's state.
  update() {
    const playing = trace && trace.playing;
    const done = trace && !playing && trace.at >= trace.total;
    this.play.textContent = playing ? '❚❚' : done ? '↺' : '▶';
    this.play.title = t(playing ? 'Pause' : done ? 'Trace it again' : trace ? 'Carry on' : 'Trace the route from start to finish');
    this.speed.textContent = `${traceSpeed === 0.5 ? '½' : traceSpeed}×`;
    this.km.textContent = trace ? `${(trace.at / 1000).toFixed(1)} / ${(trace.total / 1000).toFixed(1)} km` : '';
    this.km.hidden = !trace;
  },
});
const traceControl = new TraceControl().addTo(map);

function toggleTrace() {
  if (trace && trace.playing) {
    trace.playing = false;
    cancelAnimationFrame(trace.frame);
    traceControl.update();
    return;
  }
  if (!trace || trace.at >= trace.total) startTrace();
  trace.playing = true;
  trace.last = performance.now();
  trace.frame = requestAnimationFrame(stepTrace);
  traceControl.update();
}

function startTrace() {
  stopTrace();
  const points = routePoints(plan);
  const along = [0];
  for (let i = 1; i < points.length; i++) along.push(along[i - 1] + Planner.distance(...points[i - 1], ...points[i]));
  const total = along[along.length - 1];
  const layer = L.layerGroup().addTo(map);
  const trail = L.polyline([points[0]], { color: '#ff6d00', weight: 7, opacity: 0.9, interactive: false }).addTo(layer);
  const marker = L.marker(points[0], {
    interactive: false, keyboard: false, zIndexOffset: 1000,
    icon: L.divIcon({ className: 'trace-marker', iconSize: [22, 22], html: '<span></span>' }),
  }).addTo(layer);
  trace = { points, along, total, at: 0, index: 1, layer, trail, trailPoints: [points[0]], marker, playing: false };
}

function stopTrace() {
  if (!trace) return;
  cancelAnimationFrame(trace.frame);
  trace.layer.remove();
  trace = null;
  traceControl.update();
}

function stepTrace(now) {
  const t = trace;
  if (!t || !t.playing) return;
  const speed = Math.max(t.total / TRACE_SECONDS, 20) * traceSpeed;  // metres per second
  t.at = Math.min(t.total, t.at + speed * Math.min(now - t.last, 100) / 1000);
  t.last = now;
  // Points passed join the trail; the marker sits between two of them.
  while (t.index < t.points.length - 1 && t.along[t.index] <= t.at) t.trailPoints.push(t.points[t.index++]);
  const a = t.points[t.index - 1], b = t.points[t.index];
  const span = t.along[t.index] - t.along[t.index - 1];
  const f = span ? (t.at - t.along[t.index - 1]) / span : 1;
  const here = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  t.trail.setLatLngs([...t.trailPoints, here]);
  t.marker.setLatLng(here);
  const bearing = Math.atan2((b[1] - a[1]) * Math.cos(a[0] * Math.PI / 180), b[0] - a[0]) * 180 / Math.PI;
  t.marker.getElement().firstChild.style.transform = `rotate(${bearing.toFixed(0)}deg)`;
  if (!map.getBounds().pad(-0.15).contains(here)) map.panTo(here);
  if (t.at >= t.total) t.playing = false;
  else t.frame = requestAnimationFrame(stepTrace);
  traceControl.update();
}

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
  const e = planElevation;
  const climb = n < 2 || !e ? ''
    : e === 'loading' ? ' · climb…'
      : e.error ? ` · climb unavailable: ${e.error}`
        // Some heights filled in from the ones either side (see Elevation.forRoute).
        : e.estimated ? ` · ≈ ${climbText(e.climb)} (estimated${e.estimated >= 0.05 ? `, ${Math.round(e.estimated * 100)}% of heights missing` : ''})`
          : ` · ${climbText(e.climb)}`;
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
    stats.textContent = `${km(metres)}${climb} · ${km(fresh)} on new streets`
      + (plan.straight.some(Boolean) ? '. Dashed parts are straight lines.' : '');
  }
  document.getElementById('plan-undo').disabled = !n;
  document.getElementById('plan-loop').disabled = n < 2;
  document.getElementById('plan-reverse').disabled = n < 2;
  document.getElementById('plan-clear').disabled = !n;
  document.getElementById('plan-save').disabled = n < 2;  // view-only accounts don't see it (style.css)
  document.getElementById('plan-gpx').disabled = n < 2;
  renderRouteList();
}

// How the saved routes are listed. `routes` itself stays newest first (last
// changed), as the server sends them. Remembered per browser.
const routeSort = document.getElementById('route-sort');
try { routeSort.value = localStorage.getItem('feets-route-sort') || 'newest'; } catch {}
routeSort.onchange = () => {
  try { localStorage.setItem('feets-route-sort', routeSort.value); } catch {}
  renderRouteList();
};
const ROUTE_ORDERS = {
  newest: () => 0,
  name: (a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }),  // "Loop 2" before "Loop 10"
  shortest: (a, b) => a.distance - b.distance,
  longest: (a, b) => b.distance - a.distance,
};

function renderRouteList() {
  const box = document.getElementById('routes');
  box.hidden = !routes.length;
  box.querySelector('.count').textContent = `(${routes.length})`;
  routeSort.hidden = routes.length < 2;
  const sorted = [...routes].sort(ROUTE_ORDERS[routeSort.value] || ROUTE_ORDERS.newest);
  document.getElementById('route-list').replaceChildren(...sorted.map(r => {
    const li = document.createElement('li');
    li.classList.toggle('current', r.id === plan.id);
    // Name and distance, then the actions on a line of their own.
    li.innerHTML = '<button class="link-button name" type="button" title="Open"></button><small></small>'
      + '<span class="actions"></span>';
    li.querySelector('.name').textContent = r.name;
    li.querySelector('.name').onclick = () => openRoute(r);
    // Just the distance: not every saved route has its climb stored, so that's
    // only shown in the panel for the route that's open.
    li.querySelector('small').textContent = km(r.distance);
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
    if (publicView()) action('Share', () => shareRouteLink(r), 'Send someone a link to this route');
    if (!readOnly()) {
      action('Link', () => shareRoute(r), 'A link that opens this route, no login needed');
      action('Rename', () => renameRoute(r));
      action('Delete', () => deleteRoute(r));
    }
    return li;
  }));
}

// Share on a view link: this view link, opening this route. Phones get the
// system share sheet; elsewhere the link is copied, or shown to copy by hand.
async function shareRouteLink(r) {
  const url = viewUrl(viewCode, r.id);
  if (navigator.share) {
    try {
      await navigator.share({ title: r.name, text: `${r.name}: ${km(r.distance)} route`, url });
      return;
    } catch (err) {
      if (err.name === 'AbortError') return;  // closed the share sheet
    }
  }
  try {
    await navigator.clipboard.writeText(url);
    planStatus.textContent = `Link to "${r.name}" copied.`;
  } catch {
    prompt(`Link to "${r.name}":`, url);
  }
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
// The same route the other way round. The elevation is flipped here rather
// than looked up again; the climb changes, as what went down now goes up.
document.getElementById('plan-reverse').onclick = () => {
  const elevation = planElevation && planElevation.profile;
  plan.waypoints.reverse();
  plan.legs = plan.legs.reverse().map(leg => [...leg].reverse());
  plan.straight.reverse();
  planChanged();
  if (elevation) {
    const total = elevation[elevation.length - 1][0];
    const profile = elevation.map(([d, m]) => [Math.round((total - d) * 1000) / 1000, m]).reverse();
    clearTimeout(elevationTimer);
    elevationRun++;
    planElevation = { ...planElevation, profile, climb: Math.round(Elevation.climb(profile.map(p => p[1]))) };
    renderPlan();
  }
};
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

// "Make a loop": a loop of about the chosen length (see Planner.explore),
// through streets the tracks on the map haven't covered, or with "Through
// streets I haven't run" unticked, over any streets. It starts at
// the route's first point if there is one, else where you are if the ⌖ dot is
// in view, else the middle of the map. The result is an ordinary route to
// edit, save or download.
const exploreKm = document.getElementById('explore-km');
const exploreWithin = document.getElementById('explore-within');
try { exploreKm.value = localStorage.getItem('feets-explore-km') || exploreKm.value; } catch {}
// Complexity, 1 (a simple loop through a stretch or two) to 5 (as many unrun streets as fit).
const exploreLevel = document.getElementById('explore-level');
try { exploreLevel.value = localStorage.getItem('feets-explore-level') || exploreLevel.value; } catch {}
exploreLevel.onchange = () => {
  try { localStorage.setItem('feets-explore-level', exploreLevel.value); } catch {}
};
// Whether to go for unrun streets, or make a loop over any; and, going for
// unrun ones, whether to favour finishing streets already started.
const exploreUnrun = document.getElementById('explore-unrun');
const exploreFinish = document.getElementById('explore-finish');
try { exploreUnrun.checked = localStorage.getItem('feets-explore-unrun') !== 'off'; } catch {}
try { exploreFinish.checked = localStorage.getItem('feets-explore-finish') === 'on'; } catch {}
const syncFinish = () => { exploreFinish.disabled = !exploreUnrun.checked; };
syncFinish();
exploreUnrun.onchange = () => {
  try { localStorage.setItem('feets-explore-unrun', exploreUnrun.checked ? 'on' : 'off'); } catch {}
  syncFinish();
};
exploreFinish.onchange = () => {
  try { localStorage.setItem('feets-explore-finish', exploreFinish.checked ? 'on' : 'off'); } catch {}
};
// For groups: no dead ends or doubling back (see Planner.explore).
const exploreGroup = document.getElementById('explore-group');
try { exploreGroup.checked = localStorage.getItem('feets-explore-group') === 'on'; } catch {}
exploreGroup.onchange = () => {
  try { localStorage.setItem('feets-explore-group', exploreGroup.checked ? 'on' : 'off'); } catch {}
};
// Kinds of street: any, prefer paths and trails, or roads only (see Planner.explore).
const exploreStreets = document.getElementById('explore-streets');
try { exploreStreets.value = localStorage.getItem('feets-explore-streets') || 'any'; } catch {}
if (exploreStreets.selectedIndex < 0) exploreStreets.value = 'any';
exploreStreets.onchange = () => {
  try { localStorage.setItem('feets-explore-streets', exploreStreets.value); } catch {}
};
// Hills: 'any', 'flat' or 'hilly' (heights come from Elevation.grid).
// Finish: 'start' for a loop, or 'last' to end at the route's last point.
for (const [id, key, fallback] of [['explore-hills', 'feets-explore-hills', 'any'], ['explore-end', 'feets-explore-end', 'start']]) {
  const select = document.getElementById(id);
  try { select.value = localStorage.getItem(key) || fallback; } catch {}
  if (select.selectedIndex < 0) select.value = fallback;
  select.onchange = () => {
    try { localStorage.setItem(key, select.value); } catch {}
  };
}
const exploreHills = document.getElementById('explore-hills');
const exploreEnd = document.getElementById('explore-end');

// Heights of the graph's points for "Hills": a coarse grid looked up around
// the start (and finish), out as far as the route can go. Resolves to a
// Float32Array over the graph's points, or rejects if no heights could be had.
async function routeHeights(g, points, budget) {
  const reach = budget / 2 / 111320;  // degrees of latitude
  const lats = points.map(p => p[0]), lons = points.map(p => p[1]);
  const kx = Math.cos(lats[0] * Math.PI / 180);
  const heightAt = await Elevation.grid(
    Math.min(...lats) - reach, Math.min(...lons) - reach / kx, Math.max(...lats) + reach, Math.max(...lons) + reach / kx);
  const heights = new Float32Array(g.lat.length);
  for (let i = 0; i < heights.length; i++) heights[i] = heightAt(g.lat[i], g.lon[i]);
  return heights;
}

// Stay within: '' for anywhere, 'a:ID' for an area, 'h:ID:N' for neighbourhood
// N of an area. Filled in, and the saved choice set, with the areas (see fillAreaSelect).
exploreWithin.onchange = () => {
  try { localStorage.setItem('feets-explore-within', exploreWithin.value); } catch {}
};

// The Options box: remembers whether it was left open, and while closed its
// heading lists the options that aren't at their usual settings.
const exploreOptions = document.getElementById('explore-options');
try { exploreOptions.open = localStorage.getItem('feets-explore-options') === 'open'; } catch {}
exploreOptions.addEventListener('toggle', () => {
  try { localStorage.setItem('feets-explore-options', exploreOptions.open ? 'open' : 'closed'); } catch {}
});

function summarizeExplore() {
  const text = select => select.selectedOptions[0] ? select.selectedOptions[0].text.replace(/^[\s\u00a0\u2013·]+/, '') : '';
  const level = Number(exploreLevel.value);
  const parts = [
    !exploreUnrun.checked && 'any streets',
    exploreUnrun.checked && exploreFinish.checked && 'finish started',
    exploreGroup.checked && 'for groups',
    level !== 3 && (level < 3 ? 'simpler' : 'more thorough'),
    exploreHeading.value !== '' && `heading ${text(exploreHeading)}`,
    exploreStreets.value !== 'any' && text(exploreStreets),
    exploreHills.value !== 'any' && text(exploreHills),
    exploreEnd.value !== 'start' && 'finish at last point',
    exploreWithin.value && `in ${text(exploreWithin)}`,
  ].filter(Boolean);
  document.getElementById('explore-summary').textContent = parts.length ? `· ${parts.join(', ')}` : '';
}
document.getElementById('plan-explore').addEventListener('change', summarizeExplore);
document.getElementById('plan-explore').addEventListener('input', summarizeExplore);

// A made route only has points where it joins and leaves each stretch, and
// dragging one reroutes both its legs the shortest way. So each leg gets a
// point about every HANDLE_EVERY metres (none within HANDLE_GAP of a point it
// has): the same route, with handles that each move just a short piece of it.
const HANDLE_EVERY = 400, HANDLE_GAP = 150;

function withHandles(waypoints, legs) {
  const out = { waypoints: [waypoints[0]], legs: [] };
  legs.forEach((leg, i) => {
    const length = lineMetres(leg);
    const pieces = Math.max(1, Math.round(length / HANDLE_EVERY));
    let from = 0, along = 0, next = length / pieces;
    for (let k = 1; k < leg.length - 1; k++) {
      along += Planner.distance(...leg[k - 1], ...leg[k]);
      if (along >= next && along > HANDLE_GAP && length - along > HANDLE_GAP) {
        out.legs.push(leg.slice(from, k + 1));
        out.waypoints.push(leg[k]);
        from = k;
        next += length / pieces;
      }
    }
    out.legs.push(leg.slice(from));
    out.waypoints.push(waypoints[i + 1]);
  });
  return out;
}

// The street points a loop may use with "Stay within" set: a Uint8Array over
// the graph's points, with its name; null for anywhere. Kept until the graph
// or the choice changes.
// (Also used by GPS art, with its own choice of area.)
const withinCache = new WeakMap();  // graph -> Map(value -> mask)
function withinMask(g, value = exploreWithin.value) {
  if (!value) return null;
  if (!withinCache.has(g)) withinCache.set(g, new Map());
  const cached = withinCache.get(g).get(value);
  if (cached) return cached;
  const [kind, id, h] = value.split(':');
  const area = areas.find(a => String(a.id) === id);
  if (!area) return null;
  const inside = kind === 'h' ? (la, lo) => OSM.inHood(area, Number(h), la, lo) : (la, lo) => OSM.inArea(area, la, lo);
  const allowed = new Uint8Array(g.lat.length);
  for (let i = 0; i < allowed.length; i++) allowed[i] = inside(g.lat[i], g.lon[i]) ? 1 : 0;
  // Only the biggest connected piece: streets along the edge can leave scraps
  // inside that join nothing else, and a loop can't start from one of those.
  const piece = new Int32Array(allowed.length).fill(-1);
  const sizes = [];
  for (let i = 0; i < allowed.length; i++) {
    if (!allowed[i] || piece[i] >= 0) continue;
    const id = sizes.length, stack = [i];
    piece[i] = id;
    let size = 0;
    while (stack.length) {
      const a = stack.pop();
      size++;
      const edges = g.adj[a];
      for (let k = 0; k < edges.length; k += 3) {
        const b = edges[k];
        if (allowed[b] && piece[b] < 0) {
          piece[b] = id;
          stack.push(b);
        }
      }
    }
    sizes.push(size);
  }
  const biggest = sizes.indexOf(Math.max(...sizes));
  for (let i = 0; i < allowed.length; i++) allowed[i] = allowed[i] && piece[i] === biggest ? 1 : 0;
  const name = kind === 'h' ? area.data.hoods[Number(h)].name : area.name;
  const mask = { allowed, name };
  withinCache.get(g).set(value, mask);
  return mask;
}

// The allowed point nearest to [lat, lon], or -1 if none is.
function nearestAllowed(g, allowed, [la, lo]) {
  let best = -1, bestD = Infinity;
  for (let i = 0; i < allowed.length; i++) {
    if (!allowed[i]) continue;
    const d = Planner.distance(la, lo, g.lat[i], g.lon[i]);
    if (d < bestD) { bestD = d; best = i; }
  }
  return best;
}
// Heading: favour streets that lie this way from the start (degrees, '' for any).
const exploreHeading = document.getElementById('explore-heading');
try { exploreHeading.value = localStorage.getItem('feets-explore-heading') || ''; } catch {}
if (exploreHeading.selectedIndex < 0) exploreHeading.value = '';
exploreHeading.onchange = () => {
  try { localStorage.setItem('feets-explore-heading', exploreHeading.value); } catch {}
};
summarizeExplore();

document.getElementById('plan-explore').onsubmit = async e => {
  e.preventDefault();
  const target = Number(exploreKm.value);
  if (!(target > 0)) return;
  try { localStorage.setItem('feets-explore-km', exploreKm.value); } catch {}
  if (!areas.length) {
    planStatus.textContent = 'Add an area in Streets mode first: routes follow its streets.';
    return;
  }
  // Finishing elsewhere: from the route's first point to its last.
  const oneWay = exploreEnd.value === 'last';
  if (oneWay && plan.waypoints.length < 2) {
    planStatus.textContent = 'To finish somewhere else, click the map for a start and then a finish, then Make a loop.';
    return;
  }
  const here = lastFix && map.getBounds().contains(lastFix);
  const [from, where] = plan.waypoints.length ? [plan.waypoints[0], 'the first point']
    : here ? [[lastFix.lat, lastFix.lng], 'you'] : [[map.getCenter().lat, map.getCenter().lng], 'the middle of the map'];
  const to = oneWay ? plan.waypoints[plan.waypoints.length - 1] : null;
  const g = planGraph();
  const within = withinMask(g);
  let start = Planner.snap(g, from);
  let end = oneWay ? Planner.snap(g, to) : start;
  let startNote = '';
  // Outside "Stay within": from (and to) its nearest point instead.
  if (within && (start < 0 || !within.allowed[start])) {
    start = nearestAllowed(g, within.allowed, from);
    startNote = ` It starts from the nearest point in ${within.name}.`;
  }
  if (within && oneWay && (end < 0 || !within.allowed[end])) {
    end = nearestAllowed(g, within.allowed, to);
    startNote += ` It finishes at the nearest point in ${within.name}.`;
  }
  if (!oneWay) end = start;
  if (start < 0 || end < 0) {
    planStatus.textContent = within ? `${within.name} has no streets to make a loop on.` : `There's no street of your areas near ${where}.`;
    return;
  }
  // Just a start and a finish to go between isn't a route to lose.
  if (!(oneWay && plan.waypoints.length === 2) && !mayDiscard()) return;
  const button = document.getElementById('explore');
  button.disabled = true;
  // Any streets: the same search, aiming for every street rather than just the unrun ones.
  const unrun = exploreUnrun.checked;
  const looking = unrun ? 'Looking for new streets…' : 'Looking for a loop…';
  planStatus.textContent = looking;
  try {
    // Hills need heights, looked up first; without them it plans anyway.
    let heights = null, hillNote = '';
    if (exploreHills.value !== 'any') {
      planStatus.textContent = 'Looking up hills…';
      try {
        heights = await routeHeights(g, [[g.lat[start], g.lon[start]], [g.lat[end], g.lon[end]]], target * 1000);
      } catch (err) {
        hillNote = ` Hills weren't taken into account: ${err.message}.`;
      }
      planStatus.textContent = looking;
    }
    const chains = Planner.chains(g, areas, area => {
      const { visited, fraction } = trackCoverage(area);
      return unrun ? { visited, fraction } : { visited: new Uint8Array(visited.length), fraction: new Float64Array(fraction.length) };
    });
    const found = await Planner.explore(g, start, chains, target * 1000, (i, n) => {
      planStatus.textContent = `${looking} (step ${i} of ${n})`;
    }, Number(exploreLevel.value), exploreHeading.value === '' ? null : Number(exploreHeading.value), {
      allowed: within && within.allowed,
      streets: exploreStreets.value,
      finish: unrun && exploreFinish.checked,
      heights,
      hills: exploreHills.value,
      group: exploreGroup.checked,
      end,
    });
    if (!found) {
      const inside = within ? ` inside ${within.name}` : '';
      const shape = oneWay ? `route from ${where} to your last point` : `loop from ${where}`;
      planStatus.textContent = unrun
        ? `No new streets${inside} fit in a ${target} km ${shape}. Try a longer one, or fewer options.`
        : `No ${target} km ${shape} fits${inside}. Try a longer one, or fewer options.`;
      return;
    }
    resetPlan();
    const handles = withHandles(found.waypoints, found.legs);
    Object.assign(plan, {
      waypoints: handles.waypoints, legs: handles.legs, straight: handles.legs.map(() => false),
      name: `${unrun ? 'New streets' : oneWay ? 'Route' : 'Loop'}, ${target} km`,
    });
    planChanged();
    const way = exploreHeading.value === '' ? '' : ` heading ${exploreHeading.selectedOptions[0].text}`;
    const what = oneWay ? `A route${way} from ${where} to your last point.` : `A loop${way} from ${where}.`;
    planStatus.textContent = (found.widened && way
      ? `There wasn't much ${unrun ? 'new street' : 'room'}${way} from ${where}, so this goes wider.`
      : what) + startNote + hillNote + ' Change it like any route: drag points, or click them to remove them.';
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
  if (['heatmap', 'fog', 'streets', 'plan'].includes(saved)) startMode = saved;
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
    intro: 'First time: enter the app_password from feets-config.php, then choose your username and password. You will be the admin.',
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
  document.getElementById('auth-title').textContent = t(m.title);
  document.getElementById('auth-intro').textContent = m.intro && t(m.intro);
  document.getElementById('auth-submit').textContent = t(m.button);
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
  tracksLoaded = false;
  render();
}

async function loadTracks() {
  try {
    (await Store.all()).forEach(show);
    tracksLoaded = true;
    render();
    if (!home) fitAll();
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not load tracks: ' + err.message;
  }
}

let currentUser = null;

// A view link: the owner's saved routes on a plain map, with the one in the
// link (or the newest) open. The server sends nothing else to a view link.
async function showPublicView(user) {
  document.getElementById('user-name').textContent = user.owner;
  document.getElementById('user-bar').firstElementChild.firstChild.textContent = t('Routes shared by') + ' ';
  setMode('plan');
  fadeInput.value = 0;
  applyFade();
  const expiry = document.getElementById('view-expiry');
  expiry.hidden = !user.expiresAt;
  if (user.expiresAt) expiry.textContent = `This link expires ${whenText(user.expiresAt)}.`;
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
  document.getElementById('user-bar').firstElementChild.firstChild.textContent = (user.viewLink ? t('Viewing') : t('Signed in as')) + ' ';
  document.getElementById('logout').textContent = user.viewLink ? t('Log in') : t('Log out');
  document.body.classList.toggle('read-only', Boolean(user.readOnly));
  document.body.classList.toggle('public-view', Boolean(user.viewLink));
  document.getElementById('invite').hidden = !user.isAdmin;
  document.getElementById('invite-viewer').hidden = !user.isAdmin;
  // View-only accounts have nothing to add and no settings.
  document.getElementById('import-box').hidden = Boolean(user.readOnly);
  document.getElementById('settings-box').hidden = Boolean(user.readOnly);
  document.querySelector('#settings-box summary').textContent = user.isAdmin ? t('Account & admin') : t('Account');
  document.getElementById('reset-link').hidden = !user.isAdmin;
  document.getElementById('user-bar').hidden = false;
  if (user.viewLink) {
    await showPublicView(user);
    return;
  }
  trophyBox.hidden = false;
  document.getElementById('stats-box').hidden = false;
  document.getElementById('goals-box').hidden = false;
  setHome(user.home);
  goHome();  // straight away, while the tracks load
  clearTracks();
  await loadTracks();
  await loadGoals();
  backfillMetrics();  // in the background
  await loadAreas();
  await loadTrophies();
  await loadSegments();
  await loadArtShapes();
  scheduleTrophies();
  await loadRoutes();
  if (planMode) renderPlan();
  if (!user.readOnly) loadViewLinks();
  autoAreas.checked = Boolean(user.autoAreas);
  if (autoAreas.checked) scheduleFindAreas(SCAN_FIRST);
  await initStrava();
  const shared = routeParam && routes.find(r => r.id === routeParam);
  if (shared) {
    setMode('plan');
    openRoute(shared);
  }
}

function signedOut() {
  currentUser = null;
  questState = null;
  segments = [];
  segmentsBox.hidden = true;
  questsBox.hidden = true;
  setHome(null);
  clearTimeout(scanTimer);
  document.body.classList.remove('public-view');
  document.getElementById('view-expiry').hidden = true;
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
  document.getElementById('welcome-strava').hidden = !status.configured || status.connected;
  document.getElementById('welcome-strava-import').hidden = !status.configured || !status.connected;
  stravaStatus.textContent = status.connected ? `Connected as ${status.athlete}` : '';

  // Automatic import (Strava's webhook) is one switch for the whole site: the admin flips it.
  stravaAutoImport = status.autoImport;
  const isAdmin = Boolean(currentUser && currentUser.isAdmin);
  document.getElementById('strava-auto').hidden = !status.connected || !(status.autoImport || isAdmin);
  document.getElementById('strava-auto-text').textContent = status.autoImport
    ? 'New Strava activities are imported automatically.'
    : 'Automatic import is off.';
  stravaAutoToggle.hidden = !isAdmin;
  stravaAutoToggle.textContent = status.autoImport ? t('Turn off') : t('Turn on');
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
    li.querySelector('span').textContent = link.label + (!link.expiresAt ? ''
      : link.expiresAt < Date.now() ? ' (expired)' : ` (until ${whenText(link.expiresAt)})`);
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

// A link's expiry time, e.g. "Oct 24, 2026, 3:15 PM".
const whenText = ms => new Date(ms).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });

// Asks how long a link should work: a number of days, 0 for until it's
// turned off, or null if cancelled.
function askExpiry() {
  const answer = prompt('Stop the link working after how many days? Leave blank to keep it until you turn it off.', '');
  if (answer === null) return null;
  if (!answer.trim()) return 0;
  const days = Number(answer);
  if (Number.isInteger(days) && days >= 1 && days <= 365) return days;
  alert('Enter a whole number of days, from 1 to 365.');
  return null;
}

// Makes a view link, asking for a name unless given one; resolves to
// { code, days }, or null.
async function createViewLink(label = null, days = null) {
  label ??= prompt("Name this link, e.g. who it's for. Anyone with it can see your map, tracks and routes "
    + 'without logging in, until you turn it off or it expires.', 'Club');
  if (!label || !label.trim()) return null;
  days ??= askExpiry();
  if (days === null) return null;
  try {
    const code = await Store.createViewLink(label.trim(), days);
    loadViewLinks();
    return { code, days };
  } catch (err) {
    alert(err.message);
    return null;
  }
}

const worksUntil = days => days
  ? `It stops working in ${days} day${days === 1 ? '' : 's'} (${whenText(Date.now() + days * 86400000)})`
  : 'It works until you turn it off under Account';

document.getElementById('view-link-create').onclick = async () => {
  const link = await createViewLink();
  if (link) prompt(`Send this link. ${worksUntil(link.days)}:`, viewUrl(link.code));
};

// A link that opens one saved route. With no expiry it uses your newest view
// link that never expires; with one, it gets a view link of its own.
async function shareRoute(r) {
  const days = askExpiry();
  if (days === null) return;
  let links = [];
  try {
    links = await Store.viewLinks();
  } catch {}
  const lasting = links.find(l => !l.expiresAt);
  const link = days ? await createViewLink(`Route: ${r.name}`, days)
    : lasting ? { code: lasting.code, days: 0 }
    : confirm('Sharing a route needs a view link, which also shows your whole map. Make one?') && await createViewLink(null, 0);
  if (link) prompt(`Send this link to open "${r.name}". ${worksUntil(link.days)}:`, viewUrl(link.code, r.id));
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

// --- Help ---
// The Help box lists pages in help/; each opens in one window. A page is
// plain HTML: its first heading becomes the window's title, its links to
// other help pages open in the window, and other links in a new tab.
const helpDialog = document.getElementById('help-dialog');
const helpContent = document.getElementById('help-content');
const helpTitle = document.getElementById('help-dialog-title');
const helpBase = new URL('help/', location.href);

async function openHelp(href) {
  const url = new URL(href, location.href);
  helpTitle.textContent = t('Help');
  helpContent.textContent = t('Loading…');
  if (!helpDialog.open) helpDialog.showModal();
  try {
    // The time in the address dodges the host's caching, so an edited page shows up.
    const res = await fetch(`${url.pathname}?t=${Date.now()}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
    const heading = doc.body.querySelector('h1, h2');
    if (heading) {
      helpTitle.textContent = heading.textContent;
      heading.remove();
    }
    // Links and images are written relative to the page, not to index.html.
    for (const el of doc.body.querySelectorAll('[href], [src]')) {
      const attr = el.hasAttribute('href') ? 'href' : 'src';
      if (!el.getAttribute(attr).startsWith('#')) el.setAttribute(attr, new URL(el.getAttribute(attr), url).href);
    }
    for (const a of doc.body.querySelectorAll('a[href]')) {
      if (!a.href.startsWith(helpBase.href)) {
        a.target = '_blank';
        a.rel = 'noopener';
      }
    }
    helpContent.replaceChildren(...doc.body.childNodes);
    helpContent.scrollTop = 0;
  } catch (err) {
    helpContent.textContent = `Couldn't load this help page (${err.message}).`;
  }
}

document.addEventListener('click', e => {
  const a = e.target.closest('a[href]');
  if (!a || !(a.hasAttribute('data-help') || (helpContent.contains(a) && a.href.startsWith(helpBase.href)))) return;
  e.preventDefault();
  openHelp(a.href);
});
document.getElementById('help-close').onclick = () => helpDialog.close();
// A click on the dimmed backdrop lands on the dialog itself.
helpDialog.addEventListener('click', e => { if (e.target === helpDialog) helpDialog.close(); });

// --- Street maps for places you run ---
// Now and then, while feets is open, it looks for a place you've run on foot
// a few times that none of your areas covers, and adds the neighbourhood
// there, so it's ready for Streets and Plan. Gently: the server hands out a
// turn at most twice a day per account (see area_scan_claim in api.php), and
// a turn adds one area. Places with no usable boundary aren't tried again.
// A new account with only a few areas gets turns every few minutes for its
// first hours: the server says when, and the next look is then.
const SCAN_CELL = 0.01;     // degrees: places are ~1 km grid squares
const SCAN_MIN_RUNS = 2;    // runs through a place before it's worth a map
const SCAN_FIRST = 60000;   // ms after logging in before the first look
const SCAN_EVERY = 3600000; // ms between asking for a turn
// Which boundary to add, by OSM admin level: neighbourhood-sized first.
const SCAN_LEVELS = [10, 9, 11, 8, 7];
const SCAN_MAX_KM2 = 50;    // bigger boundaries (a whole city) are left for you to add by hand
const SCAN_TRIES = 5;       // places looked up in a turn, until one gets an area
let scanTimer = null;
const autoAreas = document.getElementById('auto-areas');

autoAreas.onchange = async () => {
  try {
    await Store.saveAreaScan({ on: autoAreas.checked });
    if (autoAreas.checked) scheduleFindAreas(SCAN_FIRST);
  } catch (err) {
    alert(err.message);
    autoAreas.checked = !autoAreas.checked;
  }
};

function scheduleFindAreas(delay) {
  clearTimeout(scanTimer);
  scanTimer = setTimeout(async () => {
    const again = await findAreas().catch(err => console.error('Finding areas:', err));
    if (currentUser && autoAreas.checked) scheduleFindAreas(again ? Math.min(again * 1000 + 5000, SCAN_EVERY) : SCAN_EVERY);
  }, delay);
}

// The places run most often that no area covers, busiest first: [{ key, lat, lon, runs }].
function unmappedPlaces(skip) {
  const places = new Map();
  for (const { track } of loaded.values()) {
    if (!Stats.onFoot(track)) continue;
    const here = new Set();
    for (const seg of track.segments) {
      for (const [lat, lon] of seg) {
        const key = `${Math.floor(lat / SCAN_CELL)},${Math.floor(lon / SCAN_CELL)}`;
        if (here.has(key)) continue;
        here.add(key);
        if (!places.has(key)) places.set(key, { key, lat, lon, runs: 0 });
        places.get(key).runs++;
      }
    }
  }
  return [...places.values()]
    .filter(p => p.runs >= SCAN_MIN_RUNS && !skip.has(p.key) && !areas.some(a => OSM.inArea(a, p.lat, p.lon)))
    .sort((a, b) => b.runs - a.runs);
}

// One turn: the busiest places first, until one gets an area or SCAN_TRIES
// have been looked up. A place whose only boundary is too big, or already one
// of your areas (its edge just missing the spot), is skipped from now on.
// Resolves to the seconds until the next turn, while the account is new.
async function findAreas() {
  if (!currentUser || readOnly() || !autoAreas.checked) return null;
  const { go, skip, again } = await Store.claimAreaScan();
  if (!go) return again;
  const tooBig = new Set();  // osm ids found too big this turn: no need to fetch them twice
  const skipped = [];
  try {
    for (const place of unmappedPlaces(new Set(skip)).slice(0, SCAN_TRIES)) {
      const pick = await areaFor(place, tooBig);
      if (pick) {
        await addFoundArea(place, pick);
        return again;
      }
      skipped.push(place.key);
    }
  } finally {
    if (skipped.length) await Store.saveAreaScan({ skip: skipped }).catch(() => {});
  }
  return again;
}

// The boundary to add for a place, with its streets fetched: { osmId, built },
// or null if there's none worth adding. Throws if OpenStreetMap is busy.
async function areaFor(place, tooBig) {
  const found = (await OSM.containing(place.lat, place.lon))
    .filter(b => SCAN_LEVELS.includes(b.level) && !tooBig.has(b.osmId))
    .sort((a, b) => SCAN_LEVELS.indexOf(a.level) - SCAN_LEVELS.indexOf(b.level));
  for (const b of found) {
    if (areas.some(a => a.osmId === b.osmId)) return null;
    try {
      return { osmId: b.osmId, built: await OSM.buildArea(b.osmId, () => {}, SCAN_MAX_KM2) };
    } catch (err) {
      if (!/too big|no usable boundary/.test(err.message)) throw err;
      tooBig.add(b.osmId);  // try the next size up, if it's small enough
    }
  }
  return null;
}

async function addFoundArea(place, { osmId, built }) {
  const saved = await Store.saveArea({ osmId, name: built.name, data: built.data });
  areas = [...areas.filter(a => a.id !== saved.id), saved].sort((a, b) => a.name.localeCompare(b.name));
  await syncUnrunnable();
  const active = activeArea && activeArea.area.id;
  fillAreaSelect();
  setActiveArea(active || saved.id);
  scheduleTrophies();
  toast(`New street map: ${saved.name}`, `Added because you've been there ${place.runs} times. See it in Streets mode.`);
}

// --- GPS art ---
// Pick a shape and an area, and "Find best fit" tries the shape all over it
// (see Art.fit), routes the best few along the streets, and shows the one
// that matches the shape most closely. "Next fit" steps through the others,
// and "Place on map" puts the shape in the middle of the view instead.
// Nothing else counts: not coverage, hills or doubling back. Once it's on the
// map, the shape has two handles: ✥ moves it and ⟳ turns and resizes it,
// and letting go draws it on the streets again.
const artArea = document.getElementById('art-area');
const artKm = document.getElementById('art-km');
const artFree = document.getElementById('art-free');
const artNext = document.getElementById('art-next');
const artTheme = document.getElementById('art-theme');
const artRigor = document.getElementById('art-rigor');
const ART_ROUTED = 6;      // best placements routed and judged
const ART_THIN = 300;      // metres: drag points on art routes about this far apart
const ART_REACH = 0.65;    // the ⟳ handle sits this far (of the shape's size) above its middle
let artShapeId = 'heart';
// The fits on show: { shape, km, where, g, field, allowed, results: [{ placement,
// legs, straight, outline, fid, metres }], index, shown (see artSignature) }.
let artFits = null;

for (const [el, key] of [[artArea, 'feets-art-area'], [artKm, 'feets-art-km']]) {
  try { if (localStorage.getItem(key)) el.value = localStorage.getItem(key); } catch {}
  el.addEventListener('change', () => { try { localStorage.setItem(key, el.value); } catch {} });
}
try { artRigor.value = localStorage.getItem('feets-art-rigor') || artRigor.value; } catch {}
try { artFree.checked = localStorage.getItem('feets-art-free') === 'on'; } catch {}
artFree.onchange = () => { try { localStorage.setItem('feets-art-free', artFree.checked ? 'on' : 'off'); } catch {} };
try { artShapeId = localStorage.getItem('feets-art-shape') || artShapeId; } catch {}

// Themes: the season's, unless one was picked: Halloween in October,
// Christmas from mid-November to the end of the year.
function seasonalTheme(date = new Date()) {
  const m = date.getMonth(), d = date.getDate();
  return m === 9 ? 'halloween' : (m === 10 && d >= 15) || m === 11 ? 'christmas' : 'everyday';
}
try { artTheme.value = localStorage.getItem('feets-art-theme') || seasonalTheme(); } catch { artTheme.value = seasonalTheme(); }
artTheme.onchange = () => {
  try { localStorage.setItem('feets-art-theme', artTheme.value); } catch {}
  fillArtShapes();
};

// The shape picker: a button per shape in the theme, with a little drawing of it.
const artShapes = document.getElementById('art-shapes');
function fillArtShapes() {
  const shapes = allArtShapes().filter(s => s.theme === artTheme.value);
  if (shapes.length && !shapes.some(s => s.id === artShapeId)) artShapeId = shapes[0].id;
  showArtMine();
  artShapes.replaceChildren(...shapes.map(shape => {
    const button = document.createElement('button');
    button.type = 'button';
    button.title = t(shape.name);
    button.setAttribute('aria-label', t(shape.name));
    button.innerHTML = Art.icon(shape);
    button.onclick = () => {
      artShapeId = shape.id;
      try { localStorage.setItem('feets-art-shape', shape.id); } catch {}
      for (const b of artShapes.children) b.setAttribute('aria-pressed', String(b === button));
      showArtMine();
    };
    button.setAttribute('aria-pressed', String(shape.id === artShapeId));
    return button;
  }));
}

// Your own shapes ("my shapes"): traced from an SVG in the browser (see
// Art.trace) and kept on the server as just the traced line. View-only
// accounts see their owner's, but can't add or delete any.
let artMine = [];  // Art shapes, with dbId
const allArtShapes = () => [...Art.SHAPES, ...artMine];
const artUpload = document.getElementById('art-upload');
const artDelete = document.getElementById('art-delete');
const artFile = document.getElementById('art-file');

function showArtMine() {
  const mine = artTheme.value === 'mine';
  document.getElementById('art-mine').hidden = !mine;
  document.getElementById('art-mine-hint').hidden = artMine.length > 0;
  artUpload.hidden = readOnly();
  artDelete.hidden = readOnly() || !mine || !artMine.some(s => s.id === artShapeId);
}

const toArtShape = s => Object.assign(Art.makeShape({ id: `mine-${s.id}`, name: s.name, theme: 'mine', points: s.points }), { dbId: s.id });

async function loadArtShapes() {
  try {
    artMine = (await Store.artShapes()).map(toArtShape);
  } catch {
    artMine = [];
  }
  fillArtShapes();
}

artUpload.onclick = () => artFile.click();
artFile.onchange = async () => {
  const file = artFile.files[0];
  artFile.value = '';
  if (!file) return;
  if (file.size > 2e6) {
    planStatus.textContent = 'That SVG is too big: keep it under 2 MB.';
    return;
  }
  let traced;
  try {
    traced = await Art.trace(await file.text());
  } catch (err) {
    planStatus.textContent = `Couldn't use ${file.name}: ${err.message}.`;
    return;
  }
  const guess = file.name.replace(/\.svg$/i, '').replace(/[-_]+/g, ' ').trim() || 'My shape';
  const name = prompt('Name this shape:', guess);
  if (name === null || !name.trim()) return;
  try {
    const saved = toArtShape(await Store.saveArtShape({ name: name.trim(), points: traced.points }));
    artMine.push(saved);
    artShapeId = saved.id;
    try { localStorage.setItem('feets-art-shape', saved.id); } catch {}
  } catch (err) {
    planStatus.textContent = `Couldn't save the shape: ${err.message}`;
    return;
  }
  fillArtShapes();
  planStatus.textContent = `Added ${name.trim()}`
    + (traced.pieces > 1 ? `: its ${traced.pieces} pieces are joined by short spokes, there and back` : '')
    + (traced.dropped ? `${traced.pieces > 1 ? ', and' : ':'} ${traced.dropped} small bit${traced.dropped > 1 ? 's were' : ' was'} left out` : '')
    + '. Only its outline is used, so the detail inside is left out.';
};

artDelete.onclick = async () => {
  const shape = artMine.find(s => s.id === artShapeId);
  if (!shape || !confirm(`Delete the shape "${shape.name}"? Routes made from it are kept.`)) return;
  try {
    await Store.deleteArtShape(shape.dbId);
  } catch (err) {
    planStatus.textContent = `Couldn't delete the shape: ${err.message}`;
    return;
  }
  artMine = artMine.filter(s => s !== shape);
  fillArtShapes();
};

fillArtShapes();

// The art route as drawn, so stepping between fits doesn't ask about losing
// one you haven't changed.
const artSignature = () => `${plan.waypoints.length}:${routePoints(plan).length}:${plan.waypoints.flat().join()}`;

// Legs every few metres become fewer, longer ones, so there's a drag point
// about every ART_THIN metres rather than at every target.
function thinLegs(legs, straight) {
  const out = { waypoints: [legs[0][0]], legs: [], straight: [] };
  let cur = null, curStraight = false;
  legs.forEach((leg, i) => {
    if (cur && (straight[i] || curStraight || lineMetres(cur) >= ART_THIN)) {
      out.legs.push(cur);
      out.straight.push(curStraight);
      out.waypoints.push(cur[cur.length - 1]);
      cur = null;
    }
    cur = cur ? [...cur, ...leg.slice(1)] : [...leg];
    curStraight = straight[i];
  });
  out.legs.push(cur);
  out.straight.push(curStraight);
  out.waypoints.push(cur[cur.length - 1]);
  return out;
}

// A placement drawn on the streets, and how well it matches: a result for artFits.
function routeArt({ g, field, shape, allowed, rigor }, placement) {
  const input = Art.routeInput(g, field, shape, placement, rigor);
  if (input.targets.length < 2) return null;
  const { legs, straight } = Planner.followShape(g, input.targets, input.near, allowed, input.corridor);
  const points = legs.flatMap((leg, i) => (i ? leg.slice(1) : leg));
  return { placement, legs, straight, outline: input.outline, fid: Art.fidelity(field, input, points), metres: lineMetres(points) };
}

function showArtFit(index, { fit = true, adjusted = false } = {}) {
  const { shape, where, results } = artFits;
  const r = results[index];
  const thin = thinLegs(r.legs, r.straight);
  resetPlan();
  const length = Math.round(Art.kmFor(shape, r.placement.s) * 2) / 2;
  Object.assign(plan, { ...thin, name: `${shape.name}, ${length} km`, artShape: r.outline, art: r.placement });
  planChanged();
  artFits.index = index;
  artFits.shown = artSignature();
  if (fit) map.fitBounds(L.latLngBounds(r.outline), { padding: [40, 40] });
  artNext.hidden = results.length < 2;
  const which = adjusted ? 'moved by hand' : results.length > 1 ? `fit ${index + 1} of ${results.length}` : 'placed';
  const off = 1 - Art.onStreets(artFits.field, shape, r.placement);
  planStatus.textContent = `${shape.name} in ${where}, ${which}: ${km(r.metres)}, `
    + `on average ${Math.round(r.fid.mean)} m from the shape (95% within ${Math.round(r.fid.worst)} m). `
    + (off > 0.15 ? `About ${Math.round(off * 100)}% of the shape is away from the streets of ${where}: move it in, or shrink it. ` : '')
    + 'Drag ✥ to move the shape, or ⟳ to turn and resize it.';
}

// Whether it's fine to replace the route on the map without asking.
const mayReplaceForArt = () => (artFits && artFits.shown === artSignature()) || mayDiscard();

// Everything the art needs for the chosen shape, area and length, or null
// (with a message) if it can't be had.
function artSetup() {
  if (artTheme.value === 'mine' && !artMine.length) {
    planStatus.textContent = 'Upload an SVG first, or pick another set of shapes.';
    return null;
  }
  const rigor = Number(artRigor.value);
  const shape = Art.atRigor(allArtShapes().find(s => s.id === artShapeId) || Art.SHAPES[0], rigor);
  const length = Number(artKm.value);
  if (!(length > 0)) return null;
  if (!artArea.value) {
    planStatus.textContent = 'Add an area in Streets mode first: the art is drawn on its streets.';
    return null;
  }
  const g = planGraph();
  const mask = withinMask(g, artArea.value);
  if (!mask) return null;
  if (!mask.field) mask.field = Art.prepare(g, mask.allowed);  // kept with the mask, for the next go
  return { shape, rigor, km: length, where: mask.name, g, field: mask.field, allowed: mask.allowed };
}

document.getElementById('art-fit').onclick = async () => {
  if (!mayReplaceForArt()) return;
  const setup = artSetup();
  if (!setup) return;
  const { shape, km: length, where, field } = setup;
  const buttons = [...document.querySelectorAll('#art button')];
  buttons.forEach(b => { b.disabled = true; });
  try {
    const fits = await Art.fit(field, shape, { km: length, free: artFree.checked }, f => {
      planStatus.textContent = `Fitting a ${shape.name.toLowerCase()} into ${where}… ${Math.round(f * 100)}%`;
    });
    if (!fits.length) {
      planStatus.textContent = `A ${length} km ${shape.name.toLowerCase()} is too big for ${where}. Try a shorter one, or a bigger area.`;
      return;
    }
    const results = [];
    for (const [k, placement] of fits.slice(0, ART_ROUTED).entries()) {
      planStatus.textContent = `Drawing it on the streets… (${k + 1} of ${Math.min(ART_ROUTED, fits.length)})`;
      await new Promise(r => setTimeout(r));
      const r = routeArt(setup, placement);
      if (r) results.push(r);
    }
    if (!results.length) {
      planStatus.textContent = `Couldn't draw a ${shape.name.toLowerCase()} on the streets of ${where}.`;
      return;
    }
    results.sort((a, b) => a.fid.mean - b.fid.mean);
    artFits = { ...setup, results, index: 0 };
    showArtFit(0);
  } finally {
    buttons.forEach(b => { b.disabled = false; });
  }
};

// The shape in the middle of the view, upright, at the chosen length, for
// placing by hand.
document.getElementById('art-place').onclick = () => {
  if (!mayReplaceForArt()) return;
  const setup = artSetup();
  if (!setup) return;
  const c = map.getCenter();
  const [cx, cy] = setup.field.toXY(c.lat, c.lng);
  const r = routeArt(setup, { cx, cy, s: Art.sizeFor(setup.shape, setup.km), rot: 0 });
  if (!r) {
    planStatus.textContent = `The middle of the map isn't in ${setup.where}. Move the map there first, or pick another area.`;
    return;
  }
  artFits = { ...setup, results: [r], index: 0 };
  showArtFit(0, { fit: false });
};

// Loose to strict (see Art.atRigor): the art on show is drawn again where it
// is, if it hasn't been changed since.
artRigor.onchange = () => {
  try { localStorage.setItem('feets-art-rigor', artRigor.value); } catch {}
  if (!artFits || artFits.shown !== artSignature() || !plan.art) return;
  const rigor = Number(artRigor.value);
  const base = allArtShapes().find(s => s.id === artFits.shape.id);
  if (!base) return;
  const next = { ...artFits, rigor, shape: Art.atRigor(base, rigor) };
  const r = routeArt(next, { ...plan.art });
  if (!r) return;
  artFits = next;
  artFits.results[artFits.index] = r;
  showArtFit(artFits.index, { fit: false });
};

artNext.onclick = () => {
  if (!artFits || !mayReplaceForArt()) return;
  showArtFit((artFits.index + 1) % artFits.results.length);
};

// The ✥ and ⟳ handles on the shape (drawn by drawPlan). Dragging moves the
// faint outline as you go; letting go draws the shape on the streets again.
function drawArtHandles(layer, outlineLine) {
  const placement = plan.art;
  if (!placement || !artFits || artFits.g !== planGraph() || publicView()) return;
  const { field, shape } = artFits;
  const ll = xy => L.latLng(...field.toLatLon(xy));
  const turnAt = p => [p.cx - Math.sin(p.rot * Math.PI / 180) * p.s * ART_REACH, p.cy + Math.cos(p.rot * Math.PI / 180) * p.s * ART_REACH];
  const handle = (cls, title, at) => L.marker(ll(at), {
    draggable: true, title, zIndexOffset: 1000, bubblingMouseEvents: false,
    icon: L.divIcon({ className: `art-handle ${cls}`, iconSize: [26, 26], html: cls === 'move' ? '✥' : '⟳' }),
  }).addTo(layer);
  let next = { ...placement };
  const move = handle('move', 'Drag to move the shape', [placement.cx, placement.cy]);
  const turn = handle('turn', 'Drag to turn and resize the shape', turnAt(placement));
  const preview = () => {
    outlineLine.setLatLngs(Art.outline(field, shape, next));
    planStatus.textContent = `${shape.name}: about ${Art.kmFor(shape, next.s).toFixed(1)} km`
      + (next.rot ? `, turned ${Math.round(((next.rot % 360) + 540) % 360 - 180)}°` : '') + '. Let go to draw it on the streets.';
  };
  move.on('drag', e => {
    [next.cx, next.cy] = field.toXY(e.latlng.lat, e.latlng.lng);
    turn.setLatLng(ll(turnAt(next)));
    preview();
  });
  turn.on('drag', e => {
    const [x, y] = field.toXY(e.latlng.lat, e.latlng.lng);
    next.rot = Math.atan2(y - next.cy, x - next.cx) * 180 / Math.PI - 90;
    next.s = Math.max(100, Math.hypot(x - next.cx, y - next.cy) / ART_REACH);
    preview();
  });
  const done = () => {
    if (!mayReplaceForArt()) {
      drawPlan();  // put the handles back where they were
      return;
    }
    planStatus.textContent = 'Drawing it on the streets…';
    setTimeout(() => {
      const r = routeArt(artFits, { ...next });
      if (!r) {
        planStatus.textContent = "That's off the streets of the area. Move it back in.";
        drawPlan();
        return;
      }
      artFits.results[artFits.index] = r;
      showArtFit(artFits.index, { fit: false, adjusted: true });
    });
  };
  move.on('dragend', done);
  turn.on('dragend', done);
}

// --- Ghost races ---
// Two activities on the same route, played back together against the clock
// (sped up), so you can see where one pulled ahead. Others that follow
// mostly the same route from about the same start are offered from an
// activity's popup. Times come from the GPX files (Store.trackPoints).
const RACE_NEAR = 40;          // metres: a point this close to the other line is on the same route
const RACE_SAME = 0.8;         // share of each line that must be on the other
const RACE_START = 250;        // metres apart the two starts can be
const RACE_SPEEDS = [30, 60, 120, 240];

// Points every `step` metres along an activity's (simplified) line.
function alongLine(track, step = 40) {
  const out = [];
  for (const seg of track.segments) {
    for (let i = 1; i < seg.length; i++) {
      const d = Planner.distance(...seg[i - 1], ...seg[i]);
      const n = Math.max(1, Math.ceil(d / step));
      for (let k = 0; k < n; k++) out.push([seg[i - 1][0] + (seg[i][0] - seg[i - 1][0]) * k / n, seg[i - 1][1] + (seg[i][1] - seg[i - 1][1]) * k / n]);
    }
  }
  return out;
}

// The share of points that lie within RACE_NEAR of a line's points (a grid lookup).
function shareNear(points, line) {
  const cell = RACE_NEAR;
  const key = ([la, lo]) => `${Math.floor(la * 111320 / cell)},${Math.floor(lo * 111320 * Math.cos(la * Math.PI / 180) / cell)}`;
  const grid = new Map();
  for (const p of line) {
    const k = key(p);
    if (!grid.has(k)) grid.set(k, []);
    grid.get(k).push(p);
  }
  let near = 0;
  for (const p of points) {
    const [cy, cx] = key(p).split(',').map(Number);
    let hit = false;
    for (let y = cy - 1; y <= cy + 1 && !hit; y++) for (let x = cx - 1; x <= cx + 1 && !hit; x++) {
      for (const q of grid.get(`${y},${x}`) || []) if (Planner.distance(...p, ...q) <= RACE_NEAR) { hit = true; break; }
    }
    if (hit) near++;
  }
  return points.length ? near / points.length : 0;
}

// Other timed activities that follow the same route as `track`, newest first.
function sameRoute(track) {
  const mine = alongLine(track);
  if (mine.length < 2) return [];
  return [...loaded.values()].map(e => e.track)
    .filter(t => t.id !== track.id && t.metrics && t.metrics.moving && t.segments.length && t.segments[0].length)
    .filter(t => Planner.distance(...t.segments[0][0], ...track.segments[0][0]) <= RACE_START)
    .filter(t => Math.abs(t.distance - track.distance) <= track.distance * 0.25)
    .filter(t => {
      const theirs = alongLine(t);
      return shareNear(mine, theirs) >= RACE_SAME && shareNear(theirs, mine) >= RACE_SAME;
    })
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''));
}

// The popup's race chooser: a button per activity on the same route.
function offerRaces(track, box, popup) {
  const others = sameRoute(track);
  box.querySelectorAll('.race-choices').forEach(el => el.remove());
  const list = document.createElement('div');
  list.className = 'race-choices';
  if (!others.length) {
    list.textContent = 'None of your other activities follow this route from the same start.';
  } else {
    list.append(Object.assign(document.createElement('small'), { textContent: 'Race against:' }));
    for (const other of others.slice(0, 8)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'link-button';
      b.textContent = `${new Date(other.time).toLocaleDateString(undefined, { dateStyle: 'medium' })} · ${clock(other.metrics.elapsed || other.metrics.moving)}`;
      b.onclick = () => {
        map.closePopup(popup);
        startRace(track, other).catch(err => alert(err.message));
      };
      list.append(b);
    }
  }
  box.append(list);
  if (popup.isOpen()) popup.update();
}

// A runner: the activity's points with times, seconds from its start, and
// metres along: { track, t, lat, lon, d, finish }.
async function raceRunner(track) {
  const points = (await Store.trackPoints(track.id)).filter(p => p[3] != null);
  if (points.length < 2) throw new Error(`"${track.name}" has no times to race with.`);
  const t0 = points[0][3];
  const r = { track, t: [], lat: [], lon: [], d: [] };
  let along = 0;
  points.forEach(([la, lo, , time], i) => {
    if (i) along += Planner.distance(r.lat[i - 1], r.lon[i - 1], la, lo);
    r.t.push(time - t0); r.lat.push(la); r.lon.push(lo); r.d.push(along);
  });
  r.finish = r.t[r.t.length - 1];
  return r;
}

// Where a runner is `at` seconds in: { lat, lon, d }.
function runnerAt(r, at) {
  const { t } = r;
  if (at >= r.finish) return { lat: r.lat[t.length - 1], lon: r.lon[t.length - 1], d: r.d[t.length - 1] };
  let lo = 0, hi = t.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (t[mid] <= at) lo = mid; else hi = mid; }
  const f = t[hi] > t[lo] ? (at - t[lo]) / (t[hi] - t[lo]) : 0;
  return { lat: r.lat[lo] + (r.lat[hi] - r.lat[lo]) * f, lon: r.lon[lo] + (r.lon[hi] - r.lon[lo]) * f, d: r.d[lo] + (r.d[hi] - r.d[lo]) * f };
}

// When a runner first got `d` metres along (seconds in).
function runnerWhen(r, d) {
  const { d: ds, t } = r;
  if (d >= ds[ds.length - 1]) return r.finish;
  let lo = 0, hi = ds.length - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ds[mid] <= d) lo = mid; else hi = mid; }
  const f = ds[hi] > ds[lo] ? (d - ds[lo]) / (ds[hi] - ds[lo]) : 0;
  return t[lo] + (t[hi] - t[lo]) * f;
}

const RaceControl = L.Control.extend({
  options: { position: 'topright' },
  onAdd() {
    const bar = L.DomUtil.create('div', 'race-control');
    bar.innerHTML = '<div class="race-buttons"><button type="button" class="race-play">▶</button>'
      + '<button type="button" class="race-speed"></button><button type="button" class="race-close" title="End the race">×</button></div>'
      + '<div class="race-clock"></div><div class="race-gap"></div>';
    L.DomEvent.disableClickPropagation(bar);
    L.DomEvent.disableScrollPropagation(bar);
    const [play, speed, close] = bar.querySelectorAll('button');
    play.onclick = () => toggleRace();
    speed.onclick = () => {
      race.speed = RACE_SPEEDS[(RACE_SPEEDS.indexOf(race.speed) + 1) % RACE_SPEEDS.length];
      showRace();
    };
    close.onclick = () => stopRace();
    this.bar = bar;
    return bar;
  },
});

// "Oct 11", or "Oct 11, 2025" for another year.
const shortDate = track => {
  const d = new Date(track.time);
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', ...(d.getFullYear() === new Date().getFullYear() ? {} : { year: 'numeric' }) });
};

async function startRace(a, b) {
  stopRace();
  if (mapMode !== 'tracks') setMode('tracks');
  const [first, second] = await Promise.all([raceRunner(a), raceRunner(b)]);
  // The newer one leads the colours: orange, with the older as a grey ghost.
  const runners = [first, second].sort((x, y) => (y.track.time || '').localeCompare(x.track.time || ''));
  const layer = L.layerGroup().addTo(map);
  const styles = [{ color: '#ff6d00', cls: 'race-you' }, { color: '#555', cls: 'race-ghost' }];
  runners.forEach((r, i) => {
    r.line = L.polyline(r.lat.map((la, k) => [la, r.lon[k]]), { color: styles[i].color, weight: 4, opacity: 0.45, interactive: false }).addTo(layer);
    r.marker = L.marker([r.lat[0], r.lon[0]], {
      interactive: false, keyboard: false, zIndexOffset: 1000 - i,
      icon: L.divIcon({ className: `race-marker ${styles[i].cls}`, iconSize: [18, 18], html: '' }),
    }).bindTooltip(shortDate(r.track), {
      permanent: true, direction: i ? 'left' : 'right', offset: [i ? -10 : 10, 0], className: `race-label ${styles[i].cls}`,
    }).addTo(layer);
  });
  // Just the race on the map: no activity's own line (an id none has).
  const solo = soloId;
  soloId = -1;
  render();
  const control = new RaceControl().addTo(map);
  race = { runners, layer, control, at: 0, playing: false, speed: 60, solo };
  map.fitBounds(runners[0].line.getBounds(), { padding: [40, 40] });
  showRace();
  toggleRace();
}

function stopRace() {
  if (!race) return;
  cancelAnimationFrame(race.frame);
  race.layer.remove();
  race.control.remove();
  soloId = race.solo;
  race = null;
  render();
}

function toggleRace() {
  if (!race) return;
  const end = Math.max(...race.runners.map(r => r.finish));
  if (!race.playing && race.at >= end) race.at = 0;
  race.playing = !race.playing;
  race.last = performance.now();
  if (race.playing) race.frame = requestAnimationFrame(stepRace);
  showRace();
}

function stepRace(now) {
  if (!race || !race.playing) return;
  race.at += Math.min(now - race.last, 100) / 1000 * race.speed;
  race.last = now;
  const end = Math.max(...race.runners.map(r => r.finish));
  if (race.at >= end) {
    race.at = end;
    race.playing = false;
  }
  showRace();
  if (race.playing) race.frame = requestAnimationFrame(stepRace);
}

// Markers, clock and who's ahead, for the race's time `at`.
function showRace() {
  const { runners, at, control } = race;
  const [you, ghost] = runners;
  const here = runners.map(r => runnerAt(r, at));
  runners.forEach((r, i) => r.marker.setLatLng([here[i].lat, here[i].lon]));
  const bar = control.bar;
  bar.querySelector('.race-play').textContent = race.playing ? '❚❚' : '▶';
  bar.querySelector('.race-speed').textContent = `${race.speed}×`;
  bar.querySelector('.race-clock').textContent = clock(at);
  const [a, b] = [shortDate(you.track), shortDate(ghost.track)];
  let gap;
  if (at >= you.finish && at >= ghost.finish) {
    const diff = Math.round(you.finish - ghost.finish);
    gap = diff === 0 ? `A dead heat at ${clock(you.finish)}.`
      : `${diff < 0 ? a : b} was faster by ${clock(Math.abs(diff))}: ${clock(you.finish)} against ${clock(ghost.finish)}.`;
  } else {
    // Ahead by distance now, and by time: how much later the other got that far.
    const lead = here[0].d - here[1].d;
    const [front, back] = lead >= 0 ? [0, 1] : [1, 0];
    const seconds = Math.round((runnerWhen(runners[back], here[front].d) - at));
    const who = front === 0 ? a : b;
    gap = Math.abs(lead) < 5 ? 'Neck and neck.'
      : `${who} ahead by ${km(Math.abs(lead))}` + (at < runners[back].finish && seconds > 0 ? ` (${clock(seconds)})` : '') + '.';
  }
  bar.querySelector('.race-gap').textContent = gap;
}

// --- Segments ---
// Short stretches you time yourself on (see segments.js). Made from an
// activity's popup; the efforts on each are found a little after activities
// change, checking each on-foot activity once and keeping what's found on the
// server. A new best gets a note.
const segmentsBox = document.getElementById('segments-box');
let segments = [];     // as from Store.segments()
let segmentTimer = null, segmentRun = 0;
let segmentOpen = null;      // the id of the segment whose efforts are showing
let segmentHighlight = null;

async function loadSegments() {
  if (readOnly()) return;
  try {
    segments = await Store.segments();
  } catch {
    segments = [];
  }
  renderSegments();
}

function scheduleSegments() {
  clearTimeout(segmentTimer);
  segmentTimer = setTimeout(() => updateSegments().catch(err => console.error('Segments:', err)), 2500);
}

// The efforts on a segment by activities still here, fastest first:
// [{ track, start, seconds }].
function segmentEfforts(seg) {
  const out = [];
  for (const [id, list] of Object.entries(seg.efforts)) {
    const entry = loaded.get(Number(id));
    if (!entry) continue;
    for (const [start, seconds] of list) out.push({ track: entry.track, start, seconds });
  }
  return out.sort((a, b) => a.seconds - b.seconds);
}

// Activities not yet checked against each segment are checked now: the ones
// whose line could have done it (Segments.candidate) have their timed points
// fetched, once, and searched.
async function updateSegments() {
  if (!currentUser || readOnly() || !segments.length) return;
  const run = ++segmentRun;
  const tracks = [...loaded.values()].map(e => e.track).filter(t => Stats.onFoot(t) && t.metrics && t.metrics.moving);
  const timed = new Map();
  for (const seg of segments) {
    const firstLook = !Object.keys(seg.efforts).length;
    const before = segmentEfforts(seg)[0];
    const found = {};
    for (const t of tracks) {
      if (seg.efforts[t.id] !== undefined || !Segments.candidate(seg, t)) continue;
      try {
        if (!timed.has(t.id)) timed.set(t.id, await Store.trackPoints(t.id));
      } catch {
        continue;
      }
      if (run !== segmentRun) return;
      found[t.id] = Segments.efforts(seg, timed.get(t.id));
    }
    if (!Object.keys(found).length) continue;
    Object.assign(seg.efforts, found);
    await Store.saveSegmentEfforts(seg.id, found).catch(() => {});
    const best = segmentEfforts(seg)[0];
    if (!firstLook && best && found[best.track.id] && (!before || best.seconds < before.seconds)) {
      toast(`🏅 New best on ${seg.name}: ${clock(best.seconds)}`,
        before ? `${clock(before.seconds - best.seconds)} faster than your old best.` : 'Your first time on it.');
    }
    renderSegments();
  }
}

const paceOn = (seg, seconds) => paceText(seconds / (seg.distance / 1000));

function renderSegments() {
  segmentsBox.hidden = readOnly();
  document.getElementById('segments-count').textContent = segments.length ? `(${segments.length})` : '';
  document.getElementById('segments-hint').hidden = segments.length > 0;
  document.getElementById('segment-list').replaceChildren(...segments.map(seg => {
    const efforts = segmentEfforts(seg);
    const li = document.createElement('li');
    li.className = seg.id === segmentOpen ? 'open' : '';
    li.innerHTML = '<div class="segment-head"><strong></strong><span class="best"></span></div><small></small>';
    li.querySelector('strong').textContent = seg.name;
    li.querySelector('.best').textContent = efforts.length ? clock(efforts[0].seconds) : '–';
    li.querySelector('small').textContent = `${km(seg.distance)} · ${efforts.length ? `${efforts.length} effort${efforts.length === 1 ? '' : 's'}` : 'no efforts yet'}`;
    li.querySelector('.segment-head').onclick = () => {
      segmentOpen = segmentOpen === seg.id ? null : seg.id;
      renderSegments();
      if (segmentOpen) showSegment(seg);
    };
    if (seg.id === segmentOpen) li.append(segmentDetail(seg, efforts));
    return li;
  }));
}

// A segment's leaderboard and tools.
function segmentDetail(seg, efforts) {
  const box = document.createElement('div');
  box.className = 'segment-detail';
  const table = document.createElement('ol');
  table.className = 'segment-board';
  table.replaceChildren(...efforts.slice(0, 10).map((e, i) => {
    const row = document.createElement('li');
    row.innerHTML = '<span class="rank"></span><span class="when"></span><span class="time"></span><span class="pace"></span>';
    row.querySelector('.rank').textContent = i === 0 ? '🏅' : `${i + 1}`;
    row.querySelector('.when').textContent = new Date(e.start * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' });
    row.querySelector('.time').textContent = clock(e.seconds);
    row.querySelector('.pace').textContent = paceOn(seg, e.seconds);
    row.title = e.track.name;
    return row;
  }));
  if (!efforts.length) table.append(Object.assign(document.createElement('li'), { textContent: 'None yet: checking your activities…' }));
  const tools = document.createElement('div');
  tools.className = 'segment-tools';
  const button = (text, onclick) => Object.assign(document.createElement('button'), { type: 'button', className: 'link-button', textContent: text, onclick });
  tools.append(
    button('Show', () => showSegment(seg)),
    button('Rename', async () => {
      const name = await askName('Rename segment', seg.name, 'Rename');
      if (!name) return;
      try {
        Object.assign(seg, { name: (await Store.renameSegment(seg.id, name)).name });
        renderSegments();
      } catch (err) { alert(err.message); }
    }),
    button('Delete', async () => {
      if (!confirm(`Delete the segment "${seg.name}" and its times?`)) return;
      try {
        await Store.deleteSegment(seg.id);
        segments = segments.filter(s => s !== seg);
        renderSegments();
      } catch (err) { alert(err.message); }
    }),
  );
  if (efforts.length > 10) tools.prepend(Object.assign(document.createElement('small'), { textContent: `Fastest 10 of ${efforts.length}.` }));
  box.append(table, tools);
  return box;
}

// The segment in orange on the map, for a few seconds.
function showSegment(seg) {
  if (segmentHighlight) segmentHighlight.remove();
  segmentHighlight = L.polyline(seg.points, { color: '#ff6d00', weight: 8, opacity: 0.8, interactive: false }).addTo(map);
  map.fitBounds(segmentHighlight.getBounds(), { padding: [60, 60], maxZoom: 17 });
  const shown = segmentHighlight;
  setTimeout(() => { shown.remove(); if (segmentHighlight === shown) segmentHighlight = null; }, 6000);
}

// Making a segment: the activity's line in purple; click where it starts,
// then where it ends (again to change the end), and save.
async function startSegmentPick(track) {
  // segments.js is a file of its own: say so if it didn't load (not uploaded, say).
  if (typeof Segments === 'undefined') throw new Error("Segments can't be made: segments.js didn't load. Upload it next to app.js, then reload the page.");
  stopSegmentPick();
  if (race) stopRace();
  if (pointEdit) endPointEdit();
  if (mapMode !== 'tracks') setMode('tracks');
  const timed = (await Store.trackPoints(track.id)).filter(p => p[3] != null);
  if (timed.length < 2) throw new Error(`"${track.name}" has no times to make a segment from.`);
  const layer = L.layerGroup().addTo(map);
  const line = L.polyline(timed.map(p => [p[0], p[1]]), { color: '#8e24aa', weight: 5, opacity: 0.6, interactive: false }).addTo(layer);
  const piece = L.polyline([], { color: '#ff6d00', weight: 8, opacity: 0.9, interactive: false }).addTo(layer);
  const ends = L.layerGroup().addTo(layer);
  const panel = L.DomUtil.create('div', 'point-edit');
  panel.innerHTML = '<strong>Making a segment</strong><span class="step"></span>'
    + '<div><button type="button">Save</button><button class="link-button" type="button">Cancel</button></div>';
  const step = panel.querySelector('.step');
  const [save, cancel] = panel.querySelectorAll('button');
  L.DomEvent.disableClickPropagation(panel);
  const control = L.control({ position: 'topright' });
  control.onAdd = () => panel;
  control.addTo(map);
  const solo = soloId;
  soloId = -1;  // just this activity's line while picking
  render();
  segmentPick = { track, timed, layer, control, solo, from: null, to: null, cut: null };
  step.textContent = 'Click the purple line where the segment starts.';
  save.disabled = true;

  // The point of the line nearest a click, if the click was near the line.
  const nearest = latlng => {
    let best = -1, bestD = Infinity;
    timed.forEach((p, i) => {
      const d = Planner.distance(latlng.lat, latlng.lng, p[0], p[1]);
      if (d < bestD) { bestD = d; best = i; }
    });
    return bestD <= 80 ? best : -1;
  };
  segmentPick.onClick = e => {
    const i = nearest(e.latlng);
    if (i < 0) {
      step.textContent = 'Click on the purple line, or a little closer to it.';
      return;
    }
    const pick = segmentPick;
    if (pick.from === null) pick.from = i;
    else pick.to = i;
    ends.clearLayers();
    for (const k of [pick.from, pick.to]) {
      if (k !== null) L.circleMarker([timed[k][0], timed[k][1]], { radius: 7, color: '#fff', weight: 2, fillColor: '#ff6d00', fillOpacity: 1, interactive: false }).addTo(ends);
    }
    if (pick.to === null) {
      step.textContent = 'Now click where it ends.';
      return;
    }
    pick.cut = Segments.cut(timed, pick.from, pick.to);
    piece.setLatLngs(pick.cut.points);
    const ok = pick.cut.distance >= Segments.MIN && pick.cut.distance <= Segments.MAX
      && Planner.distance(...pick.cut.points[0], ...pick.cut.points[pick.cut.points.length - 1]) > 2 * Segments.NEAR;
    save.disabled = !ok;
    const time = Math.abs(timed[pick.to][3] - timed[pick.from][3]);
    step.textContent = !ok
      ? (pick.cut.distance < Segments.MIN ? `That's ${km(pick.cut.distance)}: make it at least ${km(Segments.MIN)}.`
        : pick.cut.distance > Segments.MAX ? `That's ${km(pick.cut.distance)}: keep it under ${km(Segments.MAX)}.`
          : 'Its start and end are too close together: a segment can’t be a loop.')
      : `${km(pick.cut.distance)}, ${clock(time)} this time. Save it, or click again to move the end.`;
  };
  map.on('click', segmentPick.onClick);
  cancel.onclick = () => stopSegmentPick();
  save.onclick = async () => {
    const pick = segmentPick;
    const name = await askName('Name this segment', `${track.name} segment`, 'Save');
    if (!name) return;
    try {
      const seg = await Store.saveSegment({ name, points: pick.cut.points, distance: pick.cut.distance });
      segments = [...segments, seg].sort((a, b) => a.name.localeCompare(b.name));
      stopSegmentPick();
      segmentOpen = seg.id;
      segmentsBox.open = true;
      renderSegments();
      updateSegments().catch(err => console.error('Segments:', err));
    } catch (err) {
      alert(err.message);
    }
  };
  map.fitBounds(line.getBounds(), { padding: [40, 40] });
}

function stopSegmentPick() {
  if (!segmentPick) return;
  map.off('click', segmentPick.onClick);
  segmentPick.layer.remove();
  segmentPick.control.remove();
  soloId = segmentPick.solo;
  segmentPick = null;
  render();
}

// --- Streaks and weekly quests ---
// See quests.js. Worked out again a little after activities or areas change,
// with every on-foot activity (whatever the filters say). This week's quests
// are made the first time feets is open in a new week, and saved, so every
// device shows the same ones; finishing one gets a note.
const questsBox = document.getElementById('quests-box');
let questTimer = null, questRun = 0;
let questState = null;   // { week, quests, done, completed }, as saved

function scheduleQuests() {
  clearTimeout(questTimer);
  questTimer = setTimeout(() => updateQuests().catch(err => console.error('Quests:', err)), 2000);
}

async function updateQuests() {
  if (!currentUser || readOnly()) return;
  const run = ++questRun;
  const tracks = [...loaded.values()].map(e => e.track).filter(Stats.onFoot);
  const firsts = await Quests.firsts(tracks, areas);
  if (run !== questRun) return;
  // Coverage with every on-foot activity, worked out once per area per update.
  const coverage = new Map();
  const coverageFor = area => {
    if (!coverage.has(area)) coverage.set(area, Coverage.compute(Coverage.prepared(area), tracks.map(t => t.segments)));
    return coverage.get(area);
  };
  if (!questState) questState = await Store.quests().catch(() => null);
  const week = Quests.weekId(new Date());
  if (!questState || questState.week !== week) {
    const c = map.getCenter();
    const near = home ? [home.lat, home.lon] : lastFix ? [lastFix.lat, lastFix.lng] : [c.lat, c.lng];
    questState = { ...Quests.make(areas, coverageFor, firsts, near), done: [], completed: questState ? questState.completed : 0 };
    await Store.saveQuests(questState).catch(() => {});
  }
  const progress = questState.quests.map(q => Quests.progress(q, areas, coverageFor, firsts));
  const finished = questState.quests.filter((q, i) => progress[i].done && !questState.done.includes(q.id));
  if (finished.length) {
    questState.done.push(...finished.map(q => q.id));
    questState.completed += finished.length;
    await Store.saveQuests(questState).catch(() => {});
    for (const q of finished) toast(`Quest done: ${q.title}`, `${questState.completed} quests done in all.`);
  }
  renderQuests(Quests.streak(firsts), progress);
  await awardStreakTrophies(firsts);
}

// Streak trophies (see Quests.streakTrophies), saved and announced like the
// others (see checkTrophies).
async function awardStreakTrophies(firsts) {
  const known = new Set(trophies.map(a => a.code));
  const fresh = Quests.streakTrophies(firsts).filter(a => !known.has(a.code));
  if (!fresh.length) return;
  trophies = await Store.addAchievements(fresh);
  renderTrophies();
  if (fresh.length > 3) toast(`🏆 ${fresh.length} streak trophies`, 'See them under Trophies.');
  else fresh.forEach(a => toast(`🏆 ${a.title}`, a.detail));
}

function renderQuests(streak, progress) {
  questsBox.hidden = false;
  const s = document.getElementById('streak');
  const weeks = n => `${n} week${n === 1 ? '' : 's'}`;
  s.textContent = streak.current
    ? `🔥 New streets ${weeks(streak.current)} running (best ${weeks(streak.best)}).`
      + (streak.counted ? '' : ` This week doesn't count yet: ${Quests.kmText(Quests.STREAK_MIN)} of new street keeps it going.`)
    : streak.best
      ? `No streak right now (best ${weeks(streak.best)}). ${Quests.kmText(Quests.STREAK_MIN)} of new street this week starts one.`
      : `Cover ${Quests.kmText(Quests.STREAK_MIN)} of new street this week to start a streak.`;
  const done = progress.filter(p => p.done).length;
  document.getElementById('quests-summary').textContent = `${done} of ${progress.length} quests` + (streak.current ? ` · 🔥 ${streak.current}` : '');
  document.getElementById('quest-list').replaceChildren(...questState.quests.map((q, i) => {
    const p = progress[i];
    const li = document.createElement('li');
    li.className = p.done ? 'done' : '';
    li.innerHTML = '<div class="quest-title"><strong></strong><button class="link-button" type="button">Plan it</button></div>'
      + '<div class="bar"><span></span></div><small></small>';
    li.querySelector('strong').textContent = (p.done ? '✓ ' : '') + q.title;
    li.querySelector('.bar span').style.width = `${Math.min(100, p.have / Math.max(1, p.of) * 100).toFixed(1)}%`;
    li.querySelector('small').textContent = q.kind === 'street'
      ? (p.done ? 'Finished' : `${Quests.kmText(p.of - p.have)} to go`)
      : `${Quests.kmText(p.have)} of ${Quests.kmText(p.of)}`;
    const plan = li.querySelector('button');
    plan.hidden = p.done;
    plan.onclick = () => planQuest(q);
    return li;
  }));
  document.getElementById('quests-note').textContent = `New quests every Monday. ${questState.completed} done in all.`
    + (areas.length ? '' : ' Add a street area in Streets mode for more kinds of quest.');
}

// "Plan it": Plan mode, set up for the quest.
let questHighlight = null;
function planQuest(q) {
  setMode('plan');
  exploreUnrun.checked = true;
  exploreUnrun.dispatchEvent(new Event('change'));
  if (q.kind === 'area') {
    exploreWithin.value = q.hood >= 0 ? `h:${q.areaId}:${q.hood}` : `a:${q.areaId}`;
    exploreWithin.dispatchEvent(new Event('change'));
    if (q.place) map.setView(q.place, 15);
    planStatus.textContent = `Make a loop is set to stay in ${exploreWithin.selectedOptions[0].text.replace(/^[\s ·–]+/, '')}. Pick a length and Make a loop.`;
  } else if (q.kind === 'street') {
    const area = areas.find(a => a.id === q.areaId);
    const lines = area ? area.data.streets.filter(s => s.name === q.name && s.cat === q.cat && s.hood === q.hood).flatMap(s => s.runs) : [];
    if (lines.length) {
      if (questHighlight) questHighlight.remove();
      questHighlight = L.polyline(lines, { color: '#ff6d00', weight: 8, opacity: 0.7, interactive: false }).addTo(map);
      setTimeout(() => { if (questHighlight) { questHighlight.remove(); questHighlight = null; } }, 8000);
      map.fitBounds(questHighlight.getBounds(), { padding: [60, 60], maxZoom: 17 });
    }
    planStatus.textContent = `${q.name} is in orange. Click the map to plan a route along it, or tick Finish streets I've started and Make a loop from nearby.`;
  } else {
    planStatus.textContent = "Make a loop is set to go through streets you haven't covered. Pick a length and Make a loop.";
  }
}

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
      if (viewLinkOff) authError.textContent = 'That view link has been turned off or has expired. Log in, or ask for a new link.';
    }
  } catch (err) {
    document.getElementById('summary').textContent = 'Could not reach the server: ' + err.message;
  }
})();
