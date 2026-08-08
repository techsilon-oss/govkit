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
 * Dependency-free: Node built-ins only. No git, no network, no install step.
 *
 * Usage:
 *   node scripts/govkit-doctor.mjs           # report; exit 0 always
 *   node scripts/govkit-doctor.mjs --ci      # exit 1 if anything is MISSING
 *   node scripts/govkit-doctor.mjs config    # print the manifest as a readable table
 */

import { existsSync, readFileSync } from "node:fs";

const MANIFEST = "govkit.json";

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

  const absentFiles = (g.expects ?? []).filter((f) => !existsSync(f));
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
}

for (const [name, items] of missing) {
  console.log(`  ❌ ${name} — declared on, but not installed:`);
  for (const i of items) console.log(`        missing ${i}`);
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
if (existsSync("scripts/sdlc-docs.mjs") && !known.has("doc-sync")) strays.push("scripts/sdlc-docs.mjs");
if (strays.length) {
  console.log(`  ⚠️  Installed but not in the manifest — govkit will not maintain these:`);
  for (const s of strays) console.log(`        ${s}`);
  console.log("");
}

process.exit(process.argv.includes("--ci") && missing.length > 0 ? 1 : 0);
