// Tests for the docs-kit module (#49): with docs-kit.json at the repo root, the doctor reports it
// and the session lists the waiting pins; without it, both say nothing and change nothing. Neither
// script ever runs docs-kit (the repo's code): the skills run `docs-kit check` through a prompt.

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { parseJsonc, render, status } from "../skills/govkit-session/docs-kit.mjs";
import { GOVKIT, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const DOCTOR = join(GOVKIT, "skills/govkit-init/templates/scripts/govkit-doctor.mjs");
const SESSION = join(GOVKIT, "skills/govkit-session/docs-kit.mjs");

function makeRepo(files = {}) {
  const root = tmp("govkit-docskit-");
  const all = { "govkit.json": JSON.stringify({ govkitVersion: "0.13.0", guardrails: {} }), ...files };
  for (const [p, text] of Object.entries(all)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  }
  return root;
}

/** Every file under root, with its contents: to show a run changed nothing. */
function snapshot(root) {
  const out = {};
  const walk = (d) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = join(d, e.name);
      if (e.isDirectory()) walk(p);
      else out[p] = readFileSync(p, "utf-8");
    }
  };
  walk(root);
  return out;
}

const run = (script, root, ...args) => spawnSync(process.execPath, [script, ...args], { cwd: root, encoding: "utf-8" });

const pin = (title, pinStatus) => `---\ntitle: "${title}"\ndoc_kind: "note"\npin_status: "${pinStatus}"     # pinned | promoted | dropped\n---\n\n# ${title}\n`;

const DOCS_KIT_JSON = `// docs-kit.json, with what docs-kit allows: comments and trailing commas
{
  "docsRoot": "documentation", /* not the default */
  "rootAllowed": ["README.md", "a, }", "http://example.com/x"],
}
`;

// ------------------------------------------------------------------ without docs-kit.json

test("no docs-kit.json: the session script says so, and changes nothing", () => {
  const root = makeRepo({ "docs/notes/2026-11-01-0900_x.md": pin("X", "pinned") });
  const before = snapshot(root);
  const out = run(SESSION, root, "status");
  assert.equal(out.status, 0, out.stderr);
  assert.match(out.stdout, /not used here/);
  assert.doesNotMatch(out.stdout, /Waiting pins/);
  assert.deepEqual(status(root), { configured: false });
  assert.deepEqual(snapshot(root), before);
});

test("no docs-kit.json: the doctor prints nothing about docs-kit, and changes nothing", () => {
  const root = makeRepo();
  const before = snapshot(root);
  const out = run(DOCTOR, root, "--ci");
  assert.equal(out.status, 0, out.stdout);
  assert.doesNotMatch(out.stdout, /docs-kit/);
  assert.deepEqual(snapshot(root), before);
});

// ------------------------------------------------------------------ with docs-kit.json

test("the session lists waiting pins only, oldest first, under docsRoot from a commented docs-kit.json", () => {
  const root = makeRepo({
    "docs-kit.json": DOCS_KIT_JSON,
    "documentation/notes/README.md": "# Notes\n",
    "documentation/notes/2026-11-05-1400_later-one.md": pin("Later one", "pinned"),
    "documentation/notes/2026-10-01-0900_first-one.md": pin("First one", "pinned"),
    "documentation/notes/2026-10-15-0900_promoted.md": pin("Promoted", "promoted"),
    "documentation/notes/2026-10-20-0900_dropped.md": pin("Dropped", "dropped"),
    "docs/notes/2026-09-01-0900_wrong-root.md": pin("Wrong root", "pinned"),
    "node_modules/docs-kit/package.json": JSON.stringify({ name: "docs-kit", version: "0.4.1" }),
  });
  const before = snapshot(root);
  const s = status(root);
  assert.equal(s.docsRoot, "documentation");
  assert.equal(s.version, "0.4.1");
  assert.deepEqual(s.pins.map((p) => [p.date, p.title]), [["2026-10-01", "First one"], ["2026-11-05", "Later one"]]);
  const out = run(SESSION, root, "status");
  assert.match(out.stdout, /configured \(docs-kit\.json, docs root documentation\/\), version 0\.4\.1/);
  assert.match(out.stdout, /Waiting pins \(2, oldest first\):\n\s+2026-10-01  First one/);
  assert.match(out.stdout, /docs-kit check/);
  assert.deepEqual(snapshot(root), before, "reads only");
});

