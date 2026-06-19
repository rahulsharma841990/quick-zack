const { Notification } = require('electron');
const path = require('path');
const shared = require('./shared');
const { showWindow } = require('./window');

function startRandomScheduler() {
  const waitMinutes = [10, 15, 20, 30, 45, 60];
  const selectedMinutes = waitMinutes[Math.floor(Math.random() * waitMinutes.length)];
  const delayMs = selectedMinutes * 60 * 1000;

  setTimeout(async () => {
    const dirtyProjects = shared.projectCache.filter(p => p.gitStatus && p.gitStatus.isDirty);

    if (dirtyProjects.length > 0) {
      let project = dirtyProjects.find(p => p.path === shared.lastOpenedProjectPath);

      if (!project) {
        project = dirtyProjects[Math.floor(Math.random() * dirtyProjects.length)];
      }

      if (Notification.isSupported()) {
        const branchString = project.gitStatus.branch ? ` (${project.gitStatus.branch})` : '';
        const notif = new Notification({
          title: 'Commit Reminder! ⚡',
          body: `Your project "${project.name}"${branchString} has uncommitted changes. Please commit today!`,
          icon: path.join(__dirname, '..', 'tray-icon.png'),
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

module.exports = { startRandomScheduler };
