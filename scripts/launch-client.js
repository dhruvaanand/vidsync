#!/usr/bin/env node

const { spawn } = require('child_process');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');

const root = path.join(__dirname, '..');
// Webpack dev server (default 3000). Port 9000 is only the forge build log viewer.
const devPort = process.env.VIDSYNC_DEV_PORT || '3000';
const devUrl = `http://localhost:${devPort}`;
const electronPath = require(path.join(root, 'node_modules', 'electron'));

const MAIN_BUNDLE_CANDIDATES = [
  path.join(root, '.webpack', 'main', 'index.js'),
  path.join(root, '.webpack', 'main.js'),
];

function findMainBundle() {
  return MAIN_BUNDLE_CANDIDATES.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function checkDevServer() {
  return new Promise((resolve) => {
    const req = http.get(`${devUrl}/main_window/index.html`, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on('error', () => resolve(false));
    req.setTimeout(2000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

async function main() {
  if (!findMainBundle()) {
    console.error(
      'Main process bundle not found. Looked for:\n' +
        MAIN_BUNDLE_CANDIDATES.map((p) => `  ${p}`).join('\n') +
        '\n\nStart the first client with:  npm start\n' +
        'Wait until the window opens, then run:  npm run start:client',
    );
    process.exit(1);
  }

  const running = await checkDevServer();
  if (!running) {
    console.error(
      `Dev server is not running at ${devUrl}.\n` +
        'Keep the first client running (npm start), then run:  npm run start:client',
    );
    process.exit(1);
  }

  const clientId = process.env.VIDSYNC_CLIENT_ID || String(Date.now());
  const userDataDir = path.join(os.tmpdir(), `vidsync-client-${clientId}`);

  const env = { ...process.env, NODE_ENV: 'development' };
  delete env.ELECTRON_RUN_AS_NODE;

  console.log(`Launching Vidsync client (profile: ${userDataDir})`);

  const child = spawn(
    electronPath,
    [`--user-data-dir=${userDataDir}`, '.'],
    {
      cwd: root,
      env,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  let stderr = '';
  child.stderr?.on('data', (chunk) => {
    stderr += chunk.toString();
  });

  let settled = false;

  const succeed = () => {
    if (settled) return;
    settled = true;
    clearTimeout(successTimer);
    console.log(`Client started (pid ${child.pid}). A new Vidsync window should appear.`);
    child.unref();
    process.exit(0);
  };

  const fail = (code) => {
    if (settled) return;
    settled = true;
    clearTimeout(successTimer);
    if (stderr.trim()) {
      console.error(stderr.trim());
    }
    console.error(`Client failed to start (exit code ${code}).`);
    process.exit(code || 1);
  };

  child.on('error', (error) => {
    console.error(`Failed to spawn Electron: ${error.message}`);
    process.exit(1);
  });

  child.on('exit', (code) => {
    if (code && code !== 0) {
      fail(code);
    }
  });

  const successTimer = setTimeout(succeed, 1500);
}

void main();
