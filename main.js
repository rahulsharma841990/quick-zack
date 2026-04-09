const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen,
  Notification
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const { Client: SshClient } = require('ssh2');
const { autoUpdater } = require('electron-updater');

// ─── Auto Updater Setup ───────────────────────────────────────────────────────
autoUpdater.autoDownload = false;

autoUpdater.on('update-available', (info) => {
  // Show green dot tray icon
  const updateIconPath = fs.existsSync(path.join(__dirname, 'assets/icon-update.png')) 
    ? path.join(__dirname, 'assets/icon-update.png')
    : path.join(__dirname, 'tray-icon-update.png');
  const normalIconPath = fs.existsSync(path.join(__dirname, 'assets/icon.png'))
    ? path.join(__dirname, 'assets/icon.png')
    : path.join(__dirname, 'tray-icon.png');

  if (fs.existsSync(updateIconPath) && tray) {
    tray.setImage(updateIconPath);
  }

  if (Notification.isSupported()) {
    const updateNotification = new Notification({
      title: 'New Update Available! 🚀',
      body: `Version ${info.version} is available. Click here to download & install.`,
      icon: fs.existsSync(updateIconPath) ? updateIconPath : normalIconPath,
      silent: false
    });

    updateNotification.on('click', () => {
      autoUpdater.downloadUpdate();
    });

    updateNotification.show();
  }
});

autoUpdater.on('update-downloaded', () => {
  const readyNotif = new Notification({
    title: 'Update Downloaded! ✅',
    body: 'The update has been downloaded. The application will now restart to install.',
    icon: fs.existsSync(path.join(__dirname, 'assets/icon.png'))
      ? path.join(__dirname, 'assets/icon.png')
      : path.join(__dirname, 'tray-icon.png')
  });

  readyNotif.on('click', () => {
    autoUpdater.quitAndInstall();
  });
  readyNotif.show();

  setTimeout(() => {
    autoUpdater.quitAndInstall();
  }, 3000);
});

autoUpdater.on('error', (err) => {
  console.error('[QuickZack] Auto-updater Error:', err);
});
// Active SSH sessions: webContents.id → shell stream
const sshSessions = new Map();
// Active SFTP clients: webContents.id → sftp client
const sftpClients = new Map();
// Current Explorer Paths tracked from UI
const activeExplorerPaths = new Map();
// Stat polling timers
const statTimers = new Map();
// Active SSH connections: webContents.id → ssh2 Client (for exec)
const sshConns = new Map();
// PWD check debounce timers
const pwdTimers = new Map();

// ─── Config ─────────────────────────────────────────────────────────────────

const CONFIG_PATH = path.join(app.getPath('userData'), 'quickzack-config.json');

function loadConfig() {
  const defaultSettings = {
    projects_path: process.platform === 'darwin'
      ? path.join(os.homedir(), 'Projects')
      : 'C:/xampp/htdocs',
    editor_command: 'code',
    shortcut: 'Alt+Space',
    max_depth: 1,
    exclude_folders: ['.git', 'node_modules', '.vs', '__pycache__', '.idea', 'vendor', '.DS_Store']
  };

  if (!fs.existsSync(CONFIG_PATH)) {
    try {
      const bundledPath = path.join(__dirname, 'config.json');
      if (fs.existsSync(bundledPath)) {
        const bundledData = fs.readFileSync(bundledPath, 'utf-8');
        fs.writeFileSync(CONFIG_PATH, bundledData, 'utf-8');
      } else {
        fs.writeFileSync(CONFIG_PATH, JSON.stringify(defaultSettings, null, 2), 'utf-8');
      }
    } catch (e) {
      console.error('[QuickZack] Could not create initial config:', e.message);
    }
  }

  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (err) {
    console.error('[QuickZack] Failed to load config:', err.message);
    return defaultSettings;
  }
}

let config = loadConfig();

// ─── Project Indexer ─────────────────────────────────────────────────────────

