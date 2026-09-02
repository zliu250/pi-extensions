# Releasing (maintainer notes)

Releases are automated with [release-please](https://github.com/googleapis/release-please) (`.github/workflows/release.yml`).

1. Land changes on `main` using conventional commits — `fix:` → patch, `feat:` → minor, `feat!:` / `BREAKING CHANGE:` → major. Commits only bump the package whose files they touch. `docs:`/`chore:`/`test:` don't trigger releases.
2. The bot keeps a `chore: release` PR per package up to date (version bump + generated `CHANGELOG.md`).
3. **Merge the release PR.** That tags `<name>@<version>`, creates the GitHub Release, and publishes to npm (with provenance) after tests and typecheck pass.

Each published package must trust the GitHub Actions workflow `.github/workflows/release.yml` in `zliu250/pi-extensions`. The publish job uses npm trusted publishing (OIDC), so it does not use a long-lived `NPM_TOKEN`.

## Bootstrap a new npm package

npm cannot configure trusted publishing until the package exists. Add a new workspace at version `0.0.0`, add the same version to `.release-please-manifest.json`, and then:

1. Land the package with a `feat:` commit on `main`. Release Please opens a PR for the first real version; `chore:` and `docs:` commits do not create a release.
2. Before merging that release PR, authenticate locally with an npm maintainer account and publish the bootstrap version:

   ```bash
   npm login
   npm publish -w packages/<name> --access public
   ```

3. On npmjs.com, configure the new package's trusted publisher:
   - organization or user: `zliu250`
   - repository: `pi-extensions`
   - workflow: `release.yml`
   - environment: leave blank
4. Merge the release PR. The tagged release is then published through OIDC.

The `0.0.0` bootstrap prevents the first automated release version from being consumed by the manual publication.

## Manual fallback

```bash
npm publish -w packages/<name> --access public
git tag -a "<name>@<version>" -m "<summary>" && git push origin "<name>@<version>"
```
