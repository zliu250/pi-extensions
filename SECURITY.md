# Security

These extensions run with full user permissions inside Pi.

- `pi-dump-session` deletes exactly one file: the current session's file.
- `pi-usage-all` reads provider credentials through Pi's model registry and makes quota requests. Requests are restricted to hard-coded provider origins, redirects are rejected, and raw credentials are never displayed or persisted.

If you find a vulnerability — for example, a way to delete an unintended file, send a credential to an unintended origin, expose a secret, or execute unintended code — please report it privately via [GitHub Security Advisories](https://github.com/zliu250/pi-extensions/security/advisories/new) rather than a public issue. You should receive a response within a few days.
