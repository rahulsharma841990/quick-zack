const { app } = require('electron');
const path = require('path');

module.exports = {
  // Windows
  win: null,
  tray: null,
  dashboardWin: null,
  ftpWin: null,
  utilWin: null,
  dbWin: null,
  notesWin: null,

  // Config
  CONFIG_PATH: path.join(app.getPath('userData'), 'quickzack-config.json'),
  config: null,

  // Projects
  projectCache: [],
  lastOpenedProjectPath: null,

  // Updater
  autoUpdater: null,

  // SSH / SFTP state maps
  sshSessions: new Map(),
  sftpClients: new Map(),
  activeExplorerPaths: new Map(),
  statTimers: new Map(),
  sshConns: new Map(),
  pwdTimers: new Map(),
  activeTransfers: new Map(),

  // Git helpers
  GIT_CANDIDATES: [
    'git',
    'git.exe',
    '"C:\\Program Files\\Git\\cmd\\git.exe"',
    '"C:\\Program Files (x86)\\Git\\cmd\\git.exe"',
  ],
};
