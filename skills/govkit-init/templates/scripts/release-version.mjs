#!/usr/bin/env node
/**
 * release-version — one version per release, a tag for every version, and drift reported.
 *
 * WHY THIS EXISTS
 * ---------------
 * Without a rule, a project's version is set once at scaffold time and never touched again. The
 * footer said "v0.1.0" for a year of releases, and the only per-build identifier was a commit
 * COUNT, which turned out to be meaningless on a host that builds from a shallow clone (Vercel
 * does). Production showed "build 44" and preview "build 23" while both branches had 193 commits,
 * and it looked like data, so nobody questioned it.
 *
 * The rule this enforces:
 *
 *   - The version names a RELEASE. It changes once per working -> release PR, as that PR's last
 *     commit on the working branch (`bump`), and never otherwise.
 *   - Every version that reaches the release branch gets an annotated tag `v<version>` on the
 *     release branch (`tag`), so `git log v0.2.0..v0.3.0` is what shipped.
 *   - A per-build identifier is the commit SHA, never a commit count. That part is stack-specific
 *     (how the SHA reaches the UI) and lives in the project, not here.
 *
 * `status` reports the two ways this drifts: a version on the release branch with no tag, and a
 * release branch that moved past its tag without a bump ("released without a version").
 *
 * Dependency-free: Node built-ins and git. Git is always invoked with an argument array, never
 * through a shell, so no value read from a file or a ref can become a command.
 *
 * Usage:
 *   node scripts/release-version.mjs [status] [--ci]    # report; --ci exits 1 on drift
 *   node scripts/release-version.mjs bump <patch|minor|major>
 *   node scripts/release-version.mjs tag [--dry-run]
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

// ------------------------------------------------------------------ helpers

const git = (...args) =>
  execFileSync("git", args, { encoding: "utf-8", stdio: ["ignore", "pipe", "pipe"] }).trim();

const tryGit = (...args) => {
  try {
    return git(...args);
  } catch {
    return null;
  }
};

const readJson = (p) => {
  try {
    return JSON.parse(readFileSync(p, "utf-8"));
  } catch {
    return null;
  }
};

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;

export function parseVersion(v) {
  const m = SEMVER.exec(String(v ?? "").trim());
  return m ? m.slice(1, 4).map(Number) : null;
}

export function compareVersions(a, b) {
  const pa = parseVersion(a);
  const pb = parseVersion(b);
  if (!pa || !pb) throw new Error(`not a plain X.Y.Z version: ${!pa ? a : b}`);
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  return 0;
}

export function nextVersion(current, level) {
  const p = parseVersion(current);
  if (!p) throw new Error(`package.json version "${current}" is not plain X.Y.Z`);
  if (level === "major") return `${p[0] + 1}.0.0`;
  if (level === "minor") return `${p[0]}.${p[1] + 1}.0`;
  if (level === "patch") return `${p[0]}.${p[1]}.${p[2] + 1}`;
  throw new Error(`bump level must be patch, minor or major — got "${level ?? ""}"`);
}

const fail = (msg) => {
  console.error(`\n❌ ${msg}\n`);
  process.exit(1);
};

const manifest = readJson("govkit.json") ?? {};
const WORKING = manifest.branches?.working ?? "dev";
const RELEASE = manifest.branches?.release ?? "main";

const versionAt = (ref) => {
  const raw = tryGit("show", `${ref}:package.json`);
  if (!raw) return null;
  try {
    return JSON.parse(raw).version ?? null;
  } catch {
    return null;
  }
};

const versionTags = () =>
  (tryGit("tag", "--list", "v*") ?? "")
    .split("\n")
    .map((t) => t.trim())
    .filter((t) => parseVersion(t.slice(1)))
    .sort((a, b) => compareVersions(b.slice(1), a.slice(1)));

const isAncestor = (a, b) => {
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", a, b], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
};

// ------------------------------------------------------------------ commands

const [cmd = "status", arg] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const flags = new Set(process.argv.slice(2).filter((a) => a.startsWith("--")));

if (!existsSync("package.json")) fail("No package.json here. Run from the project root.");

if (cmd === "status") status();
else if (cmd === "bump") bump(arg);
else if (cmd === "tag") tag();
else fail(`Unknown command "${cmd}". Use status, bump <patch|minor|major>, or tag.`);

function status() {
  tryGit("fetch", "--quiet", "--tags", "origin");
  const rel = `origin/${RELEASE}`;
  // The local working branch is where a bump happens, so read it first; a bump that is not
  // pushed yet still counts. Fall back to the remote when the branch is not checked out here.
  const work = tryGit("rev-parse", "--verify", "--quiet", WORKING) ? WORKING : `origin/${WORKING}`;
  const relVersion = versionAt(rel);
  const workVersion = versionAt(work) ?? readJson("package.json")?.version;
  const tags = versionTags();
  const latest = tags[0] ?? null;
  const findings = [];

  console.log(`\n── Release version ────────────────────────────────────`);
  console.log(`   ${RELEASE.padEnd(24)} ${relVersion ?? "(unreadable)"}`);
  console.log(`   ${WORKING.padEnd(24)} ${workVersion ?? "(unreadable)"}`);
  console.log(`   latest tag               ${latest ?? "none"}`);

  if (relVersion && parseVersion(relVersion)) {
    const relTag = `v${relVersion}`;
    if (!tags.includes(relTag)) {
      findings.push(
        `${RELEASE} is at ${relVersion} but there is no ${relTag} tag. ` +
          `Run \`npm run release:tag\` to tag what is in production.`,
      );
    } else {
      const since = Number(tryGit("rev-list", "--count", "--no-merges", `${relTag}..${rel}`) ?? 0);
      if (since > 0) {
        findings.push(
          `${RELEASE} has ${since} commit(s) since ${relTag} and is still ${relVersion}: ` +
            `a release shipped without a version bump. Bump on ${WORKING} and release again.`,
        );
      }
      if (!isAncestor(relTag, rel)) {
        findings.push(`${relTag} is not on ${RELEASE}. A release tag must point at a ${RELEASE} commit.`);
      }
    }
  } else if (relVersion) {
    findings.push(`${RELEASE}'s package.json version "${relVersion}" is not plain X.Y.Z.`);
  }

  const pending = Number(tryGit("rev-list", "--count", "--no-merges", `${rel}..${work}`) ?? 0);
  if (relVersion && workVersion && parseVersion(relVersion) && parseVersion(workVersion)) {
    const c = compareVersions(workVersion, relVersion);
    if (c < 0) {
      findings.push(`${WORKING} (${workVersion}) is BEHIND ${RELEASE} (${relVersion}). Merge ${RELEASE} back.`);
    } else if (pending > 0 && c === 0) {
      console.log(
        `\n   ${pending} unreleased commit(s) on ${WORKING}. The release PR must bump first:\n` +
          `   npm run release:bump -- minor   (features)   |   -- patch   (fixes only)`,
      );
    } else if (c > 0) {
      console.log(`\n   ${WORKING} is bumped to ${workVersion} and ready to release.`);
    } else {
      console.log(`\n   Nothing unreleased.`);
    }
  }

  if (findings.length) {
    console.log("");
    for (const f of findings) console.log(`   ❌ ${f}`);
  } else {
    console.log(`\n   ✅ Every released version is tagged.`);
  }
  console.log("");
  process.exit(flags.has("--ci") && findings.length ? 1 : 0);
}

function bump(level) {
  const branch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (branch !== WORKING) {
    fail(`Bump on ${WORKING}, as the release PR's last commit. You are on ${branch}.`);
  }
  if (git("status", "--porcelain")) fail("Working tree is not clean. Commit or stash first.");

  const pkgText = readFileSync("package.json", "utf-8");
  const current = JSON.parse(pkgText).version;
  let next;
  try {
    next = nextVersion(current, level);
  } catch (e) {
    fail(e.message);
  }
  if (versionTags().includes(`v${next}`)) fail(`v${next} is already tagged. Pick another level.`);

  // Edit in place so the file's own formatting survives, then prove the edit by re-parsing.
  const edited = pkgText.replace(/("version"\s*:\s*")[^"]*(")/, `$1${next}$2`);
  if (JSON.parse(edited).version !== next) fail("Could not update package.json's version field.");
  writeFileSync("package.json", edited);
  const files = ["package.json"];

  if (existsSync("package-lock.json")) {
    const lock = JSON.parse(readFileSync("package-lock.json", "utf-8"));
    lock.version = next;
    if (lock.packages?.[""]) lock.packages[""].version = next;
    writeFileSync("package-lock.json", JSON.stringify(lock, null, 2) + "\n");
    files.push("package-lock.json");
  }

  git("add", "--", ...files);
  git("commit", "--quiet", "-m", `chore(release): v${next}`);
  console.log(
    `\n✅ ${current} → ${next}, committed on ${WORKING} as "chore(release): v${next}".\n\n` +
      `   Push, and open or update the release PR. After it merges:  npm run release:tag\n`,
  );
}

function tag() {
  git("fetch", "--quiet", "--tags", "origin");
  const rel = `origin/${RELEASE}`;
  const version = versionAt(rel);
  if (!parseVersion(version)) fail(`${RELEASE}'s package.json version "${version}" is not plain X.Y.Z.`);

  const name = `v${version}`;
  const head = git("rev-parse", rel);
  const tags = versionTags();

  if (tags.includes(name)) {
    const at = git("rev-list", "-n", "1", name);
    if (at === head) {
      console.log(`\n✅ ${name} already tags ${RELEASE} (${head.slice(0, 7)}). Nothing to do.\n`);
      return;
    }
    fail(
      `${name} already exists at ${at.slice(0, 7)}, but ${RELEASE} is now ${head.slice(0, 7)}. ` +
        `${RELEASE} moved without a version bump. Bump on ${WORKING} and release again; ` +
        `never move a published tag.`,
    );
  }
  if (tags[0] && compareVersions(version, tags[0].slice(1)) < 0) {
    fail(`${RELEASE} is at ${version}, which is lower than the latest tag ${tags[0]}.`);
  }

  if (flags.has("--dry-run")) {
    console.log(`\n(dry run) would tag ${head.slice(0, 7)} on ${RELEASE} as ${name} and push it.\n`);
    return;
  }
  git("tag", "-a", name, head, "-m", `Release ${name}`);
  git("push", "--quiet", "origin", name);
  console.log(`\n✅ Tagged ${RELEASE} ${head.slice(0, 7)} as ${name} and pushed it.\n`);
}
