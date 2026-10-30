#!/usr/bin/env node
/**
 * daily-report — govkit's status report: what happened in the repo since the last report, sent to
 * the team. Part of the tracker module (govkit.json → guardrails.tracker.report).
 *
 * WHERE IT COMES FROM
 * -------------------
 * A pattern that ran in production for months, generalized. Its hard rules are bugs that already
 * happened there, each with a test in govkit:
 *   - a count is used only if it is a number, a list only if it is a list; otherwise the report
 *     says "Some numbers are incomplete (API error)" — never a silent zero;
 *   - every list is paginated; a failed call is retried once, a rate-limited one never;
 *   - list endpoints only: the search API's ~30/min limit once failed the whole report;
 *   - issue text is escaped (HTML), mentions are defused (a title with @name in a GitHub comment
 *     would notify that person every day), and text is cut by character, never by byte;
 *   - a section that can't be read says so instead of disappearing;
 *   - a delivery that fails fails the job, so the Actions tab shows it.
 *
 * Delivery: "github-issue" (default; a comment on a pinned issue, which GitHub's notification
 * email delivers — no key) or "resend" (a designed HTML email plus plain text; needs a key in the
 * Actions secret named by tracker.report.resend.secret).
 *
 * Dependency-free: Node 22 built-ins (fetch). Runs in the workflow without `npm ci`.
 * Custom sections: scripts/daily-report/sections/<name>.mjs, listed in tracker.report.sections.
 *
 * Usage (in the workflow): node scripts/daily-report/report.mjs
 *   env: GITHUB_TOKEN, GITHUB_REPOSITORY, TEST_MODE ("true" = no comment, email to the test
 *   recipient only), GITHUB_STEP_SUMMARY, and the Resend key under its configured name.
 */

import { existsSync, readFileSync, appendFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_SECTIONS = [
  "header", "owner-actions", "decisions", "deliverables", "completed", "fix-shipped",
  "new", "bugs", "open-breakdown", "milestones", "code-activity",
];
const WORKFLOW_FILE = "govkit-daily-report.yml";
const COMMENT_LIMIT = 65000; // GitHub's comment limit is 65,536 characters

// ------------------------------------------------------------------ text safety

export const escapeHtml = (s) =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Markdown-safe text: no table breaks, no new lines, and no @mentions that would notify people. */
export const mdText = (s) =>
  String(s ?? "")
    .replace(/\r?\n/g, " ")
    .replace(/([|[\]])/g, "\\$1") // a title with | or ] would break a table or a link
    .replace(/@(?=[A-Za-z0-9-])/g, "@​")
    .replace(/</g, "&lt;");

/** Cut to n characters (code points, so an emoji is never split), with an ellipsis. */
export const truncate = (s, n) => {
  const chars = [...String(s ?? "")];
  return chars.length > n ? `${chars.slice(0, n - 1).join("")}…` : chars.join("");
};

// ------------------------------------------------------------------ the API, with the hard rules

const RATE_LIMITED = (status, headers) =>
  (status === 403 || status === 429) && (headers.get?.("x-ratelimit-remaining") === "0" || headers.get?.("retry-after") != null);

/**
 * The GitHub API: `api(path, {method, body})` → `{ ok, status, data, next, rateLimited }`.
 * A failure is retried once; a rate-limited answer never is.
 */
export function makeApi({ token, base = "https://api.github.com", fetchImpl = fetch } = {}) {
  return async function api(path, { method = "GET", body } = {}) {
    const url = path.startsWith("http") ? path : `${base}/${path.replace(/^\//, "")}`;
    let last;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetchImpl(url, {
          method,
          headers: {
            accept: "application/vnd.github+json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            "x-github-api-version": "2022-11-28",
            ...(body ? { "content-type": "application/json" } : {}),
          },
          body: body ? JSON.stringify(body) : undefined,
        });
        const data = await res.json().catch(() => null);
        const next = /<([^>]+)>;\s*rel="next"/.exec(res.headers.get?.("link") ?? "")?.[1] ?? null;
        last = { ok: res.ok, status: res.status, data, next, rateLimited: RATE_LIMITED(res.status, res.headers) };
        if (res.ok || last.rateLimited || res.status < 500) return last;
      } catch (e) {
        last = { ok: false, status: 0, data: null, next: null, rateLimited: false, error: String(e) };
      }
    }
    return last;
  };
}

