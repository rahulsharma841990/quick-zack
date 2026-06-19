const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('dashApi', {
  openModule: (moduleId) => ipcRenderer.invoke('dash-open', moduleId),
});
