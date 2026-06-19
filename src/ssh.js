const { BrowserWindow, ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');
const { Client: SshClient } = require('ssh2');
const shared = require('./shared');
const { hideWindow } = require('./window');

function getSftp(wcId) {
  const sftp = shared.sftpClients.get(wcId);
  if (!sftp) throw new Error('SFTP not connected');
  return sftp;
}

// ─── SSH Terminal Window ────────────────────────────────────────────────────

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
      preload: path.join(__dirname, '..', 'preload-terminal.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    },
    icon: path.join(__dirname, '..', 'assets', 'icon.png')
  });

  termWin.setMenu(null);

  const wcId = termWin.webContents.id;

  termWin.loadFile('terminal.html');

  const conn = new SshClient();
  let pageReady = false;
  const pendingEvents = [];

  function safeSend(channel, ...args) {
    if (pageReady) {
      try { termWin.webContents.send(channel, ...args); } catch { }
    } else {
      pendingEvents.push({ channel, args });
    }
  }

  conn
    .on('ready', () => {
      shared.sshConns.set(wcId, conn);

      conn.sftp((sftpErr, sftp) => {
        if (!sftpErr && sftp) {
          shared.sftpClients.set(wcId, sftp);
          sftp.on('close', () => shared.sftpClients.delete(wcId));
        }

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

          shared.sshSessions.set(wcId, stream);

          stream.on('data', (data) => {
            safeSend('ssh-data', data.toString('utf8'));
          });

          stream.stderr.on('data', (data) => {
            safeSend('ssh-data', data.toString('utf8'));
          });

          stream.on('close', () => {
            safeSend('ssh-closed');
            shared.sshSessions.delete(wcId);
            clearInterval(shared.statTimers.get(wcId));
            shared.statTimers.delete(wcId);
            try { conn.end(); } catch { }
          });
        }
      );

      const pollTimer = setInterval(() => {
        const c = shared.sshConns.get(wcId);
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
      shared.statTimers.set(wcId, pollTimer);

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

  termWin.webContents.on('did-finish-load', () => {
    termWin.setTitle(windowTitle);
    pageReady = true;
    for (const { channel, args } of pendingEvents) {
      try { termWin.webContents.send(channel, ...args); } catch { }
    }
    pendingEvents.length = 0;
  });

  termWin.on('closed', () => {
    const stream = shared.sshSessions.get(wcId);
    if (stream) {
      try { stream.close(); } catch { }
      shared.sshSessions.delete(wcId);
    }
    const sftp = shared.sftpClients.get(wcId);
    if (sftp) {
      try { sftp.end(); } catch { }
      shared.sftpClients.delete(wcId);
    }
    shared.sshConns.delete(wcId);
    shared.activeExplorerPaths.delete(wcId);
    clearInterval(shared.statTimers.get(wcId));
    shared.statTimers.delete(wcId);
    clearTimeout(shared.pwdTimers.get(wcId));
    shared.pwdTimers.delete(wcId);
    try { conn.end(); } catch { }
  });

  return termWin;
}

function schedulePwdCheck(wcId, webContents, delayMs = 600) {
  clearTimeout(shared.pwdTimers.get(wcId));
  const timer = setTimeout(() => {
    const conn = shared.sshConns.get(wcId);
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
  shared.pwdTimers.set(wcId, timer);
}

// ─── SSH IPC Handlers ───────────────────────────────────────────────────────

function setupSshIpc() {
  ipcMain.on('ssh-input', (event, data) => {
    const wcId = event.sender.id;
    const stream = shared.sshSessions.get(wcId);
    if (stream) stream.write(data);
    if (data === '\r' || data === '\n' || data === '\r\n') {
      schedulePwdCheck(wcId, event.sender, 700);
    }
  });

  ipcMain.on('ssh-resize', (event, cols, rows) => {
    const stream = shared.sshSessions.get(event.sender.id);
    if (stream) stream.setWindow(rows, cols, 0, 0);
  });

  ipcMain.on('sftp-cd', (event, remotePath) => {
    const stream = shared.sshSessions.get(event.sender.id);
    if (stream) {
      stream.write(`cd ${remotePath}\r`);
      schedulePwdCheck(event.sender.id, event.sender, 400);
    }
  });
}

// ─── SFTP IPC Handlers ──────────────────────────────────────────────────────

function setupSftpIpc() {
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
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-download', (event, remotePath, localPath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        let total = 0;
        let transferred = 0;
        let lastProgress = 0;

        shared.activeTransfers.set(event.sender.id, { type: 'download', remotePath, localPath });
        const cleanup = () => shared.activeTransfers.delete(event.sender.id);

        const sendProgress = () => {
          event.sender.send('sftp-progress', {
            type: 'download',
            path: remotePath,
            transferred,
            total
          });
        };

        sftp.fastGet(remotePath, localPath, {
          concurrency: 64,
          chunkSize: 32768,
          step: (total_transferred, chunk, totalSize) => {
            transferred = total_transferred;
            total = totalSize;
            const now = Date.now();
            if (now - lastProgress > 200) {
              lastProgress = now;
              sendProgress();
            }
          }
        }, (err) => {
          cleanup();
          if (err) {
            try { fs.unlinkSync(localPath); } catch {}
            reject(err);
          } else {
            sendProgress();
            resolve({ success: true });
          }
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-read-file', (event, remotePath) => {
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
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-upload', (event, remotePath, localPath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        let total = 0;
        let transferred = 0;
        let lastProgress = 0;

        shared.activeTransfers.set(event.sender.id, { type: 'upload', remotePath, localPath });
        const cleanup = () => shared.activeTransfers.delete(event.sender.id);

        const sendProgress = () => {
          event.sender.send('sftp-progress', {
            type: 'upload',
            path: remotePath,
            transferred,
            total
          });
        };

        sftp.fastPut(localPath, remotePath, {
          concurrency: 64,
          chunkSize: 32768,
          step: (total_transferred, chunk, totalSize) => {
            transferred = total_transferred;
            total = totalSize;
            const now = Date.now();
            if (now - lastProgress > 200) {
              lastProgress = now;
              sendProgress();
            }
          }
        }, (err) => {
          cleanup();
          if (err) {
            reject(err);
          } else {
            sendProgress();
            resolve({ success: true });
          }
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-write-file', (event, remotePath, b64Content) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        const buf = Buffer.from(b64Content, 'base64');
        const stream = sftp.createWriteStream(remotePath);
        stream.on('close', () => resolve({ success: true }));
        stream.on('error', reject);
        stream.end(buf);
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-delete', (event, remotePath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        sftp.unlink(remotePath, (err) => {
          if (err) {
            sftp.rmdir(remotePath, (err2) => {
              if (err2) reject(err); else resolve({ success: true });
            });
          } else {
            resolve({ success: true });
          }
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-mkdir', (event, remotePath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        sftp.mkdir(remotePath, (err) => {
          if (err) { reject(err); return; }
          resolve({ success: true });
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-touch', (event, remotePath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        sftp.open(remotePath, 'w', (err, handle) => {
          if (err) { reject(err); return; }
          sftp.close(handle, (err2) => {
            if (err2) { reject(err2); return; }
            resolve({ success: true });
          });
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-rename', (event, oldPath, newPath) => {
    return new Promise((resolve, reject) => {
      try {
        const sftp = getSftp(event.sender.id);
        sftp.rename(oldPath, newPath, (err) => {
          if (err) { reject(err); return; }
          resolve({ success: true });
        });
      } catch (err) { reject(err); }
    });
  });

  ipcMain.handle('sftp-zip', (event, currentDir, remotePaths) => {
    return new Promise((resolve, reject) => {
      const wcId = event.sender.id;
      const conn = shared.sshConns.get(wcId);
      const sftp = shared.sftpClients.get(wcId);
      if (!conn || !sftp) { reject(new Error('SSH not connected')); return; }

      const timestamp = Date.now();
      const archiveName = `quickzack_${timestamp}.tar.gz`;
      const archivePath = `/tmp/${archiveName}`;

      const relPaths = remotePaths.map(p => {
        const rel = p.replace(currentDir.replace(/\/?$/, '/'), '');
        return `"${rel}"`;
      }).join(' ');

      const tarCmd = `cd "${currentDir}" && tar -czf "${archivePath}" ${relPaths}`;
      console.log('[QuickZack] TAR CMD:', tarCmd);

      conn.exec(tarCmd, (err, execStream) => {
        if (err) { reject(err); return; }

        let stderr = '';
        execStream.on('data', (d) => { /* ignore stdout */ });
        execStream.stderr.on('data', d => stderr += d.toString());
        execStream.on('close', (code) => {
          if (code !== 0) {
            reject(new Error(`archive failed (code ${code}): ${stderr.trim() || 'tar not available on server'}`));
            return;
          }

          const tempPath = path.join(require('electron').app.getPath('temp'), archiveName);
          const writeStream = fs.createWriteStream(tempPath);
          const dl = sftp.createReadStream(archivePath);

          dl.on('error', reject);
          writeStream.on('error', reject);
          writeStream.on('finish', () => {
            sftp.unlink(archivePath, () => { });
            resolve({ success: true, localPath: tempPath, filename: archiveName });
          });

          dl.pipe(writeStream);
        });
      });
    });
  });

  ipcMain.handle('sftp-cancel', (event) => {
    const ts = shared.activeTransfers.get(event.sender.id);
    if (ts) {
      shared.activeTransfers.delete(event.sender.id);
      return { success: true };
    }
    return { success: false };
  });
}

module.exports = {
  createSshTerminal,
  setupSshIpc,
  setupSftpIpc
};
