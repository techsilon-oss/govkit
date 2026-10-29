// Tests for the tracker module (#14, 0.11.0): labels, launch categories as a setting, the pinned-
// issue limit, govkit.json edits in place, and the doctor: "not decided" is a notice that keeps
// --ci green, while "on but no register" fails it.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  DEFAULT_CATEGORIES,
  LAUNCHED_CATEGORIES,
  decline,
  desiredLabels,
  enable,
  missingLabels,
  pinCapacity,
  recordAliases,
  recordRegister,
  resolveLabels,
  TYPE_ALIASES,
  withTracker,
} from "../skills/govkit-init/tracker.mjs";
import { GOVKIT, fill, git, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const TEMPLATE = readFileSync(join(GOVKIT, "skills/govkit-init/templates/govkit.json"), "utf-8").replace(/\r\n/g, "\n");
const names = (labels) => labels.map((l) => l.name);

function repo(govkitJson = fill(TEMPLATE, "0.11.0")) {
  const root = tmp("govkit-tracker-");
  git(root, "init", "-q");
  writeFileSync(join(root, "govkit.json"), govkitJson);
  return root;
}
const manifest = (root) => JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));

// ------------------------------------------------------------------ labels and categories

test("the label set: types, the configured launch categories, areas, status; 'idea' once", () => {
  const d = names(desiredLabels());
  for (const n of ["bug", "enhancement", "idea", "docs", "refactor", ...DEFAULT_CATEGORIES, "in-progress", "blocked", "needs-decision", "fix-shipped", "business"]) {
    assert.ok(d.includes(n), n);
  }
  assert.equal(d.filter((n) => n === "idea").length, 1, "a type and a category share one label");
  const launched = names(desiredLabels({ categories: LAUNCHED_CATEGORIES, areaLabels: ["platform"] }));
  for (const n of ["now", "next", "later", "triage", "platform"]) assert.ok(launched.includes(n), n);
  assert.ok(!launched.includes("pre-launch"), "the configured names replace the defaults");
});

test("only missing labels are listed; existing ones are never touched, whatever their case", () => {
  const missing = names(missingLabels(desiredLabels(), ["Bug", "ENHANCEMENT", "triage", "something-else"]));
  assert.ok(!missing.includes("bug") && !missing.includes("enhancement") && !missing.includes("triage"));
  assert.ok(missing.includes("pre-launch"));
  assert.ok(!missing.includes("something-else"));
});

test("a type label under a GitHub default name counts as present, and is recorded as an alias", () => {
  // GitHub's default label set, as a new repo gets it.
  const defaults = ["bug", "documentation", "duplicate", "enhancement", "good first issue", "help wanted", "invalid", "question", "wontfix"];
  const { missing, aliases } = resolveLabels(desiredLabels(), defaults);
  assert.ok(!names(missing).includes("docs"), "no duplicate docs label");
  assert.deepEqual(aliases, { docs: "documentation" });
  // The repo's exact spelling is kept.
  assert.deepEqual(resolveLabels(desiredLabels(), ["Documentation"]).aliases, { docs: "Documentation" });
  // A repo that already has "docs" uses it: no alias, even if it also has "documentation".
  assert.deepEqual(resolveLabels(desiredLabels(), ["docs", "documentation"]).aliases, {});
  // Without either, docs is created.
  assert.ok(names(resolveLabels(desiredLabels(), []).missing).includes("docs"));
  assert.ok(Object.values(TYPE_ALIASES).every(Array.isArray));
});

test("record-aliases writes the mapping into govkit.json in place, and clears it when empty", () => {
  const root = repo();
  enable(root, {});
  recordAliases(root, { docs: "documentation" });
  assert.deepEqual(manifest(root).guardrails.tracker.issues.labelAliases, { docs: "documentation" });
  assert.equal(manifest(root).guardrails.tracker.issues.categories.length, 4, "the rest of the entry kept");
  recordAliases(root, {});
  assert.equal(manifest(root).guardrails.tracker.issues.labelAliases, undefined);
});

test("GitHub's three pinned issues: free slots, and none once full", () => {
  assert.deepEqual(pinCapacity(0), { pinned: 0, limit: 3, free: 3 });
  assert.equal(pinCapacity(2).free, 1);
  assert.equal(pinCapacity(3).free, 0);
  assert.equal(pinCapacity(4).free, 0);
});

// ------------------------------------------------------------------ govkit.json, in place

test("enable on a new repo: the not-decided entry becomes on, with the chosen categories, in place", () => {
  const root = repo();
  const before = readFileSync(join(root, "govkit.json"), "utf-8");
  const r = enable(root, { categories: LAUNCHED_CATEGORIES, launchEvent: null, areaLabels: ["platform"] });
  assert.equal(r.reformatted, false);
  const t = manifest(root).guardrails.tracker;
  assert.equal(t.enabled, true);
  assert.deepEqual(t.issues.categories, LAUNCHED_CATEGORIES);
  assert.equal(t.issues.register, null);
  // Everything before the tracker entry is byte-identical.
  const head = (s) => s.slice(0, s.indexOf('"tracker"'));
  assert.equal(head(readFileSync(join(root, "govkit.json"), "utf-8")), head(before));
});

test("enable on a repo initialised before 0.11.0 (no tracker entry) adds it inside guardrails", () => {
  const old = JSON.parse(fill(TEMPLATE, "0.10.0"));
  delete old.guardrails.tracker;
  const text = `${JSON.stringify(old, null, 2)}\n`;
  const { text: out, reformatted } = withTracker(text, { enabled: true, issues: { register: null, categories: DEFAULT_CATEGORIES } });
  assert.equal(reformatted, false);
  const parsed = JSON.parse(out);
  assert.equal(parsed.guardrails.tracker.enabled, true);
  assert.equal(Object.keys(parsed.guardrails).at(-1), "tracker");
  assert.deepEqual(Object.keys(parsed), Object.keys(old), "no top-level key moved");
});

