const { BrowserWindow, screen } = require('electron');
const path = require('path');
const shared = require('./shared');

function getWindowPosition() {
  const { width, height } = screen.getPrimaryDisplay().workAreaSize;
  const winWidth = 700;
  const winHeight = 520;
  return {
    x: Math.round((width - winWidth) / 2),
    y: Math.round(height * 0.22),
    winWidth,
    winHeight
  };
}

function createWindow() {
  const { x, y, winWidth, winHeight } = getWindowPosition();

  shared.win = new BrowserWindow({
    width: winWidth,
    height: winHeight,
    x,
    y,
    frame: false,
    transparent: true,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.win.loadFile('index.html');

  shared.win.on('blur', () => {
    if (shared.win && shared.win.isVisible()) {
      shared.win.hide();
    }
  });

  shared.win.on('closed', () => {
    shared.win = null;
  });

  if (process.argv.includes('--dev')) {
    shared.win.webContents.openDevTools({ mode: 'detach' });
  }
}

function showWindow() {
  if (!shared.win) createWindow();

  const { x, y } = getWindowPosition();
  shared.win.setPosition(x, y);
  shared.win.show();
  shared.win.focus();
  shared.win.webContents.send('window-focused');
}

function hideWindow() {
  if (shared.win) shared.win.hide();
}

function createDashboardWindow() {
  if (shared.dashboardWin) {
    shared.dashboardWin.focus();
    return shared.dashboardWin;
  }

  shared.dashboardWin = new BrowserWindow({
    width: 1280,
    height: 800,
    title: 'QuickZack – Dashboard',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-dashboard.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.dashboardWin.maximize();
  shared.dashboardWin.loadFile('dashboard.html');
  shared.dashboardWin.setMenu(null);

  shared.dashboardWin.on('closed', () => {
    shared.dashboardWin = null;
  });

  if (process.argv.includes('--dev')) {
    shared.dashboardWin.webContents.openDevTools({ mode: 'detach' });
  }

  return shared.dashboardWin;
}

function createFtpWindow() {
  if (shared.ftpWin) {
    shared.ftpWin.focus();
    return shared.ftpWin;
  }

  shared.ftpWin = new BrowserWindow({
    width: 900,
    height: 600,
    minWidth: 700,
    minHeight: 450,
    title: 'QuickZack – FTP Manager',
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, '..', 'preload-ftps.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  shared.ftpWin.loadFile('ftps.html');
  shared.ftpWin.setMenu(null);

  shared.ftpWin.on('closed', () => {
    shared.ftpWin = null;
  });

  if (process.argv.includes('--dev')) {
    shared.ftpWin.webContents.openDevTools({ mode: 'detach' });
  }

  return shared.ftpWin;
}

module.exports = { createWindow, showWindow, hideWindow, createFtpWindow, createDashboardWindow };
