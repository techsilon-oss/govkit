# Upgrading govkit

Most releases need only `/govkit-init --upgrade` (see the README's [Upgrading](../README.md#upgrading)). A release that renames or removes something gets a section here with the exact steps. [CHANGELOG.md](../CHANGELOG.md) lists every release.

## 0.7 → 0.8

0.8.0 renames govkit's skills so they can't clash with a project's own skills of the same name, and moves the files and npm scripts that went with them. **The old names keep working until 0.9.0.**

| Old | New |
|---|---|
| `/sdlc` | `/govkit-session` (`status`, `close`, or a task) |
| `/sdlc-docs` | `/govkit-docsync` |
| `scripts/sdlc-docs.mjs` | `scripts/govkit-docsync.mjs` |
| `.github/workflows/sdlc-docs.yml` | `.github/workflows/govkit-docsync.yml` (the **check name**, "Doc-sync (gate)" / "Doc-sync (warn)", **is unchanged**: a branch protection rule requiring it keeps working) |
| npm scripts `sdlc-docs:audit`, `:gate`, `:report` | `docsync:audit`, `:gate`, `:report` (the old keys stay as aliases until 0.9.0) |

### Steps, in each repo

1. **Update the plugin:** `claude plugin marketplace update govkit-marketplace`, then `claude plugin update govkit` (or `/plugin` → govkit → Update). Restart Claude Code.
2. **Commit or stash your work.** The upgrade runs only on a clean working tree, so it lands as one change you can review and revert.
3. **Run `/govkit-init --upgrade`.** For each item it shows a diff and asks:
   - `scripts/sdlc-docs.mjs` and the workflow move to their new names, and the old files are deleted. **If you edited one of them, it is not moved or deleted:** the upgrade says so and saves the diff to `.git/govkit/upgrade-<name>.diff`, so you can carry your change over and then delete the old file yourself.
   - **`package.json` is the one file govkit edits that it does not own.** Only scripts whose value runs `scripts/sdlc-docs.mjs` change: the path is rewritten, and the three scripts init wrote are renamed to `docsync:*`, with each old key kept as `npm run docsync:<name>`. Nothing else in the file changes. If it can't edit the file line by line (for example, it's minified), the upgrade stops and tells you which scripts to change by hand.
   - `govkit.json` follows: the doc-sync guardrail's `expects` and `expectsScripts` take the new names.
   - **`bootstrapDocs`**: if yours is still the old default (`PROJECT-HUB`, `PRIORITY-ROADMAP`, `CLAUDE.md`), it offers the new one without `CLAUDE.md`, which holds rules, not status. If you changed the list, it's left as it is.
   - `govkit-doctor.mjs`, `docs-sync-check.mjs` and `.githooks/pre-push` update as usual (the hook now suggests a PR from the branch you pushed, not from `dev`).
4. **Run `/govkit-doctor`.** It lists every remaining reference to an old name in `CLAUDE.md`, `docs/`, `.github/` and your git hooks, with file and line. Fix them, in particular any CI step that runs `npm run sdlc-docs:*`, before 0.9.0 removes the aliases.
   - If your repo has **its own** `/sdlc` or `/sdlc-docs` skill (`.claude/skills/sdlc/`), mentions of that name are yours and are not listed.
   - To keep a reference on purpose, add it to `govkit.json`: `"oldNames": { "ignore": ["docs/history/**", "CLAUDE.md:42"] }`.
5. **Add a `last checked YYYY-MM-DD` line** near the top of `docs/PROJECT-HUB.md` and `docs/PRIORITY-ROADMAP.md`, if they don't have one. The trackers are yours, so the upgrade doesn't touch them. New repos get the line from init. Without it, `docs-sync-check` reports "declares no date".
6. **The `CLAUDE.md` govkit block** now says `/govkit-session`. If you never edited your block, it matches an older release's and the upgrade offers the new one, default yes. If you edited it, it shows the diff and defaults to no, because the block is yours: take the new lines (the diff is saved), or change `/sdlc` by hand.
7. Review `git diff` and commit: `chore(govkit): upgrade to 0.8.0`.

### What 0.9.0 will do
- Remove the `/sdlc` and `/sdlc-docs` alias skills.
- Remove an old `sdlc-docs:*` npm script **only if its value is still exactly** `npm run docsync:<name>`. A key you changed is reported and kept.
- Make the doctor's `--ci` fail on govkit-only old names (the npm scripts, the runner, the workflow file name). Mentions of `/sdlc` never fail it.
