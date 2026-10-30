// Tests for skills/govkit-init/upgrade.mjs. Run from the govkit repo root: npm test.
// Fixtures (throwaway repos at a given release) are in fixtures.mjs.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  OWNED,
  TEMPLATES,
  apply,
  canonical,
  check,
  diff,
  pluginVersion,
  record,
  render,
  saveDiff,
  sha256,
} from "../skills/govkit-init/upgrade.mjs";
import { GOVKIT, git, makeRepoWith, status, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const makeRepo = makeRepoWith(tmp);

// ------------------------------------------------------------------ hashing

test("CRLF and LF copies hash the same", () => {
  const lf = "a\nb\n";
  assert.equal(sha256(lf), sha256(lf.replace(/\n/g, "\r\n")));
});

test("pre-push with a repo's own protected branches still matches the template", () => {
  const tpl = readFileSync(join(TEMPLATES, "githooks/pre-push"), "utf-8");
  const prod = tpl.replace(/^PROTECTED_BRANCHES=.*$/m, 'PROTECTED_BRANCHES="refs/heads/prod refs/heads/release"');
  assert.equal(sha256(prod), sha256(tpl));
  assert.ok(canonical(prod).includes('PROTECTED_BRANCHES=""'));
});

test("the history index covers every current template (rebuild it after a version bump)", () => {
  const hist = JSON.parse(readFileSync(join(GOVKIT, "skills/govkit-init/template-history.json"), "utf-8"));
  assert.ok(hist.$releases.includes(pluginVersion()), `index lacks ${pluginVersion()}: run tools/build-template-history.mjs`);
  for (const e of OWNED) {
    const hash = sha256(readFileSync(join(TEMPLATES, e.template), "utf-8"));
    const hit = (hist[e.path] ?? []).find((h) => h.sha256 === hash);
    assert.ok(hit?.versions.includes(pluginVersion()), `${e.path} not indexed for ${pluginVersion()}`);
  }
});

// ------------------------------------------------------------------ check

test("a fresh scaffold of the current templates is current throughout", () => {
  const { root } = makeRepo();
  const r = check(root);
  // The daily report's files exist only once the report is on (tests/daily-report.test.mjs).
  const conditional = new Set(OWNED.filter((e) => e.when).map((e) => e.path));
  for (const f of r.files) assert.equal(f.status, conditional.has(f.path) ? "skipped" : "current", f.path);
  assert.equal(r.claudeBlock.status, "same");
  assert.equal(r.govkitVersion.derived, pluginVersion());
});

test("a 0.5.0 repo: outdated files named with the releases they match; untouched files current", () => {
  const { root } = makeRepo("v0.5.0");
  const r = check(root);
  const dsc = r.files.find((f) => f.path === "scripts/docs-sync-check.mjs");
  assert.equal(dsc.status, "outdated");
  assert.equal(dsc.matches, "0.5.0");
  assert.equal(status(r, ".githooks/install-hooks.sh"), "current"); // unchanged since 0.2.0
  // 0.5.0 wrote govkitVersion 0.4.0 (a literal in its template); the files say 0.5.0.
  assert.equal(r.govkitVersion.declared, "0.4.0");
  assert.equal(r.govkitVersion.derived, "0.5.0");
});

test("a one-line edit is 'edited'; with a recorded hash, 'edited since govkit wrote it'", () => {
  const { root } = makeRepo();
  const p = join(root, "scripts/govkit-doctor.mjs");
  writeFileSync(p, readFileSync(p, "utf-8").replace("govkit-doctor —", "doctor —"));
  let f = check(root).files.find((x) => x.path === "scripts/govkit-doctor.mjs");
  assert.equal(f.status, "edited");
  assert.equal(f.editedSinceRecorded, false);

  git(root, "checkout", "--", "scripts/govkit-doctor.mjs");
  record(root);
  writeFileSync(p, readFileSync(p, "utf-8").replace("govkit-doctor —", "doctor —"));
  f = check(root).files.find((x) => x.path === "scripts/govkit-doctor.mjs");
  assert.equal(f.editedSinceRecorded, true);
});

test("a skipped guardrail's files are not checked", () => {
  const { root } = makeRepo();
  const p = join(root, "govkit.json");
  const m = JSON.parse(readFileSync(p, "utf-8"));
  m.guardrails["supabase-account"].enabled = false;
  writeFileSync(p, JSON.stringify(m, null, 2));
  assert.equal(status(check(root), "scripts/supabase.mjs"), "skipped");
});

// ------------------------------------------------------------------ record

test("record on an old repo: files map from hashes, govkitVersion corrected, formatting kept", () => {
  const { root } = makeRepo("v0.5.0");
  const before = readFileSync(join(root, "govkit.json"), "utf-8");
  const r = record(root);
  const after = readFileSync(join(root, "govkit.json"), "utf-8");
  const m = JSON.parse(after);
  assert.equal(m.govkitVersion, "0.5.0");
  assert.equal(m.files["scripts/docs-sync-check.mjs"].version, "0.5.0");
  assert.match(m.files["scripts/docs-sync-check.mjs"].sha256, /^[0-9a-f]{64}$/);
  assert.equal(r.manifestReformatted, false);
  // In place: everything above the version line is byte-identical (blank lines included).
  const head = (t) => t.slice(0, t.indexOf('"govkitVersion"'));
  assert.equal(head(after), head(before));
});

test("a govkit.json that cannot be edited in place is rewritten, and the report says so", () => {
  const { root } = makeRepo();
  const m = JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));
  delete m.govkitVersion; // nothing to edit in place, but record wants to set it
  writeFileSync(join(root, "govkit.json"), JSON.stringify(m));
  const r = record(root);
  assert.equal(r.manifestReformatted, true);
  assert.equal(JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8")).govkitVersion, pluginVersion());
});

