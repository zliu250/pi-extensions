// Run with: npm test  (Node >= 22.19 for native TypeScript stripping)
//
// Unit tests for /dump and /incognito. File deletion is exercised against
// real temp files; pi's ExtensionAPI and contexts are mocked in the same
// style as clear-screen.test.ts. The assumptions these mocks encode about
// the real pi API (newSession/withSession, session_shutdown reasons,
// appendEntry, getSessionFile) are verified against the installed pi in
// smoke.test.ts.

import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import dumpSession, { INCOGNITO_ENTRY, deleteSessionFile } from "../extensions/dump-session.ts";

type Cmd = { description?: string; handler: (args: string, ctx: any) => Promise<void> };
type Handler = (event: any, ctx: any) => Promise<void> | void;

/** Load the extension against a mock ExtensionAPI. */
function load() {
	const commands = new Map<string, Cmd>();
	const handlers = new Map<string, Handler>();
	const appended: Array<{ type: "custom"; customType: string; data?: unknown }> = [];
	const api = {
		registerCommand: (name: string, options: Cmd) => commands.set(name, options),
		on: (event: string, handler: Handler) => handlers.set(event, handler),
		appendEntry: (customType: string, data?: unknown) => appended.push({ type: "custom", customType, data }),
	};
	dumpSession(api as any);
	return { commands, handlers, appended };
}

/** Mock ExtensionContext / ExtensionCommandContext. */
function makeCtx(
	opts: {
		file?: string;
		entries?: unknown[];
		hasUI?: boolean;
		newSession?: (options?: any) => Promise<{ cancelled: boolean }>;
	} = {},
) {
	const notices: Array<{ message: string; type?: string }> = [];
	const statuses = new Map<string, string | undefined>();
	return {
		hasUI: opts.hasUI ?? true,
		sessionManager: {
			getSessionFile: () => opts.file,
			getEntries: () => opts.entries ?? [],
		},
		ui: {
			notify: (message: string, type?: string) => notices.push({ message, type }),
			setStatus: (key: string, text: string | undefined) => statuses.set(key, text),
		},
		newSession: opts.newSession ?? (async () => ({ cancelled: false })),
		notices,
		statuses,
	};
}

function tempSessionFile(): string {
	const dir = mkdtempSync(join(tmpdir(), "dump-session-test-"));
	const file = join(dir, "session.jsonl");
	writeFileSync(file, '{"type":"header"}\n');
	return file;
}

function incognitoEntry(enabled: boolean) {
	return { type: "custom", customType: INCOGNITO_ENTRY, data: { enabled } };
}

// ---------------------------------------------------------------- registration

test("registers /dump and /incognito with descriptions, and both session handlers", () => {
	const { commands, handlers } = load();
	for (const name of ["dump", "incognito"]) {
		assert.ok(commands.has(name), `missing /${name}`);
		assert.ok(commands.get(name)!.description, `/${name} needs a description`);
	}
	assert.ok(handlers.has("session_start"));
	assert.ok(handlers.has("session_shutdown"));
});

// ---------------------------------------------------------------- deleteSessionFile

test("deleteSessionFile: deleted / missing / failed", () => {
	const file = tempSessionFile();
	assert.equal(deleteSessionFile(file), "deleted");
	assert.ok(!existsSync(file));
	assert.equal(deleteSessionFile(file), "missing", "second delete is a no-op");
	assert.equal(deleteSessionFile(undefined), "missing", "ephemeral session has no file");

	// A non-empty directory cannot be rmSync'd without recursive → "failed".
	const dir = mkdtempSync(join(tmpdir(), "dump-session-test-"));
	mkdirSync(join(dir, "child"));
	assert.equal(deleteSessionFile(dir), "failed");
});

// ---------------------------------------------------------------- /dump

test("/dump deletes the old file only after the switch, and notifies on the NEW ctx", async () => {
	const { commands } = load();
	const file = tempSessionFile();
	const newCtx = makeCtx();
	let deletedDuringWithSession = false;

	const ctx = makeCtx({
		file,
		newSession: async (options) => {
			assert.ok(existsSync(file), "must not delete before the replacement session is live");
			await options?.withSession?.(newCtx);
			deletedDuringWithSession = !existsSync(file);
			return { cancelled: false };
		},
	});

	await commands.get("dump")!.handler("", ctx);
	assert.equal(deletedDuringWithSession, true, "file must be deleted inside withSession");
	assert.equal(ctx.notices.length, 0, "stale pre-switch ctx must not be used after replacement");
	assert.equal(newCtx.notices[0]?.message, "Previous session erased from disk");
	assert.equal(newCtx.notices[0]?.type, "info");
});

test("/dump cancelled: file kept, warning on the still-valid old ctx", async () => {
	const { commands } = load();
	const file = tempSessionFile();

	const ctx = makeCtx({
		file,
		// Simulate another extension cancelling via session_before_switch:
		// pi resolves with cancelled=true and never runs withSession. If the
		// extension deleted eagerly instead, the existsSync check below fails.
		newSession: async () => ({ cancelled: true }),
	});

	await commands.get("dump")!.handler("", ctx);
	assert.ok(existsSync(file), "cancelled dump must not delete the session file");
	assert.equal(ctx.notices[0]?.type, "warning");
});

