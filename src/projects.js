const fs = require('fs');
const path = require('path');
const { exec } = require('child_process');
const util = require('util');
const execAsync = util.promisify(exec);
const shared = require('./shared');

async function runGit(args, cwd, timeoutMs = 3000) {
  for (const gitBin of shared.GIT_CANDIDATES) {
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
    if (content.startsWith('ref: refs/heads/')) {
      return content.replace('ref: refs/heads/', '');
    }
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

async function scanProjects() {
  const projectsPath = shared.config.projects_path;
  const excluded = new Set(shared.config.exclude_folders || []);

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

async function refreshProjects() {
  shared.projectCache = await scanProjects();
  return shared.projectCache;
}

module.exports = {
  scanProjects,
  refreshProjects,
  getGitStatus,
  detectProjectType
};
