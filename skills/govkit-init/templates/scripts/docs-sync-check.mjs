#!/usr/bin/env node
/**
 * docs-sync-check — bootstrap-doc freshness + repo ground truth.
 *
 * WHY THIS EXISTS
 * ---------------
 * `sdlc-docs.mjs` answers "did a PR change code without changing its mapped doc?" That is a
 * per-PR question. It cannot catch the failure this repo actually kept hitting: a tracker that
 * confidently ASSERTS something the repo contradicts — "no `main` branch", "nothing has ever been
 * deployed", "zero GitHub issues", "`dev` is the default branch". Every one of those was written
 * true and became false, and each survived because nothing compared the prose to reality.
 *
 * Three sessions in a row lost time to it. So this script does two things:
 *
 *   1. STALENESS — every bootstrap doc declares a date ("last checked 2026-08-08"). If code has
 *      been committed since that date, the doc is stale by definition. This is a hard check.
 *   2. GROUND TRUTH — prints what git and gh actually report, so a session starts by reading facts
 *      instead of trusting prose. Cheap to eyeball, and it is where the contradictions show up.
 *
 * Deliberately NOT natural-language contradiction detection. It prints the facts next to the
 * claims and lets a human or an agent see the mismatch — a heuristic that tried to parse the
 * assertions would be wrong in both directions and trusted in neither.
 *
 * Dependency-free: Node built-ins + git. `gh` is optional and degrades to "unknown".
 *
 * Usage:
 *   node scripts/docs-sync-check.mjs          # report, exit 0 unless a doc is missing
 *   node scripts/docs-sync-check.mjs --ci     # exit 1 on stale or missing docs
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

/**
 * Config comes from govkit.json when present, so a project tunes this without forking the script.
 * The defaults match govkit's own tracker convention.
 */
function manifestConfig() {
  try {
    const m = JSON.parse(readFileSync("govkit.json", "utf-8"));
    return m?.guardrails?.["docs-sync-check"] ?? {};
  } catch {
    return {};
  }
}
const CFG = manifestConfig();

/** Docs that bootstrap a session's context. */
const BOOTSTRAP_DOCS = (CFG.bootstrapDocs ?? [
  "docs/PROJECT-HUB.md",
  "docs/PRIORITY-ROADMAP.md",
  "CLAUDE.md",
]).map((path) => ({ path }));

/**
 * Paths whose modification invalidates a stale tracker. `docs/` is deliberately excluded:
 * updating one doc must not mark every other doc stale, or the check cries wolf and gets ignored.
 */
const WATCHED = CFG.watchedPaths ?? ["src/", "scripts/", "package.json", ".github/"];

