#!/usr/bin/env node
/**
 * Prove whether MPV decodes video (dwidth/dheight) separate from HWND embed.
 *
 * Usage:
 *   node scripts/diagnose-playback.js "D:\path\to\video.mkv"
 *   node scripts/diagnose-playback.js "D:\path\to\video.mkv" 12345678
 *
 * Second arg (optional):
 *   worker  — create HWND in the MPV worker (Vidsync's Windows fix)
 *   <hwnd>  — test embed against an existing HWND decimal
 */
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { prependWindowsMpvPath } = require(
  path.join(__dirname, '..', 'native', 'mpv-worker', 'mpv-windows-path'),
);

const testFile = process.argv[2];
const embedArg = process.argv[3];
const testWorkerSurface = embedArg === 'worker';
const testWid = embedArg && !testWorkerSurface ? Number(embedArg) : 0;

if (!testFile) {
  console.error('Usage: node scripts/diagnose-playback.js "D:\\path\\to\\video.mkv" [hwnd]');
  process.exit(1);
}

if (!fs.existsSync(testFile)) {
  console.error(`File not found: ${testFile}`);
  process.exit(1);
}

const releaseDir = path.join(__dirname, '..', 'native', 'mpv-addon', 'build', 'Release');
const workerPath = path.join(__dirname, '..', 'native', 'mpv-worker', 'worker.js');

let env = prependWindowsMpvPath({
  ...process.env,
  VIDSYNC_ADDON_ROOT: releaseDir,
});

if (process.platform === 'win32') {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = env[pathKey] ? `${releaseDir};${env[pathKey]}` : releaseDir;
}

function runWorkerSurface() {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    let nextId = 1;
    const pending = new Map();

    child.on('message', (msg) => {
      const req = pending.get(msg.id);
      if (!req) return;
      pending.delete(msg.id);
      if (msg.ok) req.resolve(msg.result);
      else req.reject(new Error(msg.error || 'worker error'));
    });

    const request = (method, ...args) => {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        child.send({ id, method, args });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          rej(new Error(`timeout: ${method}`));
        }, 60000);
      });
    };

    (async () => {
      try {
        await request('init', 0);
        const hwnd = await request('createSurface', 0, 100, 100, 1280, 720);
        await request('setWid', hwnd);
        await request('load', testFile);
        const ready = await request('waitForLoad', 30000);
        await request('play');
        await new Promise((r) => setTimeout(r, 2000));
        const diag = await request('getDiagnostics');
        await request('destroy');
        child.disconnect();
        resolve({ ready, diag, wid: hwnd });
      } catch (error) {
        child.kill();
        reject(error);
      }
    })();
  });
}

function runWorker(wid) {
  return new Promise((resolve, reject) => {
    const child = fork(workerPath, [], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    child.stderr?.on('data', (chunk) => process.stderr.write(chunk));

    let nextId = 1;
    const pending = new Map();

    child.on('message', (msg) => {
      const req = pending.get(msg.id);
      if (!req) return;
      pending.delete(msg.id);
      if (msg.ok) req.resolve(msg.result);
      else req.reject(new Error(msg.error || 'worker error'));
    });

    const request = (method, ...args) => {
      const id = nextId++;
      return new Promise((res, rej) => {
        pending.set(id, { resolve: res, reject: rej });
        child.send({ id, method, args });
        setTimeout(() => {
          if (!pending.has(id)) return;
          pending.delete(id);
          rej(new Error(`timeout: ${method}`));
        }, 60000);
      });
    };

    (async () => {
      try {
        await request('init', wid);
        await request('load', testFile);
        const ready = await request('waitForLoad', 30000);
        await request('play');
        await new Promise((r) => setTimeout(r, 2000));
        const diag = await request('getDiagnostics');
        await request('destroy');
        child.disconnect();
        resolve({ ready, diag, wid });
      } catch (error) {
        child.kill();
        reject(error);
      }
    })();
  });
}

function interpret(label, { ready, diag, wid }) {
  console.log(`\n=== ${label} ===`);
  console.log(JSON.stringify({ wid, ready, ...diag }, null, 2));

  const decoding = Number(diag.dwidth) > 0 && Number(diag.dheight) > 0;
  const vo = diag.vo ?? '(missing)';

  if (!ready) {
    console.log('RESULT: file did not finish loading');
    return;
  }

  if (!decoding) {
    console.log('RESULT: MPV is NOT decoding video frames (decoder/path issue)');
    return;
  }

  console.log(`RESULT: MPV IS decoding video at ${diag.dwidth}x${diag.dheight}, vo=${vo}`);
  if (wid > 0) {
    console.log(
      'If the HWND window is still black while this passes, the bug is vo→HWND presentation on Windows.',
    );
  } else {
    console.log(
      'Decode works headless. If Vidsync UI is black, the bug is wid/embed/vo presentation — not file decode.',
    );
  }
}

(async () => {
  try {
    const headless = await runWorker(0);
    interpret('HEADLESS (wid=0) — proves decode', headless);

    if (testWorkerSurface) {
      const workerSurface = await runWorkerSurface();
      interpret('WORKER SURFACE (createSurface) — Vidsync Windows path', workerSurface);
    } else if (testWid > 0) {
      const embedded = await runWorker(testWid);
      interpret(`EMBED (wid=${testWid}) — external HWND`, embedded);
    } else if (process.platform === 'win32') {
      console.log(
        '\nTip: test the worker-native surface Vidsync uses on Windows:\n' +
          `  node scripts/diagnose-playback.js "${testFile}" worker`,
      );
    }
  } catch (error) {
    console.error('FAIL:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
})();
