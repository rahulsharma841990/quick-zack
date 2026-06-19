const { Notification } = require('electron');
const fs = require('fs');
const path = require('path');
const shared = require('./shared');

function setupUpdater() {
  try {
    const updater = require('electron-updater');
    shared.autoUpdater = updater.autoUpdater;
  } catch (err) {
    console.warn('[QuickZack] electron-updater not available, auto-update disabled.');
    return;
  }

  if (!shared.autoUpdater) return;

  shared.autoUpdater.autoDownload = false;

  shared.autoUpdater.on('update-available', (info) => {
    const updateIconPath = fs.existsSync(path.join(__dirname, '..', 'assets', 'icon-update.png'))
      ? path.join(__dirname, '..', 'assets', 'icon-update.png')
      : path.join(__dirname, '..', 'tray-icon-update.png');
    const normalIconPath = fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png'))
      ? path.join(__dirname, '..', 'assets', 'icon.png')
      : path.join(__dirname, '..', 'tray-icon.png');

    if (fs.existsSync(updateIconPath) && shared.tray) {
      shared.tray.setImage(updateIconPath);
    }

    if (Notification.isSupported()) {
      const updateNotification = new Notification({
        title: 'New Update Available! 🚀',
        body: `Version ${info.version} is available. Click here to download & install.`,
        icon: fs.existsSync(updateIconPath) ? updateIconPath : normalIconPath,
        silent: false
      });

      updateNotification.on('click', () => {
        shared.autoUpdater.downloadUpdate();
      });

      updateNotification.show();
    }
  });

  shared.autoUpdater.on('update-downloaded', () => {
    const readyNotif = new Notification({
      title: 'Update Downloaded! ✅',
      body: 'The update has been downloaded. The application will now restart to install.',
      icon: fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png'))
        ? path.join(__dirname, '..', 'assets', 'icon.png')
        : path.join(__dirname, '..', 'tray-icon.png')
    });

    readyNotif.on('click', () => {
      shared.autoUpdater.quitAndInstall();
    });
    readyNotif.show();

    setTimeout(() => {
      shared.autoUpdater.quitAndInstall();
    }, 3000);
  });

  shared.autoUpdater.on('error', (err) => {
    console.error('[QuickZack] Auto-updater Error:', err);
  });
}

module.exports = { setupUpdater };
