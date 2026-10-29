// Tests for skills/govkit-init/upgrade.mjs. Run from the govkit repo root: node --test tests/
// Each test builds a throwaway git repo in the OS temp dir. Past-release fixtures come from this
// repo's own history (git show v0.5.0:…), so a clone needs its tags.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, test } from "node:test";
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

const GOVKIT = process.cwd();
const repos = [];
afterEach(() => {
  while (repos.length) rmSync(repos.pop(), { recursive: true, force: true });
});

const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

const atRelease = (ref, template) =>
  execFileSync("git", ["show", `${ref}:skills/govkit-init/templates/${template}`], {
    cwd: GOVKIT,
    encoding: "utf-8",
  });

const fill = (text, version) =>
  text
    .replaceAll("{{GOVKIT_VERSION}}", version)
    .replaceAll("{{PROJECT_NAME}}", "Acme")
    .replaceAll("{{DEFAULT_BRANCH}}", "dev")
    .replaceAll("{{DEPLOY_TARGET}}", "Vercel");

/** A committed repo as /govkit-init would leave it. ref: a release tag, or null for the working tree. */
function makeRepo(ref = null) {
  const root = mkdtempSync(join(tmpdir(), "govkit-upgrade-"));
  repos.push(root);
  git(root, "init", "-q", "-b", "dev");
  git(root, "config", "core.autocrlf", "false");
  const read = (t) => (ref ? atRelease(ref, t) : readFileSync(join(TEMPLATES, t), "utf-8"));
  const put = (path, text) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  };
  put("govkit.json", fill(read("govkit.json"), pluginVersion()));
  const manifest = JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));
  for (const e of OWNED) {
    const text = read(e.template).replace(/^PROTECTED_BRANCHES=.*$/m, 'PROTECTED_BRANCHES="refs/heads/main"');
    put(e.path, text);
  }
  put("scripts/release-gate.ts", read("scripts/release-gate.ts"));
  put("CLAUDE.md", `# Acme\n\nOur own notes.\n\n${fill(read("CLAUDE.md"), "")}`);
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  return { root, manifest };
}

const status = (report, path) => report.files.find((f) => f.path === path)?.status;

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
  for (const f of r.files) assert.equal(f.status, "current", f.path);
  assert.equal(r.claudeBlock.status, "same");
  assert.equal(r.govkitVersion.derived, pluginVersion());
});

test("a 0.5.0 repo: outdated files named with the releases they match; untouched files current", () => {
  const { root } = makeRepo("v0.5.0");
  const r = check(root);
  const dsc = r.files.find((f) => f.path === "scripts/docs-sync-check.mjs");
  assert.equal(dsc.status, "outdated");
  assert.equal(dsc.matches, "0.5.0");
  assert.equal(status(r, "scripts/govkit-doctor.mjs"), "current");
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
  const root = mkdtempSync(join(tmpdir(), "govkit-nogit-"));
  repos.push(root);
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
  assert.equal(check(root).claudeBlock.status, "same");
});

test("render keeps a pre-push's custom branch list", () => {
  const { root, manifest } = makeRepo();
  const p = join(root, ".githooks/pre-push");
  writeFileSync(p, readFileSync(p, "utf-8").replace(/^PROTECTED_BRANCHES=.*$/m, 'PROTECTED_BRANCHES="refs/heads/main refs/heads/prod"'));
  const entry = OWNED.find((e) => e.path === ".githooks/pre-push");
  assert.match(render(entry, root, manifest), /refs\/heads\/main refs\/heads\/prod/);
});
