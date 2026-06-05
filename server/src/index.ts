import cors from 'cors';
import express from 'express';
import { createServer } from 'http';
import { Server, Socket } from 'socket.io';

const PORT = Number(process.env.PORT ?? 3056);

interface PlaybackState {
  time: number;
  paused: boolean;
  updatedAt: number;
}

interface ChatMessage {
  id: string;
  roomId: string;
  userId: string;
  username: string;
  text: string;
  timestamp: number;
}

interface Room {
  id: string;
  hostId: string;
  playback: PlaybackState;
  videoPath: string | null;
  duration: number;
  messages: ChatMessage[];
}

const rooms = new Map<string, Room>();

function getOrCreateRoom(roomId: string, hostId: string): Room {
  const existing = rooms.get(roomId);
  if (existing) return existing;

  const room: Room = {
    id: roomId,
    hostId,
    playback: { time: 0, paused: true, updatedAt: Date.now() },
    videoPath: null,
    duration: 0,
    messages: [],
  };
  rooms.set(roomId, room);
  return room;
}

function serializeRoom(room: Room) {
  return {
    id: room.id,
    hostId: room.hostId,
    playback: room.playback,
    videoPath: room.videoPath,
    duration: room.duration,
    messages: room.messages,
  };
}

const app = express();
app.use(cors());
app.get('/health', (_req, res) => {
  res.json({ ok: true, rooms: rooms.size });
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: { origin: '*' },
});

io.on('connection', (socket: Socket) => {
  let currentRoomId: string | null = null;
  let username = `user-${socket.id.slice(0, 6)}`;

  socket.on('join-room', (payload: { roomId: string; username?: string; create?: boolean }) => {
    const roomId = payload.roomId?.trim();
    if (!roomId) {
      socket.emit('error', { message: 'roomId is required' });
      return;
    }

    if (payload.username?.trim()) {
      username = payload.username.trim();
    }

    if (currentRoomId) {
      socket.leave(currentRoomId);
    }

    let room = rooms.get(roomId);
    const isNewRoom = !room;

    if (!room) {
      room = getOrCreateRoom(roomId, socket.id);
    } else if (payload.create && room.hostId !== socket.id) {
      socket.emit('error', { message: 'room already exists' });
      return;
    }

    currentRoomId = roomId;
    socket.join(roomId);

    socket.emit('room-joined', {
      room: serializeRoom(room),
      isHost: room.hostId === socket.id,
      isNewRoom,
      userId: socket.id,
      username,
    });

    socket.to(roomId).emit('user-joined', {
      userId: socket.id,
      username,
    });
  });

  socket.on('playback-state', (state: Partial<PlaybackState>) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    room.playback = {
      time: typeof state.time === 'number' ? state.time : room.playback.time,
      paused: typeof state.paused === 'boolean' ? state.paused : room.playback.paused,
      updatedAt: Date.now(),
    };

    io.to(currentRoomId).emit('playback-state', room.playback);
  });

  socket.on('video-loaded', (payload: { path?: string; duration?: number }) => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    if (!room || room.hostId !== socket.id) return;

    const path = payload.path?.trim();
    if (!path) return;

    room.videoPath = path;
    if (typeof payload.duration === 'number' && payload.duration > 0) {
      room.duration = payload.duration;
    }

    io.to(currentRoomId).emit('video-loaded', {
      path: room.videoPath,
      duration: room.duration,
    });
  });

  socket.on('chat-message', (payload: { text: string }) => {
    if (!currentRoomId) return;
    const text = payload.text?.trim();
    if (!text) return;

    const room = rooms.get(currentRoomId);
    if (!room) return;

    const message: ChatMessage = {
      id: `${socket.id}-${Date.now()}`,
      roomId: currentRoomId,
      userId: socket.id,
      username,
      text,
      timestamp: Date.now(),
    };

    room.messages.push(message);
    if (room.messages.length > 200) {
      room.messages.splice(0, room.messages.length - 200);
    }

    io.to(currentRoomId).emit('chat-message', message);
  });

  socket.on('leave-room', () => {
    if (!currentRoomId) return;
    const roomId = currentRoomId;
    socket.leave(roomId);
    socket.to(roomId).emit('user-left', { userId: socket.id, username });
    currentRoomId = null;
  });

  socket.on('disconnect', () => {
    if (!currentRoomId) return;
    const room = rooms.get(currentRoomId);
    socket.to(currentRoomId).emit('user-left', { userId: socket.id, username });

    if (room && room.hostId === socket.id) {
      const members = io.sockets.adapter.rooms.get(currentRoomId);
      const nextHost = members
        ? Array.from(members).find((id) => id !== socket.id)
        : undefined;

      if (nextHost) {
        room.hostId = nextHost;
        io.to(currentRoomId).emit('host-changed', { hostId: nextHost });
      } else {
        rooms.delete(currentRoomId);
      }
    }
  });
});

httpServer.on('error', (err: NodeJS.ErrnoException) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`\nPort ${PORT} is already in use.`);
    console.error('Another vidsync server is probably still running.');
    console.error(`Stop it with:  npm run stop`);
    console.error(`Or manually:    kill $(ss -tlnp | grep ':${PORT}' | sed -n 's/.*pid=\\([0-9]*\\).*/\\1/p')`);
    process.exit(1);
  }
  throw err;
});

httpServer.listen(PORT, () => {
  console.log(`Vidsync sync server listening on http://localhost:${PORT}`);
});
