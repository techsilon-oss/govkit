// Tests for the status report (#14 part 2, 0.12.0): scripts/daily-report/report.mjs against a fake
// GitHub API, its workflow template, the per-repo lines an upgrade keeps, setup in tracker.mjs, and
// the doctor's report checks. Every hard rule in report.mjs's header has a test here.

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import {
  count,
  deliver,
  emailHtml,
  emailText,
  escapeHtml,
  gather,
  makeApi,
  mdText,
  Notes,
  paginate,
  render,
  run,
  truncate,
} from "../skills/govkit-init/templates/scripts/daily-report/report.mjs";
import { setupReport } from "../skills/govkit-init/tracker.mjs";
import { OWNED, check, render as renderOwned } from "../skills/govkit-init/upgrade.mjs";
import { GOVKIT, fill, git, tempDirs } from "./fixtures.mjs";

const tmp = tempDirs();
const NOW = new Date("2026-10-29T03:30:00Z");
const H = 3600 * 1000;
const ago = (h) => new Date(NOW - h * H).toISOString();
const REPO = "acme/app";

const REGISTER_BODY = [
  "### Things only an owner can do",
  "",
  "| # | Action | Why it matters | Blocks |",
  "|---|---|---|---|",
  "| 1 | Sign the DPA | Legal | #12 |",
  "",
  "### Open decisions",
  "",
  "| ID | Question | Decide by | Recommendation |",
  "|---|---|---|---|",
  "| D-001 | Pricing tiers? | 2026-11-01 | Two tiers |",
].join("\n");

const issue = (number, o = {}) => ({
  number,
  title: o.title ?? `Issue ${number}`,
  state: o.state ?? "open",
  labels: (o.labels ?? []).map((name) => ({ name })),
  created_at: o.created_at ?? ago(24 * 30),
  closed_at: o.closed_at ?? null,
  html_url: `https://github.com/${REPO}/issues/${number}`,
  ...(o.pr ? { pull_request: {} } : {}),
});

/**
 * A fake api(path): routes by path prefix to `{ data }` or a full response; records every call and
 * fails the test on any search call. A route value can be a function of the path.
 */
function fakeApi(routes, calls = []) {
  return async (path, opts = {}) => {
    calls.push({ path, ...opts });
    assert.doesNotMatch(path, /search\//, "the report must never call the search API");
    const key = Object.keys(routes).find((k) => path.includes(k));
    let r = key === undefined ? { data: [] } : routes[key];
    if (typeof r === "function") r = r(path, opts);
    return { ok: true, status: 200, next: null, rateLimited: false, ...r };
  };
}

/** A busy window: two closed, one new, one fix-shipped, one untriaged, a PR, commits. */
function busyRoutes(over = {}) {
  const open = [
    issue(1, { labels: ["now", "enhancement"] }),
    issue(2, { labels: ["next", "documentation"] }),
    issue(3, { labels: [] }), // to triage
    issue(4, { labels: ["now", "fix-shipped", "bug"] }),
    issue(5, { labels: ["later", "business"] }),
    issue(38, { labels: ["needs-decision"], title: "Decision register" }), // excluded
    issue(40, { title: "Daily status" }), // excluded
    issue(50, { pr: true }), // a PR, not an issue
  ];
  return {
    "actions/workflows/": { data: { workflow_runs: [{ run_started_at: ago(24) }] } },
    "issues?state=open": { data: open },
    "issues?state=all": {
      data: [
        issue(10, { state: "closed", closed_at: ago(2), labels: ["enhancement"], title: "Export to CSV" }),
        issue(11, { state: "closed", closed_at: ago(3), labels: ["bug"] }),
        issue(12, { state: "closed", closed_at: ago(48) }), // closed before the window
        issue(3, { created_at: ago(5) }),
      ],
    },
    "pulls?state=closed": {
      data: [
        { number: 60, title: "Add export", body: "Closes #10", merged_at: ago(2), updated_at: ago(2), html_url: "u60" },
        { number: 61, title: "Bump deps", body: "", merged_at: ago(4), updated_at: ago(4), html_url: "u61" },
        { number: 62, title: "Old", body: "", merged_at: ago(50), updated_at: ago(50), html_url: "u62" },
      ],
    },
    "commits?": { data: [{ author: { login: "ann" } }, { author: { login: "bob" } }, { author: { login: "ann" } }] },
    "milestones?": { data: [{ title: "Launch Readiness", html_url: "m", open_issues: 3, closed_issues: 1 }] },
    "issues/38": { data: { body: REGISTER_BODY, html_url: "r" } },
    "issues/10/comments": { data: [{ body: "Completed: Users can export their data to CSV.\n\nTechnical: new route" }] },
    ...over,
  };
}

const cfg = (report = {}, issues = {}) => ({
  repo: REPO,
  issues: { register: 38, categories: ["now", "next", "later", "triage"], labelAliases: { docs: "documentation" }, ...issues },
  report: { enabled: true, delivery: "github-issue", issue: 40, branches: { work: "main", release: "main" }, ...report },
});

// ------------------------------------------------------------------ gather

test("the window starts at the last successful run", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.equal(d.window.since.toISOString(), ago(24));
  assert.equal(d.window.fallback, null);
});

