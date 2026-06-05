# Windows libmpv dependencies

The native addon links against libmpv. On Linux and macOS, headers are resolved
via `pkg-config`. On Windows, place MPV development files here before building:

```
deps/
├── include/
│   ├── client.h
│   └── render.h
└── lib/
    └── mpv.lib   (or mpv.dll + import lib from your MPV build)
```

Then update `binding.gyp` Windows `libraries` / `include_dirs` if your layout
differs. A prebuilt MPV dev package or a local MSYS2/mpv build usually works.
