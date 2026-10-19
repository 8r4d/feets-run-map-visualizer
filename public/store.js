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
    viewLinks: () => json('GET', '?action=view_links'),  // [{ code, label, createdAt, expiresAt }]
    // days: how long the link works, or 0 until it's turned off.
    createViewLink: (label, days = 0) => json('POST', '?action=view_link_create', { label, days }),  // {code, days}
    deleteViewLink: code => json('POST', '?action=view_link_delete', { code }),

    // Passwords. resetPassword and recover log in and resolve to { username, isAdmin }.
    changePassword: (current, password) => json('POST', '?action=change_password', { current, password }),
    createResetLink: username => json('POST', '?action=reset_link', { username }),  // { code, username }
    // Admin only: every account, view link and unused invite (see admin_overview in api.php).
    adminOverview: () => json('GET', '?action=admin_overview'),
    adminDeleteUser: id => json('POST', '?action=admin_user_delete', { id }),
    adminSignOutUser: id => json('POST', '?action=admin_user_sign_out', { id }),
    adminDeleteViewLink: code => json('POST', '?action=admin_view_link_delete', { code }),
    adminDeleteInvite: code => json('POST', '?action=admin_invite_delete', { code }),
    resetInfo: code => json('GET', `?action=reset_info&code=${encodeURIComponent(code)}`),  // { username }
    resetPassword: (code, password) => json('POST', '?action=reset_password', { code, password }),
    recover: (setupPassword, username, password) => json('POST', '?action=recover', { setupPassword, username, password }),

    // Strava. Connecting is a page navigation (the link in index.html), not a fetch.
    stravaStatus: () => json('GET', '?action=strava_status'),
    // Imports the next batch: resolves to { tracks, done, rateLimited }.
    stravaSync: () => json('POST', '?action=strava_sync'),
    stravaDisconnect: () => json('POST', '?action=strava_disconnect'),
    // Names and types changed on Strava, a page of 200 at a time from `before` (0: newest):
    // resolves to { changed: [{ id, name, sport }], checked, next, rateLimited }.
    stravaRefresh: before => json('POST', '?action=strava_refresh', { before }),
    // Admin only: turns Strava's webhook (automatic import of new activities) on or off.
    // Sends the page's own address so the webhook URL has the right scheme and path.
    stravaAutoImport: on => on
      ? json('POST', '?action=strava_auto_on', { siteUrl: new URL('.', location.href).href })
      : json('POST', '?action=strava_auto_off'),

    // Street coverage areas, prepared in the browser by osm.js.
    areas: () => json('GET', '?action=areas'),
    saveArea: area => json('POST', '?action=area_save', area),  // { osmId, name, data } → stored area
    deleteArea: id => json('POST', `?action=area_delete&id=${id}`),
    // Finding areas for places you run (see findAreas in app.js). A claim resolves to
    // { go, skip, again }: go is false if another device or tab had a turn lately;
    // again, while the account is new, is the seconds until the next turn (else null).
    claimAreaScan: () => json('POST', '?action=area_scan_claim'),
    saveAreaScan: settings => json('POST', '?action=area_scan_save', settings),  // { on?, skip? } → { on }
    // Marks OSM ways unrunnable (or counts them again); resolves to { excluded: [way ids] }.
    excludeWays: (areaId, ways, excluded) => json('POST', `?action=area_exclude&id=${areaId}`, { ways, excluded }),

    // Planned routes: { id, name, distance, createdAt, updatedAt, data: { waypoints, legs, straight } }.
    routes: () => json('GET', '?action=routes'),
    saveRoute: route => json('POST', '?action=route_save', route),  // { id?, name, distance, data } → stored route
    renameRoute: (id, name) => json('POST', `?action=route_rename&id=${id}`, { name }),  // → stored route
    deleteRoute: id => json('POST', `?action=route_delete&id=${id}`),

    // Segments (see segments.js): { id, name, distance, points, createdAt, efforts: { track id: [[start, seconds]] } }.
    segments: () => json('GET', '?action=segments'),
    saveSegment: segment => json('POST', '?action=segment_save', segment),  // { name, points, distance } → segment
    renameSegment: (id, name) => json('POST', `?action=segment_rename&id=${id}`, { name }),
    deleteSegment: id => json('POST', `?action=segment_delete&id=${id}`),
    saveSegmentEfforts: (id, efforts) => json('POST', `?action=segment_efforts&id=${id}`, { efforts }),

    // Your own GPS art shapes, traced from SVGs (see Art.trace): { id, name, points, createdAt }.
    artShapes: () => json('GET', '?action=art_shapes'),
    saveArtShape: shape => json('POST', '?action=art_shape_save', shape),  // { name, points } → stored shape
    deleteArtShape: id => json('POST', `?action=art_shape_delete&id=${id}`),

    // Distance goals in km: { week, month }, null when not set.
    goals: () => json('GET', '?action=goals'),
    saveGoals: goals => json('POST', '?action=goals_save', goals),

    // This week's quests (see quests.js): { week, quests, done, completed }.
    quests: () => json('GET', '?action=quests'),
    saveQuests: state => json('POST', '?action=quests_save', state),

    // Where the map opens: { lat, lon, zoom }, or null to clear it. Resolves to { home }.
    saveHome: home => json('POST', '?action=home_save', home || {}),

    // Achievements: each resolves to [{ code, title, detail, earnedAt }], oldest first.
    achievements: () => json('GET', '?action=achievements'),
    addAchievements: achievements => json('POST', '?action=achievement_add', { achievements }),
    // Experience points: { since (Unix ms), total, recent: [{ kind, points, detail, earnedAt }], refs }.
    xp: () => json('GET', '?action=xp'),
    // events: [{ kind, ref, track?, points, detail }]; resolves as xp() does, plus added: [refs].
    addXp: events => json('POST', '?action=xp_add', { events }),

    // Tracks
    all: () => json('GET', ''),
    // track includes the original file text as track.gpx; resolves to { id, metrics }.
    add: track => json('POST', '?action=add', track),
    // Works out pace, time and elevation for some older tracks: { metrics: { id: metrics }, remaining }.
    trackMetrics: () => json('POST', '?action=track_metrics'),
    profile: async id => (await json('GET', `?action=track_profile&id=${id}`)).profile,  // [[km, metres]] or null
    // Every point in the track's GPX: [[lat, lon, segment, time (Unix seconds, or null)]].
    trackPoints: async id => (await json('GET', `?action=track_points&id=${id}`)).points,
    // Takes points (indexes into trackPoints) out of the GPX; resolves to the track worked out again.
    removePoints: (id, remove) => json('POST', `?action=track_edit&id=${id}`, { remove }),
    update: track => json('POST', `?action=update&id=${track.id}`, { visible: track.visible, color: track.color }),
    setVisible: (ids, visible) => json('POST', '?action=set_visible', { ids, visible }),
    remove: id => json('POST', `?action=delete&id=${id}`),
    downloadGpx,
  };
})();
