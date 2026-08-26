// Smoke test against the REAL installed @earendil-works/pi-coding-agent.
//
// The unit tests in dump-session.test.ts exercise mocks of pi's documented
// extension API. This file pins those documented shapes against the actually
// installed Pi, so `npm test` fails at CI time — not user-report time — when
// a Pi upgrade changes:
//
//   1. ExtensionCommandContext.newSession with a withSession callback
//      (/dump deletes the old file inside it).
//   2. session_shutdown reasons ("quit" | "reload" | "new" | "resume" | "fork")
//      (/incognito skips "reload" and "fork").
//   3. pi.appendEntry / CustomEntry shape (/incognito persistence).
//   4. SessionManager.getSessionFile (the one file we delete).
//
// Run with: npm test  (Node >= 22.19 for native TypeScript stripping)

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// In the workspaces monorepo, node_modules is hoisted to the repo root; walk
// up from the package so this also works if the package is checked out alone.
function findInstalled(...segments: string[]): string | undefined {
	let dir = fileURLToPath(new URL("..", import.meta.url));
	for (let i = 0; i < 4; i++) {
		const candidate = join(dir, "node_modules", ...segments);
		if (existsSync(candidate)) return candidate;
		dir = join(dir, "..");
	}
	return undefined;
}

const agentDir = findInstalled("@earendil-works", "pi-coding-agent")!;
assert.ok(agentDir && existsSync(agentDir), "devDependency @earendil-works/pi-coding-agent must be installed (npm ci)");

test("smoke: documented extension APIs used by dump-session still exist", () => {
	const extensionTypes = readFileSync(join(agentDir, "dist", "core", "extensions", "types.d.ts"), "utf8");

	assert.ok(
		extensionTypes.includes("newSession(options?"),
		"ExtensionCommandContext.newSession() disappeared — /dump depends on it",
	);
	assert.ok(
		/withSession\?\s*:\s*\(ctx: ReplacedSessionContext\)/.test(extensionTypes),
		"newSession's withSession callback signature changed — /dump deletes inside it",
	);
	assert.ok(
		extensionTypes.includes('"quit" | "reload" | "new" | "resume" | "fork"'),
		"session_shutdown reasons changed — /incognito's skip list (reload, fork) needs review",
	);
	assert.ok(
		/appendEntry<T = unknown>\(customType: string, data\?: T\): void/.test(extensionTypes),
		"pi.appendEntry signature changed — /incognito persistence needs review",
	);

	const sessionManagerTypes = readFileSync(join(agentDir, "dist", "core", "session-manager.d.ts"), "utf8");
	assert.ok(
		sessionManagerTypes.includes("getSessionFile(): string | undefined"),
		"SessionManager.getSessionFile signature changed",
	);
	assert.ok(
		/interface CustomEntry<T = unknown>[\s\S]{0,200}customType: string;[\s\S]{0,50}data\?: T;/.test(sessionManagerTypes),
		"CustomEntry shape changed — /incognito's session_start restore scan needs review",
	);
});
