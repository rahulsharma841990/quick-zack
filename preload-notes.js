const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('notesApi', {
  listNotes: () => ipcRenderer.invoke('notes-list'),
  searchNotes: (query) => ipcRenderer.invoke('notes-search', query),
  saveNote: (note) => ipcRenderer.invoke('notes-save', note),
  deleteNote: (id) => ipcRenderer.invoke('notes-delete', id),
});
