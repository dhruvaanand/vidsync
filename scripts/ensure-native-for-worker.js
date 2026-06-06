#!/usr/bin/env node
/**
 * Verify mpv_addon.node loads under system Node (same runtime as mpv-worker).
 * Rebuilds automatically when Electron Forge left an Electron-ABI binary behind.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'native', 'mpv-addon', 'build', 'Release');
const addonPath = path.join(releaseDir, 'mpv_addon.node');

function rebuildNative(reason) {
  console.log(`[ensure-native] ${reason}`);
  console.log('[ensure-native] Running npm run rebuild:native ...');
  execSync('npm run rebuild:native', {
    cwd: path.join(__dirname, '..'),
    stdio: 'inherit',
  });
  if (process.platform === 'win32') {
    execSync('npm run copy-mpv-runtime', {
      cwd: path.join(__dirname, '..'),
      stdio: 'inherit',
    });
  }
}

function tryLoadAddon() {
  // eslint-disable-next-line import/no-dynamic-require, global-require
  require(addonPath);
}

if (!fs.existsSync(addonPath)) {
  rebuildNative('mpv_addon.node is missing');
  tryLoadAddon();
  process.exit(0);
}

try {
  tryLoadAddon();
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  if (message.includes('did not self-register') || message.includes('NODE_MODULE_VERSION')) {
    rebuildNative('addon ABI does not match system Node');
    try {
      tryLoadAddon();
    } catch (retryError) {
      const retryMessage =
        retryError instanceof Error ? retryError.message : String(retryError);
      console.error(`[ensure-native] Still cannot load mpv_addon.node: ${retryMessage}`);
      process.exit(1);
    }
  } else {
    console.error(`[ensure-native] Cannot load mpv_addon.node: ${message}`);
    process.exit(1);
  }
}
