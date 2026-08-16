// Smoke test against the REAL installed @earendil-works/pi-coding-agent.
//
// The unit tests exercise mocks that encode our assumptions about Pi. This
// file checks those assumptions against the actually installed Pi, so
// `npm test` fails at CI time — not user-report time — when a Pi upgrade
// changes:
//
// For clear-screen (undocumented TUI internals):
//   1. The document container layout ([header, loadedResources, chat]).
//   2. Container's `children` / `clear()` contract.
//   3. TuiMainScreen's render-state shape (what restoreRenderState accepts).
//   4. The alt-screen TUI having no restoreRenderState (our optional-call path).
//
// For dump-session (documented extension API):
//   5. ExtensionCommandContext.newSession with a withSession callback.
//   6. session_shutdown reasons ("quit" | "reload" | "new" | "resume" | "fork").
//   7. pi.appendEntry / custom entries and SessionManager.getSessionFile.
//
// Run with: npm test  (Node >= 22.6 for native TypeScript stripping)

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import clearScreenExtension, { resetRenderState } from "../extensions/clear-screen.ts";

const packageRoot = fileURLToPath(new URL("..", import.meta.url));
const agentDir = join(packageRoot, "node_modules", "@earendil-works", "pi-coding-agent");

// pi-tui is a dependency of the agent; it may be nested or hoisted.
const tuiDir = [
	join(agentDir, "node_modules", "@earendil-works", "pi-tui"),
	join(packageRoot, "node_modules", "@earendil-works", "pi-tui"),
].find(existsSync);

assert.ok(existsSync(agentDir), "devDependency @earendil-works/pi-coding-agent must be installed (npm ci)");
assert.ok(tuiDir, "@earendil-works/pi-tui not found under the installed pi-coding-agent");

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const tui: any = await import(pathToFileURL(join(tuiDir!, "dist", "index.js")).href);

test("smoke: real pi-tui exports the classes we depend on", () => {
	assert.equal(typeof tui.Container, "function", "pi-tui no longer exports Container");
	assert.equal(typeof tui.TuiMainScreen, "function", "pi-tui no longer exports TuiMainScreen");
	assert.equal(typeof tui.TuiAltScreen, "function", "pi-tui no longer exports TuiAltScreen");
});

test("smoke: interactive-mode still mounts [header, loadedResources, chat] as the document container", () => {
	const source = readFileSync(join(agentDir, "dist", "modes", "interactive", "interactive-mode.js"), "utf8");
	for (const child of ["headerContainer", "loadedResourcesContainer", "chatContainer"]) {
		assert.ok(
			source.includes(`this.documentContainer.addChild(this.${child})`),
			`interactive-mode.js no longer adds ${child} to documentContainer`,
		);
	}
	const addChildCalls = source.match(/this\.documentContainer\.addChild\(/g) ?? [];
	assert.equal(
		addChildCalls.length,
		3,
		`documentContainer now has ${addChildCalls.length} children, not 3 — update findDocumentContainer()`,
	);
});

test("smoke: /clear wipes real pi-tui Containers", async () => {
	const { Container } = tui;
	const dummy = { render: () => [] };

	const header = new Container();
	header.addChild(dummy);
	const loadedResources = new Container();
	const chat = new Container();
	chat.addChild(dummy);
	chat.addChild(dummy);

	const document = new Container();
	document.addChild(header);
	document.addChild(loadedResources);
	document.addChild(chat);

	const written: string[] = [];
	let clearedScreen = false;
	let restored: unknown;
	let rendered = false;
	const tuiStub = {
		children: [document],
		terminal: {
			write: (data: string) => written.push(data),
			clearScreen: () => {
				clearedScreen = true;
			},
		},
		restoreRenderState: (state: unknown) => {
			restored = state;
		},
		requestRender: () => {
			rendered = true;
		},
	};

	const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
	clearScreenExtension({
		registerCommand: (name: string, options: never) => commands.set(name, options),
	} as never);

	const notifications: string[] = [];
	await commands.get("clear")!.handler("", {
		mode: "tui",
		ui: {
			notify: (message: string) => notifications.push(message),
			custom: async (factory: (t: unknown, theme: unknown, kb: unknown, done: () => void) => unknown) => {
				factory(tuiStub, {}, {}, () => {});
				return undefined;
			},
		},
	});

	assert.deepEqual(notifications, [], "wipe against real Containers should be silent");
	assert.equal(header.children.length, 0);
	assert.equal(loadedResources.children.length, 0);
	assert.equal(chat.children.length, 0);
	assert.ok(written.includes("\x1b[3J"), "scrollback erase (CSI 3J) not written");
	assert.ok(clearedScreen, "terminal.clearScreen() not called");
	assert.deepEqual(restored, resetRenderState());
	assert.ok(rendered, "requestRender not called");
});

test("smoke: our reset state matches TuiMainScreen's real render-state shape", () => {
	const { TuiMainScreen } = tui;
	assert.equal(typeof TuiMainScreen.prototype.restoreRenderState, "function");
	assert.equal(typeof TuiMainScreen.prototype.captureRenderState, "function");

	// TS-private fields are plain properties at runtime, so we can invoke
	// captureRenderState against a stub and diff the key sets.
	const captured = TuiMainScreen.prototype.captureRenderState.call({
		previousLines: [],
		previousWidth: 0,
		previousHeight: 0,
		cursorRow: 0,
		hardwareCursorRow: 0,
		maxLinesRendered: 0,
		previousViewportTop: 0,
	});
	assert.deepEqual(
		Object.keys(captured).sort(),
		Object.keys(resetRenderState()).sort(),
		"TuiMainScreen render-state fields drifted — update resetRenderState()",
	);
});

test("smoke: alt-screen TUI still has no restoreRenderState (optional-call path)", () => {
	const { TuiAltScreen } = tui;
	assert.equal(
		typeof TuiAltScreen.prototype.restoreRenderState,
		"undefined",
		"TuiAltScreen grew restoreRenderState — revisit the alt-screen fallback",
	);
});

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
