import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test, { after } from "node:test";
import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";

const agentDir = await mkdtemp(join(tmpdir(), "pi-usage-all-test-"));
process.env.PI_CODING_AGENT_DIR = agentDir;
const { default: usageAllExtension } = await import("../extensions/usage-all.ts");

after(async () => {
	await rm(agentDir, { force: true, recursive: true });
});

type CommandHandler = (args: string, ctx: ExtensionCommandContext) => Promise<void>;
const commands = new Map<string, CommandHandler>();
usageAllExtension({
	registerCommand: (name: string, options: { handler: CommandHandler }) => commands.set(name, options.handler),
} as never);

async function runUsage(
	auth: Record<string, unknown>,
	args: string,
	getProviderAuth: (provider: string) => Promise<unknown>,
): Promise<string[]> {
	await writeFile(join(agentDir, "auth.json"), JSON.stringify(auth), { mode: 0o600 });
	const notifications: string[] = [];
	const context = {
		mode: "rpc",
		modelRegistry: {
			getProviderAuth,
			getProvider: () => undefined,
		},
		ui: {
			setStatus: () => undefined,
			notify: (message: string) => notifications.push(message),
		},
	} as unknown as ExtensionCommandContext;
	await commands.get("usage")!(args, context);
	return notifications;
}

test("queries an OAuth alias only at Anthropic's origin", async (testContext) => {
	const token = "secret-anthropic-token";
	let requestedUrl: string | undefined;
	testContext.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
		requestedUrl = String(input);
		return Response.json({
			five_hour: { utilization: 25, resets_at: "2099-09-02T19:00:00Z" },
			seven_day: { utilization: 10, resets_at: "2099-09-04T07:00:00Z" },
			extra_usage: { is_enabled: false },
		});
	});

	const notifications = await runUsage(
		{ "anthropic-team": { type: "oauth" } },
		"refresh",
		async () => ({ auth: { headers: { Authorization: `Bearer ${token}` }, baseUrl: "https://api.anthropic.com/v1" } }),
	);

	assert.equal(requestedUrl, "https://api.anthropic.com/api/oauth/usage");
	assert.match(notifications.join("\n"), /✓ anthropic-team/);
	assert.doesNotMatch(notifications.join("\n"), new RegExp(token));
	const cacheFile = `${createHash("sha256").update("anthropic-team").digest("hex")}.json`;
	const ownCache = await readFile(join(agentDir, "usage-all-cache", cacheFile), "utf8");
	assert.doesNotMatch(ownCache, new RegExp(token));
});

test("sends Codex account scope and renders subscription windows", async (testContext) => {
	const token = "secret-codex-token";
	let requestedUrl: string | undefined;
	let accountHeader: string | null = null;
	testContext.mock.method(globalThis, "fetch", async (
		input: Parameters<typeof fetch>[0],
		init?: Parameters<typeof fetch>[1],
	) => {
		requestedUrl = String(input);
		accountHeader = new Headers(init?.headers).get("chatgpt-account-id");
		return Response.json({
			plan_type: "team",
			rate_limit: {
				primary_window: { used_percent: 30, limit_window_seconds: 18_000, reset_after_seconds: 3600 },
				secondary_window: { used_percent: 10, limit_window_seconds: 604_800, reset_after_seconds: 86_400 },
			},
		});
	});

	const notifications = await runUsage(
		{ "openai-codex": { type: "oauth", accountId: "account-123" } },
		"refresh",
		async () => ({ auth: { apiKey: token, baseUrl: "https://chatgpt.com/backend-api" } }),
	);

	assert.equal(requestedUrl, "https://chatgpt.com/backend-api/wham/usage");
	assert.equal(accountHeader, "account-123");
	assert.match(notifications.join("\n"), /✓ openai-codex[\s\S]*plan      team[\s\S]*30% used/);
	assert.doesNotMatch(notifications.join("\n"), new RegExp(token));
});

