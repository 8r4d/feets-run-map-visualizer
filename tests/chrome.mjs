// Just enough of Chrome's DevTools protocol to drive a headless page from the
// tests, with Node's own WebSocket: no Puppeteer or Playwright to install.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [
  process.env.CHROME,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser',
];
export const chromePath = CANDIDATES.find(p => p && fs.existsSync(p));

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

export async function launch() {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'feets-chrome-'));
  const proc = spawn(chromePath, [
    '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
    '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=1300,850', 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });
  // Chrome says where its DevTools are once it's listening.
  const port = await new Promise((resolve, reject) => {
    let err = '';
    proc.stderr.on('data', d => {
      err += d;
      const m = err.match(/DevTools listening on ws:\/\/[^:]+:(\d+)\//);
      if (m) resolve(m[1]);
    });
    proc.on('exit', code => reject(new Error(`Chrome exited (${code}): ${err}`)));
  });
  const pages = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  const page = new Page(pages.find(p => p.type === 'page').webSocketDebuggerUrl);
  page.port = port;
  await page.open();
  page.close = async () => {
    proc.kill();
    await new Promise(r => proc.once('exit', r));
    fs.rmSync(profile, { recursive: true, force: true });
  };
  return page;
}

class Page {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
    this.listeners = [];
    this.errors = [];  // uncaught exceptions on the page
  }

  async open() {
    this.ws = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.ws.onopen = resolve; this.ws.onerror = reject; });
    this.ws.onmessage = e => {
      const msg = JSON.parse(e.data);
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id);
        this.pending.delete(msg.id);
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
      } else if (msg.method) {
        if (msg.method === 'Runtime.exceptionThrown') this.errors.push(msg.params.exceptionDetails);
        for (const l of this.listeners) l(msg);
      }
    };
    await Promise.all(['Page.enable', 'Runtime.enable', 'DOM.enable'].map(m => this.send(m)));
    // Dialogs (alert, prompt, confirm) are answered from this queue, and noted.
    this.dialogs = [];
    this.answers = [];
    this.listeners.push(msg => {
      if (msg.method !== 'Page.javascriptDialogOpening') return;
      this.dialogs.push(msg.params.message);
      const answer = this.answers.shift();
      this.send('Page.handleJavaScriptDialog', { accept: answer !== false, promptText: typeof answer === 'string' ? answer : undefined });
    });
  }

  send(method, params = {}) {
    const id = this.nextId++;
    this.ws.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }

  async goto(url) {
    const loaded = new Promise(resolve => {
      const l = msg => {
        if (msg.method === 'Page.loadEventFired') {
          this.listeners.splice(this.listeners.indexOf(l), 1);
          resolve();
        }
      };
      this.listeners.push(l);
    });
    await this.send('Page.navigate', { url });
    await loaded;
  }

  async reload() {
    await this.goto(await this.eval('location.href'));
  }

  // The value of an expression on the page (awaited if it's a promise).
  async eval(expression) {
    const { result, exceptionDetails } = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (exceptionDetails) throw new Error(`${expression}: ${exceptionDetails.exception?.description || exceptionDetails.text}`);
    return result.value;
  }

  // Waits until an expression is truthy, and returns its value.
  async waitFor(expression, { timeout = 10000, what = expression } = {}) {
    const until = Date.now() + timeout;
    for (;;) {
      const value = await this.eval(expression).catch(() => null);
      if (value) return value;
      if (Date.now() > until) throw new Error(`Timed out waiting for ${what}`);
      await sleep(100);
    }
  }

  // Offline or back online: the page, and its service workers, whose own
  // requests the page's setting doesn't cover. The setting lasts as long as
  // the connection to each, so those stay open until it's back online.
  async setOffline(offline) {
    const conditions = { offline, latency: 0, downloadThroughput: -1, uploadThroughput: -1 };
    await this.send('Network.enable');
    await this.send('Network.emulateNetworkConditions', conditions);
    for (const w of this.workers || []) w.ws.close();
    this.workers = [];
    if (!offline) return;
    const targets = await (await fetch(`http://127.0.0.1:${this.port}/json/list`)).json();
    for (const t of targets.filter(t => t.type === 'service_worker')) {
      const worker = new Page(t.webSocketDebuggerUrl);
      worker.ws = new WebSocket(t.webSocketDebuggerUrl);
      await new Promise((resolve, reject) => { worker.ws.onopen = resolve; worker.ws.onerror = reject; });
      worker.ws.onmessage = e => {
        const msg = JSON.parse(e.data);
        worker.pending.get(msg.id)?.resolve(msg.result);
      };
      await worker.send('Network.enable');
      await worker.send('Network.emulateNetworkConditions', conditions);
      this.workers.push(worker);
    }
    if (!this.workers.length) throw new Error(`No service worker to take offline: ${targets.map(t => t.type).join(', ')}`);
  }

  async setFiles(selector, files) {
    const { root } = await this.send('DOM.getDocument');
    const { nodeId } = await this.send('DOM.querySelector', { nodeId: root.nodeId, selector });
    await this.send('DOM.setFileInputFiles', { nodeId, files });
  }

  async screenshot(file) {
    const { data } = await this.send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(data, 'base64'));
  }
}
