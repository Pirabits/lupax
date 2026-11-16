// Launch Chrome with the extension loaded and drive it over the DevTools pipe.
// No ports, no dependencies. Branded Chrome ignores --load-extension, so the
// extension is loaded with the CDP Extensions.loadUnpacked command instead.
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Chrome derives an unpacked extension's ID from the SHA-256 of its absolute path. */
export function unpackedExtensionId(dir) {
  const hex = createHash('sha256').update(path.resolve(dir)).digest('hex').slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
}

export async function launch({ extensionDir, headless = true, fakeMedia = false }) {
  const bin = CHROME_CANDIDATES.find((p) => fs.existsSync(p));
  if (!bin) throw new Error('Chrome not found. Set CHROME_PATH.');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'lupax-e2e-'));
  const downloads = path.join(profile, 'Downloads');
  fs.mkdirSync(path.join(profile, 'Default'), { recursive: true });
  fs.mkdirSync(downloads);
  fs.writeFileSync(path.join(profile, 'Default', 'Preferences'), JSON.stringify({
    download: { default_directory: downloads, prompt_for_download: false, directory_upgrade: true },
  }));
  const extId = unpackedExtensionId(extensionDir);
  const proc = spawn(bin, [
    ...(headless ? ['--headless=new'] : []),
    `--user-data-dir=${profile}`,
    '--remote-debugging-pipe',
    '--enable-unsafe-extension-debugging',
    // lets tabCapture run without a toolbar click (fake media devices break tab capture, so they are opt-in)
    `--allowlisted-extension-id=${extId}`,
    ...(fakeMedia ? ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'] : []),
    '--autoplay-policy=no-user-gesture-required',
    '--no-first-run', '--no-default-browser-check', '--disable-gpu',
    '--window-size=1280,900',
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
  let stderr = '';
  proc.stderr.on('data', (d) => { stderr = (stderr + d).slice(-4000); });

  const out = proc.stdio[3], inp = proc.stdio[4];
  let seq = 0, buf = '';
  const pending = new Map();
  const listeners = new Set();
  inp.on('data', (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\0')) >= 0) {
      const msg = JSON.parse(buf.slice(0, i));
      buf = buf.slice(i + 1);
      if (msg.id && pending.has(msg.id)) {
        const { resolve, reject, method } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? reject(new Error(`${method}: ${msg.error.message}`)) : resolve(msg.result);
      } else for (const l of listeners) l(msg);
    }
  });
  const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    const id = ++seq;
    pending.set(id, { resolve, reject, method });
    out.write(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }) + '\0');
  });

  // wait for the browser to answer
  for (let t = 0; ; t++) {
    try { await Promise.race([send('Browser.getVersion'), sleep(500).then(() => { throw new Error('timeout'); })]); break; }
    catch (e) { if (t > 40) throw new Error(`Chrome did not start: ${e.message}\n${stderr}`); }
  }
  const loaded = await send('Extensions.loadUnpacked', { path: path.resolve(extensionDir) });
  if (loaded.id !== extId) throw new Error(`Unexpected extension id ${loaded.id} (expected ${extId})`);

  /** Attach to a target and return a small page API. */
  async function attach(targetId) {
    const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
    const events = [];
    const onMsg = (m) => { if (m.sessionId === sessionId) events.push(m); };
    listeners.add(onMsg);
    const s = (method, params) => send(method, params, sessionId);
    await s('Runtime.enable').catch(() => {});
    return {
      targetId, sessionId, events, send: s,
      async evaluate(expression) {
        const r = await s('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
        if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
        return r.result?.value;
      },
      exceptions: () => events.filter((e) => e.method === 'Runtime.exceptionThrown')
        .map((e) => e.params.exceptionDetails.exception?.description || e.params.exceptionDetails.text),
      async mouse(type, x, y, buttons = type === 'mousePressed' ? 1 : 0) {
        await s('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons, clickCount: type === 'mouseMoved' ? 0 : 1 });
      },
      async click(x, y) { await this.mouse('mouseMoved', x, y); await sleep(100); await this.mouse('mousePressed', x, y); await this.mouse('mouseReleased', x, y); },
      async drag(x1, y1, x2, y2) {
        await this.mouse('mouseMoved', x1, y1); await this.mouse('mousePressed', x1, y1);
        for (let i = 1; i <= 8; i++) await this.mouse('mouseMoved', x1 + ((x2 - x1) * i) / 8, y1 + ((y2 - y1) * i) / 8, 1);
        await this.mouse('mouseReleased', x2, y2);
      },
      detach: () => { listeners.delete(onMsg); return send('Target.detachFromTarget', { sessionId }).catch(() => {}); },
    };
  }

  const targets = async () => (await send('Target.getTargets')).targetInfos;
  async function open(url) {
    const { targetId } = await send('Target.createTarget', { url });
    return attach(targetId);
  }
  async function waitForTarget(pred, ms = 8000) {
    for (const end = Date.now() + ms; Date.now() < end; await sleep(150)) {
      const t = (await targets()).find(pred);
      if (t) return t;
    }
    throw new Error('target not found');
  }

  return {
    extId, downloads, send, attach, open, targets, waitForTarget,
    url: (p) => `chrome-extension://${extId}/${p}`,
    async close() {
      await send('Browser.close').catch(() => {});
      await sleep(300);
      proc.kill();
      fs.rmSync(profile, { recursive: true, force: true });
    },
  };
}
