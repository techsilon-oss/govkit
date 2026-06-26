<!-- govkit:start -->
# {{PROJECT_NAME}} — Engineering Guardrails

> Scaffolded by [govkit](https://github.com/tektekgo/govkit) `/govkit-init`. This block is delimited by `govkit:start`/`govkit:end` markers so re-running init won't duplicate it. Edit freely — but keep the markers if you want idempotent updates.

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

## Project Context

- Architecture decisions, current status, and session handoffs live in [`docs/PROJECT-HUB.md`](docs/PROJECT-HUB.md).
- What to work on next lives in [`docs/PRIORITY-ROADMAP.md`](docs/PRIORITY-ROADMAP.md).
- Run `/sdlc status` (govkit skill) at session start for a current-state read.
<!-- govkit:end -->
