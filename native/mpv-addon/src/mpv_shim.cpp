// Shared shim that pulls in libvulkan before libmpv so relocations resolve at
// link time when this library is loaded as a single unit by the dynamic linker.
extern "C" void mpv_electron_shim_anchor() {}
