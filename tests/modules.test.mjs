// Tests for the kit-standard pieces (#34): module notes kept once in module.json, the README table
// generated from them, the guides they point at, version-pinned links that resolve, /govkit-help
// read-only, and the doc-sync workflow on the new action versions.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, normalize } from "node:path";
import { test } from "node:test";
import { guideUrl, loadModules, noteText, NOTE_FIELDS, pluginVersion } from "../skills/govkit-init/modules.mjs";
import { renderReadme } from "../tools/build-module-table.mjs";
import { GOVKIT, git, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const read = (p) => readFileSync(join(GOVKIT, p), "utf-8").replace(/\r\n/g, "\n");
const modules = loadModules(GOVKIT);
const GUIDE_SECTIONS = ["What you get", "What it changes outside your repo", "Cost", "Set up", "Fix a finding", "Undo"];

// ------------------------------------------------------------------ module.json, kept once

test("every module has every field, and its id is a guardrail in the govkit.json template", () => {
  const guardrails = Object.keys(JSON.parse(read("skills/govkit-init/templates/govkit.json")).guardrails).filter((k) => !k.startsWith("$"));
  assert.deepEqual(modules.map((m) => m.id).sort(), [...guardrails].sort(), "module ids = guardrail keys");
  for (const m of modules) {
    for (const f of ["id", "title", "default", "skippable", "files", ...NOTE_FIELDS]) assert.ok(m[f] !== undefined && m[f] !== "", `${m.id}: ${f}`);
    assert.ok(["on", "opt-in"].includes(m.default), `${m.id}: default`);
    assert.ok(existsSync(join(GOVKIT, m.readMore)), `${m.id}: ${m.readMore} exists`);
  }
  assert.equal(modules.find((m) => m.id === "trackers").skippable, false);
});

test("every module guide has the standard sections", () => {
  for (const m of modules) {
    const headings = read(m.readMore).split("\n").filter((l) => l.startsWith("## ")).map((l) => l.slice(3));
    assert.deepEqual(headings, GUIDE_SECTIONS, `${m.readMore}`);
  }
});

test("the README module table is generated from module.json, and is current", () => {
  const readme = read("README.md");
  assert.equal(renderReadme(readme, modules), readme, "run node tools/build-module-table.mjs");
  for (const m of modules) assert.ok(readme.includes(`[\`${m.id}\`](${m.readMore})`), `${m.id} in the table`);
  // Editing module.json changes the table: it really is generated, not hand-kept.
  const changed = modules.map((m) => (m.id === "ci" ? { ...m, costs: "A changed cost." } : m));
  assert.match(renderReadme(readme, changed), /A changed cost\./);
});

test("modules.mjs notes prints each note with its guide pinned to the installed version", () => {
  const out = execFileSync("node", [join(GOVKIT, "skills/govkit-init/modules.mjs"), "notes"], { encoding: "utf-8" });
  for (const m of modules) {
    assert.ok(out.includes(m.title), m.id);
    assert.ok(out.includes(`https://github.com/techsilon-oss/govkit/blob/v${pluginVersion()}/${m.readMore}`), `${m.id}: pinned link`);
  }
  assert.match(noteText(modules[0], "mixed"), /blob\/main\//, "not a plain version: main");
});

// ------------------------------------------------------------------ links pinned to the user's version

test("guideUrl pins to v<version>, and falls back to main only when the version isn't plain", () => {
  assert.equal(guideUrl("docs/FAQ.md", "0.10.0"), "https://github.com/techsilon-oss/govkit/blob/v0.10.0/docs/FAQ.md");
  for (const v of ["mixed", undefined, null, "0.10", "v0.10.0"]) assert.match(guideUrl("x.md", v), /blob\/main\/x\.md$/);
});

function doctorIn(govkitVersion) {
  const root = tmp("govkit-doctor-links-");
  git(root, "init", "-q");
  writeFileSync(
    join(root, "govkit.json"),
    JSON.stringify({ govkitVersion, guardrails: { "pre-push-hook": { enabled: true, expects: [".githooks/pre-push"] }, versioning: { enabled: false } } }),
  );
  try {
    return execFileSync("node", [join(GOVKIT, "skills/govkit-init/templates/scripts/govkit-doctor.mjs")], { cwd: root, encoding: "utf-8" });
  } catch (e) {
    return String(e.stdout);
  }
}

test("doctor findings link to their fix, pinned to the repo's govkitVersion", () => {
  const out = doctorIn("0.10.0");
  assert.match(out, /fix: https:\/\/github\.com\/techsilon-oss\/govkit\/blob\/v0\.10\.0\/docs\/modules\/pre-push-hook\.md#fix-a-finding/);
  assert.match(out, /versioning — skipped: no reason recorded\n\s+fix: https:\/\/github\.com\/techsilon-oss\/govkit\/blob\/v0\.10\.0\/docs\/modules\/versioning\.md#fix-a-finding/);
  assert.doesNotMatch(out, /blob\/main\//);
  assert.match(doctorIn("mixed"), /blob\/main\/docs\/modules\/pre-push-hook\.md#fix-a-finding/);
});

test("the doctor's list of module guides matches module.json", () => {
  const doctor = read("skills/govkit-init/templates/scripts/govkit-doctor.mjs");
  const list = JSON.parse(/const MODULE_GUIDES = (\[[^\]]*\])/.exec(doctor)[1]);
  assert.deepEqual([...list].sort(), modules.map((m) => m.id).sort());
});

/** GitHub's heading anchors: lower case, punctuation dropped, each space a hyphen. */
const slug = (h) => h.trim().toLowerCase().replace(/[^\p{L}\p{N} _-]/gu, "").replace(/ /g, "-");
const anchorsOf = (file) => new Set(read(file).split("\n").filter((l) => /^#{1,6} /.test(l)).map((l) => slug(l.replace(/^#+ /, ""))));

test("every doc link with an anchor resolves, in the docs as they will be tagged", () => {
  const sources = [
    "skills/govkit-init/templates/scripts/govkit-doctor.mjs",
    "skills/govkit-init/upgrade.mjs",
    "skills/govkit-init/SKILL.md",
    "skills/govkit-help/SKILL.md",
    "docs/FAQ.md",
    "docs/EXTENDING.md",
    "README.md",
    ...readdirSync(join(GOVKIT, "docs/modules")).map((f) => `docs/modules/${f}`),
  ];
  let checked = 0;
  for (const src of sources) {
    // In a script, a link is what it passes to guide()/guideUrl() (other "x.md#y" strings are data,
    // like "CLAUDE.md#block"). In Markdown, any link with a real path before ".md" (a `${name}.md`
    // built in code is checked below).
    const links = src.endsWith(".mjs")
      ? /guide(?:Url)?\("([\w./-]+\.md)#([\w-]+)"/g
      : /(?<![\w}./-])([\w./-]*[\w-]\.md)#([\w-]+)/g;
    for (const [, raw, anchor] of read(src).matchAll(links)) {
      if (raw.includes("${") || raw.includes("<")) continue;
      // A pinned URL ("…/blob/v0.10.0/docs/x.md"), or a path a script passes to guide(), names a
      // repo path; a Markdown link resolves from its own file.
      // A leading "/" is the rest of a template URL (".../blob/v<version>/docs/x.md"): from the root too.
      const fromRoot = /blob\/[^/]+\//.test(raw) || src.endsWith(".mjs") || raw.startsWith("/");
      const path = fromRoot ? raw.replace(/^.*blob\/[^/]+\//, "").replace(/^\//, "") : normalize(join(dirname(src), raw)).replace(/\\/g, "/");
      assert.ok(existsSync(join(GOVKIT, path)), `${src}: ${raw} → ${path} does not exist`);
      assert.ok(anchorsOf(path).has(anchor), `${src}: ${path}#${anchor} has no such heading`);
      checked++;
    }
  }
  // The doctor builds module links in code: every guide must have the anchor it uses.
  for (const m of modules) assert.ok(anchorsOf(m.readMore).has("fix-a-finding"), m.readMore);
  assert.ok(checked > 20, `only ${checked} links found: the scan is broken`);
});

// ------------------------------------------------------------------ /govkit-help

test("/govkit-help only reads: allowed-tools are Read, Grep and Glob, no Bash", () => {
  const skill = read("skills/govkit-help/SKILL.md");
  assert.equal(/^allowed-tools:\s*(.*)$/m.exec(skill)[1].trim(), "Read Grep Glob");
  assert.doesNotMatch(skill.split("---")[1], /Bash|Write|Edit/);
  for (const doc of ["docs/FAQ.md", "module.json", "docs/UPGRADING.md", "docs/EXTENDING.md", "README.md", "CHANGELOG.md"]) {
    assert.ok(skill.includes(doc), `the skill names ${doc}`);
    assert.ok(existsSync(join(GOVKIT, doc)), `${doc} ships`);
  }
});

test("the plugin description is one line ending with the help skill", () => {
  for (const f of [".claude-plugin/plugin.json", ".claude-plugin/marketplace.json"]) {
    const j = JSON.parse(read(f));
    const d = j.description && !j.plugins ? j.description : j.plugins[0].description;
    assert.match(d, /Help: \/govkit-help$/, f);
    assert.doesNotMatch(d, /\n/);
  }
});

// ------------------------------------------------------------------ the doc-sync workflow

test("the doc-sync workflow: new action versions, unchanged check name, no comment on forks, findings in the summary", () => {
  const wf = read("skills/govkit-init/templates/.github/workflows/govkit-docsync.yml");
  assert.match(wf, /actions\/checkout@v7/);
  assert.match(wf, /actions\/setup-node@v7/);
  assert.match(wf, /actions\/github-script@v9/);
  assert.doesNotMatch(wf, /@v4\b/);
  assert.match(wf, /^ {4}name: Doc-sync \(\$\{\{ github\.base_ref == 'main' && 'gate' \|\| 'warn' \}\}\)$/m, "check name unchanged");
  assert.match(wf, /^name: sdlc-docs$/m, "workflow name unchanged");
  assert.match(wf, /<!-- sdlc-docs-bot -->/, "comment marker unchanged");
  assert.match(wf, /name: Comment findings on PR\n\s+if: always\(\) && github\.event\.pull_request\.head\.repo\.full_name == github\.repository/);
  assert.match(wf, /GITHUB_STEP_SUMMARY/);
  assert.match(wf, /name: Enforce gate\n\s+if: steps\.audit\.outputs\.mode == 'gate' && steps\.audit\.outputs\.exit != '0'/, "the gate is unconditional on forks");
  assert.equal(read(".github/workflows/govkit-docsync.yml"), wf, "govkit's own copy is the template");
});
