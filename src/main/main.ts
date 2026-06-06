import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
} from 'electron';
import { mpvWorker } from './mpvWorker';
import {
  attachVideoHost,
  bindVideoWindowSync,
  ensureWin32Surface,
  destroyVideoWindow,
  getLastVideoBounds,
  getVideoWindowId,
  setWin32SurfaceHwnd,
  updateVideoBounds,
  usesNativeWin32Surface,
  type VideoBounds,
} from './videoWindow';

if (require('electron-squirrel-startup')) {
  app.quit();
}

let mainWindow: BrowserWindow | null = null;
let isShuttingDown = false;
let mpvWid = 0;

const emptyTick = {
  needsRedraw: false,
  frame: null,
  width: 0,
  height: 0,
  timePos: 0,
  duration: 0,
  paused: true,
};

function mpvUnavailable() {
  return isShuttingDown || !mpvWorker.isAvailable();
}

const DEV_CSP =
  "default-src 'self' 'unsafe-inline' 'unsafe-eval' data: blob:; " +
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:* https: wss:; " +
  "img-src 'self' data: blob:; " +
  "media-src 'self' blob:;";

function configureContentSecurityPolicy() {
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    const headers = { ...details.responseHeaders };
    headers['Content-Security-Policy'] = [DEV_CSP];
    callback({ responseHeaders: headers });
  });
}

async function refreshMpvWid(): Promise<void> {
  if (usesNativeWin32Surface() && mpvWorker.isAvailable()) {
    const hwnd = (await mpvWorker.request('getSurfaceHwnd')) as number;
    if (typeof hwnd === 'number' && hwnd > 0) {
      mpvWid = hwnd;
      setWin32SurfaceHwnd(hwnd);
    }
  } else {
    mpvWid = getVideoWindowId();
  }

  if (!mpvWorker.isAvailable() || mpvWid <= 0) return;

  try {
    await mpvWorker.request('setWid', mpvWid);
  } catch {
    // Worker may be shutting down.
  }
}

async function logMpvDiagnostics(context: string): Promise<void> {
  if (mpvUnavailable()) return;

  try {
    const diag = (await mpvWorker.request('getDiagnostics')) as Record<string, unknown>;
    const surfaceHwnd = getVideoWindowId();
    console.log(`[mpv-diag] ${context}`, {
      surfaceHwnd,
      embedMode: usesNativeWin32Surface() ? 'worker-child-hwnd' : 'electron-hwnd',
      ...diag,
    });
  } catch (error) {
    console.warn(`[mpv-diag] ${context} failed:`, error);
  }
}

async function restartMpvEmbed(bounds: VideoBounds): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  mpvWorker.stop();
  await destroyVideoWindow();
  mpvWid = 0;
  return ensureMpvForBounds(bounds);
}

