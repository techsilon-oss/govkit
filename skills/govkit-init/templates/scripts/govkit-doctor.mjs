#!/usr/bin/env node
/**
 * govkit-doctor — is this project actually conformant?
 *
 * WHY THIS EXISTS
 * ---------------
 * Every other guardrail answers a question about the CODE. This one answers a question about the
 * GUARDRAILS, and nothing else could.
 *
 * The failure it exists to catch: a project adopts govkit, govkit turns out not to ship some piece
 * yet, the project ends up less protected than before, and nobody notices for months because
 * nothing errors. Adopting a standard felt like a completion, so no one re-checked. That happened —
 * it is why this file exists.
 *
 * The manifest (govkit.json) is the DECLARED state. This compares it against what is actually on
 * disk. Every guardrail is then in exactly one of three states, and the third is the point:
 *
 *   OK       declared on, present
 *   SKIPPED  declared off, with a recorded reason  -> a decision
 *   MISSING  declared on, absent                   -> a finding
 *
 * A guardrail is never silently absent. It is either a decision or a finding.
 *
 * Dependency-free: Node built-ins only. No git (it reads .git/config directly), no network, no install step.
 *
 * Usage:
 *   node scripts/govkit-doctor.mjs           # report; exit 0 always
 *   node scripts/govkit-doctor.mjs --ci      # exit 1 if anything is MISSING
 *   node scripts/govkit-doctor.mjs config    # print the manifest as a readable table
 */

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { createHash } from "node:crypto";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const MANIFEST = "govkit.json";

/**
 * Why a govkit.json `paths` value may not be used, or null if it may. Values are confined to the
 * repo: an absolute path, one that climbs out with "..", or one that leaves through a symlinked
 * directory is refused (the upgrade, which writes there, refuses the same values).
 */
function confined(value) {
  if (typeof value !== "string" || value.trim() === "") return "is not a relative path";
  if (isAbsolute(value) || /^[a-zA-Z]:/.test(value) || value.startsWith("\\")) return "is absolute";
  const root = process.cwd();
  const inside = (base, target) => {
    const rel = relative(base, target);
    return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
  };
  if (relative(root, resolve(root, value)) === "") return "is the repo root, not a file";
  if (!inside(root, resolve(root, value))) return "points outside the repo";
  let dir = resolve(root, value);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  if (!inside(realpathSync(root), realpathSync(dir))) return "points outside the repo through a symlink";
  return null;
}

const read = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
};

const manifest = read(MANIFEST);

if (!manifest) {
  console.log(`
❌ No ${MANIFEST} found.

   This project has not been scaffolded by govkit, or the manifest was deleted.
   Run /govkit-init to scaffold it, or /govkit-doctor via the skill to audit by
   inspection instead (it can infer state without a manifest).
`);
  process.exit(process.argv.includes("--ci") ? 1 : 0);
}

const pkg = read("package.json") ?? {};
const scripts = pkg.scripts ?? {};
const guardrails = Object.entries(manifest.guardrails ?? {});

/**
 * Where a finding's fix is documented: the guides of the release THIS doctor came from, so its
 * links match its own findings. Not the repo's govkitVersion: a repo that hasn't upgraded records
 * an old one (every 0.5.0 install says 0.4.0), and the plugin's newest doctor runs against it.
 *   - the plugin's copy (what /govkit-doctor runs) reads its own plugin.json;
 *   - the repo's copy reads govkit.json files["scripts/govkit-doctor.mjs"].version (the newest
 *     release in it, when record wrote a range);
 *   - anything else, or anything below 0.10.0 (the first release with docs/modules/), is v0.10.0.
 * MODULE_GUIDES lists the modules with a guide; a test keeps it equal to module.json's ids.
 */
