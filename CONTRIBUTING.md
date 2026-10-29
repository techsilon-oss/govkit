# Contributing to govkit

Thanks for helping. govkit is small, and changes stay small and reviewable.

1. **Open an issue first** for anything beyond a typo, so the change and its reason are agreed before code.
2. **Branch from `main`** and open a PR to `main`. `main` only moves through reviewed PRs.
3. **Conventional commits:** `type(scope): description`, e.g. `fix(docs-sync-check): …`.
4. **Tests with the change.** `npm test` must pass. Fixtures come from the repo's release tags, so clone with tags (the default).
5. **Run `npm run prepare` once** after cloning. It activates the pre-push hook (`git config core.hooksPath skills/govkit-init/templates/githooks`), which blocks direct pushes to `main`. govkit runs its own guardrails: `npm run govkit:doctor`, `npm run docs:sync-check`.
6. **Scripts stay dependency-free:** Node built-ins and `git` only.
7. **Belongs upstream?** The release gate is owned by [release-gate-kit](https://github.com/techsilon-oss/release-gate-kit); fix it there. govkit holds what any project would want; house-specific rules belong in a layer on top.

Releases: see "Releasing govkit itself" in the README. Maintainers only.

Security problems: the repo's **Security → Report a vulnerability**, or [SECURITY.md](https://github.com/techsilon-oss/.github/blob/main/SECURITY.md). Not a public issue.

govkit follows the [techsilon-oss kit standard](https://github.com/techsilon-oss/.github/blob/main/KIT-STANDARD.md).
