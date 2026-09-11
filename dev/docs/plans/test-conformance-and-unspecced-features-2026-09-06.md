# Test conformance audit + unspecced-features report — plan

**Status:** proposal, measurement only. No code, config, or test changed to produce this
plan. Everything below is queued for after the current release, per Alex's instruction —
this document exists to make the backlog legible, not to start burning it down.

**Date:** 2026-09-06
**Scope:** `apps packages sdks/typescript mcp/typescript` (per repo convention; Go and
Python suites were not measured — see "Not measured" at the end).

---

## Part 1 — test conformance audit

### 1.1 Sources read

- `dev/docs/TESTING_PHILOSOPHY.md`
- `dev/docs/CODING_STANDARDS.md`
- `CLAUDE.md` (testing-related rows of the mistake/correct-behavior tables, plus body text)
- `dev/docs/adr/010-e2e-testing-strategy.md` (E2E deprioritized; `/browser-test` is the
  primary verification tier; a 5-10 test stable suite is the only persisted E2E)
- ADR-008, -009, -015, -028, -097 — all describe the **product's** "Scenario" agent-testing
  feature (AG-UI events, trace judging, turn config UI), not conventions for how *we* write
  vitest tests. Read and correctly excluded as out of scope.
- `packages/test-harness/README.md` does not exist; `packages/test-harness/src/` does (a
  vitest utility package — `mock-specifier-scan`, `integration-module-graph` — whose own
  tests incidentally surfaced as false positives while measuring rule 10, see below).

### 1.2 The checklist

Fourteen rules, each greppable (with noted precision limits), extracted from the sources
above:

| # | Rule | Source |
|---|------|--------|
| 1 | Every `*.test.ts`/`*.test.tsx` file carries `.unit.`, `.integration.`, or `.e2e.` before `.test.` | `TESTING_PHILOSOPHY.md` language table; `CLAUDE.md` "`.integration.test.ts` still states a test LEVEL" |
| 2 | Nested `describe("given …")` / `describe("when …")` BDD structure, not flat `it()` with GWT only in comments | `TESTING_PHILOSOPHY.md` "BDD-Style Test Structure"; `CLAUDE.md` row "Flat test structure with GWT comments" |
| 3 | No "should" in `it`/`test` titles | `TESTING_PHILOSOPHY.md` "No 'Should' in Test Names"; `CLAUDE.md` row "Using 'should' in test descriptions" |
| 4 | Every `@unit`/`@integration`/`@e2e`/`@regression` scenario (not `@unimplemented`) is bound to exactly one test via a `@scenario "<title>"` JSDoc | `TESTING_PHILOSOPHY.md` "Binding scenarios to tests"; enforced today by `check-feature-parity.ts` |
| 5 | Assert on `error.code`, not `.message` prose, once an error may have crossed a process/worker/serialization boundary | `CLAUDE.md` row "Asserting on error message prose in tests" |
| 6 | A `@regression` test for a runtime crash must execute the crashing path, not just diff a generated string | `CLAUDE.md` row "Writing string-assertion 'regression tests' for runtime bugs" |
| 7 | Datastore-touching integration tests tear down via a shared helper (`cleanupTestRows`), not ad hoc raw deletes | Inferred from `CLAUDE.md`'s database rows and the `startTestClickHouseEndpoints` convention — **weakest-sourced rule, not written verbatim anywhere** |
| 8 | No hand-rolled vitest config; every package config carries the RAM guardrails (`pool: "vmForks"`, `isolate: false`, `maxWorkers: "50%"`, `vmMemoryLimit: "512MB"`; integration adds `pool: "forks"` + `fileParallelism: false`) | `CLAUDE.md` rows "Running `npx vitest`/`npm exec vitest` directly" and "Hand-rolling a throwaway `vitest.*.config.ts`" |
| 9 | `// @vitest-environment jsdom` docblock on every file that renders via `@testing-library/react` | `CLAUDE.md` row "Writing a jsdom config because the repo 'has no jsdom environment'" |
| 10 | No `vi.mock("...")` referencing a path that no longer exists on disk | `CLAUDE.md`/lane-common "vi.mock paths in tests must be updated too"; memory `vi-mock-paths-invisible-to-rename-planners` |
| 11 | No "value-echo" tests (`expect(X).toBe(X)`) | Memory `no-value-echo-tests`; consistent with "Test Behavior, Not Implementation" |
| 12 | `expectX`/`assertX` custom helpers are accepted house style, not a violation | Memory `lint-fixes-keep-assertions` — noted, not measured |
| 13 | Single expectation per test where practical | `TESTING_PHILOSOPHY.md` "Single Expectation Per Test" |
| 14 | Outer `describe` uses MDN-style naming (`name()`, `Name`, `<Name/>`, `useName()`) | `TESTING_PHILOSOPHY.md` "Describe Block Naming" |

A rule requiring `packages/test-harness/README.md` conventions was considered and dropped —
the file doesn't exist.

### 1.3 Measurements

