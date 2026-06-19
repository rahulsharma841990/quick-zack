const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ftpApi', {
  listFtps: () => ipcRenderer.invoke('ftp-list'),
  saveFtp: (ftp) => ipcRenderer.invoke('ftp-save', ftp),
  deleteFtp: (id) => ipcRenderer.invoke('ftp-delete', id),
  exportFtps: () => ipcRenderer.invoke('ftp-export'),
  importFtps: () => ipcRenderer.invoke('ftp-import'),
  connectFtp: (ftp) => ipcRenderer.invoke('ftp-connect', ftp),
});
