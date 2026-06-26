# govkit 2a Implementation Plan — Plugin + `/govkit-init` + Minimal Tier

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement task-by-task. Steps use `- [ ]`.

**Goal:** Ship the `govkit` Claude Code plugin: a `/govkit-init` scaffolder + a self-contained generic `/sdlc`, plus minimal-tier templates (branch flow, release gate, PROJECT-HUB/ROADMAP, generic CLAUDE.md), so any project gets the core guardrails in one command.

**Architecture:** A standalone git repo `govkit/` structured as a Claude Code plugin (`.claude-plugin/{plugin,marketplace}.json`, `skills/<name>/SKILL.md`). `/govkit-init` (a skill) reads bundled `templates/` and scaffolds them non-destructively into the cwd repo. `/sdlc` is a global plugin skill. Verification is behavioral (dogfood), not unit tests.

**Tech Stack:** Markdown skills, JSON manifests, a vendored TS release-gate (already tested in `release-gate-kit`).

**Spec:** `docs/superpowers/specs/2026-06-25-govkit-init-minimal-tier-design.md`

## Global Constraints

- **Decoupled:** zero references to any specific project (no rav, no rent-a-vacation). Generic only.
- **Self-contained:** no dependency on superpowers/other plugins, MCP, Python, husky, or global config. Uses `git` + `gh` CLI only.
- **Node/TS-first scaffold; language-agnostic guardrails** (gate checks are arbitrary shell commands).
- **Non-destructive init:** create if absent; append (CLAUDE.md) / merge (package.json scripts) if present; never overwrite; idempotent; print a summary.
- **Templates use `{{TOKEN}}` placeholders:** `{{PROJECT_NAME}}`, `{{DEFAULT_BRANCH}}`, `{{DEPLOY_TARGET}}`.
- Plugin/template format must match real Claude Code plugins (verified against `superpowers`).

---

## File Structure

| File | Responsibility | Action |
|---|---|---|
| `.claude-plugin/plugin.json` | Plugin manifest | Create |
| `.claude-plugin/marketplace.json` | Marketplace entry | Create |
| `skills/govkit-init/SKILL.md` | Init scaffolder (preflight, questions, scaffold, summary) | Create |
| `skills/govkit-init/templates/CLAUDE.md` | Generic CLAUDE.md (branch flow, tests policy, release-gate guardrail) | Create |
| `skills/govkit-init/templates/docs/PROJECT-HUB.md` | Project hub skeleton | Create |
| `skills/govkit-init/templates/docs/PRIORITY-ROADMAP.md` | Roadmap skeleton | Create |
| `skills/govkit-init/templates/scripts/release-gate.ts` | Vendored gate (verbatim from release-gate-kit) | Create |
| `skills/govkit-init/templates/release-gate.config.json` | Example gate config | Create |
| `skills/govkit-init/templates/package-scripts.json` | npm scripts to merge | Create |
| `skills/govkit-init/templates/gitignore-snippet.txt` | lines to ensure in .gitignore | Create |
| `skills/sdlc/SKILL.md` | Generic self-contained `/sdlc` | Create |
| `README.md` | Prereqs, install/enable, step-by-step (new + existing) | Create |

---

## Task 1: Plugin manifest + repo skeleton

**Files:** Create `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`.