Scope for every command: `apps packages sdks/typescript mcp/typescript`, using `grep -rn`
(never ripgrep — documented unreliable in this repo). **Total test files in scope: 4,454**
(2,950 `.unit.`, 1,141 `.integration.`, 28 `.e2e.`, 335 non-standard/missing suffix). Total
`.feature` files: 1,320.

Full detail, top-10 file lists, and every grep command run live in
`/Users/afr/.claude/jobs/eeb488e6/tmp/test-audit/measurements.md` and its supporting raw
files in that same directory (`nonstandard-suffix-files.txt`, `has-describe.txt`,
`has-given-when.txt`, `describe-no-given-when.txt`, `message-assertion-files.txt`,
`raw-teardown-files.txt`, `stale-vimock.txt`, `configs-missing-guardrails.txt`,
`has-jsdom-docblock.txt`, `check-vimock-stale.sh`). What follows is the summary per rule.

#### 1. Test-level suffix — **335 of 4,454 files (7.5%) non-conforming**

Breakdown of the non-standard suffix used instead: `screen` (24), `redelivery` (23),
`scenario` (17, all `apps/ui/e2e/langy/*.scenario.test.ts` — arguably a legitimate fourth
level the docs don't name, since these are Playwright-style agent-scenario suites, not unit/
integration/e2e in the documented sense), `service` (11), `browser` (8),
`adapter`/`utils`/`repository`/`logic`/`errors`/`contract`/`characterization` (2 each), and
21 files with no level word at all (e.g. `apps/server/test/env.test.ts`).

**oxlint feasibility: yes, trivially.** Not even an AST rule — a filename-glob check
(`context.filename` against the suffix set) or a plain CI script. Cheapest as a `find`-based
CI step, not an oxlint rule at all.

#### 2. `describe("given …")`/`describe("when …")` BDD nesting — **753 files have `describe()` but zero given/when nesting**

4,432 files contain at least one `describe()`; 3,679 have at least one `given`/`when`-titled
nested describe; 753 have neither. This is a file-level absence heuristic — a file with one
`given` block among ten flat ones still counts as compliant. Representative:
`apps/api/src/__tests__/api-process.lifecycle.unit.test.ts` — correct MDN-style outer name
(`describe("ApiProcessLifecycleRoutes")`) but flat `it()`s directly beneath it, no nested
given/when.

**oxlint feasibility: partial.** A custom rule can flag "a `describe()` with `it()`/`test()`
children but no nested `describe()` at all" mechanically. It cannot judge whether a nested
title is *semantically* a precondition vs. an action — only whether it starts with the
literal word `given `/`when `. Recommend `langwatch/describe-nesting`.

#### 3. No "should" in test titles — **0 real violations**

One raw grep hit (`sdks/typescript/.../config.unit.test.ts:107`,
`it("shouldCaptureInput and shouldCaptureOutput answer instead of throwing", ...)`) is a
false positive — those are actual config field names, not "should"-style prose. **This rule
is already fully conformant.**

**oxlint feasibility: yes.** Same shape as `jest/no-test-prefixes` — a word-boundary regex
on the first string argument to `it`/`test`/`.only`/`.skip`/`.each`, anchored on `should `
with a trailing space to avoid the `shouldCaptureInput`-style false positive.

#### 4. `@scenario` binding coverage — **needs the real checker, not grep; 1,558 files carry zero `@scenario` annotations (not all are violations)**

2,898 of 4,454 test files (65%) carry at least one `@scenario` annotation. Grep cannot
reproduce the parity checker's actual cross-reference against `.feature` titles — many of
the 1,558 unbound-looking files are legitimately unit tests with no corresponding scenario
at all. Per project memory (`unbound-scenarios-are-dead-platform-tests`,
`feature-parity-tag-trap`), the authoritative number comes from
`pnpm check:feature-parity --json`'s own summary line, and as of the last review roughly
774/995 scenarios were unbound — mostly ported-from-`origin/main` files, not freshly
authored gaps. This plan doesn't re-run the checker (it wasn't in scope and risks a slot);
whoever picks this up should start from the checker's current summary line, not this grep.

**oxlint feasibility: no** for the real cross-file check — `check-feature-parity.ts` already
does the AST + Gherkin parsing needed. An oxlint rule could add the weaker, complementary
check "every `it()` in a file that already has ≥1 `@scenario` annotation is itself
annotated" (catches a new unannotated test slipped into an already-bound file) —
`langwatch/require-scenario-in-bound-file`.

#### 5. Assert on `.code`, not `.message` prose — **128 files assert on `.message`; 108 assert on `.code`**

Not disjoint — a file asserting `.code` for the contract and `.message` for presentation
copy is legitimate and expected per `CLAUDE.md` (message assertions are fine when checking
customer-facing copy; illegal only as a stand-in for `code` across a serialization
boundary). Representative: `apps/api/src/__tests__/api-rest.error-rendering.unit.test.ts`.

**oxlint feasibility: partial.** Detecting the assertion shape is mechanical; judging
whether the asserted object "may have crossed a process/worker/serialization boundary"
needs type information (is it a `HandledError`/`AppError`, not a local plain `Error`?) that
stock oxlint doesn't have. A `langwatch/no-message-assertion-on-handled-error` rule is
feasible only with a type-aware custom check (tsgo-based), not stock oxlint.

