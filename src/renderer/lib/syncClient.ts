import { io, Socket } from 'socket.io-client';

export interface PlaybackState {
  time: number;
  paused: boolean;
  updatedAt: number;
}

export interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

export interface VideoLoadedPayload {
  path: string;
  duration: number;
}

export interface RoomJoinedPayload {
  room: {
    id: string;
    hostId: string;
    playback: PlaybackState;
    videoPath: string | null;
    duration: number;
    messages: ChatMessage[];
  };
  isHost: boolean;
  isNewRoom: boolean;
  userId: string;
  username: string;
}

export function extrapolatePlayback(state: PlaybackState | null): number {
  if (!state) return 0;
  if (state.paused) return state.time;
  return state.time + (Date.now() - state.updatedAt) / 1000;
}

type SyncHandlers = {
  onSocketConnect?: () => void;
  onSocketDisconnect?: () => void;
  onConnectError?: (message: string) => void;
  onRoomJoined?: (payload: RoomJoinedPayload) => void;
  onPlaybackState?: (state: PlaybackState) => void;
  onVideoLoaded?: (payload: VideoLoadedPayload) => void;
  onChatMessage?: (message: ChatMessage) => void;
  onHostChanged?: (hostId: string) => void;
  onUserJoined?: (payload: { userId: string; username: string }) => void;
  onUserLeft?: (payload: { userId: string; username: string }) => void;
  onError?: (message: string) => void;
};

export class SyncClient {
  private socket: Socket | null = null;
  private handlers: SyncHandlers = {};

  connect(serverUrl: string, handlers: SyncHandlers) {
    this.disconnect();
    this.handlers = handlers;
    this.socket = io(serverUrl, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionAttempts: 5,
      timeout: 10000,
    });

    this.socket.on('connect', () => {
      this.handlers.onSocketConnect?.();
    });

    this.socket.on('disconnect', () => {
      this.handlers.onSocketDisconnect?.();
    });

    this.socket.on('connect_error', (error: Error) => {
      this.handlers.onConnectError?.(error.message);
    });

    this.socket.on('room-joined', (payload: RoomJoinedPayload) => {
      this.handlers.onRoomJoined?.(payload);
    });

    this.socket.on('playback-state', (state: PlaybackState) => {
      this.handlers.onPlaybackState?.(state);
    });

    this.socket.on('video-loaded', (payload: VideoLoadedPayload) => {
      this.handlers.onVideoLoaded?.(payload);
    });

    this.socket.on('chat-message', (message: ChatMessage) => {
      this.handlers.onChatMessage?.(message);
    });

    this.socket.on('host-changed', ({ hostId }: { hostId: string }) => {
      this.handlers.onHostChanged?.(hostId);
    });

    this.socket.on('user-joined', (payload) => {
      this.handlers.onUserJoined?.(payload);
    });

    this.socket.on('user-left', (payload) => {
      this.handlers.onUserLeft?.(payload);
    });

    this.socket.on('error', ({ message }: { message: string }) => {
      this.handlers.onError?.(message);
    });
  }

  joinRoom(roomId: string, username: string, create = false) {
    this.socket?.emit('join-room', { roomId, username, create });
  }

  leaveRoom() {
    this.socket?.emit('leave-room');
  }

  broadcastPlayback(state: Partial<PlaybackState>) {
    this.socket?.emit('playback-state', state);
  }

  broadcastVideoLoaded(path: string, duration: number) {
    this.socket?.emit('video-loaded', { path, duration });
  }

  sendChat(text: string) {
    this.socket?.emit('chat-message', { text });
  }

  disconnect() {
    if (this.socket) {
      this.socket.removeAllListeners();
      this.socket.disconnect();
      this.socket = null;
    }
  }
}
