# Module: tracker

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail. **Opt-in:** off unless you choose it, and `/govkit-doctor` shows "not decided" until you do.

## What you get
Your user stories, bugs and ideas kept as GitHub issues, run the same way every time:
- **Labels:**
  - **type**: `bug`, `enhancement`, `idea`, `docs`, `refactor`. If your repo already has one under a GitHub default name (`documentation` for `docs`), that label is used, no duplicate is created, and the mapping is recorded in `guardrails.tracker.issues.labelAliases`, which the rules and the report follow;
  - **launch category**: exactly one per open issue (see below);
  - **area**: optional, your own;
  - **status and flow**: `in-progress`, `blocked`, `needs-decision`, `fix-shipped`, `business`.
- **Launch categories, your names:** before launch, `pre-launch` / `post-launch` / `idea` / `triage`; after it, `now` / `next` / `later` / `triage`, or any names you choose (`guardrails.tracker.issues.categories`). An open issue without one counts as **to triage**, and that number should be 0: work with no category is invisible work. The decision register itself is left out: it isn't planned work.
- **Themed milestones:** outcomes a non-engineer can read ("Launch Readiness", "Search & Discovery"), never "Phase 1". One-off bugs go in "Maintenance & Bugs".
- **The decision register:** one pinned issue holding everything only an owner can do or decide, in two tables ("Things only an owner can do", "Open decisions") plus a "Decided" history. Agents add `D-###` rows and never invent an owner's answer.
- **A closing format:** `Completed: <what the user gains>` and optionally `Technical: <notes>`. `/govkit-session close` writes it, and the daily report quotes the `Completed:` line.
- **Optional issue forms:** Bug, User story, Idea.
- **Optional daily status report** (see [Daily status report](#daily-status-report)): what happened since the last report, delivered to the team by a GitHub Actions workflow.

The rules are in your CLAUDE.md govkit block ("Work tracking"), so every agent session follows them. `/govkit-session` reads the register at the start of a session.

## What it changes outside your repo
On GitHub, each only after you say yes:
- **the labels you're missing.** Existing labels are never changed or removed, whatever their color.
- **one issue, the decision register, pinned.** GitHub allows **3 pinned issues** per repo. If all 3 are taken, govkit tells you, and you choose: unpin one yourself, or leave the register unpinned. **govkit never unpins yours.**
- **with the daily report:** one more issue, "Daily status", pinned under the same 3-slot rule (for `github-issue` delivery), and a comment on it each run. With `resend` delivery, emails through your Resend account.

In your repo: `govkit.json` (`guardrails.tracker`), the issue forms if you choose them, and with the report `scripts/daily-report/report.mjs` and `.github/workflows/govkit-daily-report.yml`.

## Cost
Nothing for issue tracking. The daily status report uses about 1–2 GitHub Actions minutes a run (free on public repos). **No key = GitHub's notification email; a mail-provider key = a designed HTML email.** Resend's free tier covers a daily email to a small team.

## Set up
Run **`/govkit-init tracker`** (a new repo is asked during `/govkit-init`). It shows this module's note, then:
1. asks **"Is your product launched yet?"** and suggests the launch categories (rename them as you like), the launch's name, and optional area labels;
2. lists the labels you're missing, and creates them on your yes;
3. shows the register and creates it on your yes, then records its number in `govkit.json`;
4. checks the pin slots, and pins the register only if one is free and you agree;
5. offers the issue forms. A form sets its type label, but **GitHub issue forms can't set a label from an answer**, so a new issue is "to triage" until someone adds its launch category.

### Daily status report
`/govkit-init tracker` offers it (step 7), or run it later. A workflow, `.github/workflows/govkit-daily-report.yml`, runs `scripts/daily-report/report.mjs` on your schedule. It reports from the last successful run until now (the last 24 hours if there's none, and it says so). Test-mode runs don't count: they delivered nothing. The sections, in order:
- owner actions and the top open decisions, from the register;
- key deliverables (the `Completed:` lines);
- issues closed, plus pull requests merged that closed none of them;
- fixed and waiting for re-test;
- new issues;
- reported bugs (with `reportedLabel`);
- open issues by launch category, with the **to triage** count;
- active milestones;
- code activity.

It reads GitHub's list endpoints only, never the search API (whose low rate limit can fail a report). When something can't be read, the report says "Some numbers are incomplete" or "Could not read …", instead of showing a zero. Issue titles can't notify anyone: a title with `@name` is posted so that it doesn't mention them.

### Delivery options
| `delivery` | You need | You get |
|---|---|---|
| `github-issue` (default) | nothing | a comment on the pinned "Daily status" issue. **Everyone watching that issue** gets it as GitHub's notification email: open the issue → **Subscribe** (or Watch the repo). |
| `resend` | a Resend account and API key | a designed HTML email (neutral, one column, with a plain-text part) to the recipients you list. Optional `brand`: `{ "name", "accentColor": "#0969da", "logoUrl": "https://…" }` |

More providers (SendGrid, Postmark, SMTP, Slack/Teams) can come later, as one function each. Ask in an issue.

### Make the email look designed
1. Create a Resend account at resend.com.
2. **Domain:** without a verified domain, Resend sends **only from `onboarding@resend.dev`, and only to your own (the account owner's) address**. That's fine for a test. To send to a team, add your domain under **Domains** and add the DNS records it shows, then use a from-address on that domain.
3. **API key:** Resend → API Keys → Create, with permission **Sending access** only (not Full access), limited to that domain if you have one.
4. Put it in your repo's Actions secrets. This is the only place it lives:
   ```bash
   gh secret set RESEND_API_KEY --repo <owner>/<repo>
   ```
   (or Settings → Secrets and variables → Actions → New repository secret). The name must match `tracker.report.resend.secret`.
5. Run it once in test mode (below). Only `testRecipient` gets the email.

### The email key
An API key lets the workflow send email through your Resend account. **It lives only in GitHub Actions secrets**, never in a file, `govkit.json` or a commit. govkit never asks you for it and never prints it. If it leaks, delete it in Resend and create a new one. `github-issue` delivery needs no key at all.

### govkit.json fields
`guardrails.tracker.report`, written by `tracker.mjs report`:

| Field | Meaning |
|---|---|
| `enabled` | the report is on |
| `delivery` | `github-issue` or `resend` |
| `issue` | the "Daily status" issue number (github-issue) |
| `schedule` | cron, **UTC**; also written into the workflow (and kept there by `--upgrade`) |
| `branches.work`, `branches.release` | where merged PRs and commits are counted |
| `sections` | which sections, in which order (leave it out for the default list) |
| `reportedLabel` | the label your bug form adds, for the reported-bugs tally (optional) |
| `effortHours` | adds an "Effort (estimate)" section: closed issues × hours (optional; add `"effort"` to `sections`) |
| `skipQuietDays` | `true`: send nothing when the window had no issues closed or opened, no merged PRs and no commits |
| `resend.secret`, `resend.from`, `resend.recipients`, `resend.testRecipient` | resend delivery |
| `brand` | optional name, accent color, logo (resend) |

### Change or add a section
**Remove or reorder:** list the names you want in `sections`. Default: `header`, `owner-actions`, `decisions`, `deliverables`, `completed`, `fix-shipped`, `new`, `bugs`, `open-breakdown`, `milestones`, `code-activity` (plus `effort`).

**Add your own:** create `scripts/daily-report/sections/<name>.mjs` and add `<name>` to `sections`. It receives everything the report gathered. govkit's upgrades never touch this folder. A ready-to-copy example:
```js
// scripts/daily-report/sections/oldest-open.mjs
export default function oldestOpen(data) {
  const oldest = [...data.open].sort((a, b) => new Date(a.created_at) - new Date(b.created_at)).slice(0, 3);
  return {
    title: "Oldest open issues",
    markdown: oldest.length ? oldest.map((i) => `- [#${i.number} ${i.title}](${i.html_url})`).join("\n") : "_None._",
  };
}
```
If a section throws, the report shows "Could not read <name>" instead and still goes out.

### Test mode
Actions → **govkit daily report** → **Run workflow**, with `test_mode` on (the default). github-issue: the report goes to the job summary only, with no comment. resend: it emails `testRecipient` only.

### Quiet days
With `skipQuietDays: true`, a window with no issues closed or opened, no merged PRs and no commits sends nothing. The run still succeeds, and its summary says why. Good for a weekly report or a quiet repo.

### Why did the email come late?
GitHub starts scheduled workflows when it has capacity, which can be hours late at busy times. The report always covers the time since the last successful run, so nothing is skipped or counted twice. Don't promise an exact time.

## Fix a finding

### "tracker — not decided"
A notice, not a failure: `--ci` stays green. Run `/govkit-init tracker` and answer. "No" is recorded with a reason (`enabled: false`), and the notice goes away.

### "missing the decision register's issue number"
The tracker is on, but `govkit.json` has no `guardrails.tracker.issues.register`. This one fails `--ci`, because the session and the report read the register. If the register exists, record its number: `node "<plugin>/skills/govkit-init/tracker.mjs" record-register <n>` (or re-run `/govkit-init tracker`). If it doesn't, `/govkit-init tracker` creates it.

### All pinned slots are taken
GitHub pins at most 3 issues. Unpin one yourself (issue page → Unpin), then `gh issue pin <register>`. Or leave the register unpinned: its number is recorded, so the session and the report still find it.

### "missing the status issue's number" / "missing .github/workflows/govkit-daily-report.yml"
The report is on, but its issue number or files are missing. Re-run `/govkit-init tracker` (the report step), or `node "<plugin>/skills/govkit-init/tracker.mjs" report …` with your settings. That rewrites the two files and the settings.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json` (or run `/govkit-init tracker` and answer no). The labels, the register and your issues stay on GitHub; delete them there if you want. Remove the issue forms from `.github/ISSUE_TEMPLATE/` if you added them. **Report only:** set `report.enabled` to `false` and delete `.github/workflows/govkit-daily-report.yml` and `scripts/daily-report/`. Delete the Resend secret too, if you added one.