#### 6. String-only regression tests — **not mechanically measurable**

No reliable grep signal distinguishes "this test invokes the crashing code path" from "this
test diffs a rendered string." Recommend as a manual audit item, not a linter rule.

**oxlint feasibility: no** — runtime-semantics question, not a syntax one.

#### 7. Teardown via shared helper vs. raw deletes — **86 files do raw teardown; only 50 use `cleanupTestRows`; weakest-sourced rule**

Sets overlap (defensive raw teardown alongside the shared helper is reasonable), so 86 is
directional evidence, not a clean violation count. This rule was inferred from database
conventions rather than stated as a named must-use-helper rule anywhere read — flag as
weak-sourced if picked up.

**oxlint feasibility: yes for the mechanical half** (flag `.integration.test.ts` calling
`prisma.*.deleteMany(` or a raw `DELETE FROM`/`TRUNCATE` string outside test-utils), but
should ship advisory-only — some raw deletes legitimately test delete behavior itself.

#### 8. Hand-rolled vitest config / RAM guardrails — **0 rogue configs; but the documented guardrails were not found anywhere**

All 147 `vitest*.config.ts` files are legitimate per-package configs (matches the documented
"each package owns its own config" model since the lane-split removal) — **zero hand-rolled
configs**. But `vmForks` appears in **zero** files repo-wide, and `poolOptions` appears in
exactly one file that is unrelated production code
(`apps/api/src/app/api-trace-spool.composition.ts`), not a vitest config. A sampled
`apps/ui/vitest.config.ts` sets only `environment`, `watch`, `testTimeout`, `exclude` — no
`pool`, `isolate`, `maxWorkers`, or `vmMemoryLimit`. **This is a documentation-reality
mismatch, flagged as a finding to verify, not asserted as settled fact**: either every
package silently relies on vitest's own defaults (which `CLAUDE.md` elsewhere warns default
to the `forks` pool at `availableParallelism - 1` workers — precisely the RAM blowup the
rule exists to prevent), or the guardrails are applied through a mechanism this grep missed
(a `vitest.workspace.ts`, a wrapper script, or an env var). **Before anyone treats "the RAM
guardrails exist" as true, check `grep -rn "vitest.workspace"` and read one CI vitest
startup log.** This is the single highest-value item in this audit to resolve first — it
bears directly on whether `pnpm test:unit`/`test:integration` are actually RAM-safe as
`CLAUDE.md` claims across every one of these 147 packages, or only on some.

**oxlint feasibility: yes for presence-checking** — a static AST assertion that every
`vitest.config.ts`/`vitest.integration.config.ts` exports a `test.poolOptions` block of the
documented shape. No type information needed.

#### 9. jsdom docblock coverage — **0 violations on the measured slice, but with a real caveat**

810 files import `@testing-library/react`; 790 carry the jsdom docblock; the diff is 0 real
gaps (the mismatch is 20 files that have the docblock without importing
`@testing-library/react` directly — expected, not a violation). However: while chasing this,
**16 `*/web/vitest.config.ts` files (`apps/ui`, `packages/ui-host`, and 14 feature `web`
packages) set `environment: "jsdom"` globally** — which directly contradicts `CLAUDE.md`'s
own claim that "neither config declares a global `environment`." For those 16 packages the
per-file docblock is redundant, not load-bearing; the per-file convention is real only for
the remaining packages that mix jsdom and node tests in one config (e.g.
`modules/analytics/web`, which explicitly comments "every file that renders
declares `@vitest-environment jsdom`" and sets `environment: "node"` as the default). **The
`CLAUDE.md` line describing the per-file convention as universal should be corrected to
name the exception** — it's accurate for mixed-environment packages, not for the 16 that
went all-jsdom.

**oxlint feasibility: yes** — `langwatch/require-jsdom-docblock` flagging any `.test.tsx`
importing `@testing-library/react` (or a known render helper) without the docblock, scoped
to packages whose config doesn't already set `environment: "jsdom"` globally (to avoid
flagging the 16 redundant-but-harmless cases).

#### 10. Stale `vi.mock()` paths — **1 confirmed real stale mock, out of 29 raw hits (28 false positives)**

