#!/usr/bin/env node
/**
 * govkit upgrade — bring the files govkit owns in a repo up to the installed plugin's version.
 *
 * WHY THIS EXISTS
 * ---------------
 * /govkit-init copies scripts, hooks and a workflow into a repo, then skips every file that
 * already exists. A plugin update reaches the skills and the session hook, but never those
 * copies — so a fix to an owned file (0.5.1's ground-truth fix, 0.5.2's Supabase guard) never
 * reached a repo that had already run init.
 *
 * WHY IT RUNS FROM THE PLUGIN
 * ---------------------------
 * The vendored scripts are the thing being upgraded; a vendored checker would be as old as what
 * it checks. This file runs from the plugin cache, like hooks/docs-freshness.mjs, so it is always
 * the installed version.
 *
 * HOW A FILE'S VERSION IS KNOWN
 * -----------------------------
 * By hash, against every past release's template (template-history.json, built by
 * tools/build-template-history.mjs). A match names the releases that shipped exactly those bytes —
 * a range when the file did not change between releases. No match means "edited locally", and
 * that includes a formatter's rewrite: it is the honest answer, and why the skill offers to
 * .prettierignore the owned files. Line endings and pre-push's per-repo branch line are
 * canonicalised first, so neither reads as an edit.
 *
 * Dependency-free: Node built-ins + git (for `diff` only).
 *
 * Usage (from the repo root):
 *   node <plugin>/skills/govkit-init/upgrade.mjs check [--json]   # read-only report
 *   node <plugin>/skills/govkit-init/upgrade.mjs diff <path>      # repo file vs current template
 *   node <plugin>/skills/govkit-init/upgrade.mjs save-diff <path> # keep that diff in .git/govkit/ (after a "no")
 *   node <plugin>/skills/govkit-init/upgrade.mjs apply <path>...  # replace the named files only; clean tree required
 *   node <plugin>/skills/govkit-init/upgrade.mjs record           # write govkit.json `files`, touch nothing else
 */

import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
export const TEMPLATES = join(HERE, "templates");
const HISTORY = join(HERE, "template-history.json");
const PLUGIN_JSON = resolve(HERE, "..", "..", ".claude-plugin", "plugin.json");

/**
 * The files govkit owns in a repo, with the guardrail each belongs to (null: always installed).
 * Not owned, never touched: the trackers, release-gate.config.json, source-doc-map.json,
 * supabase/projects.json, govkit.json — those are the project's own configuration.
 */
export const OWNED = [
  { path: "scripts/docs-sync-check.mjs", template: "scripts/docs-sync-check.mjs", guardrail: "docs-sync-check" },
  { path: "scripts/sdlc-docs.mjs", template: "scripts/sdlc-docs.mjs", guardrail: "doc-sync" },
  { path: ".github/workflows/sdlc-docs.yml", template: ".github/workflows/sdlc-docs.yml", guardrail: "doc-sync" },
  { path: "scripts/govkit-doctor.mjs", template: "scripts/govkit-doctor.mjs", guardrail: null },
  { path: "scripts/release-version.mjs", template: "scripts/release-version.mjs", guardrail: "versioning" },
  { path: "scripts/supabase.mjs", template: "scripts/supabase.mjs", guardrail: "supabase-account" },
  { path: ".githooks/pre-push", template: "githooks/pre-push", guardrail: "pre-push-hook", exec: true },
  { path: ".githooks/install-hooks.sh", template: "githooks/install-hooks.sh", guardrail: "pre-push-hook", exec: true },
];

const RELEASE_GATE = "scripts/release-gate.ts";
const CLAUDE_MD = "CLAUDE.md";
const BLOCK = /<!-- govkit:start -->[\s\S]*?<!-- govkit:end -->/;
const PROTECTED = /^PROTECTED_BRANCHES=.*$/m;

// ------------------------------------------------------------------ hashing

/** What the hash sees: LF line endings, and pre-push's per-repo branch line blanked. */
export const canonical = (text) =>
  text.replace(/\r\n/g, "\n").replace(PROTECTED, 'PROTECTED_BRANCHES=""');

export const sha256 = (text) => createHash("sha256").update(canonical(text)).digest("hex");

// ------------------------------------------------------------------ inputs

const readText = (p) => (existsSync(p) ? readFileSync(p, "utf-8") : null);
const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
};

export const pluginVersion = () => readJson(PLUGIN_JSON)?.version ?? "unknown";
const history = () => readJson(HISTORY) ?? {};

