#!/usr/bin/env node
/**
 * Run electron-forge package with debug logging (no --verbose flag needed).
 */
const { execSync } = require('child_process');
const path = require('path');

const root = path.join(__dirname, '..');

process.env.DEBUG = 'electron-forge:*,electron-packager';

execSync('node scripts/prepare-package.js', { cwd: root, stdio: 'inherit' });
execSync('npx electron-forge package', {
  cwd: root,
  stdio: 'inherit',
  env: process.env,
});
