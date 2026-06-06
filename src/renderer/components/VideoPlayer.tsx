import { RefObject } from 'react';
import TrackSelectors from './TrackSelectors';

interface TrackOption {
  id: number;
  label: string;
}

interface VideoPlayerProps {
  videoHostRef: RefObject<HTMLDivElement | null>;
  timePos: number;
  duration: number;
  paused: boolean;
  isHost: boolean;
  error: string | null;
  loaded: boolean;
  audioTracks: TrackOption[];
  subtitleTracks: TrackOption[];
  activeAid: number | null;
  activeSid: number | null;
  onTogglePause: () => void;
  onSeek: (time: number) => void;
  onAudioChange: (trackId: number) => void;
  onSubtitleChange: (trackId: number | 'no') => void;
  onLoadSubtitle: () => void;
}

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
  const whole = Math.floor(seconds);
  const h = Math.floor(whole / 3600);
  const m = Math.floor((whole % 3600) / 60);
  const s = whole % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VideoPlayer({
  videoHostRef,
  timePos,
  duration,
  paused,
  isHost,
  error,
  loaded,
  audioTracks,
  subtitleTracks,
  activeAid,
  activeSid,
  onTogglePause,
  onSeek,
  onAudioChange,
  onSubtitleChange,
  onLoadSubtitle,
}: VideoPlayerProps) {
  const isWin32 = window.vidsync?.platform === 'win32';

  return (
    <div className="video-shell">
      <div
        className={
          isWin32 ? 'video-canvas-wrap video-canvas-wrap--win32' : 'video-canvas-wrap'
        }
      >
        <div
          ref={videoHostRef}
          className={isWin32 ? 'video-host video-host--win32' : 'video-host'}
        />
        {error && <div className="video-error">{error}</div>}

        <div className="video-controls-overlay">
          <div className="video-controls">
            <button
              type="button"
              className="video-play-btn"
              onClick={onTogglePause}
              disabled={!isHost}
            >
              {paused ? 'Play' : 'Pause'}
            </button>

            <input
              type="range"
              min={0}
              max={Math.max(duration, 0.01)}
              step={0.1}
              value={Math.min(timePos, Math.max(duration, 0.01))}
              onInput={(e) => onSeek(Number((e.target as HTMLInputElement).value))}
              disabled={!isHost || duration <= 0}
              className="seek-bar"
            />

            <span className="time-readout">
              {formatTime(timePos)} / {formatTime(duration)}
            </span>

            {!isHost && <span className="guest-hint">Host controls playback</span>}
          </div>
        </div>
      </div>

      <TrackSelectors
        loaded={loaded}
        audioTracks={audioTracks}
        subtitleTracks={subtitleTracks}
        activeAid={activeAid}
        activeSid={activeSid}
        onAudioChange={onAudioChange}
        onSubtitleChange={onSubtitleChange}
        onLoadSubtitle={onLoadSubtitle}
      />
    </div>
  );
}
