// pi-clear-screen — /clear wipes the visible transcript, keeps the session.
//
// Like `clear` / `cls` in a shell: it only blanks what is on screen. It does
// NOT touch the session file, the session name, the message history, or the
// token count sent to the model.
//
// NOTE: pi-clear, @derogab/pi-clear, and pi-aliases also register /clear, but
// they map it to /new. Installing this alongside one of those gives you
// /clear:1 and /clear:2. Pick one, or use /cls here.
//
//   /new     -> new session file, session name gone, context gone
//   /compact -> same session, history summarised (context shrinks)
//   /clear   -> same session, same name, same context — screen wiped only
//
// How it works: pi's interactive TUI mounts a "document" container holding
// [headerContainer, loadedResourcesContainer, chatContainer]. Extensions have
// no direct handle on it, but `ctx.ui.custom()` hands the live TUI to its
// factory. We take the TUI, empty those containers, erase the terminal
// scrollback, reset the differential renderer's cached frame so the next paint
// is a full redraw, and resolve immediately without ever mounting a component.
//
// Caveat: the transcript is only hidden, not deleted. Anything that makes pi
// rebuild the chat from session entries — ctrl+o (tool output expansion),
// theme change, /reload, branch navigation — repaints the full history.
// Run /clear again afterwards.

import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

// Minimal structural types. We deliberately avoid importing pi-tui so the
// extension keeps loading if those internals move between versions.
interface ClearableContainer {
	children?: unknown[];
	clear?: () => void;
}

interface TuiLike {
	children?: unknown[];
	terminal?: { write?: (data: string) => void; clearScreen?: () => void };
	requestRender?: (force?: boolean) => void;
	// Only TuiMainScreen (regular mode) has this; alt-screen mode does not.
	restoreRenderState?: (state: {
		previousLines: string[];
		previousWidth: number;
		previousHeight: number;
		cursorRow: number;
		hardwareCursorRow: number;
		maxLinesRendered: number;
		previousViewportTop: number;
	}) => void;
}

/**
 * Blank frame for `TuiMainScreen.restoreRenderState()`. Exported so the smoke
 * test can verify the shape still matches what the real Pi's
 * `captureRenderState()` produces.
 */
export function resetRenderState() {
	return {
		previousLines: [] as string[],
		previousWidth: -1,
		previousHeight: -1,
		cursorRow: 0,
		hardwareCursorRow: 0,
		maxLinesRendered: 0,
		previousViewportTop: 0,
	};
}

const isContainer = (value: unknown): value is ClearableContainer =>
	typeof value === "object" && value !== null && Array.isArray((value as ClearableContainer).children);

/**
 * Locate the document container: the first mounted child that is a container
 * of exactly three containers (header, loaded resources, chat).
 * Falls back to the first mounted child, which is the document container today.
 */
function findDocumentContainer(tui: TuiLike): ClearableContainer | undefined {
	const mounted = Array.isArray(tui.children) ? tui.children : [];
	for (const child of mounted) {
		if (isContainer(child) && child.children!.length === 3 && child.children!.every(isContainer)) {
			return child;
		}
	}
	return mounted.find(isContainer);
}

function wipe(tui: TuiLike): boolean {
	const document = findDocumentContainer(tui);
	if (!document) return false;

	for (const section of document.children ?? []) {
		if (isContainer(section)) section.clear?.();
	}

	// Erase scrollback (CSI 3J) then the viewport (CSI 2J + home).
	tui.terminal?.write?.("\x1b[3J");
	tui.terminal?.clearScreen?.();

	// Invalidate the cached frame so the next paint is a full redraw rather
	// than a diff against rows we just erased behind the renderer's back.
	tui.restoreRenderState?.(resetRenderState());

	tui.requestRender?.(true);
	return true;
}

async function clearScreen(ctx: ExtensionCommandContext): Promise<void> {
	// Guard terminal-only UI, per the extension docs. Outside TUI mode the host
	// supplies `custom: async () => undefined`, which resolves without ever
	// invoking the factory — so without this check we would report "no
	// transcript to wipe" when the real answer is "there is no terminal".
	if (ctx.mode !== "tui") {
		ctx.ui.notify(`/clear needs interactive TUI mode (running in ${ctx.mode})`, "warning");
		return;
	}

	let wiped = false;
	try {
		await ctx.ui.custom<void>((tui, _theme, _keybindings, done) => {
			// Resolve inside the factory: showExtensionCustom sees `closed` and
			// skips mounting entirely, so the editor is restored with no flicker.
			try {
				wiped = wipe(tui as unknown as TuiLike);
			} finally {
				done();
			}
			return { render: () => [], invalidate: () => {} };
		});
	} catch (error) {
		ctx.ui.notify(`/clear failed: ${error instanceof Error ? error.message : String(error)}`, "error");
		return;
	}

	// Success is silent, like `clear` in a shell. Only speak up if the mounted
	// container layout was not recognised, which means a Pi version whose TUI
	// structure changed underneath us.
	if (!wiped) {
		ctx.ui.notify("/clear: unrecognised TUI layout, nothing wiped", "warning");
	}
}

export default function clearScreenExtension(pi: ExtensionAPI) {
	pi.registerCommand("clear", {
		description: "Wipe the visible transcript (session, name, and context untouched)",
		handler: async (_args, ctx) => clearScreen(ctx),
	});

	pi.registerCommand("cls", {
		description: "Alias for /clear",
		handler: async (_args, ctx) => clearScreen(ctx),
	});
}
