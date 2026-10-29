// Tests for tools/check-release.mjs. Each test builds a throwaway repo with an `origin` remote, so
// "the version on origin/main" and its tag are real git state.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { checkRelease } from "../tools/check-release.mjs";

const dirs = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop(), { recursive: true, force: true });
});

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

function writeRelease(root, version, { market = version, changelog = version, history = version, own = version } = {}) {
  mkdirSync(join(root, ".claude-plugin"), { recursive: true });
  mkdirSync(join(root, "skills/govkit-init"), { recursive: true });
  writeFileSync(join(root, ".claude-plugin/plugin.json"), JSON.stringify({ name: "govkit", version }));
  writeFileSync(
    join(root, ".claude-plugin/marketplace.json"),
    JSON.stringify({ plugins: [{ name: "govkit", version: market }] }),
  );
  writeFileSync(join(root, "CHANGELOG.md"), changelog ? `# Changelog\n\n## [${changelog}] - 2026-10-29\n` : "# Changelog\n");
  writeFileSync(join(root, "skills/govkit-init/template-history.json"), JSON.stringify({ $releases: [history] }));
  writeFileSync(join(root, "govkit.json"), JSON.stringify({ govkitVersion: own }));
}

/** A repo whose origin/main is at `mainVersion`, optionally tagged, checked out on a PR branch. */
function makeRepo(mainVersion, { tagged = true } = {}) {
  const base = mkdtempSync(join(tmpdir(), "govkit-release-"));
  dirs.push(base);
  const origin = join(base, "origin.git");
  const root = join(base, "work");
  git(base, "init", "-q", "--bare", "-b", "main", origin);
  git(base, "init", "-q", "-b", "main", root);
  git(root, "config", "core.autocrlf", "false");
  git(root, "remote", "add", "origin", origin);
  writeRelease(root, mainVersion);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "release");
  if (tagged) git(root, "tag", "-a", `v${mainVersion}`, "-m", "release");
  git(root, "push", "-q", "origin", "main", "--tags");
  git(root, "fetch", "-q", "origin");
  git(root, "checkout", "-q", "-b", "pr");
  return root;
}

test("a consistent release passes", () => {
  const root = makeRepo("0.6.1");
  assert.deepEqual(checkRelease(root), []);
  assert.deepEqual(checkRelease(root, { pr: true }), []);
});

test("marketplace.json disagreeing with plugin.json fails", () => {
  const root = makeRepo("0.6.1");
  writeRelease(root, "0.7.0", { market: "0.6.1" });
  assert.match(checkRelease(root).join("\n"), /marketplace\.json lists govkit at 0\.6\.1/);
});

test("a version with no CHANGELOG entry fails", () => {
  const root = makeRepo("0.6.1");
  writeRelease(root, "0.7.0", { changelog: null });
  assert.match(checkRelease(root).join("\n"), /no "## \[0\.7\.0\]" entry/);
});

test("template history and govkit.json must know the version", () => {
  const root = makeRepo("0.6.1");
  writeRelease(root, "0.7.0", { history: "0.6.1", own: "0.6.1" });
  const out = checkRelease(root).join("\n");
  assert.match(out, /template-history\.json does not know 0\.7\.0/);
  assert.match(out, /govkitVersion 0\.6\.1/);
});

test("--pr: main's version without its tag fails, and says how to tag it", () => {
  const root = makeRepo("0.6.1", { tagged: false });
  assert.deepEqual(checkRelease(root), [], "without --pr the tag is not checked (the push to main)");
  assert.match(checkRelease(root, { pr: true }).join("\n"), /0\.6\.1 but v0\.6\.1 does not exist/);
});

test("--pr: a bump passes; lowering the version fails", () => {
  const root = makeRepo("0.6.1");
  writeRelease(root, "0.7.0");
  assert.deepEqual(checkRelease(root, { pr: true }), []);
  writeRelease(root, "0.6.0");
  assert.match(checkRelease(root, { pr: true }).join("\n"), /lowers the version: 0\.6\.1 .* 0\.6\.0/);
});

test("a version that is not plain X.Y.Z fails on its own", () => {
  const root = makeRepo("0.6.1");
  writeRelease(root, "0.7.0-beta");
  assert.deepEqual(checkRelease(root), ['.claude-plugin/plugin.json version "0.7.0-beta" is not plain X.Y.Z']);
});
