const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sshBridge', {
  // Receive SSH output data
  onData:      (cb) => ipcRenderer.on('ssh-data',      (_e, d) => cb(d)),
  // Connection established
  onConnected: (cb) => ipcRenderer.on('ssh-connected', (_e, info) => cb(info)),
  // Connection error
  onError:     (cb) => ipcRenderer.on('ssh-error',     (_e, msg) => cb(msg)),
  // Connection closed
  onClosed:    (cb) => ipcRenderer.on('ssh-closed',    () => cb()),

  // Send keystroke/input to SSH
  sendInput: (data) => ipcRenderer.send('ssh-input', data),
  // Tell SSH server to resize the PTY
  resize: (cols, rows) => ipcRenderer.send('ssh-resize', cols, rows),
});
