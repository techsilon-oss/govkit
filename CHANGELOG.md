# Changelog

All notable changes to govkit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [semver](https://semver.org/); see "Versioning" in the README for what a version bump means while govkit is below 1.0.

**Files in your repo.** A plugin update does not change the files `/govkit-init` copied into a repo. When a release changes one, its entry says which; `/govkit-init --upgrade` (0.6.0+) brings them current.

## [0.7.0] - 2026-10-29

### Added
- **`govkit.json` `paths`** (optional): map an owned path to where the file actually is, for a repo that runs govkit's files from somewhere else. The doctor, `/govkit-init --upgrade` and the doc-sync workflow all look there; without it nothing changes. Values are confined to the repo: an absolute path, one that climbs out with `..`, or one that leaves through a symlinked directory is refused by name, and an upgrade checks every target before it writes anything. With or without `paths`, an upgrade also refuses to write an owned file that is a symlink, dangling or not, or that sits in a symlinked directory: owned files must be regular files. `check` reports such a file as `symlink`.
- **govkit runs its own guardrails**, in place from its templates (#11): `govkit.json`, `CLAUDE.md`, `docs/PROJECT-HUB.md`, the pre-push hook, the doc-sync gate (a changed owned template must be named in this file), and `tools/check-release.mjs` in CI in place of the `versioning` guardrail.

### Fixed
- `/govkit-init --upgrade` now finds Prettier configured through `prettier.config.*`, `.prettierrc.toml`, `.prettierrc.json5` or `.prettierrc.{ts,cts,mts}`, so it offers the `.prettierignore` entries there too. (#22)

### Changed
- CI pins Claude Code for `plugin validate`, and runs the doctor and the release check. `main` requires a PR and a green CI check.

Changed in your repo: `scripts/govkit-doctor.mjs` (resolves `paths`, and refuses a value outside the repo) and `.github/workflows/sdlc-docs.yml` (reads the runner's path from `paths`). Both work as before without `paths`.

## [0.6.1] - 2026-10-29

### Changed
- License: **MIT**, © Techsilon LLC. Releases up to and including 0.6.0 were published under CC0-1.0, and remain available under it.
- Owner metadata: `plugin.json` and the marketplace name Techsilon LLC, with a contact address, homepage and repository.
- The README now has a quick start, what govkit does on your machine (and how to remove it), and a versioning rule. Release history moved here from the README.

### Added
- `LICENSE`, `CHANGELOG.md`, `CONTRIBUTING.md`, `SECURITY.md`, `CODEOWNERS`, issue and PR templates.
- CI for govkit itself: syntax check, tests, and `claude plugin validate` on every PR.

No file in your repo changed in this release.

## [0.6.0] - 2026-10-29

### Added
- **`/govkit-init --upgrade`.** Each file govkit owns is hashed against every release and reported current, outdated or edited, and replaced one at a time on an explicit yes. It runs on a clean working tree only, so each upgrade is one reviewable, revertable change. A declined diff is saved to `.git/govkit/upgrade-<name>.diff`. (#19)
- `govkit.json` gains `files` (the version and hash of what govkit wrote) and `project` (the values rendered into `CLAUDE.md`).
- `/govkit-doctor` reports outdated files.
- govkit's first tests.

No file in your repo changed in this release. This release is how the 0.5.1 and 0.5.2 fixes reach repos initialised before them.

## [0.5.2] - 2026-10-29

### Fixed
- `scripts/supabase.mjs`: again stops with a plain message while `supabase/projects.json` holds the scaffolded placeholders. The guard was lost in the 0.3.0 shell-injection fix (#7), so an unedited scaffold reported a wrong account instead. (#18)
- `scripts/docs-sync-check.mjs`: `git ls-remote` gives up after 8 s instead of hanging, and when origin can't be read it says why (timed out, or git's error).

Changed in your repo: `scripts/supabase.mjs`, `scripts/docs-sync-check.mjs`.

## [0.5.1] - 2026-10-29

### Fixed
- `scripts/docs-sync-check.mjs`: measures the branch against `origin/<release>` instead of the local release branch, which is only as current as its last pull. It also says when local `main` or the tracking ref has fallen behind. (#8)
- `/govkit-init` records the plugin's real version in `govkit.json`; 0.5.0 wrote `0.4.0`.

Changed in your repo: `scripts/docs-sync-check.mjs`.

## [0.5.0] - 2026-10-25

### Added
- The session hook: tracker freshness at session start, and a once-per-change session-close reminder when the working branch moved and no tracker did.
- `docs-sync-check` lists the commits and merged PRs since the oldest stale date.

Changed in your repo: `scripts/docs-sync-check.mjs`.

## [0.4.0] - 2026-10-02

### Added
- `versioning` guardrail: one version per release, a `v<version>` tag on the release branch for each, and `release:status` to report drift. The UI's build identifier should be the commit SHA, never a commit count.

## [0.3.0] - 2026-09-07

### Added
- `supabase-account` guardrail: Supabase CLI commands bound to the repo's own account, so a machine with several accounts can't run a migration against the wrong company's database.

### Security
- `scripts/supabase.mjs`: fixed a shell-injection flaw in how arguments were passed to the CLI (#7). Shipped after 0.3.0 without a version bump.

## [0.2.1] - 2026-08-09

### Added
- The `/sdlc-docs` skill. 0.2.0 shipped its runner but no skill.

### Fixed
- `docs-sync-check` accepts `last reviewed: <date>` with a colon.

Changed in your repo: `scripts/docs-sync-check.mjs`.

## [0.2.0] - 2026-08-08

### Added
- Pre-push hook and `.gitattributes`, the `sdlc-docs` watchdog, `docs-sync-check`, the `govkit.json` manifest, and `/govkit-doctor`. Guardrails are on by default, and skipping one requires a recorded reason.

## [0.1.0] - 2026-06-26

### Added
- Branch flow, the Local Release Gate, `PROJECT-HUB`/`PRIORITY-ROADMAP`, and a generic `/sdlc`.

[0.7.0]: https://github.com/techsilon-oss/govkit/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/techsilon-oss/govkit/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/techsilon-oss/govkit/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/techsilon-oss/govkit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/techsilon-oss/govkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/techsilon-oss/govkit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/techsilon-oss/govkit/releases/tag/v0.4.0
