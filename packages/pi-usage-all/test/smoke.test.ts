// Smoke test against the real installed Pi packages. It pins the extension API,
// model-registry auth result, and TUI components that /usage depends on.

import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath, pathToFileURL } from "node:url";

import usageAllExtension from "../extensions/usage-all.ts";

function findInstalled(...segments: string[]): string | undefined {
	let dir = fileURLToPath(new URL("..", import.meta.url));
	for (let index = 0; index < 4; index += 1) {
		const candidate = join(dir, "node_modules", ...segments);
		if (existsSync(candidate)) return candidate;
		dir = join(dir, "..");
	}
	return undefined;
}

const agentDir = findInstalled("@earendil-works", "pi-coding-agent")!;
const tuiDir = [
	agentDir && join(agentDir, "node_modules", "@earendil-works", "pi-tui"),
	findInstalled("@earendil-works", "pi-tui"),
].find((directory) => !!directory && existsSync(directory));
const aiDir = agentDir && join(agentDir, "node_modules", "@earendil-works", "pi-ai");

assert.ok(agentDir && existsSync(agentDir), "devDependency @earendil-works/pi-coding-agent must be installed (npm ci)");
assert.ok(tuiDir, "@earendil-works/pi-tui not found under the installed pi-coding-agent");
assert.ok(aiDir && existsSync(aiDir), "@earendil-works/pi-ai not found under the installed pi-coding-agent");

const agent = await import(pathToFileURL(join(agentDir, "dist", "index.js")).href);
const tui = await import(pathToFileURL(join(tuiDir!, "dist", "index.js")).href);

test("smoke: real Pi packages export the TUI components used by /usage", () => {
	assert.equal(typeof agent.DynamicBorder, "function", "pi-coding-agent no longer exports DynamicBorder");
	for (const name of ["Container", "Key", "matchesKey", "Text"]) {
		assert.notEqual(tui[name], undefined, `pi-tui no longer exports ${name}`);
	}
});

test("smoke: model registry and command UI APIs still expose required methods", () => {
	const registryTypes = readFileSync(join(agentDir, "dist", "core", "model-registry.d.ts"), "utf8");
	assert.match(registryTypes, /getProvider\(provider: string\): Provider \| undefined/);
	assert.match(registryTypes, /getProviderAuth\(provider: string\): Promise<AuthResult \| undefined>/);

	const extensionTypes = readFileSync(join(agentDir, "dist", "core", "extensions", "types.d.ts"), "utf8");
	assert.match(extensionTypes, /setStatus\(key: string, text: string \| undefined\): void/);
	assert.match(extensionTypes, /custom<T>\(factory:/);
});

test("smoke: resolved auth still includes the fields used for credential isolation", () => {
	const authTypes = readFileSync(join(aiDir!, "dist", "auth", "types.d.ts"), "utf8");
	assert.match(authTypes, /interface ModelAuth[\s\S]{0,200}apiKey\?: string/);
	assert.match(authTypes, /interface ModelAuth[\s\S]{0,200}headers\?: ProviderHeaders/);
	assert.match(authTypes, /interface ModelAuth[\s\S]{0,200}baseUrl\?: string/);
	assert.match(authTypes, /interface AuthResult[\s\S]{0,200}auth: ModelAuth/);
});

test("smoke: extension registers /usage", () => {
	const commands = new Map<string, { description?: string }>();
	usageAllExtension({
		registerCommand: (name: string, options: { description?: string }) => commands.set(name, options),
	} as never);
	assert.match(commands.get("usage")?.description ?? "", /quota, spend, and reset times/);
});
