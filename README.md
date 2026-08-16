# @zliu250/pi-extensions

A collection of extensions for [Pi](https://pi.dev), each solving one thing precisely.

```bash
pi install npm:@zliu250/pi-extensions
```

| Extension | Commands | What it does |
|---|---|---|
| [clear-screen](#clear-screen) | `/clear`, `/cls` | Wipes **what is on screen** and nothing else — session file, name, history, and model context untouched |
| [dump-session](#dump-session) | `/dump`, `/incognito` | Erases session files **from disk**: `/dump` = `/new` + delete the old session; `/incognito` = auto-delete this session's file when it ends |

> **Security note:** pi extensions run with your full system permissions. Review the source (it's short) before installing.

### Using only some extensions

Pi loads every extension in the package by default. To pick individual ones, use the object form in your `settings.json`:

```json
{
  "packages": [
    {
      "source": "npm:@zliu250/pi-extensions",
      "extensions": ["extensions/dump-session.ts"]
    }
  ]
}
```

or run `pi config` and toggle them interactively.

---

## clear-screen

`/clear` (or `/cls`) behaves like `clear` in a shell: it wipes the visible transcript only.

| | session file | session name | model context / tokens | screen |
|---|---|---|---|---|
| `/new` | new one | **gone** | reset | wiped |
| `/compact` | same | same | summarised | kept |
| **`/clear`** | **same** | **same** | **untouched** | **wiped** |

This is a *display* command. To actually reclaim context window, use `/compact`. To actually delete the session, use `/dump` (below).

### ⚠️ Command collisions

Several published packages register `/clear` and **all of them map it to `/new`** — the opposite of this one: [`pi-clear`](https://www.npmjs.com/package/pi-clear), [`@derogab/pi-clear`](https://www.npmjs.com/package/@derogab/pi-clear), [`pi-aliases`](https://www.npmjs.com/package/pi-aliases). If you install one of those alongside this, Pi disambiguates them as `/clear:1` and `/clear:2` — one nukes your session, one doesn't. **Pick one**, or use `/cls` here.

### How it works

Pi's interactive TUI mounts a *document* container holding `[header, loadedResources, chat]`. Extensions get no direct handle on it, but `ctx.ui.custom()` passes the live `TUI` instance into its factory. The extension grabs the TUI, resolves synchronously without mounting anything, empties the three containers, erases scrollback (`CSI 3J`) and viewport, resets the differential renderer's cached frame, and forces a full repaint. Success is silent, like real `clear`.

### Known limitation

The transcript is **hidden, not deleted**. Anything that makes Pi rebuild the chat from session entries repaints the full history: `ctrl+o` (tool output expansion), theme change, `/reload`, branch/tree navigation. Run `/clear` again after those. This cannot be automated soundly with the current extension API — Pi fires no event when it rebuilds the chat, and `/reload` restarts extensions.

### Compatibility

Written against Pi `0.84.x`. It reaches into TUI internals that are **not** part of the documented extension API, so it degrades defensively: unrecognised container layout → does nothing and warns; alt-screen mode → works; non-TUI modes (`print`, `json`, `rpc`) → refuses up front. `test/smoke.test.ts` verifies the internals assumptions against the actually installed Pi on every `npm test` / CI run.

---

## dump-session

Every pi session is saved forever as a `.jsonl` file under `~/.pi/agent/sessions/`. `/new` only starts a *new* file — nothing ever deletes old ones. These two commands are the eraser.

### `/dump` — new session + shred the old one

Exactly like `/new`, but after the replacement session starts, the abandoned session's file is **deleted from disk**. It disappears from `/resume` and is not recoverable.

- Deletion happens inside `newSession({ withSession })`, i.e. only after the old runtime is fully torn down — nothing can still be writing the file.
- If another extension cancels the switch (via `session_before_switch`, e.g. a confirm-guard), **nothing is deleted**.
- If deletion fails (e.g. file locked), you get the path so you can remove it manually.

### `/incognito` — private-window mode for the current session

Toggle it once; while ON, the session's file is deleted from disk when the session ends — quit pi, `/new`, or `/resume` away. Like a private browser window: close it and it never happened.

- The flag is **persisted in the session itself** (`pi.appendEntry`), so it survives `/reload` and even resuming the session later. A footer status shows `incognito` while active.
- `/reload` does *not* delete (the same session continues); `/fork` does *not* delete the parent file (the fork references it) — but the fork inherits the incognito flag, since forks copy entries.
- Works with `session_shutdown` reasons `quit`, `new`, and `resume`.

### Limitations

- `SIGKILL` or a crash skips `session_shutdown`, so an incognito session file can survive a hard kill. Run `/dump` or delete it manually afterwards.
- Deleted means deleted. There is no trash can. That is the point.

### Only pi's own session file is touched

`dump-session` deletes exactly one file: `ctx.sessionManager.getSessionFile()`. It never scans directories or deletes anything else.

---

## Development

```bash
git clone https://github.com/zliu250/pi-extensions
cd pi-extensions
npm install
npm test         # Node's built-in test runner, no framework
npm run typecheck

pi install ./pi-extensions     # local path install, no copy
```

Pi loads TypeScript through jiti, so there is no build step. `npm test` uses native TypeScript stripping and needs Node >= 22.6; the extensions themselves run on Node >= 18.

`test/smoke.test.ts` checks every assumption we make about Pi — clear-screen's TUI internals *and* dump-session's documented APIs (`newSession`/`withSession`, `session_shutdown` reasons, `appendEntry`, `getSessionFile`) — against the actually installed `@earendil-works/pi-coding-agent`, so Pi version drift is caught in CI before users hit it.

CI runs tests and typecheck on every push and PR. Releases are published manually: bump the version, update the CHANGELOG, and `npm publish --access public`.

## Migrating from `pi-clear-screen`

This package supersedes [`pi-clear-screen`](https://www.npmjs.com/package/pi-clear-screen) (same `/clear`, unchanged). Switch with:

```bash
pi remove npm:pi-clear-screen
pi install npm:@zliu250/pi-extensions
```

## License

MIT