/** Collects what couldn't be read, so the report can say so instead of showing silent zeros. */
export class Notes {
  constructor() {
    this.incomplete = false;
    this.lines = [];
  }
  fail(what, res) {
    this.incomplete = true;
    this.lines.push(`${what}: ${res?.rateLimited ? "rate-limited" : `API error ${res?.status ?? "?"}`}`);
  }
}

/** Every page of a list endpoint. Accepts a page only if it's an array; stops at `until(item)`. */
export async function paginate(api, path, notes, what, { until, pick } = {}) {
  const out = [];
  let next = path;
  while (next) {
    const res = await api(next);
    const page = pick ? pick(res.data) : res.data;
    if (!res.ok || !Array.isArray(page)) {
      notes.fail(what, res);
      return out;
    }
    for (const item of page) {
      if (until?.(item)) return out;
      out.push(item);
    }
    next = res.next;
  }
  return out;
}

/** A count only if it's a non-negative integer; otherwise 0, and the report says it's incomplete. */
export const count = (v, notes, what) => {
  if (Number.isInteger(v) && v >= 0) return v;
  notes.fail(what, { status: "not a number" });
  return 0;
};

// ------------------------------------------------------------------ the register

/** The table under a `### <heading>` line, as rows of cells (header and separator dropped). */
export function tableAfterHeading(markdown, heading) {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n");
  const at = lines.findIndex((l) => l.trim().toLowerCase() === `### ${heading}`.toLowerCase());
  if (at < 0) return null;
  const rows = [];
  for (const l of lines.slice(at + 1)) {
    if (!l.trim()) {
      if (rows.length) break;
      continue;
    }
    if (!l.trim().startsWith("|")) break;
    rows.push(l.trim().replace(/^\||\|$/g, "").split("|").map((c) => c.trim()));
  }
  return rows.slice(2).filter((r) => r.some(Boolean));
}

// ------------------------------------------------------------------ gather

const labels = (i) => (Array.isArray(i?.labels) ? i.labels.map((l) => String(l.name ?? l).toLowerCase()) : []);
const has = (i, name) => labels(i).includes(String(name).toLowerCase());
const CLOSING = /\b(?:close[sd]?|fix(?:e[sd])?|resolve[sd]?)\s+#(\d+)/gi;

