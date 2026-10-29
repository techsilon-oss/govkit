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
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
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
  // Renamed in 0.8.0 (#12). `renamedFrom` lets an upgrade recognise the old file by its release
  // hashes, write the new one and delete the old, and lets the history builder index old releases.
  {
    path: "scripts/govkit-docsync.mjs",
    template: "scripts/govkit-docsync.mjs",
    guardrail: "doc-sync",
    renamedFrom: { path: "scripts/sdlc-docs.mjs", template: "scripts/sdlc-docs.mjs" },
  },
  {
    path: ".github/workflows/govkit-docsync.yml",
    template: ".github/workflows/govkit-docsync.yml",
    guardrail: "doc-sync",
    renamedFrom: { path: ".github/workflows/sdlc-docs.yml", template: ".github/workflows/sdlc-docs.yml" },
  },
  { path: "scripts/govkit-doctor.mjs", template: "scripts/govkit-doctor.mjs", guardrail: null },
  { path: "scripts/release-version.mjs", template: "scripts/release-version.mjs", guardrail: "versioning" },
  { path: "scripts/supabase.mjs", template: "scripts/supabase.mjs", guardrail: "supabase-account" },
  { path: ".githooks/pre-push", template: "githooks/pre-push", guardrail: "pre-push-hook", exec: true },
  { path: ".githooks/install-hooks.sh", template: "githooks/install-hooks.sh", guardrail: "pre-push-hook", exec: true },
];

const RELEASE_GATE = "scripts/release-gate.ts";
const CLAUDE_MD = "CLAUDE.md";
const PACKAGE_JSON = "package.json";
const BOOTSTRAP = "govkit.json#bootstrapDocs";

/**
 * package.json is the one file govkit edits that it does not own. Only script values that run the
 * renamed doc-sync runner change: the path is rewritten, and the three scripts init wrote are
 * renamed `docsync:*`, with the old key kept, until at least 2026-11-28, as exactly this alias string. The alias-removal release
 * removes an old key only if its value is still exactly the alias.
 */
