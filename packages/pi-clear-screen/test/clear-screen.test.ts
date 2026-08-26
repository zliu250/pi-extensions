// Run with: npm test  (Node >= 22.19 for native TypeScript stripping)
//
// The extension imports only types, so Node can execute it directly once type
// annotations are stripped. No build step and no test framework.

import assert from "node:assert/strict";
import test from "node:test";

import clearScreenExtension from "../extensions/clear-screen.ts";

type Cmd = { description?: string; handler: (args: string, ctx: any) => Promise<void> };

function load() {
	const commands = new Map<string, Cmd>();
	clearScreenExtension({ registerCommand: (n: string, o: Cmd) => commands.set(n, o) } as any);
	return commands;
}

/** Mock container mirroring pi-tui's Container. */
function container(name: string, children: unknown[] = []) {
	return {
		name,
		children,
		cleared: false,
		clear(this: any) {
			this.children = [];
			this.cleared = true;
		},
	};
}

/** Mock of pi's interactive TUI, in its real mount order. */
function mockTui() {
	const header = container("header", ["logo"]);
	const resources = container("loadedResources", ["ctx-file"]);
	const chat = container("chat", ["msg-1", "msg-2", "msg-3"]);
	const document = container("document", [header, resources, chat]);
	const siblings = [
		container("pendingMessages"),
		container("status"),
		container("widgetsAbove"),
		container("editor"),
		container("widgetsBelow"),
		container("footer"),
	];
	const writes: string[] = [];
	let renderState: any;
	let forced: boolean | undefined;
	return {
		parts: { header, resources, chat, document, siblings },
		writes,
		get renderState() {
			return renderState;
		},
		get forced() {
			return forced;
		},
		tui: {
			children: [document, ...siblings],
			terminal: {
				write: (d: string) => writes.push(d),
				clearScreen: () => writes.push("<clearScreen>"),
			},
			restoreRenderState: (s: any) => (renderState = s),
			requestRender: (f?: boolean) => (forced = f),
		},
	};
}

function mockCtx(tui: unknown, mode = "tui") {
	const notifications: Array<[string, string]> = [];
	return {
		notifications,
		ctx: {
			mode,
			ui: {
				custom: async (factory: any) => {
					factory(tui, {}, {}, () => {});
					return undefined;
				},
				notify: (m: string, t: string) => notifications.push([t, m]),
			},
		},
	};
}

test("registers /clear and /cls", () => {
	const commands = load();
	assert.deepEqual([...commands.keys()], ["clear", "cls"]);
	assert.match(commands.get("clear")!.description!, /session, name, and context untouched/);
});

test("wipes the document containers and leaves siblings alone", async () => {
	const commands = load();
	const m = mockTui();
	const { ctx, notifications } = mockCtx(m.tui);

	await commands.get("clear")!.handler("", ctx);

	assert.equal(m.parts.chat.children.length, 0, "chat wiped");
	assert.equal(m.parts.header.children.length, 0, "header wiped");
	assert.equal(m.parts.resources.children.length, 0, "loaded resources wiped");
	for (const sibling of m.parts.siblings) {
		assert.equal(sibling.cleared, false, `${sibling.name} must not be cleared`);
	}
	assert.deepEqual(notifications, [], "success is silent");
});

test("erases scrollback, resets render state, forces a full repaint", async () => {
	const commands = load();
	const m = mockTui();
	const { ctx } = mockCtx(m.tui);

	await commands.get("clear")!.handler("", ctx);

	assert.deepEqual(m.writes, ["\x1b[3J", "<clearScreen>"], "CSI 3J then clearScreen");
	assert.equal(m.renderState.previousWidth, -1);
	assert.equal(m.renderState.previousHeight, -1);
	assert.deepEqual(m.renderState.previousLines, []);
	assert.equal(m.forced, true, "render must be forced");
});

test("/cls behaves identically to /clear", async () => {
	const commands = load();
	const m = mockTui();
	const { ctx } = mockCtx(m.tui);

	await commands.get("cls")!.handler("", ctx);

	assert.equal(m.parts.chat.children.length, 0);
	assert.equal(m.forced, true);
});

test("refuses non-TUI modes instead of reporting an empty transcript", async () => {
	for (const mode of ["print", "json", "rpc"]) {
		const commands = load();
		const m = mockTui();
		const { ctx, notifications } = mockCtx(m.tui, mode);

		await commands.get("clear")!.handler("", ctx);

		assert.equal(m.parts.chat.children.length, 3, `${mode}: transcript untouched`);
		assert.equal(notifications.length, 1);
		assert.equal(notifications[0][0], "warning");
		assert.match(notifications[0][1], new RegExp(`interactive TUI mode \\(running in ${mode}\\)`));
	}
});

test("warns instead of throwing when the TUI layout is unrecognised", async () => {
	const commands = load();
	const { ctx, notifications } = mockCtx({ children: [] });

	await commands.get("clear")!.handler("", ctx);

	assert.equal(notifications.length, 1);
	assert.equal(notifications[0][0], "warning");
	assert.match(notifications[0][1], /unrecognised TUI layout/);
});

test("survives an alt-screen TUI with no terminal or restoreRenderState", async () => {
	const commands = load();
	const chat = container("chat", ["a", "b"]);
	const document = container("document", [chat]);
	let forced: boolean | undefined;
	const tui = { children: [document], requestRender: (f?: boolean) => (forced = f) };
	const { ctx, notifications } = mockCtx(tui);

	await commands.get("clear")!.handler("", ctx);

	assert.equal(chat.children.length, 0);
	assert.equal(forced, true);
	assert.deepEqual(notifications, []);
});

test("reports an error if the host UI throws", async () => {
	const commands = load();
	const notifications: Array<[string, string]> = [];
	const ctx = {
		mode: "tui",
		ui: {
			custom: async () => {
				throw new Error("boom");
			},
			notify: (m: string, t: string) => notifications.push([t, m]),
		},
	};

	await commands.get("clear")!.handler("", ctx);

	assert.equal(notifications[0][0], "error");
	assert.match(notifications[0][1], /\/clear failed: boom/);
});
