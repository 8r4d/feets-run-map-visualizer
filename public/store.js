// Talks to api.php, which keeps accounts and tracks in MySQL.
// The login itself lives in an HttpOnly session cookie the browser sends automatically.
const Store = (() => {
  // Set by app.js: called whenever the server says we're not logged in.
  let onLoggedOut = () => {};
  // Set by app.js when the page was opened with a view link (?view=CODE):
  // sent with every request in place of a login.
  let viewCode = '';

  async function send(method, query, body) {
    if (viewCode) query += (query ? '&' : '?') + 'view=' + encodeURIComponent(viewCode);
    const res = await fetch('api.php' + query, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401) onLoggedOut();
    if (!res.ok) {
      const data = await res.json().catch(() => ({}));
      throw new Error(data.error || `Request failed (${res.status})`);
    }
    return res;
  }

  const json = async (method, query, body) => (await send(method, query, body)).json();

  async function downloadGpx(track) {
    const blob = await (await send('GET', `?gpx=${track.id}`)).blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = track.fileName || `${track.name}.gpx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  return {
    onLoggedOut: fn => { onLoggedOut = fn; },
    setViewCode: code => { viewCode = code || ''; },

    // Accounts: setup, login and signup resolve to { username, isAdmin, readOnly, owner? }.
    me: () => json('GET', '?action=me'),
    setup: (setupPassword, username, password) => json('POST', '?action=setup', { setupPassword, username, password }),
    login: (username, password) => json('POST', '?action=login', { username, password }),
    signup: (invite, username, password) => json('POST', '?action=signup', { invite, username, password }),
    logout: () => json('POST', '?action=logout'),
    // viewer: a view-only account that sees this admin's data and can't change anything.
    createInvite: async (viewer = false) => (await json('POST', '?action=invite', { viewer })).code,

    // View links: show your map to people without an account.
    viewLinks: () => json('GET', '?action=view_links'),  // [{ code, label, createdAt }]
    createViewLink: async label => (await json('POST', '?action=view_link_create', { label })).code,
    deleteViewLink: code => json('POST', '?action=view_link_delete', { code }),

    // Passwords. resetPassword and recover log in and resolve to { username, isAdmin }.
    changePassword: (current, password) => json('POST', '?action=change_password', { current, password }),
    createResetLink: username => json('POST', '?action=reset_link', { username }),  // { code, username }
    resetInfo: code => json('GET', `?action=reset_info&code=${encodeURIComponent(code)}`),  // { username }
    resetPassword: (code, password) => json('POST', '?action=reset_password', { code, password }),
    recover: (setupPassword, username, password) => json('POST', '?action=recover', { setupPassword, username, password }),

    // Strava. Connecting is a page navigation (the link in index.html), not a fetch.
    stravaStatus: () => json('GET', '?action=strava_status'),
    // Imports the next batch: resolves to { tracks, done, rateLimited }.
    stravaSync: () => json('POST', '?action=strava_sync'),
    stravaDisconnect: () => json('POST', '?action=strava_disconnect'),
    // Admin only: turns Strava's webhook (automatic import of new activities) on or off.
    // Sends the page's own address so the webhook URL has the right scheme and path.
    stravaAutoImport: on => on
      ? json('POST', '?action=strava_auto_on', { siteUrl: new URL('.', location.href).href })
      : json('POST', '?action=strava_auto_off'),

    // Street coverage areas, prepared in the browser by osm.js.
    areas: () => json('GET', '?action=areas'),
    saveArea: area => json('POST', '?action=area_save', area),  // { osmId, name, data } → stored area
    deleteArea: id => json('POST', `?action=area_delete&id=${id}`),
    // Marks OSM ways unrunnable (or counts them again); resolves to { excluded: [way ids] }.
    excludeWays: (areaId, ways, excluded) => json('POST', `?action=area_exclude&id=${areaId}`, { ways, excluded }),

    // Planned routes: { id, name, distance, createdAt, updatedAt, data: { waypoints, legs, straight } }.
    routes: () => json('GET', '?action=routes'),
    saveRoute: route => json('POST', '?action=route_save', route),  // { id?, name, distance, data } → stored route
    deleteRoute: id => json('POST', `?action=route_delete&id=${id}`),

    // Achievements: each resolves to [{ code, title, detail, earnedAt }], oldest first.
    achievements: () => json('GET', '?action=achievements'),
    addAchievements: achievements => json('POST', '?action=achievement_add', { achievements }),

    // Tracks
    all: () => json('GET', ''),
    // track includes the original file text as track.gpx; resolves to the new id.
    add: async track => (await json('POST', '?action=add', track)).id,
    update: track => json('POST', `?action=update&id=${track.id}`, { visible: track.visible, color: track.color }),
    setVisible: (ids, visible) => json('POST', '?action=set_visible', { ids, visible }),
    remove: id => json('POST', `?action=delete&id=${id}`),
    downloadGpx,
  };
})();
