// Talks to api.php, which keeps tracks in MySQL.
const Store = (() => {
  // The app password travels in a cookie: some hosts strip custom request headers.
  function savePassword(pw) {
    const secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `feets_password=${encodeURIComponent(pw)}; Max-Age=31536000; Path=/; SameSite=Strict${secure}`;
  }

  // Sends a request, asking for the app password (and retrying) whenever the server rejects it.
  async function send(method, query, body) {
    for (;;) {
      const res = await fetch('api.php' + query, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        const { error } = await res.json().catch(() => ({}));
        const entered = prompt(`${error || 'Password required'}. Enter the feets password:`);
        if (entered === null) throw new Error('Password required');
        savePassword(entered.trim());
        continue;
      }
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Request failed (${res.status})`);
      }
      return res;
    }
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
    all: () => json('GET', ''),
    // track includes the original file text as track.gpx; resolves to the new id.
    add: async track => (await json('POST', '?action=add', track)).id,
    update: track => json('POST', `?action=update&id=${track.id}`, { visible: track.visible, color: track.color }),
    remove: id => json('POST', `?action=delete&id=${id}`),
    downloadGpx,
  };
})();
