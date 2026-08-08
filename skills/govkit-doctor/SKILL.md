---
name: govkit-doctor
description: Report which govkit guardrails a project actually has, versus which it declares. Also `/govkit-doctor config` to show the current guardrail configuration. Use when adopting govkit into an existing repo, after upgrading govkit, or when a repo "has the standard" but keeps drifting.
argument-hint: "[config] [--ci]"
allowed-tools: Bash(node scripts/govkit-doctor.mjs *) Bash(git config *) Bash(gh repo view *) Read Glob
---

# `/govkit-doctor` — is this project actually conformant?

> Every other guardrail checks the **code**. This one checks the **guardrails**.

## The failure it exists to catch

A project adopts govkit. govkit turns out not to ship some piece yet. The project ends up **less protected than before it adopted the standard** — and nobody notices, because nothing errors and adopting a standard *feels* like a completion.

That is not hypothetical. It is why this skill exists: a repo took "govkit is the single upstream" literally, deleted its local guardrail copies, and ran for weeks with no push protection on a branch that deployed to production — while repos that ignored the standard and kept their own copies stayed protected. **The most compliant repo was the least protected**, and no command existed that would have said so.

## Run it

```bash
node scripts/govkit-doctor.mjs          # report
node scripts/govkit-doctor.mjs --ci     # exit 1 if any declared guardrail is missing
node scripts/govkit-doctor.mjs config   # show the current configuration
```

## What it reports

`govkit.json` is the **declared** state. The doctor compares it against what is on disk, and every guardrail lands in exactly one of three states:

| State | Meaning |
|---|---|
| ✅ **OK** | declared on, present and wired |
| ⏭️ **SKIPPED** | declared off, **with a recorded reason** — a decision |
| ❌ **MISSING** | declared on, absent — a finding |

**A guardrail is never silently absent.** It is either a decision or a finding. That distinction is the entire point: an unexplained gap is indistinguishable from an oversight, and gets treated as one.

It also flags **strays** — guardrails present on disk but absent from the manifest. Those are usually hand-installed copies that `govkit-init` will not maintain, which is how a fork starts.

## When no manifest exists

If there is no `govkit.json`, the project was never scaffolded (or the manifest was deleted). The script says so and stops. **You can still audit by inspection** — check for each of these and report what is missing:

| Guardrail | Look for |
|---|---|
| trackers | `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md` |
| release-gate | `scripts/release-gate.ts` + `release-gate.config.json` + a `release-gate` script |
| ci | `.github/workflows/ci.yml` |
| pre-push-hook | `.githooks/pre-push`, `.gitattributes`, `prepare` script, and `git config core.hooksPath` |
| doc-sync | `scripts/sdlc-docs.mjs`, `scripts/source-doc-map.json`, `.github/workflows/sdlc-docs.yml` |
| docs-sync-check | `scripts/docs-sync-check.mjs` + a `docs:sync-check` script |

Then recommend `/govkit-init` to install the gaps. **Report; do not install without saying what you are about to change.**

## Two checks worth doing by hand

The doctor verifies files exist and scripts are wired. Two things it cannot see:

**1. Is the hook actually active?** A committed `.githooks/pre-push` does nothing until `core.hooksPath` points at it.

```bash
git config core.hooksPath      # expect: .githooks
```

**2. Does the hook actually fire?** Presence is not proof. Verify with a commit that would fast-forward the release branch:

```bash
NEW=$(git commit-tree "$(git rev-parse main^{tree})" -p main -m probe)
git push --dry-run origin "$NEW:refs/heads/main"    # expect: blocked
```

> **Do not verify with `git push --dry-run <branch>:main`.** If the branches have diverged, git rejects the ref as non-fast-forward **before** the hook runs. A clean dry-run there is a hook that never ran, not a hook that passed — and it reads as a pass.
>
> **Do not check out a branch based on the release branch to test it either.** If that branch predates the hook, checking it out removes `.githooks/` from the working tree and the hook is genuinely gone. Both of these produced convincing false readings in practice.

## Vendored versions, not file hashes

`release-gate` is vendored from `techsilon-oss/release-gate-kit`, and the manifest records the upstream **version**. The doctor compares that version, deliberately **not** the file bytes.

Every project runs its own formatter. A byte comparison reports drift on every repo that uses Prettier, gets ignored within a week, and then reports nothing useful when the file genuinely diverges.

## Related

- [`/govkit-init`](../govkit-init/SKILL.md) — installs guardrails; `--skip <name>` records an opt-out
- [`/sdlc`](../sdlc/SKILL.md) — `status` runs the ground-truth check before reporting
