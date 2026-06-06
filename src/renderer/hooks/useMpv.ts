import type { MpvTrack, VideoBounds } from '../../main/preload';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 250;
const TRACK_REFRESH_MS = 2000;
const LOAD_TIMEOUT_MS = 30000;

async function waitForVideoReady(timeoutMs = LOAD_TIMEOUT_MS): Promise<boolean> {
  if (!window.vidsync) return false;

  if (window.vidsync.mpvWaitForLoad) {
    try {
      return await window.vidsync.mpvWaitForLoad(timeoutMs);
    } catch {
      // Fall through to polling when the native addon is out of date.
    }
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [duration, mpvError] = await Promise.all([
      window.vidsync.mpvGetDuration(),
      window.vidsync.mpvGetLastError?.() ?? Promise.resolve(null),
    ]);

    if (mpvError) {
      throw new Error(mpvError);
    }
    if (duration > 0) {
      return true;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 200);
    });
  }

  return false;
}

function formatTrackLabel(track: MpvTrack) {
  const parts = [track.title, track.lang].filter(Boolean);
  const meta = parts.length > 0 ? ` — ${parts.join(' · ')}` : '';
  return `Track ${track.id}${meta}`;
}

function readVideoBounds(host: HTMLElement): VideoBounds {
  const rect = host.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  return {
    x: Math.round(rect.left * scale) / scale,
    y: Math.round(rect.top * scale) / scale,
    width: Math.max(1, Math.round(rect.width * scale) / scale),
    height: Math.max(1, Math.round(rect.height * scale) / scale),
  };
}

