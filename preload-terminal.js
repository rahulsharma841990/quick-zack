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
  onProgress: (cb) => ipcRenderer.on('sftp-progress', (_e, data) => cb(data)),

  sendInput: (data) => ipcRenderer.send('ssh-input', data),
  resize: (cols, rows) => ipcRenderer.send('ssh-resize', cols, rows),

  // ── SFTP File Operations ───────────────────────────────────────────────
  listDirectory: (remotePath) => ipcRenderer.invoke('sftp-list', remotePath),
  downloadToPath: (remotePath, localPath) => ipcRenderer.invoke('sftp-download', remotePath, localPath),
  readFile: (remotePath) => ipcRenderer.invoke('sftp-read-file', remotePath),
  uploadFromPath: (remotePath, localPath) => ipcRenderer.invoke('sftp-upload', remotePath, localPath),
  writeFile: (remotePath, b64) => ipcRenderer.invoke('sftp-write-file', remotePath, b64),
  cancelTransfer: () => ipcRenderer.invoke('sftp-cancel'),
  showSaveDialog: (filename) => ipcRenderer.invoke('show-save-dialog', filename),
  deleteFile: (remotePath) => ipcRenderer.invoke('sftp-delete', remotePath),
  createFolder: (remotePath) => ipcRenderer.invoke('sftp-mkdir', remotePath),
  createFile: (remotePath) => ipcRenderer.invoke('sftp-touch', remotePath),
  zipFiles: (currentDir, paths) => ipcRenderer.invoke('sftp-zip', currentDir, paths),
  renameFile: (oldPath, newPath) => ipcRenderer.invoke('sftp-rename', oldPath, newPath),
  moveLocalFile: (oldPath, newPath) => ipcRenderer.invoke('move-local-file', oldPath, newPath),

  // ── Explorer ↔ Terminal sync ───────────────────────────────────────────
  changeDirectory: (remotePath) => ipcRenderer.send('sftp-cd', remotePath),
});
