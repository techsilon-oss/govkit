# govkit — Plugin + `/govkit-init` + Minimal Tier (Sub-project 2a) — Design

**Goal:** A distributable Claude Code plugin (`govkit`) that lets you stand up a new (or existing) project with the core build/deploy guardrails in one command — `/govkit-init` — decoupled from any specific project. Sub-project **2a** delivers the plugin skeleton, the `/govkit-init` scaffolder, a self-contained generic `/sdlc`, and the **minimal-tier** templates (branch discipline + release gate + PROJECT-HUB/ROADMAP + a generic CLAUDE.md).

**Origin:** Extracted from the governance system proven in a real project (branch flow, doc-as-source-of-truth, the Local Release Gate CI-fallback). Phase 1 already shipped the standalone release gate (`techsilon-oss/release-gate-kit`); this vendors it in and wraps the rest of the spine.

## Scope

**In scope (2a):**
- The `govkit` plugin repo (`techsilon-oss/govkit`, its own standalone git repo).
- `/govkit-init` skill — preflight + ~4 questions + non-destructive scaffold + summary.
- A self-contained generic `/sdlc` skill (plugin-level, global once installed).
- Minimal-tier templates: `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, `scripts/release-gate.ts` (+ config + npm scripts), `.gitignore` entries.

**Out of scope (later sub-projects):**
- **2b (full tier):** LAUNCH-READINESS, TESTING-STATUS, the frontmatter/`docs-audit`/`docs-sync-check`/`docs-stamp`/`source-doc-map`/`sdlc-docs`/`generate-docs` machinery, husky pre-commit, CI workflow templates.
- **2c:** marketplace versioning/update polish.

## Prerequisites (a new machine needs these; nothing else)

- **Claude Code** (to run the plugin).
- **git**.
- **GitHub CLI (`gh`)** installed and authenticated (`gh auth login`) — used by `/sdlc` and the release gate's `--pr`.
- **Node + npm** — the minimal tier assumes a Node project; the release gate runs via `tsx`.
- `tsx` is added **per-project** as a devDependency by the scaffold — NOT a machine-global requirement.

**Explicit non-dependencies (guaranteed self-contained):** no dependency on the `superpowers` plugin or any other plugin (md2pdf, generate-docs, mobile-sdlc); no MCP servers (uses the `gh` CLI, not the GitHub MCP); no Python; no husky/global hooks; no user `settings.json`/auto-memory. `superpowers` is noted as an *optional companion* (for deeper brainstorm/TDD skills) but govkit works fully without it.

## How it's installed & enabled (per machine)

govkit is a **Claude Code plugin**, so it is used **from within Claude Code**, after a **one-time per-machine install**:

```
claude plugin marketplace add techsilon-oss/govkit
claude plugin install govkit
```

Once installed, the skills (`/sdlc`, `/govkit-init`) are available in every Claude Code session on that machine; nothing else is enabled globally. You then run `/govkit-init` inside whatever project you're in. If the `govkit` repo is **private**, installing it on a new machine requires git/`gh` access to that repo.

## Language scope

2a is **Node/TypeScript-first**, but not Node-only:

- The **guardrail structure is language-agnostic** — `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, the `dev`→`main` flow, and `/sdlc` are git/GitHub/markdown and work for any project.
- The **release gate's checks are arbitrary shell commands** — the config can hold `cargo test`, `pytest`, `go build`, `npm run lint`, etc. The only Node tie is that the gate *script* (`release-gate.ts`) runs via `tsx`, so a non-Node project just needs Node available to run the gate.
- The **scaffold wiring** (npm scripts in `package.json`) assumes Node/npm. First-class non-Node scaffolding (e.g. a `justfile`/`make` target instead of npm scripts, or a compiled gate binary) is a **future enhancement**, not 2a.

## Architecture

### Plugin repo layout (`techsilon-oss/govkit`)

```
govkit/
├── .claude-plugin/
│   ├── plugin.json          # name: govkit, version, description, author, keywords
│   └── marketplace.json     # enables: claude plugin marketplace add techsilon-oss/govkit
├── skills/
│   ├── govkit-init/
│   │   ├── SKILL.md         # the init instructions (preflight, questions, scaffold, summary)
│   │   └── templates/       # bundled scaffold files (placeholders use {{TOKEN}})
│   │       ├── CLAUDE.md
│   │       ├── docs/PROJECT-HUB.md
│   │       ├── docs/PRIORITY-ROADMAP.md
│   │       ├── scripts/release-gate.ts        # vendored from release-gate-kit, verbatim
│   │       ├── release-gate.config.json
│   │       └── package-scripts.json           # { "release-gate": "...", "release-gate:full": "..." }
│   └── sdlc/
│       └── SKILL.md         # self-contained generic /sdlc
├── docs/superpowers/{specs,plans}/            # this design + its plan
└── README.md               # what it is, prerequisites, install/enable, exact step-by-step for NEW and EXISTING projects
```