/** Everything the report shows, read through `api`. Pure apart from `api`. */
export async function gather(api, cfg, now = new Date()) {
  const notes = new Notes();
  const repo = cfg.repo;
  const issuesCfg = cfg.issues ?? {};
  const rep = cfg.report ?? {};
  const categories = issuesCfg.categories ?? ["pre-launch", "post-launch", "idea", "triage"];
  const alias = (t) => issuesCfg.labelAliases?.[t] ?? t;
  const special = new Set([issuesCfg.register, rep.issue].filter(Number.isInteger));

  // The window: since the last successful real run of this report, else the last 24 hours. A test
  // run (the workflow names it "… (test)") delivered nothing, so it doesn't move the window.
  const runs = await api(`repos/${repo}/actions/workflows/${WORKFLOW_FILE}/runs?status=success&per_page=30`);
  const lastRun = runs.ok && Array.isArray(runs.data?.workflow_runs)
    ? runs.data.workflow_runs.find((r) => !/\(test\)\s*$/.test(r.display_title ?? "")) ?? null
    : null;
  const since = lastRun ? new Date(lastRun.run_started_at ?? lastRun.created_at) : new Date(now - 24 * 3600 * 1000);
  const window = { since, until: now, fallback: !lastRun };
  const inWindow = (t) => t && new Date(t) >= since && new Date(t) <= now;

  const isIssue = (i) => i && !i.pull_request;
  const open = (await paginate(api, `repos/${repo}/issues?state=open&per_page=100`, notes, "open issues")).filter(isIssue);
  const touched = (await paginate(api, `repos/${repo}/issues?state=all&per_page=100&since=${since.toISOString()}`, notes, "issues in the window")).filter(isIssue);
  const closed = touched.filter((i) => i.state === "closed" && inWindow(i.closed_at) && !special.has(i.number));
  const opened = touched.filter((i) => inWindow(i.created_at) && !special.has(i.number));

  const branches = [...new Set([rep.branches?.work, rep.branches?.release].filter(Boolean))];
  const prs = [];
  for (const b of branches.length ? branches : ["main"]) {
    const list = await paginate(api, `repos/${repo}/pulls?state=closed&base=${encodeURIComponent(b)}&sort=updated&direction=desc&per_page=100`, notes, `pull requests into ${b}`, {
      until: (p) => new Date(p.updated_at) < since,
    });
    prs.push(...list.filter((p) => inWindow(p.merged_at)));
  }
  const closedNums = new Set(closed.map((i) => i.number));
  const prsAlone = prs.filter((p) => ![...`${p.title ?? ""} ${p.body ?? ""}`.matchAll(CLOSING)].some((m) => closedNums.has(Number(m[1]))));

  const work = rep.branches?.work ?? branches[0] ?? "main";
  const commits = await paginate(api, `repos/${repo}/commits?sha=${encodeURIComponent(work)}&since=${since.toISOString()}&per_page=100`, notes, `commits on ${work}`);

  const milestones = (await paginate(api, `repos/${repo}/milestones?state=open&per_page=100`, notes, "milestones")).map((m) => ({
    title: m.title,
    url: m.html_url,
    open: count(m.open_issues, notes, `milestone ${m.title}`),
    closed: count(m.closed_issues, notes, `milestone ${m.title}`),
  }));

  // The decision register: read fresh every run, the only source of owner actions and decisions.
  let register = { ok: false };
  if (Number.isInteger(issuesCfg.register)) {
    const r = await api(`repos/${repo}/issues/${issuesCfg.register}`);
    const owner = r.ok ? tableAfterHeading(r.data?.body, "Things only an owner can do") : null;
    const decisions = r.ok ? tableAfterHeading(r.data?.body, "Open decisions") : null;
    register = owner && decisions ? { ok: true, number: issuesCfg.register, url: r.data.html_url, owner, decisions } : { ok: false, number: issuesCfg.register };
    if (!register.ok) notes.fail("the decision register", r);
  }

  // Key deliverables: the "Completed:" line of up to 5 closed issues, most important first.
  const rank = (i) => (has(i, categories[0]) ? 0 : has(i, "enhancement") ? 1 : has(i, alias("bug")) ? 2 : 3);
  const deliverables = [];
  for (const i of [...closed].sort((a, b) => rank(a) - rank(b)).slice(0, 5)) {
    const comments = await paginate(api, `repos/${repo}/issues/${i.number}/comments?per_page=100`, notes, `comments on #${i.number}`);
    const text = comments
      .map((c) => /^\s*Completed:\s*([\s\S]*?)(?:\n\s*\n|$)/im.exec(c.body ?? "")?.[1]?.trim())
      .filter(Boolean)
      .at(-1);
    if (text) deliverables.push({ number: i.number, title: i.title, url: i.html_url, text });
  }

  let reported = null;
  if (rep.reportedLabel) {
    const all = (await paginate(api, `repos/${repo}/issues?state=all&labels=${encodeURIComponent(rep.reportedLabel)}&per_page=100`, notes, `issues labelled ${rep.reportedLabel}`)).filter(isIssue);
    const d30 = new Date(now - 30 * 24 * 3600 * 1000);
    reported = {
      open: all.filter((i) => i.state === "open" && !has(i, "fix-shipped")).length,
      fixShipped: all.filter((i) => i.state === "open" && has(i, "fix-shipped")).length,
      closed: all.filter((i) => i.state === "closed").length,
      recent: all.filter((i) => new Date(i.created_at) >= d30),
    };
  }

  const planned = open.filter((i) => !special.has(i.number));
  const byCategory = Object.fromEntries(categories.map((c) => [c, planned.filter((i) => has(i, c)).length]));
  const toTriage = planned.filter((i) => !categories.some((c) => has(i, c)));

  return {
    repo, now, window, notes, categories,
    open: planned, closed, opened, prs, prsAlone, commits, milestones, register, deliverables, reported,
    breakdown: {
      byCategory,
      toTriage,
      business: planned.filter((i) => has(i, "business")).length,
      engineering: planned.filter((i) => !has(i, "business")).length,
      blocked: planned.filter((i) => has(i, "blocked")).length,
      ideas: planned.filter((i) => has(i, alias("idea")) || has(i, "future")).length,
    },
    fixShipped: planned.filter((i) => has(i, "fix-shipped")),
  };
}

