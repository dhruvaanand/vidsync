#!/usr/bin/env node
/**
 * Fail fast when node-gyp produced an empty/broken mpv_addon.node.
 */
const fs = require('fs');
const path = require('path');

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

try {
  const addon = require(addonPath);
  if (!addon.MpvPlayer) {
    fail('mpv_addon.node loaded but MpvPlayer export is missing');
  }
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  fail(`cannot load mpv_addon.node: ${message}`);
}

console.log(`[verify-native-build] OK (${size} bytes, MpvPlayer export present)`);
