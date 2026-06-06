#!/usr/bin/env node
/**
 * Stop Vidsync / MPV worker processes that lock native/mpv-addon/build/Release/*.dll
 */
const { execSync } = require('child_process');

function runQuiet(command) {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

if (process.platform === 'win32') {
  const names = ['vidsync.exe', 'electron.exe'];
  for (const name of names) {
    runQuiet(`taskkill /F /IM ${name} /T`);
  }

  // Orphan MPV worker nodes (forked from Vidsync, cwd often under vidsync).
  runQuiet(
    'powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name = \'node.exe\'\\" | ' +
      'Where-Object { $_.CommandLine -match \'mpv-worker\' } | ' +
      'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }"',
  );
} else {
  runQuiet('pkill -f "native/mpv-worker/worker.js"');
  runQuiet('pkill -f "electron.*vidsync"');
}

console.log('[kill-vidsync] Closed Vidsync / MPV worker processes (if any were running).');
