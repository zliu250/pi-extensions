# Changelog

## 0.2.0

- **Fix:** `/clear` now checks `ctx.mode` before touching the UI. Outside TUI mode the host supplies `custom: async () => undefined`, which resolves without ever invoking the factory, so 0.1.0 reported "no interactive transcript to wipe" when the real problem was that there is no terminal. Headless runs now say so.
- The unrecognised-layout warning is worded accurately instead of being conflated with the headless case.
- Added a test suite (`npm test`, Node's built-in runner, no framework) and `npm run typecheck` under `strict`.
- Relaxed `engines.node` from `>=20` to `>=18.0.0`; nothing in the extension needs Node 20, and the tighter bound produced spurious `EBADENGINE` warnings.

## 0.1.0

- Initial release. `/clear` and `/cls` wipe the visible transcript while leaving the session file, session name, message history, and model context untouched.
