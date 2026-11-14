#!/usr/bin/env node
/**
 * govkit-docsync — Documentation Sync Watchdog (portable, dependency-free)
 *
 * Generalized from an earlier in-house version of the /sdlc + /sdlc-docs system.
 * Canonical template: govkit → skills/govkit-init/templates/scripts/.
 *
 * Diff-aware doc-sync checker. Cross-references PR-wide file changes against a
 * project-local registry (scripts/source-doc-map.json) and flags code that shipped
 * without its mapped doc. Every rule is registry-driven — no hardcoded project paths —
 * so the same runner works in any repo.
 *
 * Usage:
 *   node scripts/govkit-docsync.mjs audit [--gate|--warn] [--base <ref>]
 *   node scripts/govkit-docsync.mjs report
 *
 * Modes:
 *   --warn   Never exit non-zero. Print findings. Use on dev push.
 *   --gate   Exit 1 if any GATING finding exists. Use on PR to main.
 *
 * Registries (all optional; absent registry = rule no-ops):
 *   scripts/source-doc-map.json      { "mappings": [ { "source": [globs], "docs": [paths], "severity"?: "gate"|"warn" } ] }
 *   scripts/compliance-doc-map.json  { "rules":    [ { "id", "triggers": [globs], "requiredDocs": [paths] } ] }  // always gate; escape via COMPLIANCE_DOC_REVIEWED=true
 *
 * Zero dependencies: Node built-ins + git only.
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const SOURCE_DOC_MAP = "scripts/source-doc-map.json";
const COMPLIANCE_DOC_MAP = "scripts/compliance-doc-map.json";
const DOCS_DIR = "docs";

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Simple glob: ** = any path (incl. /), * = any run of non-slash chars. */
function matchesGlob(filePath, pattern) {
  const regexStr = pattern
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*\*/g, "{{GLOBSTAR}}")
    .replace(/\*/g, "[^/]*")
    .replace(/\{\{GLOBSTAR\}\}/g, ".*");
  return new RegExp(`^${regexStr}$`).test(filePath);
}

function git(args) {
  return execFileSync("git", ["-c", "core.quotepath=off", ...args], {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** PR-wide diff: everything since this branch diverged from base. Falls back to HEAD~1. */
function gitChangedFiles(base) {
  for (const range of [`${base}...HEAD`, "HEAD~1..HEAD"]) {
    try {
      const files = git(["diff", "--name-only", "--diff-filter=ACMR", range]).split("\n").filter(Boolean);
      return { range, files };
    } catch {
      // try next range
    }
  }
  return { range: null, files: [] };
}

/** Files the diff renamed (git rename detection, -M): [{ from, to }]. */
function gitRenames(range) {
  const renames = [];
  for (const line of git(["diff", "--name-status", "-M", "--diff-filter=R", range]).split("\n")) {
    const [status, from, to] = line.split("\t");
    if (status?.startsWith("R") && from && to) renames.push({ from, to });
  }
  return renames;
}

/**
 * True when every line that differs in `file` only rewrites a path the same diff renamed: each
 * removed line, with the renamed paths replaced by their new ones, is one of the added lines, one
 * for one. A single other changed line, and the file counts as changed (#52).
 */
function onlyRenamedPaths(range, file, renames) {
  if (renames.length === 0) return false;
  let diff;
  try {
    diff = git(["diff", "-U0", "--no-color", "--no-ext-diff", "-M", range, "--", file]);
  } catch {
    return false;
  }
  // a file that was itself added, deleted or renamed is a real change
  if (/^(new file|deleted file|rename from|similarity index)/m.test(diff)) return false;
  const removed = [];
  const added = [];
  for (const line of diff.split("\n")) {
    if (line.startsWith("---") || line.startsWith("+++")) continue;
    if (line.startsWith("-")) removed.push(line.slice(1));
    else if (line.startsWith("+")) added.push(line.slice(1));
  }
  if (removed.length === 0 || removed.length !== added.length) return false;
  // longest first, so docs/a/B.md is not rewritten through a shorter docs/a rename
  const sorted = [...renames].sort((a, b) => b.from.length - a.from.length);
  const pattern = new RegExp(sorted.map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "g");
  const to = new Map(sorted.map((r) => [r.from, r.to]));
  const pending = new Map();
  for (const line of added) pending.set(line, (pending.get(line) ?? 0) + 1);
  for (const line of removed) {
    const rewritten = line.replace(pattern, (m) => to.get(m));
    if (rewritten === line) return false; // a removed line that names no renamed path
    const n = pending.get(rewritten) ?? 0;
    if (n === 0) return false;
    pending.set(rewritten, n - 1);
  }
  return true;
}

function loadJson(path, fallback) {
  if (!existsSync(path)) return fallback;
  try {
    return JSON.parse(readFileSync(path, "utf-8"));
  } catch (err) {
    console.error(`⚠️  Could not parse ${path}: ${err.message}`);
    return fallback;
  }
}

function requiredDocSatisfied(requiredDoc, changed) {
  return requiredDoc.endsWith("/")
    ? changed.some((f) => f.startsWith(requiredDoc))
    : changed.includes(requiredDoc);
}

function walk(dir, ext) {
  const out = [];
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name).replace(/\\/g, "/");
    if (entry.isDirectory()) out.push(...walk(full, ext));
    else if (!ext || entry.name.endsWith(ext)) out.push(full);
  }
  return out;
}

/** Minimal YAML-frontmatter reader — just the scalar keys we need (no dep). */
function readFrontmatter(content) {
  const m = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const data = {};
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z0-9_]+):\s*(.*)$/);
    if (kv) data[kv[1]] = kv[2].replace(/^["']|["']$/g, "").trim();
  }
  return data;
}