test("a test-mode run doesn't move the window: it delivered nothing", async () => {
  const runs = { data: { workflow_runs: [{ display_title: "govkit daily report (test)", run_started_at: ago(1) }, { display_title: "govkit daily report", run_started_at: ago(30) }] } };
  const d = await gather(fakeApi(busyRoutes({ "actions/workflows/": runs })), cfg(), NOW);
  assert.equal(d.window.since.toISOString(), ago(30));
  const onlyTests = { data: { workflow_runs: [{ display_title: "govkit daily report (test)", run_started_at: ago(1) }] } };
  assert.equal((await gather(fakeApi(busyRoutes({ "actions/workflows/": onlyTests })), cfg(), NOW)).window.fallback, "the last 24 hours");
});

const noRuns = () => busyRoutes({ "actions/workflows/": { data: { workflow_runs: [] } } });

test("with no successful run and a daily schedule, the window is the last 24 hours, and the header says so", async () => {
  for (const schedule of [undefined, "30 3 * * *", "0 */6 * * ?"]) {
    const c = cfg({ schedule });
    const d = await gather(fakeApi(noRuns()), c, NOW);
    assert.equal(d.window.fallback, "the last 24 hours", String(schedule));
    assert.equal(d.window.since.toISOString(), ago(24));
    assert.match((await render(d, c)).markdown, /no earlier successful report found: the last 24 hours/);
  }
});

test("with no successful run and a day-of-week schedule, the first window is the last 7 days, and the header says so", async () => {
  for (const schedule of ["0 7 * * 1", "0 7 * * MON", "0 7 * * 1-5"]) {
    const c = cfg({ schedule });
    const d = await gather(fakeApi(noRuns()), c, NOW);
    assert.equal(d.window.fallback, "the last 7 days", schedule);
    assert.equal(d.window.since.toISOString(), ago(7 * 24));
    assert.match((await render(d, c)).markdown, /no earlier successful report found: the last 7 days/);
  }
  // Once a report has run, the window starts there, whatever the schedule.
  const d = await gather(fakeApi(busyRoutes()), cfg({ schedule: "0 7 * * 1" }), NOW);
  assert.equal(d.window.since.toISOString(), ago(24));
  assert.equal(d.window.fallback, null);
});

test("closed and new in the window; the register and the status issue are never counted", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.deepEqual(d.closed.map((i) => i.number), [10, 11]);
  assert.deepEqual(d.opened.map((i) => i.number), [3]);
  assert.ok(!d.open.some((i) => [38, 40, 50].includes(i.number)), "register, status issue and PRs excluded");
});

test("open counts by the configured categories; to triage; engineering vs business; aliases applied", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.deepEqual(d.breakdown.byCategory, { now: 2, next: 1, later: 1, triage: 0 });
  assert.deepEqual(d.breakdown.toTriage.map((i) => i.number), [3]);
  // Worded apart from the table's "triage" row, which counts issues labelled triage.
  const r = await render(d, cfg({ sections: ["open-breakdown"] }));
  assert.match(r.markdown, /\| triage \| 0 \|/);
  assert.match(r.markdown, /\*\*⚠️ No launch category: 1\*\* \(each open issue needs exactly one\)\n- \[#3 /);
  assert.doesNotMatch(r.markdown, /To triage/);
  assert.equal(d.breakdown.business, 1);
  assert.equal(d.breakdown.engineering, 4);
  assert.deepEqual(d.fixShipped.map((i) => i.number), [4]);
});

test("merged PRs: inside the window only, and one that closed a listed issue isn't listed twice", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.deepEqual(d.prs.map((p) => p.number), [60, 61]);
  assert.deepEqual(d.prsAlone.map((p) => p.number), [61]);
});