// ------------------------------------------------------------------ apply

test("apply replaces only the named file, keeps the exec bit, and records it", () => {
  const { root } = makeRepo("v0.5.0");
  const supabaseBefore = readFileSync(join(root, "scripts/supabase.mjs"), "utf-8");
  // On disk too: where git tracks file modes (Linux, macOS), an index-only +x reads as a
  // modified file, and apply rightly refuses the dirty tree.
  chmodSync(join(root, ".githooks/pre-push"), 0o755);
  git(root, "update-index", "--chmod=+x", ".githooks/pre-push");
  git(root, "commit", "-qm", "exec");

  const r = apply(["scripts/docs-sync-check.mjs", ".githooks/pre-push"], root);
  assert.equal(status(r, "scripts/docs-sync-check.mjs"), "current");
  assert.equal(readFileSync(join(root, "scripts/supabase.mjs"), "utf-8"), supabaseBefore);
  assert.equal(status(r, "scripts/supabase.mjs"), "outdated");
  assert.match(git(root, "ls-files", "-s", ".githooks/pre-push"), /^100755 /);
  const m = JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));
  assert.equal(m.files["scripts/docs-sync-check.mjs"].version, pluginVersion());
  // The repo's own PROTECTED_BRANCHES line survives a pre-push upgrade.
  assert.match(readFileSync(join(root, ".githooks/pre-push"), "utf-8"), /^PROTECTED_BRANCHES="refs\/heads\/main"$/m);
});

test("apply refuses a file govkit does not own", () => {
  const { root } = makeRepo();
  assert.throws(() => apply(["docs/PROJECT-HUB.md"], root), /not a file govkit owns/);
});

test("apply refuses on a dirty tree and changes nothing; check still runs", () => {
  const { root } = makeRepo("v0.5.0");
  writeFileSync(join(root, "notes.txt"), "work in progress\n");
  const before = readFileSync(join(root, "scripts/docs-sync-check.mjs"), "utf-8");
  assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), /uncommitted changes[\s\S]*reviewable, revertable/);
  assert.equal(readFileSync(join(root, "scripts/docs-sync-check.mjs"), "utf-8"), before);
  assert.equal(status(check(root), "scripts/docs-sync-check.mjs"), "outdated");
});

test("apply refuses outside a git repo", () => {
  const root = tmp("govkit-nogit-");
  assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), /not a git repository/);
});

// ------------------------------------------------------------------ diffs kept after a "no"

test("save-diff keeps an edited file's diff in .git/govkit/, and it applies with git apply", () => {
  const { root } = makeRepo();
  const p = join(root, "scripts/govkit-doctor.mjs");
  writeFileSync(p, readFileSync(p, "utf-8").replace("govkit-doctor —", "doctor —"));
  const out = saveDiff("scripts/govkit-doctor.mjs", root);
  assert.equal(out, join(git(root, "rev-parse", "--absolute-git-dir"), "govkit", "upgrade-scripts-govkit-doctor.mjs.diff"));
  const text = readFileSync(out, "utf-8");
  assert.match(text, /^--- a\/scripts\/govkit-doctor\.mjs$/m);
  assert.match(text, /^\+\+\+ b\/scripts\/govkit-doctor\.mjs$/m);
  git(root, "apply", "--check", out);
  // Inside .git: the saved diff never dirties the tree.
  assert.equal(git(root, "status", "--porcelain", "--untracked-files=all", ".git"), "");
});

