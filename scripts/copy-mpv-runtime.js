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

const FALLBACK_DLL_PREFIXES = [
  'avcodec-',
  'avformat-',
  'avutil-',
  'swresample-',
  'swscale-',
  'libass-',
  'libplacebo-',
  'shaderc',
  'spirv-',
  'dav1d',
  'libbluray-',
  'libdvdnav-',
  'libdvdread-',
  'libfontconfig-',
  'libfreetype-',
  'libharfbuzz-',
  'libfribidi-',
  'libpng16-',
  'zlib1',
  'liblzma-',
  'libiconv-',
  'libintl-',
  'libogg-',
  'libvorbis-',
  'libopus-',
  'libvpx-',
  'libwebpmux-',
  'lcms2-',
  'liblcms2-',
  'libjpeg-',
  'libwebp-',
  'libmujs',
  'libsixel-',
  'libarchive-',
  'libcurl-',
  'libssh2-',
  'libssl-',
  'libcrypto-',
  'libb2-',
  'libbrotlicommon',
  'libbrotlidec',
  'libbrotlienc',
  'libzstd',
  'libunistring-',
  'libidn2-',
  'libpsl-',
  'libnghttp2-',
  'libnghttp3-',
  'libsqlite3-',
  'libgif-',
  'libtiff-',
  'libopenmpt-',
  'libmodplug-',
  'libudfread-',
  'libxml2-',
];

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

const copiedNames = new Set();

function copyIfExists(sourcePath, label) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return false;
  if (!shouldCopyFromMsys(sourcePath)) return false;

  const fileName = path.basename(sourcePath);
  if (copiedNames.has(fileName.toLowerCase())) return false;

  const destPath = path.join(releaseDir, fileName);
  fs.copyFileSync(sourcePath, destPath);
  copiedNames.add(fileName.toLowerCase());
  console.log(`[copy-mpv-runtime] ${label}: ${fileName}`);
  return true;
}