export function useMpv(videoHostRef: React.RefObject<HTMLDivElement | null>) {
  const loopTimerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);
  const loadedFileRef = useRef<string | null>(null);
  const attachedRef = useRef(false);
  const [timePos, setTimePos] = useState(0);
  const [duration, setDuration] = useState(0);
  const [paused, setPaused] = useState(true);
  const [loadedFile, setLoadedFile] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tracks, setTracks] = useState<MpvTrack[]>([]);
  const [activeSid, setActiveSid] = useState<number | null>(null);
  const [activeAid, setActiveAid] = useState<number | null>(null);

  const syncVideoHost = useCallback(async () => {
    const host = videoHostRef.current;
    if (!host || !window.vidsync) return;

    const bounds = readVideoBounds(host);
    if (!attachedRef.current) {
      const ok = await window.vidsync.mpvAvailable(bounds);
      attachedRef.current = ok;
      if (!ok) {
        const detail = (await window.vidsync.mpvLoadError?.()) ?? 'unknown error';
        setError(`Failed to attach native MPV video window: ${detail}`);
      } else {
        setError(null);
      }
      return;
    }

    await window.vidsync.mpvAvailable(bounds, true);
  }, [videoHostRef]);

  const pollPlayback = useCallback(() => {
    if (cancelledRef.current) return;

    void (async () => {
      try {
        if (!window.vidsync) return;

        const tick = await window.vidsync.mpvTick();
        setTimePos(tick.timePos);
        setDuration(tick.duration);
        setPaused(tick.paused);
      } catch {
        // Worker may be shutting down.
      } finally {
        loopTimerRef.current = window.setTimeout(pollPlayback, POLL_MS);
      }
    })();
  }, []);

  const refreshTracks = useCallback(async () => {
    if (!window.vidsync || !loadedFileRef.current) return;
    try {
      const [list, sid, aid] = await Promise.all([
        window.vidsync.mpvGetTrackList(),
        window.vidsync.mpvGetSid(),
        window.vidsync.mpvGetAid(),
      ]);
      setTracks(list);
      setActiveSid(sid);
      setActiveAid(aid);
    } catch {
      // Worker may be shutting down.
    }
  }, []);

  useEffect(() => {
    const host = videoHostRef.current;
    if (!host) return undefined;

    let cancelled = false;

    void (async () => {
      try {
        if (!window.vidsync) {
          setError('Preload bridge missing — restart the app');
          return;
        }

        await new Promise<void>((resolve) => {
          requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
        });
        await syncVideoHost();

        const available = await window.vidsync.mpvAvailable();
        if (cancelled) return;

        if (!available) {
          attachedRef.current = false;
          const detail = (await window.vidsync.mpvLoadError?.()) ?? 'unknown error';
          setError(`MPV unavailable: ${detail}`);
          return;
        }

        attachedRef.current = true;
        setError(null);
        pollPlayback();
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to initialize MPV');
        }
      }
    })();

    let syncTimer: number | null = null;
    const scheduleSync = () => {
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      syncTimer = window.setTimeout(() => {
        syncTimer = null;
        void syncVideoHost();
      }, 16);
    };

    const observer = new ResizeObserver(scheduleSync);
    observer.observe(host);
    window.addEventListener('resize', scheduleSync);
    window.addEventListener('scroll', scheduleSync, true);

    return () => {
      cancelled = true;
      cancelledRef.current = true;
      observer.disconnect();
      window.removeEventListener('resize', scheduleSync);
      window.removeEventListener('scroll', scheduleSync, true);
      if (syncTimer !== null) window.clearTimeout(syncTimer);
      if (loopTimerRef.current !== null) {
        window.clearTimeout(loopTimerRef.current);
        loopTimerRef.current = null;
      }
    };
  }, [pollPlayback, syncVideoHost, videoHostRef]);

  useEffect(() => {
    if (!loadedFile) {
      setTracks([]);
      setActiveSid(null);
      setActiveAid(null);
      return undefined;
    }

    const refreshSoon = window.setTimeout(() => {
      void refreshTracks();
    }, 400);

    const interval = window.setInterval(() => {
      void refreshTracks();
    }, TRACK_REFRESH_MS);

    return () => {
      window.clearTimeout(refreshSoon);
      window.clearInterval(interval);
    };
  }, [loadedFile, refreshTracks]);

  const loadFile = useCallback(async (filePath: string) => {
    if (!window.vidsync) return false;

    setPendingFile(filePath);
    setError(null);

    try {
      await syncVideoHost();

      const available = await window.vidsync.mpvAvailable();
      if (!available) {
        attachedRef.current = false;
        const detail = (await window.vidsync.mpvLoadError?.()) ?? 'native MPV failed to start';
        throw new Error(
          `${detail}. Run npm run build:native and copy libmpv-2.dll into native/mpv-addon/build/Release/.`,
        );
      }

      attachedRef.current = true;
      await window.vidsync.mpvLoad(filePath);

      loadedFileRef.current = filePath;
      setLoadedFile(filePath);
      setPendingFile(null);

      const ready = await waitForVideoReady(LOAD_TIMEOUT_MS);
      if (!ready) {
        const mpvError = await window.vidsync.mpvGetLastError?.();
        setError(
          mpvError ??
            'Video did not start playing. On Windows, ensure libmpv-2.dll is next to mpv_addon.node in native/mpv-addon/build/Release/.',
        );
        return false;
      }

      setError(null);
      void refreshTracks();
      return true;
    } catch (err) {
      setPendingFile(null);
      loadedFileRef.current = filePath;
      setLoadedFile(filePath);
      setError(err instanceof Error ? err.message : 'Failed to load file');
      return false;
    }
  }, [refreshTracks, syncVideoHost]);

  const play = useCallback(async () => {
    await window.vidsync?.mpvPlay();
  }, []);
  const pause = useCallback(async () => {
    await window.vidsync?.mpvPause();
  }, []);
  const togglePause = useCallback(() => {
    void window.vidsync?.mpvTogglePause();
  }, []);
  const seek = useCallback(async (seconds: number) => {
    await window.vidsync?.mpvSeek(seconds);
  }, []);
  const getTimePos = useCallback(
    () => window.vidsync?.mpvGetTimePos() ?? Promise.resolve(0),
    [],
  );
  const getPaused = useCallback(
    () => window.vidsync?.mpvGetPaused() ?? Promise.resolve(true),
    [],
  );
  const getDuration = useCallback(
    () => window.vidsync?.mpvGetDuration() ?? Promise.resolve(0),
    [],
  );
  const forceRender = useCallback(() => {
    void syncVideoHost();
  }, [syncVideoHost]);

  const setSubtitleTrack = useCallback(async (trackId: number | 'no') => {
    if (!window.vidsync) return;
    await window.vidsync.mpvSetSid(trackId);
    setActiveSid(trackId === 'no' ? null : trackId);
    window.setTimeout(() => {
      void refreshTracks();
    }, 200);
  }, [refreshTracks]);

  const setAudioTrack = useCallback(async (trackId: number) => {
    if (!window.vidsync) return;
    await window.vidsync.mpvSetAid(trackId);
    setActiveAid(trackId);
    window.setTimeout(() => {
      void refreshTracks();
    }, 200);
  }, [refreshTracks]);

  const addSubtitleFile = useCallback(async (filePath: string) => {
    if (!window.vidsync) return false;
    try {
      const ok = await window.vidsync.mpvAddSubtitle(filePath);
      window.setTimeout(() => {
        void refreshTracks();
      }, 300);
      return ok;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load subtitle');
      return false;
    }
  }, [refreshTracks]);

  const audioTracks = tracks.filter((track) => track.type === 'audio');
  const subtitleTracks = tracks.filter((track) => track.type === 'sub');

  return {
    timePos,
    duration,
    paused,
    loadedFile,
    pendingFile,
    error,
    tracks,
    audioTracks,
    subtitleTracks,
    activeSid,
    activeAid,
    formatTrackLabel,
    loadFile,
    play,
    pause,
    togglePause,
    seek,
    getTimePos,
    getPaused,
    getDuration,
    forceRender,
    refreshTracks,
    setSubtitleTrack,
    setAudioTrack,
    addSubtitleFile,
  };
}
