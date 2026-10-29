# Module: doc-sync

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail; the [`/govkit-docsync` skill](../../skills/govkit-docsync/SKILL.md) has the rest.

## What you get
On every pull request, a check that **code which changed came with its mapped doc**. You decide the pairs in `scripts/source-doc-map.json` (globs, and `gate` or `warn`). On a PR to the working branch it warns; on a PR to the release branch it **gates**. The workflow posts its findings as a PR comment, and always in the job summary.

It answers a **diff** question. A tracker that went stale while the code sat untouched produces no diff, so it can't catch that. That's [`docs-sync-check`](docs-sync-check.md)'s job. Neither replaces the other.

## What it changes outside your repo
A GitHub Actions workflow, `.github/workflows/govkit-docsync.yml`, which posts or updates one comment per PR. It doesn't comment on a PR from a fork (its token can't write there), but its findings are in the job summary and the gate still applies.

## Cost
About 10 seconds of Actions minutes per PR. The workflow uses `actions/checkout@v7` and `actions/setup-node@v7`, which run on Node 24: **a self-hosted runner must be v2.327.1 or later**.

## Set up
**Edit `scripts/source-doc-map.json`.** Shipped as an example, it maps nothing real and gates nothing. Put `gate` where a wrong doc costs most, and `warn` where the pairing usually holds.

## Fix a finding

### Missing file
`scripts/govkit-docsync.mjs`, `scripts/source-doc-map.json` or the workflow is absent. Re-run `/govkit-init`.

### Missing npm script
`docsync:audit` or `docsync:gate` isn't in `package.json`. Re-run `/govkit-init`, which merges missing scripts. A repo from before 0.8.0 still has `sdlc-docs:*`: run `/govkit-init --upgrade`.

### Outdated
Run `/govkit-init --upgrade`. The workflow's check name, "Doc-sync (gate)" / "Doc-sync (warn)", never changes, so a branch rule requiring it keeps working.

### Old names
The doctor lists `sdlc-docs` names left from before 0.8.0. See [UPGRADING 0.7 → 0.8](../UPGRADING.md#07--08).

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, and delete the three files and the `docsync:*` npm scripts.