test("the version comes from package.json when docs-kit isn't installed; none at all is said", () => {
  const spec = { "docs-kit.json": "{}", "package.json": JSON.stringify({ devDependencies: { "docs-kit": "github:techsilon-oss/docs-kit#v0.4.0" } }) };
  const s = status(makeRepo(spec));
  assert.equal(s.version, "0.4.0");
  assert.match(s.source, /not installed/);
  assert.equal(s.docsRoot, "docs", "the default docs root");
  assert.deepEqual(s.pins, []);
  assert.match(render(s), /Waiting pins: none/);
  assert.equal(status(makeRepo({ "docs-kit.json": "{}" })).version, null);
});

test("the doctor reports docs-kit and its version, never runs it, and never fails --ci for it", () => {
  const root = makeRepo({
    "docs-kit.json": DOCS_KIT_JSON,
    "node_modules/docs-kit/package.json": JSON.stringify({ name: "docs-kit", version: "0.4.1" }),
    // a planted docs-kit that would leave a mark if anything ran it
    "node_modules/.bin/docs-kit": "#!/bin/sh\ntouch RAN\n",
    "node_modules/docs-kit/scripts/docs-kit.mjs": "import { writeFileSync } from 'node:fs'; writeFileSync('RAN', '');\n",
  });
  const before = snapshot(root);
  const out = run(DOCTOR, root, "--ci");
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /📚 docs-kit — configured \(docs-kit\.json\), version 0\.4\.1/);
  assert.match(out.stdout, /npx --no-install docs-kit check/);
  assert.deepEqual(snapshot(root), before, "nothing ran, nothing changed");
});

test("the doctor: docs-kit.json without docs-kit installed gives the fix, still green under --ci", () => {
  const root = makeRepo({ "docs-kit.json": "{}", "package.json": JSON.stringify({ devDependencies: { "docs-kit": "github:techsilon-oss/docs-kit#v0.4.1" } }) });
  const out = run(DOCTOR, root, "--ci");
  assert.equal(out.status, 0, out.stdout);
  assert.match(out.stdout, /but not installed \(package\.json asks for github:techsilon-oss\/docs-kit#v0\.4\.1: run npm install\)/);
  assert.match(out.stdout, /fix: https:\/\/github\.com\/techsilon-oss\/govkit\/blob\/v[\d.]+\/docs\/modules\/docs-kit\.md#fix-a-finding/);
});

test("turned off in govkit.json: the doctor lists it as skipped, the session shows nothing", () => {
  const govkit = JSON.stringify({ guardrails: { "docs-kit": { enabled: false, skippedReason: "docs are checked elsewhere" } } });
  const root = makeRepo({ "govkit.json": govkit, "docs-kit.json": "{}", "docs/notes/2026-11-01-0900_x.md": pin("X", "pinned") });
  const doctor = run(DOCTOR, root, "--ci");
  assert.equal(doctor.status, 0);
  assert.match(doctor.stdout, /docs-kit — skipped: docs are checked elsewhere/);
  assert.doesNotMatch(doctor.stdout, /📚/);
  const out = run(SESSION, root, "status");
  assert.match(out.stdout, /turned off in govkit\.json \(docs are checked elsewhere\)/);
  assert.doesNotMatch(out.stdout, /Waiting pins/);
});

test("an unreadable docs-kit.json is said, not thrown", () => {
  const out = run(SESSION, makeRepo({ "docs-kit.json": "{ nope" }), "status");
  assert.equal(out.status, 0);
  assert.match(out.stdout, /docs-kit\.json could not be read/);
});

// ------------------------------------------------------------------ JSON with comments

test("parseJsonc strips comments and trailing commas, and leaves strings alone", () => {
  const cfg = parseJsonc(DOCS_KIT_JSON);
  assert.deepEqual(cfg, { docsRoot: "documentation", rootAllowed: ["README.md", "a, }", "http://example.com/x"] });
  assert.deepEqual(parseJsonc('{"a": "say \\"/* hi */\\"",}'), { a: 'say "/* hi */"' });
  assert.throws(() => parseJsonc("{ nope"));
});
