# Module: versioning

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
The version names a **release**: it changes once per release, and every release gets a tag.
- `npm run release:bump -- minor` (features) or `-- patch` (fixes), as the **last commit** of the working → release PR.
- `npm run release:tag` after the merge: tags the release branch's merge commit `v<version>` and pushes it. It refuses if the release branch moved without a bump. A published tag never moves.
- `npm run release:status` reports a release with no tag, or a release branch that moved past its tag without a bump.

A build identifier shown in your UI should be the **commit SHA, never a commit count**. Hosts that build from a shallow clone count only the commits inside the clone.

## What it changes outside your repo
`release:tag` pushes a tag to GitHub, when you run it.

## Cost
Nothing.

## Set up
If the release branch has no `v*` tag yet, run `npm run release:tag` once, to tag what's in production now. It reads the version from `package.json`. A repo whose version lives elsewhere, or with no working branch, can skip this module with a reason (govkit itself does, and checks the same rules in CI).

## Fix a finding

### Missing file
`scripts/release-version.mjs` is absent. Re-run `/govkit-init`.

### Missing npm script
`release:status`, `release:bump` or `release:tag` isn't in `package.json`. Re-run `/govkit-init`.

### "no v<version> tag"
`release:status` found a release without a tag. Run `npm run release:tag`.

### "shipped without a version bump"
The release branch has commits since its tag and the same version. Bump on the working branch and release again.

### Outdated
Run `/govkit-init --upgrade`.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, and delete `scripts/release-version.mjs` and the `release:*` scripts. Existing tags stay.
