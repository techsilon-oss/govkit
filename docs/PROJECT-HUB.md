# govkit — Project Hub

last checked 2026-10-29

> Decisions, current state, and session-to-session context. `/sdlc status` reads this file. Repo facts (branches, tags, CI, issue counts) are not copied here: `npm run docs:sync-check` and `npm run release:check -- --pr` print them from git and GitHub.

## Current Status

- **Stage:** live. Public on GitHub, installed from the marketplace (`claude plugin install govkit --marketplace techsilon-oss/govkit`).
- **Released:** the latest `v*` tag; `CHANGELOG.md` has the history.
- **Health:** `npm test`, and CI on every PR (`.github/workflows/ci.yml`). `main` is protected: a PR and green **Validate and test** are required.
- **Now:** #11, making the repo public-ready. PR 1 (0.6.1) shipped license, owner, CHANGELOG and CI. PR 2 (0.7.0) makes govkit run its own guardrails and fixes #22.
- **Next, in order:** #12 rename (0.8.0) → #13 → #16 → #14. #15 is an idea.

## Key Decisions Log

### DEC-001: Provenance comments stay as they are
**2026-10-27 · Decided in qa-kit (DEC-014) · Active.** Provenance comments in govkit's templates and README stay as written, including names of the repos the files came from. Consumers that want different wording keep a local edit; `/govkit-init --upgrade` reports such a file as `edited` and defaults to keeping it.

### DEC-002: Trunk flow — feature branch → PR → main
**2026-10-29 · Active.** govkit has no `dev` branch. Every merge to `main` is a release, so each PR that ships is its own release PR (version bump as its last commit) and is tagged after the merge. `main` is protected with admins included; force pushes and deletion are blocked.

### DEC-003: govkit runs its guardrails in place
**2026-10-29 · Active.** Rather than a second copy of each script under `scripts/`, `package.json` runs them from `skills/govkit-init/templates/`, and `govkit.json` `paths` tells the doctor, `upgrade.mjs` and the sdlc-docs workflow where they are. The one real copy is `.github/workflows/sdlc-docs.yml`, because workflows must live there. CI and a test hold govkit to "doctor and upgrade check report clean".

### DEC-004: Versioning checked by `tools/check-release.mjs`, not `release-version.mjs`
**2026-10-29 · Active.** `release-version.mjs` reads `package.json` and bumps on a working branch; govkit's version lives in the plugin manifests, and it has no working branch. The `versioning` guardrail is skipped with that reason, and `check-release.mjs` checks govkit's rules in CI: the manifests agree; CHANGELOG, template history and govkit.json know the version; and (on PRs) main's release is tagged. Generalising `release-version.mjs` is an idea issue, for when a second plugin repo needs it.

## Session Handoff

### Session 1 — 2026-10-29 — 0.5.0 tagged through 0.6.1 shipped, dogfooding started
- Tagged the untagged 0.5.0. Shipped 0.5.1 (#8, ground truth vs `origin/main`), 0.5.2 (#18, Supabase guard; `ls-remote` timeout and reason), 0.6.0 (#19, `/govkit-init --upgrade`, the first tests) and 0.6.1 (#11 PR 1: MIT, owner, CHANGELOG, CI, GitHub Releases, topics, branch protection).
- Found in passing: init's `govkitVersion` literal (fixed 0.5.1); the CI-only Linux file-mode bug in a test fixture (fixed 0.6.1).
- Next: merge #11 PR 2 (0.7.0) and tag it, then #12.
