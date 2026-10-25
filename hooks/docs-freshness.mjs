#!/usr/bin/env node
/**
 * docs-freshness — the session-close reminder, run by Claude Code as a plugin hook.
 *
 * WHY THIS EXISTS
 * ---------------
 * `scripts/docs-sync-check.mjs` finds a stale tracker, but only when someone runs it — in
 * practice at the NEXT session's status read. By then the session that caused the drift is gone:
 * it merged a PR, ended, and the hub kept saying the work was still to do. The next session
 * started from a false picture, and this kept happening in every govkit repo.
 *
 * Drift starts at one moment: the working branch moves (a merge, or a direct commit) and the
 * session ends without the /sdlc session-close checklist. So this hook watches that moment:
 *
 *   session-start  Records where the working branch was (locally and on origin), and tells the
 *                  session up front if a tracker is already stale.
 *   stop           If the working branch gained code commits during this session and no tracker
 *                  changed, blocks the stop ONCE for that state, with the reason. Claude then
 *                  does the session close, or says why not. A new merge earns a new reminder.
 *
 * Feature-branch commits do not count: the trackers describe the working branch, and nagging on
 * every WIP commit would teach everyone to ignore the hook.
 *
 * Silent no-op in any repo without govkit.json, or with
 * guardrails["docs-sync-check"].enabled = false or .sessionHook = false.
 *
 * Self-contained on purpose (Node built-ins + git): the plugin updates on every machine at once,
 * while scripts/docs-sync-check.mjs is a vendored copy that each repo re-copies on its own time.
 * The date rule below must stay the same as that script's.
 *
 * Usage (from hooks/hooks.json): node docs-freshness.mjs session-start|stop   (hook JSON on stdin)
 */

import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

const mode = process.argv[2];

function readStdin() {
  try {
    return JSON.parse(readFileSync(0, "utf-8") || "{}");
  } catch {
    return {};
  }
}

const input = readStdin();
if (input.cwd) {
  try {
    process.chdir(input.cwd);
  } catch {
    process.exit(0);
  }
}

const git = (args, timeout = 5000) => {
  try {
    return execFileSync("git", args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
      timeout,
    }).trim();
  } catch {
    return "";
  }
};

// ------------------------------------------------------------------ config

if (!existsSync("govkit.json")) process.exit(0);
let manifest;
try {
  manifest = JSON.parse(readFileSync("govkit.json", "utf-8"));
} catch {
  process.exit(0);
}
const CFG = manifest?.guardrails?.["docs-sync-check"] ?? {};
if (CFG.enabled === false || CFG.sessionHook === false) process.exit(0);

const DOCS = CFG.bootstrapDocs ?? ["docs/PROJECT-HUB.md", "docs/PRIORITY-ROADMAP.md", "CLAUDE.md"];
const WATCHED = CFG.watchedPaths ?? ["src/", "scripts/", "package.json", ".github/"];
const WORKING = manifest?.branches?.working ?? "dev";

