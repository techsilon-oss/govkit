---
name: sdlc
description: Lightweight SDLC workflow for a govkit-scaffolded project — status review, dev cycle, branch/PR flow with the CI-fallback release gate, and a session-close doc checklist. Invoke as /sdlc for the cycle or /sdlc status for a current-state read.
---

# /sdlc — development lifecycle

A generic, self-contained workflow for any project scaffolded by `/govkit-init`. Assumes the govkit structure: `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, a `release-gate`, and a `feature → <working-branch> → main` flow. Uses only `git` and the `gh` CLI — no other plugins, MCP, or services required.

## /sdlc status (or no argument)

Give a current-state read. **Ground truth first, prose second — that order is the point.**

1. **`npm run docs:sync-check`** (or `node scripts/docs-sync-check.mjs`). Prints what `git` and `gh` actually report, and fails if a bootstrap doc's declared date predates the newest code commit.

   **If a doc is stale, say so before anything else and offer to reconcile it first.** A session that starts from a stale hub produces work premised on a false picture, and the cost lands later, when someone acts on it.

2. Read `docs/PROJECT-HUB.md` (Current Status + Key Decisions) and `docs/PRIORITY-ROADMAP.md` (tiers) — **against the ground truth from step 1, not on their own terms.**

   Watch specifically for prose that asserts repo state: which branches exist, what the default branch is, whether anything is deployed, how many issues there are, whether CI runs. **These are the claims that rot**, because they were true when written and nothing re-checks them. Every one is in step 1's output. Where they disagree, the repo is right and the doc is a bug — fix it in the same session rather than noting it.

3. `gh issue list --state open --limit 30` — open work.
4. `git log --oneline -10` — what changed recently. **If the docs and git disagree, trust git, then fix the doc.**
5. Report: top-priority items, anything new, blockers, a recommended next step — and **any drift found in step 2**, which is a finding, not a footnote.

> If `scripts/docs-sync-check.mjs` is absent, this project predates it or opted out. Check `govkit.json`; run `/govkit-doctor` to see what else is missing.

## /sdlc <task> — development cycle

1. **Plan.** Restate the task; identify the files to touch. Enter plan mode for non-trivial work (3+ files or an architectural decision).
2. **Implement** following existing patterns. **Tests with features** (same change): happy path + an error/edge case; cover new pure functions and money/security/permission edges.
3. **Verify.** Run the project's tests + build. If CI is up, rely on it; if CI is unavailable, run the release gate (see below).
4. **Commit** with conventional messages (`type(scope): description`).

## Branch & merge flow

- Land work on the working branch (`dev` by convention) — directly for small changes, or via `feature/* → dev` PR for larger/riskier ones.
- Release to production via a separate `dev → main` PR (`gh pr create --base main --head dev`). Releases batch multiple merges.
- **Every merge needs explicit user approval** ("merge it" / "ship it"). Green CI is necessary but not sufficient. Approval is per-merge.
- **Never push directly to `main`.**

## CI-fallback hook (before any merge)

Check whether GitHub Actions can run: `gh run list --limit 3`. If recent jobs failed to start / are billing-blocked (the Free 2,000-min/month cap, resets on the 1st) or there's an outage, the "CI passing" gate can't run. Then:

1. Run `npm run release-gate -- --pr <number>` (use `release-gate:full` before a `main` release).
2. Require a **GREEN** verdict and the evidence comment on the PR.
3. Proceed with the merge only on GREEN. Never merge on RED.

Source of truth for this rule: the "Local Release Gate — CI-fallback" section in the project's `CLAUDE.md`. Deploys (host integration on `main`, CLI-based DB/function deploys) are independent of Actions, so releases still complete — but any production-deploy approval rule still applies.

## Session close — documentation checklist

After a merge, before ending the session:

1. **Close the issue** with a one-line, business-language summary: `gh issue close <n> --comment "..."`.
2. **`docs/PRIORITY-ROADMAP.md`** — remove/mark the completed item; add a revision-history row (date + what changed).
3. **`docs/PROJECT-HUB.md`** — extend the Session Handoff (or add an entry); update Current Status; add a `DEC-###` if an architectural decision was made.
4. Ask: would `/sdlc status` give an accurate picture to the next session? If not, fix the docs before closing.
