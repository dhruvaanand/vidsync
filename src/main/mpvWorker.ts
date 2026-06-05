import { ChildProcess, execSync, fork } from 'child_process';
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

function getSystemNodePath(): string {
  if (process.env.VIDSYNC_NODE_PATH) {
    return process.env.VIDSYNC_NODE_PATH;
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

function getWorkerEnv(): NodeJS.ProcessEnv {
  const env = { ...process.env, VIDSYNC_ADDON_ROOT: getAddonRoot() };
  delete env.ELECTRON_RUN_AS_NODE;
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
        this.child = fork(workerPath, [], {
          execPath: nodePath,
          env: getWorkerEnv(),
          // Only IPC — piped stdio causes EPIPE when the worker exits uncleanly.
          stdio: ['ignore', 'ignore', 'ignore', 'ipc'],
        });
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
