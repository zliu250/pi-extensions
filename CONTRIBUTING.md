# Contributing

## Setup

```bash
git clone https://github.com/zliu250/pi-extensions
cd pi-extensions
npm ci                                # install all workspace dependencies
```

## Everyday commands

```bash
npm test                              # run all package tests (unit + smoke)
npm run typecheck                     # type-check all packages, strict
npm test -w packages/<name>           # run one package's tests
pi -e ./packages/<name>               # run one package from source, without installing
```

No build step — Pi loads TypeScript directly (via jiti). The monorepo test tooling requires Node >= 22.19 and uses native type stripping; the published extensions remain runtime-compatible with Node >= 18 for older Pi releases.

## Layout

Each extension is a self-contained pi package under `packages/<name>/`:

```
packages/<name>/
├── extensions/<name>.ts    # the extension (single file)
├── test/<name>.test.ts     # unit tests (Node's built-in runner, no framework)
├── test/smoke.test.ts      # assumptions about Pi, checked against the installed Pi
├── package.json            # pi manifest, peerDependency on pi-coding-agent ("*")
├── README.md · CHANGELOG.md · LICENSE
```

## Conventions

- **Smoke tests are mandatory.** Every assumption about Pi — documented API shapes or TUI internals — must be asserted against the actually installed `@earendil-works/pi-coding-agent`, so a Pi upgrade fails CI here instead of surfacing as user bug reports.
- Only type imports from `@earendil-works/pi-coding-agent` (it is a peerDependency with `"*"`; real versions live in the root devDependencies for typechecking).
- Keep each extension a single file where possible; keep READMEs user-facing.
- CI (`.github/workflows/ci.yml`) runs `npm ci && npm test && npm run typecheck` on Node 22/24 for every push and PR.

## Releases

See [RELEASING.md](RELEASING.md).
