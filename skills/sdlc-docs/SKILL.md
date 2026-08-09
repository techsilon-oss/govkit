---
name: sdlc-docs
description: Documentation sync watchdog. Diff-aware check that flags code shipping without its mapped doc, via scripts/source-doc-map.json. Warn on PR to the working branch, gate on PR to the release branch. Companion to /sdlc; never edits docs.
argument-hint: "audit [--gate|--warn] [--base <ref>] | report"
allowed-tools: Bash(node scripts/sdlc-docs.mjs *) Bash(npm run sdlc-docs:*) Bash(pnpm sdlc-docs:*) Bash(git diff:*) Bash(git log:*) Read Grep
---

# `/sdlc-docs` — documentation sync watchdog

> Diffs a PR against its base and flags **code that shipped without its mapped doc**.
> Runner: `scripts/sdlc-docs.mjs` — dependency-free (Node built-ins + `git`), no install step.
> **It never edits docs.** It reports drift; the fix stays with the developer.

## Run it

```bash
node scripts/sdlc-docs.mjs audit --warn     # never exits non-zero  → working-branch PRs
node scripts/sdlc-docs.mjs audit --gate     # exits 1 on gating drift → release PRs
node scripts/sdlc-docs.mjs audit --base <ref>
node scripts/sdlc-docs.mjs report           # health snapshot, no diff
```

CI runs both modes automatically via `.github/workflows/sdlc-docs.yml` — **warn** on a PR to the working branch, **gate** on a PR to the release branch.

## The registry is the whole mechanism

`scripts/source-doc-map.json`:

```json
{ "mappings": [
  { "source": ["src/lib/billing/**"], "docs": ["docs/BILLING.md"], "severity": "gate" },
  { "source": ["src/components/**"],  "docs": ["docs/UI-SPEC.md"],  "severity": "warn" }
] }
```

Globs: `**` any path, `*` any non-slash run. `severity` defaults to `gate`.

**Shipped as an example, it maps nothing real and therefore gates nothing.** An unedited registry is a guardrail in appearance only — the CI check goes green and means nothing. Editing it is not optional setup, it *is* the setup.

### Choosing severities

Put **`gate`** where a wrong doc costs the most, not where changes are most frequent. Good candidates: the file holding user-facing claims, anything defining money or permissions, the config describing how the thing deploys.

Use **`warn`** where the pairing is usually-but-not-always real — component directories, styling. A rule that fires on every PR without being actionable gets ignored within a week, and takes the gating rules' credibility with it.

## What this cannot see, and why the sibling check exists

`/sdlc-docs` asks: *did code change without its mapped doc changing?* That is a **diff** question.

It structurally cannot catch a tracker that has gone **stale while the code it describes sat untouched** — no diff exists, so no rule fires. Observed repeatedly: a project doc asserting "no release branch" after one existed, "nothing deployed" after launch, "zero issues" after a dozen were filed. Each was true when written.

That is what **`docs-sync-check`** is for — it compares declared dates and prints `git`/`gh` ground truth. `/sdlc status` runs it first. **Neither substitutes for the other.**

## Both checks share one blind spot — know it

They verify *dates* and *pairings*, never **content**. A doc edited today passes both while missing everything that happened this week. **The session-close checklist in `/sdlc` remains the only thing that keeps a tracker actually true.** Treat a green check as "nothing obviously rotted", not "the docs are right".

## When a gating rule fires

Three legitimate responses, in order of preference:

1. **Update the mapped doc** — usually correct; the rule fired because the mapping is real.
2. **Downgrade the mapping to `warn`** if the pairing turns out to be occasional rather than reliable. Do this in the same PR so the next person inherits the corrected rule.
3. **Say why in the PR body** if the change genuinely does not affect the doc. Leave a trace; a silent override teaches the next reader that the gate is noise.

**Never delete a mapping to make a PR pass.** That converts a finding into a permanent blind spot, and nothing will report it again.

## Related

- [`/sdlc`](../sdlc/SKILL.md) — calls this at close-out
- [`/govkit-doctor`](../govkit-doctor/SKILL.md) — reports whether this guardrail is installed and wired at all
