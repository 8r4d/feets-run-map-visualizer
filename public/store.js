// Talks to api.php, which keeps accounts and tracks in MySQL.
// The login itself lives in an HttpOnly session cookie the browser sends automatically.
const Store = (() => {
  // Set by app.js: called whenever the server says we're not logged in.
  let onLoggedOut = () => {};

  async function send(method, query, body) {
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

    // Accounts: setup, login and signup resolve to { username, isAdmin }.
    me: () => json('GET', '?action=me'),
    setup: (setupPassword, username, password) => json('POST', '?action=setup', { setupPassword, username, password }),
    login: (username, password) => json('POST', '?action=login', { username, password }),
    signup: (invite, username, password) => json('POST', '?action=signup', { invite, username, password }),
    logout: () => json('POST', '?action=logout'),
    createInvite: async () => (await json('POST', '?action=invite')).code,

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
