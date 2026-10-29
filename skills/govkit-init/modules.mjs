#!/usr/bin/env node
/**
 * modules — govkit's module notes, from module.json at the plugin root.
 *
 * WHY THIS EXISTS
 * ---------------
 * The kit standard (techsilon-oss KIT-STANDARD.md) wants each module explained once, in plain
 * words, before the user says yes: what you get, what changes outside the repo, the cost, how to
 * undo it, and where to read more. module.json is that one place. /govkit-init prints the notes
 * from here, and tools/build-module-table.mjs builds the README table from here, so the three
 * can't drift apart.
 *
 * Dependency-free: Node built-ins only. It reads; it writes nothing.
 *
 * Usage:
 *   node modules.mjs notes [--json] [<id>...]   # every module, or the ones named
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { guideUrl, pluginVersion } from "./upgrade.mjs";

const SELF = fileURLToPath(import.meta.url);
export const PLUGIN_ROOT = resolve(dirname(SELF), "..", "..");
export const NOTE_FIELDS = ["youGet", "changesOutsideRepo", "costs", "undo", "readMore"];

export function loadModules(root = PLUGIN_ROOT) {
  return JSON.parse(readFileSync(join(root, "module.json"), "utf-8")).modules;
}

// A guide link is pinned to the installed release (the user's version, not main), so its steps
// and anchors match what they run. One helper for every govkit script that prints a link.
export { guideUrl, pluginVersion };

/** One module's note, as the user sees it before saying yes. */
export function noteText(m, version = pluginVersion()) {
  const lines = [`${m.title}  (${m.id}; ${m.default === "opt-in" ? "opt-in: off unless you choose it" : "on unless you skip it"})`];
  if (m.condition) lines.push(`  When: ${m.condition}`);
  lines.push(`  You get: ${m.youGet}`);
  lines.push(`  It changes, outside your code: ${m.changesOutsideRepo}`);
  lines.push(`  It costs: ${m.costs}`);
  lines.push(`  To undo: ${m.undo}`);
  lines.push(`  Files: ${m.files.join(", ")}`);
  lines.push(`  Read more: ${guideUrl(m.readMore, version)}`);
  if (!m.skippable) lines.push("  (Not skippable: every other guardrail depends on it.)");
  return lines.join("\n");
}

/** The README's module table, generated: one row per module, linking its guide. */
export function moduleTable(modules) {
  const esc = (s) => s.replace(/\|/g, "\\|");
  const rows = modules.map(
    (m) =>
      `| [\`${m.id}\`](${m.readMore}) | ${esc(m.youGet)} | ${esc(m.changesOutsideRepo)} | ${esc(m.costs)} | ${m.default === "opt-in" ? "opt-in" : m.skippable ? "on (skippable)" : "on (required)"} |`,
  );
  return [
    "| Module | You get | Changes outside your code | Costs | Default |",
    "|---|---|---|---|---|",
    ...rows,
  ].join("\n");
}

const isMain = process.argv[1] && resolve(process.argv[1]) === SELF;
if (isMain) {
  const [cmd, ...rest] = process.argv.slice(2);
  const json = rest.includes("--json");
  const ids = rest.filter((a) => !a.startsWith("--"));
  if (cmd !== "notes") {
    console.error("usage: modules.mjs notes [--json] [<id>...]");
    process.exit(2);
  }
  const all = loadModules();
  const unknown = ids.filter((id) => !all.some((m) => m.id === id));
  if (unknown.length) {
    console.error(`unknown module(s): ${unknown.join(", ")}; known: ${all.map((m) => m.id).join(", ")}`);
    process.exit(1);
  }
  const chosen = ids.length ? all.filter((m) => ids.includes(m.id)) : all;
  if (json) console.log(JSON.stringify(chosen, null, 2));
  else console.log(chosen.map((m) => noteText(m)).join("\n\n"));
}
