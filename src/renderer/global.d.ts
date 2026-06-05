import type { VidsyncAPI } from '../main/preload';

declare global {
  interface Window {
    vidsync?: VidsyncAPI;
  }
}

export {};
