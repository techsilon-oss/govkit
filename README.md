# govkit

A **Claude Code plugin** that scaffolds the core build/deploy guardrails into any project in one command — `/govkit-init`. It gives you a consistent governance spine (branch flow, a CI-fallback **Local Release Gate**, `PROJECT-HUB`/`PRIORITY-ROADMAP`, a generic `/sdlc`) without copy-pasting between repos.

Decoupled and self-contained: it depends on nothing beyond `git`, the `gh` CLI, and Node/npm.

---

## Prerequisites (per machine)

- **Claude Code** (govkit is a plugin).
- **git**.
- **GitHub CLI (`gh`)**, authenticated: `gh auth login`. (Used by `/sdlc` and the release gate's `--pr`.)
- **Node + npm**. The release gate runs via `tsx`, which is added **per project** as a devDependency (`npm i -D tsx`) — not a machine-global tool.

govkit does **not** require the `superpowers` plugin (optional companion), any other plugin, MCP servers, Python, or global hooks.

## Install / enable

govkit is used **from within Claude Code**, after a one-time per-machine install:

```bash
claude plugin marketplace add techsilon-oss/govkit
claude plugin install govkit
```

Restart Claude Code if the skills don't appear immediately. (If this repo is private, installing on a new machine needs your git/`gh` access to it.) Once installed, `/govkit-init` and `/sdlc` are available in every project on that machine.

## Usage — new project

```bash
mkdir my-app && cd my-app && git init
# in Claude Code, from this directory:
/govkit-init
# answer ~4 prompts (project name, working branch, package manager, deploy target)
npm i -D tsx          # the release gate runs on tsx
npm run release-gate  # try it
```

`/govkit-init` creates: `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, `scripts/release-gate.ts`, `release-gate.config.json`, and `.gitignore` entries. Then edit `release-gate.config.json` so its `checks` match your real CI jobs.

## Usage — existing project

```bash
# in Claude Code, from the project root:
/govkit-init
```

It is **non-destructive**:
- Missing files are **created**.
- An existing `CLAUDE.md` gets a govkit guardrails block **appended** (between `<!-- govkit:start -->`/`<!-- govkit:end -->` markers) — your content is untouched.
- An existing `package.json` gets the `release-gate` scripts **merged** in (existing keys preserved).
- `.gitignore` gets any missing lines appended.

It prints a created/appended/merged/skipped summary, and **re-running is safe** (idempotent — it detects the markers/keys and skips). Review the summary, then `npm i -D tsx` and edit `release-gate.config.json`.

## What it scaffolds (minimal tier)

| File | Purpose |
|---|---|
| `CLAUDE.md` | Branch strategy (`feature → dev → main`, per-merge approval), tests-with-features policy, the **Local Release Gate — CI-fallback** rule, pointer to PROJECT-HUB |
| `docs/PROJECT-HUB.md` | Status · Key Decisions Log (DEC-###) · Session Handoff |
| `docs/PRIORITY-ROADMAP.md` | Priority tiers · revision history |
| `scripts/release-gate.ts` + `release-gate.config.json` | The local CI-fallback gate (config-driven) |
| `.gitignore` | `node_modules/`, `test-results/` |

Plus the global skills `/govkit-init` and `/sdlc` (from the plugin, not copied per repo).

## The Local Release Gate (why this exists)

CI runs on metered GitHub Actions (Free: 2,000 min/month, resets on the 1st). When minutes run out — or Actions has an outage — the "CI passing" merge gate can't run. The release gate reproduces your CI checks **locally**, prints a PASS/FAIL scorecard, and (with `--pr`) posts the evidence to the PR, so you can keep shipping at the same quality bar. It's the substitute for CI when CI can't run — never a way around it. Deploys (host integration on `main`, CLI-based DB/function deploys) are independent of Actions, so releases still complete.

## Language scope

**Node/TypeScript-first**, but not Node-only:
- The guardrail structure (`CLAUDE.md`, `PROJECT-HUB`, branch flow, `/sdlc`) is language-agnostic.
- The release gate's `checks` are **arbitrary shell commands** — put `cargo test`, `pytest`, `go build`, etc. in `release-gate.config.json`. The only Node tie is that the gate script runs via `tsx`, so a non-Node project just needs Node available to run it.
- First-class non-Node scaffolding (e.g. a `make`/`just` target instead of npm scripts) is a future enhancement.

## Roadmap

- **Minimal tier** (this release): branch flow + release gate + PROJECT-HUB/ROADMAP + generic `/sdlc`.
- **Full tier** (planned): the heavier doc-governance layer — frontmatter convention, `docs-audit` / `docs-sync-check` / `docs-stamp`, `source-doc-map` + `/sdlc-docs`, CI workflow templates, pre-commit hooks. Opt-in via an init tier.

## License

CC0-1.0 (public domain). Copy, adapt, reuse freely.