test("the PR scan stops at the first PR updated before the window", async () => {
  const calls = [];
  const routes = busyRoutes({
    "pulls?state=closed": (path) =>
      path.includes("page=2")
        ? assert.fail("page 2 must not be read: page 1 already reached the window's start")
        : { data: [{ number: 70, merged_at: ago(1), updated_at: ago(1) }, { number: 71, merged_at: ago(30), updated_at: ago(30) }], next: `repos/${REPO}/pulls?state=closed&page=2` },
  });
  const d = await gather(fakeApi(routes, calls), cfg(), NOW);
  assert.deepEqual(d.prs.map((p) => p.number), [70]);
});

test("every list is paginated: three pages, all read", async () => {
  const pages = { 1: [issue(1)], 2: [issue(2)], 3: [issue(3)] };
  const api = fakeApi({
    "x?page=": (path) => {
      const n = Number(/page=(\d)/.exec(path)[1]);
      return { data: pages[n], next: n < 3 ? `x?page=${n + 1}` : null };
    },
  });
  const notes = new Notes();
  const all = await paginate(api, "x?page=1", notes, "x");
  assert.deepEqual(all.map((i) => i.number), [1, 2, 3]);
  assert.equal(notes.incomplete, false);
});

test("the Completed: line of a closed issue becomes a key deliverable", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.deepEqual(d.deliverables.map((x) => x.text), ["Users can export their data to CSV."]);
});

test("no search API call anywhere in a full run", async () => {
  const calls = [];
  await run({ cfg: cfg({ reportedLabel: "reported" }), api: fakeApi(busyRoutes(), calls), now: NOW, env: { TEST_MODE: "true" } });
  assert.ok(calls.length > 5);
  assert.ok(calls.every((c) => !c.path.includes("search/")));
});

// ------------------------------------------------------------------ the hard rules

test("an API error body where a list should be: an empty list and a visible incomplete note, never a silent zero", async () => {
  const d = await gather(fakeApi(busyRoutes({ "issues?state=open": { ok: false, status: 403, data: { message: "Resource not accessible" } } })), cfg(), NOW);
  assert.equal(d.open.length, 0);
  assert.equal(d.notes.incomplete, true);
  const r = await render(d, cfg());
  assert.match(r.markdown, /Some numbers are incomplete \(API error\):.*open issues: API error 403/);
});

test("a count is used only if it is a non-negative integer", () => {
  const notes = new Notes();
  assert.equal(count(3, notes, "a"), 3);
  assert.equal(notes.incomplete, false);
  for (const bad of [{ message: "Forbidden" }, "3", -1, 1.5, null]) assert.equal(count(bad, notes, "b"), 0);
  assert.equal(notes.incomplete, true);
});

const response = (status, headers = {}, body = []) => ({
  ok: status < 400,
  status,
  headers: new Headers(headers),
  json: async () => body,
});

test("a 500 is retried once; a rate-limited answer never; a 404 isn't retried", async () => {
  let n = 0;
  let api = makeApi({ fetchImpl: async () => (n++ === 0 ? response(500) : response(200, {}, [1])) });
  let r = await api("x");
  assert.equal(n, 2);
  assert.equal(r.ok, true);

  n = 0;
  api = makeApi({ fetchImpl: async () => (n++, response(403, { "x-ratelimit-remaining": "0" })) });
  r = await api("x");
  assert.equal(n, 1);
  assert.equal(r.rateLimited, true);

  n = 0;
  api = makeApi({ fetchImpl: async () => (n++, response(404)) });
  await api("x");
  assert.equal(n, 1);
});

test("a failed fetch twice is a failure, not a throw; the next page comes from the Link header", async () => {
  let api = makeApi({ fetchImpl: async () => { throw new Error("ECONNRESET"); } });
  const r = await api("x");
  assert.equal(r.ok, false);
  api = makeApi({ fetchImpl: async () => response(200, { link: '<https://api.github.com/x?page=2>; rel="next", <https://api.github.com/x?page=9>; rel="last"' }) });
  assert.equal((await api("x")).next, "https://api.github.com/x?page=2");
});

