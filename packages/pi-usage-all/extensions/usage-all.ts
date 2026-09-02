// Read-only /usage dashboard for every credential connected to Pi.
//
// Anthropic and Codex reuse fresh values from pi-statusline's host-wide cache
// without modifying that foreign file. Sanitized summaries and provider 429
// backoff live in this extension's own cache. Tokens stay in memory and are
// sent only to verified first-party origins.

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { pid } from "node:process";
import { DynamicBorder, type ExtensionAPI, type ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Container, Key, matchesKey, Text } from "@earendil-works/pi-tui";
import {
	anthropicStatuslineUsage,
	codexStatuslineUsage,
	formatAnthropic,
	formatCodex,
	formatOpenRouter,
	formatReport,
	formatStatuslineUsage,
	type ProviderReport,
	type StatuslineUsage,
} from "../src/format.ts";

interface AuthEntry {
	type?: unknown;
	accountId?: unknown;
}

interface CachedPayload {
	fingerprint: string;
	fetchedAt: number;
	resetsAt?: number;
	payload: unknown;
}

interface UsageCacheEntry extends StatuslineUsage {
	identity: string;
	attemptedAt: number;
	backoff?: number;
}

type ProviderFamily = "anthropic" | "codex" | "openrouter" | "unsupported";
type ResolvedAuth = Awaited<ReturnType<ExtensionCommandContext["modelRegistry"]["getProviderAuth"]>>;

const AGENT_DIR = expandHome(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
const AUTH_PATH = join(AGENT_DIR, "auth.json");
const STATUSLINE_CACHE_PATH = join(AGENT_DIR, "statusline-usage.json");
const USAGE_CACHE_DIR = join(AGENT_DIR, "usage-all-cache");
const ANTHROPIC_URL = "https://api.anthropic.com/api/oauth/usage";
const CODEX_URL = "https://chatgpt.com/backend-api/wham/usage";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/key";
const FETCH_TIMEOUT_MS = 10_000;
const RATE_LIMIT_BACKOFF_MS = 15 * 60_000;
const CACHE_TTL_MS: Record<Exclude<ProviderFamily, "unsupported">, number> = {
	anthropic: 10 * 60_000,
	codex: 60_000,
	openrouter: 5 * 60_000,
};
const OFFICIAL_ORIGINS: Record<Exclude<ProviderFamily, "unsupported">, string> = {
	anthropic: "https://api.anthropic.com",
	codex: "https://chatgpt.com",
	openrouter: "https://openrouter.ai",
};
const payloadCache = new Map<string, CachedPayload>();

class UnsupportedCredentialError extends Error {}

class HttpStatusError extends Error {
	readonly status: number;
	readonly backoffUntil?: number;

	constructor(status: number, backoffUntil?: number) {
		super(`HTTP ${status}${backoffUntil ? ` · parked until ${formatTime(backoffUntil)}` : ""}`);
		this.status = status;
		this.backoffUntil = backoffUntil;
	}
}

function expandHome(path: string): string {
	return path === "~" ? homedir() : path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function family(provider: string): ProviderFamily {
	if (provider === "anthropic" || provider.startsWith("anthropic-")) return "anthropic";
	if (provider === "openai-codex" || provider.startsWith("openai-codex-")) return "codex";
	if (provider === "openrouter" || provider.startsWith("openrouter-")) return "openrouter";
	return "unsupported";
}

function formatTime(at: number): string {
	return new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "short" }).format(new Date(at));
}

function bearerFromAuth(auth: ResolvedAuth): string | undefined {
	const headers = auth?.auth.headers;
	const header = headers?.Authorization ?? headers?.authorization;
	if (typeof header === "string") return header.replace(/^Bearer\s+/i, "");
	return auth?.auth.apiKey;
}

async function readAuth(): Promise<Record<string, AuthEntry>> {
	const parsed: unknown = JSON.parse(await readFile(AUTH_PATH, "utf8"));
	if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
		throw new Error(`Invalid auth file: ${AUTH_PATH}`);
	}
	return Object.fromEntries(
		Object.entries(parsed).filter((entry): entry is [string, AuthEntry] => typeof entry[1] === "object" && entry[1] !== null),
	);
}

