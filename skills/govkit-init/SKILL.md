---
name: govkit-init
description: Scaffold the core project guardrails (branch flow, Local Release Gate CI-fallback, PROJECT-HUB + PRIORITY-ROADMAP, generic CLAUDE.md) into the current project. Use when starting a new project, or to add govkit guardrails to an existing one. Non-destructive — creates missing files, appends/merges into existing ones, never overwrites. `/govkit-init --upgrade` brings the files govkit owns up to the installed version, replacing each only on an explicit yes.
argument-hint: "[--skip <guardrail>]... | --upgrade"
---

# govkit-init — scaffold project guardrails

Scaffolds the **minimal tier** of guardrails into the current working directory. Bundled templates live in this skill's `templates/` directory — read them from there and write the resolved files into the user's repo (the current working directory).

**Principles:** non-destructive (never overwrite), idempotent (safe to re-run), report everything you did. Use only `git`, `gh`, `node`/`npm`. Do not run `npm install`, do not commit, and do not deploy — leave those to the user.

Work through these steps in order. **With `--upgrade`, skip to [Upgrade](#upgrade--govkit-init---upgrade) instead.**

## Step 1 — Preflight

Run and report PASS / MISSING for each:

- `git rev-parse --is-inside-work-tree` — must be inside a git repo. If not, ask the user whether to run `git init`; if they decline, **stop**.
- `gh --version` then `gh auth status` — the GitHub CLI must be installed and authenticated (`/govkit-session` and the release gate's `--pr` need it). If missing/unauthed, **warn** (tell them to install `gh` / run `gh auth login`) but you may continue scaffolding — note it in the summary.
- `node --version` and `npm --version` — needed to run the release gate (via `tsx`). If missing, **warn** and continue.

Print a short preflight table before proceeding.

## Step 2 — Questions (ask once, with defaults)

Ask the user these four, showing defaults so "accept all" is one reply:

1. **Project name** — default: the current repo's folder name. → `{{PROJECT_NAME}}`
2. **Default working branch** — default: `dev`. → `{{DEFAULT_BRANCH}}`
3. **Package manager** — default: `npm`. (Only `npm` is wired in the minimal tier; note others as future.)
4. **Deploy target** — `vercel` | `netlify` | `none`, default `vercel`. → `{{DEPLOY_TARGET}}` (substitute the platform name; for `none`, substitute `your host`).

## Step 3 — Scaffold (non-destructive)

For each template in this skill's `templates/` directory, substitute the `{{TOKENS}}` from Step 2, then write to the corresponding path in the user's repo. `{{SCAFFOLD_DATE}}` is today's date (`YYYY-MM-DD`): the trackers' `last checked` line, so `docs-sync-check` passes on day one. Apply these rules:

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
| `templates/scripts/govkit-docsync.mjs` | `./scripts/govkit-docsync.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/docs-sync-check.mjs` | `./scripts/docs-sync-check.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/govkit-doctor.mjs` | `./scripts/govkit-doctor.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/release-version.mjs` | `./scripts/release-version.mjs` | Create if absent; else skip. Verbatim. |
| `templates/scripts/source-doc-map.example.json` | `./scripts/source-doc-map.json` | Create if absent. **Tell the user it is an example that gates nothing until edited.** |
| `templates/.github/workflows/govkit-docsync.yml` | `./.github/workflows/govkit-docsync.yml` | Create if absent; else skip. |
| `templates/scripts/supabase.mjs` | `./scripts/supabase.mjs` | **Only if the project uses Supabase** (a `supabase/` directory, or a `SUPABASE_` variable in `.env.example`). Create if absent; else skip. Verbatim. |
| `templates/supabase/projects.example.json` | `./supabase/projects.json` | Same condition. Create if absent. **Tell the user it is a placeholder and every Supabase command fails until it is filled in.** |
| `templates/govkit.json` | `./govkit.json` | Create if absent. Record `govkitVersion`, the branch names from Step 2, `project` (name and deploy target from Step 2), and each guardrail's enabled/skipped state. Substitute `{{GOVKIT_VERSION}}` with `version` from this plugin's `.claude-plugin/plugin.json` (two levels above this skill's base directory), never a remembered value: a literal in the template recorded 0.4.0 for every 0.5.x init. |

Notes:
- Create parent directories (`docs/`, `scripts/`, `.githooks/`, `.github/workflows/`) as needed.
- The release gate runs via `tsx`; remind the user to `npm i -D tsx` (a per-project devDependency, not installed by this skill). The `.mjs` runners are **dependency-free** — Node built-ins and `git` only.
- **`.gitattributes` is not optional when the hook is installed.** A `pre-push` checked out with CRLF makes the kernel look for an interpreter named `sh\r`; exec fails and git treats a hook it could not run as no hook at all. The protection vanishes silently.
- **Activate the hook**, or the file is inert: the `prepare` script (`git config core.hooksPath .githooks || true`) does it on install. Say so in the summary — a committed hook that was never activated is the most common false sense of security here.

## Step 3b — Guardrails are ON by default; `--skip` records an opt-out

Install **every** guardrail unless explicitly skipped. `/govkit-init --skip doc-sync --skip pre-push-hook` omits those, and writes them into `govkit.json` as `enabled: false` with a `skippedReason`.

**Always ask for a reason when skipping**, and record it. This is the whole mechanism: an unexplained gap is indistinguishable from an oversight and will be treated as one. A recorded one is a decision `/govkit-doctor` will report as intentional forever.

Skippable names: `release-gate`, `ci`, `pre-push-hook`, `doc-sync`, `docs-sync-check`, `versioning`, `supabase-account`. `trackers` is not skippable — without it there is no project context for anything else to hang on.

**`supabase-account` is the one guardrail that is conditional rather than default-on.** It is meaningless in a project with no Supabase, and scaffolding it there is noise that teaches people to ignore the manifest. Install it when the repo shows a `supabase/` directory or a `SUPABASE_` variable; otherwise record it as `enabled: false` with the reason `project does not use Supabase`.

## Step 4 — Summary

Print a table: each target file → **created** / **appended** / **merged** / **skipped (reason)**. Then list next steps:

1. `npm i -D tsx`
2. Edit `release-gate.config.json` so its `checks` match this project's real CI jobs.
3. **If Supabase was scaffolded, edit `supabase/projects.json`.** It ships with `REPLACE_ME` placeholders and every `npm run supabase` command refuses to run until they are real. Then add a per-repo token: sign in as the account that owns the projects, generate one at `https://supabase.com/dashboard/account/tokens`, and put `SUPABASE_ACCESS_TOKEN=sbp_...` in the gitignored `.env`. Verify with `npm run supabase:whoami`.
4. **Edit `scripts/source-doc-map.json`.** Shipped as an example, it maps nothing real and therefore **gates nothing.** An unedited registry is a guardrail in appearance only.
5. Try them: `npm run release-gate`, `npm run docs:sync-check`, `node scripts/govkit-doctor.mjs`
6. **Baseline the version.** If the release branch has no `v*` tag yet, run `npm run release:tag` once to tag what is in production now; from then on `npm run release:status` reports drift. If the UI shows a build identifier, make it the commit SHA, not a commit count (see the `versioning` guardrail in `govkit.json`).
7. Fill in `docs/PROJECT-HUB.md` (status + first decisions) and `docs/PRIORITY-ROADMAP.md`.
8. If `gh` was unauthed, run `gh auth login` so `/govkit-session` and `--pr` work.
9. **Verify the hook actually blocks** — presence is not proof:
   ```bash
   git config core.hooksPath                          # expect: .githooks
   NEW=$(git commit-tree "$(git rev-parse main^{tree})" -p main -m probe)
   git push --dry-run origin "$NEW:refs/heads/main"   # expect: blocked
   ```
   Do **not** verify with `git push --dry-run dev:main` — if the branches have diverged git rejects
   the ref as non-fast-forward *before* the hook runs, and a clean result reads as a pass when the
   hook never ran at all.
10. Set the merge strategy once, so it is never re-decided per PR:
   ```bash
   # long-lived working->release pair: MERGE COMMITS, and never auto-delete (the head branch is dev)
   gh api -X PATCH repos/<org>/<repo> -F allow_squash_merge=false \
     -f allow_merge_commit=true -F allow_rebase_merge=false -F delete_branch_on_merge=false
   ```
   Squashing a long-lived pair writes a new SHA with no ancestry link, so the release branch stops
   containing the working branch and every later PR replays already-merged commits.

## Step 5 — Idempotency (re-runs)

Re-running must not duplicate anything: the `CLAUDE.md` govkit block is skipped if its marker exists; existing files are skipped; `package.json` script keys already present are skipped; `.gitignore` lines already present are not re-added. Report these as "already present".

## Step 6 — Record what was written, then report conformance

Run `node "<this skill's base directory>/upgrade.mjs" record`. It writes the `files` map into `govkit.json`: for each file govkit owns, the release that wrote it and its hash. That is what lets a later `--upgrade` tell a file you edited from one that is merely old. It touches only `govkit.json`.

Then run `node scripts/govkit-doctor.mjs` and show the output. It compares `govkit.json` against what is on disk, so the summary reflects the repo rather than this skill's intentions.

## Upgrade — `/govkit-init --upgrade`

A plugin update reaches the skills and the session hook, never the files init copied into the repo, and a re-run of init skips files that exist. This is how a fix to an owned file reaches a repo that already ran init.

Owned files: `scripts/{docs-sync-check,govkit-docsync,govkit-doctor,release-version,supabase}.mjs`, `.githooks/{pre-push,install-hooks.sh}`, `.github/workflows/govkit-docsync.yml`, plus `scripts/release-gate.ts` (by vendored version) and the `govkit:start/end` block in `CLAUDE.md` (diff only). **Never touch anything else** — the trackers, `release-gate.config.json`, `source-doc-map.json`, `supabase/projects.json` are the project's own.

Every command below is `node "<this skill's base directory>/upgrade.mjs" …`, run from the repo root. It runs from the plugin, not from the repo, so it is always the installed version.

1. **`check`** and show the report. Each owned file is `current`, `outdated — matches <releases>` (identical to an older release), or `edited` (matches no release — a local change, or a formatter's rewrite). The match comes from hashing the file against every past release, so it works on repos initialised before the `files` map existed.
2. **Clean tree first.** `apply` refuses when the working tree has uncommitted changes, and says why: every upgrade should be one reviewable, revertable change. Mixed with other edits, `git diff` no longer shows what the upgrade did, and reverting it would take the user's work with it. If it is dirty, stop here and ask them to commit or stash. `check`, `diff` and `save-diff` still run.
3. **Outdated files** — one at a time: show `diff <path>`, ask, and on yes (the default) collect it.
   - **`rename pending`** (0.8.0 renamed `scripts/sdlc-docs.mjs` → `scripts/govkit-docsync.mjs` and the workflow file): the same, but say the old file will be deleted. For the runner, also show `diff package.json`. **package.json is the one file govkit edits that it does not own**: say so, and that only the listed scripts change. Default yes.
   - **`rename-edited`**: the old file matches no release. It is **never moved or deleted**. Run `save-diff <path>`, print the path, and tell the user to carry their change over and delete the old file themselves.
   - **`old … still present`**: the new file is in, the old one is left. Point it out; don't delete it.
   - If `check` says package.json must be edited **by hand**, don't apply the runner rename: list the scripts to change and stop there.
   - **`bootstrapDocs`**: when `check` offers it (the old default), show `diff govkit.json#bootstrapDocs`, default yes, and collect `govkit.json#bootstrapDocs`. A list the user changed is left alone; just say so.
4. **Edited files and the CLAUDE.md block** — show `diff <path>` with a warning that replacing it discards the local change. **Default no.** On no, run `save-diff <path>` and print the path it returns (`.git/govkit/upgrade-<name>.diff`): the user can take only the lines they want, with `git apply --include` or by hand. It lives inside `.git`, so it is never committed.
5. **`apply <path>…`** with every yes from steps 3–4. It writes only those, keeps pre-push's own `PROTECTED_BRANCHES` line and the exec bit, and updates `govkit.json` (`files`, and `govkitVersion` once every owned file agrees on one release). If the report says `govkit.json` was reformatted, pass that on: its diff then shows more than the upgrade's own lines.
6. **`record`** if nothing was applied but `check` said `govkitVersion` is wrong (0.5.0 wrote 0.4.0) — it corrects that without touching any file.
7. **Prettier.** If `check --json` reports `"prettier": true`, offer to add the owned paths to `.prettierignore`. Otherwise the formatter rewrites them, every one reads as `edited`, and future upgrades default to no.
8. **After a release that renamed something, run `/govkit-doctor`.** It lists remaining references to old names (CI steps running `npm run sdlc-docs:*`, `/sdlc` in docs) with file and line. Then point at [docs/UPGRADING.md](../../docs/UPGRADING.md) for anything the upgrade can't do (the trackers' `last checked` line).
9. Tell the user to review `git diff` and commit it as one change (`chore(govkit): upgrade to <version>`). Do not commit for them. On Windows, if an applied hook was untracked, remind them to `git update-index --chmod=+x .githooks/<name>` after `git add`.

## What this skill does NOT do

No `npm install`, no git commits, no deploys. No LAUNCH-READINESS / TESTING-STATUS / doc-frontmatter stamping / `docs-audit` / husky.

It does **not** scaffold `.github/workflows/ci.yml` — a CI workflow is stack-specific and a wrong one is worse than none. Tell the user to add one running the same checks as `release-gate.config.json`, and to **name the job to match the config's `ciJob` value** so the gate and CI describe the same thing.

It depends on nothing beyond `git` / `gh` / `node` / `npm` and its own bundled templates.

## Why the guardrail set looks like this

Earlier versions scaffolded the trackers and the release gate, and left doc-sync and the pre-push hook to a "full tier" that did not exist yet. Projects adopting govkit as their **only** source of guardrails were therefore **less protected than projects that ignored it** and kept their own copies — the opposite of the intent, and invisible because nothing errors when a guardrail is merely absent.

That is why guardrails are now ON by default, why skipping demands a recorded reason, and why `/govkit-doctor` exists at all.
