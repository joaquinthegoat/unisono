// Preload for the control bar. Exposes a small, safe API to the UI page.
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('unisono', {
  selectTab: (id) => ipcRenderer.send('select-tab', id),
  control: (action) => ipcRenderer.send('control', action),
  back: () => ipcRenderer.send('go-back'),
  reload: () => ipcRenderer.send('reload'),
  ready: () => ipcRenderer.send('ready'),
  onState: (callback) => {
    ipcRenderer.on('state', (_event, payload) => callback(payload));
  }
});
