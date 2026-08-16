# pi-dump-session

Incognito mode for [Pi](https://pi.dev) sessions.

Every pi session is saved forever as a `.jsonl` file under `~/.pi/agent/sessions/`. `/new` only starts a *new* file — nothing ever deletes old ones. This package is the eraser.

```bash
pi install npm:pi-dump-session
```

Part of the [pi-extensions](https://github.com/zliu250/pi-extensions) collection. Want to wipe only the *screen* and keep the session? That's [`pi-clear-screen`](../pi-clear-screen).

## `/dump` — new session + shred the old one

Exactly like `/new`, but after the replacement session starts, the abandoned session's file is **deleted from disk**. It disappears from `/resume` and is not recoverable.

- Deletion happens inside `newSession({ withSession })`, i.e. only after the old runtime is fully torn down — nothing can still be writing the file.
- If another extension cancels the switch (via `session_before_switch`, e.g. a confirm-guard), **nothing is deleted**.
- If deletion fails (e.g. file locked), you get the path so you can remove it manually.

## `/incognito` — private-window mode for the current session

Toggle it once; while ON, the session's file is deleted from disk when the session ends — quit pi, `/new`, or `/resume` away. Like a private browser window: close it and it never happened.

- The flag is **persisted in the session itself** (`pi.appendEntry`), so it survives `/reload` and even resuming the session later. A footer status shows `incognito` while active.
- `/reload` does *not* delete (the same session continues); `/fork` does *not* delete the parent file (the fork references it) — but the fork inherits the incognito flag, since forks copy entries.
- Deletes on `session_shutdown` reasons `quit`, `new`, and `resume`.

## Limitations

- `SIGKILL` or a crash skips `session_shutdown`, so an incognito session file can survive a hard kill. Run `/dump` or delete it manually afterwards.
- Deleted means deleted. There is no trash can. That is the point.

## Only pi's own session file is touched

`pi-dump-session` deletes exactly one file: `ctx.sessionManager.getSessionFile()`. It never scans directories or deletes anything else.

## Development

See the [monorepo README](../../README.md). Quick loop:

```bash
npm test -w packages/pi-dump-session
pi -e ./packages/pi-dump-session
```

`test/smoke.test.ts` pins the documented pi APIs this package relies on (`newSession`/`withSession` signature, `session_shutdown` reason union, `appendEntry`, `getSessionFile`, `CustomEntry` shape) against the actually installed Pi, so version drift fails CI before users hit it.

## License

MIT