let projectCache = [];
let lastOpenedProjectPath = null; // Prioritize this in reminder scheduler

// Common git executable paths on Windows
const GIT_CANDIDATES = [
  'git',
  'git.exe',
  '"C:\\Program Files\\Git\\cmd\\git.exe"',
  '"C:\\Program Files (x86)\\Git\\cmd\\git.exe"',
];

async function runGit(args, cwd, timeoutMs = 3000) {
  for (const gitBin of GIT_CANDIDATES) {
    try {
      const result = await execAsync(`${gitBin} ${args}`, {
        cwd,
        timeout: timeoutMs,
        windowsHide: true,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' }
      });
      return result.stdout.trim();
    } catch (e) {
      const msg = (e.message || '').toLowerCase();
      const isNotFound = msg.includes('not found') || msg.includes('is not recognized') || msg.includes('enoent') || msg.includes('no such file');
      if (!isNotFound) {
        return (e.stdout || '').trim();
      }
    }
  }
  return null;
}


function readBranchFromFile(dirPath) {
  try {
    const headFile = path.join(dirPath, '.git', 'HEAD');
    if (!fs.existsSync(headFile)) return null;
    const content = fs.readFileSync(headFile, 'utf-8').trim();
    // Format: "ref: refs/heads/main"
    if (content.startsWith('ref: refs/heads/')) {
      return content.replace('ref: refs/heads/', '');
    }
    // Detached HEAD — show short hash
    return content.slice(0, 7);
  } catch {
    return null;
  }
}


function isDirtyFromFiles(dirPath) {
  try {
    const gitDir = path.join(dirPath, '.git');
    const indexFile = path.join(gitDir, 'index');
    if (!fs.existsSync(indexFile)) return false;
    const dirtyMarkers = ['MERGE_HEAD', 'CHERRY_PICK_HEAD', 'REBASE_MERGE', 'REBASE_APPLY'];
    for (const marker of dirtyMarkers) {
      if (fs.existsSync(path.join(gitDir, marker))) return true;
    }
    const headFile = path.join(gitDir, 'HEAD');
    if (!fs.existsSync(headFile)) return false;

    const indexMtime = fs.statSync(indexFile).mtimeMs;
    const headMtime = fs.statSync(headFile).mtimeMs;
    return indexMtime > headMtime;
  } catch {
    return false;
  }
}

async function getGitStatus(dirPath) {
  try {
    const gitPath = path.join(dirPath, '.git');
    if (!fs.existsSync(gitPath)) return null;

    const [branchOut, statusOut] = await Promise.all([
      runGit('rev-parse --abbrev-ref HEAD', dirPath, 3000),
      runGit('status --porcelain', dirPath, 4000)
    ]);

    if (branchOut !== null && branchOut !== '') {
      return {
        branch: branchOut || 'HEAD',
        isDirty: (statusOut || '').length > 0
      };
    }

    const branch = readBranchFromFile(dirPath) || '?';
    const isDirty = isDirtyFromFiles(dirPath);
    return { branch, isDirty };

  } catch (err) {
    return null;
  }
}

async function scanProjects() {
  const projectsPath = config.projects_path;
  const excluded = new Set(config.exclude_folders || []);

  if (!fs.existsSync(projectsPath)) {
    console.warn(`[QuickZack] projects_path "${projectsPath}" does not exist.`);
    return [];
  }

  try {
    const entries = fs.readdirSync(projectsPath, { withFileTypes: true });

    const projectPromises = entries
      .filter((entry) => entry.isDirectory() && !excluded.has(entry.name))
      .map(async (entry) => {
        const fullPath = path.join(projectsPath, entry.name);

        // SFTP Check
        const sftpCandidates = [
          path.join(fullPath, '.vscode', 'sftp.json'),
          path.join(fullPath, 'sftp.json')
        ];
        let hasSftp = false;
        let sftpConfig = null;
        for (const candidate of sftpCandidates) {
          try {
            if (fs.existsSync(candidate)) {
              hasSftp = true;
              sftpConfig = JSON.parse(fs.readFileSync(candidate, 'utf-8'));
              break;
            }
          } catch { }
        }

        // Git Status Check
        const gitStatus = await getGitStatus(fullPath);

        return {
          name: entry.name,
          path: fullPath.replace(/\\/g, '/'),
          type: detectProjectType(fullPath),
          hasSftp,
          sftpConfig,
          gitStatus
        };
      });

    const projects = await Promise.all(projectPromises);
    console.log(`[QuickZack] Found ${projects.length} projects in "${projectsPath}"`);
    return projects;
  } catch (err) {
    console.error('[QuickZack] scanProjects error:', err.message);
    return [];
  }
}

