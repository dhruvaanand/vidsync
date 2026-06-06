#!/usr/bin/env node
/**
 * Fail fast when node-gyp produced an empty/broken mpv_addon.node.
 */
const fs = require('fs');
const path = require('path');
const { prependWindowsMpvPath } = require(
  path.join(__dirname, '..', 'native', 'mpv-worker', 'mpv-windows-path'),
);

const releaseDir = path.join(__dirname, '..', 'native', 'mpv-addon', 'build', 'Release');
const addonPath = path.join(releaseDir, 'mpv_addon.node');

function fail(message) {
  console.error(`[verify-native-build] FAIL: ${message}`);
  process.exit(1);
}

if (!fs.existsSync(addonPath)) {
  fail(`mpv_addon.node not found at ${addonPath}`);
}

const size = fs.statSync(addonPath).size;
if (size < 50_000) {
  fail(
    `mpv_addon.node is only ${size} bytes — native sources were not compiled.\n` +
      'Check binding.gyp includes src/mpv_player.cpp and rebuild with: npm run rebuild:native',
  );
}

if (process.platform === 'win32') {
  const dllPath = path.join(releaseDir, 'libmpv-2.dll');
  if (!fs.existsSync(dllPath)) {
    fail(
      'libmpv-2.dll is missing from Release.\n' +
        'Run: npm run copy-mpv-runtime   (should run automatically after rebuild:native)',
    );
  }

  const pathKey =
    Object.keys(process.env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const env = prependWindowsMpvPath({ ...process.env });
  const existing = env[pathKey] ?? '';
  env[pathKey] = existing ? `${releaseDir};${existing}` : releaseDir;
  process.env[pathKey] = env[pathKey];
}

try {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  const addon = require(addonPath);
  if (!addon.MpvPlayer) {
    fail('mpv_addon.node loaded but MpvPlayer export is missing');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('specified module could not be found')) {
    fail(
      `${message}\n` +
        'Missing libmpv/ffmpeg DLLs in Release. Run: npm run copy-mpv-runtime',
    );
  }
  fail(`cannot load mpv_addon.node: ${message}`);
}

console.log(`[verify-native-build] OK (${size} bytes, MpvPlayer export present)`);
