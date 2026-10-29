# Contributing to govkit

Thanks for helping. govkit is small, and changes stay small and reviewable.

1. **Open an issue first** for anything beyond a typo, so the change and its reason are agreed before code.
2. **Branch from `main`** and open a PR to `main`. `main` only moves through reviewed PRs.
3. **Conventional commits:** `type(scope): description`, e.g. `fix(docs-sync-check): …`.
4. **Tests with the change.** `node --test "tests/*.test.mjs"` must pass. Fixtures come from the repo's release tags, so clone with tags (the default).
5. **Scripts stay dependency-free:** Node built-ins and `git` only.
6. **Belongs upstream?** The release gate is owned by [release-gate-kit](https://github.com/techsilon-oss/release-gate-kit); fix it there. govkit holds what any project would want; house-specific rules belong in a layer on top.

Releases: see "Releasing govkit itself" in the README. Maintainers only.

Security problems: see [SECURITY.md](SECURITY.md), not a public issue.