/** Release labels in release order, as the history builder wrote them. */
const releaseOrder = (hist) => hist.$releases ?? [];

const range = (versions, order) => {
  const sorted = [...versions].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.length > 1 ? `${sorted[0]}–${sorted.at(-1)}` : (sorted[0] ?? "?");
};

// ------------------------------------------------------------------ rendering

/**
 * The current template as this repo would have it. pre-push keeps the repo's own
 * PROTECTED_BRANCHES line (a repo may guard several branches), else uses branches.release.
 */
export function render(entry, root, manifest) {
  let text = readFileSync(join(TEMPLATES, entry.template), "utf-8").replace(/\r\n/g, "\n");
  if (entry.path === ".githooks/pre-push") {
    const existing = readText(join(root, entry.path))?.match(PROTECTED)?.[0];
    const release = manifest?.branches?.release ?? "main";
    text = text.replace(PROTECTED, existing ?? `PROTECTED_BRANCHES="refs/heads/${release}"`);
  }
  return text;
}

/**
 * Values for the CLAUDE.md block: govkit.json `project` when init recorded it, else read back
 * from the repo's own block (repos initialised before `project` existed).
 */
export function blockValues(block, manifest) {
  const p = manifest?.project ?? {};
  return {
    PROJECT_NAME: p.name ?? block?.match(/^# (.+?) — Engineering Guardrails$/m)?.[1] ?? "{{PROJECT_NAME}}",
    DEFAULT_BRANCH: manifest?.branches?.working ?? "dev",
    DEPLOY_TARGET:
      p.deployTarget ?? block?.match(/\*\*Still works without Actions:\*\* (.+?) deploys on push/)?.[1] ?? "your host",
  };
}

export function renderBlock(block, manifest) {
  const values = blockValues(block, manifest);
  return readFileSync(join(TEMPLATES, "CLAUDE.md"), "utf-8")
    .replace(/\r\n/g, "\n")
    .replace(/\{\{(PROJECT_NAME|DEFAULT_BRANCH|DEPLOY_TARGET)\}\}/g, (_, k) => values[k])
    .trim();
}

// ------------------------------------------------------------------ check

const enabled = (manifest, guardrail) =>
  guardrail === null || manifest?.guardrails?.[guardrail]?.enabled !== false;

/** Classify every owned file. Read-only. */
export function check(root = process.cwd()) {
  const manifest = readJson(join(root, "govkit.json"));
  const hist = history();
  const order = releaseOrder(hist);
  const current = pluginVersion();
  const recorded = manifest?.files ?? {};
  const files = [];

  for (const entry of OWNED) {
    if (!enabled(manifest, entry.guardrail)) {
      files.push({ path: entry.path, status: "skipped" });
      continue;
    }
    const text = readText(join(root, entry.path));
    if (text === null) {
      files.push({ path: entry.path, status: "missing" });
      continue;
    }
    const hash = sha256(text);
    const versions = (hist[entry.path] ?? []).find((h) => h.sha256 === hash)?.versions ?? [];
    let status;
    if (hash === sha256(render(entry, root, manifest))) status = "current";
    else if (versions.length) status = "outdated";
    else status = "edited";
    files.push({
      path: entry.path,
      status,
      versions,
      matches: versions.length ? range(versions, order) : null,
      editedSinceRecorded: status === "edited" && Boolean(recorded[entry.path]),
    });
  }

  // release-gate.ts belongs to release-gate-kit: compared by its recorded version, not bytes.
  const gateHave = manifest?.guardrails?.["release-gate"]?.vendoredVersion;
  const gateShip = readJson(join(TEMPLATES, "govkit.json"))?.guardrails?.["release-gate"]?.vendoredVersion;
  const releaseGate =
    !enabled(manifest, "release-gate") || !existsSync(join(root, RELEASE_GATE))
      ? { status: "n/a" }
      : { status: gateHave && gateHave === gateShip ? "current" : "outdated", have: gateHave ?? null, ship: gateShip };

  // The CLAUDE.md block is edited by design ("Edit freely"), so it is only ever compared.
  const block = readText(join(root, CLAUDE_MD))?.replace(/\r\n/g, "\n").match(BLOCK)?.[0] ?? null;
  const claudeBlock = block === null
    ? { status: "absent" }
    : { status: block.trim() === renderBlock(block, manifest) ? "same" : "differs" };

  // The version every unedited owned file agrees on. Empty when files came from different
  // releases (hand-copied fixes), which is itself worth saying.
  // A current file counts for every release that shipped the same bytes, not only this one, so
  // a 0.5.0 repo whose other files are unchanged since 0.2.0 still reads as 0.5.0.
  const sets = files
    .filter((f) => f.status === "current" || f.status === "outdated")
    .map((f) => (f.status === "current" ? [...new Set([...f.versions, current])] : f.versions));
  let agreed = null;
  if (sets.length) {
    const common = sets.reduce((acc, s) => acc.filter((v) => s.includes(v)));
    const latest = (vs) => [...vs].sort((a, b) => order.indexOf(a) - order.indexOf(b)).at(-1);
    agreed = common.includes(current) ? current : common.length ? latest(common) : "mixed";
  }

  const pkg = readJson(join(root, "package.json")) ?? {};
  const prettier =
    ["", ".json", ".js", ".cjs", ".mjs", ".yaml", ".yml"].some((e) => existsSync(join(root, `.prettierrc${e}`))) ||
    Boolean(pkg.prettier || pkg.devDependencies?.prettier || pkg.dependencies?.prettier);

  return {
    pluginVersion: current,
    govkitVersion: { declared: manifest?.govkitVersion ?? null, derived: agreed },
    manifest: Boolean(manifest),
    files,
    releaseGate,
    claudeBlock,
    prettier,
  };
}

// ------------------------------------------------------------------ write

/** The text of the JSON object that opens at `start` (a "{"), by brace depth, skipping strings. */
function objectEnd(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      for (i++; i < text.length && text[i] !== '"'; i++) if (text[i] === "\\") i++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return i + 1;
  }
  return -1;
}