async function ensureMpvForBounds(bounds: VideoBounds): Promise<boolean> {
  if (!mainWindow || mainWindow.isDestroyed()) return false;

  if (usesNativeWin32Surface()) {
    await attachVideoHost(mainWindow, bounds);

    if (!mpvWorker.isAvailable()) {
      const started = await mpvWorker.start(0);
      if (!started) return false;
    }

    mpvWid = await ensureWin32Surface(bounds);
    if (mpvWid <= 0) return false;

    setWin32SurfaceHwnd(mpvWid);

    // First start uses wid=0 (headless). Re-init player with the real HWND so vo=gpu embeds.
    const diag = (await mpvWorker.request('getDiagnostics')) as { embedMode?: boolean };
    if (!diag.embedMode) {
      await mpvWorker.request('reset', mpvWid);
    } else {
      await mpvWorker.request('setWid', mpvWid);
    }
    return true;
  }

  mpvWid = await attachVideoHost(mainWindow, bounds);

  if (mpvWorker.isAvailable()) {
    await refreshMpvWid();
    return true;
  }

  return mpvWorker.start(mpvWid);
}

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    backgroundColor: '#0f0f12',
    webPreferences: {
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      contextIsolation: true,
      sandbox: false,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  bindVideoWindowSync(mainWindow);

  mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
    console.error('Renderer failed to load:', code, description, url);
  });

  mainWindow.loadURL(MAIN_WINDOW_WEBPACK_ENTRY).catch((err) => {
    console.error('loadURL failed:', err);
  });

  mainWindow.webContents.on('did-finish-load', () => {
    if (process.env.NODE_ENV === 'development') {
      mainWindow?.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.on('close', () => {
    isShuttingDown = true;
    mpvWorker.stop();
    void destroyVideoWindow();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

ipcMain.handle('dialog:openVideo', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select MKV / video file',
    properties: ['openFile'],
    filters: [
      {
        name: 'Video',
        extensions: ['mkv', 'mp4', 'avi', 'webm', 'mov', 'm4v'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle('dialog:openSubtitle', async () => {
  const result = await dialog.showOpenDialog({
    title: 'Select subtitle file',
    properties: ['openFile'],
    filters: [
      {
        name: 'Subtitles',
        extensions: ['srt', 'ass', 'ssa', 'vtt', 'sub'],
      },
    ],
  });

  if (result.canceled || result.filePaths.length === 0) {
    return null;
  }

  return result.filePaths[0];
});

ipcMain.handle(
  'mpv:available',
  async (_event, bounds?: VideoBounds, updateBoundsOnly = false) => {
    if (isShuttingDown) return false;

    if (updateBoundsOnly) {
      if (!mainWindow || !bounds) return false;
      updateVideoBounds(bounds);
      await refreshMpvWid();
      return mpvWorker.isAvailable();
    }

    if (bounds) {
      return ensureMpvForBounds(bounds);
    }

    if (mpvWorker.isAvailable()) return true;
    if (mpvWid > 0) {
      return mpvWorker.start(mpvWid);
    }
    return false;
  },
);

ipcMain.handle('mpv:loadError', () => mpvWorker.getLoadError());

ipcMain.handle('mpv:load', async (_event, filePath: string) => {
  if (mpvUnavailable()) {
    throw new Error(mpvWorker.getLoadError() ?? 'MPV is not available');
  }

  const ok = await mpvWorker.request('load', filePath);
  if (!ok) {
    throw new Error('MPV rejected the load command');
  }

  await refreshMpvWid();
  if (process.platform === 'win32' && mpvWid > 0) {
    try {
      await mpvWorker.request('raiseSurface');
    } catch {
      // Worker may be shutting down.
    }
  }
  if (process.env.NODE_ENV === 'development') {
    setTimeout(() => {
      void logMpvDiagnostics('after load');
    }, 1500);
  }
  return ok;
});

ipcMain.handle('mpv:diagnostics', async () => {
  if (mpvUnavailable()) return null;
  const diag = await mpvWorker.request('getDiagnostics');
  return {
    surfaceHwnd: getVideoWindowId(),
    embedMode: usesNativeWin32Surface() ? 'worker-child-hwnd' : 'electron-hwnd',
    ...(diag as Record<string, unknown>),
  };
});

ipcMain.handle('mpv:waitForLoad', async (_event, timeoutMs = 30000) => {
  if (mpvUnavailable()) return false;
  return mpvWorker.request('waitForLoad', timeoutMs);
});

ipcMain.handle('mpv:getLastError', async () => {
  if (mpvUnavailable()) return null;
  return mpvWorker.request('getLastError');
});

ipcMain.handle('mpv:play', async () => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('play');
});

ipcMain.handle('mpv:pause', async () => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('pause');
});

ipcMain.handle('mpv:togglePause', async () => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('togglePause');
});

ipcMain.handle('mpv:seek', async (_event, seconds: number) => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('seek', seconds);
});

ipcMain.handle('mpv:getTimePos', async () => {
  if (mpvUnavailable()) return 0;
  return mpvWorker.request('getTimePos');
});

ipcMain.handle('mpv:getDuration', async () => {
  if (mpvUnavailable()) return 0;
  return mpvWorker.request('getDuration');
});

ipcMain.handle('mpv:getPaused', async () => {
  if (mpvUnavailable()) return true;
  return mpvWorker.request('getPaused');
});

ipcMain.handle('mpv:tick', async (event) => {
  if (mpvUnavailable() || event.sender.isDestroyed()) {
    return emptyTick;
  }

  try {
    const tick = (await mpvWorker.request('tick', 0, 0)) as {
      timePos?: number;
      duration?: number;
      paused?: boolean;
    };

    return {
      needsRedraw: false,
      frame: null,
      width: 0,
      height: 0,
      timePos: typeof tick.timePos === 'number' ? tick.timePos : 0,
      duration: typeof tick.duration === 'number' ? tick.duration : 0,
      paused: Boolean(tick.paused),
    };
  } catch {
    return emptyTick;
  }
});

ipcMain.handle('mpv:getTrackList', async () => {
  if (mpvUnavailable()) return [];
  return mpvWorker.request('getTrackList');
});

ipcMain.handle('mpv:getSid', async () => {
  if (mpvUnavailable()) return null;
  return mpvWorker.request('getSid');
});

ipcMain.handle('mpv:getAid', async () => {
  if (mpvUnavailable()) return null;
  return mpvWorker.request('getAid');
});

ipcMain.handle('mpv:setSid', async (_event, trackId: number | 'no') => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('setSid', trackId);
});

ipcMain.handle('mpv:setAid', async (_event, trackId: number) => {
  if (mpvUnavailable()) return;
  await mpvWorker.request('setAid', trackId);
});

ipcMain.handle('mpv:addSubtitle', async (_event, filePath: string) => {
  if (mpvUnavailable()) return false;
  return mpvWorker.request('addSubtitle', filePath);
});

ipcMain.handle('mpv:destroy', async () => {
  mpvWorker.stop();
});

app.whenReady().then(() => {
  configureContentSecurityPolicy();
  Menu.setApplicationMenu(null);
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  isShuttingDown = true;
  mpvWorker.stop();
  void destroyVideoWindow();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  isShuttingDown = true;
  mpvWorker.stop();
  void destroyVideoWindow();
});

process.on('uncaughtException', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EPIPE') return;
});
