#!/usr/bin/env node
/**
 * docs-kit — what /govkit-session shows about docs-kit in a repo that uses it (#49).
 *
 * docs-kit (https://github.com/techsilon-oss/docs-kit) owns the docs layout, pins and how-tos.
 * govkit only reads: whether docs-kit.json is at the repo root, which docs-kit version the repo
 * has, and the pins still waiting (`pin_status: pinned` under <docsRoot>/notes/). The layout check
 * itself is docs-kit's (`docs-kit check`), and this script never runs it: it is the repo's code,
 * so the session runs it through the normal permission prompt.
 *
 * In a repo without docs-kit.json it prints one line and changes nothing.
 *
 * Dependency-free: Node built-ins only. It reads; it writes nothing.
 *
 * Usage (from the repo root):
 *   node docs-kit.mjs status [--json]
 */

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const CONFIG = "docs-kit.json";

/** docs-kit.json allows // and /* *\/ comments and trailing commas: strip them outside strings. */
export function parseJsonc(text) {
  let out = "";
  let inString = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      out += c;
      if (c === "\\") out += text[++i] ?? "";
      else if (c === '"') inString = false;
    } else if (c === '"') {
      inString = true;
      out += c;
    } else if (c === "/" && text[i + 1] === "/") {
      while (i < text.length && text[i] !== "\n") i++;
      out += "\n";
    } else if (c === "/" && text[i + 1] === "*") {
      i += 2;
      while (i < text.length && !(text[i] === "*" && text[i + 1] === "/")) i++;
      i++;
    } else {
      out += c;
    }
  }
  // trailing commas, outside strings: a comma with only whitespace before the closing } or ]
  let clean = "";
  inString = false;
  for (let i = 0; i < out.length; i++) {
    const c = out[i];
    if (inString) {
      clean += c;
      if (c === "\\") clean += out[++i] ?? "";
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    if (c === "," && /^\s*[}\]]/.test(out.slice(i + 1))) continue;
    clean += c;
  }
  return JSON.parse(clean);
}

/** The docs-kit version the repo has: installed package first, then the dependency spec. */
export function docsKitVersion(root) {
  try {
    const v = JSON.parse(readFileSync(join(root, "node_modules/docs-kit/package.json"), "utf-8")).version;
    if (v) return { version: v, source: "installed (node_modules/docs-kit)" };
  } catch {
    // not installed
  }
  try {
    const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf-8"));
    const spec = pkg.devDependencies?.["docs-kit"] ?? pkg.dependencies?.["docs-kit"];
    if (spec) return { version: spec.match(/\d+\.\d+\.\d+/)?.[0] ?? spec, source: `package.json (${spec}), not installed` };
  } catch {
    // no package.json
  }
  return { version: null, source: "not in package.json" };
}

/** Scalar front-matter keys, enough for title and pin_status. */
function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const data = {};
  if (!m) return data;
  for (const line of m[1].split(/\r?\n/)) {
    const kv = /^([A-Za-z0-9_]+):\s*(.*?)\s*$/.exec(line);
    if (!kv) continue;
    let v = kv[2];
    const q = /^(["'])(.*?)\1/.exec(v);
    v = q ? q[2] : v.replace(/\s+#.*$/, "");
    data[kv[1]] = v.trim();
  }
  return data;
}

/** Pins waiting in <docsRoot>/notes/, oldest first (pin names start with their date). */
export function waitingPins(root, docsRoot) {
  const dir = join(root, docsRoot, "notes");
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  return readdirSync(dir)
    .filter((f) => f.endsWith(".md") && f.toLowerCase() !== "readme.md")
    .sort()
    .flatMap((f) => {
      const fm = frontMatter(readFileSync(join(dir, f), "utf-8"));
      if (fm.pin_status !== "pinned") return [];
      return [{ file: `${docsRoot}/notes/${f}`, date: /^\d{4}-\d{2}-\d{2}/.exec(f)?.[0] ?? null, title: fm.title || f }];
    });
}

/** Everything /govkit-session shows, or { configured: false } in a repo without docs-kit. */
export function status(root = process.cwd()) {
  const path = join(root, CONFIG);
  if (!existsSync(path)) return { configured: false };
  try {
    const g = JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8")).guardrails?.["docs-kit"];
    if (g?.enabled === false) return { configured: true, off: true, reason: g.skippedReason ?? "no reason recorded" };
  } catch {
    // no govkit.json, or unreadable: the doctor reports that
  }
  let cfg;
  try {
    cfg = parseJsonc(readFileSync(path, "utf-8"));
  } catch (err) {
    return { configured: true, error: `${CONFIG} could not be read: ${err.message}` };
  }
  const docsRoot = (typeof cfg.docsRoot === "string" && cfg.docsRoot.trim() ? cfg.docsRoot : "docs").replace(/\\/g, "/").replace(/^\.\/|\/+$/g, "");
  return { configured: true, docsRoot, ...docsKitVersion(root), pins: waitingPins(root, docsRoot) };
}

export function render(s) {
  if (!s.configured) return `docs-kit: not used here (no ${CONFIG}). Nothing to show.`;
  if (s.off) return `docs-kit: turned off in govkit.json (${s.reason}). Nothing to show.`;
  if (s.error) return `docs-kit: ${s.error}`;
  const lines = [`docs-kit: configured (${CONFIG}, docs root ${s.docsRoot}/), version ${s.version ?? "unknown"}: ${s.source}`];
  if (s.pins.length === 0) lines.push("  Waiting pins: none");
  else {
    lines.push(`  Waiting pins (${s.pins.length}, oldest first):`);
    for (const p of s.pins) lines.push(`    ${p.date ?? "????-??-??"}  ${p.title}  (${p.file})`);
  }
  lines.push("  Stale how-tos: from `docs-kit check` (the repo's docs-kit; run it, it is not pre-approved).");
  return lines.join("\n");
}

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd !== "status") {
    console.error("usage: docs-kit.mjs status [--json]");
    process.exit(2);
  }
  const s = status();
  console.log(rest.includes("--json") ? JSON.stringify(s, null, 2) : render(s));
}