export const isQuiet = (d) => d.closed.length + d.opened.length + d.prs.length + d.commits.length === 0;

// ------------------------------------------------------------------ sections

const link = (url, text) => `[${mdText(text)}](${url})`;
const issueLine = (i) => `${link(i.html_url ?? i.url, `#${i.number} ${truncate(i.title, 90)}`)}`;
const ul = (items, fmt) => (items.length ? items.map((x) => `- ${fmt(x)}`).join("\n") : "_None._");
const table = (head, rows) =>
  rows.length ? [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.map((c) => mdText(c)).join(" | ")} |`)].join("\n") : "_None._";
const day = (d) => d.toISOString().slice(0, 10);
const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/** Built-in sections: each returns { title, markdown } from the gathered data. */
export const SECTIONS = {
  header: (d, cfg) => ({
    title: `${mdText(cfg.report?.brand?.name ?? d.repo)} — status ${day(d.now)}`,
    markdown: [
      `**${d.closed.length}** closed · **${d.opened.length}** opened · **${d.open.length}** open`,
      `Window: ${d.window.since.toISOString().slice(0, 16).replace("T", " ")} → ${d.now.toISOString().slice(0, 16).replace("T", " ")} UTC${d.window.fallback ? " (no earlier successful report found: the last 24 hours)" : ""}`,
    ].join("\n\n"),
  }),
  "owner-actions": (d) => ({
    title: "Owner actions",
    markdown: d.register.ok ? table(["#", "Action", "Why it matters", "Blocks"], d.register.owner) : "Could not read the decision register.",
  }),
  decisions: (d) => ({
    title: "Top open decisions",
    markdown: d.register.ok ? table(["ID", "Question", "Decide by", "Recommendation"], d.register.decisions.slice(0, 5)) : "Could not read the decision register.",
  }),
  deliverables: (d) => ({
    title: "Key deliverables",
    markdown: d.deliverables.length ? d.deliverables.map((x) => `- **${mdText(truncate(x.text, 300))}** (${link(x.url, `#${x.number}`)})`).join("\n") : "_None._",
  }),
  completed: (d) => ({
    title: "Completed in this window",
    markdown: [ul(d.closed, issueLine), d.prsAlone.length ? `\nMerged pull requests:\n${ul(d.prsAlone, (p) => link(p.html_url, `#${p.number} ${truncate(p.title, 90)}`))}` : ""].join(""),
  }),
  "fix-shipped": (d) => ({ title: "Fixed, waiting for re-test", markdown: ul(d.fixShipped, issueLine) }),
  new: (d) => ({ title: "New issues", markdown: ul(d.opened, (i) => `${issueLine(i)}${i.labels?.length ? ` — ${i.labels.map((l) => `\`${mdText(l.name ?? l)}\``).join(" ")}` : ""}`) }),
  bugs: (d, cfg) => ({
    title: "Reported bugs",
    markdown: !d.reported
      ? `_Not configured: set \`reportedLabel\` in govkit.json to track bugs people report._`
      : `${d.reported.open} open · ${d.reported.fixShipped} fixed, waiting for re-test · ${d.reported.closed} closed (all time, label \`${mdText(cfg.report.reportedLabel)}\`)\n\nLast 30 days:\n${ul(d.reported.recent, issueLine)}`,
  }),
  "open-breakdown": (d) => ({
    title: "Open issues",
    markdown: [
      table(["Launch category", "Open"], Object.entries(d.breakdown.byCategory).map(([c, n]) => [c, String(n)])),
      `Engineering ${d.breakdown.engineering} · Business ${d.breakdown.business} · Blocked ${d.breakdown.blocked} · Ideas ${d.breakdown.ideas}`,
      d.breakdown.toTriage.length
        ? `**⚠️ To triage: ${d.breakdown.toTriage.length}** (open issues with no launch category)\n${ul(d.breakdown.toTriage, issueLine)}`
        : "To triage: 0",
    ].join("\n\n"),
  }),
  milestones: (d) => ({
    title: "Active milestones",
    markdown: table(
      ["Milestone", "Open", "Closed", "Done"],
      [...d.milestones].sort((a, b) => b.open - a.open).slice(0, 5).map((m) => [m.title, String(m.open), String(m.closed), `${m.open + m.closed ? Math.round((100 * m.closed) / (m.open + m.closed)) : 0}%`]),
    ),
  }),
  "code-activity": (d) => {
    const authors = new Set(d.commits.map((c) => c.author?.login ?? c.commit?.author?.name).filter(Boolean));
    return { title: "Code activity", markdown: `${plural(d.commits.length, "commit")} · ${plural(d.prs.length, "pull request")} merged · ${plural(authors.size, "active author")}` };
  },
  effort: (d, cfg) => ({
    title: "Effort (estimate)",
    markdown: cfg.report?.effortHours ? `About ${d.closed.length * cfg.report.effortHours} hours (${plural(d.closed.length, "closed issue")} ×${cfg.report.effortHours} h, an estimate)` : "_Not configured (effortHours)._",
  }),
};