**Skills vs scaffolded files (key distinction):**
- **Plugin skills** (`/sdlc`, `/govkit-init`) install once and are available in *every* project. They are NOT copied per-repo.
- **Scaffolded files** (`CLAUDE.md`, `PROJECT-HUB.md`, `release-gate.ts`, …) are stamped into each target repo by `/govkit-init`.
- The generic `/sdlc` assumes the govkit-scaffolded structure (`docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, the release-gate scripts, a `dev`→`main` flow).

### `/govkit-init` behavior

1. **Preflight** — verify `git` (in a repo; offer `git init`), `gh` (installed + `gh auth status` ok), `node`/`npm`. Report anything missing/unauthed and stop before scaffolding if a hard prerequisite is absent.
2. **Questions (~4)** — project name (`{{PROJECT_NAME}}`); default branch (`main`); package manager (`npm`); deploy target (`vercel` | `netlify` | `none`, only affects CLAUDE.md guardrail wording). Sensible defaults; accept-all is one keystroke.
3. **Scaffold (non-destructive)** — for each template:
   - File **absent** → create it, substituting `{{TOKENS}}`.
   - `CLAUDE.md` **present** → append a clearly-delimited "govkit guardrails" section (idempotent: skip if the section marker already exists).
   - `package.json` **present** → merge the `release-gate`/`release-gate:full` scripts (skip if already there); if absent, the README explains adding them (init does not fabricate a package.json).
   - `.gitignore` → ensure `test-results/` and `node_modules/` lines (append if missing).
   - Add `tsx` to devDependencies guidance (instruct `npm i -D tsx`; init does not run install).
4. **Summary** — print a created / appended / skipped table + the next steps (`npm i -D tsx`, try `npm run release-gate`).
5. **Idempotent** — re-running detects existing markers/scripts and skips, reporting "already present".

### Minimal-tier scaffold contents

- **`CLAUDE.md`** — branch strategy (`dev`→`main`, per-merge approval, never push to `main` directly), tests-with-features policy, the **Local Release Gate — CI-fallback** section (verbatim portable version from Phase 1, with deploy-target wording), and a pointer to `docs/PROJECT-HUB.md`.
- **`docs/PROJECT-HUB.md`** — skeleton: Current Status, Key Decisions Log (DEC-### convention), Session Handoff. With doc-frontmatter-free minimal form (frontmatter convention is full-tier/2b).
- **`docs/PRIORITY-ROADMAP.md`** — skeleton: priority tiers + revision history table.
- **`scripts/release-gate.ts`** + **`release-gate.config.json`** + npm scripts — vendored from `release-gate-kit` verbatim (single source of truth; 2a copies the current released version).
- **`.gitignore`** — ensure `test-results/`, `node_modules/`.

### Generic `/sdlc` (self-contained)

A clean re-authoring (NOT a copy of any project-specific `/sdlc`): status review (read PROJECT-HUB + ROADMAP, `gh issue list`, git log, release-gate health), the branch/PR flow with the **CI-fallback hook** (check `gh run list`; if Actions is down, run `npm run release-gate -- --pr <#>`), and a session-close checklist pointing at PROJECT-HUB + PRIORITY-ROADMAP. Uses only `git` + `gh` CLI. No references to any specific repo, brand, or stack beyond Node/GitHub.

## Distribution

Push `techsilon-oss/govkit` (private or public). Install:
```
claude plugin marketplace add techsilon-oss/govkit
claude plugin install govkit
```
Then in any project: `/govkit-init`. (Update/version polish = 2c.)

## Testing / verification (dogfood)

The plugin can't be "unit tested" in the usual sense; verification is behavioral:
1. **Empty dir:** `git init` a throwaway dir, run `/govkit-init`, confirm all minimal-tier files are created with substituted tokens, then `npm i -D tsx && npm run release-gate` → GREEN.
2. **Existing repo:** in a dir with a pre-existing `CLAUDE.md` + `package.json`, run `/govkit-init`, confirm it **appends** the guardrail section + **merges** the scripts (does not overwrite), and the summary reports it accurately.
3. **Re-run idempotency:** run `/govkit-init` again, confirm everything reports "already present" and nothing is duplicated.
4. **Preflight:** with `gh` logged out, confirm the preflight warns and stops.
5. The vendored `release-gate.ts` carries its own unit tests in `release-gate-kit`; 2a does not re-test it (it's copied verbatim).

## File structure (what 2a creates in the govkit repo)

| File | Responsibility |
|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest |
| `.claude-plugin/marketplace.json` | Marketplace entry |
| `skills/govkit-init/SKILL.md` | Init scaffolder instructions |
| `skills/govkit-init/templates/**` | Bundled minimal-tier templates (incl. vendored release-gate) |
| `skills/sdlc/SKILL.md` | Generic self-contained `/sdlc` |
| `README.md` | Prerequisites, install/enable, and **exact step-by-step usage for NEW and EXISTING projects** (install plugin → `/govkit-init` → what it creates vs appends → next steps) |