- [ ] **Step 1:** Write `.claude-plugin/plugin.json` (match superpowers' field shape):
```json
{
  "name": "govkit",
  "description": "Project governance starter kit: /govkit-init scaffolds branch flow, the Local Release Gate (CI-fallback), PROJECT-HUB/ROADMAP, and a generic /sdlc into any project.",
  "version": "0.1.0",
  "author": { "name": "techsilon-oss" },
  "license": "CC0-1.0",
  "keywords": ["governance", "sdlc", "release-gate", "ci-fallback", "scaffolding", "claude-code"]
}
```
- [ ] **Step 2:** Write `.claude-plugin/marketplace.json` (single-plugin marketplace pointing at this repo root):
```json
{
  "name": "govkit",
  "owner": { "name": "techsilon-oss" },
  "plugins": [
    { "name": "govkit", "source": ".", "description": "Project governance starter kit (govkit-init + sdlc + minimal-tier templates)." }
  ]
}
```
- [ ] **Step 3:** Validate JSON: `node -e "JSON.parse(require('fs').readFileSync('.claude-plugin/plugin.json'));JSON.parse(require('fs').readFileSync('.claude-plugin/marketplace.json'));console.log('valid')"` → `valid`.
- [ ] **Step 4:** Commit: `git add .claude-plugin && git commit -m "feat(govkit): plugin manifest + marketplace entry"`.

---

## Task 2: Minimal-tier templates (incl. vendored release gate)

**Files:** Create all `skills/govkit-init/templates/**`.

- [ ] **Step 1: Vendor the release gate** — copy the current released `release-gate.ts` from `release-gate-kit` verbatim into `templates/scripts/release-gate.ts` (single source of truth; do not re-edit). Copy `release-gate.config.json` (generic example: lint/typecheck/test/build, e2e behind full).
- [ ] **Step 2:** `templates/package-scripts.json` — the scripts the init merges:
```json
{
  "release-gate": "tsx scripts/release-gate.ts",
  "release-gate:full": "tsx scripts/release-gate.ts --full"
}
```
- [ ] **Step 3:** `templates/gitignore-snippet.txt`:
```
node_modules/
test-results/
```
- [ ] **Step 4:** `templates/CLAUDE.md` — generic guardrails doc with `{{PROJECT_NAME}}`/`{{DEFAULT_BRANCH}}`/`{{DEPLOY_TARGET}}`. MUST contain, each as its own section: (a) Branch strategy (`feature/* → {{DEFAULT_BRANCH==dev}} → main`, never push to main directly, per-merge approval); (b) Tests-with-features policy; (c) the **Local Release Gate — CI-fallback** section (verbatim portable version, `{{DEPLOY_TARGET}}` wording); (d) a pointer to `docs/PROJECT-HUB.md`. Wrap the whole body between the markers `<!-- govkit:start -->` and `<!-- govkit:end -->` so append-mode is idempotent.
- [ ] **Step 5:** `templates/docs/PROJECT-HUB.md` — skeleton: `# {{PROJECT_NAME}} — Project Hub`, then `## Current Status`, `## Key Decisions Log` (DEC-### convention, one example DEC-001 placeholder removed — use an instruction line instead), `## Session Handoff`.
- [ ] **Step 6:** `templates/docs/PRIORITY-ROADMAP.md` — skeleton: `# {{PROJECT_NAME}} — Priority Roadmap`, `## Current Priority Tiers (as of <date>)`, `## Revision History` (table header).
- [ ] **Step 7:** Validate the gate template is unchanged from source: `diff <release-gate-kit>/release-gate.ts templates/scripts/release-gate.ts` → no diff.
- [ ] **Step 8:** Commit: `git add skills/govkit-init/templates && git commit -m "feat(govkit): minimal-tier templates + vendored release gate"`.

---

## Task 3: `/govkit-init` skill

**Files:** Create `skills/govkit-init/SKILL.md`.

- [ ] **Step 1:** Write `SKILL.md` with frontmatter (`name: govkit-init`, `description:` explaining it scaffolds governance guardrails into the current project). Body MUST instruct Claude to, in order:
  1. **Preflight:** check `git rev-parse --is-inside-work-tree` (offer `git init` if not), `gh --version` + `gh auth status`, `node --version` + `npm --version`. Report each PASS/MISSING. If git missing or not a repo and user declines init, stop.
  2. **Ask ~4 questions** (one message, defaults shown): project name (default = repo folder name), default working branch (default `dev`), package manager (default `npm`), deploy target (`vercel`/`netlify`/`none`).
  3. **Scaffold non-destructively** from `templates/` (resolve the skill's own dir): for each template, substitute `{{TOKENS}}`; if target absent → create; if `CLAUDE.md` present → append the `<!-- govkit:start -->…<!-- govkit:end -->` block unless that marker already exists; if `package.json` present → merge `package-scripts.json` keys (skip existing); ensure `.gitignore` has the snippet lines; if `package.json` absent, instruct the user to add the scripts (don't fabricate one).
  4. **Summary:** print a table of each file → created / appended / merged / skipped(reason), then next steps (`npm i -D tsx`, `npm run release-gate`, fill in PROJECT-HUB).
  5. **Idempotency note:** re-running must detect markers/keys and skip.
- [ ] **Step 2:** Sanity-check the skill references only `git`/`gh`/`node`/`npm` and the bundled templates — no external skills/MCP/python.
- [ ] **Step 3:** Commit: `git add skills/govkit-init/SKILL.md && git commit -m "feat(govkit): /govkit-init scaffolder skill"`.

---

## Task 4: Generic `/sdlc` skill

**Files:** Create `skills/sdlc/SKILL.md`.

- [ ] **Step 1:** Write a clean, generic `/sdlc` (NOT a copy of any project's). Frontmatter `name: sdlc`. Body covers:
  - **`/sdlc status`:** read `docs/PROJECT-HUB.md` + `docs/PRIORITY-ROADMAP.md`; `gh issue list`; `git log --oneline -10`; report next priorities.
  - **Dev cycle:** plan → implement (tests-with-features) → verify (`npm run release-gate` locally, or CI) → branch/PR flow (`feature → dev → main`, per-merge approval).
  - **CI-fallback hook:** before merging, `gh run list --limit 3`; if Actions is unavailable, run `npm run release-gate -- --pr <#>`, require GREEN + evidence comment, then merge. (Point at the CLAUDE.md "Local Release Gate" section.)
  - **Session close:** update PROJECT-HUB (status + decisions + handoff) + PRIORITY-ROADMAP (revision history); close the issue.
  - Uses only `git` + `gh`. No project-specific names.
- [ ] **Step 2:** Commit: `git add skills/sdlc/SKILL.md && git commit -m "feat(govkit): generic self-contained /sdlc skill"`.

---

## Task 5: README

**Files:** Create `README.md`.

- [ ] **Step 1:** Write `README.md` covering: what govkit is; **Prerequisites** (Claude Code, git, gh + `gh auth login`, Node/npm; tsx per-project); **Install/enable** (`claude plugin marketplace add techsilon-oss/govkit` → `claude plugin install govkit`; private-repo access note); **Usage — new project** (git init → `/govkit-init` → `npm i -D tsx` → `npm run release-gate`); **Usage — existing project** (run `/govkit-init`; it appends to CLAUDE.md + merges scripts, never overwrites; review the summary); **What it scaffolds** (the minimal-tier list); **Language scope** (Node-first, gate checks are any shell command); **Tiers** (minimal now; full tier = 2b, future). No project-specific references.
- [ ] **Step 2:** Commit: `git add README.md && git commit -m "docs(govkit): README — prerequisites, install, new+existing usage"`.

---

## Task 6: Dogfood verification (acceptance test)

No new files (uses a throwaway dir). This proves the skill works end-to-end.

- [ ] **Step 1: Empty-project run.** In a fresh throwaway dir (`git init`), simulate `/govkit-init` by executing the skill's documented steps manually against it: substitute tokens, copy templates. Confirm created: `CLAUDE.md`, `docs/PROJECT-HUB.md`, `docs/PRIORITY-ROADMAP.md`, `scripts/release-gate.ts`, `release-gate.config.json`, `.gitignore`. Add a minimal `package.json` with the merged scripts + `npm i -D tsx`, then `npm run release-gate` → GREEN (with a trivial passing check in the config).
- [ ] **Step 2: Existing-project run.** In a dir with a pre-existing `CLAUDE.md` (one line) + `package.json` (no release-gate scripts), apply the scaffold: confirm `CLAUDE.md` gets the `govkit:start/end` block **appended** (original line intact), `package.json` gets the two scripts **merged**, and the summary reports append/merge correctly.
- [ ] **Step 3: Idempotency.** Re-apply to the existing-project dir: confirm CLAUDE.md block is **not** duplicated (marker detected) and scripts are skipped.
- [ ] **Step 4:** Record the dogfood results in the commit message; clean up throwaway dirs. Commit any fixes found.

---

## Task 7: Publish

- [ ] **Step 1:** `gh repo create techsilon-oss/govkit --private --source . --remote origin --push` (mirror release-gate-kit's owner/visibility).
- [ ] **Step 2:** Confirm the repo + push; print the install commands for a new machine.
- [ ] **Step 3 (optional, user-driven):** Install locally to verify the plugin loads: `claude plugin marketplace add techsilon-oss/govkit` → `claude plugin install govkit` → confirm `/govkit-init` and `/sdlc` appear. (Requires a Claude Code restart; note for the user.)

---

## Self-Review (completed inline)

- **Spec coverage:** plugin layout→T1; templates incl. vendored gate→T2; /govkit-init preflight+questions+non-destructive scaffold+summary+idempotency→T3; generic /sdlc→T4; README new+existing→T5; dogfood (empty/existing/idempotent/preflight)→T6; distribution→T7. No gaps.
- **Placeholders:** none — manifests shown verbatim; template requirements + markers specified; skill behaviors enumerated step-by-step.
- **Consistency:** `{{PROJECT_NAME}}`/`{{DEFAULT_BRANCH}}`/`{{DEPLOY_TARGET}}` tokens + the `<!-- govkit:start/end -->` marker used consistently across T2/T3/T6.
