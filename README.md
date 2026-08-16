# pi-extensions

A collection of extensions for [Pi](https://pi.dev). Each is published to npm as its own package — install only what you want.

## Packages

| Package | Commands | Description |
|---|---|---|
| [`pi-clear-screen`](packages/pi-clear-screen) | `/clear`, `/cls` | Wipe what is on screen and nothing else — session file, name, history, and model context untouched |
| [`pi-dump-session`](packages/pi-dump-session) | `/dump`, `/incognito` | Erase session files from disk: `/dump` is `/new` plus delete the old session; `/incognito` auto-deletes the current session's file when it ends |

## Install

```bash
pi install npm:pi-clear-screen
pi install npm:pi-dump-session
```

Try one without installing it persistently:

```bash
pi -e npm:pi-dump-session
```

Installing this repository as a git package (`pi install git:github.com/zliu250/pi-extensions`) loads every extension in `packages/`. Do not do that on a host that also installs the npm packages, or the extensions load twice.

Pi extensions run with your full system permissions — review the source (each package is one short file) before installing.

## Development

```bash
npm ci
npm test             # every package's unit + smoke tests
npm run typecheck    # strict, all packages

npm test -w packages/pi-dump-session   # one package
pi -e ./packages/pi-dump-session       # run one package from source
```

No build step — Pi loads TypeScript directly. `npm test` needs Node >= 22.6 (native type stripping); the extensions run on Node >= 18.

Each package's smoke test pins its assumptions about Pi — `pi-clear-screen`'s TUI internals, `pi-dump-session`'s documented extension APIs — against the actually installed `@earendil-works/pi-coding-agent`, so a Pi upgrade that breaks them fails CI instead of surfacing as user reports.

## License

MIT
