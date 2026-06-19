const fs = require('fs');
const path = require('path');
const os = require('os');
const shared = require('./shared');

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

  if (!fs.existsSync(shared.CONFIG_PATH)) {
    try {
      const bundledPath = path.join(__dirname, '..', 'config.json');
      if (fs.existsSync(bundledPath)) {
        const bundledData = fs.readFileSync(bundledPath, 'utf-8');
        fs.writeFileSync(shared.CONFIG_PATH, bundledData, 'utf-8');
      } else {
        fs.writeFileSync(shared.CONFIG_PATH, JSON.stringify(defaultSettings, null, 2), 'utf-8');
      }
    } catch (e) {
      console.error('[QuickZack] Could not create initial config:', e.message);
    }
  }

  try {
    const raw = fs.readFileSync(shared.CONFIG_PATH, 'utf-8');
    shared.config = JSON.parse(raw);
  } catch (err) {
    console.error('[QuickZack] Failed to load config:', err.message);
    shared.config = defaultSettings;
  }

  return shared.config;
}

module.exports = { loadConfig };
