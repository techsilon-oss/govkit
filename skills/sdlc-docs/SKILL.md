---
name: sdlc-docs
description: Renamed to /govkit-docsync in govkit 0.8.0. This alias runs it, and is removed in 0.9.0.
---

# `/sdlc-docs` is now `/govkit-docsync`

govkit renamed this skill in 0.8.0 so it can't clash with a project's own `/sdlc-docs` skill. This alias is removed in 0.9.0.

1. Tell the user, in one line: "`/sdlc-docs` is now `/govkit-docsync` (renamed in govkit 0.8.0; this alias goes in 0.9.0)."
2. Then follow [`../govkit-docsync/SKILL.md`](../govkit-docsync/SKILL.md) exactly, with the same arguments.
3. If the repo still has `scripts/sdlc-docs.mjs` or `sdlc-docs:*` npm scripts, `/govkit-init --upgrade` moves them over.