test("save-diff for the CLAUDE.md block covers the whole file, so it applies too", () => {
  const { root } = makeRepo();
  const p = join(root, "CLAUDE.md");
  writeFileSync(p, readFileSync(p, "utf-8").replace("all new code lands here first", "code lands here"));
  assert.equal(check(root).claudeBlock.status, "differs");
  const out = saveDiff("CLAUDE.md", root);
  assert.ok(out.endsWith("upgrade-CLAUDE.md.diff"));
  git(root, "apply", "--check", out);
  // The project's own text outside the block is context, never a change.
  assert.ok(!/^[-+]Our own notes/m.test(readFileSync(out, "utf-8")));
});

test("save-diff writes nothing when the file already matches", () => {
  const { root } = makeRepo();
  assert.equal(saveDiff("scripts/govkit-doctor.mjs", root), null);
  assert.equal(diff("scripts/govkit-doctor.mjs", root), "");
  assert.ok(!existsSync(join(root, ".git", "govkit", "upgrade-scripts-govkit-doctor.mjs.diff")));
});

// ------------------------------------------------------------------ CLAUDE.md block

test("the CLAUDE.md block renders from values read back from an old block", () => {
  const { root } = makeRepo("v0.5.0"); // 0.5.0's govkit.json has no `project`
  // Unedited, it matches 0.5.0's block rendered with the values read back from it: outdated,
  // not edited. The diff to today's block holds template changes only (the skill rename, the
  // tracker's "Work tracking" section); the values read back from the block are not in it.
  const block = check(root).claudeBlock;
  assert.equal(block.status, "outdated");
  assert.ok(block.versions.includes("0.5.0"));
  const lines = diff("CLAUDE.md", root).split("\n");
  const changed = lines.filter((l) => /^[-+](?![-+]{2} )/.test(l));
  assert.ok(lines.some((l) => /^-.*\/sdlc\b/.test(l)) && lines.some((l) => /^\+.*\/govkit-session/.test(l)), "the rename is in it");
  assert.ok(!changed.some((l) => /Acme|Vercel/.test(l)), "rendered values must not show as changes");
});

test("render keeps a pre-push's custom branch list", () => {
  const { root, manifest } = makeRepo();
  const p = join(root, ".githooks/pre-push");
  writeFileSync(p, readFileSync(p, "utf-8").replace(/^PROTECTED_BRANCHES=.*$/m, 'PROTECTED_BRANCHES="refs/heads/main refs/heads/prod"'));
  const entry = OWNED.find((e) => e.path === ".githooks/pre-push");
  assert.match(render(entry, root, manifest), /refs\/heads\/main refs\/heads\/prod/);
});

// ------------------------------------------------------------------ govkit.json `paths`

const setManifest = (root, edit) => {
  const p = join(root, "govkit.json");
  const m = JSON.parse(readFileSync(p, "utf-8"));
  edit(m);
  writeFileSync(p, `${JSON.stringify(m, null, 2)}\n`);
};

const runDoctor = (cwd) => {
  try {
    execFileSync("node", [join(TEMPLATES, "scripts/govkit-doctor.mjs"), "--ci"], { cwd, encoding: "utf-8", stdio: "pipe" });
    return { code: 0 };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) };
  }
};

test("an owned file relocated by `paths` is checked where it is, not reported missing", () => {
  const { root } = makeRepo();
  mkdirSync(join(root, "vendor"), { recursive: true });
  git(root, "mv", "scripts/docs-sync-check.mjs", "vendor/dsc.mjs");
  setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": "vendor/dsc.mjs" }));
  const f = check(root).files.find((x) => x.path === "scripts/docs-sync-check.mjs");
  assert.equal(f.status, "current");
  assert.equal(f.at, "vendor/dsc.mjs");
  // An edit at the relocated path is seen there, and diffs name that path.
  writeFileSync(join(root, "vendor/dsc.mjs"), "// edited\n");
  assert.equal(status(check(root), "scripts/docs-sync-check.mjs"), "edited");
  assert.match(diff("scripts/docs-sync-check.mjs", root), /^--- a\/vendor\/dsc\.mjs$/m);
});