const OLD_RUNNER = "scripts/sdlc-docs.mjs";
const NEW_RUNNER = "scripts/govkit-docsync.mjs";
const RUNNER_REF = /(^|[\s"'=])scripts\/sdlc-docs\.mjs(?=$|[\s"';&|)])/g;
export const SCRIPT_RENAMES = { "sdlc-docs:audit": "docsync:audit", "sdlc-docs:gate": "docsync:gate", "sdlc-docs:report": "docsync:report" };
export const aliasFor = (newKey) => `npm run ${newKey}`;

/** bootstrapDocs as templates up to 0.7.0 wrote it, and as 0.8.0 does (#26: CLAUDE.md holds rules, not status). */
const OLD_BOOTSTRAP = ["docs/PROJECT-HUB.md", "docs/PRIORITY-ROADMAP.md", "CLAUDE.md"];
const NEW_BOOTSTRAP = ["docs/PROJECT-HUB.md", "docs/PRIORITY-ROADMAP.md"];
const sameList = (a, b) => Array.isArray(a) && a.length === b.length && a.every((x, i) => x === b[i]);
const BLOCK = /<!-- govkit:start -->[\s\S]*?<!-- govkit:end -->/;
/** template-history.json key holding each release's CLAUDE.md block template, as text. */
export const BLOCK_HISTORY = "CLAUDE.md#block";
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

/** A govkit doc's URL pinned to a release; main when the version isn't plain X.Y.Z. */
export const guideUrl = (path, version) =>
  `https://github.com/techsilon-oss/govkit/blob/${/^\d+\.\d+\.\d+$/.test(String(version)) ? `v${version}` : "main"}/${path}`;
const history = () => readJson(HISTORY) ?? {};

/** Release labels in release order, as the history builder wrote them. */
const releaseOrder = (hist) => hist.$releases ?? [];

const range = (versions, order) => {
  const sorted = [...versions].sort((a, b) => order.indexOf(a) - order.indexOf(b));
  return sorted.length > 1 ? `${sorted[0]}–${sorted.at(-1)}` : (sorted[0] ?? "?");
};

/**
 * The first symlink on the way from the repo root to `rel` (a directory or the file itself),
 * dangling or not, or null. Owned files and the directories they sit in must be real: a repo that
 * committed scripts/docs-sync-check.mjs, or scripts/ itself, as a link to somewhere outside would
 * otherwise have an upgrade write through it. lstat, not exists: a dangling link reads as absent.
 */
export function symlinkOnPath(root, rel) {
  let cur = root;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    cur = join(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch {
      return null; // nothing further exists, so nothing further can be a link
    }
    if (st.isSymbolicLink()) return relative(root, cur).replace(/\\/g, "/");
  }
  return null;
}

/** The nearest existing ancestor of p, resolved through symlinks. */
function realAncestor(p) {
  let dir = p;
  while (!existsSync(dir)) {
    const up = dirname(dir);
    if (up === dir) return dir;
    dir = up;
  }
  return realpathSync(dir);
}

/**
 * Where an owned file actually is in this repo. govkit.json `paths` maps an owned path to another
 * location, for a repo that runs the files from elsewhere: govkit itself runs its templates in
 * place. Every reader resolves through here, so an override is never reported missing.
 *
 * A `paths` value is confined to the repo. apply writes where this points, so a govkit.json that
 * mapped an owned file to "../../.bashrc", an absolute path, or through a symlinked directory that
 * leaves the repo would make an upgrade write outside it. Any such value is refused, by name.
 */
export function located(manifest, path, root) {
  const value = manifest?.paths?.[path];
  if (value === undefined) return path;
  const refuse = (why) => {
    throw new Error(`govkit.json paths["${path}"] = ${JSON.stringify(value)} ${why}; refusing to use it`);
  };
  if (typeof value !== "string" || value.trim() === "") refuse("is not a relative path");
  if (isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith("\\")) refuse("is absolute");
  const inside = (base, target) => {
    const rel = relative(base, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (relative(resolve(root), resolve(root, value)) === "") refuse("is the repo root, not a file");
  if (!inside(resolve(root), resolve(root, value))) refuse("points outside the repo");
  // Through symlinks too: the nearest existing directory on the way is where the write really lands.
  const realRoot = realpathSync(root);
  const real = realAncestor(resolve(root, value));
  if (!inside(realRoot, real)) refuse("points outside the repo through a symlink");
  return value;
}

// ------------------------------------------------------------------ rendering

/**
 * The current template as this repo would have it. pre-push keeps the repo's own
 * PROTECTED_BRANCHES line (a repo may guard several branches), else uses branches.release.
 */
export function render(entry, root, manifest) {
  let text = readFileSync(join(TEMPLATES, entry.template), "utf-8").replace(/\r\n/g, "\n");
  if (entry.path === ".githooks/pre-push") {
    const existing = readText(join(root, located(manifest, entry.path, root)))?.match(PROTECTED)?.[0];
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

/** A block template (any release's) rendered with this repo's values. */
const renderTemplate = (template, values) =>
  template
    .replace(/\r\n/g, "\n")
    .replace(/\{\{(PROJECT_NAME|DEFAULT_BRANCH|DEPLOY_TARGET)\}\}/g, (_, k) => values[k])
    .trim();

export function renderBlock(block, manifest) {
  return renderTemplate(readFileSync(join(TEMPLATES, "CLAUDE.md"), "utf-8"), blockValues(block, manifest));
}

/**
 * Where the repo's block stands. The block is the user's to edit, so it is never replaced without
 * a yes; but an UNEDITED block from an older release is just old, and must be offered like any
 * outdated file, or a renamed skill's old name lives on in it. Each release's template is rendered
 * with this repo's values: a match is unedited.
 */
function blockStatus(block, manifest, hist, order) {
  if (block === null) return { status: "absent" };
  const have = block.trim();
  if (have === renderBlock(block, manifest)) return { status: "same" };
  const values = blockValues(block, manifest);
  const hit = (hist[BLOCK_HISTORY] ?? []).find((h) => renderTemplate(h.template, values) === have);
  return hit ? { status: "outdated", versions: hit.versions, matches: range(hit.versions, order) } : { status: "differs" };
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
    const at = located(manifest, entry.path, root);
    const link = symlinkOnPath(root, at);
    if (link) {
      files.push({ path: entry.path, at, status: "symlink", link });
      continue;
    }
    const text = readText(join(root, at));
    const old = entry.renamedFrom;
    const oldAt = old ? located(manifest, old.path, root) : null;
    if (text === null && old) {
      // Not at the new name: the repo may still have the file under its pre-rename name.
      const oldLink = symlinkOnPath(root, oldAt);
      if (oldLink) {
        files.push({ path: entry.path, at, from: old.path, status: "symlink", link: oldLink });
        continue;
      }
      const oldText = readText(join(root, oldAt));
      if (oldText !== null) {
        const hash = sha256(oldText);
        const versions = (hist[old.path] ?? []).find((h) => h.sha256 === hash)?.versions ?? [];
        files.push({
          path: entry.path,
          at,
          from: old.path,
          fromAt: oldAt,
          // An edited old file is never moved or deleted: the user decides what to keep.
          status: versions.length ? "rename" : "rename-edited",
          versions,
          matches: versions.length ? range(versions, order) : null,
        });
        continue;
      }
    }
    if (text === null) {
      files.push({ path: entry.path, at, status: "missing" });
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
      at,
      status,
      versions,
      matches: versions.length ? range(versions, order) : null,
      editedSinceRecorded: status === "edited" && Boolean(recorded[entry.path]),
      // Both names present: the new file is in, the old one was left behind (or edited and kept).
      oldStillPresent: old && readText(join(root, oldAt)) !== null ? old.path : null,
    });
  }

  // release-gate.ts belongs to release-gate-kit: compared by its recorded version, not bytes.
  const gateHave = manifest?.guardrails?.["release-gate"]?.vendoredVersion;
  const gateShip = readJson(join(TEMPLATES, "govkit.json"))?.guardrails?.["release-gate"]?.vendoredVersion;
  const releaseGate =
    !enabled(manifest, "release-gate") || !existsSync(join(root, RELEASE_GATE))
      ? { status: "n/a" }
      : { status: gateHave && gateHave === gateShip ? "current" : "outdated", have: gateHave ?? null, ship: gateShip };

  // The CLAUDE.md block: same, outdated (unedited, from an older release), or differs (edited).
  const block = readText(join(root, CLAUDE_MD))?.replace(/\r\n/g, "\n").match(BLOCK)?.[0] ?? null;
  const claudeBlock = blockStatus(block, manifest, hist, order);

  // The version every unedited owned file agrees on. Empty when files came from different
  // releases (hand-copied fixes), which is itself worth saying.
  // A current file counts for every release that shipped the same bytes, not only this one, so
  // a 0.5.0 repo whose other files are unchanged since 0.2.0 still reads as 0.5.0.
  const sets = files
    .filter((f) => f.status === "current" || f.status === "outdated" || f.status === "rename")
    .map((f) => (f.status === "current" ? [...new Set([...f.versions, current])] : f.versions));
  let agreed = null;
  if (sets.length) {
    const common = sets.reduce((acc, s) => acc.filter((v) => s.includes(v)));
    const latest = (vs) => [...vs].sort((a, b) => order.indexOf(a) - order.indexOf(b)).at(-1);
    agreed = common.includes(current) ? current : common.length ? latest(common) : "mixed";
  }

  const pkg = readJson(join(root, "package.json")) ?? {};
  // Every config file Prettier itself looks for, plus the package.json key and dependency.
  const prettierFiles = [
    ...["", ".json", ".json5", ".yaml", ".yml", ".toml", ".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"].map(
      (e) => `.prettierrc${e}`,
    ),
    ...[".js", ".cjs", ".mjs", ".ts", ".cts", ".mts"].map((e) => `prettier.config${e}`),
  ];
  const prettier =
    prettierFiles.some((f) => existsSync(join(root, f))) ||
    Boolean(pkg.prettier || pkg.devDependencies?.prettier || pkg.dependencies?.prettier);

  // bootstrapDocs is written explicitly by init, so a changed default never reaches existing repos.
  // Offer the new value only when the repo still has exactly the old template's; a list the user
  // chose is theirs.
  const sync = manifest?.guardrails?.["docs-sync-check"];
  let bootstrapDocs = { status: "n/a" };
  if (sync && sync.enabled !== false && Array.isArray(sync.bootstrapDocs)) {
    if (sameList(sync.bootstrapDocs, OLD_BOOTSTRAP)) bootstrapDocs = { status: "offer", have: OLD_BOOTSTRAP, want: NEW_BOOTSTRAP };
    else if (sameList(sync.bootstrapDocs, NEW_BOOTSTRAP)) bootstrapDocs = { status: "current" };
    else bootstrapDocs = { status: "custom", have: sync.bootstrapDocs };
  }

  return {
    pluginVersion: current,
    govkitVersion: { declared: manifest?.govkitVersion ?? null, derived: agreed },
    manifest: Boolean(manifest),
    files,
    releaseGate,
    claudeBlock,
    packageJson: packagePlan(root),
    bootstrapDocs,
    prettier,
  };
}

// ------------------------------------------------------------------ package.json (the one exception)

/**
 * What the rename changes in package.json, as a plan: the edits, and the resulting text. Edited by
 * line so the file's own formatting survives, then proven by re-parsing: every key other than the
 * changed scripts must be identical. A file not shaped for that is "manual", never reformatted.
 */
export function packagePlan(root) {
  const text = readText(join(root, PACKAGE_JSON));
  if (text === null) return { status: "n/a" };
  const link = symlinkOnPath(root, PACKAGE_JSON);
  if (link) return { status: "manual", reason: `${link} is a symlink; govkit writes only regular files` };
  let pkg;
  try {
    pkg = JSON.parse(text);
  } catch {
    return { status: "manual", reason: "package.json does not parse" };
  }
  const scripts = pkg.scripts ?? {};
  const rewrite = (v) => v.replace(RUNNER_REF, (_, pre) => `${pre}${NEW_RUNNER}`);
  const changes = [];
  for (const [key, value] of Object.entries(scripts)) {
    if (typeof value !== "string" || !new RegExp(RUNNER_REF.source).test(value)) continue;
    const renamed = SCRIPT_RENAMES[key];
    if (renamed) {
      if (scripts[renamed] === undefined) changes.push({ key: renamed, add: rewrite(value), before: key });
      changes.push({ key, from: value, to: aliasFor(renamed) });
    } else {
      changes.push({ key, from: value, to: rewrite(value) });
    }
  }
  if (!changes.length) return { status: "current" };

  let out = text.replace(/\r\n/g, "\n");
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  for (const c of changes.filter((x) => x.from !== undefined)) {
    const re = new RegExp(`^(\\s*)${esc(JSON.stringify(c.key))}(\\s*:\\s*)${esc(JSON.stringify(c.from))}(,?)\\s*$`, "m");
    const m = out.match(re);
    if (!m) return { status: "manual", reason: `cannot find "${c.key}" on a line of its own`, changes };
    const added = changes.find((x) => x.add !== undefined && x.before === c.key);
    const line = `${m[1]}${JSON.stringify(c.key)}${m[2]}${JSON.stringify(c.to)}${m[3]}`;
    const prefix = added ? `${m[1]}${JSON.stringify(added.key)}${m[2]}${JSON.stringify(added.add)},\n` : "";
    out = out.replace(re, () => `${prefix}${line}`);
  }
  // Proof: the scripts are exactly the intended ones, and nothing else in the file moved.
  const want = { ...scripts };
  for (const c of changes) want[c.key] = c.add ?? c.to;
  let after;
  try {
    after = JSON.parse(out);
  } catch {
    return { status: "manual", reason: "the edited package.json would not parse", changes };
  }
  const rest = (o) => stable({ ...o, scripts: undefined });
  if (stable(after.scripts) !== stable(want) || rest(after) !== rest(pkg)) {
    return { status: "manual", reason: "package.json is not shaped for a line edit", changes };
  }
  return { status: "migrate", changes, text: out };
}

/** JSON with keys sorted at every level: equality that ignores key order. */
export function stable(v) {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    return `{${Object.keys(v).filter((k) => v[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stable(v[k])}`).join(",")}}`;
  }
  return JSON.stringify(v);
}

// ------------------------------------------------------------------ write

/** The text of the JSON object that opens at `start` (a "{"), by brace depth, skipping strings. */
export function objectEnd(text, start) {
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
function patchManifestText(text, want, swaps = []) {
  let out = text.replace(/\r\n/g, "\n");
  const before = JSON.parse(out);
  // A renamed owned path, wherever it appears as a whole string (expects, expectsScripts, keys).
  for (const [from, to] of swaps) out = out.split(JSON.stringify(from)).join(JSON.stringify(to));
  // bootstrapDocs, only when it changes, so an untouched list keeps its own layout.
  const docs = want.guardrails?.["docs-sync-check"]?.bootstrapDocs;
  if (docs && stable(docs) !== stable(before.guardrails?.["docs-sync-check"]?.bootstrapDocs)) {
    const re = /("bootstrapDocs"\s*:\s*)\[[^\]]*\]/g;
    if ((out.match(re) ?? []).length !== 1) return null;
    out = out.replace(re, (_, k) => `${k}[${docs.map((d) => JSON.stringify(d)).join(", ")}]`);
  }
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
    return stable(JSON.parse(out)) === stable(want) ? out : null;
  } catch {
    return null;
  }
}

/**
 * Update govkit.json. In place when possible; otherwise through JSON.stringify (key order and
 * $comments survive, formatting does not). Returns true when it had to reformat, so the report
 * can say the diff holds more than the upgrade's own lines.
 */
function writeManifest(root, update, swaps = []) {
  // The same rule as for owned files: govkit writes only regular files inside the repo.
  const link = symlinkOnPath(root, "govkit.json");
  if (link) throw new Error(`${link} is a symlink; govkit writes only regular files inside the repo, so it will not write govkit.json through it`);
  const p = join(root, "govkit.json");
  const before = readText(p);
  const manifest = before ? JSON.parse(before) : {};
  update(manifest);
  const patched = before === null ? null : patchManifestText(before, manifest, swaps);
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
        sha256: sha256(readFileSync(join(root, located(m, f.path, root)), "utf-8")),
      };
    }
    // "mixed" is a finding for the report, not a version: leave the declared value alone then.
    const derived = report.govkitVersion.derived;
    if (derived && derived !== "mixed") m.govkitVersion = derived;
  });
  return { ...check(root), manifestReformatted: reformatted };
}

/** Replace the named paths with the current template. Only those; nothing else is written. */
/** Rename a string wherever it is a whole JSON value or key: mirrors the text swap in patchManifestText. */
function renameEverywhere(v, from, to) {
  if (Array.isArray(v)) return v.map((x) => renameEverywhere(x, from, to));
  if (v && typeof v === "object") {
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k === from ? to : k, renameEverywhere(x, from, to)]));
  }
  return v === from ? to : v;
}

export function apply(paths, root = process.cwd()) {
  const manifest = readJson(join(root, "govkit.json"));
  const report = check(root);
  const linkError = (link, p) =>
    new Error(
      `${link} is a symlink; govkit writes only regular files inside the repo, so it will not write ${p} through it. ` +
        "Replace the link with the file itself, then re-run.",
    );
  // Safety first, then cleanliness; nothing is written until both pass. Every target is confined
  // to the repo, so a refused path cannot leave half an upgrade, and none may be or pass through a
  // symlink, whether or not `paths` is set: govkit writes only regular files.
  for (const p of paths) {
    if (p === BOOTSTRAP) {
      if (report.bootstrapDocs.status !== "offer") throw new Error(`bootstrapDocs is ${report.bootstrapDocs.status}; nothing to offer`);
      continue;
    }
    const entry = OWNED.find((e) => e.path === p);
    const target = entry ? located(manifest, p, root) : p;
    const link = symlinkOnPath(root, target);
    if (link) throw linkError(link, p);
    const f = report.files.find((x) => x.path === p);
    if (f?.status === "rename-edited") {
      throw new Error(
        `${f.from} is edited (it matches no govkit release), so it is not moved or deleted. ` +
          `See what differs with: save-diff ${p}. Then move it yourself, or keep it.`,
      );
    }
    if (f?.status === "rename") {
      if (manifest?.paths?.[f.from] !== undefined && manifest?.paths?.[p] === undefined) {
        throw new Error(`govkit.json paths relocates ${f.from}; rename it by hand (add paths["${p}"]), then re-run`);
      }
      const oldLink = symlinkOnPath(root, f.fromAt);
      if (oldLink) throw linkError(oldLink, f.from);
      if (p === NEW_RUNNER && report.packageJson.status === "manual") {
        throw new Error(
          `package.json scripts run ${OLD_RUNNER}, but ${report.packageJson.reason}. ` +
            `Point them at ${NEW_RUNNER} by hand, then re-run.`,
        );
      }
    }
  }
  assertClean(root);
  let reformatted = false;
  for (const path of paths) {
    if (path === BOOTSTRAP) {
      reformatted ||= writeManifest(root, (m) => {
        m.guardrails["docs-sync-check"].bootstrapDocs = [...NEW_BOOTSTRAP];
      });
      continue;
    }
    const f = report.files.find((x) => x.path === path);
    if (f?.status === "rename") {
      const entry = OWNED.find((e) => e.path === path);
      const target = join(root, located(manifest, path, root));
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, render(entry, root, manifest));
      rmSync(join(root, f.fromAt));
      const swaps = [[f.from, path]];
      if (path === NEW_RUNNER && report.packageJson.status === "migrate") {
        writeFileSync(join(root, PACKAGE_JSON), report.packageJson.text);
        // expectsScripts follow the scripts that were renamed (a user's own key stays as it is).
        for (const c of report.packageJson.changes) if (SCRIPT_RENAMES[c.key]) swaps.push([c.key, SCRIPT_RENAMES[c.key]]);
      }
      reformatted ||= writeManifest(
        root,
        (m) => Object.assign(m, swaps.reduce((acc, [a, b]) => renameEverywhere(acc, a, b), m)),
        swaps,
      );
      continue;
    }
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
    const where = located(manifest, path, root);
    const target = join(root, where);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, render(entry, root, manifest));
    if (entry.exec) {
      chmodSync(target, 0o755);
      // The working-tree bit is not what a clone gets: record it in the index too.
      try {
        execFileSync("git", ["update-index", "--chmod=+x", where], { cwd: root, stdio: "ignore" });
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
  let label = path; // the path git apply will patch
  let from = null; // a rename's old path: the diff then runs old file -> new file
  if (path === CLAUDE_MD) {
    have = readText(join(root, CLAUDE_MD)) ?? "";
    want = withBlockReplaced(root, manifest);
  } else if (path === RELEASE_GATE) {
    have = readText(join(root, path)) ?? "";
    want = readFileSync(join(TEMPLATES, RELEASE_GATE), "utf-8");
  } else if (path === PACKAGE_JSON) {
    have = readText(join(root, PACKAGE_JSON)) ?? "";
    const plan = packagePlan(root);
    want = plan.status === "migrate" ? plan.text : have;
  } else if (path === BOOTSTRAP) {
    label = "govkit.json";
    have = readText(join(root, label)) ?? "";
    const m = JSON.parse(have);
    if (m.guardrails?.["docs-sync-check"]) m.guardrails["docs-sync-check"].bootstrapDocs = [...NEW_BOOTSTRAP];
    want = patchManifestText(have, m) ?? `${JSON.stringify(m, null, 2)}\n`;
  } else {
    const entry = OWNED.find((e) => e.path === path);
    if (!entry) throw new Error(`${path} is not a file govkit owns`);
    label = located(manifest, path, root);
    want = render(entry, root, manifest);
    have = readText(join(root, label));
    if (have === null && entry.renamedFrom) {
      from = located(manifest, entry.renamedFrom.path, root);
      have = readText(join(root, from));
    }
    have ??= "";
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
          .replace(/^diff --git a\/repo b\/template$/m, `diff --git a/${from ?? label} b/${label}`)
          .replace(/^--- a\/repo$/m, `--- a/${from ?? label}`)
          .replace(/^\+\+\+ b\/template$/m, `+++ b/${label}`);
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
  const out = join(dir, `upgrade-${path.replace(/[\\/#]/g, "-").replace(/^\.+/, "")}.diff`);
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
  const icon = { current: "✅", outdated: "⬆️ ", edited: "✏️ ", missing: "❌", skipped: "⏭️ ", symlink: "⛔", rename: "🔀", "rename-edited": "✏️ " };
  for (const f of r.files) {
    let note = f.status;
    if (f.status === "outdated") note = `outdated — matches ${f.matches}`;
    if (f.status === "symlink") note = `${f.link} is a symlink; not read or written (replace it with the file)`;
    if (f.status === "rename") note = `rename pending — ${f.from} (matches ${f.matches}) moves here`;
    if (f.status === "rename-edited") note = `${f.from} is edited (matches no release): not moved; save-diff, then decide`;
    if (f.oldStillPresent) note += ` — ${f.oldStillPresent} is still there; delete it once checked`;
    if (f.status === "edited") {
      note = f.editedSinceRecorded ? "edited since govkit wrote it" : "edited locally (matches no release)";
    }
    if (f.at && f.at !== f.path) note += ` (at ${f.at})`;
    console.log(`  ${icon[f.status]} ${f.path.padEnd(34)} ${note}`);
  }
  if (r.releaseGate.status === "outdated") {
    console.log(`  ⬆️  ${RELEASE_GATE.padEnd(34)} vendored ${r.releaseGate.have ?? "?"}, plugin ships ${r.releaseGate.ship}`);
  }
  if (r.claudeBlock.status === "outdated") {
    console.log(`  ⬆️  ${"CLAUDE.md (govkit block)".padEnd(34)} outdated — matches ${r.claudeBlock.matches} (unedited)`);
  }
  if (r.claudeBlock.status === "differs") {
    console.log(`  ✏️  ${"CLAUDE.md (govkit block)".padEnd(34)} edited locally (matches no release; diff, default no)`);
  }
  if (r.packageJson?.status === "migrate") {
    console.log(`
  package.json — the one file govkit edits that it does not own; only these scripts change:`);
    for (const c of r.packageJson.changes) {
      console.log(c.add !== undefined ? `    + "${c.key}": "${c.add}"` : `    ~ "${c.key}": "${c.from}"  ->  "${c.to}"`);
    }
  } else if (r.packageJson?.status === "manual") {
    console.log(`
  package.json still runs ${OLD_RUNNER}, but ${r.packageJson.reason}: point those scripts at ${NEW_RUNNER} by hand.`);
  }
  if (r.bootstrapDocs?.status === "offer") {
    console.log(`
  govkit.json bootstrapDocs is the old default; 0.8.0 drops CLAUDE.md (rules, not status): ${JSON.stringify(r.bootstrapDocs.want)}`);
  } else if (r.bootstrapDocs?.status === "custom") {
    console.log(`
  govkit.json bootstrapDocs was changed in this repo, so it is left as it is: ${JSON.stringify(r.bootstrapDocs.have)}`);
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
  const outdated = r.files.filter((f) => f.status === "outdated" || f.status === "rename").map((f) => f.path);
  if (r.claudeBlock.status === "outdated") outdated.push(CLAUDE_MD);
  if (outdated.length) {
    console.log(`\n  Upgrade: /govkit-init --upgrade  (or: upgrade.mjs apply ${outdated.join(" ")})`);
    // The guide for the installed plugin's version: what this check compares against.
    console.log(`  How upgrading works: ${guideUrl("README.md#upgrading", r.pluginVersion)}`);
  }
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
