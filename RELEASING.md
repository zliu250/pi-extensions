# Releasing (maintainer notes)

Per package:

1. Bump the version in `packages/<name>/package.json`, update its `CHANGELOG.md`
2. Commit and push (CI must be green)
3. `npm publish -w packages/<name>`
4. `git tag -a "<name>@<version>" -m "<summary>" && git push origin "<name>@<version>"`