test("the doctor resolves `expects` through `paths`", () => {
  const { root } = makeRepo();
  setManifest(root, (m) => {
    // Only the guardrail under test; the doctor's job here is the path lookup.
    for (const [name, g] of Object.entries(m.guardrails)) {
      if (name !== "docs-sync-check") g.enabled = false;
      delete g.expectsScripts;
    }
  });
  const before = runDoctor(root);
  assert.equal(before.code, 0, before.out);
  mkdirSync(join(root, "vendor"), { recursive: true });
  git(root, "mv", "scripts/docs-sync-check.mjs", "vendor/dsc.mjs");
  assert.equal(runDoctor(root).code, 1, "moved without `paths`: missing");
  setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": "vendor/dsc.mjs" }));
  assert.equal(runDoctor(root).code, 0, "moved with `paths`: found");
});

// ------------------------------------------------------------------ Prettier detection (#22)

for (const file of ["prettier.config.mjs", "prettier.config.ts", ".prettierrc.toml", ".prettierrc.json5", ".prettierrc"]) {
  test(`Prettier is detected from ${file} alone`, () => {
    const { root } = makeRepo();
    writeFileSync(join(root, file), "");
    assert.equal(check(root).prettier, true);
  });
}

test("no Prettier config, key or dependency: not detected", () => {
  const { root } = makeRepo();
  assert.equal(check(root).prettier, false);
});

// ------------------------------------------------------------------ govkit itself (DEC-003)

test("govkit's own repo: every owned file current where it runs, nothing missing or edited", () => {
  const r = check(GOVKIT);
  for (const f of r.files) assert.ok(["current", "skipped"].includes(f.status), `${f.path}: ${f.status}`);
  assert.equal(r.files.filter((f) => f.status === "current").length >= 6, true);
});

test("govkit's own repo: the doctor reports nothing missing", () => {
  const r = runDoctor(GOVKIT);
  assert.equal(r.code, 0, r.out);
});

// ------------------------------------------------------------------ `paths` stays inside the repo

/** A repo plus an empty sibling directory outside it: the target an escaping `paths` would hit. */
function repoWithOutside() {
  const { root } = makeRepo();
  const outside = tmp("govkit-outside-");
  return { root, outside };
}

const commitManifest = (root) => {
  git(root, "add", "govkit.json");
  // --allow-empty: on POSIX two of the cases below are the same string, so nothing changes.
  git(root, "commit", "-qm", "paths", "--allow-empty");
};

const escapes = (outside) => [
  ["climbs out with ..", `../${outside.split(/[\\/]/).pop()}/dsc.mjs`, /points outside the repo/],
  ["climbs out midway", "scripts/../../x/dsc.mjs", /points outside the repo/],
  // Every escaping value targets `outside`, a throwaway temp dir, so even a broken guard cannot
  // write anywhere that matters.
  ["absolute (forward slashes)", `${outside.replace(/\\/g, "/")}/dsc.mjs`, /is absolute/],
  ["absolute (this OS)", join(outside, "dsc.mjs"), /is absolute/],
  // On Linux a drive path is a plain relative name; it is refused as absolute on every OS.
  ["absolute (Windows drive)", String.raw`C:\govkit-outside\dsc.mjs`, /is absolute/],
  ["the repo root", ".", /is the repo root/],
  ["empty", "", /not a relative path/],
];

test("apply, check, diff and the doctor refuse a `paths` value outside the repo, and write nothing", () => {
  const { root, outside } = repoWithOutside();
  for (const [what, value, why] of escapes(outside)) {
    setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": value }));
    commitManifest(root);
    assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), why, what);
    assert.throws(() => check(root), why, what);
    assert.throws(() => diff("scripts/docs-sync-check.mjs", root), why, what);
    assert.deepEqual(readdirSync(outside), [], `${what}: nothing written outside`);

    setManifest(root, (m) => {
      for (const [name, g] of Object.entries(m.guardrails)) {
        if (name !== "docs-sync-check") g.enabled = false;
        delete g.expectsScripts;
      }
    });
    const doc = runDoctor(root);
    assert.equal(doc.code, 1, what);
    assert.match(doc.out, /\(refused\)/, what);
    git(root, "checkout", "--", "govkit.json");
  }
});

