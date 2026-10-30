<!-- govkit:start -->
# {{PROJECT_NAME}} — Engineering Guardrails

> Scaffolded by [govkit](https://github.com/techsilon-oss/govkit) `/govkit-init`. This block is delimited by `govkit:start`/`govkit:end` markers so re-running init won't duplicate it. Edit freely — but keep the markers if you want idempotent updates.

## Standards lineage — where these rules come from

This project's guardrails are **not local inventions**. They come from three upstream repos, and a change belongs in whichever one owns it. Read this before "fixing" a guardrail here — a local patch forks it silently and the fix never reaches the other projects.

| Upstream | Owns | Change it when |
|---|---|---|
| [**release-gate-kit**](https://github.com/techsilon-oss/release-gate-kit) | `scripts/release-gate.ts` — the local CI-fallback gate, and nothing else. Standalone by design: usable in any project with zero governance buy-in | The gate itself is wrong or missing a feature. **Never patch the vendored copy here** |
| [**govkit**](https://github.com/techsilon-oss/govkit) | The guardrail spine: `/govkit-init`, `/govkit-session`, `/govkit-doctor`, the hook, the doc-sync runners, this block | Any project would want the change |
| **dev-standards** (private, TechSilon repos only) | The house layer: stack runbooks, the user `CLAUDE.md` profile, the guardrails cheatsheet | The change is house-specific, not universal |

**Dependencies run one way only:** release-gate-kit ← govkit ← dev-standards ← this project. Nothing upstream references a consumer.

`govkit.json` records which guardrails are installed and which were deliberately skipped. Run **`/govkit-doctor`** to see what this project is actually missing versus what it declares — that is the difference between a recorded decision and an unnoticed gap.

## Branch Strategy

```
feature/* (optional)  →  {{DEFAULT_BRANCH}}  →  main
```

- **`{{DEFAULT_BRANCH}}`** is the working branch — all new code lands here first.
- **`main`** is production. **Never push directly to `main`** — always via a PR.
- **Every merge requires explicit per-merge approval.** Green CI is necessary but NOT sufficient; wait for an explicit "merge it" / "ship it".
- Feature branches are optional for small changes, recommended for larger/riskier work.

## Tests-With-Features Policy

Every feature or bug fix ships with its tests in the same change — not as a follow-up. At minimum: happy path + one error/edge case; cover any new pure function, and the edge cases of any money/security/permission logic. Never commit with failing tests.

## Local Release Gate — CI-fallback (MANDATORY when CI is unavailable)

CI runs on metered GitHub Actions (Free: 2,000 min/month, **resets on the 1st**). When minutes are exhausted — or during an outage — jobs fail to start and the "CI passing" merge gate can't run. The local release gate is its **substitute**, not a way around it.

**While CI is unavailable, before any merge to `{{DEFAULT_BRANCH}}` or `main`:**

1. Run the gate and confirm a **GREEN** verdict:
   ```bash
   npm run release-gate                 # core checks (lint, types, tests, build, …)
   npm run release-gate:full            # also E2E/Lighthouse — use before a production release
   npm run release-gate -- --pr <num>   # also posts the evidence as a comment on PR <num>
   ```
2. **Attach the evidence** to the PR (`-- --pr <number>`) — the green checkmarks won't appear otherwise. The report is also written to `test-results/release-gate-report.md`.
3. **Never merge on a RED verdict.** Fix it first, exactly as for failing CI.

**Still works without Actions:** {{DEPLOY_TARGET}} deploys on push to `main` (its own integration), and CLI-based DB/function deploys — both independent of Actions. Any production-deploy approval rule still applies.

The gate's checks live in `release-gate.config.json` — edit them to match this project's CI jobs.

## Work tracking (when the tracker module is on)

When `govkit.json` → `guardrails.tracker.enabled` is `true`, work is tracked in GitHub Issues:

- **Issues and milestones are the source of truth** for what to work on and its status. Docs keep the why. If a doc and the issues disagree, the issues are right; fix the doc.
- **Every open issue has exactly one launch-category label**, one of `guardrails.tracker.issues.categories`, assigned when it's created. An issue without one counts as "to triage" (except the decision register and the status report's issue, which aren't planned work). Where the repo names a type label differently (`guardrails.tracker.issues.labelAliases`, e.g. `docs` → `documentation`), use the repo's name.
- **Milestones are themed outcomes** ("Launch Readiness", "Search & Discovery"), never "Phase 1". One-off bugs go in "Maintenance & Bugs".
- **The decision register** (issue `guardrails.tracker.issues.register`) holds everything only an owner can do or decide. Record an open question there as `D-###` and label its issue `needs-decision`. **Never invent an owner's answer:** write the assumption down, build under it, and say so.
- **Close an issue with a summary comment:** `Completed: <what the user gains, in plain words>` and, optionally, `Technical: <migrations, tests, deploy notes>`.
- Never change an issue's priority; that's the owners' call.

## Project Context

- Architecture decisions, current status, and session handoffs live in [`docs/PROJECT-HUB.md`](docs/PROJECT-HUB.md).
- What to work on next lives in [`docs/PRIORITY-ROADMAP.md`](docs/PRIORITY-ROADMAP.md).
- Run `/govkit-session status` (govkit skill) at session start for a current-state read.
<!-- govkit:end -->
