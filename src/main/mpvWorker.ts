import { ChildProcess, execSync, fork } from 'child_process';
import fs from 'fs';
import path from 'path';
import { app } from 'electron';

type WorkerResponse = {
  id: number;
  ok: boolean;
  result?: unknown;
  error?: string;
};

type PendingRequest = {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
};

function getBundledNodePath(): string | null {
  if (!app.isPackaged) return null;

  const base = path.join(process.resourcesPath, 'bundled-node', process.platform, process.arch);
  const candidates =
    process.platform === 'win32' ? ['node.exe', 'node'] : ['node'];

  for (const name of candidates) {
    const candidate = path.join(base, name);
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

function getSystemNodePath(): string {
  if (process.env.VIDSYNC_NODE_PATH) {
    return process.env.VIDSYNC_NODE_PATH;
  }

  const bundled = getBundledNodePath();
  if (bundled) {
    return bundled;
  }

  if (process.platform === 'win32') {
    try {
      const lines = execSync('where node', { encoding: 'utf8' })
        .trim()
        .split(/\r?\n/)
        .filter(Boolean);
      if (lines.length > 0) return lines[0];
    } catch {
      return 'node.exe';
    }
  }

  try {
    return execSync('which node', { encoding: 'utf8' }).trim();
  } catch {
    return 'node';
  }
}

function getWorkerPath(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'mpv-worker', 'worker.js');
  }

  return path.join(app.getAppPath(), 'native', 'mpv-worker', 'worker.js');
}

function getAddonRoot(): string {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'Release');
  }

  return path.join(app.getAppPath(), 'native', 'mpv-addon', 'build', 'Release');
}

function getWindowsMsysBinDirs(): string[] {
  const roots = [
    process.env.VIDSYNC_MSYS2_ROOT,
    process.env.MSYS2_ROOT,
    'C:\\msys64',
    'C:\\msys32',
  ].filter(Boolean) as string[];

  const flavors = ['ucrt64', 'mingw64', 'clang64'];
  const bins: string[] = [];

  if (process.env.VIDSYNC_MSYS2_BIN) {
    bins.push(process.env.VIDSYNC_MSYS2_BIN);
  }

  for (const root of roots) {
    for (const flavor of flavors) {
      bins.push(path.join(root, flavor, 'bin'));
    }
    bins.push(path.join(root, 'usr', 'bin'));
  }

  return [...new Set(bins)].filter((dir) => fs.existsSync(dir));
}

function getWorkerEnv(): NodeJS.ProcessEnv {
  const addonRoot = getAddonRoot();
  const env = { ...process.env, VIDSYNC_ADDON_ROOT: addonRoot };
  delete env.ELECTRON_RUN_AS_NODE;

  if (process.platform === 'win32') {
    const pathKey = Object.keys(env).find((key) => key.toLowerCase() === 'path') ?? 'Path';
    const existing = env[pathKey] ?? '';
    const prefix = [addonRoot, ...getWindowsMsysBinDirs()];
    env[pathKey] = existing ? `${prefix.join(';')};${existing}` : prefix.join(';');
  } else if (process.platform === 'linux') {
    env.LD_LIBRARY_PATH = env.LD_LIBRARY_PATH
      ? `${addonRoot}:${env.LD_LIBRARY_PATH}`
      : addonRoot;
  } else if (process.platform === 'darwin') {
    env.DYLD_LIBRARY_PATH = env.DYLD_LIBRARY_PATH
      ? `${addonRoot}:${env.DYLD_LIBRARY_PATH}`
      : addonRoot;
  }

  return env;
}

export class MpvWorkerBridge {
  private child: ChildProcess | null = null;
  private readonly pending = new Map<number, PendingRequest>();
  private nextId = 1;
  private loadError: string | null = null;
  private started = false;
  private stopping = false;

  async start(wid = 0): Promise<boolean> {
    if (this.started && this.child?.connected) {
      return this.loadError === null;
    }

    this.loadError = null;
    this.stopping = false;

    return new Promise((resolve) => {
      const workerPath = getWorkerPath();
      const nodePath = getSystemNodePath();

      try {
        const isDev = process.env.NODE_ENV === 'development';
        this.child = fork(workerPath, [], {
          execPath: nodePath,
          env: getWorkerEnv(),
          // Pipe stderr in dev so MPV/native load failures show in the terminal.
          stdio: isDev ? ['ignore', 'ignore', 'pipe', 'ipc'] : ['ignore', 'ignore', 'ignore', 'ipc'],
        });

        if (isDev && this.child.stderr) {
          this.child.stderr.on('data', (chunk: Buffer) => {
            const text = chunk.toString('utf8').trimEnd();
            if (text) {
              console.error('[mpv-worker]', text);
            }
          });
        }
      } catch (error) {
        this.loadError =
          error instanceof Error ? error.message : 'Failed to spawn MPV worker';
        resolve(false);
        return;
      }

      this.child.on('message', (message: WorkerResponse) => {
        const pending = this.pending.get(message.id);
        if (!pending) return;

        this.pending.delete(message.id);

        if (message.ok) {
          pending.resolve(message.result);
        } else {
          pending.reject(new Error(message.error ?? 'MPV worker error'));
        }
      });

      this.child.on('error', (error) => {
        this.loadError = error.message;
        for (const [, pending] of this.pending) {
          pending.reject(error);
        }
        this.pending.clear();
      });

      this.child.on('exit', (code) => {
        this.started = false;
        this.child = null;
        this.rejectAllPending(new Error('MPV worker exited'));
        if (!this.stopping && code !== 0 && code !== null) {
          this.loadError = `MPV worker exited with code ${code}`;
        }
      });

      const initTimeout = setTimeout(() => {
        this.loadError = 'MPV worker init timed out';
        this.stop();
        resolve(false);
      }, 15000);

      void this.request('init', wid)
        .then(() => {
          clearTimeout(initTimeout);
          this.started = true;
          resolve(true);
        })
        .catch((error: Error) => {
          clearTimeout(initTimeout);
          this.loadError = error.message;
          this.stop();
          resolve(false);
        });
    });
  }

  getLoadError(): string | null {
    return this.loadError;
  }

  isAvailable(): boolean {
    return (
      !this.stopping &&
      this.started &&
      this.child?.connected === true &&
      this.loadError === null
    );
  }

  isStopping(): boolean {
    return this.stopping;
  }

  private rejectAllPending(reason: Error) {
    for (const [, pending] of this.pending) {
      pending.reject(reason);
    }
    this.pending.clear();
  }

  async request(method: string, ...args: unknown[]): Promise<unknown> {
    if (this.stopping || !this.child?.connected) {
      throw new Error('MPV worker is not running');
    }

    const id = this.nextId++;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      try {
        this.child?.send({ id, method, args });
      } catch (error) {
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error('MPV worker IPC failed'));
      }
    });
  }

  stop(): void {
    if (this.stopping && !this.child) return;

    this.stopping = true;
    this.started = false;
    this.rejectAllPending(new Error('MPV worker shutting down'));

    const child = this.child;
    this.child = null;
    if (!child) return;

    if (child.connected) {
      try {
        child.send({ id: 0, method: 'destroy', args: [] });
      } catch {
        // Worker may already be gone.
      }
      child.disconnect();
      return;
    }

    child.kill();
  }
}

export const mpvWorker = new MpvWorkerBridge();
