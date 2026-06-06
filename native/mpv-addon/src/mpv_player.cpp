#include <napi.h>

#include <mpv/client.h>
#include <mpv/render.h>

#if defined(__linux__)
#include <dlfcn.h>
#endif
#include <atomic>
#include <chrono>
#include <cstdlib>
#include <cstring>
#include <mutex>
#include <string>
#include <thread>
#include <vector>

class MpvPlayer : public Napi::ObjectWrap<MpvPlayer> {
 public:
  static Napi::Object Init(Napi::Env env, Napi::Object exports) {
    Napi::Function func =
        DefineClass(env, "MpvPlayer",
                    {
                        InstanceMethod("load", &MpvPlayer::Load),
                        InstanceMethod("waitForLoad", &MpvPlayer::WaitForLoad),
                        InstanceMethod("getLastError", &MpvPlayer::GetLastError),
                        InstanceMethod("play", &MpvPlayer::Play),
                        InstanceMethod("pause", &MpvPlayer::Pause),
                        InstanceMethod("togglePause", &MpvPlayer::TogglePause),
                        InstanceMethod("seek", &MpvPlayer::Seek),
                        InstanceMethod("getTimePos", &MpvPlayer::GetTimePos),
                        InstanceMethod("getDuration", &MpvPlayer::GetDuration),
                        InstanceMethod("getPaused", &MpvPlayer::GetPaused),
                        InstanceMethod("getTrackList", &MpvPlayer::GetTrackList),
                        InstanceMethod("getSid", &MpvPlayer::GetSid),
                        InstanceMethod("getAid", &MpvPlayer::GetAid),
                        InstanceMethod("setSid", &MpvPlayer::SetSid),
                        InstanceMethod("setAid", &MpvPlayer::SetAid),
                        InstanceMethod("addSubtitle", &MpvPlayer::AddSubtitle),
                        InstanceMethod("poll", &MpvPlayer::Poll),
                        InstanceMethod("tick", &MpvPlayer::Tick),
                        InstanceMethod("setWid", &MpvPlayer::SetWid),
                        InstanceMethod("getDiagnostics", &MpvPlayer::GetDiagnostics),
                        InstanceMethod("destroy", &MpvPlayer::DestroyPlayer),
                    });

    exports.Set("MpvPlayer", func);
    return exports;
  }

  MpvPlayer(const Napi::CallbackInfo& info)
      : Napi::ObjectWrap<MpvPlayer>(info) {
    Napi::Env env = info.Env();

    int64_t wid = 0;
    if (info.Length() >= 1 && info[0].IsNumber()) {
      wid = static_cast<int64_t>(info[0].As<Napi::Number>().Int64Value());
    }

    mpv_ = mpv_create();
    if (!mpv_) {
      Napi::Error::New(env, "failed to create mpv context").ThrowAsJavaScriptException();
      return;
    }

    mpv_set_option_string(mpv_, "keep-open", "yes");
    mpv_set_option_string(mpv_, "osc", "no");
    mpv_set_option_string(mpv_, "input-default-bindings", "no");
    mpv_set_option_string(mpv_, "cursor-autohide", "no");

    if (wid > 0) {
      embed_mode_ = true;
      mpv_set_option(mpv_, "wid", MPV_FORMAT_INT64, &wid);
      mpv_set_option_string(mpv_, "vo", "gpu");
      mpv_set_option_string(mpv_, "hwdec", "auto-safe");
      mpv_set_option_string(mpv_, "force-window", "no");
#if defined(_WIN32)
      mpv_set_option_string(mpv_, "gpu-context", "win");
#endif
    } else {
      mpv_set_option_string(mpv_, "vo", "libmpv");
      mpv_set_option_string(mpv_, "hwdec", "no");
      mpv_set_option_string(mpv_, "sw-fast", "yes");
    }

    if (mpv_initialize(mpv_) < 0) {
      mpv_terminate_destroy(mpv_);
      mpv_ = nullptr;
      Napi::Error::New(env, "failed to initialize mpv").ThrowAsJavaScriptException();
      return;
    }

    if (!embed_mode_) {
      int advanced = 1;
      mpv_render_param params[] = {
          {MPV_RENDER_PARAM_API_TYPE, const_cast<char*>(MPV_RENDER_API_TYPE_SW)},
          {MPV_RENDER_PARAM_ADVANCED_CONTROL, &advanced},
          {MPV_RENDER_PARAM_INVALID, nullptr},
      };

      if (mpv_render_context_create(&render_ctx_, mpv_, params) < 0) {
        mpv_terminate_destroy(mpv_);
        mpv_ = nullptr;
        Napi::Error::New(env, "failed to create mpv render context")
            .ThrowAsJavaScriptException();
        return;
      }

      mpv_render_context_set_update_callback(render_ctx_, &MpvPlayer::OnMpvRenderUpdate,
                                             this);
    }

    mpv_set_wakeup_callback(mpv_, &MpvPlayer::OnMpvEvents, this);
    mpv_request_log_messages(mpv_, "warn");

    if (embed_mode_ && wid > 0) {
      last_wid_ = wid;
    }
  }

