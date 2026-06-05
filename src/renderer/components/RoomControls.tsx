import { FormEvent } from 'react';

interface RoomControlsProps {
  serverUrl: string;
  setServerUrl: (url: string) => void;
  username: string;
  setUsername: (name: string) => void;
  roomInput: string;
  setRoomInput: (id: string) => void;
  connected: boolean;
  isHost: boolean;
  roomId: string | null;
  status: string;
  onConnect: () => void;
  onCreateRoom: () => void;
  onJoinRoom: () => void;
  onLeaveRoom: () => void;
  onOpenFile: () => void;
  loadedFile: string | null;
  hostVideoPath?: string | null;
}

export default function RoomControls({
  serverUrl,
  setServerUrl,
  username,
  setUsername,
  roomInput,
  setRoomInput,
  connected,
  isHost,
  roomId,
  status,
  onConnect,
  onCreateRoom,
  onJoinRoom,
  onLeaveRoom,
  onOpenFile,
  loadedFile,
  hostVideoPath,
}: RoomControlsProps) {
  const handleServerSubmit = (event: FormEvent) => {
    event.preventDefault();
    onConnect();
  };

  return (
    <section className="room-controls">
      <div className="brand">
        <h1>Vidsync</h1>
        <p>Watch together with native MPV playback</p>
      </div>

      <form className="control-row" onSubmit={handleServerSubmit}>
        <label>
          Server
          <input
            type="url"
            value={serverUrl}
            onChange={(e) => setServerUrl(e.target.value)}
            disabled={connected}
          />
        </label>
        <label>
          Username
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            placeholder="Your name"
          />
        </label>
        {!connected && (
          <button type="submit" className="primary">
            Connect
          </button>
        )}
      </form>

      <div className="control-row">
        <label>
          Room ID
          <input
            type="text"
            value={roomInput}
            onChange={(e) => setRoomInput(e.target.value)}
            placeholder="movie-night"
            disabled={!connected}
          />
        </label>
        {!connected ? null : (
          <>
            <button type="button" onClick={onCreateRoom} className="primary">
              Create
            </button>
            <button type="button" onClick={onJoinRoom}>
              Join
            </button>
            <button type="button" onClick={onLeaveRoom} className="danger">
              Leave
            </button>
          </>
        )}
      </div>

      <div className="control-row">
        <button type="button" onClick={onOpenFile} className="primary">
          {isHost ? 'Open Video' : 'Open Same Video'}
        </button>
        {loadedFile && (
          <span className="file-label" title={loadedFile}>
            {loadedFile.split(/[\\/]/).pop()}
          </span>
        )}
        {!isHost && hostVideoPath && !loadedFile && (
          <span className="file-label" title={hostVideoPath}>
            Host: {hostVideoPath.split(/[\\/]/).pop()}
          </span>
        )}
      </div>

      <div className="status-bar">
        <span>{status}</span>
        {connected && roomId && (
          <span className="badge">{isHost ? 'Host' : 'Guest'}</span>
        )}
      </div>
    </section>
  );
}
