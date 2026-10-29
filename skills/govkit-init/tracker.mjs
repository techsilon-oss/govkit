#!/usr/bin/env node
/**
 * tracker — set up govkit's tracker module: work in GitHub Issues (#14).
 *
 * This script never writes to GitHub. It reads (which labels are missing, how many issues are
 * pinned) and records decisions in govkit.json. /govkit-init shows the user every GitHub change
 * (labels, the decision register issue, the pin) and makes it with `gh` only after a yes.
 *
 * Usage (from the repo root):
 *   node tracker.mjs labels [--json]          # missing labels, and type labels the repo has under a default name
 *   node tracker.mjs record-aliases           # record those names (labelAliases) in govkit.json
 *   node tracker.mjs pins [--json]            # pinned issues: how many, and whether one is free
 *   node tracker.mjs enable --categories a,b,c,d [--launch-event "…"] [--areas x,y]
 *   node tracker.mjs decline --reason "…"
 *   node tracker.mjs record-register <issue number>
 */

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { objectEnd, stable, symlinkOnPath } from "./upgrade.mjs";

/** Launch categories: exactly one per open issue. A launched product reads better with these. */
export const DEFAULT_CATEGORIES = ["pre-launch", "post-launch", "idea", "triage"];
export const LAUNCHED_CATEGORIES = ["now", "next", "later", "triage"];
/** GitHub pins at most this many issues per repo. */
export const PIN_LIMIT = 3;

const TYPE = [
  ["bug", "d73a4a", "Something is broken"],
  ["enhancement", "a2eeef", "New feature, user story or improvement"],
  ["idea", "fbca04", "A concept that is not validated yet"],
  ["docs", "0075ca", "Documentation only"],
  ["refactor", "c5def5", "Code quality, no change in behavior"],
];
const STATUS = [
  ["in-progress", "0e8a16", "Someone is working on it now"],
  ["blocked", "b60205", "Waiting on something outside the team"],
  ["needs-decision", "d93f0b", "An owner must decide before work continues (see the decision register)"],
  ["fix-shipped", "5319e7", "Fix merged to the release branch, not re-tested yet"],
  ["business", "bfdadc", "Non-engineering work: marketing, legal, research, operations"],
];
const CATEGORY_COLOR = "1d76db";

/** Every label the tracker uses, for these settings. Names are compared case-insensitively. */
export function desiredLabels({ categories = DEFAULT_CATEGORIES, areaLabels = [] } = {}) {
  const out = [];
  const add = (name, color, description) => {
    if (!out.some((l) => l.name.toLowerCase() === name.toLowerCase())) out.push({ name, color, description });
  };
  for (const [n, c, d] of TYPE) add(n, c, `Type: ${d}`);
  for (const n of categories) add(n, CATEGORY_COLOR, "Launch category (exactly one per open issue)");
  for (const n of areaLabels) add(n, "c2e0c6", "Area");
  for (const [n, c, d] of STATUS) add(n, c, d);
  return out;
}

/**
 * Type labels that GitHub's default label set names differently. A repo that has the default
 * name keeps it: no duplicate is created, and the mapping is recorded in govkit.json
 * (guardrails.tracker.issues.labelAliases) so the rules and the report use the repo's name.
 * bug and enhancement already match GitHub's defaults.
 */
export const TYPE_ALIASES = { docs: ["documentation"] };

/**
 * What the repo lacks, and which tracker labels it already has under another name.
 * Names compare case-insensitively; an alias keeps the repo's exact spelling. A tracker label
 * present under its own name wins over an alias.
 */
export function resolveLabels(desired, existingNames) {
  const byLower = new Map(existingNames.map((n) => [n.toLowerCase(), n]));
  const missing = [];
  const aliases = {};
  for (const l of desired) {
    if (byLower.has(l.name.toLowerCase())) continue;
    const alias = (TYPE_ALIASES[l.name] ?? []).map((a) => byLower.get(a.toLowerCase())).find(Boolean);
    if (alias) aliases[l.name] = alias;
    else missing.push(l);
  }
  return { missing, aliases };
}

