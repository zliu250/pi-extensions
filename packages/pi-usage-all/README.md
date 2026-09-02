# pi-usage-all

A Pi extension that adds one dashboard for the quota and spend information attached to every credential in Pi's `auth.json`.

```text
Provider usage · Sep 2, 2026 at 9:00:00 AM MST

✓ anthropic
  5 hour   ██░░░░░░░░  21% used · 79% left · resets Wed, Sep 2, 12:00 PM MST (in 3h 0m)
  weekly   ██░░░░░░░░  19% used · 81% left · resets Fri, Sep 4, 12:00 AM MST (in 1d 15h)
  extra     off

✓ anthropic-claude-team
  5 hour   ██████░░░░  61% used · 39% left · resets Wed, Sep 2, 12:00 PM MST (in 3h 0m)
  extra     ENABLED · $35.82 / $100.00 · 35.82% used

✓ openai-codex
  plan      team
  5 hour   ███░░░░░░░  30% used · 70% left · resets Wed, Sep 2, 10:00 AM MST (in 1h 0m)

✓ openrouter
  plan      paid
  spend     $0.00 total
  key limit none
```

## Install

```bash
pi install npm:pi-usage-all
```

Restart Pi or run `/reload`, then use:

```text
/usage          show all connected credentials
/usage refresh  bypass fresh cached values and fetch full details
```

`refresh` still honors provider rate-limit backoff. It will not repeatedly hit an endpoint that has returned HTTP 429.

## Supported credentials

| Pi provider | Credential | Information shown |
| --- | --- | --- |
| `anthropic` and `anthropic-*` aliases | OAuth | 5-hour and weekly usage, model-scoped weekly limits, extra-usage spend |
| `openai-codex` and `openai-codex-*` aliases | OAuth | plan, quota windows, credits, reset credits |
| `openrouter` and `openrouter-*` aliases | API key | tier, spend, key limit, limit reset |

Other entries are listed as connected with `no quota adapter`. Anthropic and Codex API keys are listed as unsupported because their subscription-usage endpoints require OAuth credentials.

Aliases created by [`@hank-warren/pi-multi-login`](https://www.npmjs.com/package/@hank-warren/pi-multi-login) are supported. Each alias is resolved independently, so personal and team Anthropic accounts appear as separate sections.

## Credential safety

The extension reads credentials through Pi's model registry and sends them only to the matching provider-owned origin:

- Anthropic: `https://api.anthropic.com`
- Codex: `https://chatgpt.com`
- OpenRouter: `https://openrouter.ai`

If a provider or alias resolves to a proxy or custom base URL, the quota request is skipped rather than sending that credential to a different origin. Tokens, account IDs, response bodies from failed requests, and account identity fields are never displayed or written to the usage cache. Cache identities are truncated SHA-256 fingerprints.

## Caching and rate limits

Anthropic and Codex reuse fresh values from `pi-statusline`'s host-wide `~/.pi/agent/statusline-usage.json` cache without modifying that file. The extension writes only sanitized quota summaries, credential fingerprints, and rate-limit backoff to its own `~/.pi/agent/usage-all-cache/` directory. Full provider responses remain in memory. OpenRouter uses the same cache only for backoff; its spend response remains process-local.

The first-party usage endpoints and response schemas are provider-controlled and may change. An unrecognized response is reported as an error instead of being rendered as zero usage.

## Command conflicts

Pi does not provide a built-in `/usage` command, but other extensions may register one. If two installed extensions use the same command, Pi exposes numbered variants such as `/usage:1` and `/usage:2`. Remove the extension you do not want, or invoke the numbered command shown by Pi.

## Development

See the [monorepo README](https://github.com/zliu250/pi-extensions#readme). Quick loop:

```bash
npm test -w packages/pi-usage-all
pi -e ./packages/pi-usage-all
```

`test/smoke.test.ts` pins the Pi model-registry, auth-result, command UI, and TUI APIs used by this package against the installed Pi version.

## License

MIT © 2026 zliu250
