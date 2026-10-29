## What and why
<!-- Fixes #<n> -->

## Verification
- [ ] `node --test "tests/*.test.mjs"` passes
- [ ] Behaviour I changed is covered by a test (happy path + one edge case)

## Release PR only
- [ ] Version bumped in `.claude-plugin/plugin.json` and `marketplace.json`, as the last commit
- [ ] `node tools/build-template-history.mjs` re-run after the bump
- [ ] `CHANGELOG.md` entry; if an owned file changed, its row names the file
