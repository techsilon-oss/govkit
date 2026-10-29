#!/usr/bin/env node
/**
 * check-release — govkit's release rules, checked in CI (DEC-004 in docs/PROJECT-HUB.md).
 *
 * govkit skips its own `versioning` guardrail: release-version.mjs reads package.json and bumps on
 * a dev branch, while govkit's version lives in the plugin manifests and every PR goes straight to
 * main. This checks the same rules for govkit's shape:
 *
 *   - plugin.json and marketplace.json name the same version, and it is plain X.Y.Z;
 *   - CHANGELOG.md has an entry for it, template-history.json knows it (so --upgrade can
 *     recognise the files this release ships), and govkit's own govkit.json records it;
 *   - with --pr: the version on main has its v<version> tag, and a PR that changes the version
 *     raises it. The tag check runs on PRs, not on the push to main: the tag is created after the
 *     merge, so on that push it can never exist yet. A forgotten tag is caught at the next PR.
 *
 * Usage:  node tools/check-release.mjs [--pr] [--base <ref>]   (default base: origin/main)
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SEMVER = /^(\d+)\.(\d+)\.(\d+)$/;
const cmp = (a, b) => {
  const [x, y] = [a, b].map((v) => SEMVER.exec(v).slice(1).map(Number));
  return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
};

const readJson = (root, p) => {
  try {
    return JSON.parse(readFileSync(join(root, p), "utf-8"));
  } catch {
    return null;
  }
};

const git = (root, ...args) => {
  try {
    return execFileSync("git", args, { cwd: root, encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return null;
  }
};

/** Returns a list of findings; empty means every rule holds. */
export function checkRelease(root = process.cwd(), { pr = false, base = "origin/main" } = {}) {
  const findings = [];
  const plugin = readJson(root, ".claude-plugin/plugin.json");
  const market = readJson(root, ".claude-plugin/marketplace.json");
  const version = plugin?.version;

  if (!SEMVER.test(String(version))) {
    return [`.claude-plugin/plugin.json version "${version}" is not plain X.Y.Z`];
  }
  const listed = market?.plugins?.find((p) => p.name === plugin.name)?.version;
  if (listed !== version) {
    findings.push(`marketplace.json lists ${plugin.name} at ${listed ?? "(missing)"}, plugin.json says ${version}. Installers read the marketplace.`);
  }

  let changelog = "";
  try {
    changelog = readFileSync(join(root, "CHANGELOG.md"), "utf-8");
  } catch {
    // reported below
  }
  if (!new RegExp(`^## \\[${version.replace(/\./g, "\\.")}\\]`, "m").test(changelog)) {
    findings.push(`CHANGELOG.md has no "## [${version}]" entry.`);
  }

  // govkit runs its own guardrails (DEC-003), so its govkit.json records the version too.
  const own = readJson(root, "govkit.json");
  if (own && own.govkitVersion !== version) {
    findings.push(`govkit.json says govkitVersion ${own.govkitVersion}, plugin.json says ${version}: run node skills/govkit-init/upgrade.mjs record.`);
  }

  const history = readJson(root, "skills/govkit-init/template-history.json");
  if (!history?.$releases?.includes(version)) {
    findings.push(`template-history.json does not know ${version}: run node tools/build-template-history.mjs.`);
  }

  if (pr) {
    const raw = git(root, "show", `${base}:.claude-plugin/plugin.json`);
    const mainVersion = raw ? JSON.parse(raw).version : null;
    if (!mainVersion) {
      findings.push(`Cannot read the version on ${base}. In CI, check out with fetch-depth: 0.`);
    } else {
      const tag = `v${mainVersion}`;
      const tagged = git(root, "rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`);
      if (!tagged) {
        findings.push(`${base} is at ${mainVersion} but ${tag} does not exist. Tag the release that is on main: git tag -a ${tag} <merge commit> && git push origin ${tag}.`);
      } else if (git(root, "merge-base", "--is-ancestor", tagged, base) === null) {
        findings.push(`${tag} is not on ${base}. A release tag must point at a commit on main.`);
      }
      if (version !== mainVersion && cmp(version, mainVersion) < 0) {
        findings.push(`This PR lowers the version: ${mainVersion} on ${base}, ${version} here.`);
      }
    }
  }
  return findings;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const base = args.includes("--base") ? args[args.indexOf("--base") + 1] : "origin/main";
  const findings = checkRelease(process.cwd(), { pr: args.includes("--pr"), base });
  if (findings.length) {
    console.error(`\n❌ Release check failed:\n${findings.map((f) => `   • ${f}`).join("\n")}\n`);
    process.exit(1);
  }
  const v = JSON.parse(readFileSync(".claude-plugin/plugin.json", "utf-8")).version;
  console.log(`\n✅ Release check: ${v}, manifests agree, CHANGELOG and template history know it${args.includes("--pr") ? ", main's release is tagged" : ""}.\n`);
}