test("/dump with no session file (ephemeral) does not crash and says so", async () => {
	const { commands } = load();
	const newCtx = makeCtx();
	const ctx = makeCtx({
		file: undefined,
		newSession: async (options) => {
			await options?.withSession?.(newCtx);
			return { cancelled: false };
		},
	});
	await commands.get("dump")!.handler("", ctx);
	assert.match(newCtx.notices[0]?.message ?? "", /no file on disk/);
});

test("/dump reports deletion failure with the path", async () => {
	const { commands } = load();
	const dir = mkdtempSync(join(tmpdir(), "dump-session-test-"));
	mkdirSync(join(dir, "child")); // makes rmSync without recursive fail
	const newCtx = makeCtx();
	const ctx = makeCtx({
		file: dir,
		newSession: async (options) => {
			await options?.withSession?.(newCtx);
			return { cancelled: false };
		},
	});
	await commands.get("dump")!.handler("", ctx);
	assert.equal(newCtx.notices[0]?.type, "error");
	assert.ok(newCtx.notices[0]?.message.includes(dir), "error must include the path for manual cleanup");
});

test("/dump in headless mode (hasUI=false) still deletes, silently", async () => {
	const { commands } = load();
	const file = tempSessionFile();
	const newCtx = makeCtx({ hasUI: false });
	const ctx = makeCtx({
		file,
		hasUI: false,
		newSession: async (options) => {
			await options?.withSession?.(newCtx);
			return { cancelled: false };
		},
	});
	await commands.get("dump")!.handler("", ctx);
	assert.ok(!existsSync(file));
	assert.equal(newCtx.notices.length, 0);
	assert.equal(ctx.notices.length, 0);
});

// ---------------------------------------------------------------- /incognito

test("/incognito toggles, persists via appendEntry, and drives the footer status", async () => {
	const { commands, appended } = load();
	const ctx = makeCtx();

	await commands.get("incognito")!.handler("", ctx);
	assert.deepEqual(appended[0], { type: "custom", customType: INCOGNITO_ENTRY, data: { enabled: true } });
	assert.equal(ctx.statuses.get("incognito"), "incognito");
	assert.equal(ctx.notices[0]?.type, "warning");

	await commands.get("incognito")!.handler("", ctx);
	assert.deepEqual(appended[1]?.data, { enabled: false });
	assert.equal(ctx.statuses.get("incognito"), undefined);
	assert.equal(ctx.notices[1]?.type, "info");
});

test("incognito ON: session_shutdown deletes the file on quit/new/resume only", async () => {
	for (const reason of ["quit", "new", "resume"] as const) {
		const { commands, handlers } = load();
		const file = tempSessionFile();
		const ctx = makeCtx({ file });
		await commands.get("incognito")!.handler("", ctx);
		await handlers.get("session_shutdown")!({ type: "session_shutdown", reason }, ctx);
		assert.ok(!existsSync(file), `reason "${reason}" must delete the session file`);
	}

	for (const reason of ["reload", "fork"] as const) {
		const { commands, handlers } = load();
		const file = tempSessionFile();
		const ctx = makeCtx({ file });
		await commands.get("incognito")!.handler("", ctx);
		await handlers.get("session_shutdown")!({ type: "session_shutdown", reason }, ctx);
		assert.ok(existsSync(file), `reason "${reason}" must NOT delete the session file`);
	}
});

test("incognito OFF: session_shutdown never deletes", async () => {
	const { handlers } = load();
	const file = tempSessionFile();
	const ctx = makeCtx({ file });
	await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, ctx);
	assert.ok(existsSync(file));
});

// ---------------------------------------------------------------- persistence

test("session_start restores the flag from entries (last toggle wins)", async () => {
	// Simulates /reload or /resume of a session whose file records toggles.
	const { handlers } = load();
	const file = tempSessionFile();

	// ON at the end → shutdown deletes.
	const onCtx = makeCtx({ file, entries: [incognitoEntry(true)] });
	await handlers.get("session_start")!({ type: "session_start", reason: "reload" }, onCtx);
	assert.equal(onCtx.statuses.get("incognito"), "incognito", "restored flag must show in footer");
	await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, onCtx);
	assert.ok(!existsSync(file), "restored incognito must delete on quit");

	// ON then OFF → flag off, no deletion.
	const file2 = tempSessionFile();
	const offCtx = makeCtx({ file: file2, entries: [incognitoEntry(true), incognitoEntry(false)] });
	await handlers.get("session_start")!({ type: "session_start", reason: "reload" }, offCtx);
	assert.equal(offCtx.statuses.get("incognito"), undefined);
	await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, offCtx);
	assert.ok(existsSync(file2));
});

test("session_start on a fresh session resets a stale in-memory flag", async () => {
	// incognito was ON in the previous session; the new session has no entries.
	const { commands, handlers } = load();
	const oldCtx = makeCtx({ file: tempSessionFile() });
	await commands.get("incognito")!.handler("", oldCtx);

	const file = tempSessionFile();
	const freshCtx = makeCtx({ file, entries: [] });
	await handlers.get("session_start")!({ type: "session_start", reason: "new" }, freshCtx);
	await handlers.get("session_shutdown")!({ type: "session_shutdown", reason: "quit" }, freshCtx);
	assert.ok(existsSync(file), "fresh session must not inherit incognito from memory");
});