  ~MpvPlayer() { Cleanup(); }

 private:
  static void OnMpvEvents(void* ctx) {
    auto* self = static_cast<MpvPlayer*>(ctx);
    self->event_pending_.store(true);
  }

  static void OnMpvRenderUpdate(void* ctx) {
    auto* self = static_cast<MpvPlayer*>(ctx);
    self->render_pending_.store(true);
  }

  void Cleanup() {
    if (render_ctx_) {
      mpv_render_context_free(render_ctx_);
      render_ctx_ = nullptr;
    }
    if (mpv_) {
      mpv_terminate_destroy(mpv_);
      mpv_ = nullptr;
    }
  }

  void ProcessEvents() {
    if (!mpv_) return;
    while (true) {
      mpv_event* event = mpv_wait_event(mpv_, 0);
      if (event->event_id == MPV_EVENT_NONE) break;

      if (event->event_id == MPV_EVENT_END_FILE) {
        auto* end_file = static_cast<mpv_event_end_file*>(event->data);
        if (end_file->reason == MPV_END_FILE_REASON_ERROR) {
          const char* detail = mpv_error_string(end_file->error);
          last_error_ = detail ? detail : "playback failed";
        }
      } else if (event->event_id == MPV_EVENT_LOG_MESSAGE) {
        auto* message = static_cast<mpv_event_log_message*>(event->data);
        if (message->level &&
            (strcmp(message->level, "error") == 0 ||
             strcmp(message->level, "fatal") == 0)) {
          last_error_ = message->text ? message->text : "mpv error";
        }
      }
    }
    event_pending_.store(false);
  }

  uint64_t ProcessRenderUpdate() {
    if (!render_ctx_) return 0;
    uint64_t flags = mpv_render_context_update(render_ctx_);
    if (!(flags & MPV_RENDER_UPDATE_FRAME)) {
      render_pending_.store(false);
    }
    return flags;
  }

  void PollUpdates(bool* needsRedraw) {
    *needsRedraw = false;

    if (event_pending_.exchange(false)) {
      ProcessEvents();
    }

    if (!embed_mode_ && render_pending_.exchange(false)) {
      uint64_t flags = ProcessRenderUpdate();
      if (flags & MPV_RENDER_UPDATE_FRAME) {
        *needsRedraw = true;
      }
    }
  }

  Napi::Object BuildTickResult(Napi::Env env) {
    Napi::Object result = Napi::Object::New(env);
    result.Set("needsRedraw", Napi::Boolean::New(env, false));
    result.Set("timePos", Napi::Number::New(env, GetPropertyDouble("time-pos", 0.0)));
    result.Set("duration", Napi::Number::New(env, GetPropertyDouble("duration", 0.0)));
    result.Set("paused", Napi::Boolean::New(env, GetPropertyBool("pause", true)));
    result.Set("frame", env.Null());
    result.Set("width", Napi::Number::New(env, 0));
    result.Set("height", Napi::Number::New(env, 0));
    return result;
  }

  double GetPropertyDouble(const char* name, double fallback = 0.0) {
    if (!mpv_) return fallback;
    double value = fallback;
    mpv_get_property(mpv_, name, MPV_FORMAT_DOUBLE, &value);
    return value;
  }

  bool GetPropertyBool(const char* name, bool fallback = false) {
    if (!mpv_) return fallback;
    int value = fallback ? 1 : 0;
    mpv_get_property(mpv_, name, MPV_FORMAT_FLAG, &value);
    return value != 0;
  }