function shouldCopyFromMsys(sourcePath) {
  const lower = sourcePath.toLowerCase().replace(/\//g, '\\');
  if (lower.includes('\\windows\\')) return false;
  if (lower.includes('\\system32\\')) return false;
  if (lower.includes('\\syswow64\\')) return false;
  return lower.includes('msys64') || lower.includes('mingw') || lower.includes('ucrt64');
}

copyIfExists(libmpvSource, 'libmpv');

function toMsysPath(winPath) {
  const match = winPath.match(/^([A-Za-z]):\\(.*)$/);
  if (!match) return winPath.replace(/\\/g, '/');
  return `/${match[1].toLowerCase()}/${match[2].replace(/\\/g, '/')}`;
}

function findBash() {
  const candidates = [
    process.env.VIDSYNC_BASH_PATH,
    'C:\\msys64\\usr\\bin\\bash.exe',
    'C:\\msys32\\usr\\bin\\bash.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function findLdd() {
  const candidates = [
    process.env.VIDSYNC_LDD_PATH,
    'C:\\msys64\\usr\\bin\\ldd.exe',
    'C:\\msys64\\ucrt64\\bin\\ldd.exe',
    'C:\\msys64\\mingw64\\bin\\ldd.exe',
  ].filter(Boolean);
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function resolveDllPath(rawPath) {
  const trimmed = rawPath.trim();

  const flavorMatch = trimmed.match(/^\/(ucrt64|mingw64|clang64)\/bin\/(.+)$/i);
  if (flavorMatch) {
    for (const root of [
      process.env.VIDSYNC_MSYS2_ROOT,
      process.env.MSYS2_ROOT,
      'C:\\msys64',
      'C:\\msys32',
    ].filter(Boolean)) {
      const candidate = path.join(
        root,
        flavorMatch[1],
        'bin',
        flavorMatch[2].replace(/\//g, path.sep),
      );
      if (fs.existsSync(candidate)) return candidate;
    }
  }

  const cygMatch = trimmed.match(/^\/([a-z])\/(.*)$/i);
  if (cygMatch) {
    const candidate = path.join(`${cygMatch[1].toUpperCase()}:`, cygMatch[2].replace(/\//g, path.sep));
    if (fs.existsSync(candidate)) return candidate;
  }

  const windowsPath = trimmed.replace(/\//g, path.sep);
  if (path.isAbsolute(windowsPath) && fs.existsSync(windowsPath)) {
    return windowsPath;
  }

  const fileName = path.basename(windowsPath);
  for (const bin of msysBins) {
    const candidate = path.join(bin, fileName);
    if (fs.existsSync(candidate)) return candidate;
  }

  return null;
}

function runLdd(targetPath) {
  const libmpvDest = path.join(releaseDir, 'libmpv-2.dll');
  const bash = findBash();
  const lddPath = findLdd();

  if (bash) {
    const msysTarget = toMsysPath(libmpvDest);
    const lowerBin = sourceBin.toLowerCase();
    const msystem = lowerBin.includes('ucrt64')
      ? 'UCRT64'
      : lowerBin.includes('mingw64')
        ? 'MINGW64'
        : 'UCRT64';
    try {
      return execFileSync(bash, ['-lc', `ldd '${msysTarget}'`], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
        env: {
          ...process.env,
          MSYSTEM: msystem,
          CHERE_INVOKING: '1',
        },
      });
    } catch (error) {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
      if (typeof stdout === 'string' && stdout.trim()) return stdout;
      console.warn(
        '[copy-mpv-runtime] bash ldd failed:',
        error instanceof Error ? error.message : error,
      );
    }
  }

  if (lddPath) {
    try {
      return execFileSync(lddPath, [libmpvDest], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (error) {
      const stdout = error && typeof error === 'object' && 'stdout' in error ? error.stdout : '';
      if (typeof stdout === 'string' && stdout.trim()) return stdout;
      console.warn(
        '[copy-mpv-runtime] ldd failed:',
        error instanceof Error ? error.message : error,
      );
    }
  } else {
    console.warn('[copy-mpv-runtime] ldd not found under MSYS2');
  }

  return '';
}

function copyDepsViaLdd() {
  const output = runLdd();
  if (!output.trim()) return 0;

  let copied = 0;
  for (const line of output.split(/\r?\n/)) {
    const match = line.match(/^\s*(\S+\.dll)\s+=>\s+(\S+)/i);
    if (!match) continue;

    const source = resolveDllPath(match[2]);
    if (!source) {
      console.warn(`[copy-mpv-runtime] unresolved dep: ${match[1]} => ${match[2]}`);
      continue;
    }

    if (copyIfExists(source, 'dep')) copied += 1;
  }

  return copied;
}

function copyFallbackDeps(binDir) {
  let copied = 0;
  let files = [];

  try {
    files = fs.readdirSync(binDir);
  } catch {
    return 0;
  }

  for (const file of files) {
    if (!file.toLowerCase().endsWith('.dll')) continue;
    const lower = file.toLowerCase();
    const matches = FALLBACK_DLL_PREFIXES.some(
      (prefix) => lower.startsWith(prefix) || lower.includes(prefix),
    );
    if (!matches) continue;
    if (copyIfExists(path.join(binDir, file), 'fallback')) copied += 1;
  }

  return copied;
}

let copiedDeps = copyDepsViaLdd();
if (copiedDeps === 0) {
  console.warn('[copy-mpv-runtime] ldd copied 0 deps — using fallback prefix copy');
  copiedDeps = copyFallbackDeps(sourceBin);
}

if (copiedDeps === 0) {
  console.warn(
    '[copy-mpv-runtime] Still no deps copied. From MSYS2 UCRT64 terminal run:\n' +
      `  ldd ${toMsysPath(path.join(releaseDir, 'libmpv-2.dll'))}`,
  );
  process.exit(1);
}

console.log(`[copy-mpv-runtime] Copied ${copiedDeps} dependency DLL(s) from ${sourceBin}`);