const FIRST_GUIDES = "0.10.0";
const semverOf = (s) => String(s ?? "").match(/\d+\.\d+\.\d+/g)?.at(-1) ?? null;
const atLeast = (v, min) => {
  const [a, b] = [v, min].map((x) => x.split(".").map(Number));
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
};
function doctorRelease() {
  try {
    const own = JSON.parse(readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "../../../../.claude-plugin/plugin.json"), "utf-8"));
    if (own.name === "govkit" && semverOf(own.version)) return semverOf(own.version);
  } catch {
    // not running from the plugin: the repo's copy
  }
  return semverOf(manifest.files?.["scripts/govkit-doctor.mjs"]?.version);
}
const DOCTOR_RELEASE = doctorRelease();
const GUIDE_REF = `v${DOCTOR_RELEASE && atLeast(DOCTOR_RELEASE, FIRST_GUIDES) >= 0 ? DOCTOR_RELEASE : FIRST_GUIDES}`;
const guide = (path) => `https://github.com/techsilon-oss/govkit/blob/${GUIDE_REF}/${path}`;
const MODULE_GUIDES = ["trackers", "release-gate", "ci", "pre-push-hook", "doc-sync", "docs-sync-check", "versioning", "supabase-account"];
const fixLink = (name) => (MODULE_GUIDES.includes(name) ? `        fix: ${guide(`docs/modules/${name}.md#fix-a-finding`)}` : null);

// ------------------------------------------------------------------ config view

if (process.argv.includes("config")) {
  console.log(`\ngovkit ${manifest.govkitVersion ?? "?"} — declared configuration\n`);
  console.log(
    `  branches: working=${manifest.branches?.working ?? "?"}  release=${manifest.branches?.release ?? "?"}\n`,
  );
  for (const [name, g] of guardrails) {
    const mark = g.enabled ? "on " : "off";
    console.log(`  [${mark}] ${name.padEnd(18)} ${g.description ?? ""}`);
    if (!g.enabled && g.skippedReason) console.log(`        reason: ${g.skippedReason}`);
    if (g.vendoredFrom) console.log(`        vendored from ${g.vendoredFrom}@${g.vendoredVersion}`);
  }
  const ups = manifest.upstreams ?? {};
  const names = Object.keys(ups).filter((k) => !k.startsWith("$"));
  if (names.length) {
    console.log(`\n  Upstreams — fix a guardrail in the repo that OWNS it, not in the local copy:\n`);
    for (const n of names) {
      console.log(`    ${n.padEnd(18)} ${ups[n].url ?? ""}`);
      if (ups[n].owns) console.log(`    ${"".padEnd(18)} ${ups[n].owns}`);
      if (ups[n].vendoredHere) {
        console.log(`    ${"".padEnd(18)} vendored here as ${ups[n].vendoredHere} — do not patch locally`);
      }
    }
  }

  console.log(
    `\n  Change what is installed with /govkit-init --skip <name>, or by editing ${MANIFEST}\n` +
      `  and re-running /govkit-init. Turning one OFF requires a skippedReason — an unexplained\n` +
      `  gap is the thing this whole mechanism exists to prevent.\n`,
  );
  process.exit(0);
}

// ------------------------------------------------------------------ doctor view

const ok = [];
const skipped = [];
const missing = [];

for (const [name, g] of guardrails) {
  if (!g.enabled) {
    skipped.push([name, g.skippedReason ?? "no reason recorded"]);
    continue;
  }

  // `paths` relocates an owned file (a repo that runs govkit's files from elsewhere); look there.
  // A value outside the repo is refused and reported, never followed (see confined()).
  const absentFiles = (g.expects ?? [])
    .map((f) => {
      const p = manifest.paths?.[f];
      if (p === undefined) return existsSync(f) ? null : f;
      const why = confined(p);
      if (why) return `${f}: govkit.json paths value ${JSON.stringify(p)} ${why} (refused)`;
      return existsSync(p) ? null : `${f} (at ${p})`;
    })
    .filter(Boolean);
  const absentScripts = (g.expectsScripts ?? []).filter((s) => !scripts[s]);

  if (absentFiles.length === 0 && absentScripts.length === 0) {
    ok.push(name);
  } else {
    missing.push([name, [...absentFiles, ...absentScripts.map((s) => `package.json script "${s}"`)]]);
  }
}

console.log(`\ngovkit-doctor — ${manifest.govkitVersion ?? "?"}\n`);

for (const name of ok) console.log(`  ✅ ${name}`);

for (const [name, reason] of skipped) {
  console.log(`  ⏭️  ${name} — skipped: ${reason}`);
  // A skip with no reason reads as an oversight; the guide's Undo/Fix sections say what to record.
  if (reason === "no reason recorded" && fixLink(name)) console.log(fixLink(name));
}

for (const [name, items] of missing) {
  console.log(`  ❌ ${name} — declared on, but not installed:`);
  for (const i of items) console.log(`        missing ${i}`);
  if (fixLink(name)) console.log(fixLink(name));
}

console.log(
  `\n  ${ok.length} ok · ${skipped.length} skipped by decision · ${missing.length} missing\n`,
);

if (missing.length > 0) {
  console.log(
    `  Re-run /govkit-init to install what is missing, or if a gap is deliberate, set\n` +
      `  enabled:false with a skippedReason in ${MANIFEST} so it reads as a decision.\n`,
  );
}

// A guardrail present on disk but absent from the manifest is worth surfacing too — it usually
// means a hand-installed copy that govkit-init will not maintain, which is how forks start.
const known = new Set(guardrails.map(([n]) => n));
const strays = [];
if (existsSync(".githooks/pre-push") && !known.has("pre-push-hook")) strays.push(".githooks/pre-push");
if (existsSync("scripts/govkit-docsync.mjs") && !known.has("doc-sync")) strays.push("scripts/govkit-docsync.mjs");
if (strays.length) {
  console.log(`  ⚠️  Installed but not in the manifest — govkit will not maintain these:`);
  for (const s of strays) console.log(`        ${s}`);
  console.log("");
}

// ------------------------------------------------------------------ project steps (.govkit/session.md)

/**
 * A repo's own steps for /govkit-session. Listed so the difference from the standard is visible,
 * with every command spelled out, and whether this machine has trusted the file: until it has,
 * /govkit-session uses none of it. (Parsing matches project-steps.mjs: a sh/bash/shell fence is a
 * command, anything else under a point is a text step.)
 */
const SESSION_FILE = ".govkit/session.md";
const SESSION_POINTS = ["On start", "Before commit", "On close"];
if (existsSync(SESSION_FILE)) {
  const text = readFileSync(SESSION_FILE, "utf-8").replace(/\r\n/g, "\n");
  const points = Object.fromEntries(SESSION_POINTS.map((p) => [p, { text: 0, commands: [] }]));
  const unknown = [];
  let at = null;
  let inPara = false;
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const h = /^##\s+(.+?)\s*$/.exec(lines[i]);
    if (h) {
      at = SESSION_POINTS.find((p) => p.toLowerCase() === h[1].toLowerCase()) ?? null;
      if (!at) unknown.push(h[1]);
      inPara = false;
      continue;
    }
    const fence = /^```\s*(\w*)\s*$/.exec(lines[i]);
    if (fence) {
      const body = [];
      for (i++; i < lines.length && !/^```\s*$/.test(lines[i]); i++) body.push(lines[i]);
      if (at && ["sh", "bash", "shell"].includes(fence[1].toLowerCase())) points[at].commands.push(body.join(" ; ").trim());
      else if (at) points[at].text++;
      inPara = false;
      continue;
    }
    if (/^\s*$/.test(lines[i]) || /^#\s/.test(lines[i])) {
      inPara = false;
      continue;
    }
    const item = /^\s*(?:[-*]|\d+\.)\s+/.test(lines[i]);
    if (at && (item || !inPara)) points[at].text++;
    inPara = true;
  }
  let trusted = "not trusted on this machine (/govkit-session uses none of it until the user trusts it)";
  try {
    const record = JSON.parse(readFileSync(".git/govkit/session-trust.json", "utf-8"));
    const sha = createHash("sha256").update(text).digest("hex");
    trusted = record.sha256 === sha ? `trusted on this machine (${record.trustedAt})` : "CHANGED since it was trusted on this machine: not used until trusted again";
  } catch {
    // no record, or .git is elsewhere (worktree): reported as not trusted
  }
  console.log(`  🧩 Project steps for /govkit-session, from ${SESSION_FILE}: ${trusted}`);
  if (!trusted.startsWith("trusted")) console.log(`        how trust works: ${guide("docs/EXTENDING.md#trust-why-the-file-must-be-approved-first")}`);
  for (const p of SESSION_POINTS) {
    const { text: t, commands } = points[p];
    console.log(`        ${p.padEnd(14)} ${t + commands.length} step(s), ${commands.length} command(s)`);
    for (const c of commands) console.log(`          $ ${c}`);
  }
  if (unknown.length) console.log(`        unknown sections, ignored: ${unknown.join(", ")}`);
  console.log("");
}

