import { BrowserWindow } from 'electron';
import { mpvWorker } from './mpvWorker';

export interface VideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let videoWindow: BrowserWindow | null = null;
let lastBounds: VideoBounds | null = null;
let parentWindow: BrowserWindow | null = null;
let win32SurfaceHwnd = 0;
let win32ParentHwnd = 0;

function isWin32(): boolean {
  return process.platform === 'win32';
}

export function usesNativeWin32Surface(): boolean {
  return isWin32();
}

export function getNativeWindowId(win: BrowserWindow): number {
  const handle = win.getNativeWindowHandle();
  if (process.platform === 'darwin') {
    return Number(handle.readBigUInt64LE(0));
  }
  if (isWin32()) {
    return handle.readUInt32LE(0);
  }
  return handle.readUInt32LE(0);
}

export function toScreenBounds(
  parent: BrowserWindow,
  bounds: VideoBounds,
): { x: number; y: number; width: number; height: number } {
  const content = parent.getContentBounds();
  return {
    x: Math.round(content.x + bounds.x),
    y: Math.round(content.y + bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

/** Client-area coords for a WS_CHILD surface parented to the Electron HWND. */
export function toClientBounds(bounds: VideoBounds): {
  x: number;
  y: number;
  width: number;
  height: number;
} {
  return {
    x: Math.round(bounds.x),
    y: Math.round(bounds.y),
    width: Math.max(1, Math.round(bounds.width)),
    height: Math.max(1, Math.round(bounds.height)),
  };
}

async function liftWin32Surface() {
  if (!mpvWorker.isAvailable()) return;
  await syncWin32Surface();
  await mpvWorker.request('raiseSurface');
}

function showVideoSurface() {
  if (isWin32()) {
    if (mpvWorker.isAvailable()) {
      void mpvWorker.request('showSurface', true);
      void liftWin32Surface();
    }
    return;
  }

  if (!videoWindow || videoWindow.isDestroyed()) return;

  syncVideoWindowBounds();
  videoWindow.showInactive();
}

function ensureVideoWindow(parent: BrowserWindow): BrowserWindow {
  if (videoWindow && !videoWindow.isDestroyed()) {
    return videoWindow;
  }

  videoWindow = new BrowserWindow({
    parent,
    modal: false,
    show: false,
    frame: false,
    transparent: false,
    backgroundColor: '#000000',
    hasShadow: false,
    thickFrame: false,
    skipTaskbar: true,
    focusable: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: false,
    },
  });

  void videoWindow.loadURL('about:blank');
  videoWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.platform === 'linux') {
    videoWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  return videoWindow;
}

async function syncWin32Surface(): Promise<void> {
  if (!parentWindow || parentWindow.isDestroyed() || !lastBounds) return;
  if (!mpvWorker.isAvailable()) return;

  const pos = toClientBounds(lastBounds);
  await mpvWorker.request(
    'moveSurface',
    pos.x,
    pos.y,
    pos.width,
    pos.height,
  );
}

export async function ensureWin32Surface(bounds: VideoBounds): Promise<number> {
  if (!parentWindow || parentWindow.isDestroyed()) return 0;
  if (!mpvWorker.isAvailable()) return 0;

  lastBounds = bounds;
  if (win32ParentHwnd <= 0) {
    win32ParentHwnd = getNativeWindowId(parentWindow);
  }

  const client = toClientBounds(bounds);

  if (win32SurfaceHwnd > 0) {
    await mpvWorker.request(
      'moveSurface',
      client.x,
      client.y,
      client.width,
      client.height,
    );
    return win32SurfaceHwnd;
  }

  const hwnd = (await mpvWorker.request(
    'createSurface',
    win32ParentHwnd,
    client.x,
    client.y,
    client.width,
    client.height,
  )) as number;

  win32SurfaceHwnd = typeof hwnd === 'number' ? hwnd : 0;
  return win32SurfaceHwnd;
}

export async function attachVideoHost(
  mainWin: BrowserWindow,
  bounds: VideoBounds,
): Promise<number> {
  parentWindow = mainWin;
  lastBounds = bounds;

  if (isWin32()) {
    win32ParentHwnd = getNativeWindowId(mainWin);
    return win32SurfaceHwnd;
  }

  const host = ensureVideoWindow(mainWin);
  syncVideoWindowBounds();

  if (!host.isVisible()) {
    showVideoSurface();
  }

  const settleMs = 100;
  await new Promise<void>((resolve) => {
    const done = () => resolve();
    host.once('ready-to-show', done);
    setTimeout(done, settleMs);
  });
  syncVideoWindowBounds();

  return getNativeWindowId(host);
}

export function updateVideoBounds(bounds: VideoBounds) {
  lastBounds = bounds;

  if (isWin32()) {
    void syncWin32Surface();
    return;
  }

  syncVideoWindowBounds();
}

export function getVideoWindowId(): number {
  if (isWin32()) {
    return win32SurfaceHwnd;
  }

  if (!videoWindow || videoWindow.isDestroyed()) return 0;
  return getNativeWindowId(videoWindow);
}

export function setWin32SurfaceHwnd(hwnd: number): void {
  win32SurfaceHwnd = hwnd;
}

function syncVideoWindowBounds() {
  if (!videoWindow || videoWindow.isDestroyed() || !parentWindow || !lastBounds) {
    return;
  }

  if (parentWindow.isDestroyed()) {
    return;
  }

  const screen = toScreenBounds(parentWindow, lastBounds);
  videoWindow.setBounds(screen);
}

export function bindVideoWindowSync(mainWin: BrowserWindow) {
  const sync = () => {
    if (isWin32()) {
      void liftWin32Surface();
      return;
    }
    syncVideoWindowBounds();
  };

  mainWin.on('move', sync);
  mainWin.on('resize', sync);
  mainWin.on('maximize', sync);
  mainWin.on('unmaximize', sync);
  mainWin.on('focus', sync);

  mainWin.on('minimize', () => {
    if (isWin32()) {
      if (mpvWorker.isAvailable()) {
        void mpvWorker.request('showSurface', false);
      }
      return;
    }

    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.hide();
    }
  });

  mainWin.on('restore', () => {
    showVideoSurface();
  });

  mainWin.on('hide', () => {
    if (isWin32()) {
      if (mpvWorker.isAvailable()) {
        void mpvWorker.request('showSurface', false);
      }
      return;
    }

    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.hide();
    }
  });

  mainWin.on('show', () => {
    showVideoSurface();
  });
}

export async function destroyVideoWindow(): Promise<void> {
  if (isWin32()) {
    if (mpvWorker.isAvailable()) {
      try {
        await mpvWorker.request('destroySurface');
      } catch {
        // Worker may already be shutting down.
      }
    }
    win32SurfaceHwnd = 0;
    win32ParentHwnd = 0;
    parentWindow = null;
    lastBounds = null;
    return;
  }

  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.close();
  }
  videoWindow = null;
  parentWindow = null;
  lastBounds = null;
}

export function getLastVideoBounds(): VideoBounds | null {
  return lastBounds;
}