test("issue text: HTML escaped, mentions defused, tables and links unbroken, emoji never split", async () => {
  assert.equal(escapeHtml(`<img src=x onerror="a">&'`), "&lt;img src=x onerror=&quot;a&quot;&gt;&amp;&#39;");
  assert.equal(mdText("hi @octocat"), "hi @​octocat");
  assert.equal(mdText("a | b [c]\nd"), "a \\| b \\[c\\] d");
  assert.equal(truncate("ab😀😀", 3), "ab…");
  assert.equal(truncate("ab😀", 3), "ab😀");
  assert.ok(![...truncate("😀".repeat(10), 5)].some((c) => c.length === 1 && /[\uD800-\uDFFF]/.test(c)), "no lone surrogate");

  const routes = busyRoutes();
  routes["issues?state=all"].data[0].title = `<script>alert(1)</script> ping @boss [beta]`;
  const d = await gather(fakeApi(routes), cfg(), NOW);
  const r = await render(d, cfg());
  assert.doesNotMatch(r.markdown, /<script>/);
  assert.doesNotMatch(r.markdown, /@boss/, "a mention would notify @boss with every report");
  const html = emailHtml(r, d, cfg());
  assert.doesNotMatch(html, /<script>/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /<a href="https:\/\/github.com\/acme\/app\/issues\/10"[^>]*>#10 &lt;script&gt;alert\(1\)&lt;\/script&gt; ping @boss \[beta\]<\/a>/, "the link survives the escaped brackets");
  assert.match(emailText(r), /#10 <script>alert\(1\)<\/script> ping @boss \[beta\] \(https:\/\/github.com\/acme\/app\/issues\/10\)/);
});

test("an unreadable register: its sections say 'Could not read', and the report still goes out", async () => {
  const d = await gather(fakeApi(busyRoutes({ "issues/38": { ok: false, status: 404, data: { message: "Not Found" } } })), cfg(), NOW);
  const r = await render(d, cfg());
  assert.match(r.markdown, /### Owner actions\n\nCould not read the decision register\./);
  assert.match(r.markdown, /### Top open decisions\n\nCould not read the decision register\./);
  assert.match(r.markdown, /incomplete/);
});

test("the register's two tables are read", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  assert.deepEqual(d.register.owner, [["1", "Sign the DPA", "Legal", "#12"]]);
  assert.deepEqual(d.register.decisions[0].slice(0, 2), ["D-001", "Pricing tiers?"]);
});

// ------------------------------------------------------------------ sections

test("sections: default order; a configured list reorders and removes; an unknown name is noted", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  const all = await render(d, cfg());
  assert.deepEqual(all.parts.map((p) => p.name).slice(0, 3), ["header", "owner-actions", "decisions"]);
  const some = await render(d, cfg({ sections: ["header", "code-activity", "completed", "nope"] }));
  assert.deepEqual(some.parts.map((p) => p.name), ["header", "code-activity", "completed"]);
  assert.deepEqual(some.unknown, ["nope"]);
  assert.match(some.markdown, /Unknown section\(s\) in govkit.json, skipped: `nope`/);
  assert.match(some.markdown, /3 commits · 2 pull requests merged · 2 active authors/);
  const one = await render({ ...d, commits: [{ author: { login: "ann" } }], prs: [d.prs[0]] }, cfg({ sections: ["code-activity"] }));
  assert.match(one.markdown, /1 commit · 1 pull request merged · 1 active author\b/);
});

test("a custom section from scripts/daily-report/sections/ is rendered; one that throws says 'Could not read'", async () => {
  const root = tmp("govkit-report-");
  mkdirSync(join(root, "scripts/daily-report/sections"), { recursive: true });
  writeFileSync(join(root, "scripts/daily-report/sections/oldest-open.mjs"), 'export default (d) => ({ title: "Oldest open", markdown: `#${d.open[0].number}` });\n');
  writeFileSync(join(root, "scripts/daily-report/sections/broken.mjs"), 'export default () => { throw new Error("boom"); };\n');
  writeFileSync(join(root, "scripts/daily-report/sections/syntax.mjs"), "export default (\n");
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  const r = await render(d, cfg({ sections: ["header", "oldest-open", "broken", "syntax"] }), { root });
  assert.match(r.markdown, /### Oldest open\n\n#1/);
  assert.match(r.markdown, /### broken\n\nCould not read broken\./);
  assert.match(r.markdown, /### syntax\n\nCould not read syntax\./);
});

test("a section name that isn't a plain name is never loaded as a path", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  const r = await render(d, cfg({ sections: ["../../evil"] }), { root: tmp("govkit-report-") });
  assert.deepEqual(r.unknown, ["../../evil"]);
});

// ------------------------------------------------------------------ delivery and run

test("github-issue: a comment with the Markdown on the status issue", async () => {
  const calls = [];
  const out = await run({ cfg: cfg(), api: fakeApi(busyRoutes({ "issues/40/comments": { data: {} } }), calls), now: NOW, env: {} });
  const post = calls.find((c) => c.method === "POST");
  assert.equal(post.path, `repos/${REPO}/issues/40/comments`);
  assert.match(post.body.body, /^## acme\/app — status 2026-10-29/);
  assert.equal(out.sent, true);
});

test("github-issue test mode posts nothing and writes the job summary", async () => {
  const calls = [];
  let summary = "";
  const out = await run({ cfg: cfg(), api: fakeApi(busyRoutes(), calls), now: NOW, env: { TEST_MODE: "true" }, summary: (s) => (summary += s) });
  assert.ok(!calls.some((c) => c.method === "POST"));
  assert.equal(out.sent, false);
  assert.match(summary, /### Completed in this window/);
  assert.match(summary, /no comment posted/);
});

test("a failed delivery throws, so the job fails", async () => {
  const api = fakeApi(busyRoutes({ "issues/40/comments": { ok: false, status: 403, data: {} } }));
  await assert.rejects(run({ cfg: cfg(), api, now: NOW, env: {} }), /posting the report on #40 failed: HTTP 403/);
  await assert.rejects(run({ cfg: cfg({ issue: null }), api: fakeApi(busyRoutes()), now: NOW, env: {} }), /tracker.report.issue is not set/);
});

const resendCfg = (over = {}) =>
  cfg({ delivery: "resend", issue: null, resend: { secret: "GOVKIT_RESEND", from: "onboarding@resend.dev", recipients: ["team@example.com", "b@example.com"], testRecipient: "me@example.com" }, ...over });

function fakeResend(status = 200) {
  const sent = [];
  const fetchImpl = async (url, init) => {
    sent.push({ url, init, body: JSON.parse(init.body) });
    return { ok: status < 400, status, text: async () => "bad from" };
  };
  return { sent, fetchImpl };
}

test("resend test mode: HTML plus text, to the test recipient only, with the key from the named secret", async () => {
  const { sent, fetchImpl } = fakeResend();
  await run({ cfg: resendCfg(), api: fakeApi(busyRoutes()), now: NOW, env: { TEST_MODE: "true", GOVKIT_RESEND: "re_test" }, fetchImpl });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "https://api.resend.com/emails");
  assert.equal(sent[0].init.headers.authorization, "Bearer re_test");
  assert.deepEqual(sent[0].body.to, ["me@example.com"]);
  assert.match(sent[0].body.subject, /\(test\)$/);
  assert.match(sent[0].body.html, /^<!doctype html>/);
  assert.match(sent[0].body.html, /max-width:640px/);
  assert.match(sent[0].body.text, /Completed in this window/);
  assert.doesNotMatch(sent[0].body.text, /\*\*/);
});

test("resend: all recipients outside test mode; a missing key or a refused send throws", async () => {
  const { sent, fetchImpl } = fakeResend();
  await run({ cfg: resendCfg(), api: fakeApi(busyRoutes()), now: NOW, env: { GOVKIT_RESEND: "k" }, fetchImpl });
  assert.deepEqual(sent[0].body.to, ["team@example.com", "b@example.com"]);
  await assert.rejects(run({ cfg: resendCfg(), api: fakeApi(busyRoutes()), now: NOW, env: {}, fetchImpl }), /add it as the Actions secret GOVKIT_RESEND/);
  await assert.rejects(run({ cfg: resendCfg(), api: fakeApi(busyRoutes()), now: NOW, env: { GOVKIT_RESEND: "k" }, fetchImpl: fakeResend(422).fetchImpl }), /Resend refused the email: HTTP 422/);
});

test("brand: the name, a valid accent color and an https logo are used; anything else is ignored", async () => {
  const d = await gather(fakeApi(busyRoutes()), cfg(), NOW);
  const branded = resendCfg({ brand: { name: "Acme", accentColor: "#ff6600", logoUrl: "https://acme.test/logo.png" } });
  const r = await render(d, branded);
  const html = emailHtml(r, d, branded);
  assert.match(r.markdown, /^## Acme — status/);
  assert.match(html, /border-top:4px solid #ff6600/);
  assert.match(html, /<img src="https:\/\/acme.test\/logo.png"/);
  const bad = resendCfg({ brand: { accentColor: "red;background:url(x)", logoUrl: "javascript:alert(1)" } });
  const html2 = emailHtml(await render(d, bad), d, bad);
  assert.doesNotMatch(html2, /url\(x\)|javascript:/);
  assert.match(html2, /#24292f/);
});

test("an unknown delivery throws", async () => {
  await assert.rejects(deliver({ markdown: "" }, { repo: REPO, now: NOW }, cfg({ delivery: "pigeon" }), { api: fakeApi({}) }), /unknown delivery "pigeon"/);
});

const quietRoutes = () =>
  busyRoutes({ "issues?state=all": { data: [] }, "pulls?state=closed": { data: [] }, "commits?": { data: [] } });

test("skipQuietDays: a quiet window sends and posts nothing, and the summary says why", async () => {
  const calls = [];
  let summary = "";
  const out = await run({ cfg: cfg({ skipQuietDays: true }), api: fakeApi(quietRoutes(), calls), now: NOW, env: {}, summary: (s) => (summary += s) });
  assert.deepEqual(out, { sent: false, reason: "quiet" });
  assert.ok(!calls.some((c) => c.method === "POST"));
  assert.match(summary, /Quiet window/);
});

test("skipQuietDays off: a quiet window still posts; on: a busy window posts", async () => {
  let calls = [];
  await run({ cfg: cfg({ skipQuietDays: false }), api: fakeApi(quietRoutes(), calls), now: NOW, env: {} });
  assert.ok(calls.some((c) => c.method === "POST"));
  calls = [];
  await run({ cfg: cfg({ skipQuietDays: true }), api: fakeApi(busyRoutes(), calls), now: NOW, env: {} });
  assert.ok(calls.some((c) => c.method === "POST"));
});

test("a report over GitHub's comment limit is cut, with a note", async () => {
  const calls = [];
  const big = { markdown: "x".repeat(70000) };
  await deliver(big, { repo: REPO, now: NOW }, cfg(), { api: fakeApi({}, calls) });
  assert.ok(calls[0].body.body.length < 65536);
  assert.match(calls[0].body.body, /Cut to fit GitHub's comment limit/);
});

// ------------------------------------------------------------------ the workflow template

const WORKFLOW = readFileSync(join(GOVKIT, "skills/govkit-init/templates/.github/workflows/govkit-daily-report.yml"), "utf-8").replace(/\r\n/g, "\n");

test("the workflow: schedule and test_mode triggers, read-only permissions but issues, v7 actions, Node 22", () => {
  assert.match(WORKFLOW, /- cron: "30 3 \* \* \*" # govkit: per-repo \(tracker\.report\.schedule\)/);
  assert.match(WORKFLOW, /workflow_dispatch:\n {4}inputs:\n {6}test_mode:[\s\S]*?default: true/);
  assert.match(WORKFLOW, /^run-name: \$\{\{ inputs\.test_mode && 'govkit daily report \(test\)' \|\| 'govkit daily report' \}\}$/m, "report.mjs finds test runs by this name");
  assert.match(WORKFLOW, /contents: read\n {2}pull-requests: read\n {2}actions: read/);
  assert.match(WORKFLOW, /issues: write # govkit: per-repo/);
  assert.match(WORKFLOW, /actions\/checkout@v7/);
  assert.match(WORKFLOW, /actions\/setup-node@v7\n\s+with:\n\s+node-version: 22/);
  assert.match(WORKFLOW, /RESEND_API_KEY: \$\{\{ secrets\.RESEND_API_KEY \}\} # govkit: per-repo \(tracker\.report\.resend\.secret\)/);
  assert.match(WORKFLOW, /paths\?\.\["scripts\/daily-report\/report\.mjs"\] \} catch \{\} process\.stdout\.write\(p \|\| "scripts\/daily-report\/report\.mjs"\)/, "a govkit.json paths entry can move the script");
  assert.match(WORKFLOW, /node "\$REPORT"/);
  assert.doesNotMatch(WORKFLOW, /npm (ci|install)/, "dependency-free");
});

// ------------------------------------------------------------------ setup and upgrade

const TEMPLATE = readFileSync(join(GOVKIT, "skills/govkit-init/templates/govkit.json"), "utf-8").replace(/\r\n/g, "\n");

function trackerRepo() {
  const root = tmp("govkit-report-setup-");
  git(root, "init", "-q");
  const m = JSON.parse(fill(TEMPLATE, "0.12.0"));
  m.guardrails.tracker = { enabled: true, issues: { register: 38, categories: ["now", "next", "later", "triage"] } };
  writeFileSync(join(root, "govkit.json"), JSON.stringify(m, null, 2) + "\n");
  return root;
}
const manifest = (root) => JSON.parse(readFileSync(join(root, "govkit.json"), "utf-8"));
const workflowOf = (root) => readFileSync(join(root, ".github/workflows/govkit-daily-report.yml"), "utf-8");

test("setup refuses a bad delivery, schedule, issue or secret name, and writes nothing", () => {
  const root = trackerRepo();
  const before = readFileSync(join(root, "govkit.json"), "utf-8");
  assert.throws(() => setupReport(root, { delivery: "fax", issue: 40 }), /delivery must be/);
  assert.throws(() => setupReport(root, { issue: 40, schedule: "every day" }), /not a five-field cron/);
  assert.throws(() => setupReport(root, { issue: 40, schedule: '0 7 * * 1" # x' }), /not a five-field cron/);
  assert.throws(() => setupReport(root, {}), /needs --issue/);
  assert.throws(() => setupReport(root, { issue: "abc" }), /needs --issue/);
  assert.throws(() => setupReport(root, { delivery: "resend", from: "a@b.c", secret: "bad-name" }), /not a valid secret name/);
  assert.throws(() => setupReport(root, { delivery: "resend" }), /needs --from \(onboarding@resend\.dev/);
  assert.equal(readFileSync(join(root, "govkit.json"), "utf-8"), before);
});

test("setup github-issue: settings in govkit.json, the two files, issues: write", () => {
  const root = trackerRepo();
  setupReport(root, { issue: 40, schedule: "0 7 * * 1", skipQuietDays: true });
  const rep = manifest(root).guardrails.tracker.report;
  assert.equal(rep.enabled, true);
  assert.equal(rep.issue, 40);
  assert.equal(rep.schedule, "0 7 * * 1");
  assert.equal(rep.skipQuietDays, true);
  assert.equal(readFileSync(join(root, "scripts/daily-report/report.mjs"), "utf-8"), readFileSync(join(GOVKIT, "skills/govkit-init/templates/scripts/daily-report/report.mjs"), "utf-8"));
  assert.match(workflowOf(root), /- cron: "0 7 \* \* 1" # govkit: per-repo/);
  assert.match(workflowOf(root), /issues: write # govkit: per-repo/);
});

test("setup resend: issues: read, the env line names the configured secret", () => {
  const root = trackerRepo();
  setupReport(root, { delivery: "resend", from: "onboarding@resend.dev", secret: "GOVKIT_RESEND", testRecipient: "me@example.com" });
  assert.match(workflowOf(root), /issues: read # govkit: per-repo/);
  assert.match(workflowOf(root), /GOVKIT_RESEND: \$\{\{ secrets\.GOVKIT_RESEND \}\} # govkit: per-repo/);
  assert.equal(manifest(root).guardrails.tracker.report.resend.secret, "GOVKIT_RESEND");
});

test("per-repo lines: a custom schedule, with issues: write or read, reads 'current', and an upgrade keeps them", () => {
  for (const opts of [{ issue: 40, schedule: "15 6 * * 1-5" }, { delivery: "resend", from: "onboarding@resend.dev", secret: "GOVKIT_RESEND", schedule: "0 7 * * 1" }]) {
    const root = trackerRepo();
    setupReport(root, opts);
    const r = check(root);
    for (const p of ["scripts/daily-report/report.mjs", ".github/workflows/govkit-daily-report.yml"]) {
      assert.equal(r.files.find((f) => f.path === p)?.status, "current", `${p} with ${JSON.stringify(opts)}`);
    }
    const entry = OWNED.find((e) => e.path === ".github/workflows/govkit-daily-report.yml");
    const upgraded = renderOwned(entry, root, manifest(root));
    assert.equal(upgraded.replace(/\r\n/g, "\n"), workflowOf(root).replace(/\r\n/g, "\n"), "an upgrade writes the repo's own lines back");
    assert.match(upgraded, new RegExp(`cron: "${opts.schedule.replace(/\*/g, "\\*")}"`));
  }
});

test("the report files are skipped while the report is off (the tracker alone writes no files)", () => {
  const root = trackerRepo();
  const before = check(root).files.filter((f) => f.path.includes("daily-report"));
  assert.deepEqual(before.map((f) => f.status), ["skipped", "skipped"]);
});

// ------------------------------------------------------------------ the doctor

function doctor(root) {
  try {
    return { code: 0, out: execFileSync("node", [join(GOVKIT, "skills/govkit-init/templates/scripts/govkit-doctor.mjs"), "--ci"], { cwd: root, encoding: "utf-8" }) };
  } catch (e) {
    return { code: e.status, out: String(e.stdout) };
  }
}
function reportOnly(report, files = true) {
  const root = tmp("govkit-report-doctor-");
  git(root, "init", "-q");
  const m = JSON.parse(fill(TEMPLATE, "0.12.0"));
  for (const [k, g] of Object.entries(m.guardrails)) if (k !== "tracker" && !k.startsWith("$")) Object.assign(g, { enabled: false, skippedReason: "not in this test" });
  m.guardrails.tracker = { enabled: true, issues: { register: 38 }, report };
  writeFileSync(join(root, "govkit.json"), JSON.stringify(m, null, 2));
  if (files) {
    mkdirSync(join(root, "scripts/daily-report"), { recursive: true });
    mkdirSync(join(root, ".github/workflows"), { recursive: true });
    writeFileSync(join(root, "scripts/daily-report/report.mjs"), "");
    writeFileSync(join(root, ".github/workflows/govkit-daily-report.yml"), "");
  }
  return root;
}

test("the doctor: report on with its files and issue passes; without the issue number or files it fails", () => {
  const ok = doctor(reportOnly({ enabled: true, delivery: "github-issue", issue: 40 }));
  assert.equal(ok.code, 0, ok.out);
  const noIssue = doctor(reportOnly({ enabled: true, delivery: "github-issue", issue: null }));
  assert.equal(noIssue.code, 1, noIssue.out);
  assert.match(noIssue.out, /the status issue's number/);
  const noFiles = doctor(reportOnly({ enabled: true, delivery: "resend" }, false));
  assert.equal(noFiles.code, 1, noFiles.out);
  assert.match(noFiles.out, /govkit-daily-report\.yml/);
  // A repo that runs the script from elsewhere (govkit itself, DEC-003) maps it in `paths`.
  const moved = reportOnly({ enabled: true, delivery: "github-issue", issue: 40 }, false);
  mkdirSync(join(moved, ".github/workflows"), { recursive: true });
  mkdirSync(join(moved, "lib"), { recursive: true });
  writeFileSync(join(moved, ".github/workflows/govkit-daily-report.yml"), "");
  writeFileSync(join(moved, "lib/report.mjs"), "");
  const mm = JSON.parse(readFileSync(join(moved, "govkit.json"), "utf-8"));
  mm.paths = { "scripts/daily-report/report.mjs": "lib/report.mjs" };
  writeFileSync(join(moved, "govkit.json"), JSON.stringify(mm, null, 2));
  assert.equal(doctor(moved).code, 0, "found through paths");
  mm.paths = { "scripts/daily-report/report.mjs": "../outside.mjs" };
  writeFileSync(join(moved, "govkit.json"), JSON.stringify(mm, null, 2));
  assert.match(doctor(moved).out, /points outside|refused/);
  const bad = doctor(reportOnly({ enabled: true, delivery: "pigeon" }));
  assert.equal(bad.code, 1, bad.out);
  assert.match(bad.out, /a known delivery/);
});
