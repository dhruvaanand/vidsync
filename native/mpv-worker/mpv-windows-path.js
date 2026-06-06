const fs = require('fs');
const path = require('path');

/** @returns {string[]} */
function getMsysBinCandidates() {
  const roots = [
    process.env.VIDSYNC_MSYS2_ROOT,
    process.env.MSYS2_ROOT,
    'C:\\msys64',
    'C:\\msys32',
  ].filter(Boolean);

  const flavors = ['ucrt64', 'mingw64', 'clang64'];
  const bins = [];

  for (const root of roots) {
    for (const flavor of flavors) {
      bins.push(path.join(root, flavor, 'bin'));
    }
    bins.push(path.join(root, 'usr', 'bin'));
  }

  return [...new Set(bins)].filter((dir) => fs.existsSync(dir));
}

/**
 * MSYS2 libmpv-2.dll needs ffmpeg/gcc DLLs from ucrt64\bin on PATH.
 * @param {NodeJS.ProcessEnv} env
 */
function prependWindowsMpvPath(env) {
  if (process.platform !== 'win32') return env;

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
  const existing = env[pathKey] ?? '';
  const extra = [
    process.env.VIDSYNC_MSYS2_BIN,
    ...getMsysBinCandidates(),
  ].filter(Boolean);

  const merged = extra.filter((dir, index) => extra.indexOf(dir) === index);
  if (merged.length === 0) return env;

  env[pathKey] = existing ? `${merged.join(';')};${existing}` : merged.join(';');
  return env;
}

module.exports = {
  getMsysBinCandidates,
  prependWindowsMpvPath,
};
