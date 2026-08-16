# Changelog

## 0.3.0

- **Renamed:** `pi-clear-screen` → `@zliu250/pi-extensions`. The repo is now a collection of pi extensions; `/clear` behavior is unchanged. Migrate with `pi remove npm:pi-clear-screen && pi install npm:@zliu250/pi-extensions`.
- **New extension `dump-session`:**
  - `/dump` — like `/new`, but deletes the abandoned session's `.jsonl` file from disk. Deletion runs inside `newSession({ withSession })`, after the old runtime is torn down; a cancelled switch (`session_before_switch`) deletes nothing; failures report the path for manual cleanup.
  - `/incognito` — toggle for the current session: while ON, its file is deleted on `session_shutdown` (reasons `quit`, `new`, `resume`; `reload` and `fork` are skipped). The flag is persisted with `pi.appendEntry()` and restored on `session_start`, so it survives `/reload` and resume. A footer status shows `incognito` while active.
- `pi.extensions` in the manifest now lists entry files individually (ecosystem convention for multi-extension packages) instead of pointing at the directory.
- Added `test/dump-session.test.ts` (deletion against real temp files, cancellation, headless mode, persistence/restore, shutdown-reason matrix).
- Extended `test/smoke.test.ts` to also pin the documented extension APIs dump-session relies on (`newSession`/`withSession` signature, `session_shutdown` reason union, `appendEntry`, `getSessionFile`, `CustomEntry` shape) against the installed Pi.
- Added `test/smoke.test.ts` (from unreleased): verifies the clear-screen TUI-internals assumptions against the actually installed `@earendil-works/pi-coding-agent`.
- Added GitHub Actions CI (test + typecheck on Node 22/24).
- Refactored the blank-frame literal into an exported `resetRenderState()` shared by the smoke test and the wipe. No behavior change.
- Documented why auto-re-clearing after transcript rebuilds is not soundly implementable with the current extension API.

## 0.2.0

- **Fix:** `/clear` now checks `ctx.mode` before touching the UI. Outside TUI mode the host supplies `custom: async () => undefined`, which resolves without ever invoking the factory, so 0.1.0 reported "no interactive transcript to wipe" when the real problem was that there is no terminal. Headless runs now say so.
- The unrecognised-layout warning is worded accurately instead of being conflated with the headless case.
- Added a test suite (`npm test`, Node's built-in runner, no framework) and `npm run typecheck` under `strict`.
- Relaxed `engines.node` from `>=20` to `>=18.0.0`; nothing in the extension needs Node 20, and the tighter bound produced spurious `EBADENGINE` warnings.

## 0.1.0

- Initial release. `/clear` and `/cls` wipe the visible transcript while leaving the session file, session name, message history, and model context untouched.
