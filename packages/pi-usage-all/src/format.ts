export interface ProviderReport {
	provider: string;
	status: "ok" | "error" | "unsupported";
	lines: string[];
}

export interface StatuslineUsage {
	resetsAt?: number;
	claude?: { fiveHour: number; sevenDay: number; scopedWeekly?: number };
	codex?: { fiveHour?: number; weekly?: number };
}

interface UsageWindow {
	usedPercent: number;
	resetAt?: number;
}

function number(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function object(value: unknown): Record<string, unknown> {
	return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
}

function has(source: Record<string, unknown>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key);
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function bar(used: number): string {
	const filled = Math.round(clampPercent(used) / 10);
	return `${"█".repeat(filled)}${"░".repeat(10 - filled)}`;
}

function duration(milliseconds: number): string {
	const minutes = Math.round(milliseconds / 60_000);
	if (minutes <= 0) return "due";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h ${minutes % 60}m`;
	const days = Math.floor(hours / 24);
	return `${days}d ${hours % 24}h`;
}

function resetText(resetAt: number | undefined, now: number): string {
	if (resetAt === undefined) return "reset unknown";
	const absolute = new Intl.DateTimeFormat(undefined, {
		weekday: "short",
		month: "short",
		day: "numeric",
		hour: "numeric",
		minute: "2-digit",
		timeZoneName: "short",
	}).format(new Date(resetAt));
	return resetAt <= now ? `reset due (${absolute})` : `resets ${absolute} (in ${duration(resetAt - now)})`;
}

function usageLine(label: string, usedPercent: number): string {
	const used = clampPercent(usedPercent);
	return `  ${label.padEnd(8)} ${bar(used)} ${used.toFixed(0).padStart(3)}% used · ${(100 - used).toFixed(0)}% left`;
}

function windowLine(label: string, window: UsageWindow, now: number): string {
	return `${usageLine(label, window.usedPercent)} · ${resetText(window.resetAt, now)}`;
}

function isoTime(value: unknown): number | undefined {
	if (typeof value !== "string") return undefined;
	const parsed = Date.parse(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function earliest(values: Array<number | undefined>): number | undefined {
	const usable = values.filter((value): value is number => value !== undefined);
	return usable.length > 0 ? Math.min(...usable) : undefined;
}

function money(amount: number, currency = "USD"): string {
	return new Intl.NumberFormat(undefined, { style: "currency", currency }).format(amount);
}

function anthropicWindows(body: Record<string, unknown>): UsageWindow[] {
	const windows: UsageWindow[] = [];
	for (const source of [body.five_hour, body.seven_day].map(object)) {
		const usedPercent = number(source.utilization);
		if (usedPercent !== undefined) windows.push({ usedPercent, resetAt: isoTime(source.resets_at) });
	}
	return windows;
}

/** Parse the subset written to pi-statusline's shared provider-usage cache. */
export function anthropicStatuslineUsage(payload: unknown): StatuslineUsage | undefined {
	const body = object(payload);
	const windows = anthropicWindows(body);
	if (windows.length < 2) return undefined;
	const limits = Array.isArray(body.limits) ? body.limits.map(object) : [];
	const scoped = limits.find((limit) => limit.kind === "weekly_scoped");
	const scopedUsed = number(scoped?.percent);
	const scopedReset = isoTime(scoped?.resets_at);
	return {
		resetsAt: earliest([...windows.map((window) => window.resetAt), scopedReset]),
		claude: {
			fiveHour: Math.round(100 - clampPercent(windows[0].usedPercent)),
			sevenDay: Math.round(100 - clampPercent(windows[1].usedPercent)),
			...(scopedUsed === undefined ? {} : { scopedWeekly: Math.round(100 - clampPercent(scopedUsed)) }),
		},
	};
}

/** Format Anthropic OAuth usage without exposing account identity fields. */
export function formatAnthropic(provider: string, payload: unknown, now: number): ProviderReport {
	const body = object(payload);
	const windows = anthropicWindows(body);
	if (windows.length < 2) return { provider, status: "error", lines: ["  no recognizable 5-hour/weekly windows"] };
	const lines = [windowLine("5 hour", windows[0], now), windowLine("weekly", windows[1], now)];
	const limits = Array.isArray(body.limits) ? body.limits.map(object) : [];
	for (const limit of limits.filter((candidate) => candidate.kind === "weekly_scoped")) {
		const usedPercent = number(limit.percent);
		if (usedPercent === undefined) continue;
		const model = object(object(limit.scope).model).display_name;
		lines.push(windowLine(typeof model === "string" ? model : "scoped", {
			usedPercent,
			resetAt: isoTime(limit.resets_at),
		}, now));
	}
	lines.push(formatExtraUsage(object(body.extra_usage)));
	return { provider, status: "ok", lines };
}

function formatExtraUsage(extra: Record<string, unknown>): string {
	if (extra.is_enabled !== true) return "  extra     off";
	const decimals = number(extra.decimal_places) ?? 2;
	const divisor = 10 ** decimals;
	const used = number(extra.used_credits);
	const limit = number(extra.monthly_limit);
	const currency = typeof extra.currency === "string" ? extra.currency : "USD";
	const amounts = used !== undefined && limit !== undefined
		? `${money(used / divisor, currency)} / ${money(limit / divisor, currency)}`
		: "amount unavailable";
	const percent = number(extra.utilization);
	return `  extra     ENABLED · ${amounts}${percent === undefined ? "" : ` · ${percent.toFixed(2)}% used`}`;
}

function codexWindow(source: unknown, now: number): UsageWindow | undefined {
	const window = object(source);
	const usedPercent = number(window.used_percent);
	if (usedPercent === undefined) return undefined;
	const absolute = number(window.reset_at);
	const relative = number(window.reset_after_seconds);
	const resetAt = absolute !== undefined ? absolute * 1_000 : relative === undefined ? undefined : now + relative * 1_000;
	return { usedPercent, resetAt };
}

function codexLabel(source: unknown): string {
	const seconds = number(object(source).limit_window_seconds);
	if (seconds === undefined) return "window";
	if (seconds < 86_400) return `${Math.round(seconds / 3600)} hour`;
	if (seconds < 1_209_600) return `${Math.round(seconds / 86_400)} day`;
	return `${Math.round(seconds / 2_592_000)} month`;
}

/** Parse Codex windows for pi-statusline's shared provider-usage cache. */
export function codexStatuslineUsage(payload: unknown, now: number): StatuslineUsage | undefined {
	const rate = object(object(payload).rate_limit);
	const sources = [rate.primary_window, rate.secondary_window];
	const windows = sources.map((source) => ({ source, window: codexWindow(source, now) }))
		.filter((item): item is { source: unknown; window: UsageWindow } => item.window !== undefined);
	if (windows.length === 0) return undefined;
	const codex: NonNullable<StatuslineUsage["codex"]> = {};
	for (const { source, window } of windows) {
		const seconds = number(object(source).limit_window_seconds);
		const remaining = Math.round(100 - clampPercent(window.usedPercent));
		if (seconds !== undefined && seconds < 86_400) {
			if (codex.fiveHour === undefined) codex.fiveHour = remaining;
		} else if (codex.weekly === undefined) {
			codex.weekly = remaining;
		}
	}
	return { resetsAt: earliest(windows.map(({ window }) => window.resetAt)), codex };
}

/** Format Codex subscription windows, plan, credits, and reset credits. */
export function formatCodex(provider: string, payload: unknown, now: number): ProviderReport {
	const body = object(payload);
	const rate = object(body.rate_limit);
	const sources = [rate.primary_window, rate.secondary_window];
	const windows = sources.map((source) => ({ source, window: codexWindow(source, now) }))
		.filter((item): item is { source: unknown; window: UsageWindow } => item.window !== undefined);
	if (windows.length === 0) return { provider, status: "error", lines: ["  no recognizable quota windows"] };
	const plan = typeof body.plan_type === "string" ? body.plan_type : "unknown plan";
	const lines = [`  plan      ${plan}`];
	for (const { source, window } of windows) lines.push(windowLine(codexLabel(source), window, now));
	const credits = object(body.credits);
	const balance = number(credits.balance);
	if (credits.has_credits === true || balance !== undefined) lines.push(`  credits   ${balance === undefined ? "available" : money(balance)}`);
	const resets = object(body.rate_limit_reset_credits);
	const available = number(resets.available_count);
	const applicable = number(resets.applicable_available_count);
	if (available !== undefined) lines.push(`  resets    ${available} credit${available === 1 ? "" : "s"} available${applicable === undefined ? "" : ` · ${applicable} usable now`}`);
	return { provider, status: "ok", lines };
}

/** Format OpenRouter API-key spend and optional key limit. */
export function formatOpenRouter(provider: string, payload: unknown): ProviderReport {
	const root = object(payload);
	const data = object(root.data);
	const known = ["usage", "usage_daily", "usage_weekly", "usage_monthly", "limit", "is_free_tier"].some((key) => has(data, key));
	if (!has(root, "data") || !known) return { provider, status: "error", lines: ["  no recognizable usage fields"] };
	const tier = data.is_free_tier === true ? "free tier" : data.is_free_tier === false ? "paid" : "unknown";
	const lines = [`  plan      ${tier}`];
	const spend = [["usage", "total"], ["usage_daily", "today"], ["usage_weekly", "week"], ["usage_monthly", "month"]]
		.flatMap(([key, label]) => {
			const amount = number(data[key]);
			return amount === undefined ? [] : [`${money(amount)} ${label}`];
		});
	lines.push(`  spend     ${spend.length > 0 ? spend.join(" · ") : "unavailable"}`);
	const limit = number(data.limit);
	const remaining = number(data.limit_remaining);
	if (data.limit === null) lines.push("  key limit none");
	else if (limit !== undefined) lines.push(`  key limit ${money(limit)}${remaining === undefined ? "" : ` · ${money(remaining)} left`}`);
	else lines.push("  key limit unavailable");
	if (typeof data.limit_reset === "string") lines.push(`  reset     ${data.limit_reset}`);
	return { provider, status: "ok", lines };
}

/** Render a safe summary from a sanitized host-wide cache. */
export function formatStatuslineUsage(provider: string, usage: StatuslineUsage, now: number): ProviderReport {
	const lines: string[] = [];
	if (usage.claude) {
		lines.push(usageLine("5 hour", 100 - usage.claude.fiveHour));
		lines.push(usageLine("weekly", 100 - usage.claude.sevenDay));
		if (usage.claude.scopedWeekly !== undefined) {
			lines.push(usageLine("scoped", 100 - usage.claude.scopedWeekly));
		}
	}
	if (usage.codex) {
		if (usage.codex.fiveHour !== undefined) lines.push(usageLine("5 hour", 100 - usage.codex.fiveHour));
		if (usage.codex.weekly !== undefined) lines.push(usageLine("weekly", 100 - usage.codex.weekly));
	}
	const hasUsage = lines.length > 0;
	if (usage.resetsAt !== undefined) lines.push(`  next      ${resetText(usage.resetsAt, now)}`);
	lines.push("  source    sanitized host-wide cache · refresh for full reset detail");
	return { provider, status: hasUsage ? "ok" : "error", lines };
}

/** Render one report per credential in a stable, scan-friendly text view. */
export function formatReport(reports: ProviderReport[], now: number): string {
	const header = new Intl.DateTimeFormat(undefined, { dateStyle: "medium", timeStyle: "long" }).format(new Date(now));
	const sections: string[] = [];
	for (const report of reports) {
		const marker = report.status === "ok" ? "✓" : report.status === "unsupported" ? "–" : "✗";
		sections.push([`${marker} ${report.provider}`, ...report.lines].join("\n"));
	}
	return [`Provider usage · ${header}`, "", sections.join("\n\n")].join("\n");
}
