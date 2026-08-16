# Releasing (maintainer notes)

Releases are automated with [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`).

1. Land changes on `main` using conventional commits — `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major. Commits only bump the package whose files they touch. `docs:`/`chore:`/`test:` don't trigger releases.
2. The bot keeps a `chore: release` PR per package up to date (version bump + generated `CHANGELOG.md`).
3. **Merge the release PR.** That tags `<name>@<version>`, creates the GitHub Release, and publishes to npm (with provenance) after tests and typecheck pass.

Requires the `NPM_TOKEN` repository secret (granular npm token with write access to both packages).

## Manual fallback

```bash
npm publish -w packages/<name>
git tag -a "<name>@<version>" -m "<summary>" && git push origin "<name>@<version>"
```