/**
 * Edit only the keys upgrade owns — govkitVersion, files, release-gate's vendoredVersion — in
 * place, so the project's own formatting (blank lines, alignment) survives and the diff shows
 * the upgrade and nothing else. Returns null when the text is not shaped as expected.
 */
function patchManifestText(text, want) {
  let out = text.replace(/\r\n/g, "\n");
  const setString = (key, value) => {
    const re = new RegExp(`("${key}"\\s*:\\s*)"[^"]*"`, "g");
    if ((out.match(re) ?? []).length !== 1) return false;
    out = out.replace(re, `$1${JSON.stringify(value)}`);
    return true;
  };
  if (want.govkitVersion !== undefined && !setString("govkitVersion", want.govkitVersion)) return null;
  const gate = want.guardrails?.["release-gate"]?.vendoredVersion;
  if (gate !== undefined && !setString("vendoredVersion", gate)) return null;

  if (want.files) {
    const body = JSON.stringify(want.files, null, 2).replace(/\n/g, "\n  ");
    const at = out.search(/"files"\s*:\s*\{/);
    if (at >= 0) {
      const open = out.indexOf("{", at);
      const end = objectEnd(out, open);
      if (end < 0) return null;
      out = `${out.slice(0, open)}${body}${out.slice(end)}`;
    } else {
      const close = out.lastIndexOf("}");
      if (close < 0) return null;
      const head = out.slice(0, close).trimEnd();
      out = `${head},\n\n  "files": ${body}\n}\n`;
    }
  }
  try {
    return JSON.stringify(JSON.parse(out)) === JSON.stringify(want) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Update govkit.json. In place when possible; otherwise through JSON.stringify (key order and
 * $comments survive, formatting does not). Returns true when it had to reformat, so the report
 * can say the diff holds more than the upgrade's own lines.
 */
function writeManifest(root, update) {
  const p = join(root, "govkit.json");
  const before = readText(p);
  const manifest = before ? JSON.parse(before) : {};
  update(manifest);
  const patched = before === null ? null : patchManifestText(before, manifest);
  if (patched !== null) {
    writeFileSync(p, patched);
    return false;
  }
  const full = `${JSON.stringify(manifest, null, 2)}\n`;
  writeFileSync(p, full);
  return before !== null && before.replace(/\r\n/g, "\n") !== full;
}

const git = (root, args) =>
  execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();

/**
 * apply refuses on a dirty tree. Every upgrade should be one reviewable, revertable change: mixed
 * with other edits, `git diff` no longer shows what the upgrade did and `git checkout .` cannot
 * undo it alone. (check, diff and record still run.)
 */
function assertClean(root) {
  let dirty;
  try {
    dirty = git(root, ["status", "--porcelain"]);
  } catch {
    throw new Error("not a git repository; an upgrade must be a change git can show and revert");
  }
  if (dirty) {
    throw new Error(
      `the working tree has uncommitted changes:\n${dirty.split("\n").map((l) => `      ${l}`).join("\n")}\n\n` +
        "    Commit or stash them first. Every upgrade should be one reviewable, revertable change:\n" +
        "    mixed with other edits, git diff no longer shows what the upgrade did, and reverting it\n" +
        "    would take your work with it.",
    );
  }
}

/**
 * Record what govkit wrote: version + hash for each unedited owned file, and the version they all
 * agree on as govkitVersion. Edited files are not recorded — their bytes are not govkit's.
 * Touches only govkit.json, so init can run it on a freshly scaffolded (uncommitted) tree.
 */
export function record(root = process.cwd()) {
  const report = check(root);
  const reformatted = writeManifest(root, (m) => {
    m.files ??= {};
    for (const f of report.files) {
      if (f.status !== "current" && f.status !== "outdated") continue;
      m.files[f.path] = {
        version: f.status === "current" ? report.pluginVersion : f.matches,
        sha256: sha256(readFileSync(join(root, f.path), "utf-8")),
      };
    }
    // "mixed" is a finding for the report, not a version: leave the declared value alone then.
    const derived = report.govkitVersion.derived;
    if (derived && derived !== "mixed") m.govkitVersion = derived;
  });
  return { ...check(root), manifestReformatted: reformatted };
}

/** Replace the named paths with the current template. Only those; nothing else is written. */
export function apply(paths, root = process.cwd()) {
  assertClean(root);
  const manifest = readJson(join(root, "govkit.json"));
  let reformatted = false;
  for (const path of paths) {
    if (path === CLAUDE_MD) {
      writeFileSync(join(root, CLAUDE_MD), withBlockReplaced(root, manifest));
      continue;
    }
    if (path === RELEASE_GATE) {
      writeFileSync(join(root, path), readFileSync(join(TEMPLATES, RELEASE_GATE), "utf-8"));
      const ship = readJson(join(TEMPLATES, "govkit.json"))?.guardrails?.["release-gate"]?.vendoredVersion;
      reformatted ||= writeManifest(root, (m) => {
        m.guardrails ??= {};
        m.guardrails["release-gate"] ??= {};
        m.guardrails["release-gate"].vendoredVersion = ship;
      });
      continue;
    }
    const entry = OWNED.find((e) => e.path === path);
    if (!entry) throw new Error(`${path} is not a file govkit owns; refusing to write it`);
    const target = join(root, path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, render(entry, root, manifest));
    if (entry.exec) {
      chmodSync(target, 0o755);
      // The working-tree bit is not what a clone gets: record it in the index too.
      try {
        execFileSync("git", ["update-index", "--chmod=+x", path], { cwd: root, stdio: "ignore" });
      } catch {
        // not yet tracked: `git add` picks up the mode from the file on POSIX; the skill reminds on Windows
      }
    }
  }
  const after = record(root);
  return { ...after, manifestReformatted: reformatted || after.manifestReformatted };
}

/** The whole CLAUDE.md with only the govkit block replaced, so a diff of it applies with git apply. */
function withBlockReplaced(root, manifest) {
  const text = readText(join(root, CLAUDE_MD))?.replace(/\r\n/g, "\n");
  const block = text?.match(BLOCK)?.[0];
  if (!block) throw new Error("CLAUDE.md has no govkit:start/end block to replace");
  return text.replace(BLOCK, renderBlock(block, manifest));
}

/** Unified diff (paths as in the repo, so `git apply` takes it): the repo's file vs what apply would write. */
export function diff(path, root = process.cwd()) {
  const manifest = readJson(join(root, "govkit.json"));
  let have;
  let want;
  if (path === CLAUDE_MD) {
    have = readText(join(root, CLAUDE_MD)) ?? "";
    want = withBlockReplaced(root, manifest);
  } else if (path === RELEASE_GATE) {
    have = readText(join(root, path)) ?? "";
    want = readFileSync(join(TEMPLATES, RELEASE_GATE), "utf-8");
  } else {
    const entry = OWNED.find((e) => e.path === path);
    if (!entry) throw new Error(`${path} is not a file govkit owns`);
    have = readText(join(root, path)) ?? "";
    want = render(entry, root, manifest);
  }
  const dir = mkdtempSync(join(tmpdir(), "govkit-diff-"));
  try {
    writeFileSync(join(dir, "repo"), have.replace(/\r\n/g, "\n"));
    writeFileSync(join(dir, "template"), want);
    try {
      execFileSync("git", ["diff", "--no-index", "--no-color", "repo", "template"], {
        cwd: dir,
        encoding: "utf-8",
        stdio: ["ignore", "pipe", "ignore"],
      });
      return ""; // exit 0: identical
    } catch (e) {
      // exit 1: they differ, which is the answer. Name both sides as the repo path.
      if (e.status === 1) {
        return String(e.stdout)
          .replace(/^diff --git a\/repo b\/template$/m, `diff --git a/${path} b/${path}`)
          .replace(/^--- a\/repo$/m, `--- a/${path}`)
          .replace(/^\+\+\+ b\/template$/m, `+++ b/${path}`);
      }
      throw e;
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/**
 * For a "no" on an edited file or the CLAUDE.md block: keep the diff in .git/govkit/ so the user
 * can take only the lines they want (`git apply --include`, or by hand). Inside .git, so it is
 * never committed and never dirties the tree. Returns the path, or null when nothing differs.
 */
export function saveDiff(path, root = process.cwd()) {
  const d = diff(path, root);
  if (!d) return null;
  const dir = join(git(root, ["rev-parse", "--absolute-git-dir"]), "govkit");
  mkdirSync(dir, { recursive: true });
  const out = join(dir, `upgrade-${path.replace(/[\\/]/g, "-").replace(/^\.+/, "")}.diff`);
  writeFileSync(out, d);
  return out;
}

// ------------------------------------------------------------------ CLI

function printReport(r) {
  console.log(`\ngovkit upgrade check — plugin ${r.pluginVersion}\n`);
  if (!r.manifest) {
    console.log("  ❌ No govkit.json. Run /govkit-init first.\n");
    return;
  }
  const icon = { current: "✅", outdated: "⬆️ ", edited: "✏️ ", missing: "❌", skipped: "⏭️ " };
  for (const f of r.files) {
    let note = f.status;
    if (f.status === "outdated") note = `outdated — matches ${f.matches}`;
    if (f.status === "edited") {
      note = f.editedSinceRecorded ? "edited since govkit wrote it" : "edited locally (matches no release)";
    }
    console.log(`  ${icon[f.status]} ${f.path.padEnd(34)} ${note}`);
  }
  if (r.releaseGate.status === "outdated") {
    console.log(`  ⬆️  ${RELEASE_GATE.padEnd(34)} vendored ${r.releaseGate.have ?? "?"}, plugin ships ${r.releaseGate.ship}`);
  }
  if (r.claudeBlock.status === "differs") {
    console.log(`  ✏️  ${"CLAUDE.md (govkit block)".padEnd(34)} differs from the template (edited by design; diff only)`);
  }
  const { declared, derived } = r.govkitVersion;
  if (derived === "mixed") {
    console.log("\n  The owned files come from different releases (fixes copied by hand?). Upgrading them all aligns them.");
  } else if (derived && declared !== derived) {
    console.log(`\n  govkit.json says govkitVersion ${declared ?? "(none)"}; the files say ${derived}. \`record\` corrects it.`);
  }
  if (r.manifestReformatted) {
    console.log(
      "\n  govkit.json was also reformatted (2-space JSON) while recording this, so its diff shows\n" +
        "  more than the upgrade's own lines. Nothing in it changed meaning.",
    );
  }
  const outdated = r.files.filter((f) => f.status === "outdated").map((f) => f.path);
  if (outdated.length) console.log(`\n  Upgrade: /govkit-init --upgrade  (or: upgrade.mjs apply ${outdated.join(" ")})`);
  console.log("");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  try {
    if (cmd === "check") {
      const r = check();
      if (rest.includes("--json")) console.log(JSON.stringify(r, null, 2));
      else printReport(r);
    } else if (cmd === "diff" && rest[0]) {
      const d = diff(rest[0]);
      console.log(d || `${rest[0]}: identical to the current template`);
    } else if (cmd === "save-diff" && rest[0]) {
      const out = saveDiff(rest[0]);
      console.log(out ? `Saved the diff for ${rest[0]} to ${out}` : `${rest[0]}: identical to the current template`);
    } else if (cmd === "apply" && rest.length) {
      printReport(apply(rest));
    } else if (cmd === "record") {
      printReport(record());
    } else {
      console.error("usage: upgrade.mjs check [--json] | diff <path> | save-diff <path> | apply <path>... | record");
      process.exit(2);
    }
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  }
}