// ── Rules ────────────────────────────────────────────────────────────────────

function ruleSourceDocMap(changed, pathOnly = new Set()) {
  const findings = [];
  const { mappings = [] } = loadJson(SOURCE_DOC_MAP, { mappings: [] });
  for (const mapping of mappings) {
    const severity = mapping.severity === "warn" ? "warn" : "gate";
    const hit = changed.filter(
      (f) => !pathOnly.has(f) && mapping.source.some((p) => matchesGlob(f, p)),
    );
    if (hit.length === 0) continue;
    const missing = mapping.docs.filter((doc) => !requiredDocSatisfied(doc, changed));
    if (missing.length === 0) continue;
    const sample =
      hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` (+${hit.length - 3} more)` : "");
    for (const doc of missing) {
      findings.push({
        rule: "source-doc-map",
        severity,
        message: `Source changed: ${sample} → mapped doc not updated: ${doc}`,
        action: `Update ${doc} in this PR, or justify why the change doesn't affect it.`,
      });
    }
  }
  return findings;
}

function ruleComplianceDocSync(changed, reviewed) {
  const findings = [];
  if (reviewed) return findings;
  const { rules = [] } = loadJson(COMPLIANCE_DOC_MAP, { rules: [] });
  for (const rule of rules) {
    const hit = changed.filter((f) => rule.triggers.some((p) => matchesGlob(f, p)));
    if (hit.length === 0) continue;
    if (rule.requiredDocs.some((doc) => requiredDocSatisfied(doc, changed))) continue;
    const sample =
      hit.slice(0, 3).join(", ") + (hit.length > 3 ? ` (+${hit.length - 3} more)` : "");
    findings.push({
      rule: "compliance-doc-sync",
      severity: "gate",
      message: `Compliance code changed (${rule.id}): ${sample} → none of its canonical docs were updated.`,
      action: `Update one of: ${rule.requiredDocs.join(", ")} — or set COMPLIANCE_DOC_REVIEWED=true if genuinely doc-irrelevant.`,
    });
  }
  return findings;
}

// ── Subcommands ──────────────────────────────────────────────────────────────

