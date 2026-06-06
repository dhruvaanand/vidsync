#if defined(_WIN32)

#include <napi.h>

#ifndef NOMINMAX
#define NOMINMAX
#endif
#include <windows.h>

namespace {
HWND g_surface_hwnd = nullptr;
HWND g_owner_hwnd = nullptr;

void EnsureClassRegistered() {
  static bool done = false;
  if (done) return;

  WNDCLASSW wc{};
  wc.lpfnWndProc = DefWindowProcW;
  wc.hInstance = GetModuleHandleW(nullptr);
  wc.lpszClassName = L"VidsyncMpvSurface";
  wc.hbrBackground = reinterpret_cast<HBRUSH>(GetStockObject(BLACK_BRUSH));
  RegisterClassW(&wc);
  done = true;
}

uintptr_t HwndToUint(HWND hwnd) {
  return reinterpret_cast<uintptr_t>(hwnd);
}

HWND UintToHwnd(uintptr_t value) {
  return reinterpret_cast<HWND>(value);
}

bool UsesOwnedPopup() {
  return g_owner_hwnd != nullptr;
}

void RaiseSurfaceZOrder() {
  if (!g_surface_hwnd) return;
  const HWND insertAfter = UsesOwnedPopup() ? HWND_TOP : HWND_TOPMOST;
  SetWindowPos(
      g_surface_hwnd,
      insertAfter,
      0,
      0,
      0,
      0,
      SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE | SWP_SHOWWINDOW);
}
}  // namespace

Napi::Value Win32CreateSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 5) {
    Napi::TypeError::New(env, "expected ownerHwnd, x, y, width, height").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const uintptr_t ownerArg = static_cast<uintptr_t>(info[0].As<Napi::Number>().Int64Value());
  const int x = info[1].As<Napi::Number>().Int32Value();
  const int y = info[2].As<Napi::Number>().Int32Value();
  int w = info[3].As<Napi::Number>().Int32Value();
  int h = info[4].As<Napi::Number>().Int32Value();
  if (w < 1) w = 1;
  if (h < 1) h = 1;

  EnsureClassRegistered();

  if (g_surface_hwnd) {
    DestroyWindow(g_surface_hwnd);
    g_surface_hwnd = nullptr;
    g_owner_hwnd = nullptr;
  }

  g_owner_hwnd = ownerArg > 0 ? UintToHwnd(ownerArg) : nullptr;

  DWORD exStyle = WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW;
  DWORD style = WS_POPUP | WS_VISIBLE;
  HWND windowParent = nullptr;

  if (g_owner_hwnd) {
    // Owned popup: stacks above the Electron window (incl. Chromium) but not HWND_TOPMOST globally.
    windowParent = g_owner_hwnd;
  } else {
    exStyle |= WS_EX_TOPMOST;
  }

  g_surface_hwnd = CreateWindowExW(
      exStyle,
      L"VidsyncMpvSurface",
      L"",
      style,
      x,
      y,
      w,
      h,
      windowParent,
      nullptr,
      GetModuleHandleW(nullptr),
      nullptr);

  if (!g_surface_hwnd) {
    Napi::Error::New(env, "CreateWindowEx failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  ShowWindow(g_surface_hwnd, SW_SHOWNOACTIVATE);
  UpdateWindow(g_surface_hwnd);
  RaiseSurfaceZOrder();

  return Napi::Number::New(env, static_cast<double>(HwndToUint(g_surface_hwnd)));
}

Napi::Value Win32MoveSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_surface_hwnd) return env.Undefined();
  if (info.Length() < 4) {
    Napi::TypeError::New(env, "expected x, y, width, height").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int x = info[0].As<Napi::Number>().Int32Value();
  const int y = info[1].As<Napi::Number>().Int32Value();
  int w = info[2].As<Napi::Number>().Int32Value();
  int h = info[3].As<Napi::Number>().Int32Value();
  if (w < 1) w = 1;
  if (h < 1) h = 1;

  const HWND insertAfter = UsesOwnedPopup() ? HWND_TOP : HWND_TOPMOST;
  SetWindowPos(g_surface_hwnd, insertAfter, x, y, w, h, SWP_NOACTIVATE | SWP_SHOWWINDOW);

  return env.Undefined();
}

Napi::Value Win32RaiseSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  RaiseSurfaceZOrder();
  return env.Undefined();
}

Napi::Value Win32ShowSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_surface_hwnd) return env.Undefined();

  const bool visible = info.Length() < 1 || info[0].IsUndefined() || info[0].As<Napi::Boolean>().Value();
  ShowWindow(g_surface_hwnd, visible ? SW_SHOWNOACTIVATE : SW_HIDE);
  return env.Undefined();
}

Napi::Value Win32DestroySurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (g_surface_hwnd) {
    DestroyWindow(g_surface_hwnd);
    g_surface_hwnd = nullptr;
    g_owner_hwnd = nullptr;
  }
  return env.Undefined();
}

Napi::Value Win32GetSurfaceHwnd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_surface_hwnd) return Napi::Number::New(env, 0);
  return Napi::Number::New(env, static_cast<double>(HwndToUint(g_surface_hwnd)));
}

Napi::Value Win32PumpMessages(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  MSG msg{};
  while (PeekMessageW(&msg, nullptr, 0, 0, PM_REMOVE)) {
    TranslateMessage(&msg);
    DispatchMessageW(&msg);
  }
  return env.Undefined();
}

void RegisterWin32Surface(Napi::Env env, Napi::Object exports) {
  exports.Set("createSurface", Napi::Function::New(env, Win32CreateSurface));
  exports.Set("moveSurface", Napi::Function::New(env, Win32MoveSurface));
  exports.Set("raiseSurface", Napi::Function::New(env, Win32RaiseSurface));
  exports.Set("showSurface", Napi::Function::New(env, Win32ShowSurface));
  exports.Set("destroySurface", Napi::Function::New(env, Win32DestroySurface));
  exports.Set("getSurfaceHwnd", Napi::Function::New(env, Win32GetSurfaceHwnd));
  exports.Set("pumpMessages", Napi::Function::New(env, Win32PumpMessages));
}

#endif
