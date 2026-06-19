const { ipcMain, dialog } = require('electron');
const fs = require('fs');
const { exec } = require('child_process');
const shared = require('./shared');
const { showWindow, hideWindow } = require('./window');
const { refreshProjects } = require('./projects');
const { createSshTerminal } = require('./ssh');

function setupMainIpc() {
  ipcMain.handle('get-projects', async () => {
    if (shared.projectCache.length === 0) {
      await refreshProjects();
    }
    return shared.projectCache;
  });

  ipcMain.handle('rescan-projects', async () => {
    await refreshProjects();
    return shared.projectCache;
  });

  ipcMain.handle('get-config', () => {
    return shared.config;
  });

  ipcMain.handle('open-project', async (_event, projectPath) => {
    const cmd = shared.config.editor_command;
    let fullCmd;
    if (cmd.includes('{path}')) {
      fullCmd = cmd.replace('{path}', `"${projectPath}"`);
    } else {
      fullCmd = `${cmd} "${projectPath}"`;
    }

    shared.lastOpenedProjectPath = projectPath;
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
      const escapedPath = projectPath.replace(/\//g, '\\');
      fullCmd = `start powershell.exe -NoExit -WorkingDirectory "${escapedPath}"`;
    } else if (process.platform === 'darwin') {
      fullCmd = `open -a Terminal "${projectPath}"`;
    } else {
      fullCmd = `x-terminal-emulator --working-directory="${projectPath}"`;
    }

    shared.lastOpenedProjectPath = projectPath;
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

  ipcMain.handle('open-ssh', async (_event, sftpConfig, projectName, projectPath) => {
    try {
      if (projectPath) shared.lastOpenedProjectPath = projectPath;
      createSshTerminal(sftpConfig, projectName || '');
      hideWindow();
      return { success: true };
    } catch (err) {
      console.error('[QuickZack] open-ssh error:', err.message);
      return { success: false, error: err.message };
    }
  });

  ipcMain.handle('show-save-dialog', async (event, filename) => {
    const result = await dialog.showSaveDialog({
      defaultPath: filename,
      title: 'Download File'
    });
    return result;
  });

  ipcMain.handle('move-local-file', async (event, oldPath, newPath) => {
    try {
      fs.renameSync(oldPath, newPath);
      return { success: true };
    } catch (err) {
      try {
        fs.copyFileSync(oldPath, newPath);
        fs.unlinkSync(oldPath);
        return { success: true };
      } catch (err2) {
        throw err2;
      }
    }
  });
}

module.exports = { setupMainIpc };
