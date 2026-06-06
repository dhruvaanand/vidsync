#!/usr/bin/env node
/**
 * Copy the current Node binary (and Windows DLL deps) into native/bundled-node
 * so packaged builds can run the MPV worker without a separate Node install.
 */
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const destDir = path.join(root, 'native', 'bundled-node', process.platform, process.arch);

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) return false;
  fs.copyFileSync(src, dest);
  return true;
}

function bundleNode() {
  const nodeExe = process.execPath;
  const nodeDir = path.dirname(nodeExe);
  const nodeName = path.basename(nodeExe);

  fs.mkdirSync(destDir, { recursive: true });

  const destNode = path.join(destDir, nodeName);
  copyIfExists(nodeExe, destNode);
  if (process.platform !== 'win32') {
    try {
      fs.chmodSync(destNode, 0o755);
    } catch {
      // Windows or read-only FS
    }
  }

  if (process.platform === 'win32') {
    for (const name of fs.readdirSync(nodeDir)) {
      if (!/\.(dll|exe)$/i.test(name)) continue;
      if (name.toLowerCase() === nodeName.toLowerCase()) continue;
      copyIfExists(path.join(nodeDir, name), path.join(destDir, name));
    }
  }

  console.log(`[bundle-node] Copied ${nodeName} to ${destDir}`);
}

bundleNode();