/** Only the labels the repo lacks. Existing labels are never touched, whatever their color. */
export const missingLabels = (desired, existingNames) => resolveLabels(desired, existingNames).missing;

export const pinCapacity = (pinned) => ({ pinned, limit: PIN_LIMIT, free: Math.max(0, PIN_LIMIT - pinned) });

// ------------------------------------------------------------------ govkit.json, edited in place

const readText = (p) => readFileSync(p, "utf-8").replace(/\r\n/g, "\n");
const indent = (json, spaces) => json.replace(/\n/g, `\n${" ".repeat(spaces)}`);

/**
 * govkit.json with guardrails.tracker set to `tracker`, edited as text so the file's own layout
 * survives, and proven by re-parsing. Returns { text, reformatted }.
 */
export function withTracker(text, tracker) {
  const want = JSON.parse(text);
  want.guardrails ??= {};
  want.guardrails.tracker = tracker;
  const body = indent(JSON.stringify(tracker, null, 2), 4);
  let out = null;
  const found = [...text.matchAll(/"tracker"\s*:\s*\{/g)];
  if (found.length === 1) {
    const open = text.indexOf("{", found[0].index);
    const end = objectEnd(text, open);
    if (end > 0) out = `${text.slice(0, open)}${body}${text.slice(end)}`;
  } else if (found.length === 0) {
    const g = /"guardrails"\s*:\s*\{/.exec(text);
    const end = g ? objectEnd(text, text.indexOf("{", g.index)) : -1;
    if (end > 0) {
      const head = text.slice(0, end - 1).trimEnd();
      const sep = head.endsWith("{") ? "" : ",";
      out = `${head}${sep}\n\n    "tracker": ${body}\n  ${text.slice(end - 1)}`;
    }
  }
  try {
    if (out !== null && stable(JSON.parse(out)) === stable(want)) return { text: out, reformatted: false };
  } catch {
    // fall through to a full rewrite
  }
  return { text: `${JSON.stringify(want, null, 2)}\n`, reformatted: true };
}

function updateTracker(root, change) {
  const link = symlinkOnPath(root, "govkit.json");
  if (link) throw new Error(`${link} is a symlink; govkit writes only regular files inside the repo`);
  const p = join(root, "govkit.json");
  const text = readText(p);
  const current = JSON.parse(text).guardrails?.tracker ?? {};
  const next = change(structuredClone(current));
  const { text: out, reformatted } = withTracker(text, next);
  writeFileSync(p, out);
  return { tracker: next, reformatted };
}

const list = (s) => (s ? String(s).split(",").map((x) => x.trim()).filter(Boolean) : []);

export function enable(root, { categories = DEFAULT_CATEGORIES, launchEvent = null, areaLabels = [] } = {}) {
  if (categories.length < 2) throw new Error("give at least two launch categories (one of them for triage)");
  return updateTracker(root, (t) => ({
    ...t,
    enabled: true,
    issues: { ...(t.issues ?? {}), register: t.issues?.register ?? null, launchEvent, categories, areaLabels },
  }));
}

export function decline(root, reason) {
  if (!reason || !String(reason).trim()) throw new Error("a reason is required: it is what makes a skip a decision");
  return updateTracker(root, (t) => ({ ...t, enabled: false, skippedReason: String(reason).trim() }));
}

/** Record the type labels this repo has under another name (resolveLabels' `aliases`). */
export function recordAliases(root, aliases) {
  return updateTracker(root, (t) => {
    const issues = { ...(t.issues ?? {}) };
    if (Object.keys(aliases).length) issues.labelAliases = aliases;
    else delete issues.labelAliases;
    return { ...t, issues };
  });
}

export function recordRegister(root, value) {
  const n = Number(value);
  if (!/^\d+$/.test(String(value)) || !Number.isInteger(n) || n < 1) throw new Error(`"${value}" is not an issue number`);
  return updateTracker(root, (t) => ({ ...t, issues: { ...(t.issues ?? {}), register: n } }));
}

// ------------------------------------------------------------------ reading GitHub (gh)

const gh = (args) => execFileSync("gh", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

function pinnedCount() {
  const { owner, name } = JSON.parse(gh(["repo", "view", "--json", "owner,name"]));
  const q = "query($o:String!,$r:String!){repository(owner:$o,name:$r){pinnedIssues(first:3){totalCount}}}";
  const out = JSON.parse(gh(["api", "graphql", "-f", `query=${q}`, "-f", `o=${owner.login}`, "-f", `r=${name}`]));
  return out.data.repository.pinnedIssues.totalCount;
}

// ------------------------------------------------------------------ CLI

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const [cmd, ...rest] = process.argv.slice(2);
  const opt = (name) => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const json = rest.includes("--json");
  const root = process.cwd();
  try {
    if (cmd === "labels" || cmd === "record-aliases") {
      const t = JSON.parse(readText(join(root, "govkit.json"))).guardrails?.tracker ?? {};
      const existing = JSON.parse(gh(["label", "list", "--limit", "1000", "--json", "name"])).map((l) => l.name);
      const { missing, aliases } = resolveLabels(desiredLabels(t.issues ?? {}), existing);
      if (cmd === "record-aliases") {
        const r = recordAliases(root, aliases);
        const pairs = Object.entries(aliases).map(([a, b]) => `${a} → ${b}`).join(", ");
        console.log(`tracker: label aliases ${pairs || "(none)"}${r.reformatted ? " (govkit.json was reformatted)" : ""}`);
      } else if (json) console.log(JSON.stringify({ missing, aliases }, null, 2));
      else {
        for (const [a, b] of Object.entries(aliases)) console.log(`Uses the repo's "${b}" for "${a}" (a GitHub default name): no duplicate is created.`);
        if (!missing.length) console.log("Every tracker label already exists. Nothing to create.");
        else {
          console.log(`Missing labels (${missing.length}); existing labels are left as they are:`);
          for (const l of missing) console.log(`  ${l.name.padEnd(16)} #${l.color}  ${l.description}`);
        }
      }
    } else if (cmd === "pins") {
      const c = pinCapacity(pinnedCount());
      if (json) console.log(JSON.stringify(c));
      else console.log(c.free ? `${c.pinned} of ${c.limit} pinned issues used: one more can be pinned.` : `All ${c.limit} pinned issues are in use. govkit never unpins yours: choose one to unpin yourself, or leave the register unpinned.`);
    } else if (cmd === "enable") {
      const r = enable(root, { categories: list(opt("categories")).length ? list(opt("categories")) : DEFAULT_CATEGORIES, launchEvent: opt("launch-event") ?? null, areaLabels: list(opt("areas")) });
      console.log(`tracker: on, categories ${r.tracker.issues.categories.join(" / ")}${r.reformatted ? " (govkit.json was reformatted)" : ""}`);
    } else if (cmd === "decline") {
      const r = decline(root, opt("reason"));
      console.log(`tracker: off, reason recorded${r.reformatted ? " (govkit.json was reformatted)" : ""}`);
    } else if (cmd === "record-register") {
      const r = recordRegister(root, rest[0]);
      console.log(`tracker: decision register is #${r.tracker.issues.register}${r.reformatted ? " (govkit.json was reformatted)" : ""}`);
    } else {
      console.error("usage: tracker.mjs labels [--json] | record-aliases | pins [--json] | enable --categories a,b,c,d [--launch-event …] [--areas x,y] | decline --reason … | record-register <n>");
      process.exit(2);
    }
  } catch (e) {
    console.error(`\n  ✗ ${e.message}\n`);
    process.exit(1);
  }
}
