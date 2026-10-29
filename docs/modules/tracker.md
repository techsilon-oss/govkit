# Module: tracker

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail. **Opt-in:** off unless you choose it, and `/govkit-doctor` shows "not decided" until you do.

## What you get
Your user stories, bugs and ideas kept as GitHub issues, run the same way every time:
- **Labels:**
  - **type**: `bug`, `enhancement`, `idea`, `docs`, `refactor`. If your repo already has one under a GitHub default name (`documentation` for `docs`), that label is used, no duplicate is created, and the mapping is recorded in `guardrails.tracker.issues.labelAliases`, which the rules and the report follow;
  - **launch category**: exactly one per open issue (see below);
  - **area**: optional, your own;
  - **status and flow**: `in-progress`, `blocked`, `needs-decision`, `fix-shipped`, `business`.
- **Launch categories, your names:** before launch, `pre-launch` / `post-launch` / `idea` / `triage`; after it, `now` / `next` / `later` / `triage`, or any names you choose (`guardrails.tracker.issues.categories`). An open issue without one counts as **to triage**, and that number should be 0: work with no category is invisible work.
- **Themed milestones:** outcomes a non-engineer can read ("Launch Readiness", "Search & Discovery"), never "Phase 1". One-off bugs go in "Maintenance & Bugs".
- **The decision register:** one pinned issue holding everything only an owner can do or decide, in two tables ("Things only an owner can do", "Open decisions") plus a "Decided" history. Agents add `D-###` rows and never invent an owner's answer.
- **A closing format:** `Completed: <what the user gains>` and optionally `Technical: <notes>`. `/govkit-session close` writes it, and the daily report (0.12.0) quotes the `Completed:` line.
- **Optional issue forms:** Bug, User story, Idea.

The rules are in your CLAUDE.md govkit block ("Work tracking"), so every agent session follows them. `/govkit-session` reads the register at the start of a session.

## What it changes outside your repo
On GitHub, each only after you say yes:
- **the labels you're missing.** Existing labels are never changed or removed, whatever their color.
- **one issue, the decision register, pinned.** GitHub allows **3 pinned issues** per repo. If all 3 are taken, govkit tells you, and you choose: unpin one yourself, or leave the register unpinned. **govkit never unpins yours.**

In your repo: `govkit.json` (`guardrails.tracker`), and the issue forms if you choose them.

## Cost
Nothing for issue tracking. The daily status report (0.12.0) will use about 1–2 GitHub Actions minutes a day. **With no mail key, it posts to a GitHub issue and GitHub's notification email delivers it; with a mail-provider key, it sends a designed HTML email.**

## Set up
Run **`/govkit-init tracker`** (a new repo is asked during `/govkit-init`). It shows this module's note, then:
1. asks **"Is your product launched yet?"** and suggests the launch categories (rename them as you like), the launch's name, and optional area labels;
2. lists the labels you're missing, and creates them on your yes;
3. shows the register and creates it on your yes, then records its number in `govkit.json`;
4. checks the pin slots, and pins the register only if one is free and you agree;
5. offers the issue forms. A form sets its type label, but **GitHub issue forms can't set a label from an answer**, so a new issue is "to triage" until someone adds its launch category.

## Fix a finding

### "tracker — not decided"
A notice, not a failure: `--ci` stays green. Run `/govkit-init tracker` and answer. "No" is recorded with a reason (`enabled: false`), and the notice goes away.

### "missing the decision register's issue number"
The tracker is on, but `govkit.json` has no `guardrails.tracker.issues.register`. This one fails `--ci`, because the session and the report read the register. If the register exists, record its number: `node "<plugin>/skills/govkit-init/tracker.mjs" record-register <n>` (or re-run `/govkit-init tracker`). If it doesn't, `/govkit-init tracker` creates it.

### All pinned slots are taken
GitHub pins at most 3 issues. Unpin one yourself (issue page → Unpin), then `gh issue pin <register>`. Or leave the register unpinned: its number is recorded, so the session and the report still find it.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json` (or run `/govkit-init tracker` and answer no). The labels, the register and your issues stay on GitHub; delete them there if you want. Remove the issue forms from `.github/ISSUE_TEMPLATE/` if you added them.
