# Changelog

## [0.1.1](https://github.com/zliu250/pi-extensions/compare/pi-dump-session@0.1.0...pi-dump-session@0.1.1) (2026-08-26)


### Bug Fixes

* refresh extension compatibility and docs ([f53f75e](https://github.com/zliu250/pi-extensions/commit/f53f75e8fdf67a95447572d47d3b524d083cbf79))

## 0.1.0

- Initial release.
- `/dump` — like `/new`, but deletes the abandoned session's `.jsonl` file from disk. Deletion runs inside `newSession({ withSession })`, after the old runtime is torn down; a cancelled switch (`session_before_switch`) deletes nothing; failures report the path for manual cleanup.
- `/incognito` — toggle for the current session: while ON, its file is deleted on `session_shutdown` (reasons `quit`, `new`, `resume`; `reload` and `fork` are skipped). The flag is persisted with `pi.appendEntry()` and restored on `session_start`, so it survives `/reload` and resume. A footer status shows `incognito` while active.
- Tests: deletion against real temp files, cancellation, headless mode, persistence/restore, shutdown-reason matrix; plus a smoke test pinning the documented pi APIs this package relies on (`newSession`/`withSession` signature, `session_shutdown` reason union, `appendEntry`, `getSessionFile`, `CustomEntry` shape) against the installed Pi.
