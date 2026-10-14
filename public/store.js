// Talks to api.php, which keeps tracks in MySQL.
const Store = (() => {
  const KEY = 'feets-password';
  let password = '';
  try { password = localStorage.getItem(KEY) || ''; } catch {}

  // Sends a request, asking for the app password (and retrying) whenever the server says it's wrong.
  async function send(method, query, body) {
    for (;;) {
      const headers = { 'X-Feets-Password': password };
      if (body) headers['Content-Type'] = 'application/json';
      const res = await fetch('api.php' + query, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
      });

      if (res.status === 401) {
        const entered = prompt(password ? 'Wrong password. Try again:' : 'feets password:');
        if (entered === null) throw new Error('Password required');
        password = entered;
        try { localStorage.setItem(KEY, password); } catch {}
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
