---
name: architecture-review
description: "Review a diff or a branch range for the architecture drift lint cannot see. Run the scoped linters and the parity check first. Then work a checklist keyed to dev/docs/ARCHITECTURE.md: new *Api operations or contract shapes without a ruling, new or cut edges between modules, authorization or audit hand-rolled beside the door, wire differences against main, deleted spellings and new patterns, weak scenario binds. Report findings with file:line, section and fix; a finding seen twice becomes a lint-rule proposal. Use when someone says 'review this diff', 'review the lane', 'architecture review', 'is this slice ready to commit', 'check this branch against the record', 'did this add an Api operation', 'is this a wire change', 'hand-rolled auth', or before committing a lane's work."
user-invocable: true
---

# Architecture review: what lint cannot see

The linters are the authority (record §17) and run first. This skill is the reading that is
left: every checklist item below is something no `langwatch/*` rule or enforcer policy catches
today, and each names the record section that holds it. When an item gains a rule, delete it here.

A review reports. It does not fix, rule or design. A finding that needs a decision is a question
with options for the coordinator, who takes it to Alex when no ruling covers it.

## 0. Name the range

- A lane's uncommitted slice: `git status --porcelain -- <owned paths>` and `git diff -- <owned paths>`.
  Other changes in the checkout belong to someone else; do not review them.
- A branch range: `git diff --stat <base>...HEAD`.
- Read added lines, not the narrative: `git diff -U0 <range> -- <paths> | grep '^+[^+]'`.

## 1. Run the instruments first

```bash
pnpm lint:changed
pnpm lint:architecture --policies <ids the diff could reach>
pnpm --filter @langwatch/architecture-enforcer check:feature-parity
```

| The diff touches                                 | Policies to name                                                          |
| ------------------------------------------------ | ------------------------------------------------------------------------- |
| `static dependencies`, a module's `package.json` | `peer-cycles`, `cycles`, `manifests`, `declarations`                      |
| a Prisma or ClickHouse query                     | `prisma-table-ownership`, `clickhouse-table-ownership`                    |
| a browser package                                | `browser-package-closure`, `browser-package-exports`, `browser-node-leak` |
| a new or moved file under `modules/`             | `feature-layout`, `feature-shape`, `source-folder-shape`                  |
| a removed export                                 | `unused-module-export`                                                    |
| a new test file                                  | `default-test-lane`                                                       |

`--list-policies` names all of them. Read each finding with the `linting` skill and report it
as the tool wrote it; a lint finding is not re-argued in review. `peer-cycles` stays red until the
last cycle is cut (§5): report only edges the diff adds, compared with the base. Read the parity
verdict banner before and after, never a per-file tick.

## 2. The checklist

### A. A new `*Api` operation or contract shape without a ruling (§3.1, §8)

§8: a branch that moves from a handler into an `*Api` operation unchanged is approved in advance;
an operation that adds behaviour or a new shape is asked for (Alex, 2026-09-24).

- Find: added members of `interface <X>Api`, changed return types and new exported schemas in
  `git diff -U0 <range> -- 'modules/*/contract/src/*' 'enterprise/modules/*/contract/src/*'`.
- Each needs a ruling: a dated line in `dev/docs/ARCHITECTURE.md` or in
  `.claude/coordinator/rulings-*.md` citing Alex. A changed return type counts (merge L8's
  `OrganizationApi.createMembership` returning `{ outcome, seat }`).
- No ruling: finding. Fix: keep the one-to-one port, or move the proposal to the handoff's Risks
  with options. `WorkflowApi.relayExecuteSync` and `hasPerProjectEngines` went that way on
  2026-10-05: proposed in a handoff, ruled, then written.

### B. A new or cut edge between modules (§3.3, §5)

§3.3: another module's capability is a peer, its `*Api` token in `static dependencies`. §5: peer
cycles are refused, and no peer-cycle edge is cut or listed without asking Alex first (2026-10-05).

- Find: added `static dependencies` entries, added `@langwatch/<x>-contract` dependencies, added
  imports of another module's contract.
- A new edge that makes no cycle passes every policy and is still a design choice: finding unless
  ruled (merge L2b left one such edge for Alex).
- A cut edge must be a ruled cut. Then grep `apps/*/src/**/__tests__` and the reacting module's
  tests for the old edge: when gateway -> webhook was cut, the worker's governance-delivery test
  still read gateway's deleted subscriber (fixed in 8a48fdbe40; five more stale tests in d752cad06a).
- The `module-dependencies` skill teaches the shape of a cut.

### C. Authorization or audit beside the door (§8; CLAUDE.md rule 6)

§8: a handler calls exactly one API operation; middleware never does the framework's work (Alex,
2026-10-05). CLAUDE.md rule 6: name the permission with `.withPermission(...)`; a permission
check after `.withAccess(anyAuthenticated(...))` is a bypass.

- Find: a permission or role check in a handler, middleware, `*Api` implementation or service
  that a route reaches with `.withAccess(...)`; an audit row written by hand where the transport
  audits. Merge L7b's stop is the precedent: the enable audit stays the framework's project-level
  row, no hand-rolled write, until E10 (§16, open) is ruled.