async function resolveCredential(
	ctx: ExtensionCommandContext,
	provider: string,
	entry: AuthEntry,
	kind: Exclude<ProviderFamily, "unsupported">,
): Promise<{ token: string; fingerprint: string }> {
	let resolved: ResolvedAuth;
	try {
		resolved = await ctx.modelRegistry.getProviderAuth(provider);
	} catch {
		throw new Error(`OAuth refresh failed · run /login for ${provider}`);
	}
	const token = bearerFromAuth(resolved);
	if (!token) throw new Error(`credential unavailable · run /login for ${provider}`);
	const baseUrl = resolved?.auth.baseUrl ?? ctx.modelRegistry.getProvider(provider)?.baseUrl;
	if (!baseUrl || new URL(baseUrl).origin !== OFFICIAL_ORIGINS[kind]) {
		throw new UnsupportedCredentialError(`custom or unknown origin · quota check skipped`);
	}
	const account = kind === "codex" && typeof entry.accountId === "string" ? `\n${entry.accountId}` : "";
	const fingerprint = createHash("sha256").update(`${token}${account}`).digest("hex").slice(0, 16);
	return { token, fingerprint };
}

function retryAfter(value: string | null, now: number): number {
	if (value) {
		const seconds = Number(value);
		const candidate = Number.isFinite(seconds) ? now + seconds * 1_000 : Date.parse(value);
		if (Number.isFinite(candidate) && candidate > now) return candidate;
	}
	return now + RATE_LIMIT_BACKOFF_MS;
}

async function fetchJson(url: string, headers: Record<string, string>, now: number): Promise<unknown> {
	const response = await fetch(url, {
		headers: { Accept: "application/json", "User-Agent": "pi-usage-all", ...headers },
		redirect: "error",
		signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
	});
	if (response.status === 429) throw new HttpStatusError(429, retryAfter(response.headers.get("retry-after"), now));
	if (!response.ok) throw new HttpStatusError(response.status);
	return response.json();
}

