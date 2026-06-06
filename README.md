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
| **macOS** | Native embed | Same approach as Windows; less battle-tested |
| **Linux (X11)** | Native embed | Generally works |
| **Linux (Wayland / Hyprland)** | Native embed | Window positioning can be unreliable |

Guests must have access to the **same file path** as the host (shared drive, identical path, or copy).

---

## Getting started on Windows

### 1. Install prerequisites

| Tool | Install |
|------|---------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org/) (LTS) |
| **Git** | [git-scm.com](https://git-scm.com/) |
| **Visual Studio Build Tools** | [Build Tools for Visual Studio](https://visualstudio.microsoft.com/visual-cpp-build-tools/) — select **Desktop development with C++** |
| **Python 3.11+** | [python.org](https://www.python.org/downloads/) — check **“Add python.exe to PATH”** during install (`node-gyp` requires it) |

Verify in PowerShell:

```powershell
node -v
npm -v
python --version
```

If `python` opens the Microsoft Store or says “not found”, install Python from python.org (not the Store stub). Optionally disable the Store alias: **Settings → Apps → Advanced app settings → App execution aliases** → turn off `python.exe` / `python3.exe`.

Point npm at your Python install if needed:

```powershell
npm config set python "C:\Users\dhruv\AppData\Local\Programs\Python\Python312\python.exe"
```

Use Node.js **20 LTS** if you hit other toolchain issues (you have Node 24, which is very new).

### 2. Set up libmpv dev files

Windows does not use `pkg-config`. Place MPV headers and an import library here before building:

```
native/mpv-addon/deps/
├── include/
│   └── mpv/
│       ├── client.h
│       └── render.h
└── lib/
    └── mpv.lib
```

**Option A — MSYS2 (recommended)**

1. Install [MSYS2](https://www.msys2.org/)
2. In the **UCRT64** terminal:

   ```bash
   pacman -S mingw-w64-ucrt-x86_64-mpv
   ```

3. Copy files into the repo (adjust the MSYS2 install path if needed):

   ```powershell
   # From PowerShell in the vidsync repo root
   $msys = "C:\msys64\ucrt64"
   New-Item -ItemType Directory -Force native\mpv-addon\deps\include\mpv, native\mpv-addon\deps\lib
   Copy-Item "$msys\include\mpv\*.h" native\mpv-addon\deps\include\mpv\
   Copy-Item "$msys\lib\libmpv.dll.a" native\mpv-addon\deps\lib\mpv.lib
   ```

See [`native/mpv-addon/deps/README.md`](native/mpv-addon/deps/README.md) for details.

### 3. Clone and install dependencies

```powershell
git clone https://github.com/YOUR_USER/vidsync.git
cd vidsync

npm install
cd server
npm install
cd ..
```

### 4. Build the native addon

Run from **PowerShell** or **x64 Native Tools Command Prompt for VS**:

```powershell
npm run build:native
```

Confirm the addon was built:

```powershell
dir native\mpv-addon\build\Release\mpv_addon.node
```

Copy the MPV runtime DLL next to the addon (required at runtime):

```powershell
copy C:\msys64\ucrt64\bin\libmpv-2.dll native\mpv-addon\build\Release\
```

### 5. Run Vidsync

Open **two terminals** in the project folder.

**Terminal 1 — sync server**

```powershell
npm run server
```

Wait for: `Vidsync sync server listening on http://localhost:3056`

**Terminal 2 — app**

```powershell
npm start
```

The Vidsync window should open. Video plays in the black panel with native full-speed playback.

### 6. Test host + guest on one PC

```powershell
# Terminal 2 — first window (already running after npm start)
npm start

# Terminal 3 — second window (after the first is fully open)
npm run start:client
```

Connect both clients to `http://localhost:3056`, join the same room. The guest must open the **same file path** as the host (e.g. `D:\Movies\film.mkv`).

### Windows troubleshooting

| Problem | Fix |
|---------|-----|
| `Could not find Visual Studio` / `unknown version "undefined"` at `...\18\BuildTools` | **VS 2025/2026 (v18) is too new for node-gyp.** Install [VS 2022 Build Tools](https://aka.ms/vs/17/release/vs_BuildTools.exe) with **Desktop development with C++**, then `npm config set msvs_version 2022` and rebuild from **x64 Native Tools Command Prompt for VS 2022** |
| `Could not find any Python installation` / `Python was not found` | Install Python 3.11+ from python.org with **Add to PATH**, then `npm config set python "C:\...\python.exe"` |
| `'true' is not recognized` | Fixed in `package.json` — pull latest, or ignore (harmless after native build is fixed) |
| `postinstall` succeeded but no `mpv_addon.node` | Run `npm run build:native` manually and read the full error |
| `mpv/client.h` not found during build | Copy headers to `native/mpv-addon/deps/include/mpv/` (see MSYS2 steps above) |
| `dlfcn.h` not found | Pull latest repo — Linux-only targets are now skipped on Windows |
| Link error for `mpv.lib` | Put the import lib in `native/mpv-addon/deps/lib/` |
| App opens but no video | Copy `libmpv-2.dll` into `native/mpv-addon/build/Release/` |
| `The specified module could not be found` loading `mpv_addon.node` | `libmpv-2.dll` needs MSYS2/ffmpeg DLLs — install MSYS2 mpv; Vidsync adds `C:\msys64\ucrt64\bin` to the worker PATH automatically. Test with `npm run test:mpv` |
| MPV worker failed to start | Run `where node` — if missing, install Node or set `VIDSYNC_NODE_PATH` |

```powershell
$env:VIDSYNC_NODE_PATH = "C:\Program Files\nodejs\node.exe"
npm start
```

---

## Getting started on macOS

### 1. Install prerequisites

| Tool | Install |
|------|---------|
| **Node.js 20+** | [nodejs.org](https://nodejs.org/) or `brew install node` |
| **Homebrew** | [brew.sh](https://brew.sh/) |
| **Xcode Command Line Tools** | `xcode-select --install` |

Install libmpv and build tooling:

```bash
brew install mpv pkg-config
xcode-select --install   # skip if already installed
```

Verify:

```bash
node -v
npm -v
pkg-config --modversion mpv
```

### 2. Clone and install dependencies

```bash
git clone https://github.com/YOUR_USER/vidsync.git
cd vidsync

npm install
cd server && npm install && cd ..
```

`npm install` runs `build:native` automatically. If it fails, build manually:

```bash
npm run build:native
```

Confirm the addon exists:

```bash
ls native/mpv-addon/build/Release/mpv_addon.node
```

Homebrew's `mpv` dylib is usually found automatically via `pkg-config`. If the app reports MPV unavailable at runtime, ensure `brew` is on your `PATH` and `mpv` is installed for your architecture (Apple Silicon vs Intel).

### 3. Run Vidsync

Open **two terminals** in the project folder.

**Terminal 1 — sync server**

```bash
npm run server
```

Wait for: `Vidsync sync server listening on http://localhost:3056`

**Terminal 2 — app**

```bash
npm start
```

### 4. Test host + guest on one Mac

```bash
# Terminal 2 — first window
npm start

# Terminal 3 — second window (after the first is fully open)
npm run start:client
```

### macOS troubleshooting

| Problem | Fix |
|---------|-----|
| `pkg-config: mpv not found` | `brew install mpv pkg-config` |
| Native build fails | `xcode-select --install`, then `npm run rebuild:native` |
| Video panel misaligned on Retina | Resize the window once; bounds should resync |
| MPV worker failed to start | `which node` — or set `VIDSYNC_NODE_PATH` |

```bash
export VIDSYNC_NODE_PATH="$(which node)"
npm start
```

---

## Getting started on Linux

### Prerequisites

**Debian / Ubuntu**

```bash
sudo apt install libmpv-dev pkg-config build-essential
```

**Arch**

```bash
sudo pacman -S mpv pkgconf base-devel
```

### Run

```bash
git clone https://github.com/YOUR_USER/vidsync.git
cd vidsync
npm install
cd server && npm install && cd ..

# Terminal 1
npm run server

# Terminal 2
npm start
```

On Wayland compositors (e.g. Hyprland), native video window positioning may be unreliable.

---

## Usage

1. Start the sync server (`npm run server`).
2. Launch the app (`npm start`).
3. Set **Server** URL (default `http://localhost:3056`), enter a **Username**, click **Connect**.
4. **Create** or **Join** a room.
5. Host clicks **Open Video** and controls playback.
6. Guests open the same file when prompted; playback follows the host.
7. Chat in the sidebar.

---

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
3. The child window's native handle (`wid` / HWND / NSView) is passed to libmpv.
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
| `VIDSYNC_NODE_PATH` | auto-detected | Node binary for the MPV worker (`where node` on Windows, `which node` elsewhere) |
| `VIDSYNC_CLIENT_ID` | timestamp | Profile id for `start:client` |

## Packaging

```bash
npm run package
```

Packaged builds bundle the native addon and MPV worker under `extraResource` (see `forge.config.ts`). Target machines still need libmpv available at runtime.

## License

MIT — see [LICENSE](LICENSE).