/** A custom section from scripts/daily-report/sections/<name>.mjs, if the repo has one. */
async function customSection(name, root) {
  if (!/^[a-z0-9-]+$/.test(name)) return null;
  const file = join(root, "scripts", "daily-report", "sections", `${name}.mjs`);
  if (!existsSync(file)) return null;
  return (await import(pathToFileURL(file).href)).default;
}

/** The report as Markdown (GitHub issue comment, job summary) plus one entry per section. */
export async function render(d, cfg, { root = process.cwd() } = {}) {
  const names = cfg.report?.sections ?? DEFAULT_SECTIONS;
  const parts = [];
  const unknown = [];
  for (const name of names) {
    let fn = SECTIONS[name];
    if (!fn) {
      try {
        fn = await customSection(name, root);
      } catch {
        fn = () => {
          throw new Error("could not load");
        };
      }
    }
    if (!fn) {
      unknown.push(name);
      continue;
    }
    try {
      const s = await fn(d, cfg);
      parts.push({ name, title: String(s.title ?? name), markdown: String(s.markdown ?? "") });
    } catch {
      parts.push({ name, title: name, markdown: `Could not read ${mdText(name)}.` });
    }
  }
  const warn = [];
  if (d.notes.incomplete) warn.push(`> ⚠️ **Some numbers are incomplete (API error):** ${d.notes.lines.map(mdText).join("; ")}`);
  if (unknown.length) warn.push(`> Unknown section(s) in govkit.json, skipped: ${unknown.map((n) => `\`${mdText(n)}\``).join(", ")}`);
  const [head, ...rest] = parts;
  const markdown = [
    head ? `## ${head.title}\n\n${head.markdown}` : "",
    ...warn,
    ...rest.map((p) => `### ${p.title}\n\n${p.markdown}`),
    `<sub>govkit daily report · ${day(d.now)}</sub>`,
  ].filter(Boolean).join("\n\n");
  return { markdown, parts, unknown };
}

// ------------------------------------------------------------------ the designed email (resend)

const HEX = /^#[0-9a-f]{6}$/i;
// A Markdown link whose text may hold mdText's escaped \[ \] (a title like "Fix [beta] login").
const LINK = /\[((?:\\.|[^\]\\])+)\]\((https?:[^)\s]+)\)/g;

