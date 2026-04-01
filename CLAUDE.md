# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

QuickZack is an Electron-based desktop application that acts as a global shortcut-powered project launcher for developers. It scans a configured projects directory and allows users to quickly open projects in their preferred editor using fuzzy search.

**Tech Stack:**
- Electron 28 (Node.js runtime)
- Vanilla JavaScript (no frameworks in renderer)
- Fuse.js for fuzzy search
- electron-builder for packaging
- Cross-platform: Windows (NSIS + Portable) and macOS (DMG + ZIP)

## Repository Structure

```
quick-zack/
├── main.js          # Main process (403 lines): tray, global shortcuts, IPC, window management, project scanning
├── preload.js       # Secure context bridge exposing limited API to renderer
├── index.html       # Renderer UI with embedded CSS and JavaScript (single-file app)
├── config.json      # Default configuration bundled with app
├── tray-icon.png    # System tray icon
├── assets/
│   └── icon.ico     # Installer/app icons (Windows)
├── landing/         # Marketing/download landing page
│   └── index.html
├── dist/            # Build outputs (gitignored but present)
└── node_modules/
```

**Key Architecture Patterns:**

1. **Main-Renderer IPC**: `main.js` handles all system operations (tray, shortcuts, file scanning, spawning editor). Renderer calls via `window.api.*()` exposed through `preload.js`.

2. **Configuration**: Loaded from user's app data directory (`app.getPath('userData')`). On first run, `config.json` is copied there. Config is live-reloaded via IPC event.

3. **Project Scanning**: Async recursive scan of `projects_path` with configurable `max_depth`. Detects project types by checking for marker files (`package.json`, `composer.json`, etc.).

4. **Window Management**: Frameless, transparent window that shows/hides on global shortcut. Auto-hides on blur (loses focus). Centered horizontally, positioned at 22% from top.

5. **Global Shortcut**: `globalShortcut.register()` in main process. Windows uses double-click on tray; macOS uses single-click.

## Development Setup

### Prerequisites
- Node.js 18+
- npm

### Installation
```bash
npm install
```

### Common Commands

**Development:**
```bash
npm run dev          # Start with DevTools open (--dev flag)
npm start            # Start normally without DevTools
```

**Building:**
```bash
npm run build        # Build Windows installer (NSIS + portable)
npm run build:mac    # Build macOS (DMG + ZIP, both architectures)
npm run build:all    # Build for both platforms
npm run build:dir    # Build without installer (unpacked folder)
```

**During Development:**
- The app writes user config to:
  - Windows: `%APPDATA%/quickzack-config.json` or similar
  - macOS: `~/Library/Application Support/quickzack-config.json`
  - Linux: `~/.config/quickzack-config.json`
- Edit config via tray menu → "Edit config.json"
- Force rescan from tray menu → "Rescan Projects"

## Testing Strategy

**No automated tests exist yet.** Manual testing approach:

1. **Functional Testing:**
   - Press `Alt+Space` → search for projects → open with editor
   - Tray menu operations (rescan, edit config, quit)
   - Config live-reload (edit config.json, rescan should reflect changes)
   - Project type detection (create test folders with marker files)

2. **Platform-Specific:**
   - Windows: Test installer and portable versions
   - macOS: Test DMG installation, Gatekeeper bypass, menu bar vs dock behavior
   - Verify global shortcut doesn't conflict with system shortcuts

3. **Boundary Cases:**
   - Empty projects folder
   - Deep nesting (test `max_depth`)
   - Excluded folders (`.git`, `node_modules`, etc.)
   - Long project names, special characters

## Code Style & Conventions

- **Main Process (`main.js`)**: Top-heavy with setup sections (Config, Scanner, Window, Tray, IPC). Functions are named camelCase. Heavy use of async/await with callbacks for fs operations.
- **Renderer (`index.html`)**: Single-file app. CSS in `<style>`, JavaScript in `<script>`. Uses Fuse.js via CDN from `index.html`. Search logic inline.
- **Comments**: Clear section headers with horizontal rules (e.g., `// ─── Window ──────────────────────────────────────`).
- **Error Handling**: Console logging with `[QuickZack]` prefix. Graceful degradation with default config on parse errors.
- **IPC**: Pattern: `ipcRenderer.invoke('channel', args)` / `ipcMain.handle('channel', handler)`. Events for pub/sub (`ipcRenderer.on` / `ipcMain.emit`).

