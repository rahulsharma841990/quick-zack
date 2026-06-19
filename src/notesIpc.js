const { ipcMain } = require('electron');
const { loadNotes, saveNotes, encryptNote, decryptNote } = require('./notesStore');

function setupNotesIpc() {
  ipcMain.handle('notes-list', () => {
    const notes = loadNotes();
    return notes.map(decryptNote);
  });

  ipcMain.handle('notes-search', (_event, query) => {
    const q = (query || '').toLowerCase();
    const notes = loadNotes().map(decryptNote);
    if (!q) return notes;
    return notes.filter(n =>
      (n.title || '').toLowerCase().includes(q) ||
      (n.content || '').toLowerCase().includes(q) ||
      (n.tags || []).some(t => t.toLowerCase().includes(q))
    );
  });

  ipcMain.handle('notes-save', (_event, note) => {
    const notes = loadNotes();

    if (note.id) {
      const idx = notes.findIndex(n => n.id === note.id);
      if (idx >= 0) {
        notes[idx] = encryptNote({
          ...note,
          updatedAt: Date.now()
        });
      } else {
        notes.push(encryptNote({
          ...note,
          createdAt: Date.now(),
          updatedAt: Date.now()
        }));
      }
    } else {
      note.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      note.createdAt = Date.now();
      note.updatedAt = Date.now();
      notes.push(encryptNote(note));
    }

    saveNotes(notes);
    return decryptNote(notes.find(n => n.id === note.id));
  });

  ipcMain.handle('notes-delete', (_event, id) => {
    const notes = loadNotes().filter(n => n.id !== id);
    saveNotes(notes);
    return { success: true };
  });
}

module.exports = { setupNotesIpc };
