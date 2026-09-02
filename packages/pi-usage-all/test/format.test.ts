import assert from "node:assert/strict";
import test from "node:test";
import {
	anthropicStatuslineUsage,
	codexStatuslineUsage,
	formatAnthropic,
	formatCodex,
	formatOpenRouter,
	formatStatuslineUsage,
} from "../src/format.ts";

const NOW = Date.parse("2026-09-02T16:00:00Z");

test("Anthropic formats both windows, scoped limit, and extra usage", () => {
	const payload = {
		five_hour: { utilization: 21, resets_at: "2026-09-02T19:00:00Z" },
		seven_day: { utilization: 19, resets_at: "2026-09-04T07:00:00Z" },
		limits: [{ kind: "weekly_scoped", percent: 30, resets_at: "2026-09-04T07:00:00Z", scope: { model: { display_name: "Fable" } } }],
		extra_usage: { is_enabled: true, decimal_places: 2, used_credits: 3582, monthly_limit: 10000, currency: "USD", utilization: 35.82 },
	};
	const report = formatAnthropic("anthropic-team", payload, NOW);
	assert.equal(report.status, "ok");
	assert.match(report.lines.join("\n"), /21% used.*3h 0m/);
	assert.match(report.lines.join("\n"), /Fable.*30% used/);
	assert.match(report.lines.join("\n"), /\$35\.82 \/ \$100\.00/);
	assert.deepEqual(anthropicStatuslineUsage(payload)?.claude, { fiveHour: 79, sevenDay: 81, scopedWeekly: 70 });
});

test("Anthropic rejects a payload without both subscription windows", () => {
	assert.equal(formatAnthropic("anthropic", { extra_usage: { is_enabled: false } }, NOW).status, "error");
});

test("Codex falls back to relative reset time", () => {
	const payload = {
		plan_type: "team",
		rate_limit: { primary_window: { used_percent: 30, limit_window_seconds: 18_000, reset_after_seconds: 3600 } },
	};
	const report = formatCodex("openai-codex", payload, NOW);
	assert.match(report.lines.join("\n"), /30% used.*1h 0m/);
	assert.equal(codexStatuslineUsage(payload, NOW)?.resetsAt, NOW + 3_600_000);
});

test("Codex rejects a payload without quota windows", () => {
	assert.equal(formatCodex("openai-codex", { plan_type: "team" }, NOW).status, "error");
});

test("Codex cache summary does not overwrite the first short window", () => {
	const payload = {
		rate_limit: {
			primary_window: { used_percent: 20, limit_window_seconds: 18_000 },
			secondary_window: { used_percent: 90, limit_window_seconds: 36_000 },
		},
	};
	assert.deepEqual(codexStatuslineUsage(payload, NOW)?.codex, { fiveHour: 80 });
});

test("OpenRouter distinguishes absent spend and limit from zero and null", () => {
	const absent = formatOpenRouter("openrouter", { data: { is_free_tier: true } });
	assert.match(absent.lines.join("\n"), /spend     unavailable/);
	assert.match(absent.lines.join("\n"), /key limit unavailable/);
	const unlimited = formatOpenRouter("openrouter", { data: { usage: 0, limit: null, is_free_tier: true } });
	assert.match(unlimited.lines.join("\n"), /\$0\.00 total/);
	assert.match(unlimited.lines.join("\n"), /key limit none/);
});

test("Expired cached boundaries render as due, not zero minutes", () => {
	const report = formatStatuslineUsage("anthropic", {
		resetsAt: NOW - 1000,
		claude: { fiveHour: 10, sevenDay: 20 },
	}, NOW);
	assert.match(report.lines.join("\n"), /next      reset due/);
});
