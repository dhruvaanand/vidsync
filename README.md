# Vidsync

Cross-platform desktop watch party app built with Electron, React, libmpv, and Socket.io.

Vidsync lets a host open a local video file (MKV, MP4, etc.), control playback, and sync guests in real time. Everyone shares the same room chat.

## Features

- Local video playback via embedded **libmpv** (hardware decode, native subtitles)
- Host-authoritative playback sync across clients
- Automatic drift correction when clients fall behind
- Multi-track audio and subtitle selection
- Built-in room chat over Socket.io
- Second client launcher for local host/guest testing

## Platform support

| Platform | Video rendering | Notes |
|----------|-----------------|-------|
| **Windows** | Native embed (`wid`) | Recommended — full speed, child HWND over the video panel |
| **Linux (X11)** | Native embed | Generally works |
| **Linux (Wayland / Hyprland)** | Native embed | Window positioning can be unreliable |
| **macOS** | Native embed | Experimental |

Guests must have access to the **same file path** as the host (shared drive, identical path, or copy).

## Prerequisites

- **Node.js** 20+
- **libmpv** development libraries
- **Build tools** for the native addon (`python`, `make`, `g++` / MSVC)

### Linux (Debian/Ubuntu)

```bash
sudo apt install libmpv-dev pkg-config build-essential
```

### Linux (Arch)

```bash
sudo pacman -S mpv pkgconf base-devel
```

### Windows

- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) (Desktop development with C++)
- libmpv headers and import library — see [`native/mpv-addon/deps/README.md`](native/mpv-addon/deps/README.md)
- MPV runtime on `PATH` (or next to the built addon)

### macOS

```bash
brew install mpv pkg-config
```

## Quick start

```bash
git clone https://github.com/YOUR_USER/vidsync.git
cd vidsync

npm install
cd server && npm install && cd ..

# Terminal 1 — sync server (default http://localhost:3056)
npm run server

# Terminal 2 — Electron app
npm start
```

### Testing with two clients locally

Only one `npm start` can own the webpack dev server (port 3000).

```bash
# Terminal 2 — first window
npm start

# Terminal 3 — second window (after the first is up)
npm run start:client
```

## Usage

1. Start the sync server (`npm run server`).
2. Launch the app (`npm start`).
3. Set **Server** URL (default `http://localhost:3056`), enter a **Username**, click **Connect**.
4. **Create** or **Join** a room.
5. Host clicks **Open Video** and controls playback.
6. Guests open the same file when prompted; playback follows the host.
7. Chat in the sidebar.

## Architecture

```
vidsync/
├── native/
│   ├── mpv-addon/        # libmpv Node-API binding (embed + SW fallback)
│   └── mpv-worker/       # System Node worker (isolates native addon from Electron)
├── server/               # Express + Socket.io sync and chat backend
├── scripts/              # Helper scripts (second client launcher)
└── src/
    ├── main/             # Electron main process, video window, IPC
    └── renderer/         # React UI
```

**Playback path**

1. Renderer measures the `.video-host` panel and sends bounds to the main process.
2. Main process positions a frameless child `BrowserWindow` over that region.
3. The child window's native handle (`wid` / HWND) is passed to libmpv.
4. MPV renders directly into the child window — no per-frame pixel copies.

**Sync path**

- Host broadcasts `{ time, paused, updatedAt }` on play, pause, and seek.
- Server stores room state and relays events.
- Guests apply host state and correct drift beyond 500ms.

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start Electron app (dev) |
| `npm run start:client` | Launch a second client window |
| `npm run server` | Start sync server in dev mode |
| `npm run build:native` | Build libmpv native addon |
| `npm run rebuild:native` | Rebuild addon without reinstalling deps |
| `npm run package` | Package app with Electron Forge |

## Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `PORT` | `3056` | Sync server port |
| `VIDSYNC_DEV_PORT` | `3000` | Webpack dev server port |
| `VIDSYNC_NODE_PATH` | `which node` | Node binary for the MPV worker |
| `VIDSYNC_CLIENT_ID` | timestamp | Profile id for `start:client` |

## Building the native addon

```bash
npm run build:native
```

If MPV headers are not found on Windows, configure paths under `native/mpv-addon/deps/`.

## Packaging

```bash
npm run package
```

Packaged builds bundle the native addon and MPV worker under `extraResource` (see `forge.config.ts`). Target machines still need libmpv available at runtime.

## License

MIT — see [LICENSE](LICENSE).
