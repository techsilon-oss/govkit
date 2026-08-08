# govkit

A **Claude Code plugin** that scaffolds the core build/deploy guardrails into any project in one command — `/govkit-init`. It gives you a consistent governance spine (branch flow, a CI-fallback **Local Release Gate**, `PROJECT-HUB`/`PRIORITY-ROADMAP`, a generic `/sdlc`) without copy-pasting between repos.

Decoupled and self-contained: it depends on nothing beyond `git`, the `gh` CLI, and Node/npm.

---

## Where govkit sits — read this before changing anything

Three repos, one methodology, **strictly one-way dependencies**. govkit is the middle layer.

```
  release-gate-kit          ONE capability, standalone
  techsilon-oss (public)    The local CI-fallback gate, and nothing else.
         ▲                  Deliberately its own repo so it can be dropped into ANY
         │ vendored by      project, in any stack, with zero governance buy-in.
         │
  govkit                    THE TRANSFERABLE SPINE  ← you are here
  techsilon-oss (public)    Skills (/govkit-init, /sdlc, /govkit-doctor), guardrail
         ▲                  templates, tracker convention. Product-agnostic: nothing
         │ consumed by      here names a company, a client, or a stack.
         │
  dev-standards             THE HOUSE LAYER
  techsilon-apps (private)  TechSilon's delta on top: stack runbooks (Supabase, Vercel,
         ▲                  Resend, Cloudflare), the user CLAUDE.md profile, the
         │ applied to       guardrails cheatsheet. CONSUMES govkit, never competes.
         │
  consumer repos            The actual products.
  (omnisilon, pulsilon,     Install the govkit plugin per machine, scaffold guardrails
   techsilon-website, RAV)  per repo, follow dev-standards for house specifics.
```

**Nothing upstream ever references a consumer.** Context flows down only.

### Where do I file a change?

| The change is… | Goes in |
|---|---|
| A bug or feature in the release gate itself | **release-gate-kit** — then re-vendor into govkit |
| A guardrail, skill, or scaffolding rule that any project would want | **govkit** |
| TechSilon-specific: a stack runbook, house convention, the user profile | **dev-standards** |
| True only of one product | **that project's own repo** |

Ask "would a stranger's project want this?" — if yes it belongs here or in release-gate-kit, not in the house layer.

### Why release-gate-kit is separate rather than folded in

So the gate can be used **on its own**. It solves one problem — reproducing CI checks locally when Actions can't run — and that problem exists for people who want nothing to do with a governance spine. Folding it into govkit would force adopting the whole methodology to get one script.

govkit **vendors** a copy so `/govkit-init` works offline and in one step. release-gate-kit stays canonical: fix bugs there, then re-vendor. `/govkit-doctor` reports the vendored version.

---

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

## What it scaffolds

**All guardrails are installed by default.** Excluding one takes `--skip <name>` and a recorded reason, so a gap is always a decision you can point at — never an oversight.

