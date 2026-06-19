const { Tray, Menu, nativeImage } = require('electron');
const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const shared = require('./shared');
const { showWindow, createFtpWindow, createDashboardWindow } = require('./window');
const { refreshProjects } = require('./projects');

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '📊 Dashboard',
      click: () => createDashboardWindow()
    },
    {
      label: '⚡ Open QuickZack',
      click: () => showWindow()
    },
    {
      label: '📡 Manage FTPs',
      click: () => createFtpWindow()
    },
    {
      label: '🔄 Rescan Projects',
      click: async () => {
        await refreshProjects();
        if (shared.win) shared.win.webContents.send('projects-updated', shared.projectCache);
      }
    },
    { type: 'separator' },
    {
      label: '📥 Check for Updates',
      click: () => {
        if (shared.autoUpdater) {
          shared.autoUpdater.checkForUpdates();
        }
      }
    },
    { type: 'separator' },
    {
      label: `📁 Projects: ${shared.config.projects_path}`,
      enabled: false
    },
    {
      label: `⌨️  Shortcut: ${shared.config.shortcut}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '✏️  Edit config.json',
      click: () => {
        if (process.platform === 'darwin') {
          exec(`open -e "${shared.CONFIG_PATH}"`);
        } else {
          exec(`notepad "${shared.CONFIG_PATH}"`);
        }
      }
    },
    { type: 'separator' },
    {
      label: '❌ Quit QuickZack',
      click: () => {
        require('electron').app.isQuitting = true;
        require('electron').app.quit();
      }
    }
  ]);
}

function createTray() {
  const iconPath = fs.existsSync(path.join(__dirname, '..', 'assets', 'icon.png'))
    ? path.join(__dirname, '..', 'assets', 'icon.png')
    : path.join(__dirname, '..', 'tray-icon.png');

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  shared.tray = new Tray(icon);
  shared.tray.setToolTip('QuickZack – Project Launcher');
  shared.tray.setContextMenu(buildTrayMenu());
  shared.tray.on('double-click', () => showWindow());
  shared.tray.on('click', () => createDashboardWindow());
}

module.exports = { createTray, buildTrayMenu };