  static void SetTrackField(Napi::Env env, Napi::Object& track, const char* key,
                            const mpv_node* val) {
    if (strcmp(key, "id") == 0 && val->format == MPV_FORMAT_INT64) {
      track.Set("id", Napi::Number::New(env, static_cast<double>(val->u.int64)));
    } else if (strcmp(key, "type") == 0 && val->format == MPV_FORMAT_STRING) {
      track.Set("type", Napi::String::New(env, val->u.string));
    } else if (strcmp(key, "title") == 0 && val->format == MPV_FORMAT_STRING) {
      track.Set("title", Napi::String::New(env, val->u.string));
    } else if (strcmp(key, "lang") == 0 && val->format == MPV_FORMAT_STRING) {
      track.Set("lang", Napi::String::New(env, val->u.string));
    } else if (strcmp(key, "selected") == 0 && val->format == MPV_FORMAT_FLAG) {
      track.Set("selected", Napi::Boolean::New(env, val->u.flag != 0));
    }
  }

  Napi::Array BuildTrackList(Napi::Env env) {
    Napi::Array tracks = Napi::Array::New(env);
    if (!mpv_) return tracks;

    mpv_node node;
    if (mpv_get_property(mpv_, "track-list", MPV_FORMAT_NODE, &node) < 0) {
      return tracks;
    }

    if (node.format != MPV_FORMAT_NODE_ARRAY) {
      mpv_free_node_contents(&node);
      return tracks;
    }

    uint32_t out = 0;
    for (int i = 0; i < node.u.list->num; i++) {
      mpv_node* item = &node.u.list->values[i];
      if (item->format != MPV_FORMAT_NODE_MAP) continue;

      Napi::Object track = Napi::Object::New(env);
      for (int j = 0; j < item->u.list->num; j++) {
        SetTrackField(env, track, item->u.list->keys[j], &item->u.list->values[j]);
      }
      tracks.Set(out++, track);
    }

    mpv_free_node_contents(&node);
    return tracks;
  }

  Napi::Value GetTrackIdProperty(const Napi::CallbackInfo& info, const char* name) {
    Napi::Env env = info.Env();
    if (!mpv_) return env.Null();

    int64_t id = 0;
    if (mpv_get_property(mpv_, name, MPV_FORMAT_INT64, &id) >= 0) {
      return Napi::Number::New(env, static_cast<double>(id));
    }

    char* str = mpv_get_property_string(mpv_, name);
    if (!str) return env.Null();

    Napi::Value result = env.Null();
    if (strcmp(str, "no") != 0 && strcmp(str, "auto") != 0) {
      result = Napi::Number::New(env, std::atoll(str));
    }
    mpv_free(str);
    return result;
  }

  Napi::Buffer<uint8_t> RenderPixels(Napi::Env env, int w, int h) {
    const size_t stride = static_cast<size_t>(w) * 4;
    const size_t size = stride * static_cast<size_t>(h);

    std::lock_guard<std::mutex> lock(buffer_mutex_);
    if (pixel_buffer_.size() != size) {
      pixel_buffer_.assign(size, 0);
    }

    int dims[2] = {w, h};
    size_t stride_val = stride;
    void* pixels = pixel_buffer_.data();
    mpv_render_param params[] = {
        {MPV_RENDER_PARAM_SW_SIZE, dims},
        {MPV_RENDER_PARAM_SW_FORMAT, const_cast<char*>("rgb0")},
        {MPV_RENDER_PARAM_SW_STRIDE, &stride_val},
        {MPV_RENDER_PARAM_SW_POINTER, pixels},
        {MPV_RENDER_PARAM_INVALID, nullptr},
    };

    ProcessEvents();
    ProcessRenderUpdate();

    int err = mpv_render_context_render(render_ctx_, params);
    if (err < 0) {
      return Napi::Buffer<uint8_t>::New(env, 0);
    }

    for (size_t i = 3; i < size; i += 4) {
      pixel_buffer_[i] = 255;
    }

    render_pending_.store(false);
    return Napi::Buffer<uint8_t>::Copy(env, pixel_buffer_.data(), size);
  }

