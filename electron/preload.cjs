const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('qqMusic', {
  importPublicPlaylist: (url) => ipcRenderer.invoke('qqmusic:import-public-playlist', url),
  playTrack: (payload) => ipcRenderer.invoke('qqmusic:play-track', payload),
  resolveTrack: (payload) => ipcRenderer.invoke('qqmusic:resolve-track', payload),
  discoverTracks: (payload) => ipcRenderer.invoke('qqmusic:discover-tracks', payload),
});
