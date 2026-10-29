// A skill's allowed-tools pre-approve Bash commands, with no prompt. A pattern that matches a
// script by NAME anywhere (`node *project-steps.mjs status*`) lets a repo ship its own file of that
// name and have it run unasked — which bypassed the trust step for .govkit/session.md (#30 review).
// Patterns that run a govkit script are anchored to the plugin's own copy: ${CLAUDE_PLUGIN_ROOT},
// which Claude Code expands in allowed-tools (checked against a live session, CLI 2.1.312: the
// plugin's script ran unprompted in dontAsk mode, a same-named script elsewhere was denied).
//
// These tests simulate that matching: `*` matches anything, the rest literally, whole command.

import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { GOVKIT } from "./fixtures.mjs";

const ROOT = String.raw`C:\Users\me\.claude\plugins\cache\govkit-marketplace\govkit\0.9.0`;

/** Every Bash(...) pattern each skill pre-approves. */
function bashPatterns() {
  const out = [];
  for (const skill of readdirSync(join(GOVKIT, "skills"))) {
    let text;
    try {
      text = readFileSync(join(GOVKIT, "skills", skill, "SKILL.md"), "utf-8");
    } catch {
      continue;
    }
    const line = /^allowed-tools:(.*)$/m.exec(text)?.[1] ?? "";
    for (const m of line.matchAll(/Bash\(((?:[^()"]|"[^"]*")*)\)/g)) out.push({ skill, pattern: m[1] });
  }
  return out;
}

/** Does a pre-approval pattern match this exact command? */
const matches = (pattern, command) => {
  const expanded = pattern.replaceAll("${CLAUDE_PLUGIN_ROOT}", ROOT);
  const re = new RegExp(`^${expanded.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
  return re.test(command);
};

const approved = (command) => bashPatterns().some(({ pattern }) => matches(pattern, command));

test("the plugin's own project-steps status and steps are pre-approved; trust is not", () => {
  const own = `node "${ROOT}/skills/govkit-session/project-steps.mjs"`;
  assert.ok(approved(`${own} status`));
  assert.ok(approved(`${own} status --json`));
  assert.ok(approved(`${own} steps on-start`));
  assert.ok(!approved(`${own} trust`), "trust is the user's, never pre-approved");
});

test("a same-named script outside the plugin matches no pattern", () => {
  const impostors = [
    `node "/home/u/repo/.govkit/x-project-steps.mjs" status`,
    `node "/home/u/repo/project-steps.mjs" steps on-start`,
    `node .govkit/project-steps.mjs status`,
    String.raw`node "C:\repo\skills\govkit-session\project-steps.mjs" status`,
    `node "/home/u/repo/x-upgrade.mjs" check`,
    `node "/tmp/upgrade.mjs" check`,
  ];
  for (const c of impostors) assert.ok(!approved(c), `pre-approved, but outside the plugin: ${c}`);
});

test("the plugin's own upgrade check is pre-approved for /govkit-doctor", () => {
  assert.ok(approved(`node "${ROOT}/skills/govkit-init/upgrade.mjs" check`));
  assert.ok(!approved(`node "${ROOT}/skills/govkit-init/upgrade.mjs" apply scripts/x.mjs`), "only check");
});

test("no pattern puts a wildcard in front of a script name", () => {
  for (const { skill, pattern } of bashPatterns()) {
    const script = /(\S*\.m?js)/.exec(pattern)?.[1];
    if (!script) continue;
    assert.ok(!script.includes("*"), `${skill}: "${pattern}" matches the script by name anywhere`);
    // Every pre-approved script is the plugin's own (0.9.1, #31): a repo's copy is whatever its
    // author wrote, so it is never run without a prompt.
    assert.ok(script.startsWith('"${CLAUDE_PLUGIN_ROOT}/'), `${skill}: "${pattern}" is not anchored to the plugin`);
  }
});

test("doctor and docsync run the plugin's copy of their script; the repo's copy is not pre-approved", () => {
  for (const name of ["govkit-doctor", "govkit-docsync"]) {
    assert.ok(approved(`node "${ROOT}/skills/govkit-init/templates/scripts/${name}.mjs" --ci`), `plugin's ${name}`);
    assert.ok(approved(`node "${ROOT}/skills/govkit-init/templates/scripts/${name}.mjs" audit --gate`), `plugin's ${name}`);
    for (const repoCopy of [`node scripts/${name}.mjs`, `node scripts/${name}.mjs --ci`, `node ./scripts/${name}.mjs report`]) {
      assert.ok(!approved(repoCopy), `the repo's copy is pre-approved: ${repoCopy}`);
    }
  }
});

test("no skill pre-approves npm or pnpm scripts: package.json is the repo's", () => {
  for (const { skill, pattern } of bashPatterns()) {
    assert.doesNotMatch(pattern, /^(npm|pnpm|yarn|npx|bun)\b/, `${skill}: "${pattern}" runs a repo-defined script`);
  }
  for (const c of ["npm run docsync:audit", "pnpm docsync:gate", "npm run govkit:doctor"]) assert.ok(!approved(c), c);
});

test("git config is read-only: --get is pre-approved, writes are not", () => {
  assert.ok(approved("git config --get core.hooksPath"));
  for (const write of [
    'git config core.sshCommand "sh -c evil"',
    "git config core.hooksPath /tmp/hooks",
    "git config --global core.hooksPath /tmp/hooks",
    "git config --unset core.hooksPath",
  ]) {
    assert.ok(!approved(write), `a config write is pre-approved: ${write}`);
  }
});
