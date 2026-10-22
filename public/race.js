// The page of a virtual race (race.html?code=CODE), for anyone with its link:
// the course on a map, the leaderboard, and a way to enter. An entry is a run
// uploaded here: the server times it from the course's start to its finish
// (race_time in api.php) and keeps only the name and the time. This browser
// gets a key of its own (feets-race-entrant), so a faster run replaces a
// slower one instead of adding a second time. The host, logged in to feets
// in this browser, can take times off.
(() => {
  const code = new URLSearchParams(location.search).get('code') || '';
  const $ = id => document.getElementById(id);

  const randomKey = () => [...crypto.getRandomValues(new Uint8Array(16))].map(b => b.toString(16).padStart(2, '0')).join('');
  let entrant = '';
  try { entrant = localStorage.getItem('feets-race-entrant') || ''; } catch {}
  if (!/^[0-9a-f]{32}$/.test(entrant)) {
    entrant = randomKey();
    try { localStorage.setItem('feets-race-entrant', entrant); } catch {}
  }
  try { $('race-runner').value = localStorage.getItem('feets-race-name') || ''; } catch {}

  async function api(method, action, body) {
    const res = await fetch(`api.php?action=${action}&code=${encodeURIComponent(code)}&entrant=${entrant}`, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    return data;
  }

  function clock(seconds) {
    const s = Math.round(seconds);
    const h = Math.floor(s / 3600), m = Math.floor(s / 60) % 60, sec = String(s % 60).padStart(2, '0');
    return h ? `${h}:${String(m).padStart(2, '0')}:${sec}` : `${m}:${sec}`;
  }
  // Metres between two [lat, lon] points, near enough.
  const gap = (a, b) => Math.hypot((b[0] - a[0]) * 111320, (b[1] - a[1]) * 111320 * Math.cos(a[0] * Math.PI / 180));
  const day = ms => new Date(ms).toLocaleDateString(undefined, { dateStyle: 'medium' });
  const ordinal = n => n + ({ one: 'st', two: 'nd', few: 'rd' }[new Intl.PluralRules('en', { type: 'ordinal' }).select(n)] || 'th');

  let race = null;
  let map = null;

  // Why a run didn't count, from what race_time() says got furthest.
  const WHY = {
    'no-times': "That file has no times in it, so it can't be timed. Try exporting it again with times (most watches and apps do).",
    'no-start': "That run doesn't go past the start of the course (the green dot).",
    'no-finish': "That run goes past the start but doesn't get to the finish about a course's length later.",
    'off-course': 'That run gets from the start to the finish, but not along the course: it has to follow the course most of the way.',
    outside: () => `That run is the course, but it wasn't run during the race (${day(race.startsAt)} – ${day(race.endsAt)}).`,
  };

  function render() {
    const now = Date.now();
    document.title = `${race.name} · feets race`;
    $('race-name').textContent = race.name;
    const state = now < race.startsAt ? `Starts ${day(race.startsAt)}`
      : now <= race.endsAt ? `Open until the end of ${day(race.endsAt)}`
      : now <= race.closesAt ? `Finished ${day(race.endsAt)}. Runs from the race can be uploaded until ${day(race.closesAt)}`
      : `Finished ${day(race.endsAt)}`;
    $('race-when').textContent = `${Units.dist(race.distance, 2)} · hosted by ${race.host} · ${state}`;
    const loop = gap(race.course[0], race.course[race.course.length - 1]) < 30;  // finishes where it starts
    $('race-how').textContent = `Run the course between ${day(race.startsAt)} and ${day(race.endsAt)}, `
      + (loop ? 'starting and finishing at the green dot' : 'starting at the green dot and finishing at the white ring')
      + ', then upload your run. Your time is from the start to the finish, wherever you started your watch. '
      + 'Run it again to go faster: only your best time counts.';
    $('race-enter').hidden = now < race.startsAt || now > race.closesAt;
    $('race-results').hidden = false;
    drawCourse();
    renderBoard();
  }

  function drawCourse() {
    if (map || race.course.length < 2) return;
    $('race-map').hidden = false;
    map = L.map('race-map', { scrollWheelZoom: false });
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(map);
    const line = L.polyline(race.course, { color: '#e6194b', weight: 5, opacity: 0.85 }).addTo(map);
    const start = race.course[0], finish = race.course[race.course.length - 1];
    L.circleMarker(finish, { radius: 9, color: '#222', weight: 3, fillColor: '#fff', fillOpacity: 1, dashArray: '3 3' })
      .bindTooltip('Finish').addTo(map);
    L.circleMarker(start, { radius: 7, color: '#fff', weight: 2, fillColor: '#2e7d32', fillOpacity: 1 })
      .bindTooltip(start[0] === finish[0] && start[1] === finish[1] ? 'Start and finish' : 'Start').addTo(map);
    map.fitBounds(line.getBounds(), { padding: [20, 20] });
  }

  function renderBoard() {
    const rows = race.entries;
    $('race-empty').hidden = rows.length > 0;
    $('race-board').hidden = !rows.length;
    $('race-host-col').hidden = !race.mine;
    $('race-board').querySelector('tbody').replaceChildren(...rows.map((e, i) => {
      const tr = document.createElement('tr');
      tr.classList.toggle('yours', e.yours);
      const cells = [i + 1, e.yours ? `${e.name} (you)` : e.name, clock(e.seconds),
        Units.pace(e.seconds / (race.distance / 1000), clock), day(e.startedAt)];
      for (const text of cells) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.append(td);
      }
      if (race.mine) {
        const td = document.createElement('td');
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.className = 'link-button';
        remove.textContent = 'Remove';
        remove.title = 'Take this time off the leaderboard (you host this race)';
        remove.onclick = async () => {
          if (!confirm(`Take ${e.name}'s time (${clock(e.seconds)}) off the leaderboard?`)) return;
          try {
            const res = await fetch('api.php?action=race_entry_delete', {
              method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: e.id }),
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Request failed (${res.status})`);
            await load();
          } catch (err) {
            alert(err.message);
          }
        };
        td.append(remove);
        tr.append(td);
      }
      return tr;
    }));
  }

  async function load() {
    try {
      race = await api('GET', 'race');
    } catch (err) {
      $('race-name').textContent = 'Race not found';
      $('race-problem').textContent = err.message;
      $('race-problem').hidden = false;
      return;
    }
    render();
  }

  $('race-form').onsubmit = async event => {
    event.preventDefault();
    const file = $('race-file').files[0];
    const name = $('race-runner').value.trim();
    if (!file || !name) return;
    try { localStorage.setItem('feets-race-name', name); } catch {}
    const result = $('race-result');
    result.className = '';
    result.textContent = 'Timing your run…';
    $('race-submit').disabled = true;
    try {
      const { text } = await Convert.read(file);
      const answer = await api('POST', 'race_enter', { name, entrant, gpx: text });
      race = answer.race;
      render();
      if (!answer.counted) {
        result.className = 'race-problem';
        result.textContent = typeof WHY[answer.why] === 'function' ? WHY[answer.why]() : WHY[answer.why] || "That run didn't count.";
        $('race-help').open = true;  // its tips say what to try next
        return;
      }
      const place = race.entries.findIndex(e => e.yours) + 1;
      const best = race.entries.find(e => e.yours);
      result.className = 'race-done';
      result.textContent = answer.best
        ? `Your time: ${clock(answer.seconds)} (${Units.pace(answer.seconds / (race.distance / 1000), clock)}). `
          + `That's ${ordinal(place)} of ${race.entries.length}.`
        : `That run took ${clock(answer.seconds)}. Your best, ${clock(best.seconds)}, still stands: ${ordinal(place)} of ${race.entries.length}.`;
      $('race-file').value = '';
    } catch (err) {
      result.className = 'race-problem';
      result.textContent = err.message;
      $('race-help').open = true;
    } finally {
      $('race-submit').disabled = false;
    }
  };

  load();
})();