function detectProjectType(dirPath) {
  try {
    const files = fs.readdirSync(dirPath);
    if (files.includes('package.json')) return 'node';
    if (files.includes('composer.json')) return 'php';
    if (files.includes('requirements.txt') || files.includes('setup.py')) return 'python';
    if (files.includes('Cargo.toml')) return 'rust';
    if (files.includes('go.mod')) return 'go';
    if (files.includes('pom.xml') || files.includes('build.gradle')) return 'java';
    if (files.includes('.git')) return 'git';
    return 'folder';
  } catch {
    return 'folder';
  }
}

async function refreshProjects() {
  projectCache = await scanProjects();
  return projectCache;
}

// ─── Window ──────────────────────────────────────────────────────────────────

let win = null;
let tray = null;

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

  win = new BrowserWindow({
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
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  win.loadFile('index.html');

  // Hide when focus is lost
  win.on('blur', () => {
    if (win && win.isVisible()) {
      win.hide();
    }
  });

  win.on('closed', () => {
    win = null;
  });

  // Dev tools only in dev mode
  if (process.argv.includes('--dev')) {
    win.webContents.openDevTools({ mode: 'detach' });
  }
}

function showWindow() {
  if (!win) createWindow();

  const { x, y } = getWindowPosition();
  win.setPosition(x, y);
  win.show();
  win.focus();
  win.webContents.send('window-focused');
}

function hideWindow() {
  if (win) win.hide();
}

// ─── Tray ─────────────────────────────────────────────────────────────────────

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    {
      label: '⚡ Open QuickZack',
      click: () => showWindow()
    },
    {
      label: '🔄 Rescan Projects',
      click: async () => {
        await refreshProjects();
        if (win) win.webContents.send('projects-updated', projectCache);
      }
    },
    { type: 'separator' },
    {
      label: '📥 Check for Updates',
      click: () => {
        autoUpdater.checkForUpdates();
      }
    },
    { type: 'separator' },
    {
      label: `📁 Projects: ${config.projects_path}`,
      enabled: false
    },
    {
      label: `⌨️  Shortcut: ${config.shortcut}`,
      enabled: false
    },
    { type: 'separator' },
    {
      label: '✏️  Edit config.json',
      click: () => {
        // Open config in default text editor — platform-aware
        if (process.platform === 'darwin') {
          exec(`open -e "${CONFIG_PATH}"`);
        } else {
          exec(`notepad "${CONFIG_PATH}"`);
        }
      }
    },
    { type: 'separator' },
    {
      label: '❌ Quit QuickZack',
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
}

function createTray() {
  const iconPath = fs.existsSync(path.join(__dirname, 'assets/icon.png'))
    ? path.join(__dirname, 'assets/icon.png')
    : path.join(__dirname, 'tray-icon.png');

  let icon;
  if (fs.existsSync(iconPath)) {
    icon = nativeImage.createFromPath(iconPath);
  } else {
    icon = nativeImage.createEmpty();
  }

  tray = new Tray(icon);
  tray.setToolTip('QuickZack – Project Launcher');
  tray.setContextMenu(buildTrayMenu());
  // Windows: double-click opens launcher; macOS: single-click is the convention
  tray.on('double-click', () => showWindow());
  if (process.platform === 'darwin') {
    tray.on('click', () => showWindow());
  }
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

ipcMain.handle('get-projects', async () => {
  if (projectCache.length === 0) {
    await refreshProjects();
  }
  return projectCache;
});

ipcMain.handle('rescan-projects', async () => {
  await refreshProjects();
  return projectCache;
});

ipcMain.handle('get-config', () => {
  return config;
});

ipcMain.handle('open-project', async (_event, projectPath) => {
  const cmd = config.editor_command;

  // Build the shell command
  // Support special patterns: {path} placeholder or just append path
  let fullCmd;
  if (cmd.includes('{path}')) {
    fullCmd = cmd.replace('{path}', `"${projectPath}"`);
  } else {
    fullCmd = `${cmd} "${projectPath}"`;
  }

  lastOpenedProjectPath = projectPath;
  console.log(`[QuickZack] Opening: ${fullCmd}`);

  exec(fullCmd, (err) => {
    if (err) {
      console.error('[QuickZack] exec error:', err.message);
    }
  });

  hideWindow();
  return { success: true, command: fullCmd };
});

ipcMain.handle('open-terminal', async (_event, projectPath) => {

  let fullCmd;
  if (process.platform === 'win32') {
    // Open PowerShell at specified Directory
    const escapedPath = projectPath.replace(/\//g, '\\');
    fullCmd = `start powershell.exe -NoExit -WorkingDirectory "${escapedPath}"`;
  } else if (process.platform === 'darwin') {
    fullCmd = `open -a Terminal "${projectPath}"`;
  } else {
    fullCmd = `x-terminal-emulator --working-directory="${projectPath}"`;
  }

  lastOpenedProjectPath = projectPath;
  console.log(`[QuickZack] Opening Terminal: ${fullCmd}`);

  exec(fullCmd, (err) => {
    if (err) {
      console.error('[QuickZack] open-terminal error:', err.message);
    }
  });

  hideWindow();
  return { success: true };
});

ipcMain.on('hide-window', () => {
  hideWindow();
});

// ─── SSH Terminal Window ─────────────────────────────────────────────────────

function createSshTerminal(sftpConfig, projectName) {
  const host = sftpConfig.host || '';
  const port = sftpConfig.port || 22;
  const user = sftpConfig.username || sftpConfig.user || 'root';
  const password = sftpConfig.password || '';

  const displayName = projectName || `${user}@${host}`;
  const windowTitle = `⚡ ${displayName} — QuickZack`;

  const termWin = new BrowserWindow({
    width: 1280,
    height: 680,
    minWidth: 800,
    minHeight: 480,
    title: windowTitle,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload-terminal.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, 'assets/icon.png')
  });

  termWin.setMenu(null);

  const wcId = termWin.webContents.id;

  termWin.loadFile('terminal.html');

  const conn = new SshClient();

  // Queue IPC messages that arrive before the page finishes loading
  let pageReady = false;
  const pendingEvents = [];

  function safeSend(channel, ...args) {
    if (pageReady) {
      try { termWin.webContents.send(channel, ...args); } catch { }
    } else {
      pendingEvents.push({ channel, args });
    }
  }

  // ── Start SSH immediately (parallel with page load) ──────────────────
  conn
    .on('ready', () => {
      // Store raw conn for later exec calls (pwd)
      sshConns.set(wcId, conn);

      // Get home directory via SFTP before sending connected event
      conn.sftp((sftpErr, sftp) => {
        if (!sftpErr && sftp) {
          sftpClients.set(wcId, sftp);
          sftp.on('close', () => sftpClients.delete(wcId));
        }

        // Determine home directory
        const execHomeCmd = (cb) => {
          conn.exec('echo $HOME', (err, homeStream) => {
            if (err) { cb('/'); return; }
            let homeDir = '';
            homeStream.on('data', (d) => homeDir += d.toString());
            homeStream.on('close', () => cb(homeDir.trim() || '/'));
          });
        };

        execHomeCmd((homeDir) => {
          safeSend('ssh-connected', {
            label: `${user}@${host}:${port}`,
            projectName: displayName,
            homeDir
          });
        });
      });


      conn.shell(
        { term: 'xterm-256color', cols: 220, rows: 50 },
        (err, stream) => {
          if (err) {
            safeSend('ssh-error', err.message);
            return;
          }

          sshSessions.set(wcId, stream);
          // Watch for 'cd' commands to sync explorer path
          // (we detect prompt changes via PWD in data stream - handled client side)

          stream.on('data', (data) => {
            safeSend('ssh-data', data.toString('utf8'));
          });

          stream.stderr.on('data', (data) => {
            safeSend('ssh-data', data.toString('utf8'));
          });

          stream.on('close', () => {
            safeSend('ssh-closed');
            sshSessions.delete(wcId);
            clearInterval(statTimers.get(wcId));
            statTimers.delete(wcId);
            try { conn.end(); } catch { }
          });
        }
      );

      // Start polling system stats
      const pollTimer = setInterval(() => {
        const c = sshConns.get(wcId);
        if (!c) return;
        const cmd = `free -m | awk 'NR==2{printf "%.1f/%.1f GB", $3/1024, $2/1024}'; echo '|'; df -h / | awk 'NR==2{printf "%s/%s", $3, $2}'; echo '|'; cat /proc/loadavg | awk '{print $1" "$2" "$3}'`;
        c.exec(cmd, (err, s) => {
          if (err) return;
          let out = '';
          s.on('data', d => out += d.toString());
          s.on('close', () => {
            const parts = out.replace(/\n/g, '').split('|');
            if (parts.length >= 3) {
              safeSend('ssh-sys-stats', { ram: parts[0], disk: parts[1], load: parts[2] });
            }
          });
        });
      }, 5000);
      statTimers.set(wcId, pollTimer);

      // Fetch software versions once
      const softCmd = `
        [ -s "$HOME/.nvm/nvm.sh" ] && \\. "$HOME/.nvm/nvm.sh" 2>/dev/null;
        export PATH=$PATH:/usr/local/bin:$HOME/.bun/bin;
        nv=$(node -v 2>/dev/null || echo ""); 
        npmv=$(npm -v 2>/dev/null || echo ""); 
        pv=$(php -r "echo PHP_VERSION;" 2>/dev/null || echo ""); 
        mv=$(mysql -V 2>/dev/null | awk '{print $5}' | cut -d, -f1 || echo ""); 
        pyv=$(python3 -c "import sys; print(sys.version.split(' ')[0])" 2>/dev/null || echo ""); 
        cv=$(composer -V 2>/dev/null | awk 'NR==1{print $3}' || echo ""); 
        echo "$nv|$npmv|$pv|$mv|$pyv|$cv";
      `;
      conn.exec(softCmd, (err, s) => {
        if (err) return;
        let out = '';
        s.on('data', d => out += d.toString());
        s.on('close', () => {
          const parts = out.replace(/\n/g, '').split('|');
          if (parts.length >= 6) {
            safeSend('ssh-software-versions', {
              node: parts[0] || null,
              npm: parts[1] || null,
              php: parts[2] || null,
              mysql: parts[3] || null,
              python: parts[4] || null,
              composer: parts[5] || null
            });
          }
        });
      });
    })
    .on('error', (err) => {
      console.error('[QuickZack] SSH error:', err.message);
      safeSend('ssh-error', err.message);
    })
    .connect({
      host,
      port,
      username: user,
      password,
      hostVerifier: () => true,
      readyTimeout: 20000,
    });

  // ── Once page is ready, flush any queued SSH events ──────────────────
  termWin.webContents.on('did-finish-load', () => {
    termWin.setTitle(windowTitle);
    pageReady = true;

    for (const { channel, args } of pendingEvents) {
      try { termWin.webContents.send(channel, ...args); } catch { }
    }
    pendingEvents.length = 0;
  });

  termWin.on('closed', () => {
    const stream = sshSessions.get(wcId);
    if (stream) {
      try { stream.close(); } catch { }
      sshSessions.delete(wcId);
    }
    const sftp = sftpClients.get(wcId);
    if (sftp) {
      try { sftp.end(); } catch { }
      sftpClients.delete(wcId);
    }
    sshConns.delete(wcId);
    activeExplorerPaths.delete(wcId);
    clearInterval(statTimers.get(wcId));
    statTimers.delete(wcId);
    clearTimeout(pwdTimers.get(wcId));
    pwdTimers.delete(wcId);
    try { conn.end(); } catch { }
  });

  return termWin;
}

// Helper: run pwd via separate exec channel and push cwd-update to renderer
function schedulePwdCheck(wcId, webContents, delayMs = 600) {
  clearTimeout(pwdTimers.get(wcId));
  const timer = setTimeout(() => {
    const conn = sshConns.get(wcId);
    if (!conn) return;
    conn.exec('pwd', (err, pwdStream) => {
      if (err) return;
      let out = '';
      pwdStream.on('data', (d) => out += d.toString());
      pwdStream.on('close', () => {
        const cwd = out.trim();
        if (cwd && cwd.startsWith('/')) {
          try { webContents.send('ssh-cwd-update', cwd); } catch { }
        }
      });
    });
  }, delayMs);
  pwdTimers.set(wcId, timer);
}

// Renderer → SSH: keyboard input
// Intercept Enter key to trigger a pwd check afterwards
ipcMain.on('ssh-input', (event, data) => {
  const wcId = event.sender.id;
  const stream = sshSessions.get(wcId);
  if (stream) stream.write(data);

  // If user pressed Enter (\r or \n or \r\n) schedule a pwd lookup
  if (data === '\r' || data === '\n' || data === '\r\n') {
    schedulePwdCheck(wcId, event.sender, 700);
  }
});

// Renderer → SSH: terminal resize
ipcMain.on('ssh-resize', (event, cols, rows) => {
  const stream = sshSessions.get(event.sender.id);
  if (stream) stream.setWindow(rows, cols, 0, 0);
});

// Explorer → Terminal: change directory in the running shell
ipcMain.on('sftp-cd', (event, remotePath) => {
  const stream = sshSessions.get(event.sender.id);
  if (stream) {
    // Write cd command into the live shell
    stream.write(`cd ${remotePath}\r`);
    // Schedule a pwd check to confirm
    schedulePwdCheck(event.sender.id, event.sender, 400);
  }
});

ipcMain.handle('open-ssh', async (_event, sftpConfig, projectName, projectPath) => {
  try {
    if (projectPath) lastOpenedProjectPath = projectPath;
    createSshTerminal(sftpConfig, projectName || '');
    hideWindow();
    return { success: true };
  } catch (err) {
    console.error('[QuickZack] open-ssh error:', err.message);
    return { success: false, error: err.message };
  }
});

// ─── SFTP File Explorer IPC Handlers ──────────────────────────────────────────

function getSftp(wcId) {
  const sftp = sftpClients.get(wcId);
  if (!sftp) throw new Error('SFTP not connected');
  return sftp;
}

// List directory
ipcMain.handle('sftp-list', (event, remotePath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      sftp.readdir(remotePath, (err, list) => {
        if (err) { reject(err); return; }
        const entries = list.map(item => ({
          name: item.filename,
          isDir: item.attrs && (item.attrs.mode & 0o40000) !== 0,
          size: item.attrs ? item.attrs.size : 0,
          mtime: item.attrs ? item.attrs.mtime : 0,
        }));
        resolve(entries);
      });
    } catch (err) {
      reject(err);
    }
  });
});

