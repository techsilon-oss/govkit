// Tests for the doc-sync gate (govkit-docsync.mjs audit --gate): a source file whose only change
// rewrites a doc path the same diff renamed is not counted as changed (#52).

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { GOVKIT, git, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const RUNNER = join(GOVKIT, "skills/govkit-init/templates/scripts/govkit-docsync.mjs");

const BILLING = [
  "export function refund(order) {",
  "  // see docs/BILLING.md §3.6",
  "  return order.total;",
  "}",
  "",
].join("\n");

/** A repo on `main` with a billing source file mapped to two policy docs, and a branch `work`. */
function makeRepo() {
  const root = tmp("govkit-docsync-");
  const put = (p, text) => {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), text);
  };
  git(root, "init", "-q", "-b", "main");
  git(root, "config", "core.autocrlf", "false");
  put(
    "scripts/source-doc-map.json",
    JSON.stringify({
      mappings: [{ source: ["src/billing/**"], docs: ["docs/REFUNDS.md", "docs/SUBSCRIPTIONS.md"], severity: "gate" }],
    }),
  );
  put("src/billing/refund.js", BILLING);
  put("docs/BILLING.md", "# Billing\n\nHow billing works, in enough lines for git to see a rename.\n\n## 3.6 Refunds\n\nRefunds follow the refund policy.\n");
  put("docs/REFUNDS.md", "# Refunds\n");
  put("docs/SUBSCRIPTIONS.md", "# Subscriptions\n");
  git(root, "add", "-A");
  git(root, "commit", "-qm", "init");
  git(root, "switch", "-qc", "work");
  return {
    root,
    put,
    edit: (p, fn) => put(p, fn(readFileSync(join(root, p), "utf-8"))),
    move: (from, to) => {
      mkdirSync(dirname(join(root, to)), { recursive: true });
      renameSync(join(root, from), join(root, to));
    },
    commit: () => {
      git(root, "add", "-A");
      git(root, "commit", "-qm", "change");
    },
  };
}

const gate = (root) =>
  spawnSync(process.execPath, [RUNNER, "audit", "--gate", "--base", "main"], { cwd: root, encoding: "utf-8" });

const moveBillingDoc = (r) => {
  r.move("docs/BILLING.md", "docs/platform/BILLING.md");
  r.edit("src/billing/refund.js", (t) => t.replace("docs/BILLING.md", "docs/platform/BILLING.md"));
};

test("a source file changed only by a renamed doc path: no finding", () => {
  const r = makeRepo();
  moveBillingDoc(r);
  r.commit();
  const out = gate(r.root);
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /No drift detected/);
  assert.match(out.stdout, /Not counted as changed .*src\/billing\/refund\.js/);
});

test("the same file with one other edit: the gate fires as before", () => {
  const r = makeRepo();
  moveBillingDoc(r);
  r.edit("src/billing/refund.js", (t) => t.replace("return order.total;", "return order.total - order.fee;"));
  r.commit();
  const out = gate(r.root);
  assert.equal(out.status, 1, out.stdout);
  assert.match(out.stdout, /mapped doc not updated: docs\/REFUNDS\.md/);
  assert.match(out.stdout, /mapped doc not updated: docs\/SUBSCRIPTIONS\.md/);
});

test("the path rewritten and another edit on the same line: the gate fires", () => {
  const r = makeRepo();
  moveBillingDoc(r);
  r.edit("src/billing/refund.js", (t) => t.replace("§3.6", "§4.1"));
  r.commit();
  assert.equal(gate(r.root).status, 1);
});

test("a path rewritten to a doc that was not renamed: the gate fires", () => {
  const r = makeRepo();
  r.edit("src/billing/refund.js", (t) => t.replace("docs/BILLING.md", "docs/platform/BILLING.md"));
  r.commit();
  assert.equal(gate(r.root).status, 1);
});

test("a source change with no rename in the diff: the gate fires as before", () => {
  const r = makeRepo();
  r.edit("src/billing/refund.js", (t) => `${t}// a note\n`);
  r.commit();
  assert.equal(gate(r.root).status, 1);
});
