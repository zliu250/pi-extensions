# pi-extensions

Extensions for the [Pi coding agent](https://pi.dev). Each is its own npm package — install only what you want.

## Extensions

| Extension | Description |
|---|---|
| [pi-clear-screen](packages/pi-clear-screen) | `/clear` that works like `clear` in a shell: wipes the screen, keeps your session, name, and context. Every other `/clear` package secretly runs `/new`. |
| [pi-dump-session](packages/pi-dump-session) | Incognito mode for sessions. `/dump` starts fresh and deletes the old session file from disk; `/incognito` makes the current session self-destruct when it ends. |

## Install

```bash
pi install npm:pi-clear-screen
pi install npm:pi-dump-session
```

Try one without installing:

```bash
pi -e npm:pi-dump-session
```

Installing the whole repo as a git package also works — `pi install git:github.com/zliu250/pi-extensions` — but don't combine it with the npm installs, or the extensions load twice.

## Development

```bash
npm ci
npm test
npm run typecheck
```

See each extension's README for details.
