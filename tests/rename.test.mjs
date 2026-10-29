// Tests for 0.8.0: the /sdlc -> /govkit-session rename as --upgrade carries it (#12), dated
// trackers and the bootstrapDocs offer (#26), the pre-push suggestion (#27), and the doctor's
// old-name scan. Fixtures are in fixtures.mjs; "v0.7.0" is a repo initialised by the last release
// before the rename.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  SCRIPT_RENAMES,
  TEMPLATES,
  aliasFor,
  apply,
  check,
  packagePlan,
  record,
  saveDiff,
} from "../skills/govkit-init/upgrade.mjs";
import { GOVKIT, fill, git, makeRepoWith, status, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const makeRepo = makeRepoWith(tmp);

const RUNNER = "scripts/govkit-docsync.mjs";
const WORKFLOW = ".github/workflows/govkit-docsync.yml";
const BOOTSTRAP = "govkit.json#bootstrapDocs";
const read = (root, p) => readFileSync(join(root, p), "utf-8");
const json = (root, p) => JSON.parse(read(root, p));
const commit = (root, msg = "change") => {
  git(root, "add", "-A");
  git(root, "commit", "-qm", msg, "--allow-empty");
};

// ------------------------------------------------------------------ the rename, end to end

test("a 0.7.0 repo: both renames pending, matched to their release, with the package.json plan", () => {
  const { root } = makeRepo("v0.7.0");
  const r = check(root);
  const runner = r.files.find((f) => f.path === RUNNER);
  assert.equal(runner.status, "rename");
  assert.equal(runner.from, "scripts/sdlc-docs.mjs");
  assert.ok(runner.versions.includes("0.7.0"));
  assert.equal(status(r, WORKFLOW), "rename");
  assert.equal(r.packageJson.status, "migrate");
  assert.deepEqual(
    r.packageJson.changes.map((c) => c.key),
    ["docsync:audit", "sdlc-docs:audit", "docsync:gate", "sdlc-docs:gate", "docsync:report", "sdlc-docs:report"],
  );
});

test("apply moves both files, migrates package.json and govkit.json, and a second check is clean", () => {
  const { root } = makeRepo("v0.7.0");
  const pkgBefore = read(root, "package.json");
  apply([RUNNER, WORKFLOW], root);

  assert.ok(existsSync(join(root, RUNNER)));
  assert.ok(existsSync(join(root, WORKFLOW)));
  assert.ok(!existsSync(join(root, "scripts/sdlc-docs.mjs")), "old runner deleted");
  assert.ok(!existsSync(join(root, ".github/workflows/sdlc-docs.yml")), "old workflow deleted");
  // The check name survives the move: a repo requiring it is not left waiting.
  assert.match(read(root, WORKFLOW), /name: Doc-sync \(/);

  const scripts = json(root, "package.json").scripts;
  for (const [oldKey, newKey] of Object.entries(SCRIPT_RENAMES)) {
    assert.equal(scripts[oldKey], aliasFor(newKey), `${oldKey} is the exact alias`);
    assert.match(scripts[newKey], /node scripts\/govkit-docsync\.mjs /);
  }
  assert.equal(scripts["release-gate"], JSON.parse(pkgBefore).scripts["release-gate"], "other scripts untouched");
  // Line-level edit: the file kept its own layout (each changed key still on its own line).
  assert.equal(read(root, "package.json").split("\n").length, pkgBefore.split("\n").length + 3);

  const docSync = json(root, "govkit.json").guardrails["doc-sync"];
  assert.ok(docSync.expects.includes(RUNNER) && docSync.expects.includes(WORKFLOW));
  assert.ok(!docSync.expects.some((p) => p.includes("sdlc-docs")));
  assert.deepEqual(docSync.expectsScripts, ["docsync:audit", "docsync:gate"]);

  const after = check(root);
  assert.equal(status(after, RUNNER), "current");
  assert.equal(status(after, WORKFLOW), "current");
  assert.equal(after.packageJson.status, "current");
});

test("an edited old file is not moved or deleted: refused, reported, its diff saved", () => {
  const { root } = makeRepo("v0.7.0");
  writeFileSync(join(root, "scripts/sdlc-docs.mjs"), `${read(root, "scripts/sdlc-docs.mjs")}// ours\n`);
  commit(root);
  const f = check(root).files.find((x) => x.path === RUNNER);
  assert.equal(f.status, "rename-edited");
  const pkgBefore = read(root, "package.json");
  assert.throws(() => apply([RUNNER], root), /scripts\/sdlc-docs\.mjs is edited .* not moved or deleted/);
  assert.ok(existsSync(join(root, "scripts/sdlc-docs.mjs")));
  assert.ok(!existsSync(join(root, RUNNER)));
  assert.equal(read(root, "package.json"), pkgBefore);
  const saved = saveDiff(RUNNER, root);
  assert.match(read(root, saved.slice(root.length + 1)), /^--- a\/scripts\/sdlc-docs\.mjs$/m);
  assert.match(read(root, saved.slice(root.length + 1)), /^\+\+\+ b\/scripts\/govkit-docsync\.mjs$/m);
});

test("old and new both present: the new is checked, the old is reported as left behind", () => {
  const { root } = makeRepo("v0.7.0");
  apply([RUNNER], root);
  commit(root, "upgrade");
  writeFileSync(join(root, "scripts/sdlc-docs.mjs"), "// left behind\n");
  const f = check(root).files.find((x) => x.path === RUNNER);
  assert.equal(f.status, "current");
  assert.equal(f.oldStillPresent, "scripts/sdlc-docs.mjs");
});

test("package.json: only values that run the old runner change; a user's own scripts are kept", () => {
  const { root } = makeRepo("v0.7.0");
  const pkg = json(root, "package.json");
  pkg.scripts["sdlc-docs:report"] = "echo my own report"; // changed by the user: not the runner
  pkg.scripts["lint:docs"] = "node scripts/sdlc-docs.mjs audit --gate && echo ok";
  pkg.scripts["test"] = "node --test";
  writeFileSync(join(root, "package.json"), `${JSON.stringify(pkg, null, 2)}\n`);
  commit(root);
  const plan = packagePlan(root);
  assert.equal(plan.status, "migrate");
  const after = JSON.parse(plan.text).scripts;
  assert.equal(after["lint:docs"], "node scripts/govkit-docsync.mjs audit --gate && echo ok");
  assert.equal(after["sdlc-docs:report"], "echo my own report", "a key the user changed is kept");
  assert.equal(after["docsync:report"], undefined, "and not duplicated");
  assert.equal(after.test, "node --test");
});

test("package.json not laid out one script per line: the rename is refused, nothing written", () => {
  const { root } = makeRepo("v0.7.0");
  writeFileSync(join(root, "package.json"), JSON.stringify(json(root, "package.json")));
  commit(root);
  assert.equal(packagePlan(root).status, "manual");
  assert.throws(() => apply([RUNNER], root), /point them at scripts\/govkit-docsync\.mjs by hand/i);
  assert.ok(existsSync(join(root, "scripts/sdlc-docs.mjs")));
  assert.ok(!existsSync(join(root, RUNNER)));
});

test("a dirty tree: the rename does nothing, package.json included", () => {
  const { root } = makeRepo("v0.7.0");
  writeFileSync(join(root, "notes.txt"), "wip\n");
  const pkgBefore = read(root, "package.json");
  assert.throws(() => apply([RUNNER], root), /uncommitted changes/);
  assert.equal(read(root, "package.json"), pkgBefore);
  assert.ok(existsSync(join(root, "scripts/sdlc-docs.mjs")));
});

// ------------------------------------------------------------------ govkit.json / package.json are regular files

function linkFile(t, target, at) {
  rmSync(at);
  try {
    symlinkSync(target, at, "file");
    return true;
  } catch (e) {
    if (e.code !== "EPERM") throw e;
    t.skip("creating a file symlink needs a privilege on this machine");
    return false;
  }
}

test("writeManifest refuses a govkit.json that is a symlink", (t) => {
  const { root } = makeRepo();
  const outside = tmp("govkit-outside-");
  writeFileSync(join(outside, "govkit.json"), read(root, "govkit.json"));
  if (!linkFile(t, join(outside, "govkit.json"), join(root, "govkit.json"))) return;
  const before = readFileSync(join(outside, "govkit.json"), "utf-8");
  assert.throws(() => record(root), /govkit\.json is a symlink/);
  assert.equal(readFileSync(join(outside, "govkit.json"), "utf-8"), before);
});

test("a package.json that is a symlink is never written: the plan is manual", (t) => {
  const { root } = makeRepo("v0.7.0");
  const outside = tmp("govkit-outside-");
  writeFileSync(join(outside, "package.json"), read(root, "package.json"));
  if (!linkFile(t, join(outside, "package.json"), join(root, "package.json"))) return;
  const plan = packagePlan(root);
  assert.equal(plan.status, "manual");
  assert.match(plan.reason, /symlink/);
});

// ------------------------------------------------------------------ bootstrapDocs (#26)

test("bootstrapDocs: the old default is offered the new one, edited in place", () => {
  const { root } = makeRepo("v0.7.0");
  const before = read(root, "govkit.json");
  const r = check(root);
  assert.equal(r.bootstrapDocs.status, "offer");
  apply([BOOTSTRAP], root);
  const after = read(root, "govkit.json");
  assert.deepEqual(JSON.parse(after).guardrails["docs-sync-check"].bootstrapDocs, ["docs/PROJECT-HUB.md", "docs/PRIORITY-ROADMAP.md"]);
  // Only that line (and record's files/govkitVersion) changed: the comments and layout around it stay.
  const lines = (t) => t.split("\n").filter((l) => !/bootstrapDocs|govkitVersion|"files"|sha256|"version"|^\s*[{}],?$|^\s*"scripts\/|^\s*"\.git/.test(l));
  assert.deepEqual(lines(after).filter((l) => !lines(before).includes(l)), []);
  assert.equal(check(root).bootstrapDocs.status, "current");
});

test("bootstrapDocs a user changed is left alone and reported", () => {
  const { root } = makeRepo("v0.7.0");
  const m = json(root, "govkit.json");
  m.guardrails["docs-sync-check"].bootstrapDocs = ["docs/PROJECT-HUB.md", "docs/STATUS.md"];
  writeFileSync(join(root, "govkit.json"), `${JSON.stringify(m, null, 2)}\n`);
  commit(root);
  const r = check(root);
  assert.equal(r.bootstrapDocs.status, "custom");
  assert.throws(() => apply([BOOTSTRAP], root), /bootstrapDocs is custom/);
});

test("a fresh scaffold passes docs-sync-check --ci on day one (#26)", () => {
  const { root } = makeRepo();
  const today = new Date().toLocaleDateString("sv"); // YYYY-MM-DD, local
  for (const doc of ["docs/PROJECT-HUB.md", "docs/PRIORITY-ROADMAP.md"]) {
    mkdirSync(join(root, "docs"), { recursive: true });
    writeFileSync(join(root, doc), fill(readFileSync(join(TEMPLATES, doc), "utf-8"), "").replaceAll("{{SCAFFOLD_DATE}}", today));
  }
  commit(root, "trackers");
  const out = execFileSync("node", [join(root, "scripts/docs-sync-check.mjs"), "--ci"], { cwd: root, encoding: "utf-8" });
  assert.match(out, /Bootstrap docs are current/);
});

// ------------------------------------------------------------------ pre-push suggestion (#27)

function runHook(t, stdin) {
  try {
    execFileSync("sh", [join(TEMPLATES, "githooks/pre-push"), "origin", "x"], { input: stdin, encoding: "utf-8", stdio: "pipe" });
    return { code: 0 };
  } catch (e) {
    if (e.code === "ENOENT") {
      t.skip("no sh on this machine");
      return null;
    }
    return { code: e.status, err: String(e.stderr) };
  }
}

test("the pre-push block suggests a PR from the branch being pushed, not dev", (t) => {
  const r = runHook(t, "refs/heads/fix/x abc refs/heads/main def\n");
  if (!r) return;
  assert.equal(r.code, 1);
  assert.match(r.err, /gh pr create --base main --head fix\/x --fill/);
  assert.doesNotMatch(r.err, /--head dev/);
});

test("the pre-push hook still lets other branches through", (t) => {
  const r = runHook(t, "refs/heads/fix/x abc refs/heads/fix/x def\n");
  if (!r) return;
  assert.equal(r.code, 0);
});

// ------------------------------------------------------------------ doctor: old names

const doctor = (root) => {
  try {
    return execFileSync("node", [join(TEMPLATES, "scripts/govkit-doctor.mjs")], { cwd: root, encoding: "utf-8", stdio: "pipe" });
  } catch (e) {
    return String(e.stdout);
  }
};

function repoWithOldNames() {
  const { root } = makeRepo();
  mkdirSync(join(root, ".github/workflows"), { recursive: true });
  writeFileSync(join(root, ".github/workflows/ci.yml"), "jobs:\n  docs:\n    steps:\n      - run: npm run sdlc-docs:gate\n");
  writeFileSync(join(root, "CLAUDE.md"), `${read(root, "CLAUDE.md")}\nRun /sdlc status first.\n`);
  return root;
}

test("the doctor lists old names with file and line", () => {
  const root = repoWithOldNames();
  const out = doctor(root);
  assert.match(out, /\.github\/workflows\/ci\.yml:4 {2}sdlc-docs:\* npm script/);
  assert.match(out, /CLAUDE\.md:\d+ {2}\/sdlc \(now \/govkit-session\)/);
});

test("a repo with its own /sdlc skill gets no /sdlc findings, but govkit-only names still show", () => {
  const root = repoWithOldNames();
  mkdirSync(join(root, ".claude/skills/sdlc"), { recursive: true });
  const out = doctor(root);
  assert.doesNotMatch(out, /\/sdlc \(now/);
  assert.match(out, /ci\.yml:4 {2}sdlc-docs:\* npm script/);
});

test("oldNames.ignore suppresses a path, or a single line", () => {
  const root = repoWithOldNames();
  const m = json(root, "govkit.json");
  m.oldNames = { ignore: [".github/**"] };
  writeFileSync(join(root, "govkit.json"), JSON.stringify(m));
  let out = doctor(root);
  assert.doesNotMatch(out, /ci\.yml/);
  assert.match(out, /CLAUDE\.md:\d+/);
  const line = out.match(/CLAUDE\.md:(\d+)/)[1];
  m.oldNames.ignore.push(`CLAUDE.md:${line}`);
  writeFileSync(join(root, "govkit.json"), JSON.stringify(m));
  out = doctor(root);
  assert.doesNotMatch(out, /Old names/);
});

// ------------------------------------------------------------------ the CLAUDE.md block

test("an unedited block scaffolded from 0.5.0's template is outdated, and upgrades to the new names", () => {
  const { root } = makeRepo("v0.5.0");
  const r = check(root);
  assert.equal(r.claudeBlock.status, "outdated");
  assert.ok(r.claudeBlock.versions.includes("0.5.0"), r.claudeBlock.matches);
  apply(["CLAUDE.md"], root);
  const after = read(root, "CLAUDE.md");
  assert.doesNotMatch(after, /\/sdlc\b/);
  assert.match(after, /\/govkit-session status/);
  assert.match(after, /^# Acme\n\nOur own notes\./, "text outside the block untouched");
  assert.match(after, /^# Acme — Engineering Guardrails$/m, "the repo's values rendered back in");
  assert.equal(check(root).claudeBlock.status, "same");
});

test("a 0.5.0 block with a local edit matches no release: it stays edited, never offered as outdated", () => {
  const { root } = makeRepo("v0.5.0");
  writeFileSync(join(root, "CLAUDE.md"), read(root, "CLAUDE.md").replace("all new code lands here first", "new code lands here"));
  commit(root);
  assert.equal(check(root).claudeBlock.status, "differs");
});

test("the history index holds every release's block template, the current one included", () => {
  const hist = JSON.parse(readFileSync(join(GOVKIT, "skills/govkit-init/template-history.json"), "utf-8"));
  const current = readFileSync(join(TEMPLATES, "CLAUDE.md"), "utf-8").replace(/\r\n/g, "\n");
  const blocks = hist["CLAUDE.md#block"];
  assert.ok(blocks.some((b) => b.template === current && b.versions.includes(hist.$releases.at(-1))));
  assert.ok(blocks.some((b) => b.versions.includes("0.5.0")));
});

// ------------------------------------------------------------------ the aliases

test("the /sdlc and /sdlc-docs aliases exist for one version and name their new skill", () => {
  const alias = (n) => readFileSync(join(GOVKIT, `skills/${n}/SKILL.md`), "utf-8");
  assert.match(alias("sdlc"), /^name: sdlc$/m);
  assert.match(alias("sdlc"), /\.\.\/govkit-session\/SKILL\.md/);
  assert.match(alias("sdlc-docs"), /^name: sdlc-docs$/m);
  assert.match(alias("sdlc-docs"), /\.\.\/govkit-docsync\/SKILL\.md/);
  // Kept longer than 0.8.0 first said (extended in 0.9.0): a date, not a version number.
  for (const n of ["sdlc", "sdlc-docs"]) assert.match(alias(n), /removed in the first minor release on or after 2026-11-28/);
});