function record(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function finiteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function parseCacheEntry(value: unknown): UsageCacheEntry | undefined {
	const source = record(value);
	if (typeof source.identity !== "string") return undefined;
	const attemptedAt = finiteNumber(source.attemptedAt);
	if (attemptedAt === undefined) return undefined;
	const entry: UsageCacheEntry = { identity: source.identity, attemptedAt };
	const resetsAt = finiteNumber(source.resetsAt);
	const backoff = finiteNumber(source.backoff);
	if (resetsAt !== undefined) entry.resetsAt = resetsAt;
	if (backoff !== undefined) entry.backoff = backoff;

	const claude = record(source.claude);
	const fiveHour = finiteNumber(claude.fiveHour);
	const sevenDay = finiteNumber(claude.sevenDay);
	const scopedWeekly = finiteNumber(claude.scopedWeekly);
	if (fiveHour !== undefined && sevenDay !== undefined) {
		entry.claude = { fiveHour, sevenDay, ...(scopedWeekly === undefined ? {} : { scopedWeekly }) };
	}

	const codex = record(source.codex);
	const codexFiveHour = finiteNumber(codex.fiveHour);
	const weekly = finiteNumber(codex.weekly);
	if (codexFiveHour !== undefined || weekly !== undefined) {
		entry.codex = {
			...(codexFiveHour === undefined ? {} : { fiveHour: codexFiveHour }),
			...(weekly === undefined ? {} : { weekly }),
		};
	}
	return entry;
}

async function readStatuslineEntry(provider: string): Promise<UsageCacheEntry | undefined> {
	try {
		const root = record(JSON.parse(await readFile(STATUSLINE_CACHE_PATH, "utf8")));
		return parseCacheEntry(record(root.accounts)[provider]);
	} catch {
		return undefined;
	}
}

function usageCachePath(provider: string): string {
	const name = createHash("sha256").update(provider).digest("hex");
	return join(USAGE_CACHE_DIR, `${name}.json`);
}

async function readUsageCache(provider: string): Promise<UsageCacheEntry | undefined> {
	try {
		return parseCacheEntry(JSON.parse(await readFile(usageCachePath(provider), "utf8")));
	} catch {
		return undefined;
	}
}

async function writeUsageCache(provider: string, entry: UsageCacheEntry): Promise<void> {
	await mkdir(USAGE_CACHE_DIR, { recursive: true, mode: 0o700 });
	const destination = usageCachePath(provider);
	const temporary = `${destination}.${pid}.${randomUUID()}.tmp`;
	await writeFile(temporary, JSON.stringify(entry), { mode: 0o600 });
	await rename(temporary, destination);
}

function cachedValue(entry: UsageCacheEntry, kind: ProviderFamily): StatuslineUsage {
	return {
		resetsAt: entry.resetsAt,
		...(kind === "anthropic" && entry.claude ? { claude: entry.claude } : {}),
		...(kind === "codex" && entry.codex ? { codex: entry.codex } : {}),
	};
}

function hasUsage(entry: UsageCacheEntry | undefined, kind: ProviderFamily): boolean {
	return kind === "anthropic" ? entry?.claude !== undefined : kind === "codex" ? entry?.codex !== undefined : false;
}

function summaryIsFresh(
	entry: UsageCacheEntry | undefined,
	identity: string,
	kind: Exclude<ProviderFamily, "unsupported">,
	now: number,
): entry is UsageCacheEntry {
	if (!entry || entry.identity !== identity || !hasUsage(entry, kind)) return false;
	if (entry.resetsAt !== undefined && entry.resetsAt <= now) return false;
	return now - entry.attemptedAt < CACHE_TTL_MS[kind];
}

function payloadIsFresh(cached: CachedPayload | undefined, identity: string, kind: Exclude<ProviderFamily, "unsupported">, now: number): cached is CachedPayload {
	if (!cached || cached.fingerprint !== identity) return false;
	if (cached.resetsAt !== undefined && cached.resetsAt <= now) return false;
	return now - cached.fetchedAt < CACHE_TTL_MS[kind];
}

async function fetchProvider(
	provider: string,
	entry: AuthEntry,
	ctx: ExtensionCommandContext,
	kind: Exclude<ProviderFamily, "unsupported">,
	force: boolean,
	now: number,
): Promise<{ payload?: unknown; summary?: StatuslineUsage; cached: boolean }> {
	const credential = await resolveCredential(ctx, provider, entry, kind);
	const ownCache = await readUsageCache(provider);
	const statuslineCache = kind === "openrouter" ? undefined : await readStatuslineEntry(provider);
	const latest = [ownCache, statuslineCache]
		.filter((candidate): candidate is UsageCacheEntry => candidate?.identity === credential.fingerprint)
		.sort((left, right) => right.attemptedAt - left.attemptedAt)[0];
	if (latest?.backoff && latest.backoff > now) {
		if (hasUsage(latest, kind)) return { summary: cachedValue(latest, kind), cached: true };
		throw new Error(`provider polling parked until ${formatTime(latest.backoff)}`);
	}

	const local = payloadCache.get(provider);
	if (!force && payloadIsFresh(local, credential.fingerprint, kind, now)) return { payload: local.payload, cached: true };
	if (!force && summaryIsFresh(ownCache, credential.fingerprint, kind, now)) {
		return { summary: cachedValue(ownCache, kind), cached: true };
	}
	if (!force && summaryIsFresh(statuslineCache, credential.fingerprint, kind, now)) {
		return { summary: cachedValue(statuslineCache, kind), cached: true };
	}

	try {
		const payload = await requestProvider(kind, credential.token, entry, now);
		const usage = kind === "anthropic" ? anthropicStatuslineUsage(payload) : kind === "codex" ? codexStatuslineUsage(payload, now) : undefined;
		payloadCache.set(provider, { fingerprint: credential.fingerprint, fetchedAt: now, resetsAt: usage?.resetsAt, payload });
		await writeUsageCache(provider, { identity: credential.fingerprint, attemptedAt: now, ...usage });
		return { payload, cached: false };
	} catch (error) {
		if (error instanceof HttpStatusError && error.status === 429 && error.backoffUntil) {
			const previous = ownCache?.identity === credential.fingerprint ? ownCache : undefined;
			await writeUsageCache(provider, {
				...previous,
				identity: credential.fingerprint,
				attemptedAt: now,
				backoff: error.backoffUntil,
			});
		}
		throw error;
	}
}

async function requestProvider(kind: Exclude<ProviderFamily, "unsupported">, token: string, entry: AuthEntry, now: number): Promise<unknown> {
	if (kind === "anthropic") {
		return fetchJson(ANTHROPIC_URL, { Authorization: `Bearer ${token}`, "anthropic-beta": "oauth-2025-04-20" }, now);
	}
	if (kind === "codex") {
		if (typeof entry.accountId !== "string") throw new Error("ChatGPT account id unavailable");
		return fetchJson(CODEX_URL, { Authorization: `Bearer ${token}`, "chatgpt-account-id": entry.accountId }, now);
	}
	return fetchJson(OPENROUTER_URL, { Authorization: `Bearer ${token}` }, now);
}

function providerOrder([provider]: [string, AuthEntry]): number {
	return { anthropic: 0, codex: 1, openrouter: 2, unsupported: 3 }[family(provider)];
}

async function queryProvider(provider: string, entry: AuthEntry, ctx: ExtensionCommandContext, force: boolean, now: number): Promise<ProviderReport> {
	const kind = family(provider);
	if (kind === "unsupported") return { provider, status: "unsupported", lines: ["  connected · no quota adapter"] };
	if ((kind === "anthropic" || kind === "codex") && entry.type !== "oauth") {
		return { provider, status: "unsupported", lines: ["  API key · no subscription usage endpoint"] };
	}
	try {
		const result = await fetchProvider(provider, entry, ctx, kind, force, now);
		if (result.summary) return formatStatuslineUsage(provider, result.summary, now);
		const report = kind === "anthropic"
			? formatAnthropic(provider, result.payload, now)
			: kind === "codex"
				? formatCodex(provider, result.payload, now)
				: formatOpenRouter(provider, result.payload);
		return result.cached ? { ...report, lines: [...report.lines, "  source    session cache"] } : report;
	} catch (error) {
		const status = error instanceof UnsupportedCredentialError ? "unsupported" : "error";
		return { provider, status, lines: [`  ${error instanceof Error ? error.message : String(error)}`] };
	}
}

async function showReport(ctx: ExtensionCommandContext, report: string): Promise<void> {
	if (ctx.mode !== "tui") {
		ctx.ui.notify(report, "info");
		return;
	}
	await ctx.ui.custom<void>((tui, theme, _keybindings, done) => {
		const container = new Container();
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		container.addChild(new Text(report, 1, 0));
		container.addChild(new Text("enter/esc/q close · /usage refresh ignores fresh values, never provider backoff", 1, 0));
		container.addChild(new DynamicBorder((text: string) => theme.fg("accent", text)));
		return {
			render: (width: number) => container.render(width),
			invalidate: () => container.invalidate(),
			handleInput: (data: string) => {
				if (matchesKey(data, Key.enter) || matchesKey(data, Key.escape) || data === "q") done();
				else tui.requestRender();
			},
		};
	});
}

export default function usageAllExtension(pi: ExtensionAPI): void {
	pi.registerCommand("usage", {
		description: "Show quota, spend, and reset times for every connected provider",
		handler: async (args, ctx) => {
			const force = args.trim() === "refresh";
			if (args.trim() && !force) {
				ctx.ui.notify("Usage: /usage [refresh]", "warning");
				return;
			}
			ctx.ui.setStatus("usage-all", "checking provider usage…");
			try {
				const auth = await readAuth();
				const entries = Object.entries(auth).sort((a, b) => providerOrder(a) - providerOrder(b));
				const now = Date.now();
				const reports = await Promise.all(entries.map(([provider, entry]) => queryProvider(provider, entry, ctx, force, now)));
				ctx.ui.setStatus("usage-all", undefined);
				await showReport(ctx, formatReport(reports, now));
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
			} finally {
				ctx.ui.setStatus("usage-all", undefined);
			}
		},
	});
}
