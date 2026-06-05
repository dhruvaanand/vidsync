import { useCallback, useEffect, useRef, useState } from 'react';
import ChatSidebar from './components/ChatSidebar';
import RoomControls from './components/RoomControls';
import VideoPlayer from './components/VideoPlayer';
import { useMpv } from './hooks/useMpv';
import { useSync } from './hooks/useSync';
import {
  extrapolatePlayback,
  type PlaybackState,
  type VideoLoadedPayload,
} from './lib/syncClient';

export default function App() {
  const videoHostRef = useRef<HTMLDivElement>(null);
  const [roomInput, setRoomInput] = useState('movie-night');
  const applyingRemoteRef = useRef(false);
  const loadedFileRef = useRef<string | null>(null);
  const pendingPlaybackRef = useRef<PlaybackState | null>(null);
  const hostPlaybackRef = useRef<PlaybackState | null>(null);
  const [guestDisplayTime, setGuestDisplayTime] = useState(0);

  const mpv = useMpv(videoHostRef);

  useEffect(() => {
    loadedFileRef.current = mpv.loadedFile;
  }, [mpv.loadedFile]);

  const applyRemotePlayback = useCallback(
    async (state: PlaybackState) => {
      if (!loadedFileRef.current) {
        pendingPlaybackRef.current = state;
        return;
      }

      applyingRemoteRef.current = true;
      try {
        await mpv.seek(state.time);
        if (state.paused) {
          await mpv.pause();
        } else {
          await mpv.play();
        }
        mpv.forceRender();
      } finally {
        window.setTimeout(() => {
          applyingRemoteRef.current = false;
        }, 100);
      }
    },
    [mpv],
  );

  const loadGuestVideo = useCallback(
    async (payload: VideoLoadedPayload) => {
      if (loadedFileRef.current === payload.path) {
        if (pendingPlaybackRef.current) {
          await applyRemotePlayback(pendingPlaybackRef.current);
          pendingPlaybackRef.current = null;
        }
        return;
      }

      const ok = await mpv.loadFile(payload.path);
      if (!ok) {
        mpv.forceRender();
        return;
      }

      mpv.forceRender();
      const playback =
        pendingPlaybackRef.current ?? hostPlaybackRef.current;
      pendingPlaybackRef.current = null;
      if (playback) {
        await applyRemotePlayback(playback);
      }
    },
    [applyRemotePlayback, mpv],
  );

  const getLocalPlayback = useCallback(
    () => ({
      time: mpv.timePos,
      paused: mpv.paused,
      hasVideo: loadedFileRef.current !== null,
    }),
    [mpv.timePos, mpv.paused],
  );

  const sync = useSync({
    onApplyPlayback: (state) => {
      void applyRemotePlayback(state);
    },
    onVideoLoaded: (payload) => {
      void loadGuestVideo(payload);
    },
    getLocalPlayback,
  });

  useEffect(() => {
    hostPlaybackRef.current = sync.hostPlayback;
  }, [sync.hostPlayback]);

  useEffect(() => {
    if (sync.isRoomHost || !sync.hostPlayback) {
      setGuestDisplayTime(0);
      return undefined;
    }

    const update = () => {
      setGuestDisplayTime(extrapolatePlayback(sync.hostPlayback));
    };

    update();
    const interval = window.setInterval(update, 100);
    return () => window.clearInterval(interval);
  }, [sync.isRoomHost, sync.hostPlayback]);

  const broadcastIfHost = useCallback(
    (partial: Partial<PlaybackState>) => {
      if (!sync.isRoomHost || applyingRemoteRef.current) return;
      sync.broadcastPlayback({
        time: partial.time ?? mpv.timePos,
        paused: partial.paused ?? mpv.paused,
        updatedAt: Date.now(),
      });
    },
    [mpv.timePos, mpv.paused, sync],
  );

  const handleOpenFile = useCallback(async () => {
    const filePath = await window.vidsync.openVideoDialog();
    if (!filePath) return;

    const ok = await mpv.loadFile(filePath);
    if (!ok) return;

    mpv.forceRender();

    const duration = await mpv.getDuration();
    if (sync.isRoomHost && sync.roomId) {
      sync.broadcastVideoLoaded(filePath, duration);
      broadcastIfHost({ time: 0, paused: true });
    }
  }, [broadcastIfHost, mpv, sync]);

  const handleTogglePause = useCallback(() => {
    if (!sync.isRoomHost) return;
    mpv.togglePause();
    broadcastIfHost({ paused: !mpv.paused });
  }, [broadcastIfHost, mpv.paused, mpv, sync.isRoomHost]);

  const handleSeek = useCallback(
    (time: number) => {
      if (!sync.isRoomHost) return;
      mpv.seek(time);
      broadcastIfHost({ time });
    },
    [broadcastIfHost, mpv, sync.isRoomHost],
  );

  const handleLoadSubtitle = useCallback(async () => {
    const filePath = await window.vidsync?.openSubtitleDialog();
    if (!filePath) return;
    await mpv.addSubtitleFile(filePath);
    mpv.forceRender();
  }, [mpv]);

  const isGuestInRoom = sync.connected && sync.roomId !== null && !sync.isRoomHost;
  const displayTime = isGuestInRoom ? guestDisplayTime : mpv.timePos;
  const displayDuration = Math.max(mpv.duration, sync.hostDuration, 0.01);
  const displayPaused = isGuestInRoom
    ? (sync.hostPlayback?.paused ?? true)
    : mpv.paused;
  const guestVideoHint =
    isGuestInRoom && sync.hostVideoPath && !mpv.loadedFile
      ? `Waiting for video: ${sync.hostVideoPath.split(/[\\/]/).pop()} — use Open Video if it does not load automatically`
      : null;

  return (
    <div className="app">
      <main className="main-panel">
        <RoomControls
          serverUrl={sync.serverUrl}
          setServerUrl={sync.setServerUrl}
          username={sync.username}
          setUsername={sync.setUsername}
          roomInput={roomInput}
          setRoomInput={setRoomInput}
          connected={sync.connected}
          isHost={sync.isRoomHost}
          roomId={sync.roomId}
          status={sync.status}
          onConnect={() => sync.connect(sync.serverUrl, sync.username)}
          onCreateRoom={() => sync.joinRoom(roomInput, true)}
          onJoinRoom={() => sync.joinRoom(roomInput, false)}
          onLeaveRoom={sync.leaveRoom}
          onOpenFile={handleOpenFile}
          loadedFile={mpv.loadedFile}
          hostVideoPath={sync.hostVideoPath}
        />

        <VideoPlayer
          videoHostRef={videoHostRef}
          timePos={displayTime}
          duration={displayDuration}
          paused={displayPaused}
          isHost={sync.isRoomHost || !sync.connected}
          error={mpv.error ?? guestVideoHint}
          loaded={mpv.loadedFile !== null}
          audioTracks={mpv.audioTracks.map((track) => ({
            id: track.id,
            label: mpv.formatTrackLabel(track),
          }))}
          subtitleTracks={mpv.subtitleTracks.map((track) => ({
            id: track.id,
            label: mpv.formatTrackLabel(track),
          }))}
          activeAid={mpv.activeAid}
          activeSid={mpv.activeSid}
          onTogglePause={handleTogglePause}
          onSeek={handleSeek}
          onAudioChange={(trackId) => {
            void mpv.setAudioTrack(trackId);
          }}
          onSubtitleChange={(trackId) => {
            void mpv.setSubtitleTrack(trackId);
          }}
          onLoadSubtitle={() => {
            void handleLoadSubtitle();
          }}
        />
      </main>

      <ChatSidebar
        messages={sync.messages}
        inRoom={sync.roomId !== null}
        onSend={sync.sendMessage}
      />
    </div>
  );
}
