const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // Get the scanned project list
  getProjects: () => ipcRenderer.invoke('get-projects'),

  // Open a project in the configured editor
  openProject: (projectPath) => ipcRenderer.invoke('open-project', projectPath),

  // Rescan directories
  rescanProjects: () => ipcRenderer.invoke('rescan-projects'),

  // Get config
  getConfig: () => ipcRenderer.invoke('get-config'),

  // Hide the window
  hideWindow: () => ipcRenderer.send('hide-window'),

  // Listen for focus event (window shown)
  onWindowFocus: (callback) => {
    ipcRenderer.on('window-focused', callback);
    return () => ipcRenderer.removeListener('window-focused', callback);
  },

  // Listen for projects updated event
  onProjectsUpdated: (callback) => {
    ipcRenderer.on('projects-updated', (_event, projects) => callback(projects));
    return () => ipcRenderer.removeListener('projects-updated', callback);
  },

  // Listen for config live-reload event
  onConfigUpdated: (callback) => {
    ipcRenderer.on('config-updated', (_event, cfg) => callback(cfg));
    return () => ipcRenderer.removeListener('config-updated', callback);
  }
});
