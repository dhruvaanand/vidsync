#!/usr/bin/env node
/**
 * Copy libmpv runtime library next to mpv_addon.node so the worker can load it.
 * Windows: C:\msys64\ucrt64\bin\libmpv-2.dll
 */
const fs = require('fs');
const path = require('path');

const releaseDir = path.join(__dirname, '..', 'native', 'mpv-addon', 'build', 'Release');
const addonPath = path.join(releaseDir, 'mpv_addon.node');

if (!fs.existsSync(addonPath)) {
  console.warn('[copy-mpv-dll] mpv_addon.node not found — run npm run build:native first');
  process.exit(0);
}

if (process.platform === 'win32') {
  const candidates = [
    process.env.VIDSYNC_LIBMPV_DLL,
    'C:\\msys64\\ucrt64\\bin\\libmpv-2.dll',
    'C:\\msys64\\mingw64\\bin\\libmpv-2.dll',
  ].filter(Boolean);

  const source = candidates.find((candidate) => fs.existsSync(candidate));
  if (!source) {
    console.warn(
      '[copy-mpv-dll] libmpv-2.dll not found. Install MSYS2 mpv and copy manually:\n' +
        '  copy C:\\msys64\\ucrt64\\bin\\libmpv-2.dll native\\mpv-addon\\build\\Release\\',
    );
    process.exit(0);
  }

  const dest = path.join(releaseDir, 'libmpv-2.dll');
  fs.copyFileSync(source, dest);
  console.log(`[copy-mpv-dll] Copied ${source} -> ${dest}`);
  process.exit(0);
}

console.log('[copy-mpv-dll] No runtime copy needed on', process.platform);