function runAudit({ mode, base }) {
  const { range, files: changed } = gitChangedFiles(base);
  console.log("\n📋 govkit-docsync audit");
  console.log("═".repeat(72));
  console.log(`Mode: ${mode}   Base: ${base}   Changed files: ${changed.length}`);
  console.log("═".repeat(72));

  if (changed.length === 0) {
    console.log("\n✅ No changes since base — nothing to check.\n");
    return;
  }

  // A source file whose only change rewrites a renamed path (a docs move) has not changed (#52).
  const renames = gitRenames(range);
  const pathOnly = new Set(changed.filter((f) => onlyRenamedPaths(range, f, renames)));
  if (pathOnly.size > 0) {
    console.log(`\nNot counted as changed (only a renamed path rewritten): ${[...pathOnly].join(", ")}`);
  }

  const findings = [
    ...ruleSourceDocMap(changed, pathOnly),
    ...ruleComplianceDocSync(changed, process.env.COMPLIANCE_DOC_REVIEWED === "true"),
  ];
  const gating = findings.filter((f) => f.severity === "gate");
  const warnings = findings.filter((f) => f.severity === "warn");

  for (const [label, list] of [
    ["🛑 GATING", gating],
    ["⚠️  WARNINGS", warnings],
  ]) {
    if (list.length === 0) continue;
    console.log(`\n${label} (${list.length}):`);
    for (const f of list) {
      console.log(`\n   [${f.rule}] ${f.message}`);
      if (f.action) console.log(`   → ${f.action}`);
    }
  }

  if (findings.length === 0) {
    console.log("\n✅ No drift detected.\n");
    return;
  }

  console.log(`\n${"═".repeat(72)}`);
  console.log(`Summary: ${gating.length} gating, ${warnings.length} warnings.`);
  if (mode === "gate" && gating.length > 0) {
    console.log("\n❌ GATE FAILED — resolve gating findings before merging to main.\n");
    process.exit(1);
  }
  if (mode === "warn" && findings.length > 0) {
    console.log("\n💡 Warn mode — gating findings would block at the PR-to-main gate.\n");
  } else {
    console.log("\n✅ Gate passed.\n");
  }
}

function runReport() {
  console.log("\n📋 govkit-docsync report");
  console.log("═".repeat(72));
  const docs = walk(DOCS_DIR, ".md");
  const stale = [];
  for (const file of docs) {
    const data = readFrontmatter(readFileSync(file, "utf-8"));
    if (!data.last_updated || data.status === "archived") continue;
    const t = Date.parse(data.last_updated);
    if (Number.isNaN(t)) continue;
    const days = Math.floor((Date.now() - t) / 86_400_000);
    if (days > 30) stale.push({ file, days });
  }
  stale.sort((a, b) => b.days - a.days);
  console.log(`\n📅 Stale docs (>30 days last_updated): ${stale.length}`);
  for (const s of stale.slice(0, 15)) console.log(`   ${s.days}d  ${s.file}`);
  if (stale.length > 15) console.log(`   ... and ${stale.length - 15} more`);
  console.log(`\n${"═".repeat(72)}\nDone.\n`);
}

// ── Main ─────────────────────────────────────────────────────────────────────

const args = process.argv.slice(2);
const sub = args[0];

if (!sub || sub === "--help" || sub === "-h") {
  console.log(`govkit-docsync — Documentation Sync Watchdog

Usage:
  node scripts/govkit-docsync.mjs audit [--gate|--warn] [--base <ref>]
  node scripts/govkit-docsync.mjs report

audit modes:  --warn (never fails; dev push)   --gate (fails on gating; PR to main)
audit options: --base <ref>   base for the diff (default origin/main)`);
} else if (sub === "audit") {
  const mode = args.includes("--gate") ? "gate" : "warn";
  const bi = args.indexOf("--base");
  const base = bi >= 0 && args[bi + 1] ? args[bi + 1] : "origin/main";
  runAudit({ mode, base });
} else if (sub === "report") {
  runReport();
} else {
  console.error(`Unknown subcommand: ${sub}. Run with --help.`);
  process.exit(2);
}
