# pi-extensions

A collection of extensions for [Pi](https://pi.dev). Each lives in `packages/` as a self-contained pi package, published to npm and **installable individually**:

| Package | Commands | What it does |
|---|---|---|
| [`pi-clear-screen`](packages/pi-clear-screen) | `/clear`, `/cls` | Wipes **what is on screen** and nothing else — session file, name, history, and model context untouched |
| [`pi-dump-session`](packages/pi-dump-session) | `/dump`, `/incognito` | Erases session files **from disk**: `/dump` = `/new` + delete the old session; `/incognito` = auto-delete this session's file when it ends |

```bash
pi install npm:pi-clear-screen
pi install npm:pi-dump-session
```

To install everything at once from git instead:

```bash
pi install git:github.com/zliu250/pi-extensions
```

> Don't combine the git install with the individual npm installs on the same machine — the extensions would load twice (`/clear:1`, `/clear:2`, ...).

> **Security note:** pi extensions run with your full system permissions. Review the source (each package is one short file) before installing.

## Development

```bash
git clone https://github.com/zliu250/pi-extensions
cd pi-extensions
npm ci
npm test             # all packages, Node's built-in test runner, no framework
npm run typecheck    # all packages, strict

npm test -w packages/pi-dump-session   # one package
pi -e ./packages/pi-dump-session       # try one package without installing
```

Pi loads TypeScript through jiti, so there is no build step. `npm test` uses native TypeScript stripping and needs Node >= 22.6; the extensions themselves run on Node >= 18.

Each package ships a smoke test that checks every assumption it makes about Pi — `pi-clear-screen`'s undocumented TUI internals, `pi-dump-session`'s documented extension APIs — against the actually installed `@earendil-works/pi-coding-agent`, so Pi version drift is caught in CI before users hit it.

CI runs tests and typecheck on every push and PR (Node 22/24). Releases are published manually per package: bump the version, update the package's CHANGELOG, and `npm publish` from its directory.

## License

MIT
