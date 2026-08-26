// Smoke test against the REAL installed @earendil-works/pi-coding-agent.
//
// The unit tests in clear-screen.test.ts exercise mocks that encode our
// assumptions about Pi's TUI internals. This file checks those assumptions
// against the actually installed Pi, so `npm test` fails at CI time — not
// user-report time — when a Pi upgrade changes:
//
//   1. The document container layout ([header, loadedResources, chat]).
//   2. Container's `children` / `clear()` contract.
//   3. TuiMainScreen's render-state shape (what restoreRenderState accepts).
//   4. The alt-screen TUI having no restoreRenderState (our optional-call path).
//
// Run with: npm test  (Node >= 22.19 for native TypeScript stripping)

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import clearScreenExtension, { resetRenderState } from "../extensions/clear-screen.ts";

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

// pi-tui is a dependency of the agent; it may be nested or hoisted.
const tuiDir = [
	agentDir && join(agentDir, "node_modules", "@earendil-works", "pi-tui"),
	findInstalled("@earendil-works", "pi-tui"),
].find((dir) => !!dir && existsSync(dir));

assert.ok(agentDir && existsSync(agentDir), "devDependency @earendil-works/pi-coding-agent must be installed (npm ci)");
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
