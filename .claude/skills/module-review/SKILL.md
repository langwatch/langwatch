---
name: module-review
description: "Audit a LangWatch module (modules/<name>), a directory, a diff or a branch against the annotation shape and its guards, and for over-abstraction, and report with file:line evidence: what the module still carries from the older shape (the feature-shape inventory), folder grammar and filenames, the app's public surface versus its API, repository interfaces with both backends, prisma containment and the typed seam, projectId and TenantId scoping, private runtime exports, transport rules, web layer direction and closed entries, spec parity and @scenario binding, boot-time provision versus refusing stubs, the frontend boundary, and identity functions, pass-through layers, ports with one implementation, optional dependencies production always supplies, and comment blocks that are really incident reports. Runs the mechanical detectors (architecture-enforcer, oxlint, ast-grep, check-feature-parity, package tests and typecheck) first, then reads what they cannot see. Use whenever someone says 'audit', 'review this module', 'review the changed files', 'is this module clean', 'does <package> follow the layout', 'why does lint fail here', 'what is left to convert in <module>', 'this is overengineered', 'too many tiny files', 'simplify this', or before opening a PR that touches a module."
user-invocable: true
argument-hint: "<module name, package path, diff target, or directory>"
---

# Audit a module

Read `.claude/skills/architecture-guide/SKILL.md` and
`.claude/skills/architecture-guide/references/testing.md`. The audit is evidence first:
every finding names a file and line and the rule or scenario it breaks. No finding without
a path. Never edit code, never run `pnpm lint --fix`, never run the root `pnpm typecheck`.
The reference the module is measured against is `modules/annotation`.

Auditing a change rather than a whole package? Diff against `origin/main`, or the PR base
if on a PR branch, and apply the mechanical and reading passes to the touched files only.
Auditing broad ownership before a split, rather than one existing module? Search the
whole repository by domain nouns, route names, database models, event names and public
DTO fields first (not only the obvious folder), and map current production files,
API routes and permissions, UI pages, worker/subscriber/process entry points, and
cross-module dependencies before concluding where something belongs. Existing URL
prefixes and database tables do not define module ownership.

## The order, always

1. The mechanical pass: the detectors, then the shape survey no rule covers
   (`references/review-checklist.md`, section 1).
2. Read what the detectors cannot see: server shape, grammar, naming and data scoping,
   then the contract, then the web package (`references/review-checklist.md`, sections 2 to 4).
3. Composition and wiring, then specs and tests (`references/parity.md`, sections 5 and 6).
4. Over-abstraction: the questions that each need a `path:line` answer, then the Keep list
   (`references/over-abstraction.md`, section 7).
5. Classify and report (section 8, below).

A whole-module audit reads all three references in that order. A diff audit reads the
same three, applied to the touched files only.

## What are you checking → read which reference

| You are... | Read |
| --- | --- |
| Running the detectors (architecture-enforcer, oxlint, feature-parity, typecheck, tests, the frontend boundary, ast-grep), then the layer inventory, comment-heavy files and single-consumer modules | `references/review-checklist.md` section 1 |
| Walking `server/src`: installer, app, services, repositories, channels, `projectId` and `TenantId` scoping, transports, legacy pieces, folder grammar, filenames, identifiers, migrations, method names, the reject-on-sight list | `references/review-checklist.md` section 2 |
| Reading the contract package: the api interface and token, what may not live there, schemas, error classes | `references/review-checklist.md` section 3 |
| Reading the web package: folders, layer direction, entries and the catalogue, the api-map, host ports, hooks, drawers, copy, test naming, single responsibility | `references/review-checklist.md` section 4 |
| Checking how the installer is booted, what the composition root actually passes, config, the API's producer-only rule, the UI installation | `references/parity.md` section 5 |
| Checking scenario binding, test quality, skill and MCP tool scenarios, re-exports, and field-by-field behaviour parity of a diff that converts or migrates a module | `references/parity.md` section 6 |
| Asked "this is overengineered", "too many tiny files" or "simplify this", or judging where a database client or a conduit stops, ports with one implementation, optional dependencies and error status | `references/over-abstraction.md` |

## Invariants

- **No finding without a path.** `file:line`, the rule or scenario, a one-line target shape.
- **Read-only.** Never edit code, never `pnpm lint --fix`, never the root `pnpm typecheck`.
  The audit is the deliverable; nothing is fixed unless asked.
- **Detectors before reading.** The mechanical pass runs first, its lines grouped by rule
  and counted, new separated from baselined; the reading passes cover what no rule sees.
- **Read the parity banner** (`✗ THIS RUN FAILS: …`), not a per-file `✓`.
- **`grep -rn`, not ripgrep.** `rg` returns incomplete results in this repository.
- **A rule firing is a question, not a verdict.** Check each hit against the source, drop
  the idioms, keep a Keep list, and defer to what the mechanical half already accepts
  rather than re-litigating it.
- **The audit names gaps; it does not convert.** Every `feature-shape` entry is named with
  its replacement; closing it is `.claude/skills/module/references/convert.md`'s job.
- **Never propose collapsing a port with real polymorphism.**

## 8. Classify and report

For each finding: **file:line**, the rule or scenario, a one-line target shape.
Classify every gap as one of:

- **LEGACY**: a piece of the older shape the `feature-shape` baseline already lists;
  name its replacement (the conversion is `.claude/skills/module/references/convert.md`'s
  job, not this audit's).
- **STALE**: a named absence or comment whose claim the code contradicts; delete it.
- **DELIBERATE**: an absence the root names on purpose; leave it, cite the log line.
- **REAL GAP**: behaviour missing or a rule broken outside the inventory; say which
  `module` reference fixes it (`extend.md`, `wire.md`, `move.md`, `web-surface.md`).

Report structure, always:

```
# <module> audit
## Mechanical: lint <n> (new <n>, baselined <n>) · feature-shape <kinds left> · parity <bound>/<total> · tsc <errors> · tests <pass>/<total>
## Findings (most severe first)
- file:line · rule · what · target shape
## Over-abstraction: findings, then Keep list with reasons
## Absences: LEGACY / STALE / DELIBERATE / REAL GAP
## Recommended order of fixes
```

Do not fix anything unless asked; the audit is the deliverable. Never run the root
`pnpm typecheck` or `pnpm lint --fix`.