/** govkit's standard email: neutral, inline CSS, one column ~640px. Brand is optional. */
export function emailHtml(r, d, cfg) {
  const brand = cfg.report?.brand ?? {};
  const accent = HEX.test(brand.accentColor ?? "") ? brand.accentColor : "#24292f";
  const logo = /^https:\/\//.test(brand.logoUrl ?? "") ? `<img src="${escapeHtml(brand.logoUrl)}" alt="" height="28" style="height:28px;vertical-align:middle;margin-right:8px">` : "";
  // Markdown to simple HTML: headings, bold, links, lists, tables, quotes. Text is escaped first.
  const md2html = (md) => {
    const out = [];
    let list = false;
    let rows = [];
    const flush = () => {
      if (list) out.push("</ul>");
      list = false;
      if (rows.length) {
        const cells = (r, tag) => r.map((c) => `<${tag} style="text-align:left;padding:4px 8px;border-bottom:1px solid #d0d7de;font-size:13px">${c}</${tag}>`).join("");
        out.push(`<table style="border-collapse:collapse;width:100%;margin:6px 0">${rows.map((r, i) => `<tr>${cells(r, i ? "td" : "th")}</tr>`).join("")}</table>`);
      }
      rows = [];
    };
    const inline = (s) =>
      escapeHtml(s.replace(/\\\|/g, "|").replace(/@\u200B/g, "@").replace(/&lt;/g, "<"))
        .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
        .replace(/`([^`]+)`/g, '<code style="font-size:12px">$1</code>')
        .replace(LINK, `<a href="$2" style="color:${accent}">$1</a>`)
        .replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>")
        .replace(/\\([[\]])/g, "$1");
    for (const line of md.split("\n")) {
      if (/^\|.*\|$/.test(line)) {
        if (/^\|[-| ]+\|$/.test(line)) continue;
        rows.push(line.slice(1, -1).split(/(?<!\\)\|/).map((c) => inline(c.trim())));
        continue;
      }
      if (rows.length) flush();
      const h = /^(#{2,3}) (.*)$/.exec(line);
      if (h) {
        flush();
        out.push(h[1] === "##" ? `<h1 style="font-size:20px;margin:0 0 6px">${inline(h[2])}</h1>` : `<h2 style="font-size:15px;margin:18px 0 6px;border-bottom:2px solid ${accent};padding-bottom:3px">${inline(h[2])}</h2>`);
      } else if (/^- /.test(line)) {
        if (!list) out.push('<ul style="margin:4px 0;padding-left:20px">');
        list = true;
        out.push(`<li style="margin:2px 0">${inline(line.slice(2))}</li>`);
      } else if (/^> /.test(line)) {
        flush();
        out.push(`<p style="background:#fff8c5;padding:8px;border-radius:4px;margin:8px 0">${inline(line.slice(2))}</p>`);
      } else if (/^<sub>/.test(line)) {
        flush();
        out.push(`<p style="color:#57606a;font-size:12px;margin-top:20px">${escapeHtml(line.replace(/<\/?sub>/g, ""))}</p>`);
      } else if (line.trim()) {
        flush();
        out.push(`<p style="margin:6px 0">${inline(line)}</p>`);
      } else flush();
    }
    flush();
    return out.join("\n");
  };
  return `<!doctype html><html><body style="margin:0;background:#f6f8fa">
<table role="presentation" width="100%" style="background:#f6f8fa"><tr><td align="center" style="padding:16px">
<table role="presentation" width="640" style="max-width:640px;width:100%;background:#ffffff;border-radius:6px;border-top:4px solid ${accent};font-family:-apple-system,Segoe UI,Helvetica,Arial,sans-serif;font-size:14px;color:#24292f">
<tr><td style="padding:20px 24px">${logo}${md2html(r.markdown)}</td></tr></table></td></tr></table></body></html>`;
}

/** The plain-text part: the Markdown without its markup. */
export const emailText = (r) =>
  r.markdown
    .replace(/<\/?sub>/g, "")
    .replace(/\*\*/g, "")
    .replace(LINK, "$1 ($2)")
    .replace(/\\([|[\]])/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/@\u200B/g, "@");

// ------------------------------------------------------------------ delivery

/** Deliver the report. Returns a short description; throws when the delivery fails. */
export async function deliver(r, d, cfg, { api, fetchImpl = fetch, env = process.env, testMode = false }) {
  const rep = cfg.report ?? {};
  const delivery = rep.delivery ?? "github-issue";
  if (delivery === "github-issue") {
    if (testMode) return "test mode: written to the job summary only, no comment posted";
    if (!Number.isInteger(rep.issue)) throw new Error("tracker.report.issue is not set: no issue to post the report on");
    const body = r.markdown.length > COMMENT_LIMIT ? `${r.markdown.slice(0, COMMENT_LIMIT)}\n\n_(Cut to fit GitHub's comment limit; the job summary has the rest.)_` : r.markdown;
    const res = await api(`repos/${d.repo}/issues/${rep.issue}/comments`, { method: "POST", body: { body } });
    if (!res.ok) throw new Error(`posting the report on #${rep.issue} failed: ${res.rateLimited ? "rate-limited" : `HTTP ${res.status}`}`);
    return `posted on #${rep.issue}`;
  }
  if (delivery === "resend") {
    const rs = rep.resend ?? {};
    const key = env[rs.secret ?? "RESEND_API_KEY"];
    if (!key) throw new Error(`the Resend key is not set: add it as the Actions secret ${rs.secret ?? "RESEND_API_KEY"}`);
    const to = testMode ? [rs.testRecipient].filter(Boolean) : rs.recipients ?? [];
    if (!to.length) throw new Error(testMode ? "test mode: tracker.report.resend.testRecipient is not set" : "tracker.report.resend.recipients is empty");
    const subject = `${rep.brand?.name ?? d.repo} status — ${day(d.now)}${testMode ? " (test)" : ""}`;
    const res = await fetchImpl("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
      body: JSON.stringify({ from: rs.from, to, subject, html: emailHtml(r, d, cfg), text: emailText(r) }),
    });
    if (!res.ok) throw new Error(`Resend refused the email: HTTP ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
    return `emailed to ${to.length} recipient(s)${testMode ? " (test)" : ""}`;
  }
  throw new Error(`unknown delivery "${delivery}": use github-issue or resend`);
}

// ------------------------------------------------------------------ the run

/** One report: gather, render, write the job summary, deliver (unless a quiet day is skipped). */
export async function run({ cfg, api, now = new Date(), env = process.env, fetchImpl = fetch, root = process.cwd(), summary = () => {} }) {
  const testMode = env.TEST_MODE === "true";
  const d = await gather(api, cfg, now);
  if (cfg.report?.skipQuietDays && isQuiet(d)) {
    summary("Quiet window: no issues closed or opened, no pull requests merged, no commits. Nothing sent (skipQuietDays).\n");
    return { sent: false, reason: "quiet" };
  }
  const r = await render(d, cfg, { root });
  summary(`${r.markdown}\n`);
  const how = await deliver(r, d, cfg, { api, fetchImpl, env, testMode });
  summary(`\n_Delivery: ${how}._\n`);
  return { sent: !(testMode && (cfg.report?.delivery ?? "github-issue") === "github-issue"), how, report: r };
}

const SELF = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === SELF) {
  try {
    const g = JSON.parse(readFileSync("govkit.json", "utf-8")).guardrails?.tracker ?? {};
    const cfg = { repo: process.env.GITHUB_REPOSITORY, issues: g.issues ?? {}, report: g.report ?? {} };
    if (!cfg.repo) throw new Error("GITHUB_REPOSITORY is not set");
    const summaryFile = process.env.GITHUB_STEP_SUMMARY;
    const out = await run({
      cfg,
      api: makeApi({ token: process.env.GITHUB_TOKEN, base: process.env.GITHUB_API_URL ?? "https://api.github.com" }),
      summary: (s) => (summaryFile ? appendFileSync(summaryFile, s) : process.stdout.write(s)),
    });
    console.log(out.reason === "quiet" ? "Quiet window: nothing sent." : `Report: ${out.how}.`);
  } catch (e) {
    console.error(`::error::${e.message}`);
    process.exit(1);
  }
}
