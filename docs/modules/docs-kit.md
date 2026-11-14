# Module: docs-kit

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail. **Detected:** govkit installs nothing for it. It is on in a repo that has `docs-kit.json` at its root, and does nothing in a repo without one.

[docs-kit](https://github.com/techsilon-oss/docs-kit) is a separate kit. It owns the docs layout, pinned notes (`docs/notes/`), how-tos and generated-doc routing, and it never depends on govkit. This module is the glue for a repo that uses both. govkit builds nothing about docs layout: a wrong finding from `docs-kit check` is fixed in docs-kit.

## What you get
| Where | What it does |
|---|---|
| `/govkit-doctor` | Says docs-kit is configured and which version the repo has, then runs `docs-kit check` and reports the result |
| `/govkit-session status` | Lists the pins still waiting (`pin_status: pinned` under `<docsRoot>/notes/`, oldest first) and the how-tos past their `last_checked` limit (`howtoStaleDays`) |
| `/govkit-session close` | Runs `docs-kit check`, and asks whether anything from the session should be pinned (`/docs-kit-pin`) |

`docsRoot` comes from `docs-kit.json` (default `docs`).

**`docs-kit check` is the repo's own docs-kit**, run as `npx --no-install docs-kit check`. That is code from the repo, so govkit never pre-approves it: the doctor script only reports, and the skills run the check through the normal permission prompt. The pins are listed by a read-only govkit script, `skills/govkit-session/docs-kit.mjs`, which runs nothing.

A docs-kit finding never fails `govkit-doctor --ci`. Put the check in your tests (`docs-kit init --test`) or CI if it should block.

## What it changes outside your repo
Nothing.

## Cost
Nothing. The check takes a second or two.

## Set up
Adopt docs-kit: `/docs-kit-init`, or `npx docs-kit init` (see docs-kit's README). Once `docs-kit.json` is at the repo root, the doctor and the session pick it up. There is nothing to set in `govkit.json`.

## Fix a finding

### "configured (docs-kit.json), but not installed"
`docs-kit.json` is there, but `node_modules/docs-kit` isn't. If `package.json` lists docs-kit, run `npm install`. If it doesn't, add it: `docs-kit init` adds `"docs-kit": "github:techsilon-oss/docs-kit#v<version>"` to `devDependencies`. Without `package.json`, run docs-kit from its plugin (`/docs-kit-pin list`).

### `docs-kit check` fails
The layout rule doesn't hold. Fix it with docs-kit (`/docs-kit-reorg`, `docs-kit move`); its [command reference](https://github.com/techsilon-oss/docs-kit/blob/main/docs/reference/COMMANDS.md) lists each finding. A docs move that trips the doc-sync gate: see [doc-sync → Fix a finding](doc-sync.md#fix-a-finding).

### Waiting pins
A pin waits until it is promoted to its canonical home (a doc, an issue, a decision) or dropped: `/docs-kit-pin promote <file> <target>` or `/docs-kit-pin drop <file> <reason>`.

## Undo
Set `"docs-kit": { "enabled": false, "skippedReason": "<why>" }` under `guardrails` in `govkit.json`: the doctor lists it as skipped, and the session shows nothing about docs-kit. Removing `docs-kit.json` (leaving docs-kit) turns it off too.
