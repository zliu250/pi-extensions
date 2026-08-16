# pi-clear-screen

`/clear` for [Pi](https://pi.dev) that behaves like `clear` in a shell: it wipes **what is on screen** and nothing else.

Your session file, session name, message history, and token count are untouched.

```bash
pi install npm:pi-clear-screen
```

Then `/clear` (or `/cls`).

Part of the [pi-extensions](https://github.com/zliu250/pi-extensions) collection. Want to delete the session from disk instead of just the screen? That's [`pi-dump-session`](../pi-dump-session).

## ⚠️ Read this before installing

Several published packages already register `/clear`, and **all of them do the opposite of this one** — they map `/clear` to `/new`, which replaces the session file and throws away your session name:

- [`pi-clear`](https://www.npmjs.com/package/pi-clear) — `newSession()` + `reload()`
- [`@derogab/pi-clear`](https://www.npmjs.com/package/@derogab/pi-clear) — "alias for `/new`"
- [`pi-aliases`](https://www.npmjs.com/package/pi-aliases) — `/clear` → `/new`

If you install one of those *and* this one, Pi keeps both and disambiguates them as `/clear:1` and `/clear:2`. One nukes your session, one doesn't, and you will not enjoy guessing which is which. **Pick one.** Use `/cls` here if you want to keep another package's `/clear`.

## What it does, precisely

| | session file | session name | model context / tokens | screen |
|---|---|---|---|---|
| `/new` | new one | **gone** | reset | wiped |
| `/compact` | same | same | summarised | kept |
| **`/clear`** (this) | **same** | **same** | **untouched** | **wiped** |

Nothing in the session is read or written, so the name survives for free.

This is a *display* command. If you want to actually reclaim context window, use `/compact`.

## How it works

Pi's interactive TUI mounts a *document* container holding `[header, loadedResources, chat]`. Extensions get no direct handle on it, but `ctx.ui.custom()` passes the live `TUI` instance into its factory. So the extension:

1. Grabs the TUI inside the factory and calls `done()` **synchronously**. `showExtensionCustom` sees `closed === true` and skips mounting entirely, so the editor is restored with no flicker and no stray component.
2. Empties the three document containers.
3. Writes `CSI 3J` (erase scrollback) followed by `clearScreen()` (`CSI 2J` + cursor home).
4. Calls `restoreRenderState()` with a blank frame, so the differential renderer does not diff against rows that were just erased behind its back.
5. `requestRender(true)` for a full repaint.

Success is silent, like real `clear`. It only notifies on failure or if the TUI shape is unrecognised.

## Known limitation

The transcript is **hidden, not deleted**. Anything that makes Pi rebuild the chat from session entries repaints the full history:

- `ctrl+o` (tool output expansion toggle)
- theme change
- `/reload`
- branch / tree navigation

Run `/clear` again after those.

This cannot be automated soundly with the current extension API: Pi fires no event when it rebuilds the chat (`ctrl+o`, theme change), `/reload` restarts extensions so any "was cleared" flag is lost, and re-wiping after `session_tree` would hide the branch you just navigated to see. Persisting the flag in the session file would break this package's core promise of never touching the session.

## Compatibility

Written against Pi `0.84.x`. It reaches into TUI internals that are not part of the documented extension API, so it degrades defensively:

- Unrecognised container layout → does nothing, warns, leaves the render state alone.
- Fullscreen (alt-screen) mode → works; `terminal` and `restoreRenderState` are optional.
- Non-TUI modes (`print`, `json`, `rpc`) → refuses up front. The host stubs `ui.custom()` as `async () => undefined` there, so the factory never runs.

Every one of those paths is covered by a test, and `test/smoke.test.ts` verifies the internals assumptions (document container layout, `Container` contract, `TuiMainScreen` render-state shape) against the actually installed Pi on every `npm test` / CI run, so version drift is caught before users hit it.

No hotkey is registered — `ctrl+l` is already Pi's model selector.

## Development

See the [monorepo README](../../README.md). Quick loop:

```bash
npm test -w packages/pi-clear-screen
pi -e ./packages/pi-clear-screen
```

## License

MIT