// Same patterns and rule as scripts/docs-sync-check.mjs.
const DATE_PATTERNS = [
  /last checked[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /last reviewed[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /as of[:\s]+(\d{4}-\d{2}-\d{2})/i,
  /last_updated:\s*"?(\d{4}-\d{2}-\d{2})/i,
];
function declaredDate(path) {
  if (!existsSync(path)) return null;
  const content = readFileSync(path, "utf-8");
  for (const re of DATE_PATTERNS) {
    const m = content.match(re);
    if (m) return m[1];
  }
  return null;
}

// ------------------------------------------------------------------- state

const gitDir = git(["rev-parse", "--absolute-git-dir"]);
if (!gitDir) process.exit(0);
const stateDir = join(gitDir, "govkit");
const sessionId = String(input.session_id ?? "unknown").replace(/[^\w-]/g, "");
const stateFile = join(stateDir, `session-${sessionId}.json`);

const loadState = () => {
  try {
    return JSON.parse(readFileSync(stateFile, "utf-8"));
  } catch {
    return null;
  }
};
const saveState = (s) => {
  mkdirSync(stateDir, { recursive: true });
  writeFileSync(stateFile, JSON.stringify(s, null, 2));
};

/** Where the working branch is: the local ref, and origin's (one ls-remote, no fetch). */
function workingHeads() {
  const local = git(["rev-parse", "--verify", "--quiet", `refs/heads/${WORKING}`]);
  const remoteLine = git(["ls-remote", "--heads", "origin", WORKING], 8000);
  const remote = remoteLine.split(/\s+/)[0] || "";
  return { local, remote };
}

/** Commits in from..to that touch watched code, as "hash subject" lines. */
function codeCommits(from, to) {
  if (!from || !to || from === to) return [];
  const out = git(["log", "--format=%h %s", `${from}..${to}`, "--", ...WATCHED]);
  return out ? out.split("\n") : [];
}

/** Did any tracker change in from..to? */
function trackersChanged(from, to) {
  if (!from || !to || from === to) return false;
  return git(["diff", "--name-only", from, to, "--", ...DOCS]) !== "";
}

// -------------------------------------------------------------- session-start

if (mode === "session-start") {
  // Resume, /clear and compaction start the hook again: keep the first baseline.
  if (!loadState()) {
    saveState({ startedAt: new Date().toISOString(), base: workingHeads(), reminded: [] });
    pruneOldState();
  }

  const codeDate = git(["log", "-1", "--format=%ad", "--date=short", "--", ...WATCHED]);
  const stale = DOCS.map((path) => [path, declaredDate(path)]).filter(
    ([, d]) => d && codeDate && d < codeDate,
  );
  if (stale.length) {
    // stdout from a SessionStart hook becomes context for the session.
    console.log(
      `govkit: tracker docs are stale. Code changed on ${codeDate}. ` +
        stale.map(([p, d]) => `${p} says ${d}`).join("; ") +
        ". Do not trust their status sections until you check them. " +
        "Run `npm run docs:sync-check`, then fix the docs before other work.",
    );
  }
  process.exit(0);
}

// ---------------------------------------------------------------------- stop

if (mode === "stop") {
  // Claude is already continuing because of a stop hook: never block twice in a row.
  if (input.stop_hook_active) process.exit(0);

  const state = loadState();
  if (!state) process.exit(0); // session began before the plugin was installed

  const now = workingHeads();
  const key = `${now.local}|${now.remote}`;
  if (state.reminded.includes(key)) process.exit(0);

  // Origin may have moved (a PR merged on GitHub) without a local fetch. Fetch only then.
  let remoteTip = now.remote;
  if (now.remote && now.remote !== state.base.remote) {
    git(["fetch", "--quiet", "origin", WORKING], 20000);
    // rev-parse, not `cat-file -e`: the git() helper returns stdout, and -e prints nothing either way.
    if (!git(["rev-parse", "--verify", "--quiet", `${now.remote}^{commit}`])) remoteTip = "";
  }

  const commits = [
    ...codeCommits(state.base.local, now.local),
    ...codeCommits(state.base.remote, remoteTip),
  ];
  const unique = [...new Set(commits)];
  if (unique.length === 0) process.exit(0);

  const docsTouched =
    trackersChanged(state.base.local, now.local) ||
    trackersChanged(state.base.remote, remoteTip) ||
    git(["status", "--porcelain", "--", ...DOCS]) !== "";
  if (docsTouched) process.exit(0);

  state.reminded.push(key);
  saveState(state);

  const shown = unique.slice(0, 5).map((c) => `  - ${c}`);
  if (unique.length > 5) shown.push(`  - …and ${unique.length - 5} more`);
  // Exit 2: Claude Code blocks the stop and gives this text to Claude.
  process.stderr.write(
    [
      `govkit: ${WORKING} has new code from this session, and no tracker doc changed.`,
      ...shown,
      `Trackers: ${DOCS.join(", ")}.`,
      "If the session is finished: do the /sdlc session close. Update the status, the next steps",
      "and the 'last checked' date in each tracker, then commit and push.",
      "If more work follows in this session: say so, and do the session close at the end.",
      "This reminder comes once for each new state of the branch.",
    ].join("\n") + "\n",
  );
  process.exit(2);
}

process.exit(0);

// -------------------------------------------------------------------- helpers

function pruneOldState() {
  const cutoff = Date.now() - 14 * 24 * 3600 * 1000;
  try {
    for (const f of readdirSync(stateDir)) {
      const p = join(stateDir, f);
      if (f.startsWith("session-") && statSync(p).mtimeMs < cutoff) unlinkSync(p);
    }
  } catch {
    // best effort
  }
}
