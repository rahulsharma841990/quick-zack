const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const os = require('os');

const NOTES_PATH = path.join(app.getPath('userData'), 'quickzack-notes.json');

function getKey() {
  const salt = app.getPath('userData') + os.hostname() + (os.userInfo().username || '') + '-notes';
  return crypto.scryptSync(salt, 'quickzack-salt-v2', 32);
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

function loadNotes() {
  if (!fs.existsSync(NOTES_PATH)) return [];
  try {
    const raw = fs.readFileSync(NOTES_PATH, 'utf-8');
    const data = JSON.parse(raw);
    return Array.isArray(data) ? data : [];
  } catch {
    return [];
  }
}

function saveNotes(notes) {
  fs.writeFileSync(NOTES_PATH, JSON.stringify(notes, null, 2), 'utf-8');
}

function encryptNote(note) {
  return {
    ...note,
    title: encrypt(note.title),
    content: encrypt(note.content)
  };
}

function decryptNote(note) {
  return {
    ...note,
    title: decrypt(note.title),
    content: decrypt(note.content)
  };
}

module.exports = {
  loadNotes,
  saveNotes,
  encryptNote,
  decryptNote,
  NOTES_PATH
};
