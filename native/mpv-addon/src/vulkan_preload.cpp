#include <dlfcn.h>

#include <napi.h>

// Load libvulkan into the global symbol table before mpv_addon.node pulls in
// libmpv.so. Electron's dlopen path does not resolve libmpv's Vulkan imports
// unless Vulkan is already mapped with RTLD_GLOBAL.
Napi::Object Init(Napi::Env env, Napi::Object exports) {
  void* handle = dlopen("libvulkan.so.1", RTLD_NOW | RTLD_GLOBAL);
  if (!handle) {
    Napi::Error::New(env, dlerror()).ThrowAsJavaScriptException();
    return exports;
  }
  exports.Set("loaded", Napi::Boolean::New(env, true));
  return exports;
}

NODE_API_MODULE(vulkan_preload, Init)
