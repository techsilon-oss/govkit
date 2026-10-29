---
name: govkit-help
description: Answer a question about govkit from the docs that ship with the installed version — what a module does, how to set it up or undo it, what a doctor finding means, how to upgrade. Read-only; runs nothing. Use for "how do I…", "what does … do", "why does the doctor say…" about govkit.
argument-hint: "<your question>"
allowed-tools: Read Grep Glob
---

# /govkit-help: answers from govkit's own docs

Answer the user's question about govkit **only from the docs that ship in this plugin**, for the version they have installed. Those docs describe exactly what they're running; the web, or your memory of govkit, may describe another version.

**This skill reads; it never runs anything.** No Bash, no edits, no network. If the answer is "run X", tell the user to run it, or point at the skill that does (`/govkit-init`, `/govkit-doctor`, `/govkit-session`).

## Steps

1. **The version:** read `${CLAUDE_PLUGIN_ROOT}/.claude-plugin/plugin.json` → `version`. Say it in the answer ("in govkit 0.10.0, …").
2. **Find the answer**, in this order, all under `${CLAUDE_PLUGIN_ROOT}`:
   - `docs/FAQ.md` (short answers, each pointing at its guide);
   - `module.json` and `docs/modules/<module>.md`, for anything about a module (what it does, cost, set up, *Fix a finding*, undo);
   - `docs/UPGRADING.md` (renames and breaking changes), `docs/EXTENDING.md` (a repo's own steps and trust);
   - `README.md` (install, upgrade, what govkit does on your machine), then `CHANGELOG.md` (what changed when).

   Use Grep to search them, and Read to read the section you found. **Only these files.** `docs/PROJECT-HUB.md`, `CLAUDE.md`, `docs/archive/` and `tests/` describe govkit's own development, not the user's repo: never answer from them.
3. **Answer briefly, and cite** the file and section, as a link pinned to the installed version: `https://github.com/techsilon-oss/govkit/blob/v<version>/<path>#<anchor>`. **Use an anchor only for a heading you actually read in that file** (lower case, punctuation dropped, spaces as hyphens). If you're not sure of a heading, link the file without an anchor: a wrong anchor sends the user to the top of the page with nothing to tell them it missed.
4. **If the docs don't answer it, say so.** Don't guess or fill in from elsewhere. Point at https://github.com/techsilon-oss/govkit/issues, and suggest opening one if it's a gap.

## What this is not
- Not the doctor: for "what's wrong in my repo", that's `/govkit-doctor`, which inspects the repo. This skill explains what a finding means and how to fix it.
- Not a source of facts about the user's repo: it reads govkit's docs, never the repo's files.
