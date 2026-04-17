# Release Automation

Automates the complete release process for Electron applications: version bumping, multi-platform builds, GitHub releases, and documentation updates.

## When to Use This Skill

Use this skill when the user:
- Wants to create a new release for an Electron application
- Needs to automate version bumping and building
- Wants to create GitHub releases with build artifacts
- Needs to update documentation with new download links
- Wants to automate the full release workflow with a single command

## Prerequisites

Before using this skill, ensure:
- GitHub CLI (`gh`) is installed and authenticated
- Node.js/npm is available for building
- Electron builder is configured in the project
- You have write access to the repository
- (Optional) Apple Developer account for macOS notarization

## Release Workflow

### Step 1: Prepare and Validate

1. **Check current state**
   - Verify you're on the correct branch (usually `master` or `main`)
   - Ensure working directory is clean
   - Pull latest changes from origin

2. **Determine version**
   - If version specified: use it
   - If not specified: increment patch version (e.g., 1.4.2 → 1.4.3)
   - Validate version format (semver: MAJOR.MINOR.PATCH)

### Step 2: Create Release Branch

1. Create release branch with pattern: `release/v{version}`
   - Example: `release/v1.4.3`
2. Switch to the release branch

### Step 3: Update Version

1. Update version in `package.json`
2. Update version in any other config files (e.g., `electron-builder.yml`)
3. Commit version changes with message: `chore: bump version to {version}`

### Step 4: Build Artifacts (skip if --skip-build)

1. **Build for Windows**
   ```bash
   npm run build:win
   ```
   or
   ```bash
   npx electron-builder --win
   ```

2. **Build for macOS**
   ```bash
   npm run build:mac
   ```
   or
   ```bash
   npx electron-builder --mac
   ```

3. Verify build artifacts are created in the `dist/` directory
   - Windows: `.exe` installer, `.nsis` files
   - macOS: `.dmg`, `.app` (or `.zip`)

### Step 5: Create GitHub Release (skip if --skip-release)

1. **Create GitHub release**
   ```bash
   gh release create v{version} \
     --title "v{version}" \
     --notes "Release v{version}" \
     dist/*.exe dist/*.dmg dist/*.zip
   ```

2. Or create with custom release notes from a file:
   ```bash
   gh release create v{version} \
     --title "v{version}" \
     --notes-file RELEASE_NOTES.md \
     dist/*.exe dist/*.dmg dist/*.zip
   ```

### Step 6: Update Documentation

1. **Update README.md**
   - Find download links section
   - Update version numbers in download URLs
   - Update checksums if applicable
   - Commit with message: `docs: update download links for v{version}`

2. **Update landing page** (if applicable)
   - Locate landing page file (e.g., `docs/landing.md`, `website/index.md`)
   - Update download links with new version
   - Commit with message: `docs: update landing page for v{version}`

### Step 7: Push and Create Pull Request

1. Push release branch to origin:
   ```bash
   git push origin release/v{version}
   ```

2. Create Pull Request:
   ```bash
   gh pr create \
     --base master \
     --title "Release v{version}" \
     --body "Release v{version} with builds and documentation updates"
   ```

## Dry Run Mode

When `--dry-run` is specified:
- Show all commands that would be executed
- Show what files would be modified
- Do not actually execute any commands
- Do not make any changes to the repository

## Error Handling

If any step fails:
1. Stop the workflow immediately
2. Report the error clearly to the user
3. Provide guidance on how to fix the issue
4. Offer to retry from the failed step

## Common Issues and Solutions

### Build Failures
- **Issue**: Electron builder fails
- **Solution**: Check `electron-builder.yml` configuration, ensure all dependencies are installed

### GitHub Authentication
- **Issue**: `gh` command fails with auth error
- **Solution**: Run `gh auth login` to re-authenticate

### Version Conflicts
- **Issue**: Version already exists as a tag
- **Solution**: Check existing tags with `gh release list`, use a different version

### Permission Errors
- **Issue**: Cannot push to repository
- **Solution**: Verify you have write access, check SSH key configuration

## Example Commands

### Full release with auto-version:
```
/release
```
This will increment patch version and run full workflow.

### Specific version:
```
/release --version 1.5.0
```
This will release version 1.5.0.

### Skip build (use existing artifacts):
```
/release --skip-build
```

### Dry run to preview:
```
/release --dry-run
```

### Custom release branch:
```
/release --branch releases/v1.4.3
```

## Safety Checks

Before executing, always verify:
1. Working directory is clean (no uncommitted changes)
2. Current branch is correct
3. Version doesn't already exist as a tag
4. Build artifacts exist (if not skipping build)
5. GitHub CLI is authenticated

## Rollback Procedure

If a release needs to be rolled back:
1. Delete the GitHub release: `gh release delete v{version}`
2. Delete the release tag: `git tag -d v{version} && git push origin :refs/tags/v{version}`
3. Close or delete the Pull Request
4. Switch back to main branch and delete release branch