test("decline needs a reason, and records it", () => {
  const root = repo();
  assert.throws(() => decline(root, "  "), /a reason is required/);
  decline(root, "we track work in Linear");
  const t = manifest(root).guardrails.tracker;
  assert.equal(t.enabled, false);
  assert.equal(t.skippedReason, "we track work in Linear");
});

test("record-register takes a positive issue number only", () => {
  const root = repo();
  for (const bad of ["abc", "0", "1.5", "-3", "", "12abc"]) assert.throws(() => recordRegister(root, bad), /not an issue number/, bad);
  recordRegister(root, "42");
  assert.equal(manifest(root).guardrails.tracker.issues.register, 42);
});

test("record-register refuses a govkit.json that is a symlink", (t) => {
  const root = repo();
  const outside = tmp("govkit-outside-");
  writeFileSync(join(outside, "govkit.json"), fill(TEMPLATE, "0.11.0"));
  rmSync(join(root, "govkit.json"));
  try {
    symlinkSync(join(outside, "govkit.json"), join(root, "govkit.json"), "file");
  } catch (e) {
    if (e.code === "EPERM") return t.skip("creating a file symlink needs a privilege on this machine");
    throw e;
  }
  assert.throws(() => recordRegister(root, "7"), /is a symlink/);
});

// ------------------------------------------------------------------ the register and the forms

test("the register template has the exact headings the report reads", () => {
  const body = readFileSync(join(GOVKIT, "skills/govkit-init/templates/tracker/register.md"), "utf-8");
  assert.match(body, /^### Things only an owner can do\n\| # \| Action \| Why it matters \| Blocks \|$/m);
  assert.match(body, /^### Open decisions\n\| ID \| Question \| Decide by \| Recommendation \|$/m);
  assert.match(body, /Never invent an owner's answer/);
});

test("the issue forms set a type label, and say a form can't set the launch category", () => {
  for (const [form, label] of [["bug", "bug"], ["user-story", "enhancement"], ["idea", "idea"]]) {
    const y = readFileSync(join(GOVKIT, `skills/govkit-init/templates/tracker/issue-forms/${form}.yml`), "utf-8");
    assert.match(y, new RegExp(`^labels: \\["${label}"\\]$`, "m"), form);
  }
  const story = readFileSync(join(GOVKIT, "skills/govkit-init/templates/tracker/issue-forms/user-story.yml"), "utf-8");
  assert.match(story, /can't set a label from an answer/);
});

// ------------------------------------------------------------------ the doctor

function doctor(root, ci) {
  try {
    return { code: 0, out: execFileSync("node", [join(GOVKIT, "skills/govkit-init/templates/scripts/govkit-doctor.mjs"), ...(ci ? ["--ci"] : [])], { cwd: root, encoding: "utf-8" }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) };
  }
}
/** A repo where only the tracker decision is in question: every other guardrail is skipped with a reason. */
function trackerOnly(tracker) {
  const m = JSON.parse(fill(TEMPLATE, "0.11.0"));
  for (const [k, g] of Object.entries(m.guardrails)) if (k !== "tracker" && !k.startsWith("$")) Object.assign(g, { enabled: false, skippedReason: "not in this test" });
  if (tracker === undefined) delete m.guardrails.tracker;
  else m.guardrails.tracker = tracker;
  return repo(JSON.stringify(m, null, 2));
}

test("not decided is a notice, and --ci stays green: no tracker entry at all (a repo from before 0.11.0)", () => {
  const r = doctor(trackerOnly(undefined), true);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tracker — not decided \(opt-in\)/);
  assert.match(r.out, /1 not decided/);
});

test("not decided is a notice, and --ci stays green: enabled null (a new repo)", () => {
  const r = doctor(trackerOnly({ enabled: null, issues: { register: null } }), true);
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /tracker — not decided/);
});

test("tracker on but no register recorded fails --ci; with one it passes", () => {
  const missing = doctor(trackerOnly({ enabled: true, issues: { register: null, categories: DEFAULT_CATEGORIES } }), true);
  assert.equal(missing.code, 1, missing.out);
  assert.match(missing.out, /missing the decision register's issue number/);
  const ok = doctor(trackerOnly({ enabled: true, issues: { register: 42, categories: DEFAULT_CATEGORIES } }), true);
  assert.equal(ok.code, 0, ok.out);
  assert.match(ok.out, /✅ tracker/);
});

test("declined with a reason: a decision, not a notice", () => {
  const r = doctor(trackerOnly({ enabled: false, skippedReason: "we use Linear" }), true);
  assert.equal(r.code, 0);
  assert.match(r.out, /tracker — skipped: we use Linear/);
  assert.doesNotMatch(r.out, /not decided/);
});

// ------------------------------------------------------------------ what /govkit-init pre-approves

test("only the read-only tracker commands are pre-approved; GitHub writes and govkit.json writes prompt", () => {
  const allowed = /^allowed-tools:(.*)$/m.exec(readFileSync(join(GOVKIT, "skills/govkit-init/SKILL.md"), "utf-8"))[1];
  assert.match(allowed, /tracker\.mjs" labels\*/);
  assert.match(allowed, /tracker\.mjs" pins\*/);
  for (const write of ["record-register", "record-aliases", "enable", "decline", "gh label", "gh issue", "gh api"]) {
    assert.ok(!allowed.includes(write), `pre-approved: ${write}`);
  }
});
