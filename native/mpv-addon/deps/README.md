# Windows libmpv dependencies

The native addon links against libmpv. On Linux and macOS, headers are resolved
via `pkg-config`. On Windows, place MPV development files here before running
`npm run build:native`.

## Required layout

Headers must match `#include <mpv/client.h>`:

```
deps/
├── include/
│   └── mpv/
│       ├── client.h
│       └── render.h
└── lib/
    └── mpv.lib
```

## MSYS2 (recommended)

In the **UCRT64** terminal:

```bash
pacman -S mingw-w64-ucrt-x86_64-mpv
```

Copy into this folder from PowerShell (adjust `C:\msys64` if needed):

```powershell
$msys = "C:\msys64\ucrt64"
New-Item -ItemType Directory -Force native\mpv-addon\deps\include\mpv, native\mpv-addon\deps\lib
Copy-Item "$msys\include\mpv\*.h" native\mpv-addon\deps\include\mpv\
Copy-Item "$msys\lib\libmpv.dll.a" native\mpv-addon\deps\lib\mpv.lib
```

After building the addon, copy the runtime DLL:

```powershell
copy C:\msys64\ucrt64\bin\libmpv-2.dll native\mpv-addon\build\Release\
```

## Custom layout

If your MPV SDK uses different paths, update the `OS=='win'` section in
[`binding.gyp`](../binding.gyp) (`include_dirs`, `library_dirs`, `libraries`).
