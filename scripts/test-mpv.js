#!/usr/bin/env node
/**
 * Smoke-test the native MPV addon + worker on Windows/macOS/Linux.
 *
 * Usage (from repo root):
 *   node scripts/test-mpv.js
 *   node scripts/test-mpv.js "D:\Movies\film.mkv"
 */
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..');
const releaseDir = path.join(repoRoot, 'native', 'mpv-addon', 'build', 'Release');
const addonPath = path.join(releaseDir, 'mpv_addon.node');
const workerPath = path.join(repoRoot, 'native', 'mpv-worker', 'worker.js');
const testFile = process.argv[2] ?? null;

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`OK: ${message}`);
}

if (!fs.existsSync(addonPath)) {
  fail(`mpv_addon.node not found at ${addonPath}\nRun: npm run build:native`);
}

if (process.platform === 'win32') {
  const dllPath = path.join(releaseDir, 'libmpv-2.dll');
  if (!fs.existsSync(dllPath)) {
    fail(
      `libmpv-2.dll not found at ${dllPath}\n` +
        'Copy it: copy C:\\msys64\\ucrt64\\bin\\libmpv-2.dll native\\mpv-addon\\build\\Release\\',
    );
  }
  ok(`libmpv-2.dll found (${dllPath})`);
}

try {
  const { MpvPlayer } = require(addonPath);
  const player = new MpvPlayer(0);
  player.destroy();
  ok(`addon loads from ${addonPath}`);
} catch (error) {
  fail(
    `addon failed to load: ${error instanceof Error ? error.message : error}\n` +
      'Ensure libmpv-2.dll is in the Release folder (Windows).',
  );
}

const env = {
  ...process.env,
  VIDSYNC_ADDON_ROOT: releaseDir,
};
if (process.platform === 'win32') {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  env[pathKey] = env[pathKey] ? `${releaseDir};${env[pathKey]}` : releaseDir;
}

const child = fork(workerPath, [], {
  env,
  stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
});

child.stderr?.on('data', (chunk) => {
  const text = chunk.toString('utf8').trimEnd();
  if (text) console.error(`[mpv-worker] ${text}`);
});

let nextId = 1;
const pending = new Map();

child.on('message', (msg) => {
  const req = pending.get(msg.id);
  if (!req) return;
  pending.delete(msg.id);
  if (msg.ok) req.resolve(msg.result);
  else req.reject(new Error(msg.error || 'MPV worker error'));
});

child.on('exit', (code) => {
  if (code !== 0 && code !== null) {
    fail(`worker exited with code ${code}`);
  }
});

function request(method, ...args) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    child.send({ id, method, args });
    setTimeout(() => {
      if (!pending.has(id)) return;
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 30000);
  });
}

(async () => {
  try {
    await request('init', 0);
    ok('worker init');

    if (testFile) {
      if (!fs.existsSync(testFile)) {
        fail(`test file not found: ${testFile}`);
      }

      await request('load', testFile);
      const ready = await request('waitForLoad', 15000);
      const duration = await request('getDuration');
      const tracks = await request('getTrackList');

      console.log(`load file: ${testFile}`);
      console.log(`ready: ${ready}`);
      console.log(`duration: ${duration}`);
      console.log(`tracks: ${Array.isArray(tracks) ? tracks.length : 0}`);

      if (!ready || duration <= 0) {
        const lastError = await request('getLastError');
        fail(
          lastError
            ? `video did not load: ${lastError}`
            : 'video did not load (duration stayed 0)',
        );
      }

      ok('video load');
    } else {
      console.log('Tip: pass a video path to test playback:');
      console.log('  node scripts/test-mpv.js "D:\\Movies\\film.mkv"');
    }

    await request('destroy');
    child.disconnect();
    ok('MPV is working on this machine');
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
})();
