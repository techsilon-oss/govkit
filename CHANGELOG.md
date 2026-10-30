# Changelog

All notable changes to govkit. Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/). Versioning: [semver](https://semver.org/); see "Versioning" in the README for what a version bump means while govkit is below 1.0.

**Files in your repo.** A plugin update does not change the files `/govkit-init` copied into a repo. When a release changes one, its entry says which; `/govkit-init --upgrade` (0.6.0+) brings them current.

## [0.12.1] - 2026-10-30

### Fixed
- **A first report covers one schedule period.** With no earlier report, a schedule that names days of the week (a weekly report, `0 7 * * 1`) now covers the last 7 days, not 24 hours; any other schedule still covers 24 hours. The header says which.
- **"No launch category: N"** replaces the report's "To triage: N" line, which read as a contradiction next to a category row named `triage`.
- **The status report's issue is not planned work:** `/govkit-session` and the CLAUDE.md "Work tracking" rule leave it out of the to-triage count, as they do the register.
- **The report workflow finds the script through `govkit.json` `paths`**, as the doc-sync workflow does, and the doctor checks it there. A repo that runs the script from elsewhere needs no copy.
- The report's footer says "govkit status report" (it can be weekly).

### Changed
- govkit runs its own weekly report: Mondays, `skipQuietDays`, on the pinned issue #41.

Changed in your repo: `scripts/daily-report/report.mjs`, `.github/workflows/govkit-daily-report.yml` and `scripts/govkit-doctor.mjs` (`/govkit-init --upgrade` keeps your schedule and permission lines), and the CLAUDE.md govkit block (one sentence; an unedited block is offered the new one).

## [0.12.0] - 2026-10-29

### Added
- **The status report** (#14, part 2), part of the tracker module and **opt-in**: `/govkit-init tracker` offers it (a new step). A GitHub Actions workflow, on your schedule, reports what happened since the last successful run: owner actions and open decisions from the register, key deliverables (the `Completed:` lines), issues closed and opened, merged pull requests, fixed and waiting for re-test, reported bugs, open issues by launch category with the to-triage count, milestones and code activity.
  - **Delivery is a setting** (`guardrails.tracker.report.delivery`): `github-issue` (default, **no key**: a comment on a pinned "Daily status" issue, which GitHub's notification email delivers) or `resend` (a designed HTML email plus plain text; the key lives only in an Actions secret).
  - **List endpoints only, never the search API.** Every list is paginated; a failed call is retried once, a rate-limited one never; something that can't be read is said in the report, never shown as a zero. Issue text is escaped and `@mentions` are defused.
  - **Sections** can be removed, reordered, or added from `scripts/daily-report/sections/<name>.mjs` (never touched by upgrades). **`skipQuietDays`** sends nothing when nothing happened. **Test mode** (the default for a manual run) posts no comment, and emails the test recipient only.
  - The schedule, the `issues` permission and the secret's name are set per repo, in lines marked `# govkit: per-repo`; `/govkit-init --upgrade` keeps them.
- **`/govkit-doctor`:** with the report on, it checks both files, the delivery, and (for `github-issue`) the status issue's number.
- Guide: [docs/modules/tracker.md → Daily status report](docs/modules/tracker.md#daily-status-report), plus FAQ entries.

Added in your repo, only when you turn the report on: `scripts/daily-report/report.mjs` and `.github/workflows/govkit-daily-report.yml` (both owned: `--upgrade` keeps them current). Changed in your repo: `scripts/govkit-doctor.mjs` (the report checks).

## [0.11.1] - 2026-10-29

### Fixed
- The decision register issue no longer counts as "to triage": it isn't planned work, so `/govkit-session` leaves it out of the launch-category groups and the count. The CLAUDE.md block's "Work tracking" rule and the tracker guide say so.

### Changed
- govkit tracks its own work with the tracker module: launch categories `now` / `next` / `later` / `triage`, a pinned decision register (#38), and `docs` mapped to GitHub's `documentation` label.

Changed in your repo: the CLAUDE.md govkit block (one sentence; an unedited block is offered the new one).

## [0.11.0] - 2026-10-29

### Added
- **The tracker module** (#14, part 1): work tracked in GitHub Issues, **opt-in**. `/govkit-init tracker` (or the question in `/govkit-init`) shows its note and, on yes, sets up:
  - the labels you're missing (existing ones are never touched). A type label your repo already has under a GitHub default name (`documentation` for `docs`) is used instead of creating a duplicate, and the mapping is recorded in `guardrails.tracker.issues.labelAliases` for the rules and the report;
  - **launch categories with your names** (`guardrails.tracker.issues.categories`): `pre-launch`/`post-launch`/`idea`/`triage` by default, `now`/`next`/`later`/`triage` suggested once the product has launched;
  - one pinned **decision register** issue, whose number is recorded in `govkit.json`;
  - optional issue forms.

  Every GitHub change is shown and asked first. **Pins:** GitHub allows 3 per repo; when all are used, govkit says so and never unpins yours.
- **`/govkit-session`** reads the register and groups open issues by launch category at the start; at close it uses the `Completed:` / `Technical:` closing format. The rules are in the CLAUDE.md govkit block ("Work tracking"), worded for when the tracker is on.
- **`/govkit-doctor`:** "tracker — not decided" is a **notice**: `--ci` stays green in every repo that hasn't chosen yet. "Tracker on, but no register recorded" **fails** `--ci`.
- Guide: [docs/modules/tracker.md](docs/modules/tracker.md). The daily status report follows in 0.12.0.

Changed in your repo: `scripts/govkit-doctor.mjs` (the tracker), and the CLAUDE.md govkit block ("Work tracking"; an unedited block is offered the new one).

## [0.10.0] - 2026-10-29

govkit meets the [kit standard](https://github.com/techsilon-oss/.github/blob/main/KIT-STANDARD.md) (#34). **Self-hosted runners: see [UPGRADING](docs/UPGRADING.md#09--010).**

### Added
- **Module notes, kept once in `module.json`:** for each module, what you get, what it changes outside your code, the cost, how to undo it, and a guide. `/govkit-init` shows them before you say yes, and the README's module table is generated from them.
- **A guide per module**, `docs/modules/<module>.md`: what you get, outside changes, cost, set up, *fix a finding*, undo.
- **`/govkit-help`:** answers from the docs that ship with your installed version, citing them. It only reads (`allowed-tools: Read Grep Glob`).
- **`docs/FAQ.md`:** short answers that link to the guides. The README's and EXTENDING's FAQs moved there.
- **Doctor findings link to their fix,** in the guides of the release the doctor came from (`blob/v<version>/…`), so the links match its own findings: the plugin's copy uses the plugin's version, a repo's copy the version recorded for it in `govkit.json` `files`, and never below v0.10.0, the first release with guides. Not `govkitVersion`, which a repo that hasn't upgraded records as an old release. `/govkit-init`'s next steps and `upgrade.mjs` link the same way.

### Changed
- **The doc-sync workflow** uses `actions/checkout@v7`, `actions/setup-node@v7` and `actions/github-script@v9`, which run on Node 24. **A self-hosted runner must be v2.327.1 or later.** Its check name ("Doc-sync (gate|warn)") is unchanged.
- **On a PR from a fork**, the workflow no longer tries to comment (the fork's token can't write, which used to fail the run). The findings always go to the job summary, and the gate still applies.
- **The plugin description** is one line, ending "Help: /govkit-help".

Changed in your repo: `scripts/govkit-doctor.mjs` (links to fixes) and `.github/workflows/govkit-docsync.yml` (action versions, fork PRs, job summary).

## [0.9.2] - 2026-10-29

### Changed
- govkit follows the [techsilon-oss kit standard](https://github.com/techsilon-oss/.github/blob/main/KIT-STANDARD.md) (#16), linked from the README and CONTRIBUTING.
- `SECURITY.md` is now the org-wide one ([techsilon-oss/.github](https://github.com/techsilon-oss/.github/blob/main/SECURITY.md)): report through the repo's **Security → Report a vulnerability**, or oss@techsilon.com. govkit's own copy is removed; its links point there. govkit keeps its own CONTRIBUTING, PR template and issue templates, which ask for govkit-specific details.

No file in your repo changed in this release.

## [0.9.1] - 2026-10-29

### Security
- **No skill pre-approves a command whose code or effect the repo controls** (#31). A skill's `allowed-tools` runs the listed commands without asking, and in a cloned repo these ran the repo author's code:
  - `/govkit-doctor` and `/govkit-docsync` now run **the plugin's copy** of their script, anchored to `${CLAUDE_PLUGIN_ROOT}`, never the repo's `scripts/` copy. No prompt is added. The plugin's copy is the installed release, so its report can be a step ahead of `npm run govkit:doctor` until `/govkit-init --upgrade`. CI and npm scripts still run the repo's copy.
  - `/govkit-docsync` no longer pre-approves `npm run docsync:*` or `pnpm docsync:*`: `package.json` is the repo's.
  - `/govkit-doctor` pre-approves only `git config --get`, not `git config *`, which allowed writes such as `core.sshCommand` or `core.hooksPath`.
  - `tests/allowed-tools.test.mjs` now requires every pre-approved script to be under `${CLAUDE_PLUGIN_ROOT}`, and rejects `npm`/`pnpm` patterns and config writes.

No file in your repo changed in this release.

## [0.9.0] - 2026-10-29

### Added
- **A repo's own steps in `/govkit-session`** (#13): `.govkit/session.md`, with `## On start`, `## Before commit` and `## On close`. A `sh` block is a command, run through the agent's Bash tool, and one that fails stops that point's remaining steps; a list item or paragraph is an instruction. They run after the standard steps. Guide: [docs/EXTENDING.md](docs/EXTENDING.md).
- **Trust first:** the file comes from the repo, so nothing in it is used until the user has trusted that exact file on their machine. The SHA-256 is recorded in `.git/govkit/session-trust.json`, never committed, and any edit means trusting it again. The user runs the trust command themselves; the skill never pre-approves it, and shows the file between `UNTRUSTED REPO FILE` markers as data, never instructions.
- `/govkit-doctor` lists each repo's project steps, with every command spelled out, and whether this machine trusts the file.

### Security
- **Skills pre-approve only the plugin's own scripts.** `allowed-tools` patterns name the script by its path under `${CLAUDE_PLUGIN_ROOT}`, never by name with a wildcard. `Bash(node *upgrade.mjs check*)` in `/govkit-doctor` matched any file ending in `upgrade.mjs`, so a repo could ship `x-upgrade.mjs` and have it run without a prompt; it's now anchored, like the new `/govkit-session` patterns. A test simulates the matching against look-alike scripts.

### Changed
- **The 0.8.0 aliases are kept longer:** `/sdlc`, `/sdlc-docs` and the `sdlc-docs:*` npm script aliases now stay until **the first minor release on or after 2026-11-28**, not 0.9.0. 0.8.0 shipped the same day as 0.9.0; removing them now would have left no time to move.

Changed in your repo: `scripts/govkit-doctor.mjs` (project steps listing; alias date).

## [0.8.0] - 2026-10-29

**Breaking: follow [docs/UPGRADING.md](docs/UPGRADING.md#07--08).** The old names keep working until the first minor release on or after 2026-11-28 (extended in 0.9.0, which first planned to remove them).

### Changed (breaking)
- **Skills renamed** so they can't clash with a project's own: `/sdlc` → **`/govkit-session`** (`status`, `close`, or a task), `/sdlc-docs` → **`/govkit-docsync`**. `/sdlc` and `/sdlc-docs` stay as aliases that say so, until the first minor release on or after 2026-11-28. (#12)
- **Files renamed with them:** `scripts/sdlc-docs.mjs` → `scripts/govkit-docsync.mjs`, `.github/workflows/sdlc-docs.yml` → `govkit-docsync.yml`. The workflow's check name ("Doc-sync (gate|warn)") is unchanged, so a branch protection rule requiring it keeps working.
- **npm scripts renamed:** `sdlc-docs:{audit,gate,report}` → `docsync:{audit,gate,report}`. `--upgrade` keeps each old key as `npm run docsync:<name>` until the first minor release on or after 2026-11-28.

### Added
- **`--upgrade` carries renames:** an old file is recognised by its release hashes, written under the new name and deleted. An edited old file is never moved or deleted: it's reported and its diff saved.
- **`package.json`, the one file govkit edits that it does not own:** only scripts whose value runs `scripts/sdlc-docs.mjs` change, shown as a diff, line by line (the file's layout survives), on a clean tree. A file that can't be edited that way stops the upgrade instead of being reformatted.
- **The doctor lists old names** (`/sdlc`, `/sdlc-docs`, `sdlc-docs:*`, `scripts/sdlc-docs.mjs`, `sdlc-docs.yml`) in `CLAUDE.md`, `docs/`, `.github/` and git hooks, with file and line. A repo with its own `.claude/skills/sdlc/` isn't told about `/sdlc`. `govkit.json` `oldNames.ignore` keeps a reference on purpose. Warnings only, until the first minor release on or after 2026-11-28.
- `--upgrade` offers the new `bootstrapDocs` when a repo still has exactly the old default; a list the user changed is left alone.
- **An unedited `CLAUDE.md` govkit block is recognised as outdated:** each release's block template is rendered with the repo's values and compared, so a block nobody touched is offered the new one (default yes) instead of keeping `/sdlc` after the aliases are removed. Only a block matching no release counts as edited (default no).

### Fixed
- Scaffolded trackers declare a date: `last checked <scaffold date>` in `PROJECT-HUB.md` and `PRIORITY-ROADMAP.md`, so `docs-sync-check --ci` passes on day one. `CLAUDE.md` leaves the default `bootstrapDocs` (it holds rules, not status). (#26)
- The pre-push block suggests `gh pr create --head <the branch you pushed>`, not `--head dev`. (#27)
- `govkit.json` (and `package.json`) are never written through a symlink, the same rule as owned files.

Changed in your repo:
- `scripts/sdlc-docs.mjs` → `scripts/govkit-docsync.mjs`, and `.github/workflows/sdlc-docs.yml` → `govkit-docsync.yml` (both moved);
- `scripts/govkit-doctor.mjs` (old-name scan);
- `scripts/docs-sync-check.mjs` (default `bootstrapDocs`);
- `.githooks/pre-push` (#27);
- `package.json` scripts and `govkit.json` doc-sync entries (as above).

New repos also get dated trackers.

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

[0.11.1]: https://github.com/techsilon-oss/govkit/compare/v0.11.0...v0.11.1
[0.11.0]: https://github.com/techsilon-oss/govkit/compare/v0.10.0...v0.11.0
[0.10.0]: https://github.com/techsilon-oss/govkit/compare/v0.9.2...v0.10.0
[0.9.2]: https://github.com/techsilon-oss/govkit/compare/v0.9.1...v0.9.2
[0.9.1]: https://github.com/techsilon-oss/govkit/compare/v0.9.0...v0.9.1
[0.9.0]: https://github.com/techsilon-oss/govkit/compare/v0.8.0...v0.9.0
[0.8.0]: https://github.com/techsilon-oss/govkit/compare/v0.7.0...v0.8.0
[0.7.0]: https://github.com/techsilon-oss/govkit/compare/v0.6.1...v0.7.0
[0.6.1]: https://github.com/techsilon-oss/govkit/compare/v0.6.0...v0.6.1
[0.6.0]: https://github.com/techsilon-oss/govkit/compare/v0.5.2...v0.6.0
[0.5.2]: https://github.com/techsilon-oss/govkit/compare/v0.5.1...v0.5.2
[0.5.1]: https://github.com/techsilon-oss/govkit/compare/v0.5.0...v0.5.1
[0.5.0]: https://github.com/techsilon-oss/govkit/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/techsilon-oss/govkit/releases/tag/v0.4.0
