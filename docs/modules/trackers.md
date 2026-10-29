# Module: trackers

The short version is this module's note in [`module.json`](../../module.json), which `/govkit-init` shows before you say yes. This guide has the detail.

## What you get
- **`CLAUDE.md`**: a govkit block (between `<!-- govkit:start -->` and `<!-- govkit:end -->`) with the branch flow, per-merge approval, the CI-fallback rule, and where project context lives. Your own text outside the block is never touched.
- **`docs/PROJECT-HUB.md`**: current status, a decisions log (`DEC-001`, …), and a session handoff per working session.
- **`docs/PRIORITY-ROADMAP.md`**: what to work on next and why. GitHub issues hold the what and the status.

Both docs start with `last checked <date>`, which [`docs-sync-check`](docs-sync-check.md) uses to tell a stale tracker from a current one. Every other module hangs off these, which is why this one can't be skipped.

## What it changes outside your repo
Nothing.

## Cost
Nothing, beyond keeping the docs true. `/govkit-session close` walks you through it at the end of a session.

## Set up
`/govkit-init` writes all three. Fill in the hub's status and first decisions, and the roadmap's tiers. If you prefer GitHub issues as your roadmap, list only the hub in `govkit.json` → `guardrails.trackers.expects` (govkit itself does that).

## Fix a finding

### Missing file
The doctor lists a tracker it expects but can't find. Re-run `/govkit-init`: it creates what's missing and never overwrites. Or, if you keep the tracker elsewhere, edit `expects` in `govkit.json`.

### "declares no date"
`docs-sync-check` can't tell how fresh the doc is. Add a line near the top: `last checked YYYY-MM-DD`.

### The CLAUDE.md block differs
`/govkit-init --upgrade` reports the block as **outdated** if it is an older release's block, unedited: take the new one. It reports it as **edited** if you changed it: compare with the saved diff, and take the lines you want.

## Undo
Delete the govkit block in `CLAUDE.md` and the two docs. The doctor will report the trackers as missing, because this module isn't skippable.