  Napi::Value Load(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "expected file path string").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();
    last_error_.clear();
    const char* cmd[] = {"loadfile", path.c_str(), NULL};
    int err = mpv_command(mpv_, cmd);
    if (err < 0) {
      Napi::Error::New(env, mpv_error_string(err)).ThrowAsJavaScriptException();
    }
    return Napi::Boolean::New(env, err >= 0);
  }

  Napi::Value WaitForLoad(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    int timeout_ms = 30000;
    if (info.Length() >= 1 && info[0].IsNumber()) {
      timeout_ms = info[0].As<Napi::Number>().Int32Value();
    }

    const auto deadline =
        std::chrono::steady_clock::now() + std::chrono::milliseconds(timeout_ms);

    while (std::chrono::steady_clock::now() < deadline) {
      ProcessEvents();

      if (!last_error_.empty()) {
        Napi::Error::New(env, last_error_).ThrowAsJavaScriptException();
        return env.Undefined();
      }

      if (GetPropertyDouble("duration", 0.0) > 0.0) {
        return Napi::Boolean::New(env, true);
      }

      std::this_thread::sleep_for(std::chrono::milliseconds(50));
    }

    return Napi::Boolean::New(env, false);
  }

  Napi::Value GetLastError(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (last_error_.empty()) {
      return env.Null();
    }
    return Napi::String::New(env, last_error_);
  }

  Napi::Value Play(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const char* cmd[] = {"set", "pause", "no", NULL};
    mpv_command_async(mpv_, 0, cmd);
    return env.Undefined();
  }

  Napi::Value Pause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const char* cmd[] = {"set", "pause", "yes", NULL};
    mpv_command_async(mpv_, 0, cmd);
    return env.Undefined();
  }

  Napi::Value TogglePause(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    const char* cmd[] = {"cycle", "pause", NULL};
    mpv_command_async(mpv_, 0, cmd);
    return env.Undefined();
  }

  Napi::Value Seek(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "expected seek time in seconds").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    double seconds = info[0].As<Napi::Number>().DoubleValue();
    std::string target = std::to_string(seconds);
    const char* cmd[] = {"seek", target.c_str(), "absolute", NULL};
    mpv_command_async(mpv_, 0, cmd);
    return env.Undefined();
  }

  Napi::Value GetTimePos(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), GetPropertyDouble("time-pos", 0.0));
  }

  Napi::Value GetDuration(const Napi::CallbackInfo& info) {
    return Napi::Number::New(info.Env(), GetPropertyDouble("duration", 0.0));
  }

  Napi::Value GetPaused(const Napi::CallbackInfo& info) {
    return Napi::Boolean::New(info.Env(), GetPropertyBool("pause", true));
  }

  Napi::Value GetTrackList(const Napi::CallbackInfo& info) {
    return BuildTrackList(info.Env());
  }

  Napi::Value GetSid(const Napi::CallbackInfo& info) {
    return GetTrackIdProperty(info, "sid");
  }

  Napi::Value GetAid(const Napi::CallbackInfo& info) {
    return GetTrackIdProperty(info, "aid");
  }

  Napi::Value SetSid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
      Napi::TypeError::New(env, "expected track id or \"no\"").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    if (info[0].IsString()) {
      std::string value = info[0].As<Napi::String>().Utf8Value();
      mpv_set_property_string(mpv_, "sid", value.c_str());
    } else if (info[0].IsNumber()) {
      int64_t id = static_cast<int64_t>(info[0].As<Napi::Number>().Int64Value());
      mpv_set_property(mpv_, "sid", MPV_FORMAT_INT64, &id);
    } else {
      Napi::TypeError::New(env, "expected track id or \"no\"").ThrowAsJavaScriptException();
    }
    return env.Undefined();
  }

  Napi::Value SetAid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) {
      Napi::TypeError::New(env, "expected audio track id").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    int64_t id = static_cast<int64_t>(info[0].As<Napi::Number>().Int64Value());
    mpv_set_property(mpv_, "aid", MPV_FORMAT_INT64, &id);
    return env.Undefined();
  }

  Napi::Value AddSubtitle(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsString()) {
      Napi::TypeError::New(env, "expected subtitle file path").ThrowAsJavaScriptException();
      return env.Undefined();
    }

    std::string path = info[0].As<Napi::String>().Utf8Value();
    const char* cmd[] = {"sub-add", path.c_str(), NULL};
    int err = mpv_command_async(mpv_, 0, cmd);
    if (err < 0) {
      Napi::Error::New(env, mpv_error_string(err)).ThrowAsJavaScriptException();
    }
    return Napi::Boolean::New(env, err >= 0);
  }

  Napi::Value Poll(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);

    bool needsRedraw = false;
    PollUpdates(&needsRedraw);
    result.Set("needsRedraw", Napi::Boolean::New(env, needsRedraw));
    return result;
  }

  Napi::Value Tick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    bool needsRedraw = false;
    PollUpdates(&needsRedraw);

    if (embed_mode_) {
      return BuildTickResult(env);
    }

    int w = 0;
    int h = 0;
    if (info.Length() >= 2 && info[0].IsNumber() && info[1].IsNumber()) {
      w = info[0].As<Napi::Number>().Int32Value();
      h = info[1].As<Napi::Number>().Int32Value();
    }

    if (!needsRedraw && render_ctx_) {
      uint64_t flags = ProcessRenderUpdate();
      if (flags & MPV_RENDER_UPDATE_FRAME) {
        needsRedraw = true;
      }
    }

    Napi::Object result = BuildTickResult(env);
    if (render_ctx_ && w > 0 && h > 0 && needsRedraw) {
      Napi::Buffer<uint8_t> frame = RenderPixels(env, w, h);
      if (frame.Length() > 0) {
        result.Set("needsRedraw", Napi::Boolean::New(env, true));
        result.Set("frame", frame);
        result.Set("width", Napi::Number::New(env, w));
        result.Set("height", Napi::Number::New(env, h));
      }
    }

    return result;
  }

  void ReinitEmbeddedVo(int64_t wid) {
    if (!mpv_ || !embed_mode_ || wid <= 0) return;
    if (wid == last_wid_) return;

    mpv_set_property_string(mpv_, "vo", "null");
    mpv_set_property(mpv_, "wid", MPV_FORMAT_INT64, &wid);
    mpv_set_property_string(mpv_, "vo", "gpu");
    last_wid_ = wid;
    ProcessEvents();
  }

  Napi::Value SetWid(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (!mpv_ || info.Length() < 1 || !info[0].IsNumber()) {
      return env.Undefined();
    }

    int64_t wid = static_cast<int64_t>(info[0].As<Napi::Number>().Int64Value());
    if (embed_mode_) {
      ReinitEmbeddedVo(wid);
    } else {
      mpv_set_property(mpv_, "wid", MPV_FORMAT_INT64, &wid);
      last_wid_ = wid;
    }
    return env.Undefined();
  }

  Napi::Value GetDiagnostics(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object result = Napi::Object::New(env);
    if (!mpv_) return result;

    ProcessEvents();

    result.Set("embedMode", Napi::Boolean::New(env, embed_mode_));
    result.Set("initWid", Napi::Number::New(env, static_cast<double>(last_wid_)));

    int64_t wid = 0;
    if (mpv_get_property(mpv_, "wid", MPV_FORMAT_INT64, &wid) >= 0) {
      result.Set("wid", Napi::Number::New(env, static_cast<double>(wid)));
    }

    auto setString = [&](const char* key, const char* prop) {
      char* value = mpv_get_property_string(mpv_, prop);
      if (value) {
        result.Set(key, Napi::String::New(env, value));
        mpv_free(value);
      }
    };

    auto setDouble = [&](const char* key, const char* prop) {
      double value = 0.0;
      if (mpv_get_property(mpv_, prop, MPV_FORMAT_DOUBLE, &value) >= 0) {
        result.Set(key, Napi::Number::New(env, value));
      }
    };

    setString("vo", "current-vo");
    if (!result.Has("vo")) setString("vo", "vo");
    setString("hwdecCurrent", "hwdec-current");
    setString("videoFormat", "video-format");
    setDouble("dwidth", "dwidth");
    setDouble("dheight", "dheight");
    setDouble("width", "width");
    setDouble("height", "height");
    setDouble("timePos", "time-pos");
    setDouble("duration", "duration");

    int paused = 0;
    if (mpv_get_property(mpv_, "pause", MPV_FORMAT_FLAG, &paused) >= 0) {
      result.Set("paused", Napi::Boolean::New(env, paused != 0));
    }

    if (!last_error_.empty()) {
      result.Set("lastError", Napi::String::New(env, last_error_));
    }

    return result;
  }

  Napi::Value DestroyPlayer(const Napi::CallbackInfo& info) {
    Cleanup();
    return info.Env().Undefined();
  }

  mpv_handle* mpv_ = nullptr;
  mpv_render_context* render_ctx_ = nullptr;
  std::vector<uint8_t> pixel_buffer_;
  std::mutex buffer_mutex_;
  std::atomic<bool> event_pending_{false};
  std::atomic<bool> render_pending_{false};
  bool embed_mode_ = false;
  int64_t last_wid_ = 0;
  std::string last_error_;
};

Napi::Object InitAll(Napi::Env env, Napi::Object exports) {
#if defined(__linux__)
  dlopen("libvulkan.so.1", RTLD_NOW | RTLD_GLOBAL);
#endif
  return MpvPlayer::Init(env, exports);
}

NODE_API_MODULE(mpv_addon, InitAll)
