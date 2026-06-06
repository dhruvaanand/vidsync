const path = require('path');

const releaseDir =
  process.env.VIDSYNC_ADDON_ROOT ||
  path.join(__dirname, '..', 'mpv-addon', 'build', 'Release');

/** @type {typeof import('../mpv-addon').MpvPlayer | undefined} */
let MpvPlayer;
/** @type {((x: number, y: number, w: number, h: number) => number) | undefined} */
let createSurface;
/** @type {((x: number, y: number, w: number, h: number) => void) | undefined} */
let moveSurface;
/** @type {((visible?: boolean) => void) | undefined} */
let showSurface;
/** @type {(() => void) | undefined} */
let destroySurface;
/** @type {(() => number) | undefined} */
let getSurfaceHwnd;

try {
  const addon = require(path.join(releaseDir, 'mpv_addon.node'));
  ({ MpvPlayer } = addon);
  if (process.platform === 'win32') {
    ({ createSurface, moveSurface, showSurface, destroySurface, getSurfaceHwnd } = addon);
  }
} catch (error) {
  console.error(`Failed to load mpv_addon.node from ${releaseDir}`);
  console.error(error instanceof Error ? error.message : error);
  console.error(
    'On Windows: run npm run build:native and ensure libmpv-2.dll is in the Release folder.',
  );
  process.exit(1);
}

/** @type {import('../mpv-addon').MpvPlayer | null} */
let player = null;

function ensurePlayer(wid = 0) {
  if (!player) {
    player = new MpvPlayer(wid);
  }
  return player;
}

function teardownSurface() {
  if (destroySurface) {
    destroySurface();
  }
}

function handleMessage(msg) {
  const { id, method, args = [] } = msg;

  try {
    let result;

    switch (method) {
      case 'init':
        ensurePlayer(args[0] ?? 0);
        result = true;
        break;
      case 'createSurface':
        if (!createSurface) {
          throw new Error('createSurface is only available on Windows');
        }
        result = createSurface(args[0], args[1], args[2], args[3]);
        break;
      case 'moveSurface':
        if (!moveSurface) {
          throw new Error('moveSurface is only available on Windows');
        }
        moveSurface(args[0], args[1], args[2], args[3]);
        result = true;
        break;
      case 'showSurface':
        if (!showSurface) {
          throw new Error('showSurface is only available on Windows');
        }
        showSurface(args[0]);
        result = true;
        break;
      case 'destroySurface':
        teardownSurface();
        result = true;
        break;
      case 'getSurfaceHwnd':
        result = getSurfaceHwnd ? getSurfaceHwnd() : 0;
        break;
      case 'setWid':
        ensurePlayer().setWid(args[0] ?? 0);
        result = true;
        break;
      case 'reset':
        if (player) {
          player.destroy();
          player = null;
        }
        ensurePlayer(args[0] ?? 0);
        result = true;
        break;
      case 'getDiagnostics':
        result = ensurePlayer().getDiagnostics();
        break;
      case 'load':
        result = ensurePlayer().load(args[0]);
        break;
      case 'waitForLoad':
        result = ensurePlayer().waitForLoad(args[0] ?? 30000);
        break;
      case 'getLastError':
        result = ensurePlayer().getLastError();
        break;
      case 'play':
        ensurePlayer().play();
        result = true;
        break;
      case 'pause':
        ensurePlayer().pause();
        result = true;
        break;
      case 'togglePause':
        ensurePlayer().togglePause();
        result = true;
        break;
      case 'seek':
        ensurePlayer().seek(args[0]);
        result = true;
        break;
      case 'getTimePos':
        result = ensurePlayer().getTimePos();
        break;
      case 'getDuration':
        result = ensurePlayer().getDuration();
        break;
      case 'getPaused':
        result = ensurePlayer().getPaused();
        break;
      case 'getTrackList':
        result = ensurePlayer().getTrackList();
        break;
      case 'getSid':
        result = ensurePlayer().getSid();
        break;
      case 'getAid':
        result = ensurePlayer().getAid();
        break;
      case 'setSid':
        ensurePlayer().setSid(args[0]);
        result = true;
        break;
      case 'setAid':
        ensurePlayer().setAid(args[0]);
        result = true;
        break;
      case 'addSubtitle':
        result = ensurePlayer().addSubtitle(args[0]);
        break;
      case 'poll':
        result = ensurePlayer().poll();
        break;
      case 'tick':
        result = ensurePlayer().tick(args[0], args[1]);
        break;
      case 'destroy':
        if (player) {
          player.destroy();
          player = null;
        }
        teardownSurface();
        result = true;
        break;
      default:
        throw new Error(`Unknown MPV worker method: ${method}`);
    }

    if (result === undefined) {
      process.send?.({ id, ok: true });
      return;
    }

    try {
      process.send({ id, ok: true, result });
    } catch (sendError) {
      process.send?.({
        id,
        ok: false,
        error:
          sendError instanceof Error
            ? `Frame IPC failed: ${sendError.message}`
            : 'Frame IPC failed',
      });
    }
  } catch (error) {
    process.send?.({
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

process.on('message', handleMessage);

process.on('disconnect', () => {
  if (player) {
    player.destroy();
    player = null;
  }
  teardownSurface();
  process.exit(0);
});
