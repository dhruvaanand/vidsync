#!/usr/bin/env node
/**
 * One-shot setup after git pull (especially on Windows).
 *
 *   git pull
 *   npm run setup
 *   npm start
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

function run(command, label) {
  console.log(`\n=== ${label} ===\n`);
  execSync(command, {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
}

try {
  run('npm install', '1/3 — npm dependencies');
  run('npm run build:native', '2/3 — native MPV addon (build + DLLs + verify)');
  run('npm run test:mpv', '3/3 — MPV worker smoke test');
  console.log('\n=== Setup complete ===\n');
  console.log('  npm start');
  console.log('  npm run start:client   (second window, same machine)\n');
} catch {
  console.error('\n=== Setup failed ===\n');
  console.error('Read the error above. Common fixes on Windows:');
  console.error('  - VS 2022 Build Tools with Desktop development with C++');
  console.error('  - MSYS2: pacman -S mingw-w64-ucrt-x86_64-mpv');
  console.error('  - npm config set msvs_version 2022\n');
  process.exit(1);
}
