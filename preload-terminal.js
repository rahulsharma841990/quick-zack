const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sshBridge', {
  // ── SSH Terminal ───────────────────────────────────────────────────────
  onData: (cb) => ipcRenderer.on('ssh-data', (_e, d) => cb(d)),
  onConnected: (cb) => ipcRenderer.on('ssh-connected', (_e, info) => cb(info)),
  onError: (cb) => ipcRenderer.on('ssh-error', (_e, msg) => cb(msg)),
  onClosed: (cb) => ipcRenderer.on('ssh-closed', () => cb()),
  onCwdUpdate: (cb) => ipcRenderer.on('ssh-cwd-update', (_e, path) => cb(path)),
  onSysStats: (cb) => ipcRenderer.on('ssh-sys-stats', (_e, data) => cb(data)),
  onSoftwareVersions: (cb) => ipcRenderer.on('ssh-software-versions', (_e, data) => cb(data)),

  sendInput: (data) => ipcRenderer.send('ssh-input', data),
  resize: (cols, rows) => ipcRenderer.send('ssh-resize', cols, rows),

  // ── SFTP File Operations ───────────────────────────────────────────────
  listDirectory: (remotePath) => ipcRenderer.invoke('sftp-list', remotePath),
  downloadFile: (remotePath) => ipcRenderer.invoke('sftp-download', remotePath),
  uploadFile: (remotePath, b64) => ipcRenderer.invoke('sftp-upload', remotePath, b64),
  deleteFile: (remotePath) => ipcRenderer.invoke('sftp-delete', remotePath),
  createFolder: (remotePath) => ipcRenderer.invoke('sftp-mkdir', remotePath),
  createFile: (remotePath) => ipcRenderer.invoke('sftp-touch', remotePath),
  zipFiles: (currentDir, paths) => ipcRenderer.invoke('sftp-zip', currentDir, paths),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('sftp-rename', oldPath, newPath),

  // ── Explorer ↔ Terminal sync ───────────────────────────────────────────
  changeDirectory: (remotePath) => ipcRenderer.send('sftp-cd', remotePath),
});
