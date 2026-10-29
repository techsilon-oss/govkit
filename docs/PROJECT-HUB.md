# govkit — Project Hub

last checked 2026-10-29

> Decisions, current state, and session-to-session context. `/govkit-session status` reads this file. Repo facts (branches, tags, CI, issue counts) are not copied here: `npm run docs:sync-check` and `npm run release:check -- --pr` print them from git and GitHub.

## Current Status

- **Stage:** live. Public on GitHub, installed from the marketplace (`claude plugin install govkit --marketplace techsilon-oss/govkit`).
- **Released:** the latest `v*` tag; `CHANGELOG.md` has the history.
- **Health:** `npm test`, and CI on every PR (`.github/workflows/ci.yml`). `main` is protected: a PR and green **Validate and test** are required.
- **Now:** 0.10.0 (#34): govkit meets the kit standard: module notes in `module.json`, guides per module, `/govkit-help`, `docs/FAQ.md`, version-pinned fix links, the doc-sync workflow on Node 24 actions.
- **Next, in order:** #14 (the tracker module, an opt-in `module.json` entry) → #29 (alias removal, not before 2026-11-28). #15 and #25 are ideas.

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

### DEC-006: A repo's own session steps are used only after the user trusts that exact file
**2026-10-29 · Active (0.9.0, #13).** `.govkit/session.md` is repo-authored, so a cloned repo could use it to run commands or give the agent instructions. Claude Code's permissions don't fully cover that (allowlists, auto mode). So nothing in it is used until the user has trusted it by hash (`.git/govkit/session-trust.json`, never committed). Any edit means re-trusting. The agent never trusts it: the user runs the trust command, the skill doesn't pre-approve it, and the file is shown between UNTRUSTED markers as data. Command steps run through the agent's Bash tool, never from a govkit script.

## Session Handoff

### Session 1 — 2026-10-29 — 0.5.0 tagged through 0.6.1 shipped, dogfooding started
- Tagged the untagged 0.5.0. Shipped 0.5.1 (#8, ground truth vs `origin/main`), 0.5.2 (#18, Supabase guard; `ls-remote` timeout and reason), 0.6.0 (#19, `/govkit-init --upgrade`, the first tests) and 0.6.1 (#11 PR 1: MIT, owner, CHANGELOG, CI, GitHub Releases, topics, branch protection).
- Found in passing: init's `govkitVersion` literal (fixed 0.5.1); the CI-only Linux file-mode bug in a test fixture (fixed 0.6.1).
- Shipped 0.7.0 (#24): govkit runs its own guardrails; `paths` confined to the repo, owned files must be regular files. `main` protected.
- 0.8.0 (#12 + #26 + #27) in review: rename with aliases, `--upgrade` renames, the package.json exception, old-name scan, `bootstrapDocs` offer.
- Shipped 0.8.0 (#28): the rename, with `--upgrade` carrying it; an unedited CLAUDE.md block counts as outdated.
- 0.9.0 (#13) in review: project steps behind a trust step. The aliases were kept longer, because 0.8.0 had shipped the same day (#29 moved to on or after 2026-11-28).
- Shipped 0.9.0 (#30), with the review fix: pre-approvals anchored to `${CLAUDE_PLUGIN_ROOT}`, tested in a live `dontAsk` session. v0.8.0's release notes now give the new alias date.
- 0.9.1 (#31) in review: the remaining pre-approvals of repo code removed.
- Shipped 0.9.1 (#32): no pre-approved command runs repo code or writes config.
- #16: created `techsilon-oss/.github` (KIT-STANDARD.md, org SECURITY/CONTRIBUTING/issue templates) in PR .github#1; govkit 0.9.2 links it. Four kit checklist issues drafted for review.
- #16 done: techsilon-oss/.github created (KIT-STANDARD.md, org SECURITY/CONTRIBUTING/issue templates, profile), its `main` protected; private vulnerability reporting enabled on all five repos; govkit 0.9.2 shipped (#33); checklists posted (govkit#34, qa-kit#2, release-gate-kit#3, gh-runner-kit#1).
- 0.10.0 (#34) in review.
- Next: #14, in the `module.json` format.