// ------------------------------------------------------------------ old names (renamed in 0.8.0)

/**
 * govkit 0.8.0 renamed /sdlc -> /govkit-session, /sdlc-docs -> /govkit-docsync, the runner
 * scripts/sdlc-docs.mjs -> scripts/govkit-docsync.mjs, its workflow file, and the sdlc-docs:* npm
 * scripts -> docsync:*. The old ones keep working until the first minor release on or after 2026-11-28 (extended in 0.9.0, which first planned to remove them). Listed here with file and line so a
 * repo can fix its own docs and CI first.
 *
 * Two kinds. govkit-only names (the scripts, the runner, the workflow file) are always listed. The
 * skill names /sdlc and /sdlc-docs are listed only when the repo has no skill of its own by that
 * name (.claude/skills/<name>/): a project with its own /sdlc is why govkit renamed, and its
 * mentions are correct. govkit.json `oldNames.ignore` takes "path" (glob) or "path:line" entries.
 */
const GOVKIT_ONLY = [
  [/\bsdlc-docs:(audit|gate|report)\b/, "sdlc-docs:* npm script (now docsync:*)"],
  [/scripts\/sdlc-docs\.mjs/, "scripts/sdlc-docs.mjs (now scripts/govkit-docsync.mjs)"],
  [/\bsdlc-docs\.yml\b/, "sdlc-docs.yml (now govkit-docsync.yml)"],
];
const SKILL_NAMES = [
  ["sdlc-docs", /(^|[^\w/.-])\/sdlc-docs\b/, "/sdlc-docs (now /govkit-docsync)"],
  ["sdlc", /(^|[^\w/.-])\/sdlc\b(?!-)/, "/sdlc (now /govkit-session)"],
];

