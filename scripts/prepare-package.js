#!/usr/bin/env node
/**
 * Pre-flight before electron-forge package/make.
 */
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const releaseDir = path.join(root, 'native', 'mpv-addon', 'build', 'Release');

function run(command, label) {
  console.log(`\n=== ${label} ===\n`);
  execSync(command, { cwd: root, stdio: 'inherit' });
}

function fail(message) {
  console.error(`\n[prepare-package] FAIL: ${message}\n`);
  process.exit(1);
}

if (!fs.existsSync(path.join(releaseDir, 'mpv_addon.node'))) {
  fail('mpv_addon.node missing — run: npm run build:native');
}

if (process.platform === 'win32') {
  const dllPath = path.join(releaseDir, 'libmpv-2.dll');
  if (!fs.existsSync(dllPath)) {
    fail('libmpv-2.dll missing — run: npm run copy-mpv-runtime');
  }

  const dllCount = fs.readdirSync(releaseDir).filter((name) => name.toLowerCase().endsWith('.dll')).length;
  if (dllCount < 10) {
    fail(`only ${dllCount} DLLs in Release — run: npm run copy-mpv-runtime`);
  }
  console.log(`[prepare-package] Release has ${dllCount} runtime DLL(s)`);
}

run('node scripts/verify-native-build.js', 'Verify native addon');
run('node scripts/bundle-node-for-package.js', 'Bundle Node for MPV worker');

console.log('\n[prepare-package] Ready for electron-forge package/make\n');
