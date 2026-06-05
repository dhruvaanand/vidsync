import { contextBridge, ipcRenderer } from 'electron';

export interface MpvTickResult {
  needsRedraw: boolean;
  frame: Uint8Array | null;
  width: number;
  height: number;
  timePos: number;
  duration: number;
  paused: boolean;
}

export interface MpvTrack {
  id: number;
  type: 'video' | 'audio' | 'sub';
  title?: string;
  lang?: string;
  selected?: boolean;
}

export interface VideoBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

const electronAPI = {
  openVideoDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openVideo'),

  openSubtitleDialog: (): Promise<string | null> =>
    ipcRenderer.invoke('dialog:openSubtitle'),

  mpvAvailable: (
    bounds?: VideoBounds,
    updateBoundsOnly = false,
  ): Promise<boolean> => ipcRenderer.invoke('mpv:available', bounds, updateBoundsOnly),

  mpvLoadError: (): Promise<string | null> => ipcRenderer.invoke('mpv:loadError'),

  mpvLoad: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('mpv:load', filePath),

  mpvPlay: (): Promise<void> => ipcRenderer.invoke('mpv:play'),

  mpvPause: (): Promise<void> => ipcRenderer.invoke('mpv:pause'),

  mpvTogglePause: (): Promise<void> => ipcRenderer.invoke('mpv:togglePause'),

  mpvSeek: (seconds: number): Promise<void> =>
    ipcRenderer.invoke('mpv:seek', seconds),

  mpvGetTimePos: (): Promise<number> => ipcRenderer.invoke('mpv:getTimePos'),

  mpvGetDuration: (): Promise<number> => ipcRenderer.invoke('mpv:getDuration'),

  mpvGetPaused: (): Promise<boolean> => ipcRenderer.invoke('mpv:getPaused'),

  mpvGetTrackList: (): Promise<MpvTrack[]> =>
    ipcRenderer.invoke('mpv:getTrackList'),

  mpvGetSid: (): Promise<number | null> => ipcRenderer.invoke('mpv:getSid'),

  mpvGetAid: (): Promise<number | null> => ipcRenderer.invoke('mpv:getAid'),

  mpvSetSid: (trackId: number | 'no'): Promise<void> =>
    ipcRenderer.invoke('mpv:setSid', trackId),

  mpvSetAid: (trackId: number): Promise<void> =>
    ipcRenderer.invoke('mpv:setAid', trackId),

  mpvAddSubtitle: (filePath: string): Promise<boolean> =>
    ipcRenderer.invoke('mpv:addSubtitle', filePath),

  mpvTick: (): Promise<MpvTickResult> => ipcRenderer.invoke('mpv:tick'),

  mpvDestroy: (): Promise<void> => ipcRenderer.invoke('mpv:destroy'),
};

contextBridge.exposeInMainWorld('vidsync', electronAPI);

export type VidsyncAPI = typeof electronAPI;