## Known Considerations

1. **Security**: `contextIsolation: true`, `nodeIntegration: false`, but `sandbox: false`. Renderer uses Fuse.js from CDN (no local bundling).
2. **Packaging**: electron-builder includes `node_modules/**/*` which is heavy (~80MB). Consider pruning in future.
3. **Config Path**: Hard-coded to userData directory; user edits config via Notepad (Windows) or TextEdit (macOS). No validation UI.
4. **Global Shortcut Conflicts**: User must configure shortcut that doesn't conflict with OS/app shortcuts. No conflict detection.
5. **Project Type Detection**: Simple marker file check. Could miss hybrid projects (e.g., both `package.json` and `composer.json`). Returns first match in fixed order.
6. **Fuzzy Search**: Client-side on entire project list. Performance fine for hundreds of projects; could degrade with thousands.
7. **Window Behavior**: Auto-hides on blur; might frustrate users who want to copy/paste from it. No pin/always-on-top toggle.

## Making Changes

### To modify the UI (renderer)
Edit `index.html`:
- Styles in `<style>` tag (CSS variables for theming)
- Search logic in inline `<script>` after the HTML
- Fuse.js loaded from CDN - version pinned at 7.0.0

### To modify system behavior (main process)
Edit `main.js`:
- Config loading at top
- `scanProjects()` and `detectProjectType()` for project discovery
- `createWindow()` / `createTray()` for UI lifecycle
- IPC handlers at bottom responding to renderer calls
- Global shortcut registration on `app.on('ready')`

### To change default config
Edit bundled `config.json`. Values are merged with defaults in `loadConfig()` in `main.js`.

### To add new project type detection
Update `detectProjectType()` in `main.js`. Add condition checking for marker file. Return a short identifier string (used as icon emoji in UI? - actually UI doesn't use type currently, only stored).

### To modify build configuration
Edit the `build` section in `package.json` (electron-builder config). Targets, icons, installer options are there.

## Distribution & Releasing

Release workflow:

1. Update version in `package.json` and README badges/links.
2. Build for all targets: `npm run build:all`
3. Find installers in `dist/` directory.
4. Upload to GitHub Releases; update download links in README.md and `landing/index.html`.
5. Commit and tag the release.

The GitHub Actions workflow likely exists in `.github/workflows/` (not present yet). Manual release is current process.

## Configuration Details

User `config.json` structure:
```json
{
  "projects_path": "~/Projects|C:/path",
  "editor_command": "code|phpstorm|subl|path {path}",
  "shortcut": "Alt+Space|Command+Space|etc",
  "max_depth": 1,
  "exclude_folders": [".git", "node_modules", ".vs", "__pycache__", ".idea", "vendor", ".DS_Store"]
}
```

Editor command supports `{path}` placeholder for custom commands (e.g., `notepad++ {path}`). Without `{path}`, the project folder path is appended.

## Debugging

- Run with `npm run dev` to open DevTools automatically.
- Main process logs to console (visible in DevTools console via `console.log`). Use `[QuickZack]` prefix in your logs.
- Tray menu → "Rescan Projects" forces a fresh scan (bypasses cache).
- Delete user config to reset to defaults: remove `quickzack-config.json` from userData.
- Build outputs in `dist/`. Clean before building if having issues: `rm -rf dist` (or delete manually).

## Important Files to Read

- `main.js` - entire file (~403 lines) for main process understanding
- `preload.js` - context bridge API (short, 37 lines)
- `index.html` - renderer implementation (inline JS ~line 250+)
- `README.md` - user-facing docs, also explains architecture at high level
- `package.json` - scripts, dependencies, build config

## Notes for Contributors

- This is a utility app focused on **speed and simplicity**. Avoid feature creep.
- Keep dependencies minimal (already only Fuse.js at runtime).
- Maintain cross-platform compatibility (Windows/macOS). Use `path` module, not string concatenation. Respect platform conventions (tray double-click vs click).
- Configuration is intentionally simple JSON. No settings UI.
- The app is currently at v1.1.0 with stable Windows and macOS support.
