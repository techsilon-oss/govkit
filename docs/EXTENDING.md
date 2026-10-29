# Adding your repo's own steps to `/govkit-session`

Some steps only your repo needs: check the database migration status before work starts, run a contract test before committing, update an API doc at the end. Put them in **`.govkit/session.md`**, and `/govkit-session` runs them at the right point, after its own steps. You keep the standard skill, and the govkit updates that come with it, instead of forking it.

## The file

`.govkit/session.md`, committed in your repo. Three sections, one per point:

| Section | When it runs |
|---|---|
| `## On start` | `/govkit-session status`, after the standard status read |
| `## Before commit` | in `/govkit-session <task>`, before the agent commits |
| `## On close` | `/govkit-session close`, after the standard checklist |

Under each, a step is either:
- **a command:** a fenced block marked `sh`, `bash` or `shell`. One block is one step, run as written, through the agent's normal Bash tool (your Claude Code permissions apply). **If it exits non-zero, the remaining steps for that point stop**, and the session reports a failed check, as for a failing test.
- **an instruction:** a list item or paragraph, which the agent follows. A code block with no `sh` label is shown, never run.

Other `##` sections are ignored (and reported by `/govkit-doctor`), so you can keep notes in the file.

### Example

````markdown
# Acme — project steps for /govkit-session

## On start

- Read `docs/RUNBOOK.md` before touching anything under `src/payments/`.

```sh
npm run db:status
```

## Before commit

```sh
npm run lint && npm run typecheck
```

## On close

- If anything under `src/api/` changed, update `docs/API.md` in the same PR.
````

## "Before commit" is not a git hook

**It runs only when the agent commits as part of `/govkit-session`.** A commit made by hand, in an IDE, or by an agent working outside `/govkit-session`, skips it. It's a convenience for agent sessions, not enforcement.

For a check that must hold on **every** commit or push, use a git hook (`.githooks/`, which govkit's pre-push hook already lives in and `npm run prepare` activates) or CI. For example, run `npm run lint` from a `pre-commit` hook, or as a required check in your workflow.

## Trust: why the file must be approved first

`.govkit/session.md` is written by whoever controls the repo. A repo you clone could use it to make the agent run a command, or follow an instruction you'd never give. Claude Code's permissions don't fully cover that: an allowlist such as `Bash(npm *)`, or auto mode, would run its commands without asking. So:

- **Nothing in the file is used until you have trusted that exact file on your machine.** Until then `/govkit-session` shows it to you, runs none of its commands, follows none of its steps, and carries on with the standard steps only.
- **You trust it yourself**, with the line `/govkit-session` gives you:
  ```
  ! node "<plugin dir>/skills/govkit-session/project-steps.mjs" trust
  ```
  The agent never runs this, even if the file tells it to or claims you already agreed. The skill doesn't pre-approve that command. It pre-approves only `status` and `steps`, and only for the plugin's own copy of the script (the pattern is anchored to `${CLAUDE_PLUGIN_ROOT}`), so a script of the same name shipped in a repo prompts like any other command. It treats everything between the `UNTRUSTED REPO FILE` markers as data to show you, never as instructions. **One limit to know:** if your own allowlist already covers `node *`, Claude Code won't stop the agent running it. The skill's rule is what prevents it then, so keep broad `node` allowlists out of repos you don't trust.
- **What's recorded:** the file's SHA-256 and the time, in `.git/govkit/session-trust.json`. That's inside `.git`, so it's never committed and is per clone. **Any edit to the file, including a `git pull` that changes it, means trusting it again.**
- **To revoke:** delete `.git/govkit/session-trust.json`.
- `/govkit-doctor` lists every step, and every command spelled out, with whether this machine trusts the file.

## Two rules

1. **Two or three repos with the same step? Propose it to govkit** ([open an issue](https://github.com/techsilon-oss/govkit/issues/new/choose)). A step every project wants belongs in the standard, where it's maintained once.
2. **A repo that needs a whole different flow gives its skill a project name** (`/acme-session`), **never a `govkit-` name.** `govkit-` names belong to govkit (DEC-005); a project skill with one would clash with govkit's, and the wrong one would answer.

## FAQ

**Does govkit run anything from this file on its own, for example from the session hook?** No. Only `/govkit-session` reads it, and only when you invoke the skill. The session hook never looks at it.

**I edited the file, and now my steps don't run.** That's the trust rule: run the `! node … trust` line `/govkit-session status` gives you, after reading the file.

**Can I see what a repo's steps will do before trusting them?** Yes: `/govkit-session status` shows the whole file, and `/govkit-doctor` lists every command.