test("a `paths` value that leaves the repo through a symlinked directory is refused", () => {
  const { root, outside } = repoWithOutside();
  // A junction needs no privileges on Windows; elsewhere the type is ignored.
  symlinkSync(outside, join(root, "vendor"), "junction");
  // Untracked but ignored, so the tree stays clean (git cannot commit a Windows junction).
  writeFileSync(join(root, ".git", "info", "exclude"), "vendor\n");
  setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": "vendor/dsc.mjs" }));
  commitManifest(root);
  assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), /outside the repo through a symlink/);
  assert.deepEqual(readdirSync(outside), []);
});

test("one refused path stops the whole apply before anything is written", () => {
  const { root, outside } = repoWithOutside();
  const pathsBefore = readFileSync(join(root, "scripts/supabase.mjs"), "utf-8");
  writeFileSync(join(root, "scripts/supabase.mjs"), "// old\n");
  setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": `../${outside.split(/[\\/]/).pop()}/escape.mjs` }));
  git(root, "add", "-A");
  git(root, "commit", "-qm", "old supabase + bad path");
  assert.throws(() => apply(["scripts/supabase.mjs", "scripts/docs-sync-check.mjs"], root), /points outside/);
  assert.equal(readFileSync(join(root, "scripts/supabase.mjs"), "utf-8"), "// old\n", "first file untouched");
  assert.notEqual(pathsBefore, "// old\n");
  assert.deepEqual(readdirSync(outside), []);
});

// ------------------------------------------------------------------ owned files are regular files

/**
 * Replace an owned file with a file symlink. File symlinks need a privilege on Windows (Developer
 * Mode or admin); without it the test skips there, and still runs in CI on Linux.
 */
function linkFile(t, target, at) {
  rmSync(at);
  try {
    symlinkSync(target, at, "file");
    return true;
  } catch (e) {
    if (e.code === "EPERM") {
      t.skip("creating a file symlink needs a privilege on this machine");
      return false;
    }
    throw e;
  }
}

test("no `paths`: an owned file that is a symlink to a file outside the repo is not written through", (t) => {
  const { root, outside } = repoWithOutside();
  const victim = join(outside, "victim.mjs");
  writeFileSync(victim, "// not yours\n");
  if (!linkFile(t, victim, join(root, "scripts/docs-sync-check.mjs"))) return;
  assert.throws(
    () => apply(["scripts/docs-sync-check.mjs"], root),
    /scripts\/docs-sync-check\.mjs is a symlink; govkit writes only regular files/,
  );
  assert.equal(readFileSync(victim, "utf-8"), "// not yours\n");
  const f = check(root).files.find((x) => x.path === "scripts/docs-sync-check.mjs");
  assert.equal(f.status, "symlink");
});

test("no `paths`: a dangling symlink is refused too, and its target is not created", (t) => {
  const { root, outside } = repoWithOutside();
  const target = join(outside, "not-there-yet.mjs");
  if (!linkFile(t, target, join(root, "scripts/docs-sync-check.mjs"))) return;
  assert.equal(existsSync(join(root, "scripts/docs-sync-check.mjs")), false, "dangling: exists() says absent");
  assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), /is a symlink/);
  assert.equal(existsSync(target), false);
  assert.equal(status(check(root), "scripts/docs-sync-check.mjs"), "symlink");
});

test("no `paths`: an owned file's directory that is a symlink out of the repo is refused", () => {
  const { root, outside } = repoWithOutside();
  rmSync(join(root, ".githooks"), { recursive: true });
  symlinkSync(outside, join(root, ".githooks"), "junction");
  assert.throws(() => apply([".githooks/pre-push"], root), /\.githooks is a symlink/);
  assert.deepEqual(readdirSync(outside), []);
  assert.equal(status(check(root), ".githooks/pre-push"), "symlink");
});

test("with `paths`: a relocated owned file that is a symlink is refused the same way", (t) => {
  const { root, outside } = repoWithOutside();
  mkdirSync(join(root, "vendor"));
  writeFileSync(join(root, "vendor/dsc.mjs"), "");
  setManifest(root, (m) => (m.paths = { "scripts/docs-sync-check.mjs": "vendor/dsc.mjs" }));
  const victim = join(outside, "victim.mjs");
  writeFileSync(victim, "// not yours\n");
  if (!linkFile(t, victim, join(root, "vendor/dsc.mjs"))) return;
  // Either guard may name it first: the link leaves the repo, and it is a link.
  assert.throws(() => apply(["scripts/docs-sync-check.mjs"], root), /vendor\/dsc\.mjs is a symlink|through a symlink/);
  assert.equal(readFileSync(victim, "utf-8"), "// not yours\n");
});