- A framework option used for the first time, or in a new arity: ask for a test that reads the
  built declaration, not the type. `.withPermission("x", { via })` type-checked badly and dropped
  `via` at runtime, answering 500, until c4ee0b12d0.
- When the framework cannot express the check, the fix is an extension of `packages/api`,
  shapes first (§8): the finding says "ask", never "work around".
- Already lint's: `rest-route` (answers, inputs, another module's wire, the retired raw hatch),
  `transport-declares` (handler context, raw request), policy `platform-operator-calls`.

### D. Wire differences against main (§8, §12)

§8: a route keeps the path and parameter names main published (Alex, 2026-09-23, 2026-09-25).
§12: a ported code keeps main's spelling; a REST error body carries its fields at the root.

- Find, per touched route or procedure: `git grep -n "<path or name>" origin/main -- <old path>`,
  then compare path, status, body, permission, input and output.
- Every difference is listed with its reason (LANE.md §4), as merge L6b listed three. A ruled one
  cites its ruling. A status collapsed to 200, or a setting no longer configurable, is a
  regression: finding, never a listed difference.
- A declaration change that alters the OpenAPI document needs `make sync-all-openapi` (§8);
  the `openapi-clients` CI job fails on the diff.

### E. Deleted spellings and new patterns (§15, §16)

`dev/docs/deleted-spellings.json` holds §15 as data: each entry has `spelling`, `section`,
`replacement`, and a `pattern` unless it is prose only. Scan the added lines, code and prose
alike (skills, `CLAUDE.md`, `.claude/rules`, `dev/docs` outside `adr/` and `plans/`):

```bash
git diff -U0 <range> -- <paths> | grep '^+[^+]' > "$TMPDIR/added.txt"
node -e 'const fs=require("fs");const {spellings}=JSON.parse(fs.readFileSync("dev/docs/deleted-spellings.json","utf8"));const lines=fs.readFileSync(process.argv[1],"utf8").split("\n");for(const s of spellings){if(!s.pattern)continue;const re=new RegExp(s.pattern);for(const l of lines)if(re.test(l))console.log(`${s.spelling} (${s.section}): ${s.replacement}\n  ${l.slice(0,140)}`)}' "$TMPDIR/added.txt"
```

A hit inside a deletion context ("X is deleted") is fine. Read the entries with no `pattern` by
eye. A §16 left-column name written as if the tree had it is drift too. A new error envelope,
error handler or status branch is a new pattern (§8, §12): the fix is a `HandledError`.

### F. A weak scenario bind (§13)

Every added `/** @scenario */` annotation and every added level tag goes through the
`spec-binding-review` skill. Report its verdicts here with their rows.

## 3. Not a record finding: say so

Correctness no section governs belongs to the built-in `code-review` skill, not this one. Report it as "not a record
finding", name the invariant, and ask for a test that fails when the invariant breaks. Example:
the enforcer's `serverSourceReach` filter is sound only while every module-graph resolution is
lexical (`.claude/handoffs/perf-enforcer-2.md` §11). Never cite a section that does not hold the
rule; a "must" with no record line and no dated ruling is not a ruling (`architecture-guide`).

## 4. Report

```text
<path>:<line>  §<n>  <what is wrong, one sentence>
  fix: <the change> | ask: <the question and its options>
  backed by: <record heading and ruling date> | lint: <rule or policy>
```

Order: lint findings, then A to F, then section 3. A clean item says how it was searched
("A: none; no contract member added"). End with one verdict: `ready`, `changes needed` or
`needs a ruling`.

## 5. Seen twice: propose a rule

Before reporting a finding, search for it: `git log --since=<date> --format='%h %s%n%b' | grep -i
'<phrase>'` and `grep -ril '<phrase>' .claude/handoffs/`. On its second sighting, add a lint-rule
proposal to the report, worked through the `lint-rule` skill: §1 picks the instrument (rule,
enforcer policy, parity checker, owning-package test, or a doc when no fix can be named), §2
measures today's count, and the message says why and what to use instead (record §17). A proposal
is not a rule: the coordinator decides, and a rule ships at `error` only with the tree at zero.
Example: a `@scenario` annotation the checker cannot read was fixed twice on 2026-10-05
(cb02116fdd, b05ae63a46); first check whether `check:feature-parity --json` already reports it.

## Traps

- **Reviewing the handoff instead of the diff.** A claim with no line behind it is not evidence.
- **Citing a section number from memory.** `grep -n '^##' dev/docs/ARCHITECTURE.md` first.
- **Treating §16 "Open for Alex" as ruled.** Those are proposals.
- **Blaming the diff for a red `peer-cycles`.** Only edges it adds are its own.
- **Fixing what you review.** The reviewer reports; the owning lane changes the code.

## Links

`dev/docs/ARCHITECTURE.md` §3.1, §3.3, §5, §8, §12, §13, §15, §16, §17 ·
`dev/docs/deleted-spellings.json` · `.claude/coordinator/rulings-2026-10-05.md` ·
skills `linting`, `lint-rule`, `spec-binding-review`, `module-dependencies`, `api-transports`,
`architecture-guide`.