// Download file → base64
ipcMain.handle('sftp-download', (event, remotePath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      const chunks = [];
      const stream = sftp.createReadStream(remotePath);
      stream.on('data', (chunk) => chunks.push(chunk));
      stream.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(buf.toString('base64'));
      });
      stream.on('error', reject);
    } catch (err) {
      reject(err);
    }
  });
});

// Upload file from base64
ipcMain.handle('sftp-upload', (event, remotePath, b64Content) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      const buf = Buffer.from(b64Content, 'base64');
      const stream = sftp.createWriteStream(remotePath);
      stream.on('close', () => resolve({ success: true }));
      stream.on('error', reject);
      stream.end(buf);
    } catch (err) {
      reject(err);
    }
  });
});

// Delete file
ipcMain.handle('sftp-delete', (event, remotePath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      sftp.unlink(remotePath, (err) => {
        if (err) {
          // Try rmdir if it's a directory
          sftp.rmdir(remotePath, (err2) => {
            if (err2) reject(err); else resolve({ success: true });
          });
        } else {
          resolve({ success: true });
        }
      });
    } catch (err) {
      reject(err);
    }
  });
});

// Create directory
ipcMain.handle('sftp-mkdir', (event, remotePath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      sftp.mkdir(remotePath, (err) => {
        if (err) { reject(err); return; }
        resolve({ success: true });
      });
    } catch (err) {
      reject(err);
    }
  });
});

