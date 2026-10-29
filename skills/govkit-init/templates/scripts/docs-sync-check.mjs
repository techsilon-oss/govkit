#!/usr/bin/env node
/**
 * docs-sync-check — bootstrap-doc freshness + repo ground truth.
 *
 * WHY THIS EXISTS
 * ---------------
 * `govkit-docsync.mjs` answers "did a PR change code without changing its mapped doc?" That is a
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

/** The release branch, as govkit.json names it. Same lookup as release-version.mjs. */
function releaseBranch() {
  try {
    return JSON.parse(readFileSync("govkit.json", "utf-8"))?.branches?.release ?? "main";
  } catch {
    return "main";
  }
}
const RELEASE = releaseBranch();

/** Docs that bootstrap a session's context. */
const BOOTSTRAP_DOCS = (CFG.bootstrapDocs ?? [
  "docs/PROJECT-HUB.md",
  "docs/PRIORITY-ROADMAP.md",
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

const LS_REMOTE_TIMEOUT_MS = 8000;

/**
 * What origin holds right now (one ls-remote, no fetch): `{ heads: Map<name, sha> }`, or
 * `{ error }` saying why not. It is git's only network call here, so it gets the session hook's
 * 8 s bound: a hung remote must not hang the session's first command. Unlike `git()`, it keeps
 * the reason: "timed out" and "refused" send someone to different fixes, so one must not be
 * reported as the other.
 */
function lsRemoteHeads() {
  try {
    const out = execFileSync("git", ["ls-remote", "--heads", "origin"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
      timeout: LS_REMOTE_TIMEOUT_MS,
      // Fail instead of waiting on a credential prompt nobody will answer.
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0" },
    });
    return {
      heads: new Map(
        out
          .split("\n")
          .map((l) => l.split(/\s+refs\/heads\//))
          .filter(([sha, name]) => sha && name)
          .map(([sha, name]) => [name, sha]),
      ),
    };
  } catch (e) {
    if (e.code === "ETIMEDOUT" || e.signal === "SIGTERM") {
      return { error: `timed out after ${LS_REMOTE_TIMEOUT_MS / 1000} s` };
    }
    // Over ssh, git follows the specific cause ("ERROR: Repository not found.", "ssh: Could not
    // resolve hostname …") with boilerplate that is the same for every failure. Skip it.
    const boilerplate =
      /could not read from remote repository|^please make sure you have|^and the repository exists/i;
    const lines = String(e.stderr ?? "")
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    const reason = lines.find((l) => !boilerplate.test(l)) ?? lines[0] ?? e.message;
    // Shorten from the middle: a long URL or path sits in the middle, the cause at the end.
    const r = reason.replace(/^(fatal|error):\s*/i, "");
    return { error: `failed: ${r.length > 100 ? `${r.slice(0, 40)}…${r.slice(-59)}` : r}` };
  }
}

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

  const localRelease = git(["rev-parse", "--verify", "--quiet", `refs/heads/${RELEASE}`]);
  const trackedRelease = git([
    "rev-parse",
    "--verify",
    "--quiet",
    `refs/remotes/origin/${RELEASE}`,
  ]);
  facts.push([`${RELEASE} exists locally`, localRelease ? "yes" : "NO"]);

  const hasOrigin = git(["remote", "get-url", "origin"]) !== "";
  const remote = hasOrigin ? lsRemoteHeads() : { heads: new Map() };
  const remoteHeads = remote.heads ?? new Map();

  // Compare against origin's release branch, not the local one. A local release branch is only
  // as current as its last pull, and is often far behind: one consumer read "89 ahead, 17 behind"
  // when the truth was 9 and 23. The local ref is the fallback for a repo with no remote.
  const base = trackedRelease ? `origin/${RELEASE}` : localRelease ? RELEASE : null;
  if (base) {
    const ahead = git(["rev-list", "--count", `${base}..HEAD`], "?");
    const behind = git(["rev-list", "--count", `HEAD..${base}`], "?");
    facts.push([`${branch} vs ${base}`, `${ahead} ahead, ${behind} behind`]);
  }

  // The remote-tracking ref is itself only as fresh as the last fetch. Say so when origin has moved.
  const liveRelease = remoteHeads.get(RELEASE);
  if (trackedRelease && liveRelease && liveRelease !== trackedRelease) {
    facts.push([
      `origin/${RELEASE}`,
      "STALE: origin has moved since the last fetch; run `git fetch` and re-run",
    ]);
  }

  if (localRelease && trackedRelease && localRelease !== trackedRelease) {
    const behind = git(["rev-list", "--count", `${RELEASE}..origin/${RELEASE}`], "?");
    const ahead = git(["rev-list", "--count", `origin/${RELEASE}..${RELEASE}`], "?");
    facts.push([
      `local ${RELEASE}`,
      `${behind} behind, ${ahead} ahead of origin/${RELEASE}`,
    ]);
  }

  const dirty = git(["status", "--porcelain"]);
  facts.push([
    "working tree",
    dirty ? `${dirty.split("\n").length} file(s) uncommitted` : "clean",
  ]);

  if (remote.error) {
    facts.push(["remote branches", `unknown (git ls-remote ${remote.error})`]);
  } else if (remoteHeads.size) {
    facts.push(["remote branches", [...remoteHeads.keys()].join(", ")]);
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
let oldestStale = null;

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
    if (!oldestStale || declared < oldestStale) oldestStale = declared;
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

// What the stale docs missed. "Stale" alone sends someone to re-read every doc; the list of what
// changed since the oldest stale date is the actual reconciliation work.
if (oldestStale) {
  console.log(`\n\u2500\u2500 Changed since ${oldestStale} (what the stale docs do not know) \u2500\u2500`);
  const commits = git([
    "log",
    "--format=%h %ad %s",
    "--date=short",
    `--since=${oldestStale} 23:59:59`,
    "--",
    ...WATCHED,
  ]);
  const lines = commits ? commits.split("\n") : [];
  for (const l of lines.slice(0, 15)) console.log(`   ${l}`);
  if (lines.length > 15) console.log(`   \u2026and ${lines.length - 15} more code commits`);

  const merged = gh([
    "pr",
    "list",
    "--state",
    "merged",
    "--search",
    `merged:>${oldestStale}`,
    "--limit",
    "30",
    "--json",
    "number,title,baseRefName",
    "--jq",
    '.[] | "#\\(.number) \\(.title) (into \\(.baseRefName))"',
  ]);
  if (merged) {
    console.log("   Merged PRs:");
    for (const l of merged.split("\n")) console.log(`     ${l}`);
  }
}
console.log(
  "\nStale does not always mean wrong \u2014 but it means unverified. Re-read the doc against the\n" +
    "ground truth above, fix what has drifted, then update its declared date in the same commit.\n",
);

process.exit(ci ? 1 : 0);
