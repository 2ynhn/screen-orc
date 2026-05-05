const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  openOverlay: () => ipcRenderer.invoke('open-overlay'),
  cancelOverlay: () => ipcRenderer.invoke('overlay-cancel'),
  areaSelected: (rect) => ipcRenderer.invoke('area-selected', rect),
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  copyText: (text) => ipcRenderer.invoke('copy-text', text),
  minimizeWindow: () => ipcRenderer.invoke('minimize-window'),
  closeWindow: () => ipcRenderer.invoke('close-window'),
  switchTab: (mode) => ipcRenderer.invoke('switch-tab', mode),
  getActiveMode: () => ipcRenderer.invoke('get-active-mode'),

  onOcrStart: (cb) => ipcRenderer.on('ocr-start', cb),
  onOcrResult: (cb) => ipcRenderer.on('ocr-result', (_, data) => cb(data)),
  onOcrError: (cb) => ipcRenderer.on('ocr-error', (_, msg) => cb(msg)),
});