| Guardrail | Files | Purpose |
|---|---|---|
| `trackers` | `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md` | Branch strategy, per-merge approval, decisions log, session handoff |
| `release-gate` | `scripts/release-gate.ts`, `release-gate.config.json` | Local CI-fallback gate. **Vendored from [release-gate-kit](https://github.com/techsilon-oss/release-gate-kit)** — fix bugs upstream, not here |
| `pre-push-hook` | `.githooks/pre-push`, `.gitattributes` | Blocks direct pushes to the release branch |
| `doc-sync` | `scripts/sdlc-docs.mjs`, `scripts/source-doc-map.json`, `.github/workflows/sdlc-docs.yml` | Per-PR: code changed without its mapped doc. Warn on PR to working branch, **gate** on PR to release |
| `docs-sync-check` | `scripts/docs-sync-check.mjs` | Per-session: bootstrap-doc freshness + `git`/`gh` ground truth |
| — | `govkit.json` | The manifest: what is installed, what was skipped and why |

Plus the skills `/govkit-init`, `/sdlc` and `/govkit-doctor` (from the plugin, not copied per repo).

The `.mjs` runners are **dependency-free** — Node built-ins and `git` only, no install step.

## Two checks, two different questions

They are not redundant, and neither substitutes for the other:

- **`sdlc-docs`** asks *"did code change without its doc?"* — a **diff** question, answered per PR.
- **`docs-sync-check`** asks *"do the trackers still match the repo?"* — which involves **no diff at all**. A tracker rots while the code it describes sits untouched: "no `main` branch" after `main` exists, "nothing deployed" after launch, "zero issues" after a dozen are filed. Each was true when written. Nothing re-checks prose, so nothing catches it.

That is why `/sdlc status` runs `docs-sync-check` **first**, and stops if a bootstrap doc is stale. A session that starts from a stale hub produces work premised on a false picture.

## `/govkit-doctor` — is this project actually conformant?

Every other guardrail checks the code. This one checks the guardrails.

```bash
node scripts/govkit-doctor.mjs          # report
node scripts/govkit-doctor.mjs --ci     # exit 1 if a declared guardrail is missing
node scripts/govkit-doctor.mjs config   # show the current configuration
```

Every guardrail is **OK**, **SKIPPED** (declared off, with a reason — a decision), or **MISSING** (declared on, absent — a finding). Never silently absent.

It exists because of a real failure: a project adopted govkit, govkit did not yet ship the hooks or the doc-sync runner, and the project ran for weeks **less protected than repos that had ignored the standard** and kept their own copies. Nothing errored, because adopting a standard feels like a completion. `/govkit-doctor` is the command that would have said so on day one.

## The Local Release Gate (why this exists)

CI runs on metered GitHub Actions (Free: 2,000 min/month, resets on the 1st). When minutes run out — or Actions has an outage — the "CI passing" merge gate can't run. The release gate reproduces your CI checks **locally**, prints a PASS/FAIL scorecard, and (with `--pr`) posts the evidence to the PR, so you can keep shipping at the same quality bar. It's the substitute for CI when CI can't run — never a way around it. Deploys (host integration on `main`, CLI-based DB/function deploys) are independent of Actions, so releases still complete.

## Language scope

**Node/TypeScript-first**, but not Node-only:
- The guardrail structure (`CLAUDE.md`, `PROJECT-HUB`, branch flow, `/sdlc`) is language-agnostic.
- The release gate's `checks` are **arbitrary shell commands** — put `cargo test`, `pytest`, `go build`, etc. in `release-gate.config.json`. The only Node tie is that the gate script runs via `tsx`, so a non-Node project just needs Node available to run it.
- First-class non-Node scaffolding (e.g. a `make`/`just` target instead of npm scripts) is a future enhancement.

## Roadmap

- **0.1.0** — branch flow + release gate + PROJECT-HUB/ROADMAP + generic `/sdlc`.
- **0.2.0** (this release) — pre-push hook + `.gitattributes`, `sdlc-docs` watchdog, `docs-sync-check`, the `govkit.json` manifest, and `/govkit-doctor`. Guardrails on by default with recorded opt-out.
- **Planned** — doc frontmatter convention and stamping; a lessons log; first-class non-Node scaffolding (`make`/`just` instead of npm scripts).

### Note on 0.2.0

0.1.0 deferred the hooks and doc-sync to a "full tier" that did not exist. The effect was that projects adopting govkit as their **only** source of guardrails ended up less protected than projects that ignored it — the opposite of the intent.

That is why guardrails are now **on by default**, why skipping one requires a recorded reason, and why `/govkit-doctor` exists. **Upgrading from 0.1.0:** re-run `/govkit-init` in an existing project — it is non-destructive and installs only what is absent — then `node scripts/govkit-doctor.mjs` to confirm.

## License

CC0-1.0 (public domain). Copy, adapt, reuse freely.
