// Talks to server.py, which keeps tracks in MySQL.
const Store = (() => {
  async function request(method, path, body) {
    const res = await fetch('/api/tracks' + path, {
      method,
      headers: body ? { 'Content-Type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `${method} ${path || '/'} failed (${res.status})`);
    return data;
  }

  return {
    all: () => request('GET', ''),
    // track includes the original file text as track.gpx; resolves to the new id.
    add: async track => (await request('POST', '', track)).id,
    update: track => request('PATCH', `/${track.id}`, { visible: track.visible, color: track.color }),
    remove: id => request('DELETE', `/${id}`),
    gpxUrl: id => `/api/tracks/${id}/gpx`,
  };
})();
