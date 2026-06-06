{
  "targets": [
    {
      "target_name": "mpv_electron_shim",
      "type": "none",
      "conditions": [
        [
          "OS=='linux'",
          {
            "type": "shared_library",
            "sources": ["src/mpv_shim.cpp"],
            "libraries": ["-Wl,--no-as-needed", "-lvulkan", "<!@(pkg-config --libs mpv)"]
          }
        ]
      ]
    },
    {
      "target_name": "vulkan_preload",
      "type": "none",
      "conditions": [
        [
          "OS=='linux'",
          {
            "type": "loadable_module",
            "sources": ["src/vulkan_preload.cpp"],
            "include_dirs": [
              "<!@(node -p \"require('node-addon-api').include\")"
            ],
            "cflags!": ["-fno-exceptions"],
            "cflags_cc!": ["-fno-exceptions"],
            "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
          }
        ]
      ]
    },
    {
      "target_name": "mpv_addon",
      "sources": ["src/mpv_player.cpp"],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "cflags!": ["-fno-exceptions"],
      "cflags_cc!": ["-fno-exceptions"],
      "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"],
      "conditions": [
        [
          "OS=='win'",
          {
            "sources+": ["src/win32_surface.cpp"],
            "include_dirs": ["<(module_root_dir)/deps/include"],
            "library_dirs": ["<(module_root_dir)/deps/lib"],
            "libraries": ["mpv.lib"]
          }
        ],
        [
          "OS=='linux'",
          {
            "dependencies": ["mpv_electron_shim"],
            "libraries": [
              "-Wl,-rpath,$ORIGIN",
              '<(PRODUCT_DIR)/mpv_electron_shim.so'
            ],
            "cflags": ["<!@(pkg-config --cflags mpv)"]
          }
        ],
        [
          "OS=='mac'",
          {
            "libraries": ["<!@(pkg-config --libs mpv 2>/dev/null || echo -lmpv)"],
            "cflags": ["<!@(pkg-config --cflags mpv 2>/dev/null)"]
          }
        ]
      ]
    }
  ]
}
