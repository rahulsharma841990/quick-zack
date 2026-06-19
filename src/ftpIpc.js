const { ipcMain, dialog } = require('electron');
const { loadFtps, saveFtps, encrypt, decrypt } = require('./ftpStore');
const { createSshTerminal } = require('./ssh');
const path = require('path');
const fs = require('fs');

function setupFtpIpc() {
  ipcMain.handle('ftp-list', () => {
    const ftps = loadFtps();
    return ftps.map(f => ({
      ...f,
      password: decrypt(f.password)
    }));
  });

  ipcMain.handle('ftp-save', (_event, ftp) => {
    const ftps = loadFtps();
    const encryptedFtp = {
      ...ftp,
      password: encrypt(ftp.password)
    };

    if (ftp.id) {
      const idx = ftps.findIndex(f => f.id === ftp.id);
      if (idx >= 0) {
        ftps[idx] = encryptedFtp;
      } else {
        ftps.push(encryptedFtp);
      }
    } else {
      encryptedFtp.id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
      ftps.push(encryptedFtp);
    }
    saveFtps(ftps);
    return { ...encryptedFtp, password: decrypt(encryptedFtp.password) };
  });

  ipcMain.handle('ftp-delete', (_event, id) => {
    const ftps = loadFtps().filter(f => f.id !== id);
    saveFtps(ftps);
    return { success: true };
  });

  ipcMain.handle('ftp-export', async () => {
    const ftps = loadFtps().map(f => ({
      ...f,
      password: decrypt(f.password)
    }));

    const result = await dialog.showSaveDialog({
      defaultPath: 'quickzack-ftps-export.json',
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!result.canceled && result.filePath) {
      fs.writeFileSync(result.filePath, JSON.stringify(ftps, null, 2), 'utf-8');
      return { success: true, path: result.filePath };
    }
    return { success: false };
  });

  ipcMain.handle('ftp-import', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: [{ name: 'JSON', extensions: ['json'] }]
    });

    if (!result.canceled && result.filePaths.length > 0) {
      const raw = fs.readFileSync(result.filePaths[0], 'utf-8');
      const imported = JSON.parse(raw);
      if (Array.isArray(imported)) {
        const encrypted = imported.map(f => ({
          ...f,
          password: encrypt(f.password)
        }));
        saveFtps(encrypted);
        return { success: true, count: encrypted.length };
      }
    }
    return { success: false };
  });

  ipcMain.handle('ftp-connect', (_event, ftp) => {
    const sftpConfig = {
      host: ftp.host,
      port: ftp.port || 22,
      username: ftp.username,
      password: ftp.password
    };
    createSshTerminal(sftpConfig, ftp.name || `${ftp.username}@${ftp.host}`);
    return { success: true };
  });
}

module.exports = { setupFtpIpc };
