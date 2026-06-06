#if defined(_WIN32)

#include <napi.h>

#include <algorithm>
#include <windows.h>

namespace {
HWND g_surface_hwnd = nullptr;

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
}  // namespace

Napi::Value Win32CreateSurface(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 4) {
    Napi::TypeError::New(env, "expected x, y, width, height").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  const int x = info[0].As<Napi::Number>().Int32Value();
  const int y = info[1].As<Napi::Number>().Int32Value();
  const int w = std::max(1, info[2].As<Napi::Number>().Int32Value());
  const int h = std::max(1, info[3].As<Napi::Number>().Int32Value());

  EnsureClassRegistered();

  if (g_surface_hwnd) {
    DestroyWindow(g_surface_hwnd);
    g_surface_hwnd = nullptr;
  }

  g_surface_hwnd = CreateWindowExW(
      WS_EX_TOPMOST | WS_EX_NOACTIVATE | WS_EX_TOOLWINDOW,
      L"VidsyncMpvSurface",
      L"",
      WS_POPUP | WS_VISIBLE,
      x,
      y,
      w,
      h,
      nullptr,
      nullptr,
      GetModuleHandleW(nullptr),
      nullptr);

  if (!g_surface_hwnd) {
    Napi::Error::New(env, "CreateWindowEx failed").ThrowAsJavaScriptException();
    return env.Undefined();
  }

  ShowWindow(g_surface_hwnd, SW_SHOWNOACTIVATE);
  UpdateWindow(g_surface_hwnd);

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
  const int w = std::max(1, info[2].As<Napi::Number>().Int32Value());
  const int h = std::max(1, info[3].As<Napi::Number>().Int32Value());

  SetWindowPos(
      g_surface_hwnd,
      HWND_TOPMOST,
      x,
      y,
      w,
      h,
      SWP_NOACTIVATE | SWP_SHOWWINDOW);

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
  }
  return env.Undefined();
}

Napi::Value Win32GetSurfaceHwnd(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (!g_surface_hwnd) return Napi::Number::New(env, 0);
  return Napi::Number::New(env, static_cast<double>(HwndToUint(g_surface_hwnd)));
}

void RegisterWin32Surface(Napi::Env env, Napi::Object exports) {
  exports.Set("createSurface", Napi::Function::New(env, Win32CreateSurface));
  exports.Set("moveSurface", Napi::Function::New(env, Win32MoveSurface));
  exports.Set("showSurface", Napi::Function::New(env, Win32ShowSurface));
  exports.Set("destroySurface", Napi::Function::New(env, Win32DestroySurface));
  exports.Set("getSurfaceHwnd", Napi::Function::New(env, Win32GetSurfaceHwnd));
}

#endif
