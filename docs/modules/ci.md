# Module: ci

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
A check, by `/govkit-doctor`, that your repo has a CI workflow at `.github/workflows/ci.yml`. **govkit does not write it.** A CI workflow is specific to your stack, and a wrong one is worse than none.

## What it changes outside your repo
Nothing from govkit. Your workflow runs on GitHub Actions.

## Cost
Your CI's Actions minutes: free on public repos, and 2,000 a month on the Free plan for private ones. When they run out, the [release gate](release-gate.md) is the fallback.

## Set up
Add `.github/workflows/ci.yml` running the same checks as `release-gate.config.json`, and give the job the name in the config's `ciJob`. Then make that check required on your release branch (Settings → Branches), so a red CI blocks the merge.

## Fix a finding

### Missing file
The doctor can't find `.github/workflows/ci.yml`. Add it as above. If your CI lives in another file, list that file in `govkit.json` → `guardrails.ci.expects`.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`.
