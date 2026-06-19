const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const os = require('os');

const FTP_CONFIG_PATH = path.join(app.getPath('userData'), 'quickzack-ftps.json');

function getKey() {
  const salt = app.getPath('userData') + os.hostname() + (os.userInfo().username || '');
  return crypto.scryptSync(salt, 'quickzack-salt', 32);
}

function encrypt(text) {
  if (!text) return '';
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-cbc', getKey(), iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return iv.toString('hex') + ':' + encrypted;
}

function decrypt(text) {
  if (!text) return '';
  const parts = text.split(':');
  if (parts.length !== 2) return '';
  try {
    const iv = Buffer.from(parts[0], 'hex');
    const encrypted = parts[1];
    const decipher = crypto.createDecipheriv('aes-256-cbc', getKey(), iv);
    let decrypted = decipher.update(encrypted, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch {
    return '';
  }
}

function loadFtps() {
  if (!fs.existsSync(FTP_CONFIG_PATH)) return [];
  try {
    const raw = fs.readFileSync(FTP_CONFIG_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveFtps(ftps) {
  fs.writeFileSync(FTP_CONFIG_PATH, JSON.stringify(ftps, null, 2), 'utf-8');
}

module.exports = {
  loadFtps,
  saveFtps,
  encrypt,
  decrypt,
  FTP_CONFIG_PATH
};
