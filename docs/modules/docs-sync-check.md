# Module: docs-sync-check

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
`npm run docs:sync-check`, which `/govkit-session status` runs first. It prints what git and GitHub actually report (branches, the release branch measured against `origin`, tags, CI, open issues) next to what your trackers claim. It fails when a tracker's `last checked` date is older than the newest code commit. A tracker rots while the code it describes sits untouched: "no `main` branch" after `main` exists, "nothing deployed" after launch. Nothing re-checks prose, so this does.

The plugin's **session hook** uses the same rule: it notes a stale tracker at session start, and at the end of a session asks for the close checklist if the working branch gained code and no tracker changed. See [What govkit does on your machine](../../README.md#what-govkit-does-on-your-machine).

## What it changes outside your repo
Nothing. It reads git and, if `gh` is available, GitHub.

## Cost
Nothing.

## Set up
In `govkit.json` → `guardrails["docs-sync-check"]`:
- `bootstrapDocs`: the trackers it checks (default: the project hub and the roadmap);
- `watchedPaths`: the code whose commits make them stale (`docs/` is left out on purpose);
- `sessionHook: false` turns off the hook for this repo.

## Fix a finding

### "STALE: says <date>, code moved <date>"
Re-read the doc against the facts printed above it, fix what drifted, and update its `last checked` date in the same commit.

### "declares no date"
Add `last checked YYYY-MM-DD` near the top of the doc.

### Missing file
`scripts/docs-sync-check.mjs` is absent. Re-run `/govkit-init`.

### Missing npm script
`docs:sync-check` isn't in `package.json`. Re-run `/govkit-init`.

### Outdated
Run `/govkit-init --upgrade`.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, and delete `scripts/docs-sync-check.mjs`. To keep the check but silence the hook, set `sessionHook: false`.