/** Dates a doc may declare. First match wins; all are ISO so string compare is date compare. */
const DATE_PATTERNS = [
  // `[:\s]+`, not a bare space: real docs write "last reviewed: 2026-07-12" as often as without
  // the colon. A parser that accepts only one form reports "declares no date" for a doc that
  // declares one — pushing someone to add a SECOND date line, which then drifts from the first.
  /last checked[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /last reviewed[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /as of[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /last_updated:\s*"?(\d{4}-\d{2}-\d{2})/i,
];

const git = (args, fallback = "") => {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return fallback;
  }
};

const gh = (args) => {
  try {
    return execFileSync("gh", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null; // gh missing or unauthenticated — not a failure, just unknown
  }
};

/** Most recent commit date (YYYY-MM-DD) touching any watched path. */
function lastCodeChangeDate() {
  const out = git(["log", "-1", "--format=%ad", "--date=short", "--", ...WATCHED]);
  return out || null;
}

function declaredDate(content) {
  for (const re of DATE_PATTERNS) {
    const m = content.match(re);
    if (m) return m[1];
  }
  return null;
}

// ---------------------------------------------------------------- ground truth

function groundTruth() {
  const facts = [];
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"], "unknown");
  facts.push(["current branch", branch]);

  const mainExists = git(["rev-parse", "--verify", "--quiet", "refs/heads/main"]) !== "";
  facts.push(["main exists locally", mainExists ? "yes" : "NO"]);

  if (mainExists) {
    const ahead = git(["rev-list", "--count", "main..HEAD"], "?");
    const behind = git(["rev-list", "--count", "HEAD..main"], "?");
    facts.push([`${branch} vs main`, `${ahead} ahead, ${behind} behind`]);
  }

  const dirty = git(["status", "--porcelain"]);
  facts.push([
    "working tree",
    dirty ? `${dirty.split("\n").length} file(s) uncommitted` : "clean",
  ]);

  const remotes = git(["ls-remote", "--heads", "origin"]);
  if (remotes) {
    const names = remotes
      .split("\n")
      .map((l) => l.split("refs/heads/")[1])
      .filter(Boolean);
    facts.push(["remote branches", names.join(", ")]);
  }

  const defaultBranch = gh([
    "repo",
    "view",
    "--json",
    "defaultBranchRef",
    "--jq",
    ".defaultBranchRef.name",
  ]);
  facts.push(["GitHub default branch", defaultBranch ?? "unknown (gh unavailable)"]);

  const openIssues = gh([
    "issue",
    "list",
    "--state",
    "open",
    "--limit",
    "100",
    "--json",
    "number",
    "--jq",
    "length",
  ]);
  facts.push(["open issues", openIssues ?? "unknown (gh unavailable)"]);

  const lastRun = gh([
    "run",
    "list",
    "--limit",
    "1",
    "--json",
    "conclusion,headBranch",
    "--jq",
    '.[0] | "\\(.conclusion) on \\(.headBranch)"',
  ]);
  // gh renders an empty run list as the string "null on null" via jq interpolation, not as an
  // empty result — so test for the substring, not equality, or a repo with no CI reads as a run.
  facts.push([
    "last CI run",
    lastRun && !lastRun.includes("null") ? lastRun : "none ever",
  ]);

  return facts;
}

// ---------------------------------------------------------------------- main

const ci = process.argv.includes("--ci");
const codeDate = lastCodeChangeDate();

console.log(
  "\n\u2500\u2500 Repo ground truth \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500",
);
console.log(
  "   Compare these against what the trackers claim. Mismatches are the bug.\n",
);
for (const [k, v] of groundTruth()) console.log(`   ${k.padEnd(24)} ${v}`);

console.log(
  `\n\u2500\u2500 Bootstrap doc freshness \u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500\u2500`,
);
console.log(`   Newest watched-code commit: ${codeDate ?? "unknown"}\n`);

const problems = [];

for (const doc of BOOTSTRAP_DOCS) {
  if (!existsSync(doc.path)) {
    console.log(`   \u274c ${doc.path} \u2014 MISSING`);
    problems.push(`${doc.path} is missing`);
    continue;
  }

  const declared = declaredDate(readFileSync(doc.path, "utf-8"));

  if (!declared) {
    console.log(`   \u26a0\ufe0f  ${doc.path} \u2014 declares no date`);
    console.log(
      `        add a line like "last checked ${codeDate ?? "YYYY-MM-DD"}" so staleness is checkable`,
    );
    problems.push(`${doc.path} declares no date`);
    continue;
  }

  if (codeDate && declared < codeDate) {
    console.log(
      `   \u274c ${doc.path} \u2014 STALE: says ${declared}, code moved ${codeDate}`,
    );
    problems.push(`${doc.path} is stale (${declared} < ${codeDate})`);
  } else {
    console.log(`   \u2705 ${doc.path} \u2014 ${declared}`);
  }
}

console.log("");

if (problems.length === 0) {
  console.log("\u2705 Bootstrap docs are current.\n");
  process.exit(0);
}

console.log(`${ci ? "\u274c" : "\u26a0\ufe0f "} ${problems.length} problem(s):`);
for (const p of problems) console.log(`   \u2022 ${p}`);
console.log(
  "\nStale does not always mean wrong \u2014 but it means unverified. Re-read the doc against the\n" +
    "ground truth above, fix what has drifted, then update its declared date in the same commit.\n",
);

process.exit(ci ? 1 : 0);