test("does not send a proxy credential to the provider origin", async (testContext) => {
	const fetchMock = testContext.mock.method(globalThis, "fetch", async () => {
		throw new Error("fetch must not run");
	});
	const notifications = await runUsage(
		{ "anthropic-proxy": { type: "oauth" } },
		"refresh",
		async () => ({ auth: { apiKey: "proxy-secret", baseUrl: "https://proxy.example.com" } }),
	);

	assert.equal(fetchMock.mock.callCount(), 0);
	assert.match(notifications.join("\n"), /custom or unknown origin · quota check skipped/);
});

test("does not query subscription endpoints with an API key", async (testContext) => {
	const fetchMock = testContext.mock.method(globalThis, "fetch", async () => {
		throw new Error("fetch must not run");
	});
	let resolved = false;
	const notifications = await runUsage(
		{ anthropic: { type: "api_key" }, malformed: null },
		"refresh",
		async () => {
			resolved = true;
			return undefined;
		},
	);

	assert.equal(resolved, false);
	assert.equal(fetchMock.mock.callCount(), 0);
	assert.match(notifications.join("\n"), /API key · no subscription usage endpoint/);
	assert.doesNotMatch(notifications.join("\n"), /malformed/);
});

test("reuses pi-statusline data without modifying its cache", async (testContext) => {
	const token = "cached-anthropic-token";
	const identity = createHash("sha256").update(token).digest("hex").slice(0, 16);
	const statuslineCache = JSON.stringify({
		version: 7,
		accounts: {
			"anthropic-cached": {
				identity,
				attemptedAt: Date.now(),
				resetsAt: Date.now() + 3_600_000,
				claude: { fiveHour: 80, sevenDay: 70 },
				foreignField: "preserve me",
			},
		},
	});
	await writeFile(join(agentDir, "statusline-usage.json"), statuslineCache, { mode: 0o600 });
	const fetchMock = testContext.mock.method(globalThis, "fetch", async () => {
		throw new Error("fresh statusline data should prevent a fetch");
	});

	const notifications = await runUsage(
		{ "anthropic-cached": { type: "oauth" } },
		"",
		async () => ({ auth: { apiKey: token, baseUrl: "https://api.anthropic.com" } }),
	);

	assert.equal(fetchMock.mock.callCount(), 0);
	assert.match(notifications.join("\n"), /sanitized host-wide cache/);
	assert.equal(await readFile(join(agentDir, "statusline-usage.json"), "utf8"), statuslineCache);
});

test("queries OpenRouter and renders zero spend", async (testContext) => {
	const token = "secret-openrouter-token";
	let requestedUrl: string | undefined;
	testContext.mock.method(globalThis, "fetch", async (input: Parameters<typeof fetch>[0]) => {
		requestedUrl = String(input);
		return Response.json({ data: { usage: 0, limit: null, is_free_tier: false } });
	});

	const notifications = await runUsage(
		{ "openrouter-test": { type: "api_key" } },
		"refresh",
		async () => ({ auth: { apiKey: token, baseUrl: "https://openrouter.ai/api/v1" } }),
	);

	assert.equal(requestedUrl, "https://openrouter.ai/api/v1/key");
	assert.match(notifications.join("\n"), /✓ openrouter-test[\s\S]*\$0\.00 total[\s\S]*key limit none/);
	assert.doesNotMatch(notifications.join("\n"), new RegExp(token));
});

test("rejects unsupported command arguments without reading credentials", async () => {
	let resolved = false;
	const notifications = await runUsage(
		{ anthropic: { type: "oauth" } },
		"now",
		async () => {
			resolved = true;
			return undefined;
		},
	);
	assert.equal(resolved, false);
	assert.deepEqual(notifications, ["Usage: /usage [refresh]"]);
});

test("honors host-wide 429 backoff even when refresh is requested", async (testContext) => {
	let fetches = 0;
	testContext.mock.method(globalThis, "fetch", async () => {
		fetches += 1;
		return new Response("rate limited", { status: 429, headers: { "retry-after": "0" } });
	});
	const auth = { "anthropic-rate-test": { type: "oauth" } };
	const resolve = async () => ({ auth: { apiKey: "rate-test-token", baseUrl: "https://api.anthropic.com" } });

	await runUsage(auth, "refresh", resolve);
	const second = await runUsage(auth, "refresh", resolve);

	assert.equal(fetches, 1);
	assert.match(second.join("\n"), /provider polling parked until/);
});