// Create empty file (touch)
ipcMain.handle('sftp-touch', (event, remotePath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      // Open for writing (O_CREAT|O_WRONLY|O_TRUNC = 0x202 = 514)
      sftp.open(remotePath, 'w', (err, handle) => {
        if (err) { reject(err); return; }
        sftp.close(handle, (err2) => {
          if (err2) { reject(err2); return; }
          resolve({ success: true });
        });
      });
    } catch (err) {
      reject(err);
    }
  });
});

// Rename / move file or folder
ipcMain.handle('sftp-rename', (event, oldPath, newPath) => {
  return new Promise((resolve, reject) => {
    try {
      const sftp = getSftp(event.sender.id);
      sftp.rename(oldPath, newPath, (err) => {
        if (err) { reject(err); return; }
        resolve({ success: true });
      });
    } catch (err) {
      reject(err);
    }
  });
});

// Zip selected paths via SSH exec, SFTP download the zip, then clean up
ipcMain.handle('sftp-zip', (event, currentDir, remotePaths) => {
  return new Promise((resolve, reject) => {
    const wcId = event.sender.id;
    const conn = sshConns.get(wcId);
    const sftp = sftpClients.get(wcId);
    if (!conn || !sftp) { reject(new Error('SSH not connected')); return; }

    const timestamp = Date.now();
    const archiveName = `quickzack_${timestamp}.tar.gz`;
    const archivePath = `/tmp/${archiveName}`;

    // Build quoted path list relative to currentDir
    const relPaths = remotePaths.map(p => {
      const rel = p.replace(currentDir.replace(/\/?$/, '/'), '');
      return `"${rel}"`;
    }).join(' ');

    const tarCmd = `cd "${currentDir}" && tar -czf "${archivePath}" ${relPaths}`;
    console.log('[QuickZack] TAR CMD:', tarCmd);

    conn.exec(tarCmd, (err, execStream) => {
      if (err) { reject(err); return; }

      let stderr = '';
      // Read stdout to prevent buffer from filling and hanging the process
      execStream.on('data', (d) => { /* ignore stdout */ });
      execStream.stderr.on('data', d => stderr += d.toString());
      execStream.on('close', (code) => {
        if (code !== 0) {
          reject(new Error(`archive failed (code ${code}): ${stderr.trim() || 'tar not available on server'}`));
          return;
        }

        // Download the tar via SFTP
        const chunks = [];
        const dl = sftp.createReadStream(archivePath);
        dl.on('data', chunk => chunks.push(chunk));
        dl.on('end', () => {
          const b64 = Buffer.concat(chunks).toString('base64');
          // Clean up remote temp archive
          sftp.unlink(archivePath, () => { });
          resolve({ success: true, data: b64, filename: archiveName });
        });
        dl.on('error', reject);
      });
    });
  });
});

