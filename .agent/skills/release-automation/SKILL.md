# Release Automation Skill

Automates the complete release process for Electron applications: version bumping, multi-platform builds, GitHub releases, and documentation updates.

## Usage

```
/release [options]
```

## Options

- `--version <version>` - Specify version (default: increment patch)
- `--branch <name>` - Release branch name pattern (default: `release/v{version}`)
- `--skip-build` - Skip building artifacts
- `--skip-release` - Skip GitHub release creation
- `--dry-run` - Show what would be done without doing it

## Workflow

1. Pull latest from origin/master
2. Create release branch
3. Build for Windows and macOS
4. Create GitHub release with assets
5. Update README.md with new download links
6. Update landing page with new download links
7. Commit and push changes
8. Create Pull Request

## Requirements

- GitHub CLI (`gh`) installed and authenticated
- Node.js/npm for building
- Electron builder configured
- Apple Developer account (for macOS builds, can skip notarization)
- Write access to repository

## Example

```
/release --version 1.4.3
```

Creates a full release for v1.4.3 with builds, GitHub release, updated docs, and PR.