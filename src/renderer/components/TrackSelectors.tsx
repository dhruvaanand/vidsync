interface TrackOption {
  id: number;
  label: string;
}

interface TrackSelectorsProps {
  loaded: boolean;
  audioTracks: TrackOption[];
  subtitleTracks: TrackOption[];
  activeAid: number | null;
  activeSid: number | null;
  onAudioChange: (trackId: number) => void;
  onSubtitleChange: (trackId: number | 'no') => void;
  onLoadSubtitle: () => void;
}

export default function TrackSelectors({
  loaded,
  audioTracks,
  subtitleTracks,
  activeAid,
  activeSid,
  onAudioChange,
  onSubtitleChange,
  onLoadSubtitle,
}: TrackSelectorsProps) {
  return (
    <div className="track-selectors">
      <span className="track-selectors-label">Tracks</span>

      <label>
        Audio
        <select
          value={activeAid ?? ''}
          onChange={(e) => {
            const id = Number(e.target.value);
            if (Number.isFinite(id)) onAudioChange(id);
          }}
          disabled={!loaded || audioTracks.length === 0}
        >
          {!loaded ? (
            <option value="">Open a video first</option>
          ) : audioTracks.length === 0 ? (
            <option value="">No audio tracks</option>
          ) : (
            audioTracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.label}
              </option>
            ))
          )}
        </select>
      </label>

      <label>
        Subtitles
        <select
          value={activeSid ?? 'no'}
          onChange={(e) => {
            const value = e.target.value;
            if (value === 'no') {
              onSubtitleChange('no');
              return;
            }
            const id = Number(value);
            if (Number.isFinite(id)) onSubtitleChange(id);
          }}
          disabled={!loaded}
        >
          <option value="no">Off</option>
          {subtitleTracks.map((track) => (
            <option key={track.id} value={track.id}>
              {track.label}
            </option>
          ))}
        </select>
      </label>

      <button type="button" onClick={onLoadSubtitle} disabled={!loaded}>
        Load Subtitle File
      </button>
    </div>
  );
}
