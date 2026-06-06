import type { VideoBounds } from '../main/preload';

/** Chromium-only strip at the bottom of the canvas (MPV does not cover this). */
export function readMpvVideoBounds(host: HTMLElement): VideoBounds {
  const rect = host.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;

  const wrap = host.parentElement;
  const overlay = wrap?.querySelector<HTMLElement>('.video-controls-overlay');
  const overlayHeight = overlay?.getBoundingClientRect().height ?? 0;

  const width = Math.max(1, Math.round(rect.width * scale) / scale);
  const fullHeight = Math.max(1, Math.round(rect.height * scale) / scale);
  const mpvHeight = Math.max(1, fullHeight - Math.round(overlayHeight));

  return {
    x: Math.round(rect.left * scale) / scale,
    y: Math.round(rect.top * scale) / scale,
    width,
    height: mpvHeight,
  };
}
