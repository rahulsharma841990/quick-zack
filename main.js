const {
  app,
  globalShortcut,
  Notification
} = require('electron');
const fs = require('fs');
const path = require('path');

const shared = require('./src/shared');
const { loadConfig } = require('./src/config');
const { createWindow, showWindow } = require('./src/window');
const { createTray, buildTrayMenu } = require('./src/tray');
const { refreshProjects } = require('./src/projects');
const { setupMainIpc } = require('./src/ipc');
const { setupSshIpc, setupSftpIpc } = require('./src/ssh');
const { setupUpdater } = require('./src/updater');
const { startRandomScheduler } = require('./src/scheduler');
const { setupFtpIpc } = require('./src/ftpIpc');
const { setupDashboardIpc } = require('./src/dashboardIpc');
const { setupNotesIpc } = require('./src/notesIpc');

// ─── Config ─────────────────────────────────────────────────────────────────
loadConfig();

// ─── Updater ─────────────────────────────────────────────────────────────────
setupUpdater();

// ─── IPC Handlers ───────────────────────────────────────────────────────────
setupMainIpc();
setupSshIpc();
setupSftpIpc();
setupFtpIpc();
setupNotesIpc();
setupDashboardIpc();

// ─── Single Instance Lock ───────────────────────────────────────────────────
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

// ─── Shortcut ───────────────────────────────────────────────────────────────
function registerShortcut(shortcut) {
  globalShortcut.unregisterAll();
  const registered = globalShortcut.register(shortcut, () => {
    if (shared.win && shared.win.isVisible()) {
      require('./src/window').hideWindow();
    } else {
      showWindow();
    }
  });
  if (!registered) {
    console.error(`[QuickZack] Could not register shortcut: ${shortcut}`);
  } else {
    console.log(`[QuickZack] Shortcut registered: ${shortcut}`);
  }
}

// ─── Config File Watcher ───────────────────────────────────────────────────
function watchConfig() {
  let debounceTimer = null;

  fs.watch(shared.CONFIG_PATH, (eventType) => {
    if (eventType !== 'change') return;

    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const newConfig = loadConfig();

      if (newConfig.shortcut !== shared.config.shortcut) {
        registerShortcut(newConfig.shortcut || 'Alt+Space');
      }

      shared.config = newConfig;
      console.log('[QuickZack] Config reloaded:', shared.CONFIG_PATH);

      if (shared.tray) shared.tray.setContextMenu(buildTrayMenu());

      await refreshProjects();

      if (shared.win) {
        shared.win.webContents.send('projects-updated', shared.projectCache);
        shared.win.webContents.send('config-updated', shared.config);
      }

      console.log(`[QuickZack] Auto-rescanned: ${shared.projectCache.length} projects found.`);
    }, 500);
  });

  console.log('[QuickZack] Watching config for changes:', shared.CONFIG_PATH);
}

// ─── App Lifecycle ──────────────────────────────────────────────────────────

app.whenReady().then(async () => {
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  if (process.platform === 'win32') {
    app.setAppUserModelId('com.quickzack.launcher');
  }

  createWindow();
  createTray();

  registerShortcut(shared.config.shortcut || 'Alt+Space');

  await refreshProjects();

  watchConfig();

  startRandomScheduler();

  if (shared.autoUpdater) {
    shared.autoUpdater.checkForUpdates();
    setInterval(() => {
      shared.autoUpdater.checkForUpdates();
    }, 2 * 60 * 60 * 1000);
  }

  if (Notification.isSupported()) {
    const startNotification = new Notification({
      title: 'QuickZack',
      body: 'App is started in system tray',
      icon: path.join(__dirname, 'tray-icon.png'),
      silent: false
    });
    startNotification.on('click', () => {
      showWindow();
    });
    startNotification.show();
  }

  console.log('[QuickZack] Ready. Press', shared.config.shortcut || 'Alt+Space', 'to open.');
});

app.on('window-all-closed', (e) => {
  e.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
