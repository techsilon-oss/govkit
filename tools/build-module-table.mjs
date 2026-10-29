#!/usr/bin/env node
/**
 * build-module-table — the README's module table, generated from module.json.
 *
 * The notes are kept once (module.json); the README shows them as a table between the
 * <!-- modules:start --> and <!-- modules:end --> markers. Run this after editing module.json;
 * a test fails while the README is out of date.
 *
 * Usage (from the govkit repo root):  node tools/build-module-table.mjs [--check]
 */

import { readFileSync, writeFileSync } from "node:fs";
import { loadModules, moduleTable } from "../skills/govkit-init/modules.mjs";

const START = "<!-- modules:start: generated from module.json by tools/build-module-table.mjs; do not edit by hand -->";
const END = "<!-- modules:end -->";

export function renderReadme(readme, modules = loadModules()) {
  const at = readme.indexOf(START.slice(0, "<!-- modules:start".length));
  const end = readme.indexOf(END);
  if (at < 0 || end < at) throw new Error("README.md has no <!-- modules:start --> ... <!-- modules:end --> markers");
  return `${readme.slice(0, at)}${START}\n${moduleTable(modules)}\n${readme.slice(end)}`;
}

const isMain = process.argv[1]?.endsWith("build-module-table.mjs");
if (isMain) {
  const before = readFileSync("README.md", "utf-8").replace(/\r\n/g, "\n");
  const after = renderReadme(before);
  if (process.argv.includes("--check")) {
    if (after !== before) {
      console.error("README.md's module table is out of date: run node tools/build-module-table.mjs");
      process.exit(1);
    }
    console.log("README module table is current.");
  } else {
    writeFileSync("README.md", after);
    console.log(after === before ? "README module table already current." : "README module table rebuilt from module.json.");
  }
}
