# Module: release-gate

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
CI runs on metered GitHub Actions. When the minutes run out, or Actions has an outage, the "CI passing" merge gate can't run. The release gate reproduces your CI checks **locally**, prints a PASS/FAIL scorecard, and with `--pr` posts the evidence to the pull request, so you keep shipping at the same bar. It's the substitute for CI when CI can't run, never a way around it.

```bash
npm run release-gate                 # core checks (lint, types, tests, build, …)
npm run release-gate:full            # also E2E/Lighthouse: before a production release
npm run release-gate -- --pr <num>   # also posts the evidence as a comment on PR <num>
```

The gate itself belongs to [release-gate-kit](https://github.com/techsilon-oss/release-gate-kit); govkit vendors a copy so init works offline. **Fix bugs upstream, never in the vendored copy.**

## What it changes outside your repo
With `--pr` only: one comment on the pull request.

## Cost
Nothing to run. It needs `tsx` as a dev dependency: `npm i -D tsx`.

## Set up
Edit `release-gate.config.json` so its `checks` match your real CI jobs. The checks are shell commands, so any stack works. Name your CI job to match the config's `ciJob`, so the gate and CI describe the same thing.

## Fix a finding

### Missing file
`scripts/release-gate.ts` or `release-gate.config.json` is absent. Re-run `/govkit-init`; it creates only what's missing.

### Missing npm script
`release-gate` isn't in `package.json`. Add `"release-gate": "tsx scripts/release-gate.ts"`, or re-run `/govkit-init`, which merges missing scripts.

### Outdated
The vendored copy is behind the release govkit ships (`vendoredVersion` in `govkit.json`). Run `/govkit-init --upgrade`.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, and delete `scripts/release-gate.ts` and `release-gate.config.json`. A public repo has no Actions minute cap, so the gate matters less there: during an outage, wait or run the tests locally.
