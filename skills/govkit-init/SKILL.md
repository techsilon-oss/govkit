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
| `templates/package-scripts.json` | `./package.json` | If `package.json` exists → **merge** its keys into `scripts` (skip keys already present). If absent → do NOT fabricate one; tell the user in the summary to add the scripts. |
| `templates/gitignore-snippet.txt` | `./.gitignore` | Ensure each line is present (append missing lines); create the file if absent. |
| `templates/gitattributes-snippet.txt` | `./.gitattributes` | Ensure each line is present; create if absent. **Required by the hook** — see below. |
| `templates/githooks/pre-push` | `./.githooks/pre-push` | Create if absent. **Commit mode `100755`** (`git update-index --chmod=+x`). Substitute the release branch. |
| `templates/githooks/install-hooks.sh` | `./.githooks/install-hooks.sh` | Create if absent; mode `100755`. |
| `templates/scripts/sdlc-docs.mjs` | `./scripts/sdlc-docs.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/docs-sync-check.mjs` | `./scripts/docs-sync-check.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/govkit-doctor.mjs` | `./scripts/govkit-doctor.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/source-doc-map.example.json` | `./scripts/source-doc-map.json` | Create if absent. **Tell the user it is an example that gates nothing until edited.** |
| `templates/.github/workflows/sdlc-docs.yml` | `./.github/workflows/sdlc-docs.yml` | Create if absent; else skip. |
| `templates/govkit.json` | `./govkit.json` | Create if absent. Record `govkitVersion`, the branch names from Step 2, and each guardrail's enabled/skipped state. |

Notes:
- Create parent directories (`docs/`, `scripts/`, `.githooks/`, `.github/workflows/`) as needed.
- The release gate runs via `tsx`; remind the user to `npm i -D tsx` (a per-project devDependency, not installed by this skill). The `.mjs` runners are **dependency-free** — Node built-ins and `git` only.
- **`.gitattributes` is not optional when the hook is installed.** A `pre-push` checked out with CRLF makes the kernel look for an interpreter named `sh\r`; exec fails and git treats a hook it could not run as no hook at all. The protection vanishes silently.
- **Activate the hook**, or the file is inert: the `prepare` script (`git config core.hooksPath .githooks || true`) does it on install. Say so in the summary — a committed hook that was never activated is the most common false sense of security here.

## Step 3b — Guardrails are ON by default; `--skip` records an opt-out

Install **every** guardrail unless explicitly skipped. `/govkit-init --skip doc-sync --skip pre-push-hook` omits those, and writes them into `govkit.json` as `enabled: false` with a `skippedReason`.

**Always ask for a reason when skipping**, and record it. This is the whole mechanism: an unexplained gap is indistinguishable from an oversight and will be treated as one. A recorded one is a decision `/govkit-doctor` will report as intentional forever.

Skippable names: `release-gate`, `ci`, `pre-push-hook`, `doc-sync`, `docs-sync-check`. `trackers` is not skippable — without it there is no project context for anything else to hang on.

## Step 4 — Summary

Print a table: each target file → **created** / **appended** / **merged** / **skipped (reason)**. Then list next steps:

1. `npm i -D tsx`
2. Edit `release-gate.config.json` so its `checks` match this project's real CI jobs.
3. **Edit `scripts/source-doc-map.json`.** Shipped as an example, it maps nothing real and therefore **gates nothing.** An unedited registry is a guardrail in appearance only.
4. Try them: `npm run release-gate`, `npm run docs:sync-check`, `node scripts/govkit-doctor.mjs`
5. Fill in `docs/PROJECT-HUB.md` (status + first decisions) and `docs/PRIORITY-ROADMAP.md`.
6. If `gh` was unauthed, run `gh auth login` so `/sdlc` and `--pr` work.
7. **Verify the hook actually blocks** — presence is not proof:
   ```bash
   git config core.hooksPath                          # expect: .githooks
   NEW=$(git commit-tree "$(git rev-parse main^{tree})" -p main -m probe)
   git push --dry-run origin "$NEW:refs/heads/main"   # expect: blocked
   ```
   Do **not** verify with `git push --dry-run dev:main` — if the branches have diverged git rejects
   the ref as non-fast-forward *before* the hook runs, and a clean result reads as a pass when the
   hook never ran at all.
8. Set the merge strategy once, so it is never re-decided per PR:
   ```bash
   # long-lived working->release pair: MERGE COMMITS, and never auto-delete (the head branch is dev)
   gh api -X PATCH repos/<org>/<repo> -F allow_squash_merge=false \
     -f allow_merge_commit=true -F allow_rebase_merge=false -F delete_branch_on_merge=false
   ```
   Squashing a long-lived pair writes a new SHA with no ancestry link, so the release branch stops
   containing the working branch and every later PR replays already-merged commits.

## Step 5 — Idempotency (re-runs)

Re-running must not duplicate anything: the `CLAUDE.md` govkit block is skipped if its marker exists; existing files are skipped; `package.json` script keys already present are skipped; `.gitignore` lines already present are not re-added. Report these as "already present".

## Step 6 — Report conformance, don't assume it

Finish by running `node scripts/govkit-doctor.mjs` and showing the output. It compares `govkit.json` against what is on disk, so the summary reflects the repo rather than this skill's intentions.

## What this skill does NOT do

No `npm install`, no git commits, no deploys. No LAUNCH-READINESS / TESTING-STATUS / doc-frontmatter stamping / `docs-audit` / husky.

It does **not** scaffold `.github/workflows/ci.yml` — a CI workflow is stack-specific and a wrong one is worse than none. Tell the user to add one running the same checks as `release-gate.config.json`, and to **name the job to match the config's `ciJob` value** so the gate and CI describe the same thing.

It depends on nothing beyond `git` / `gh` / `node` / `npm` and its own bundled templates.

## Why the guardrail set looks like this

Earlier versions scaffolded the trackers and the release gate, and left doc-sync and the pre-push hook to a "full tier" that did not exist yet. Projects adopting govkit as their **only** source of guardrails were therefore **less protected than projects that ignored it** and kept their own copies — the opposite of the intent, and invisible because nothing errors when a guardrail is merely absent.

That is why guardrails are now ON by default, why skipping demands a recorded reason, and why `/govkit-doctor` exists at all.
