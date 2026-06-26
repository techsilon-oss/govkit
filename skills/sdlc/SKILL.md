---
name: sdlc
description: Lightweight SDLC workflow for a govkit-scaffolded project — status review, dev cycle, branch/PR flow with the CI-fallback release gate, and a session-close doc checklist. Invoke as /sdlc for the cycle or /sdlc status for a current-state read.
---

# /sdlc — development lifecycle

A generic, self-contained workflow for any project scaffolded by `/govkit-init`. Assumes the govkit structure: `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, a `release-gate`, and a `feature → <working-branch> → main` flow. Uses only `git` and the `gh` CLI — no other plugins, MCP, or services required.

## /sdlc status (or no argument)

Give a current-state read:

1. Read `docs/PROJECT-HUB.md` (Current Status + Key Decisions) and `docs/PRIORITY-ROADMAP.md` (tiers).
2. `gh issue list --state open --limit 30` — open work.
3. `git log --oneline -10` — what changed recently.
4. Report: the top-priority items, anything new, blockers, and a recommended next step.

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
