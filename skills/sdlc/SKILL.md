---
name: sdlc
description: Renamed to /govkit-session in govkit 0.8.0. This alias runs it, and is removed in 0.9.0.
---

# `/sdlc` is now `/govkit-session`

govkit renamed this skill in 0.8.0 so it can't clash with a project's own `/sdlc` skill. This alias is removed in 0.9.0.

1. Tell the user, in one line: "`/sdlc` is now `/govkit-session` (renamed in govkit 0.8.0; this alias goes in 0.9.0)."
2. Then follow [`../govkit-session/SKILL.md`](../govkit-session/SKILL.md) exactly, with the same argument (`status`, `close`, or a task).
3. If the project's `CLAUDE.md` or docs still say `/sdlc`, point at `/govkit-doctor`, which lists every old name with file and line.
