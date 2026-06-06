#!/usr/bin/env node
/**
 * Smoke-test the native MPV worker (same path Vidsync uses at runtime).
 *
 * Usage (from repo root):
 *   npm run test:mpv
 *   npm run test:mpv -- "D:\Movies\film.mkv"
 */
const { fork } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getMsysBinCandidates, prependWindowsMpvPath } = require(
  path.join(__dirname, '..', 'native', 'mpv-worker', 'mpv-windows-path'),
);

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

try {
  const addon = require(addonPath);
  if (!addon.MpvPlayer) {
    fail(
      'mpv_addon.node exists but MpvPlayer export is missing.\n' +
        'The native build is broken (binding.gyp compiled no sources). Run: npm run rebuild:native',
    );
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.includes('did not self-register') && !message.includes('NODE_MODULE_VERSION')) {
    fail(`Cannot load mpv_addon.node: ${message}`);
  }
}

if (process.platform === 'win32') {
  const dllPath = path.join(releaseDir, 'libmpv-2.dll');
  if (!fs.existsSync(dllPath)) {
    fail(
      `libmpv-2.dll not found at ${dllPath}\n` +
        'Run: npm run build:native',
    );
  }
  ok(`libmpv-2.dll found (${dllPath})`);

  const runtimeDllCount = fs
    .readdirSync(releaseDir)
    .filter((name) => name.toLowerCase().endsWith('.dll')).length;
  console.log(`runtime DLLs in Release: ${runtimeDllCount}`);
  if (runtimeDllCount < 5) {
    console.warn(
      'Warning: few DLLs in Release — run: npm run build:native\n' +
        '  (copies libmpv + ffmpeg deps via MSYS2 ldd)',
    );
  }

  const msysBins = getMsysBinCandidates();
  if (msysBins.length > 0) {
    ok(`MSYS2 bin available (${msysBins[0]})`);
  }
}

let env = prependWindowsMpvPath({
  ...process.env,
  VIDSYNC_ADDON_ROOT: releaseDir,
});

if (process.platform === 'win32') {
  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const existing = env[pathKey] ?? '';
  env[pathKey] = existing ? `${releaseDir};${existing}` : releaseDir;
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
    fail(
      `worker exited with code ${code}\n` +
        'Run: npm run build:native\n' +
        'Ensure MSYS2 ucrt64 mpv is installed (pacman -S mingw-w64-ucrt-x86_64-mpv)',
    );
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
    ok('worker init (addon loaded inside worker)');

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
      console.log('  npm run test:mpv -- "D:\\Movies\\film.mkv"');
    }

    await request('destroy');
    child.disconnect();
    ok('MPV is working on this machine');
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (message.includes('specified module could not be found')) {
      fail(
        `${message}\n` +
          'Run: npm run build:native\n' +
          'This copies libmpv-2.dll + dependency DLLs into native/mpv-addon/build/Release/',
      );
    }
    if (message.includes('did not self-register')) {
      fail(
        `${message}\n` +
          'ABI mismatch: run npm run rebuild:native (system Node).\n' +
          'Do not rebuild mpv-addon with @electron/rebuild — the MPV worker uses system Node.',
      );
    }
    fail(message);
  }
})();
