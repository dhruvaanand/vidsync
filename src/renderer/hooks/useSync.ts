import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChatMessage,
  PlaybackState,
  RoomJoinedPayload,
  SyncClient,
  VideoLoadedPayload,
} from '../lib/syncClient';

const DRIFT_THRESHOLD_MS = 500;
const DRIFT_CHECK_INTERVAL_MS = 100;
const DEFAULT_SERVER = 'http://localhost:3056';

interface UseSyncOptions {
  onApplyPlayback: (state: PlaybackState) => void;
  onVideoLoaded?: (payload: VideoLoadedPayload) => void;
  getLocalPlayback: () => { time: number; paused: boolean; hasVideo: boolean };
}

export function useSync({
  onApplyPlayback,
  onVideoLoaded,
  getLocalPlayback,
}: UseSyncOptions) {
  const clientRef = useRef(new SyncClient());
  const [connected, setConnected] = useState(false);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [isRoomHost, setIsRoomHost] = useState(false);
  const [userId, setUserId] = useState<string | null>(null);
  const [username, setUsername] = useState('viewer');
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [hostPlayback, setHostPlayback] = useState<PlaybackState | null>(null);
  const [hostVideoPath, setHostVideoPath] = useState<string | null>(null);
  const [hostDuration, setHostDuration] = useState(0);
  const [serverUrl, setServerUrl] = useState(DEFAULT_SERVER);
  const [status, setStatus] = useState('Disconnected');
  const hostPlaybackRef = useRef<PlaybackState | null>(null);
  const isRoomHostRef = useRef(false);
  const userIdRef = useRef<string | null>(null);
  const connectedRef = useRef(false);

  useEffect(() => {
    hostPlaybackRef.current = hostPlayback;
  }, [hostPlayback]);

  useEffect(() => {
    isRoomHostRef.current = isRoomHost;
  }, [isRoomHost]);

  useEffect(() => {
    userIdRef.current = userId;
  }, [userId]);

  useEffect(() => {
    connectedRef.current = connected;
  }, [connected]);

  const connect = useCallback(
    (url: string, name: string) => {
      setUsername(name);
      clientRef.current.connect(url, {
        onSocketConnect: () => {
          setConnected(true);
          setStatus('Connected — create or join a room');
        },
        onSocketDisconnect: () => {
          setConnected(false);
          setRoomId(null);
          setIsRoomHost(false);
          setMessages([]);
          setHostPlayback(null);
          setHostVideoPath(null);
          setHostDuration(0);
          setStatus('Disconnected');
        },
        onConnectError: (message: string) => {
          setConnected(false);
          setStatus(`Connection failed: ${message}`);
        },
        onRoomJoined: (payload: RoomJoinedPayload) => {
          setConnected(true);
          setRoomId(payload.room.id);
          setIsRoomHost(payload.isHost);
          setUserId(payload.userId);
          setMessages(payload.room.messages);
          setHostPlayback(payload.room.playback);
          setHostVideoPath(payload.room.videoPath);
          setHostDuration(payload.room.duration);
          if (!payload.isHost && payload.room.videoPath) {
            onVideoLoaded?.({
              path: payload.room.videoPath,
              duration: payload.room.duration,
            });
          }
          setStatus(
            payload.isHost
              ? `Hosting room ${payload.room.id}`
              : `Joined room ${payload.room.id}`,
          );
          if (!payload.isHost) {
            onApplyPlayback(payload.room.playback);
          }
        },
        onPlaybackState: (state: PlaybackState) => {
          setHostPlayback(state);
          if (!isRoomHostRef.current) {
            onApplyPlayback(state);
          }
        },
        onVideoLoaded: (payload: VideoLoadedPayload) => {
          setHostVideoPath(payload.path);
          setHostDuration(payload.duration);
          if (!isRoomHostRef.current) {
            onVideoLoaded?.(payload);
          }
        },
        onChatMessage: (message: ChatMessage) => {
          setMessages((prev) => [...prev, message]);
        },
        onHostChanged: (hostId: string) => {
          const nowHost = hostId === userIdRef.current;
          setIsRoomHost(nowHost);
          setStatus(nowHost ? 'You are now the host' : 'Host changed');
        },
        onError: (message: string) => setStatus(`Error: ${message}`),
      });
      setServerUrl(url);
      setStatus('Connecting...');
    },
    [onApplyPlayback, onVideoLoaded],
  );

  const joinRoom = useCallback(
    (id: string, create = false) => {
      if (!username.trim()) return;
      clientRef.current.joinRoom(id.trim(), username.trim(), create);
    },
    [username],
  );

  const leaveRoom = useCallback(() => {
    clientRef.current.leaveRoom();
    setRoomId(null);
    setIsRoomHost(false);
    setMessages([]);
    setHostPlayback(null);
    setHostVideoPath(null);
    setHostDuration(0);
    setStatus('Connected — create or join a room');
  }, []);

  const broadcastPlayback = useCallback((state: Partial<PlaybackState>) => {
    if (!isRoomHostRef.current) return;
    const next: PlaybackState = {
      time: state.time ?? hostPlaybackRef.current?.time ?? 0,
      paused: state.paused ?? hostPlaybackRef.current?.paused ?? true,
      updatedAt: Date.now(),
    };
    clientRef.current.broadcastPlayback(next);
    setHostPlayback(next);
  }, []);

  const broadcastVideoLoaded = useCallback((path: string, duration: number) => {
    if (!isRoomHostRef.current) return;
    clientRef.current.broadcastVideoLoaded(path, duration);
    setHostVideoPath(path);
    setHostDuration(duration);
  }, []);

  const sendMessage = useCallback((text: string) => {
    clientRef.current.sendChat(text);
  }, []);

  useEffect(() => {
    const interval = window.setInterval(() => {
      if (!connectedRef.current || isRoomHostRef.current) return;

      const hostState = hostPlaybackRef.current;
      if (!hostState || hostState.paused) return;

      const local = getLocalPlayback();
      if (!local.hasVideo) return;

      const expectedTime =
        hostState.time + (Date.now() - hostState.updatedAt) / 1000;
      const driftMs = Math.abs(local.time - expectedTime) * 1000;

      if (driftMs > DRIFT_THRESHOLD_MS) {
        onApplyPlayback({
          time: expectedTime,
          paused: hostState.paused,
          updatedAt: hostState.updatedAt,
        });
      }
    }, DRIFT_CHECK_INTERVAL_MS);

    return () => window.clearInterval(interval);
  }, [getLocalPlayback, onApplyPlayback]);

  useEffect(() => () => clientRef.current.disconnect(), []);

  return {
    connected,
    roomId,
    isRoomHost,
    userId,
    username,
    setUsername,
    messages,
    hostPlayback,
    hostVideoPath,
    hostDuration,
    serverUrl,
    setServerUrl,
    status,
    connect,
    joinRoom,
    leaveRoom,
    broadcastPlayback,
    broadcastVideoLoaded,
    sendMessage,
  };
}