function hooksPath() {
  try {
    return readFileSync(".git/config", "utf-8").match(/^\s*hookspath\s*=\s*(.+?)\s*$/im)?.[1] ?? null;
  } catch {
    return null; // a worktree or submodule keeps .git elsewhere; .githooks/ is scanned regardless
  }
}

function filesUnder(dir) {
  if (!existsSync(dir)) return [];
  if (!statSync(dir).isDirectory()) return [dir];
  return readdirSync(dir).flatMap((name) => (name === ".git" || name === "node_modules" ? [] : filesUnder(`${dir}/${name}`)));
}

const globRe = (g) => new RegExp(`^${g.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\0").replace(/\*/g, "[^/]*").replace(/\0/g, ".*")}$`);
const ignore = (manifest.oldNames?.ignore ?? []).map((e) => {
  const m = /^(.*):(\d+)$/.exec(e);
  return m ? { re: globRe(m[1]), line: Number(m[2]) } : { re: globRe(e), line: null };
});
const ignored = (file, line) => ignore.some((i) => i.re.test(file) && (i.line === null || i.line === line));

const scanned = [...new Set(["CLAUDE.md", "docs", ".github", ".githooks", hooksPath()].filter(Boolean).flatMap(filesUnder))]
  .filter((f) => !/(^|\/)CHANGELOG\.md$/.test(f) && statSync(f).size < 1_000_000);
const ownSkill = (name) => existsSync(`.claude/skills/${name}`);
const oldNames = [];
for (const file of scanned) {
  const lines = readFileSync(file, "utf-8").split("\n");
  lines.forEach((text, i) => {
    const hits = GOVKIT_ONLY.filter(([re]) => re.test(text)).map(([, what]) => ({ what, govkitOnly: true }));
    for (const [name, re, what] of SKILL_NAMES) if (!ownSkill(name) && re.test(text)) hits.push({ what, govkitOnly: false });
    for (const h of hits) if (!ignored(file, i + 1)) oldNames.push({ file, line: i + 1, ...h });
  });
}
if (oldNames.length) {
  console.log(`  ⚠️  Old names, renamed in govkit 0.8.0 (they keep working until the first minor release on or after 2026-11-28):`);
  for (const o of oldNames) console.log(`        ${o.file}:${o.line}  ${o.what}`);
  console.log(`        fix: ${guide("docs/UPGRADING.md#07--08")}`);
  console.log(
    `\n  /govkit-init --upgrade moves the files and scripts; fix the rest by hand. To keep a\n` +
      `  reference on purpose, add "path" or "path:line" to oldNames.ignore in ${MANIFEST}.\n`,
  );
}

process.exit(process.argv.includes("--ci") && missing.length > 0 ? 1 : 0);
