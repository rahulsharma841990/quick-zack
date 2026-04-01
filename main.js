const {
  app,
  BrowserWindow,
  globalShortcut,
  ipcMain,
  Tray,
  Menu,
  nativeImage,
  screen
} = require('electron');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { exec, execSync } = require('child_process');
const { Client: SshClient } = require('ssh2');

// Active SSH sessions: webContents.id → ssh2 Shell stream
const sshSessions = new Map();

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

async function scanProjects() {
  return new Promise((resolve) => {
    const projectsPath = config.projects_path;
    const excluded = new Set(config.exclude_folders || []);

    if (!fs.existsSync(projectsPath)) {
      console.warn(`[QuickZack] projects_path "${projectsPath}" does not exist.`);
      resolve([]);
      return;
    }

    fs.readdir(projectsPath, { withFileTypes: true }, (err, entries) => {
      if (err) {
        console.error('[QuickZack] readdir error:', err.message);
        resolve([]);
        return;
      }

      const projects = entries
        .filter((entry) => entry.isDirectory() && !excluded.has(entry.name))
        .map((entry) => {
          const fullPath = path.join(projectsPath, entry.name);
          // Check .vscode/sftp.json first (VS Code SFTP extension), then root sftp.json
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
                console.log(`[QuickZack] SFTP found: ${candidate}`);
                break;
              }
            } catch (e) {
              console.warn(`[QuickZack] Could not read ${candidate}:`, e.message);
            }
          }
          return {
            name: entry.name,
            path: fullPath.replace(/\\/g, '/'),
            // detect common project types for icon hints
            type: detectProjectType(fullPath),
            hasSftp,
            sftpConfig
          };
        });

      console.log(`[QuickZack] Found ${projects.length} projects in "${projectsPath}"`);
      resolve(projects);
    });
  });
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
    }
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
  const iconPath = path.join(__dirname, 'tray-icon.png');
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

  console.log(`[QuickZack] Opening: ${fullCmd}`);

  exec(fullCmd, (err) => {
    if (err) {
      console.error('[QuickZack] exec error:', err.message);
    }
  });

  hideWindow();
  return { success: true, command: fullCmd };
});

ipcMain.on('hide-window', () => {
  hideWindow();
});

// ─── SSH Terminal Window ─────────────────────────────────────────────────────

function createSshTerminal(sftpConfig, projectName) {
  const host     = sftpConfig.host || '';
  const port     = sftpConfig.port || 22;
  const user     = sftpConfig.username || sftpConfig.user || 'root';
  const password = sftpConfig.password || '';

  const displayName = projectName || `${user}@${host}`;
  const windowTitle = `⚡ ${displayName} — QuickZack`;

  const termWin = new BrowserWindow({
    width: 920,
    height: 580,
    minWidth: 600,
    minHeight: 380,
    title: windowTitle,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload-terminal.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Remove File / Edit / View / Window / Help menu bar
  termWin.setMenu(null);

  termWin.loadFile('terminal.html');

  const conn = new SshClient();

  termWin.webContents.on('did-finish-load', () => {
    // Ensure title stays (HTML title tag would override it otherwise)
    termWin.setTitle(windowTitle);

    conn
      .on('ready', () => {
        termWin.webContents.send('ssh-connected', {
          label:       `${user}@${host}:${port}`,
          projectName: displayName
        });

        conn.shell(
          { term: 'xterm-256color', cols: 220, rows: 50 },
          (err, stream) => {
            if (err) {
              try { termWin.webContents.send('ssh-error', err.message); } catch {}
              return;
            }

            // Store stream keyed by pre-captured wcId
            sshSessions.set(wcId, stream);

            // SSH → renderer  (guard with try/catch — window may close any time)
            stream.on('data', (data) => {
              try { termWin.webContents.send('ssh-data', data.toString('utf8')); } catch {}
            });

            stream.stderr.on('data', (data) => {
              try { termWin.webContents.send('ssh-data', data.toString('utf8')); } catch {}
            });

            stream.on('close', () => {
              try { termWin.webContents.send('ssh-closed'); } catch {}
              sshSessions.delete(wcId);
              try { conn.end(); } catch {}
            });
          }
        );
      })
      .on('error', (err) => {
        console.error('[QuickZack] SSH error:', err.message);
        try { termWin.webContents.send('ssh-error', err.message); } catch {}
      })
      .connect({
        host,
        port,
        username: user,
        password,
        // Accept any host key (same as StrictHostKeyChecking=no)
        hostVerifier: () => true,
        readyTimeout: 20000,
      });
  });

  // Capture id NOW while webContents is still alive
  const wcId = termWin.webContents.id;

  termWin.on('closed', () => {
    const stream = sshSessions.get(wcId);
    if (stream) {
      try { stream.close(); } catch {}
      sshSessions.delete(wcId);
    }
    try { conn.end(); } catch {}
  });

  return termWin;
}

// Renderer → SSH: keyboard input
ipcMain.on('ssh-input', (event, data) => {
  const stream = sshSessions.get(event.sender.id);
  if (stream) stream.write(data);
});

// Renderer → SSH: terminal resize
ipcMain.on('ssh-resize', (event, cols, rows) => {
  const stream = sshSessions.get(event.sender.id);
  if (stream) stream.setWindow(rows, cols, 0, 0);
});

ipcMain.handle('open-ssh', async (_event, sftpConfig, projectName) => {
  try {
    createSshTerminal(sftpConfig, projectName || '');
    hideWindow();
    return { success: true };
  } catch (err) {
    console.error('[QuickZack] open-ssh error:', err.message);
    return { success: false, error: err.message };
  }
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
