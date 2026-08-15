# Changelog

## Unreleased

- Added `test/smoke.test.ts`: verifies the TUI-internals assumptions (document container layout, `Container` contract, `TuiMainScreen` render-state shape, alt-screen having no `restoreRenderState`) against the actually installed `@earendil-works/pi-coding-agent`, so Pi version drift fails `npm test` instead of surfacing as user reports.
- Added GitHub Actions CI (test + typecheck on Node 22/24).
- Refactored the blank-frame literal into an exported `resetRenderState()` so the smoke test and the wipe share one source of truth. No behavior change.
- Documented why auto-re-clearing after transcript rebuilds is not soundly implementable with the current extension API (no rebuild event; `/reload` resets extension state; `session_tree` repaints are intentional).

## 0.2.0

- **Fix:** `/clear` now checks `ctx.mode` before touching the UI. Outside TUI mode the host supplies `custom: async () => undefined`, which resolves without ever invoking the factory, so 0.1.0 reported "no interactive transcript to wipe" when the real problem was that there is no terminal. Headless runs now say so.
- The unrecognised-layout warning is worded accurately instead of being conflated with the headless case.
- Added a test suite (`npm test`, Node's built-in runner, no framework) and `npm run typecheck` under `strict`.
- Relaxed `engines.node` from `>=20` to `>=18.0.0`; nothing in the extension needs Node 20, and the tighter bound produced spurious `EBADENGINE` warnings.

## 0.1.0

- Initial release. `/clear` and `/cls` wipe the visible transcript while leaving the session file, session name, message history, and model context untouched.