Custom resolution script (`check-vimock-stale.sh` in the tmp dir) checked every relative
`vi.mock()` argument against the filesystem. Of 29 raw hits: 18 are deliberate fixtures
inside the linter/test-harness's own test suite (`packages/architecture-enforcer/tests/
test-quality.test.ts`, `test-colocation.test.ts`; `packages/test-harness/src/__tests__/
mock-specifier-scan.unit.test.ts`, `integration-module-graph.unit.test.ts` — these
intentionally reference non-existent paths like `./widget`, `./x` as synthetic scanner
input); 8 are `.js`-extension ESM-style imports (`../langwatch-api.js`) whose `.ts` source
does exist — a script limitation (didn't try stripping `.js` before checking `.ts`), not a
real gap. **One confirmed real stale mock:**

```ts
// modules/scenario/web/src/ui/sections/agent-testing/run/__tests__/run-dialog.integration.test.tsx:105
vi.mock("../../use-run-scenario", () => ({
  useRunScenario: () => ({ runScenario: mockRunScenario, isRunning: false }),
}));
```

The real hook lives at `modules/scenario/web/src/ui/sections/use-run-scenario.ts`
— three directory levels up from the test file (`__tests__/../../../`), not two
(`__tests__/../../`) as the mock path resolves. The mock is silently a no-op: it never
intercepts the real import, so this test may be exercising the unmocked hook and passing for
reasons unrelated to what it claims to verify. Matches project memory
`vi-mock-paths-invisible-to-rename-planners`. **This is a real bug worth fixing on its own,
independent of this plan** — flagged here, not fixed (read-only lane).

**oxlint feasibility: yes, the strongest candidate in this whole set.** Pure filesystem
resolution (same algorithm as the script above, with `.js`→`.ts` stripping added and the
linter's own fixture tests either scoped out or given a suppression comment) would have
caught the real hit above at zero false-positive rate. Recommend
`langwatch/no-stale-vi-mock-path`.

#### 11. Value-echo tests — **~4 likely-real hits out of 15 raw matches**

`modules/organization/web/src/screens/organization/__tests__/members.unit.test.tsx`
has three real hits: `expect(true).toBe(true)` (lines 59, 66, 72) — proves nothing. One hit
in `apps/api/.../api-database.infrastructure.unit.test.ts` (`expect(infrastructure.
connection).toBe(infrastructure.connection)`) needs a manual look — could be a legitimate
memoization/stability check. One hit is again a linter fixture string. The regex only
catches literal identical-identifier echoes; it will miss structurally-equivalent-but-
differently-written cases, so 15 is a floor.

**oxlint feasibility: yes**, and better than the regex — an AST rule comparing the
`expect()` argument and matcher argument by structural equality generalizes correctly.
Recommend `langwatch/no-value-echo-assertion`.

#### 12. `expectX`/`assertX` helpers — not measured (permitted, not a violation)

#### 13. Single expectation per test — **aggregate ratio ~1.96 expects per `it`/`test`, repo-wide; no reliable per-test count without AST**

79,434 total `expect()` calls over 40,438 total `it()`/`test()` calls. This aggregate can't
say how many *individual* tests have 2+ direct expects vs. one `expectX` helper wrapping
several, or one `.toMatchObject()` covering several properties (both idiomatic, not
violations). A real count needs an AST pass per `it()` callback body.

**oxlint feasibility: yes for a literal count**, but high false-positive rate given the
idiomatic exceptions — ship advisory/warn only, probably scoped to `.unit.test.ts` where
"pure logic, branches" (the documented purpose of that tier) makes single-assertion tests
more natural than in integration tests.

#### 14. MDN-style outer describe naming — **folded into rule 2, not separately measured**

Same file set, same AST-walk requirement (find the *outermost* describe, check its title
against the four permitted shapes) as rule 2. `describe("ApiApplication HTTP failures", ...)`
from rule 2's snippet is a borderline case worth a second look by hand — "HTTP failures"
reads as a condition, arguably belongs as a nested `given`/`when` describe rather than the
outer unit-under-test name.

**oxlint feasibility: yes**, once rule 2's outer/nested distinction exists — reuse the same
walk, then regex-check the outermost title against the four MDN shapes.

### 1.4 Ten largest conformance gaps, ranked by count

1. **@scenario unbound test files: 1,558** of 4,454 (needs the real checker to separate
   real gaps from legitimately-unbound unit tests — see rule 4)
2. **Vitest configs missing documented RAM guardrails: 110 of 147** (rule 8 — verify before
   trusting; possibly the single most important finding in this audit)
3. **describe() files with no given/when nesting: 753** (rule 2)
4. **Non-standard test-suffix files: 335** (rule 1)
5. **Files asserting `.message` on an error: 128** (rule 5, partially legitimate)
6. **Files asserting `.code`: 108** (rule 5, the "good" side of the same measurement)
7. **Files doing raw datastore teardown: 86** (rule 7, weak-sourced, overlaps `cleanupTestRows` usage)
8. **Files using `cleanupTestRows`: 50** (rule 7, the "good" side)
9. **Value-echo raw regex hits: 15** (rule 11, ~4 likely real)
10. **Stale `vi.mock` raw hits: 29** (rule 10, only 1 confirmed real)

Rules 3 (should-titles) and 9 (jsdom docblock) are effectively **fully conformant** already
(0 real violations) and don't belong on a gap list — noted here so they aren't mistaken for
unmeasured.

---

## Part 2 — unspecced platform features

### 2.1 What already exists to build on

- `packages/architecture-enforcer/src/feature-catalogue.ts` reads
  `modules/catalogue.json` — 53 entries, each `{ id, root, classification:
  core|enterprise, subjects: string[] }`. This is the canonical feature list.
- `packages/architecture-enforcer/src/check-feature-parity.ts` (1,890 lines) already solves
  "does this scenario have a test": discovers `.feature` files, parses scenarios + tags,
  finds `@scenario "<title>"` annotations above test declarations across TS/Go/Python/
  bats/shell, indexes bindings by title, and reports bound vs. unbound per file. It uses an
  enforce-all-by-default model with a shrinking `LEGACY_UNBOUND` deny-list and an
  `@unimplemented` escape hatch for tracked gaps. **Per project memory, its authoritative
  output is the `✗ THIS RUN FAILS: <reasons>` summary line — not a `grep -c` count.**
- `packages/architecture-enforcer/src/boundary-edge-baseline.json` is the existing precedent for
  a *ratchet* baseline: `{ version, edges: [{ kind, from, to, expires }] }` — exactly the
  shape a stage-2 unspecced-surfaces baseline should reuse.
- **Nothing today answers the reverse direction** — "does this code have a scenario." The
  parity checker is scenario-first (walk specs, then find tests); a surface-first check
  (walk code, then look for spec mentions) needs its own surface enumeration, built from
  scratch for this prototype.

### 2.2 Verified layer grammar

The task hypothesized `transport/`, `screens/`, `surfaces/`, `processes/`, `subscribers/` as
surface locations — verified against real directories, not assumed:

| Surface kind | Path | Convention |
|---|---|---|
| tRPC | `<root>/server/src/transport/api-trpc/*.ts` | `.query("name", …)` / `.mutation("name", …)` |
| REST | `<root>/server/src/transport/api-rest/*.ts` | some routes carry `operationId`; many only a `.withDocs({ description })` string, no stable id |
| Screen | `<root>/web/src/screens/**/*.screen.tsx` | one file per screen |
| Surface | `<root>/web/src/surfaces/<name>/` (or flat file) | one directory/file per surface |
| Process | `<root>/server/src/processes/*.process.ts` | one file per scheduled/cron process |
| Subscriber | `<root>/server/src/subscribers/*.subscriber.ts` | one file per event subscriber |

These live *inside* each package's `server/src`/`web/src`, alongside (not instead of) the
top-level `contract/server/web` package split. **Gap found in passing:** REST route
identity is inconsistent — unlike tRPC's always-present procedure names, many REST routes
have no stable `operationId`, only a free-text description. A real implementation of this
report needs `operationId` everywhere first, or it will track REST surfaces by a string that
changes on every copy-edit.

### 2.3 Design: `check-unspecced-features`

**Surface enumeration** (prototype: one regex pass per file per kind, no AST — see
limitations below): trpc procedures, REST operations (operationId, falling back to
truncated description), one surface per `*.screen.tsx`, one per top-level entry under
`web/src/surfaces/`, one per `*.process.ts`, one per `*.subscriber.ts`.

**Spec text collection per feature**: union of the feature's own
`modules/<id>/specs/**/*.feature` (105 files exist across 41 of 53 packages) and
any top-level `specs/*` directory whose name normalizes (lowercase, `-`/`_`/space collapsed,
trailing `s` stripped) to the feature id or a declared subject.

**Match rule**: a surface is "specced" if its exact name appears verbatim in the collected
spec text, or ≥50% of its word tokens (≥4 chars) appear as substrings — deliberately
generous, biased toward false "specced" rather than false "unspecced," since the goal is
visibility for gradual catch-up, not a strict gate.

**What this does not do yet, by design**: fold in `check-feature-parity`'s actual
`@scenario`-to-test binding graph as a second, higher-confidence signal (a scenario whose
prose doesn't mention a surface's literal name, but whose *bound test* calls that surface,
should still count as specced). The prototype stayed dependency-free; a real implementation
inside `packages/architecture-enforcer` should import `discoverFeatureFiles` and
`findScenarioAnnotations` directly rather than re-parsing specs from scratch.

### 2.4 Real counts (prototype run)

Prototype script: `check-unspecced-features.prototype.mjs` (plain Node — `tsx`/`pnpm exec
tsx` isn't installed in this repo), at
`/Users/afr/.claude/jobs/eeb488e6/tmp/test-audit/check-unspecced-features.prototype.mjs`.
Full output: `run-output.txt` in the same directory (53-row per-feature table, 135-row
unspecced-surface list).

```
feature packages scanned: 53
total surfaces found:     1,192
total unspecced:          135  (11.3%)
```

**Top 15 packages by unspecced count:**

| Feature | Unspecced / Total | Spec files matched |
|---|---|---|
| governance | 19 / 102 | 4 |
| user | 18 / 34 | 1 |
| gateway | 15 / 44 | 2 |
| scim | 14 / 22 | 1 |
| organization | 8 / 85 | 8 |
| sso | 8 / 11 | 1 |
| suite | 7 / 39 | 22 |
| billing | 6 / 14 | 12 |
| onboarding | 5 / 5 | 0 |
| dataset | 3 / 37 | 13 |
| entitlement | 3 / 4 | 1 |
| evaluator | 3 / 22 | 20 |
| github | 3 / 6 | 2 |
| project | 3 / 12 | 7 |
| trace | 3 / 69 | 39 |

`user`, `scim`, `sso`, `gateway`, `governance` matching only 1-4 spec files against 11-102
surfaces each is the strongest real signal in this run — the packages most worth a human
pass first. `onboarding` showing "0 spec files matched" is very likely a matching-heuristic
miss (its specs probably live under a differently-named directory), not proof of zero
coverage — see limitations below.

**Top 20 individual unspecced surfaces** (full 135 in `run-output.txt`):

| Feature | Kind | Surface | Suggested scenario title |
|---|---|---|---|
| analytics | trpc | `feedbacks` | Feature: analytics — lists feedback for a chart |
| annotation | trpc | `delete` (annotation-score) | Feature: annotation — deletes an annotation score |
| annotation | trpc | `deleteById` | Feature: annotation — deletes an annotation by id |
| authz | screen | `roles` | Feature: authz — views and edits the roles screen |
| automation | trpc | `upsert` | Feature: automation — creates or updates an automation |
| dashboard | trpc | `batchUpdateLayouts` | Feature: dashboard — batch-updates graph layouts |
| dataset | trpc | `getAllByexperimentIdGroup` | Feature: dataset — lists batch records by experiment id group |
| dataset | trpc | `upsert` | Feature: dataset — creates or updates a dataset |
| dataset | rest | Archive a dataset (soft-delete) | Feature: dataset — archives a dataset via REST |
| entitlement | trpc | `getAggregatedCostsForOrganization` | Feature: entitlement — reports aggregated organization costs |
| entitlement | trpc | `getUsage` | Feature: entitlement — reports usage against limits |
| entitlement | trpc | `checkAndSendUsageLimitNotification` | Feature: entitlement — sends a usage-limit notification |
| evaluation | trpc | `warmupLambda` | Feature: evaluation — warms up the evaluator Lambda |
| evaluator | trpc | `getCopies` | Feature: evaluator — lists copies of an evaluator |
| evaluator | trpc | `pushToCopies` | Feature: evaluator — pushes changes to evaluator copies |
| evaluator | trpc | `getHistory` | Feature: evaluator — lists an evaluator's history |
| experiment | trpc | `commitWorkbenchVersion` | Feature: experiment — commits a workbench version |
| experiment | screen | `evaluation-wizard-redirect` | Feature: experiment — redirects from the evaluation wizard screen |
| gateway | trpc | `list` (gateway-budget) | Feature: gateway — lists gateway budgets |
| gateway | trpc | `reset` (gateway-budget) | Feature: gateway — resets a gateway budget |

### 2.5 What this prototype cannot measure precisely

- **No semantic "covers" check.** Text-matching can't tell whether a scenario that mentions
  a surface's name actually exercises it, versus mentioning it in passing. This produces
  false "specced" results more often than false "unspecced" ones, given the generous match
  rule — meaning the true unspecced count is likely **higher** than 135, not lower. A
  precise version needs `check-feature-parity`'s actual binding graph (does the *bound
  test* call this surface?), which is knowable but not attempted here.
- **REST surface identity is unstable** without `operationId` everywhere — see 2.2.
- **Directory-name spec matching is approximate** — `onboarding`'s 0-matched-files result is
  the clearest example of the heuristic missing real coverage rather than proving an
  absence.
- **No cross-feature dedup** of spec text matched by more than one feature's directory
  pattern — not observed to matter in this run, not specifically ruled out either.
- Enterprise packages (`enterprise/modules/*`) are included via the same code
  path as core features but weren't spot-checked line-by-line for correctness.

### 2.6 Proposed rollout — three stages, all starting after this release

1. **CLI report, advisory, never fails.** `pnpm check:unspecced-features` (new script in
   `packages/architecture-enforcer`, sibling to `check:feature-parity`) prints the per-feature
   table and top-N unspecced surfaces. Exit code always 0. Pure visibility — run manually or
   as a non-blocking CI step.
2. **Ratchet baseline.** A checked-in `unspecced-surfaces-baseline.json` under
   `packages/architecture-enforcer/src/`, in the same shape as `boundary-edge-baseline.json`
   (`{ version, surfaces: [{ feature, kind, name, file, expires }] }`). Every
   currently-unspecced surface gets an entry with an expiry date. CI fails only when: (a) a
   *new* unspecced surface appears in a package touched by the PR that isn't already in the
   baseline, or (b) a baseline entry's `expires` date passes unrenewed. Same shrink-over-time
   discipline as `LEGACY_UNBOUND`, scoped to touched files so it doesn't demand a big-bang
   spec-writing effort.
3. **Error, enforce-all with a shrinking deny-list.** Once a package's baseline count reaches
   zero, remove it from the deny-list — the check then fails CI on any new unspecced surface
   in that package. Packages still on the list stay non-blocking until their own count hits
   zero. No global flag day; each package graduates independently.

This deliberately mirrors `check-feature-parity.ts`'s existing rollout pattern
(enforce-all + shrinking deny-list + timestamped escape hatch) rather than inventing a new
enforcement idiom.

---

---

## Part 3 — Vitest 5 migration: optimal setup for local and CI (added, read-only follow-up)

Triggered by a direct question mid-audit ("we moved to vitest5, check what the optimum
setup is for both local and CI"). Answered from the same read-only measurement discipline
as Parts 1-2 — every claim below is grep/filesystem-verified against the installed
`vitest@5.0.0` package and the actual CI workflow, not from memory of Vitest's docs.

### 3.1 Version state — migration is not finished

Almost every package.json pins `"vitest": "^5.0.0"`, and `node_modules/.pnpm` confirms
`vitest@5.0.0` is the resolved version nearly everywhere. **Two packages still pin
`^4.1.9`**: `modules/langy/server/package.json` and
`modules/model-provider/server/package.json`. This is why `pnpm-lock.yaml`
resolves both `vitest@5.0.0` and `vitest@4.1.10` in the same workspace — two full copies of
Vitest on disk, and those two packages' test scripts run under v4's behavior (different pool
defaults, different CLI) while every sibling package runs v5. **First step of "optimal
setup" is finishing the migration**: bump both to `^5.0.0` and delete the resulting duplicate
lockfile entries.

### 3.2 What Vitest 5 kept — the documented guardrail vocabulary is still valid

Checked directly against the installed package's type definitions
(`node_modules/.pnpm/vitest@5.0.0.../vitest/dist/chunks/plugin.d.BbcoZhuj.d.ts`): the pool
names `"forks" | "threads" | "vmForks" | "vmThreads"` all still exist as literal types, and
`ForksPoolWorker`, `ThreadsPoolWorker`, `VmForksPoolWorker`, `VmThreadsPoolWorker` are all
still exported classes. **`CLAUDE.md`'s guardrail vocabulary (`pool: "vmForks"`,
`isolate: false`, `maxWorkers`, a per-worker memory limit) did not become stale in the
v4→v5 move** — nothing here needed updating for the new major. The config nesting for the
memory limit is `test.poolOptions.vmForks.memoryLimit` (a `number | null` field on the
pool's internal task type, confirmed at the same location) — `CLAUDE.md`'s shorthand
"`vmMemoryLimit: '512MB'`" describes this field, not a literal top-level key; anyone
implementing this should nest it under `poolOptions.vmForks`, matching the pattern the repo
already uses correctly for the integration lane's `poolOptions`-adjacent settings.

### 3.3 What's actually configured today — confirms and sharpens Part 1, rule 8

Re-verified with a narrower, more precise grep than Part 1 used:

- **Zero files anywhere in the scoped tree contain the string `vmForks`.** Not one exemplar
  config exists to copy from — the documented unit-lane guardrail combo
  (`pool: "vmForks"` + `isolate: false` + `maxWorkers` + `poolOptions.vmForks.memoryLimit`)
  is aspirational, not implemented, in every one of the 147 vitest configs.
- **The integration lane's guardrails ARE real and correctly applied.** Read
  `apps/worker/vitest.integration.config.ts`, `packages/clickhouse-client/
  vitest.integration.config.ts`, `packages/prisma-client/vitest.integration.config.ts` in
  full: each sets `pool: "forks"` + `fileParallelism: false` exactly as documented. The
  gap is specifically the **unit lane** (`vitest.config.ts`, not `.integration.config.ts`).
- **Every unit-lane `test:unit` script is a bare `vitest run`** (checked `apps/ui`,
  `apps/api`, `apps/worker`, `packages/clickhouse-client` — no CLI flags). Locally, with no
  config-level pool/isolate/memory settings and no CLI flags, a unit-test run falls back
  entirely to Vitest 5's own defaults: `pool: "forks"`, `isolate: true`, and a worker count
  scaling to `availableParallelism - 1` — exactly the blowup shape `CLAUDE.md` warns about
  elsewhere ("vitest defaults to the `forks` pool at `availableParallelism - 1` workers ...
  several GB per run, multiplied by every parallel agent worktree").
- **CI already has one real guardrail the local path lacks**: the `test-unit` job in
  `.github/workflows/langwatch-app-ci.yml` sets `VITEST_MAX_WORKERS: "4"` (commented
  "physical core count on GitHub-hosted ubuntu runners"). This is a genuine Vitest-recognized
  environment override — confirmed via `packages/test-harness/src/
  integration-file-concurrency.ts`'s own doc comment, which describes exactly this
  mechanism (and why the integration lane has to actively *withdraw* it to keep
  `fileParallelism: false` from being silently defeated). So **CI caps worker count; local
  does not** — the inverse of what you'd want if RAM is the constraint you're guarding
  against locally (per-agent-worktree contention), since CI runs one job per matter on a
  dedicated runner while local is exactly the "several agents on one machine" scenario
  `CLAUDE.md` describes elsewhere. Neither CI nor local caps *per-worker memory*
  (`poolOptions.vmForks.memoryLimit`) — `VITEST_MAX_WORKERS` bounds worker count, not the RSS
  each worker can grow to before Vitest recycles it.

### 3.4 What "optimal" looks like, given the above — proposal, not applied

**Local (unit lane, all 147 `vitest.config.ts` / equivalents):**
- Add `pool: "vmForks"`, `isolate: false`, `poolOptions: { vmForks: { memoryLimit: "512MB" } }`
  to a genuinely shared base — today there is no shared base config to edit once (each
  package's config is a standalone `defineConfig({...})` object per the post-lane-split
  model), so this has to land as a small `defineTestConfig(overrides)` helper package
  authored once and imported by all 147, or as a codemod touching all 147 files directly.
  Either way, it's the same content 147 times today with zero sharing — a natural target for
  a `packages/vitest-config-shared` (or similar) package that each config imports and
  spreads, so the guardrail is asserted once and inherited, not re-typed per package.
- `maxWorkers: "50%"` locally specifically because local is the multi-agent-worktree
  scenario — several parallel Claude Code sessions each running `pnpm test:unit` compete for
  the same physical cores, and `CLAUDE.md`'s own `check-queue.mjs` machine-wide slot exists
  for exactly this contention on typecheck/lint/format but **has no vitest equivalent** —
  nothing serializes concurrent `pnpm test:unit` runs across agents today. `maxWorkers: "50%"`
  is a per-run cap that reduces (but does not eliminate) the multi-agent collision; a
  vitest-aware queue slot analogous to `check-queue.mjs` would be the complete fix and is out
  of scope for a config change alone.

**CI (`test-unit` job in `langwatch-app-ci.yml`):**
- Keep `VITEST_MAX_WORKERS: "4"` (correctly sized to the runner's physical cores already).
- Add the same `poolOptions.vmForks.memoryLimit` ceiling to the shared config so a single
  runaway suite recycles its worker instead of pushing the whole job toward the runner's
  OOM killer — CI today has a worker-count cap but no memory-per-worker cap, so one bad test
  can still take the whole matrix leg down before `VITEST_MAX_WORKERS` has any chance to
  help (it bounds concurrency, not any individual worker's ceiling).
- Do **not** copy `fileParallelism: false` into the unit lane — that setting is correctly
  scoped to the integration lane only (shared ClickHouse/Redis fixtures, per
  `integration-file-concurrency.ts`'s own reasoning) and would silently serialize the unit
  matrix's ~2,000 tests for no correctness benefit.

**Before implementing any of the above**, finish 3.1 (the two `^4.1.9` stragglers) first —
adding a shared guardrail config while two packages still resolve a different Vitest major
risks the shared config assuming v5-only option shapes that v4 doesn't recognize, which
would surface as a silent no-op in those two packages rather than a clear error.

### 3.5 Not verified

- Whether `poolOptions.vmForks.memoryLimit` accepts a percentage string (`"50%"`) or only an
  absolute byte count / `"512MB"`-style string in this exact v5.0.0 build — the type is
  `number | null` at the `PoolTask` level, which is the *resolved* internal shape after
  Vitest parses whatever the user-facing config accepted; the user-facing parser for that
  string wasn't traced in this pass.
- Whether `apps/ui`'s Playwright-adjacent `e2e/langy/*.scenario.test.ts` suites (excluded
  from the unit lane's `vitest.config.ts` already) have their own separate pool needs — out
  of scope for this question, not investigated.
- Whether any of the 37 configs that already show `pool: "forks"` (the integration-lane
  ones) also need the memory ceiling — plausible (integration suites run heavier fixtures),
  not measured here; scoped this pass to the unit-lane gap since that's where CI and local
  most diverge today.

---

## Not measured / explicitly out of scope

- **Go and Python test suites** (`services/aigateway`, `services/nlpgo`,
  `services/langevals`, `sdks/python`, `sdks/go`) — the checklist and greps above cover
  TypeScript only (`apps packages sdks/typescript mcp/typescript`), per the task's own
  scope. `TESTING_PHILOSOPHY.md`'s language table documents `_test.go`/`_e2e_test.go` and
  `test_*.py` conventions but neither was measured here.
- **Rule 6 (string-only regression tests)** — no reliable mechanical signal; flagged as a
  manual-audit-only item, not a candidate for automation at all.
- **Rule 4's precise unbound count** — grep gives a rough upper bound (1,558 files with zero
  `@scenario` annotations); the real number requires running `check-feature-parity.ts`
  itself, which this read-only measurement pass deliberately avoided (running it wasn't
  needed to write this plan, and this lane holds no license to touch or invoke build/check
  tooling beyond read-only greps).
- **The rule-8 RAM-guardrail finding is unconfirmed** — flagged as "verify before treating
  as fact," not asserted as a settled defect. See 1.3 §8.
- **The unspecced-features prototype's true-unspecced count is a floor, not a ceiling** — see
  2.5. The generous match heuristic almost certainly overstates "specced" coverage.
- Working files, raw grep output, and the prototype script all live under
  `/Users/afr/.claude/jobs/eeb488e6/tmp/test-audit/` and were not committed — they're
  reproducible from the commands cited throughout this document.
