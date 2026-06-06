#!/usr/bin/env node
/**
 * Copy libmpv-2.dll and its dependency DLLs next to mpv_addon.node (Windows).
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const { getMsysBinCandidates } = require(
  path.join(__dirname, '..', 'native', 'mpv-worker', 'mpv-windows-path'),
);

const releaseDir = path.join(__dirname, '..', 'native', 'mpv-addon', 'build', 'Release');
const addonPath = path.join(releaseDir, 'mpv_addon.node');

if (!fs.existsSync(addonPath)) {
  console.warn('[copy-mpv-runtime] mpv_addon.node not found — run npm run build:native first');
  process.exit(0);
}

if (process.platform !== 'win32') {
  console.log('[copy-mpv-runtime] No Windows runtime copy needed');
  process.exit(0);
}

const libmpvSources = [
  process.env.VIDSYNC_LIBMPV_DLL,
  'C:\\msys64\\ucrt64\\bin\\libmpv-2.dll',
  'C:\\msys64\\mingw64\\bin\\libmpv-2.dll',
].filter(Boolean);

const libmpvSource = libmpvSources.find((candidate) => fs.existsSync(candidate));
if (!libmpvSource) {
  console.warn(
    '[copy-mpv-runtime] libmpv-2.dll not found. Install MSYS2 mpv:\n' +
      '  pacman -S mingw-w64-ucrt-x86_64-mpv',
  );
  process.exit(0);
}

const msysBins = getMsysBinCandidates();
const sourceBin = path.dirname(libmpvSource);
if (!msysBins.includes(sourceBin)) {
  msysBins.unshift(sourceBin);
}

function copyIfExists(sourcePath, label) {
  if (!fs.existsSync(sourcePath)) return false;
  const destPath = path.join(releaseDir, path.basename(sourcePath));
  fs.copyFileSync(sourcePath, destPath);
  console.log(`[copy-mpv-runtime] ${label}: ${path.basename(sourcePath)}`);
  return true;
}

copyIfExists(libmpvSource, 'libmpv');

function findLdd() {
  const candidates = [
    process.env.VIDSYNC_LDD_PATH,
    'C:\\msys64\\ucrt64\\bin\\ldd.exe',
    'C:\\msys64\\mingw64\\bin\\ldd.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveDllPath(rawPath) {
  const normalized = rawPath.trim().replace(/\//g, '\\');
  if (path.isAbsolute(normalized) && fs.existsSync(normalized)) {
    return normalized;
  }

  const name = path.basename(normalized);
  for (const bin of msysBins) {
    const candidate = path.join(bin, name);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function copyDepsViaLdd() {
  const lddPath = findLdd();
  if (!lddPath) return 0;

  const libmpvDest = path.join(releaseDir, 'libmpv-2.dll');
  let output = '';
  try {
    output = execFileSync(lddPath, [libmpvDest], { encoding: 'utf8' });
  } catch (error) {
    const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
    output = typeof stdout === 'string' ? stdout : '';
    if (!output) {
      console.warn('[copy-mpv-runtime] ldd failed — copied libmpv only');
      return 0;
    }
  }

  let copied = 0;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\S+\.dll)\s+=>\s+(\S+)/i);
    if (!match) continue;

    const source = resolveDllPath(match[2]);
    if (!source) continue;
    if (copyIfExists(source, 'dep')) copied += 1;
  }

  return copied;
}

const copiedDeps = copyDepsViaLdd();
if (copiedDeps === 0) {
  console.warn(
    '[copy-mpv-runtime] Copied libmpv only. If load fails, run from MSYS2 UCRT64:\n' +
      '  ldd /c/Users/dhruv/projects/vidsync/native/mpv-addon/build/Release/libmpv-2.dll',
  );
} else {
  console.log(`[copy-mpv-runtime] Copied ${copiedDeps} dependency DLL(s)`);
}
