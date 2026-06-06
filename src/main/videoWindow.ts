import { BrowserWindow } from 'electron';

export interface VideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

let videoWindow: BrowserWindow | null = null;
let lastBounds: VideoBounds | null = null;
let parentWindow: BrowserWindow | null = null;

export function getNativeWindowId(win: BrowserWindow): number {
  const handle = win.getNativeWindowHandle();
  if (process.platform === 'darwin' || process.platform === 'win32') {
    return Number(handle.readBigUInt64LE(0));
  }
  return handle.readUInt32LE(0);
}

function ensureVideoWindow(parent: BrowserWindow): BrowserWindow {
  if (videoWindow && !videoWindow.isDestroyed()) {
    return videoWindow;
  }

  const isWin32 = process.platform === 'win32';

  // On Windows, a parented child HWND renders *behind* Chromium. Use a
  // borderless always-on-top overlay aligned to the video panel instead.
  videoWindow = new BrowserWindow({
    ...(isWin32 ? {} : { parent }),
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
    alwaysOnTop: isWin32,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
    },
  });

  void videoWindow.loadURL('about:blank');
  videoWindow.setIgnoreMouseEvents(true, { forward: true });

  if (process.platform === 'linux') {
    videoWindow.setAlwaysOnTop(true, 'screen-saver');
  } else if (isWin32) {
    videoWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  return videoWindow;
}

export async function attachVideoHost(
  mainWin: BrowserWindow,
  bounds: VideoBounds,
): Promise<number> {
  parentWindow = mainWin;
  lastBounds = bounds;

  const host = ensureVideoWindow(mainWin);
  syncVideoWindowBounds();

  if (!host.isVisible()) {
    host.showInactive();
  }

  // Let the window manager map the native surface before MPV embeds via wid.
  const settleMs = process.platform === 'win32' ? 300 : 100;
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
  syncVideoWindowBounds();
}

function syncVideoWindowBounds() {
  if (!videoWindow || videoWindow.isDestroyed() || !parentWindow || !lastBounds) {
    return;
  }

  if (parentWindow.isDestroyed()) {
    return;
  }

  const content = parentWindow.getContentBounds();
  videoWindow.setBounds({
    x: Math.round(content.x + lastBounds.x),
    y: Math.round(content.y + lastBounds.y),
    width: Math.max(1, Math.round(lastBounds.width)),
    height: Math.max(1, Math.round(lastBounds.height)),
  });
}

export function bindVideoWindowSync(mainWin: BrowserWindow) {
  const sync = () => syncVideoWindowBounds();

  mainWin.on('move', sync);
  mainWin.on('resize', sync);
  mainWin.on('maximize', sync);
  mainWin.on('unmaximize', sync);

  mainWin.on('minimize', () => {
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.hide();
    }
  });

  mainWin.on('restore', () => {
    syncVideoWindowBounds();
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.showInactive();
    }
  });

  mainWin.on('hide', () => {
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.hide();
    }
  });

  mainWin.on('show', () => {
    syncVideoWindowBounds();
    if (videoWindow && !videoWindow.isDestroyed()) {
      videoWindow.showInactive();
    }
  });

  if (process.platform === 'win32') {
    const liftOverlay = () => {
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.setAlwaysOnTop(true, 'screen-saver');
      }
    };
    const dropOverlay = () => {
      if (videoWindow && !videoWindow.isDestroyed()) {
        videoWindow.setAlwaysOnTop(false);
      }
    };

    mainWin.on('focus', liftOverlay);
    mainWin.on('blur', dropOverlay);
    liftOverlay();
  }
}

export function destroyVideoWindow() {
  if (videoWindow && !videoWindow.isDestroyed()) {
    videoWindow.close();
  }
  videoWindow = null;
  parentWindow = null;
  lastBounds = null;
}
