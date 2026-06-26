---
name: govkit-init
description: Scaffold the core project guardrails (branch flow, Local Release Gate CI-fallback, PROJECT-HUB + PRIORITY-ROADMAP, generic CLAUDE.md) into the current project. Use when starting a new project, or to add govkit guardrails to an existing one. Non-destructive — creates missing files, appends/merges into existing ones, never overwrites.
---

# govkit-init — scaffold project guardrails

Scaffolds the **minimal tier** of guardrails into the current working directory. Bundled templates live in this skill's `templates/` directory — read them from there and write the resolved files into the user's repo (the current working directory).

**Principles:** non-destructive (never overwrite), idempotent (safe to re-run), report everything you did. Use only `git`, `gh`, `node`/`npm`. Do not run `npm install`, do not commit, and do not deploy — leave those to the user.

Work through these steps in order.

## Step 1 — Preflight

Run and report PASS / MISSING for each:

- `git rev-parse --is-inside-work-tree` — must be inside a git repo. If not, ask the user whether to run `git init`; if they decline, **stop**.
- `gh --version` then `gh auth status` — the GitHub CLI must be installed and authenticated (`/sdlc` and the release gate's `--pr` need it). If missing/unauthed, **warn** (tell them to install `gh` / run `gh auth login`) but you may continue scaffolding — note it in the summary.
- `node --version` and `npm --version` — needed to run the release gate (via `tsx`). If missing, **warn** and continue.

Print a short preflight table before proceeding.

## Step 2 — Questions (ask once, with defaults)

Ask the user these four, showing defaults so "accept all" is one reply:

1. **Project name** — default: the current repo's folder name. → `{{PROJECT_NAME}}`
2. **Default working branch** — default: `dev`. → `{{DEFAULT_BRANCH}}`
3. **Package manager** — default: `npm`. (Only `npm` is wired in the minimal tier; note others as future.)
4. **Deploy target** — `vercel` | `netlify` | `none`, default `vercel`. → `{{DEPLOY_TARGET}}` (substitute the platform name; for `none`, substitute `your host`).

## Step 3 — Scaffold (non-destructive)

For each template in this skill's `templates/` directory, substitute the `{{TOKENS}}` from Step 2, then write to the corresponding path in the user's repo. Apply these rules:

| Template | Target | Rule |
|---|---|---|
| `templates/CLAUDE.md` | `./CLAUDE.md` | If absent → create. If present → **append** the block between `<!-- govkit:start -->` and `<!-- govkit:end -->`, unless a `<!-- govkit:start -->` marker already exists (then skip). |
| `templates/docs/PROJECT-HUB.md` | `./docs/PROJECT-HUB.md` | Create if absent; else skip. |
| `templates/docs/PRIORITY-ROADMAP.md` | `./docs/PRIORITY-ROADMAP.md` | Create if absent; else skip. |
| `templates/scripts/release-gate.ts` | `./scripts/release-gate.ts` | Create if absent; else skip. (Verbatim — no token substitution.) |
| `templates/release-gate.config.json` | `./release-gate.config.json` | Create if absent; else skip. |
| `templates/package-scripts.json` | `./package.json` | If `package.json` exists → **merge** its keys into `scripts` (skip keys already present). If absent → do NOT fabricate one; tell the user in the summary to add these two scripts. |
| `templates/gitignore-snippet.txt` | `./.gitignore` | Ensure each line is present (append missing lines); create the file if absent. |

Notes:
- Create parent directories (`docs/`, `scripts/`) as needed.
- The release gate runs via `tsx`; remind the user to `npm i -D tsx` (it is a per-project devDependency, not installed by this skill).

## Step 4 — Summary

Print a table: each target file → **created** / **appended** / **merged** / **skipped (reason)**. Then list next steps:

1. `npm i -D tsx`
2. Edit `release-gate.config.json` so its `checks` match this project's real CI jobs.
3. Try it: `npm run release-gate`
4. Fill in `docs/PROJECT-HUB.md` (status + first decisions) and `docs/PRIORITY-ROADMAP.md`.
5. If `gh` was unauthed, run `gh auth login` so `/sdlc` and `--pr` work.

## Step 5 — Idempotency (re-runs)

Re-running must not duplicate anything: the `CLAUDE.md` govkit block is skipped if its marker exists; existing files are skipped; `package.json` script keys already present are skipped; `.gitignore` lines already present are not re-added. Report these as "already present".

## What this skill does NOT do (minimal tier)

No `npm install`, no git commits, no deploys. No LAUNCH-READINESS / TESTING-STATUS / docs-frontmatter / `docs-audit` / `sdlc-docs` / husky / CI-workflow scaffolding — those are the **full tier** (a future govkit addition). It depends on nothing beyond `git` / `gh` / `node` / `npm` and its own bundled templates.
