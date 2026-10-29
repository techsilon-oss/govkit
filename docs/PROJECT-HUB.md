# govkit — Project Hub

last checked 2026-10-29

> Decisions, current state, and session-to-session context. `/govkit-session status` reads this file. Repo facts (branches, tags, CI, issue counts) are not copied here: `npm run docs:sync-check` and `npm run release:check -- --pr` print them from git and GitHub.

## Current Status

- **Stage:** live. Public on GitHub, installed from the marketplace (`claude plugin install govkit --marketplace techsilon-oss/govkit`).
- **Released:** the latest `v*` tag; `CHANGELOG.md` has the history.
- **Health:** `npm test`, and CI on every PR (`.github/workflows/ci.yml`). `main` is protected: a PR and green **Validate and test** are required.
- **Now:** 0.8.0, govkit's first breaking release: the skill rename (#12) with dated trackers (#26) and the pre-push message (#27), so users upgrade once. Steps for users: `docs/UPGRADING.md`.
- **Next, in order:** 0.9.0 (remove the 0.8.0 aliases) → #13 → #16 → #14. #15 and #25 are ideas.

## Key Decisions Log

### DEC-001: Provenance comments stay as they are
**2026-10-27 · Decided in qa-kit (DEC-014) · Active.** Provenance comments in govkit's templates and README stay as written, including names of the repos the files came from. Consumers that want different wording keep a local edit; `/govkit-init --upgrade` reports such a file as `edited` and defaults to keeping it.

### DEC-002: Trunk flow — feature branch → PR → main
**2026-10-29 · Active.** govkit has no `dev` branch. Every merge to `main` is a release, so each PR that ships is its own release PR (version bump as its last commit) and is tagged after the merge. `main` is protected with admins included; force pushes and deletion are blocked.

### DEC-003: govkit runs its guardrails in place
**2026-10-29 · Active.** Rather than a second copy of each script under `scripts/`, `package.json` runs them from `skills/govkit-init/templates/`, and `govkit.json` `paths` tells the doctor, `upgrade.mjs` and the doc-sync workflow where they are. The one real copy is `.github/workflows/govkit-docsync.yml`, because workflows must live there. CI and a test hold govkit to "doctor and upgrade check report clean".

### DEC-004: Versioning checked by `tools/check-release.mjs`, not `release-version.mjs`
**2026-10-29 · Active.** `release-version.mjs` reads `package.json` and bumps on a working branch; govkit's version lives in the plugin manifests, and it has no working branch. The `versioning` guardrail is skipped with that reason, and `check-release.mjs` checks govkit's rules in CI: the manifests agree; CHANGELOG, template history and govkit.json know the version; and (on PRs) main's release is tagged. Generalising `release-version.mjs` is an idea issue, for when a second plugin repo needs it.

### DEC-005: Every govkit skill name starts with `govkit-`
**2026-10-29 · Active (0.8.0, #12).** Projects have their own `/sdlc` skills, and two skills with one name give wrong advice that looks right. So `/sdlc` → `/govkit-session`, `/sdlc-docs` → `/govkit-docsync`; typing `/govkit` lists the whole kit. A rename ships with one version of aliases, moves the files that carried the old name (except the workflow's check name, which a branch protection rule may require), and `--upgrade` carries it: unedited files move, edited ones stay with their diff saved, and `package.json` changes only where a script runs the renamed file.

## Session Handoff

### Session 1 — 2026-10-29 — 0.5.0 tagged through 0.6.1 shipped, dogfooding started
- Tagged the untagged 0.5.0. Shipped 0.5.1 (#8, ground truth vs `origin/main`), 0.5.2 (#18, Supabase guard; `ls-remote` timeout and reason), 0.6.0 (#19, `/govkit-init --upgrade`, the first tests) and 0.6.1 (#11 PR 1: MIT, owner, CHANGELOG, CI, GitHub Releases, topics, branch protection).
- Found in passing: init's `govkitVersion` literal (fixed 0.5.1); the CI-only Linux file-mode bug in a test fixture (fixed 0.6.1).
- Shipped 0.7.0 (#24): govkit runs its own guardrails; `paths` confined to the repo, owned files must be regular files. `main` protected.
- 0.8.0 (#12 + #26 + #27) in review: rename with aliases, `--upgrade` renames, the package.json exception, old-name scan, `bootstrapDocs` offer.
- Next: merge 0.8.0 and tag it, then 0.9.0 (alias removal), then #13.
