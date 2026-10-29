# Module: pre-push-hook

The short version is this module's note in [`module.json`](../../module.json). This guide has the detail.

## What you get
A git hook, `.githooks/pre-push`, that refuses a push straight to the release branch and prints the `gh pr create` command to use instead, naming the branch you pushed. On a **private repo under GitHub's Free plan**, a branch protection rule is saved but not enforced, and this hook is the only enforcement there is. Keep it even where server-side protection works: it fails faster, before the network.

`.gitattributes` comes with it. Checked out with CRLF line endings, the hook's first line names an interpreter that doesn't exist, git treats a hook it can't run as no hook, and the protection silently disappears.

## What it changes outside your repo
`git config core.hooksPath .githooks`, in each clone. It's set by `npm run prepare` (which `npm install` runs) or by `.githooks/install-hooks.sh`. Nothing on GitHub.

## Cost
Nothing.

## Set up
`/govkit-init` writes the hook with your release branch in `PROTECTED_BRANCHES`. Then **check it really blocks**, because presence is not proof:
```bash
git config --get core.hooksPath                        # expect: .githooks
NEW=$(git commit-tree "$(git rev-parse main^{tree})" -p main -m probe)
git push --dry-run origin "$NEW:refs/heads/main"       # expect: blocked
```
Don't check with `git push --dry-run dev:main`. If the branches have diverged, git rejects the push before the hook runs, and the clean result reads as a pass.

## Fix a finding

### Missing file
`.githooks/pre-push` or `.gitattributes` is absent. Re-run `/govkit-init`.

### The hook isn't active
The file is there but `git config --get core.hooksPath` doesn't print `.githooks`. Run `npm run prepare`, or `sh .githooks/install-hooks.sh`.

### Outdated
Run `/govkit-init --upgrade`. Your own `PROTECTED_BRANCHES` line is kept.

## Undo
Set `enabled: false` with a `skippedReason` in `govkit.json`, delete `.githooks/`, and run `git config --unset core.hooksPath`.
