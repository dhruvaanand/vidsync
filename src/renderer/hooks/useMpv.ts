import type { MpvTrack, VideoBounds } from '../../main/preload';
import { useCallback, useEffect, useRef, useState } from 'react';

const POLL_MS = 250;
const TRACK_REFRESH_MS = 2000;

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
        setError('Failed to attach native MPV video window — restart the app (Ctrl+C, npm start)');
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
          const detail = (await window.vidsync.mpvLoadError?.()) ?? 'unknown error';
          setError(`MPV unavailable: ${detail}`);
          return;
        }

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
    try {
      await syncVideoHost();
      await window.vidsync.mpvLoad(filePath);
      loadedFileRef.current = filePath;
      setLoadedFile(filePath);
      setError(null);
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load file');
      return false;
    }
  }, [syncVideoHost]);

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
