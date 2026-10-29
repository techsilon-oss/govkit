# govkit — rules for working in this repo

last checked 2026-10-29

govkit is a Claude Code plugin that scaffolds guardrails into other repos. It runs those same guardrails on itself, in place (see DEC-003). Status, decisions and handoffs: [`docs/PROJECT-HUB.md`](docs/PROJECT-HUB.md). Open work: GitHub issues.

## Start of a session

`/govkit-session status`. Here, `npm run release:check -- --pr` replaces `release:status` (the `versioning` guardrail is skipped, DEC-004). If a tracker is stale, fix it before other work.

## Branch flow (DEC-002)

```
feature branch  →  PR  →  main
```

- `main` is the release. Every merge to `main` ships to everyone who installs the plugin.
- `main` is protected on GitHub: a PR, and a green **Validate and test** check, are required; force pushes and deletion are blocked; admins included.
- **Every merge needs the maintainer's explicit approval** ("merge it"). Green CI is necessary, not sufficient.
- Conventional commits: `type(scope): description`.

## Changes

- **Tests with the change.** `npm test` (`node --test "tests/*.test.mjs"`). Fixtures come from the release tags, so keep tags fetched.
- **Scripts stay dependency-free:** Node built-ins and `git`.
- **A changed owned template** (`skills/govkit-init/templates/{scripts,githooks,.github}/`) changes files in every consumer's repo through `/govkit-init --upgrade`. Its CHANGELOG entry must name the file; the doc-sync gate enforces this.
- **Provenance comments stay as they are** (DEC-001), in templates and README.
- **The release gate belongs to [release-gate-kit](https://github.com/techsilon-oss/release-gate-kit).** Fix it there, never here.

## Releasing

Follow "Releasing govkit itself" in the [README](README.md#releasing-govkit-itself). Feature = minor, fixes only = patch; below 1.0 a breaking change is a minor bump with upgrade steps. The bump is the PR's last commit. After the merge, tag `v<version>` on the merge commit and publish the GitHub Release. Each step needs the maintainer's OK.

## This repo's own guardrails

`govkit.json` declares them. `npm run govkit:doctor` and `node skills/govkit-init/upgrade.mjs check` must both report clean; CI runs the doctor, and a test runs both.
