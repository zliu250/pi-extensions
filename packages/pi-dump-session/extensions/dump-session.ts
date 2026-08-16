// dump-session — incognito-style session disposal for pi.
//
//   /dump      -> like /new, but also deletes the abandoned session's .jsonl
//                 file from disk. It disappears from /resume and is not
//                 recoverable.
//   /incognito -> toggle for the CURRENT session. While ON, the session file
//                 is deleted from disk when the session ends (quit, /new,
//                 /resume away). Like a private browser window: close it and
//                 it never happened.
//
// pi's /new only starts a new session file; nothing ever deletes old ones, so
// ~/.pi/agent/sessions/ grows forever. These commands are the eraser.
//
// Design notes (per docs/extensions.md in @earendil-works/pi-coding-agent):
//
// - /dump deletes the old file inside `newSession({ withSession })`. That
//   callback runs only after the old runtime has been torn down and the
//   replacement session is live, so nothing can still be writing the old
//   file. Only a plain string (the old path) is carried across the switch —
//   captured session-bound objects are stale after replacement (documented
//   footgun) and must not be used.
// - If any extension cancels the switch (session_before_switch), nothing is
//   deleted. On that path no replacement happened, so the pre-switch ctx is
//   still valid and is used to report the cancellation.
// - The /incognito flag is persisted with pi.appendEntry() and restored by
//   scanning entries on session_start. In-memory state alone would be lost on
//   /reload (extension runtimes are torn down and rebuilt) and on resume.
// - Deletion happens in session_shutdown. Reasons "reload" (the same session
//   continues afterwards) and "fork" (the forked session references this
//   file as its parent) are skipped; "quit", "new", and "resume" delete.
//
// Limitations:
// - SIGKILL / crashes skip session_shutdown, so an incognito session file can
//   survive a hard kill. Run /dump or delete it manually afterwards.
// - /fork of an incognito session copies its entries, so the fork inherits
//   incognito. Forking never deletes the parent file.

import * as fs from "node:fs";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

/** customType used to persist the incognito flag inside the session file. */
export const INCOGNITO_ENTRY = "dump-session:incognito";

export type DeleteResult = "deleted" | "missing" | "failed";

/**
 * Best-effort deletion of a session file. Exported for tests.
 * "missing" covers both "session was never persisted" and "already deleted".
 */
export function deleteSessionFile(file: string | undefined): DeleteResult {
	if (!file || !fs.existsSync(file)) return "missing";
	try {
		fs.rmSync(file, { force: true });
		return "deleted";
	} catch {
		return "failed";
	}
}

export default function dumpSession(pi: ExtensionAPI) {
	let incognito = false;

	const syncStatus = (ctx: ExtensionContext) => {
		if (ctx.hasUI) ctx.ui.setStatus("incognito", incognito ? "incognito" : undefined);
	};

	// Restore the persisted incognito flag. session_start fires on startup,
	// /reload, /new, /resume, and /fork; scanning entries makes the flag
	// survive all of them (a brand-new session simply has no entries).
	pi.on("session_start", (_event, ctx) => {
		incognito = false;
		for (const entry of ctx.sessionManager.getEntries()) {
			if (entry.type === "custom" && entry.customType === INCOGNITO_ENTRY) {
				incognito = (entry.data as { enabled?: boolean } | undefined)?.enabled === true;
			}
		}
		syncStatus(ctx);
	});

	pi.registerCommand("dump", {
		description: "Start a new session and erase the current one from disk (incognito /new)",
		handler: async (_args, ctx) => {
			// Plain string only: safe to carry across the session switch.
			const oldFile = ctx.sessionManager.getSessionFile();
			const result = await ctx.newSession({
				withSession: async (newCtx) => {
					const outcome = deleteSessionFile(oldFile);
					if (!newCtx.hasUI) return;
					if (outcome === "failed") {
						newCtx.ui.notify(`Could not delete ${oldFile} — remove it manually`, "error");
					} else if (outcome === "deleted") {
						newCtx.ui.notify("Previous session erased from disk", "info");
					} else {
						newCtx.ui.notify("New session started (previous session left no file on disk)", "info");
					}
				},
			});
			// Only reached with the old session still in place, so ctx is valid.
			if (result.cancelled && ctx.hasUI) {
				ctx.ui.notify("Dump cancelled — session kept", "warning");
			}
		},
	});

	pi.registerCommand("incognito", {
		description: "Toggle incognito for this session: erase its file from disk when it ends",
		handler: async (_args, ctx) => {
			incognito = !incognito;
			pi.appendEntry(INCOGNITO_ENTRY, { enabled: incognito });
			syncStatus(ctx);
			if (ctx.hasUI) {
				ctx.ui.notify(
					incognito
						? "Incognito ON — this session's file will be deleted when the session ends (quit, /new, /resume)"
						: "Incognito OFF — this session will persist normally",
					incognito ? "warning" : "info",
				);
			}
		},
	});

	pi.on("session_shutdown", (event, ctx) => {
		if (!incognito) return;
		// "reload": the same session continues afterwards.
		// "fork": the forked session references this file as its parent.
		if (event.reason === "reload" || event.reason === "fork") return;
		deleteSessionFile(ctx.sessionManager.getSessionFile());
	});
}
