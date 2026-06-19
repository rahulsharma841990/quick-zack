const { ipcMain } = require('electron');
const { createFtpWindow } = require('./window');
const { showWindow } = require('./window');

function setupDashboardIpc() {
  ipcMain.handle('dash-open', (_event, moduleId) => {
    switch (moduleId) {
      case 'projects':
        showWindow();
        return { success: true };
      case 'ftps':
        createFtpWindow();
        return { success: true };
      case 'utilities':
        createUtilityWindow();
        return { success: true };
      case 'databases':
        createDbWindow();
        return { success: true };
      case 'notes':
        createNotesWindow();
        return { success: true };
      case 'settings':
        openConfigEditor();
        return { success: true };
      default:
        return { success: false, error: 'Unknown module' };
    }
  });
}

function createUtilityWindow() {
  const { BrowserWindow } = require('electron');
  const path = require('path');
  const shared = require('./shared');

  if (shared.utilWin) {
    shared.utilWin.focus();
    return;
  }

  shared.utilWin = new BrowserWindow({
    width: 520,
    height: 640,
    minWidth: 400,
    minHeight: 480,
    title: 'QuickZack – Quick Utilities',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.utilWin.loadFile('utilities.html');
  shared.utilWin.setMenu(null);

  shared.utilWin.on('closed', () => {
    shared.utilWin = null;
  });
}

function createDbWindow() {
  const { BrowserWindow } = require('electron');
  const path = require('path');
  const shared = require('./shared');

  if (shared.dbWin) {
    shared.dbWin.focus();
    return;
  }

  shared.dbWin = new BrowserWindow({
    width: 600,
    height: 500,
    title: 'QuickZack – Databases',
    backgroundColor: '#0d1117',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.dbWin.loadFile('databases.html');
  shared.dbWin.setMenu(null);

  shared.dbWin.on('closed', () => {
    shared.dbWin = null;
  });
}

function createNotesWindow() {
  const { BrowserWindow } = require('electron');
  const path = require('path');
  const shared = require('./shared');

  if (shared.notesWin) {
    shared.notesWin.focus();
    return;
  }

  shared.notesWin = new BrowserWindow({
    width: 860,
    height: 620,
    minWidth: 640,
    minHeight: 440,
    title: 'QuickZack – Notes & Snippets',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-notes.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.notesWin.loadFile('notes.html');
  shared.notesWin.setMenu(null);

  shared.notesWin.on('closed', () => {
    shared.notesWin = null;
  });
}

function openConfigEditor() {
  const { exec } = require('child_process');
  const shared = require('./shared');
  if (process.platform === 'darwin') {
    exec(`open -e "${shared.CONFIG_PATH}"`);
  } else {
    exec(`notepad "${shared.CONFIG_PATH}"`);
  }
}

module.exports = { setupDashboardIpc };
