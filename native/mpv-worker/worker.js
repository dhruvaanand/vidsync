const path = require('path');

const releaseDir =
  process.env.VIDSYNC_ADDON_ROOT ||
  path.join(__dirname, '..', 'mpv-addon', 'build', 'Release');

const { MpvPlayer } = require(path.join(releaseDir, 'mpv_addon.node'));

/** @type {import('../mpv-addon').MpvPlayer | null} */
let player = null;

function ensurePlayer(wid = 0) {
  if (!player) {
    player = new MpvPlayer(wid);
  }
  return player;
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
      case 'load':
        result = ensurePlayer().load(args[0]);
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
  process.exit(0);
});
