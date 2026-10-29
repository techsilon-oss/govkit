// Shared fixtures for the upgrade tests: throwaway git repos in the OS temp dir, laid out as
// /govkit-init left them at a given release. Past releases come from this repo's own tags
// (git show v0.5.0:…), so a clone needs its tags.

import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach } from "node:test";
import { OWNED, TEMPLATES, pluginVersion } from "../skills/govkit-init/upgrade.mjs";

export const GOVKIT = process.cwd();

export const git = (cwd, ...args) =>
  execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...args], {
    cwd,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();

export const atRelease = (ref, template) =>
  execFileSync("git", ["show", `${ref}:skills/govkit-init/templates/${template}`], {
    cwd: GOVKIT,
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"], // a template missing at that release throws, quietly
  });

export const fill = (text, version) =>
  text
    .replaceAll("{{GOVKIT_VERSION}}", version)
    .replaceAll("{{PROJECT_NAME}}", "Acme")
    .replaceAll("{{DEFAULT_BRANCH}}", "dev")
    .replaceAll("{{DEPLOY_TARGET}}", "Vercel");

export const status = (report, path) => report.files.find((f) => f.path === path)?.status;

/** Temp dirs made through this are removed after each test of the file that called it. */
export function tempDirs() {
  const made = [];
  afterEach(() => {
    while (made.length) rmSync(made.pop(), { recursive: true, force: true });
  });
  return (prefix) => {
    const d = mkdtempSync(join(tmpdir(), prefix));
    made.push(d);
    return d;
  };
}

/**
 * A committed repo as /govkit-init would leave it. ref: a release tag, or null for the working
 * tree. A release from before a rename ships the file under its old name, as that repo has it,
 * and package.json holds the scripts init merged then.
 */
export function makeRepoWith(tmp) {
  return function makeRepo(ref = null) {
    const root = tmp("govkit-upgrade-");
    git(root, "init", "-q", "-b", "dev");
    git(root, "config", "core.autocrlf", "false");
    const read = (t) => (ref ? atRelease(ref, t) : readFileSync(join(TEMPLATES, t), "utf-8"));
    const put = (path, text) => {
      mkdirSync(dirname(join(root, path)), { recursive: true });
      writeFileSync(join(root, path), text);
    };
    put("govkit.json", fill(read("govkit.json"), pluginVersion()));
    const manifest = JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));
    for (const e of OWNED) {
      let [path, template] = [e.path, e.template];
      if (ref && e.renamedFrom) {
        try {
          read(template);
        } catch {
          [path, template] = [e.renamedFrom.path, e.renamedFrom.template];
        }
      }
      put(path, read(template).replace(/^PROTECTED_BRANCHES=.*$/m, 'PROTECTED_BRANCHES="refs/heads/main"'));
    }
    if (ref) put("package.json", `${JSON.stringify({ name: "acme", scripts: JSON.parse(read("package-scripts.json")) }, null, 2)}\n`);
    put("scripts/release-gate.ts", read("scripts/release-gate.ts"));
    put("CLAUDE.md", `# Acme\n\nOur own notes.\n\n${fill(read("CLAUDE.md"), "")}`);
    git(root, "add", "-A");
    git(root, "commit", "-qm", "init");
    return { root, manifest };
  };
}
