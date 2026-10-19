// Helpers shared by the tests: an API client with its own cookies, the
// accounts most tests need, and loading the browser scripts into Node.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const URL_BASE = process.env.FEETS_URL;
export const SETUP_PASSWORD = process.env.FEETS_SETUP_PASSWORD;
export const fixture = name => path.join(ROOT, 'tests', 'fixtures', name);

let ipCount = 0;

// A browser, as far as api.php can tell: its own session cookie, and its own
// IP address (sent as Cloudflare's header), so the per-IP login limit in one
// test doesn't spill into the next.
export class Client {
  constructor() {
    this.cookie = '';
    ipCount++;
    this.ip = `10.${(ipCount >> 16) & 255}.${(ipCount >> 8) & 255}.${ipCount & 255}`;
  }

  // { status, body } for api.php?action=…; `query` adds more of the query string.
  async call(action, body, query = '') {
    const res = await fetch(`${URL_BASE}api.php?action=${action}${query}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'CF-Connecting-IP': this.ip, Cookie: this.cookie },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const set = res.headers.getSetCookie().find(c => c.startsWith('feets_session='));
    if (set) this.cookie = set.split(';')[0];
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch {}
    return { status: res.status, body: json ?? text };
  }

  login(username, password) {
    return this.call('login', { username, password });
  }
}

export const ADMIN = { username: 'admin', password: 'admin-password-1' };

// A client logged in as the admin, making the admin on the first call.
export async function admin() {
  const c = new Client();
  const me = await c.call('me');
  const r = me.body.needsSetup
    ? await c.call('setup', { setupPassword: SETUP_PASSWORD, ...ADMIN })
    : await c.login(ADMIN.username, ADMIN.password);
  if (r.status !== 200) throw new Error(`Admin login failed: ${JSON.stringify(r.body)}`);
  return c;
}

let userCount = 0;

// A new member (or viewer), invited by the admin: { client, username, password }.
export async function member({ viewer = false } = {}) {
  const a = await admin();
  const { body: { code } } = await a.call('invite', { viewer });
  const username = `user${Date.now() % 100000}${++userCount}`;
  const password = 'member-password-1';
  const client = new Client();
  const r = await client.call('signup', { invite: code, username, password });
  if (r.status !== 200) throw new Error(`Signup failed: ${JSON.stringify(r.body)}`);
  return { client, username, password };
}

// Runs public/<file>s in one Node context, as <script> tags would in a page,
// and returns that context. `globals` stands in for the browser's.
export function loadScripts(files, globals = {}) {
  const storage = new Map();
  const ctx = {
    console, TextDecoder, TextEncoder, Response, DecompressionStream, Blob, URL,
    localStorage: {
      getItem: k => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v)),
      removeItem: k => storage.delete(k),
    },
    navigator: { language: 'en-GB', languages: ['en-GB'] },
    t: s => s,
    ...globals,
  };
  vm.createContext(ctx);
  for (const file of files) {
    // Top-level consts aren't properties of the context, so hand them over.
    const src = fs.readFileSync(path.join(ROOT, 'public', file), 'utf8');
    const name = src.match(/^const (\w+) = \(\(\) =>/m)?.[1];
    vm.runInContext(src + (name ? `\nthis.${name} = ${name};` : ''), ctx, { filename: file });
  }
  return ctx;
}

// A GPX track with times and heights: `n` points along a line going north
// from `start`, `step` metres and `seconds` apart.
export function gpxText({ name = 'Test run', start = [49.28, -123.12], n = 60, step = 20, seconds = 6, type = 'running' } = {}) {
  const t0 = Date.UTC(2026, 9, 1, 15);
  const pts = Array.from({ length: n }, (_, i) =>
    `<trkpt lat="${(start[0] + (i * step) / 111320).toFixed(6)}" lon="${start[1]}"><ele>${10 + i}</ele>`
    + `<time>${new Date(t0 + i * seconds * 1000).toISOString()}</time></trkpt>`);
  return `<?xml version="1.0"?><gpx version="1.1" xmlns="http://www.topografix.com/GPX/1/1"><trk><name>${name}</name>`
    + `<type>${type}</type><trkseg>${pts.join('')}</trkseg></trk></gpx>`;
}