// ─── App Lifecycle ───────────────────────────────────────────────────────────

// Prevent multiple instances
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    showWindow();
  });
}

function registerShortcut(shortcut) {
  globalShortcut.unregisterAll();
  const registered = globalShortcut.register(shortcut, () => {
    if (win && win.isVisible()) {
      hideWindow();
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

// ─── Config File Watcher ─────────────────────────────────────────────────────

function watchConfig() {
  let debounceTimer = null;

  fs.watch(CONFIG_PATH, (eventType) => {
    if (eventType !== 'change') return;

    // Debounce — Notepad fires multiple events on save
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(async () => {
      const newConfig = loadConfig();

      // Re-register shortcut if it changed
      if (newConfig.shortcut !== config.shortcut) {
        registerShortcut(newConfig.shortcut || 'Alt+Space');
      }

      config = newConfig;
      console.log('[QuickZack] Config reloaded:', CONFIG_PATH);

      // Rebuild tray menu with new path/shortcut info
      if (tray) tray.setContextMenu(buildTrayMenu());

      // Rescan with new projects_path
      await refreshProjects();

      // Push updated projects to renderer
      if (win) {
        win.webContents.send('projects-updated', projectCache);
        win.webContents.send('config-updated', config);
      }

      console.log(`[QuickZack] Auto-rescanned: ${projectCache.length} projects found.`);
    }, 500);
  });

  console.log('[QuickZack] Watching config for changes:', CONFIG_PATH);
}

// ─── Git Commit Scheduler ────────────────────────────────────────────────────

function startRandomScheduler() {

  const waitMinutes = [10, 15, 20, 30, 45, 60];
  const selectedMinutes = waitMinutes[Math.floor(Math.random() * waitMinutes.length)];
  const delayMs = selectedMinutes * 60 * 1000;

  setTimeout(async () => {
    const dirtyProjects = projectCache.filter(p => p.gitStatus && p.gitStatus.isDirty);

    if (dirtyProjects.length > 0) {

      let project = dirtyProjects.find(p => p.path === lastOpenedProjectPath);

      if (!project) {
        project = dirtyProjects[Math.floor(Math.random() * dirtyProjects.length)];
      }

      if (Notification.isSupported()) {
        const branchString = project.gitStatus.branch ? ` (${project.gitStatus.branch})` : '';
        const notif = new Notification({
          title: 'Commit Reminder! ⚡',
          body: `Your project "${project.name}"${branchString} has uncommitted changes. Please commit today!`,
          icon: path.join(__dirname, 'tray-icon.png'),
          silent: false
        });

        notif.on('click', () => {
          showWindow();
        });

        notif.show();
      }
    }

    startRandomScheduler();
  }, delayMs);

  console.log(`[QuickZack] Next git reminder scheduled in ${selectedMinutes} minutes.`);
}

app.whenReady().then(async () => {
  // Hide from dock on macOS — this is a tray-only app
  if (process.platform === 'darwin') {
    app.dock.hide();
  }

  // Set Windows taskbar app identity (Win32-only, harmless no-op elsewhere)
  if (process.platform === 'win32') {
    app.setAppUserModelId('com.quickzack.launcher');
  }

  createWindow();
  createTray();

  // Register global shortcut
  registerShortcut(config.shortcut || 'Alt+Space');

  // Pre-scan on startup
  await refreshProjects();

  // Watch config for live reload
  watchConfig();

  // Start Git Scheduler
  startRandomScheduler();

  // Initial check for updates and start background updater scheduler
  autoUpdater.checkForUpdates();
  setInterval(() => {
    autoUpdater.checkForUpdates();
  }, 2 * 60 * 60 * 1000);

  // Show starting notification
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

  console.log('[QuickZack] Ready. Press', config.shortcut || 'Alt+Space', 'to open.');
});

app.on('window-all-closed', (e) => {
  // Keep app running in tray
  e.preventDefault();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
