#!/bin/sh
#
# Activate the committed hooks in .githooks/ for this clone.
#
# Language-agnostic installer — works for any repo (Python, Go, Rust, docs-only,
# …), no Node required. JS projects can instead add to package.json:
#     "scripts": { "prepare": "git config core.hooksPath .githooks || true" }
# which runs automatically on `pnpm install` / `npm install`.
#
# Run once per fresh clone (or wire into your setup task: `make setup`, etc.):
#     sh .githooks/install-hooks.sh

set -e

# Resolve the repo root so this works from any CWD.
root=$(git rev-parse --show-toplevel 2>/dev/null) || {
	echo "Not inside a git work tree — nothing to do." >&2
	exit 0
}

git -C "$root" config core.hooksPath .githooks
echo "✓ core.hooksPath → .githooks (hooks active for this clone)"
