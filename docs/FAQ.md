# govkit FAQ

Short answers. Each links to the guide that has the detail. Inside Claude Code, `/govkit-help` answers from these docs for the version you have installed.

## Setting up

**Where is `govkit.json`?**
At the root of your repo. `/govkit-init` creates it, and it records which modules are installed, which were skipped and why, your branch names, and the files govkit wrote. See [What it scaffolds](../README.md#what-it-scaffolds).

**What will `/govkit-init` change?**
It shows each module's note before you say yes: what you get, what it changes outside your code, the cost, and how to undo it. It writes files and never commits. See [What it scaffolds](../README.md#what-it-scaffolds).

**Can I skip a module?**
Yes, all but `trackers`: `/govkit-init --skip <module>`, with a reason, which is recorded in `govkit.json`. The doctor then reports it as a decision, not a gap. Each module's guide has an "Undo" section. Start from the [module table](../README.md#what-it-scaffolds).

**Does it work for a non-Node project?**
Mostly. The trackers and branch flow don't care about the language, and the release gate's checks are any shell commands. The scripts need Node to run. See [Language scope](../README.md#language-scope).

## Keeping it current

**Why does the doctor say "outdated"?**
A plugin update doesn't reach the files `/govkit-init` copied into your repo. Run `/govkit-init --upgrade`; it shows each diff and replaces only what you agree to. See [Upgrading](../README.md#upgrading).

**A release renamed something. What do I do?**
Follow its section in [UPGRADING.md](UPGRADING.md). For 0.8.0's rename of `/sdlc` to `/govkit-session`: [0.7 → 0.8](UPGRADING.md#07--08).

## Your own steps

**Can my repo add its own steps to `/govkit-session`?**
Yes, in `.govkit/session.md`, without forking the skill. Nothing in it is used until you trust that exact file, and any edit means trusting it again. See [EXTENDING.md](EXTENDING.md).

**Does govkit run anything from `.govkit/session.md` on its own, for example from the session hook?**
No. Only `/govkit-session` reads it, and only when you invoke the skill and after you've trusted the file. The session hook never looks at it. See [EXTENDING.md → Trust](EXTENDING.md#trust-why-the-file-must-be-approved-first).

**I edited `.govkit/session.md`, and now my steps don't run.**
That's the trust rule. Read the file, then run the `! node … trust` line that `/govkit-session status` gives you. See [EXTENDING.md → Trust](EXTENDING.md#trust-why-the-file-must-be-approved-first).

**Can I see what a repo's steps will do before trusting them?**
Yes: `/govkit-session status` shows the whole file, and `/govkit-doctor` lists every command. See [EXTENDING.md](EXTENDING.md).

**Is "Before commit" a git hook?**
No. It runs only when the agent commits through `/govkit-session`. For enforcement, use a git hook or CI. See [EXTENDING.md → Before commit](EXTENDING.md#before-commit-is-not-a-git-hook).

## Your machine

**What does govkit do on my machine, and what does it send anywhere?**
The session hook reads your trackers and git, and talks only to your repo's own `origin`. It sends no telemetry. See [What govkit does on your machine](../README.md#what-govkit-does-on-your-machine).

**How do I remove govkit?**
`claude plugin uninstall govkit`. The files `/govkit-init` created stay in your repo; each module's guide says how to remove its files. See [What govkit does on your machine](../README.md#what-govkit-does-on-your-machine).

**My self-hosted runner fails the doc-sync workflow.**
Since 0.10.0 the workflow uses `actions/checkout@v7` and `actions/setup-node@v7`, which run on Node 24 and need Actions runner **v2.327.1 or later**. Update the runner. See [the doc-sync guide](modules/doc-sync.md#cost).

## Security

**How do I report a vulnerability?**
On this repo, **Security → Report a vulnerability**, or see the [org SECURITY.md](https://github.com/techsilon-oss/.github/blob/main/SECURITY.md). Not a public issue.
