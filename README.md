# pi-extensions

[![CI](https://github.com/zliu250/pi-extensions/actions/workflows/ci.yml/badge.svg)](https://github.com/zliu250/pi-extensions/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A monorepo of [Pi](https://pi.dev) extensions, built and released independently under `packages/`.

## Packages

| Package | Description | npm |
|---|---|---|
| [pi-clear-screen](packages/pi-clear-screen) | `/clear` that works like `clear` in a shell: wipes the screen, keeps your session, name, and context — every other `/clear` package secretly runs `/new` | [![npm](https://img.shields.io/npm/v/pi-clear-screen)](https://www.npmjs.com/package/pi-clear-screen) |
| [pi-dump-session](packages/pi-dump-session) | Incognito mode for sessions: `/dump` starts fresh and deletes the old session file from disk; `/incognito` makes the current session self-destruct when it ends | [![npm](https://img.shields.io/npm/v/pi-dump-session)](https://www.npmjs.com/package/pi-dump-session) |

## Install

```bash
pi install npm:pi-clear-screen        # or try first: pi -e npm:pi-clear-screen
pi install npm:pi-dump-session
```

See each package's `README.md` for usage and details, and [CONTRIBUTING.md](CONTRIBUTING.md) for development.
