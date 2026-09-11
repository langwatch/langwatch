# CLAUDE.md: which rules a linter already enforces, and which it could

Audit of `CLAUDE.md` (614 lines, 112,879 characters) on 2026-09-11. Every rule in
the file is placed in one of five buckets. Nothing in `CLAUDE.md` was changed.

## Summary

- 90 rules found: 80 table rows (General 64, TypeScript 6, Database 10) and 10 in prose.
- **Bucket 1 (already enforced): 18. Bucket 2 (mechanizable, unwritten): 20.** Together
  38 rules, 36 physical lines, **40% of the three tables' text and 29% of the whole file**
  by characters (the enforced rows are the longest ones).
- Bucket 3 (partial): 15. Bucket 4 (prose stays): 34. Bucket 5 (stale, verified): 3 rules,
  plus one stale path and one stale number inside otherwise-valid rows.
- **Headline finding.** Three rules that back four table rows exist in
  `packages/lint-core/src/rules/`, have fixture tests, and carry 638 entries in
  `packages/architecture-lint/src/oxlint-baseline.json`, but were **never registered in
  `packages/architecture-lint/oxlint-plugin.mjs` nor enabled in
  `.oxlintrc.architecture.json`** (landed unregistered in 73d4fdb67d; `git log -S` finds no
  later registration). They enforce nothing today. Registering each is one line in two
  files with zero new failures, because the baseline already absorbs the debt:

  | Rule file (unregistered)        | Rows it covers                        | Baselined | Live hits today |
  | ------------------------------- | ------------------------------------- | --------- | --------------- |
  | `test-description-is-an-action` | L390 "should", L391 describe when     | 378       | 1 `it("should`, 1,138 nested describes not given/when |
  | `no-inline-dynamic-import`      | L439 inline `import()`                | 160       | ~70 in server and package source |
  | `banned-test-model-names`       | L417 gpt-4o in tests                  | 100       | 52 test/fixture files |

- **Registry drift.** `dev/docs/lint-rules.md` lists those three rules as if they ran and
  omits three that do run at error (`refusal-is-a-handled-error`,
  `channel-takes-only-its-client`, `repository-takes-only-its-store`). The doc is generated
  from `@langwatch/lint-core` exports, not from the plugin registry, so it cannot see the
  gap. Regenerate after registering, and consider making `lint-rules-doc.test.mjs` compare
  against the plugin registry.

## What counts as "enforced" here

| Instrument                                    | Feedback arrives              | Counted as bucket 1 |
| --------------------------------------------- | ----------------------------- | ------------------- |
| oxlint rule at `error` (baselined or not)     | on save and in `pnpm lint`    | yes; baseline noted |
| architecture-lint policy or unit test         | `pnpm lint` / package test    | yes                 |
| ast-grep rule, `severity: error`              | CI, changed files only        | yes                 |
| ast-grep rule, `severity: warning`            | CI prints, does not fail      | weak; called out    |
| CI workflow job (`go-ci`, `migration-order`)  | on push                       | yes                 |
| runtime guard with a test (Prisma tenancy)    | first test run                | yes                 |
| Repo hook                                     | only `SessionStart` exists    | none today          |

Rule names are as `dev/docs/lint-rules.md` spells them. "Baseline n" is the entry count in
`oxlint-baseline.json`; 0 means the rule is clean at error.

## General table (L384-L447)

| Line | Rule                                     | B | Enforcement today, or the sketch                                                                                                                                      | Confidence / residue |
| ---- | ---------------------------------------- | - | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 384  | Search before building                   | 4 | Needs intent                                                                                                                                                          | —                    |
| 385  | Settings UI: read UX docs, ScopeChipPicker | 3 | Sketch: oxlint on `*.tsx` under `**/settings/**`: a `Select`/`NativeSelect` JSX element whose `items`/`options` identifier matches `/scope|project|organization/i` | Low; "read the docs" stays |
| 386  | No internals in customer copy            | 4 | Taste                                                                                                                                                                 | —                    |
| 387  | No abbreviations in copy                 | 3 | Sketch: oxlint on JSX text and string props in `*.tsx` against a word list (`\btok\b`, `\breq\b`, `\bctx\b`, `oai`); identifiers excluded                              | Low-med; the list is the judgment |
| 388  | Docs page repeats frontmatter title      | 2 | `check-*.mjs` or unit test over `docs/**/*.mdx`: fail when the first `#` heading or first paragraph equals frontmatter `title`/`description`                          | High                 |
| 389  | Check feature files first                | 4 | Intent; parity checker covers bindings, not "did you read it"                                                                                                         | —                    |
| 390  | No "should" in test titles               | 1* | `test-description-is-an-action` `titleStartsWithShould` (unregistered, baseline 378). ast-grep `use-action-based-test-name` at error in CI on changed files          | Register; 1 live hit |
| 391  | Nested describe starts given/when        | 1* | Same rule, `nestedDescribeMissingGivenWhen`. ast-grep `require-bdd-describe-context` is `warning` (non-blocking)                                                     | Register; 1,138 live, baseline holds |
| 392  | No GWT comments instead of describes     | 2 | oxlint on test files: `Line` comment matching `/^\s*(given|when|then)\b/i` inside a test callback                                                                     | High                 |
| 393  | Tests that render are not unit tests     | 2 | oxlint: file matching `*.unit.test.tsx?` that imports from `@testing-library/*` or carries `@vitest-environment jsdom`                                                | High                 |
| 394  | Runtime bugs need executing regressions  | 4 | Needs knowing what the bug was                                                                                                                                        | —                    |
| 395  | Spec, test, then code                    | 4 | Process (duplicate of 407)                                                                                                                                            | —                    |
| 396  | Specs before TODO list                   | 4 | Process (duplicate of 408)                                                                                                                                            | —                    |
| 397  | No shared `types.ts`                     | 3 | `feature-source-filename` (error, baseline 0) rejects `types.ts` in module **server** source (no `types` artifact); 19 in `web/`, 2 in `contract/` are ungoverned   | Extend gate to web/contract; "unless truly shared" stays |
| 398  | No Zod + TS duplication                  | 3 | `zod-source-of-truth.unit.test.ts` bans a ts-to-zod step. Hand-written twins: oxlint pairing `z.object({...})` and a `type`/`interface` with the same key set in one file | Med; the pairing is the mechanical half |
| 399  | Run tests after edits                    | 4 | Process                                                                                                                                                               | —                    |
| 400  | No `npx vitest` / `npm exec vitest`      | 2 | PreToolUse Bash refuse-hook: `/\b(npx|npm exec|pnpm exec)\s+vitest\b/` (annotate or refuse; never rewrite). The root stub facts in the row are true                  | High                 |
| 401  | "Use `pnpm test:component`"              | 5 | Root `test:component` is an exit-1 stub (`package.json`); contradicts L400 and L296-303. The lane split it describes is gone                                          | Cut                  |
| 402  | Datastore lane recomputed per file       | 5 | `src/test-utils/integrationLanes.ts` is gone (L299 says so); no lane recomputation exists                                                                             | Cut                  |
| 403  | No throwaway `vitest.*.config.ts`        | 2 | Refuse-hook on `vitest .* (-c|--config) (/tmp|\$TMPDIR|\.\./)`; or an architecture-lint test failing any `vitest*.config.*` outside a package root                    | Med-high             |
| 404  | jsdom is a per-file docblock             | 4 | How-to. Stale number: "515 test files" is 892 today                                                                                                                   | Fix number           |
| 405  | No `--maxWorkers=1`                      | 2 | Refuse-hook on `vitest .*--maxWorkers=1`                                                                                                                              | High; low value      |
| 406  | Sweep orphaned vitest workers            | 4 | Process                                                                                                                                                               | —                    |
| 407  | Integration tests before unit            | 4 | Duplicate of 395                                                                                                                                                      | Merge                |
| 408  | BDD specs first                          | 4 | Duplicate of 396                                                                                                                                                      | Merge                |
| 409  | No `gh pr edit --body`                   | 2 | Refuse-hook on `gh pr edit .*--body`                                                                                                                                  | High; low value      |
| 410  | Branch naming                            | 2 | CI job asserting `^(issue\d+|feat|fix|chore)/` on the PR head ref                                                                                                     | High; low value      |
| 411  | No implementation details in scenarios   | 4 | Judgment                                                                                                                                                              | —                    |
| 412  | `projectId` in Prisma WHERE              | 1 | Runtime: `packages/prisma-client/src/multi-tenancy-guard.ts` throws; `tenancy-guard.test.ts`. Compress to a pointer                                                  | —                    |
| 413  | No copy-paste of legacy code             | 4 | Needs intent; no clone detector in the toolchain (`legacy-feature-fragments` only validates its own baseline)                                                          | —                    |
| 414  | Comments must match code                 | 4 | Judgment                                                                                                                                                              | —                    |
| 415  | No compat re-exports                     | 3 | `no-alias-reexport` (error, 0) catches renamed re-exports; `dangling-barrel-export` (error, 33) dead ones; `unused-module-export` policy on baseline. ast-grep `no-export-star-shim` is warning | Plain `export { x } from` that is used is the residue |
| 416  | No `gh api graphql -f`                   | 2 | Refuse-hook on `gh api graphql .* -[fF] `                                                                                                                             | High; low value      |
| 417  | gpt-5-mini in tests                      | 1* | `banned-test-model-names` (unregistered, baseline 100)                                                                                                               | Register             |
| 418  | Run scenarios end-to-end, not CI=1       | 4 | Process                                                                                                                                                               | —                    |
| 419  | No headless dogfooding                   | 4 | Process                                                                                                                                                               | —                    |
| 420  | Hooks never return JSX                   | 2 | oxlint: in a function named `/^use[A-Z]/`, a `return` whose argument is `JSXElement`/`JSXFragment` or an object with a JSX-valued property. 66 `use*.tsx` files exist; report `.tsx` hook files as a second message | High for return-JSX; med for filename |
| 421  | No drawer mounted inside a drawer        | 3 | oxlint: in a file exporting `*Drawer`, a JSX element named `*Drawer` (not an `openDrawer(` call), or `useDisclosure`. 0 live hits                                    | Med; `onClose`/`goBack` semantics stay prose |
| 422  | `useWatch` not `form.watch()` in children | 1 | ast-grep `no-form-watch-in-child` in CI, `severity: warning` so it does not fail; 22 live hits                                                                       | Port to oxlint at error with baseline |
| 423  | `gh run list` over `gh pr checks`        | 4 | Advice                                                                                                                                                                | —                    |
| 424  | No raw `error.message` toast             | 2 | oxlint on `*.tsx`/web packages: `Property` `description`/`title` inside `toaster.create(`/`toast(` whose value is `MemberExpression .message` on `error|err|e`. 8 live hits | High           |
| 425  | Name knowable failures                   | 4 | Judgment                                                                                                                                                              | —                    |
| 426  | No `HandledError` around infra failures  | 3 | oxlint: `new *Error(` extending HandledError inside a `catch` whose argument forwards the caught error's `.message`                                                   | Med; "do we know the cause" stays |
| 427  | 5xx subclass sets `fault`                | 2 | Unit test in `packages/handled-error`: walk subclasses (the walker in `apps/ui/.../codes.unit.test.ts` exists), assert `status >= 500` passes an explicit `fault`. `handled-error.ts:90` defaults to `"customer"`; nothing checks this today | High |
| 428  | Message names no env var/host/service    | 3 | oxlint: string args to HandledError constructors matching `/\b[A-Z]{2,}_[A-Z_]+\b|localhost|\.internal\b|https?:\/\//`                                                | Med; "customer-safe" stays |
| 429  | New code needs registry copy             | 1 | `packages/handled-error/src/presentation.ts` `satisfies` (exhaustive) + `apps/ui/src/model/errors/__tests__/codes.unit.test.ts` (every raised code listed, sorted, no duplicates). The row already says so; compress to one line | — |
| 430  | `meta` is a client contract              | 4 | Judgment                                                                                                                                                              | —                    |
| 431  | Field errors onto fields, not toast      | 4 | Semantic                                                                                                                                                              | —                    |
| 432  | No hand-rolled `c.json({ error })`       | 1 | `refusal-is-a-handled-error` at error, baseline 0, `applies: isServerTransport`. **Caveat:** 57 `c.json({ error` calls survive, 13 under module `transport/`; the gate or shape matcher is narrower than the row. Scratch-run the rule before cutting | Verify |
| 433  | Assert on `code`, not prose              | 3 | oxlint on tests: `toThrow(<StringLiteral>)` / `rejects.toThrow("…")` / `toMatchObject({ message: "…" })`                                                            | Med; plain-Error tests are false positives |
| 434  | Routes never touch repositories          | 1 | `transport-imports-a-repository` (error, baseline 9) + `api-transport-boundaries` policy                                                                              | Compress             |
| 435  | Repository `find*`, service `get*`       | 2 | oxlint: `MethodDefinition` named `list|get|getAll|getById` in a `*Repository` class / `*.repository.ts`; `findAll|findById|list` in `*Service`. `fallible-result-naming` covers only try/require/nullable | High |
| 436  | Typed `PrismaClient` at the seam         | 1 | `typed-prisma-seam` (error, 0) + `prisma-containment` (error, 0). 97 of the 117 surviving `as PrismaClient` files are tests                                            | Compress             |
| 437  | Name model/effort/context on spawn       | 4 | Process (`agent-workflow-protocol.unit.test.ts` checks the protocol files, not spawns)                                                                                | —                    |
| 438  | Monitor under the cache TTL              | 4 | Process                                                                                                                                                               | —                    |
| 439  | No inline `import()`                     | 1* | `no-inline-dynamic-import` (unregistered, baseline 160), exempts `sdks/typescript/src/cli/**`, `tsup.config.ts`, web package entries and `apps/ui/src/**`. ast-grep twin is `warning`. **The rule exempts UI code; the row says "anywhere"** — settle that when registering | Register |
| 440  | `pnpm typecheck` is three apps           | 4 | Reference                                                                                                                                                             | Keep one line        |
| 441  | Run golangci-lint before pushing Go      | 1 | `.github/workflows/go-ci.yaml` runs it; `.golangci.yml` pins misspell (US), nolintlint, testifylint                                                                   | Keep the misspell warning as one line |
| 442  | `InEpsilon` and zero expectations        | 3 | `.golangci.yml` L179-182 already excludes `gatewaymetrics/*_test.go` from `float-compare`                                                                              | "Can it be zero" stays |
| 443  | Install from the root                    | 4 | The row itself says a subdirectory install is harmless                                                                                                                | Shorten              |
| 444  | `overrides` only at workspace root       | 2 | architecture-lint test walking every tracked `package.json` (as `no-postinstall-network.test.ts` does): no top-level `pnpm.overrides`. 0 violations today            | High                 |
| 445  | "The app" is three packages              | 4 | Vocabulary                                                                                                                                                            | —                    |
| 446  | No `cd` before commands                  | 4 | Advice                                                                                                                                                                | —                    |
| 447  | No browser value-import from server      | 1 | `frontend-boundary.unit.test.ts` (transitive walk, `@langwatch/mail` the one terminal) + `package-boundaries` `serverImportsBrowser` + `web-imports-server-shaped-value`. The row is 1,500 characters restating its own test | Compress to two lines |

## TypeScript table (L453-L458)

| Line | Rule                                  | B | Enforcement today, or the sketch                                                                                                                  | Confidence / residue |
| ---- | ------------------------------------- | - | ------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 453  | `pnpm typecheck`, not raw `tsc`       | 1 | Bin shims from `install-check-shims.mjs` queue any whole-tree `tsc`/`tsgo` (`check-shims.test.ts`, `check-queue.test.ts`)                          | Keep "use the script" as one line |
| 454  | Compiler API lives behind `typescript/unstable/*` | 3 | `no-restricted-imports` entry for bare `"typescript"` in app/module/package source, excluding `packages/architecture-lint`, `sdks/typescript`, `mcp/typescript` (catalog `sdk-toolchain`, TS 6). **Stale path:** `src/test-utils/tsAst.ts` does not exist; the session owner is `packages/test-harness/src/ts-ast.ts` (also stale in `pnpm-workspace.yaml` L217) | High; ADR-099 pointer stays |
| 455  | Colocate single-use interfaces        | 4 | Duplicate of 397                                                                                                                                  | Merge                |
| 456  | No `--` on pnpm scripts               | 2 | Refuse-hook on `pnpm \S+ -- `                                                                                                                     | High; low value      |
| 457  | Named parameters over positional      | 2 | oxlint core `max-params` at 2 in governed source, baselined; or a house rule counting non-destructured params ≥ 3                                  | Med; callbacks and comparators need exemption |
| 458  | `incremental` + per-package `tsBuildInfoFile` | 1 | `tsconfig-shared-base.unit.test.ts` ("caches under a path scoped to that package", "no other project names")                              | Compress             |

## Database table (L466-L475)

| Line | Rule                                    | B | Enforcement today, or the sketch                                                                                                                                 | Confidence / residue |
| ---- | --------------------------------------- | - | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------- |
| 466  | Never edit deployed migrations          | 1 | `tools/migrationorder` in `.github/workflows/migration-order.yml`: "already merged, and migrations that have run somewhere cannot change"                        | Compress             |
| 467  | No hardcoded schema names               | 2 | Unit test over Prisma migration SQL matching `/"?\w+_db"?\./`                                                                                                     | High                 |
| 468  | Every ClickHouse query filters TenantId | 1 | `clickhouse-tenant-scope.unit.test.ts`: "scopes it to a tenant, or declares in writing why it does not"                                                          | "First predicate" ordering is not checked; keep that clause |
| 469  | No `LIMIT 1 BY` with heavy columns      | 3 | Extend the tenant-scope scan: report `LIMIT 1 BY` inside a subquery of a repository SQL literal (4 files today)                                                    | Med; "heavy" stays   |
| 470  | `argMax` for pagination keys            | 4 | Needs the query's intent                                                                                                                                         | —                    |
| 471  | Filter on the partition column          | 3 | Same scan: a statement on a partitioned table with no predicate on `StartedAt`/`OccurredAt`/`StartTime`                                                          | Med; "when a range is available" stays |
| 472  | No `_count` include on list queries     | 2 | oxlint: `Property` key `_count` inside the argument of a `.findMany(` call. 31 repository files today                                                            | High                 |
| 473  | Down migrations commented out           | 2 | Unit test over ClickHouse migrations: any non-comment statement after `-- +goose Down` fails                                                                     | High                 |
| 474  | One ALTER per StatementBegin block      | 2 | Same test: more than one `ALTER TABLE` between `StatementBegin`/`StatementEnd` fails                                                                             | High                 |
| 475  | Regenerate generated files              | 4 | Reference                                                                                                                                                        | —                    |

## Prose rules

| Line    | Rule                                                        | B | Notes                                                                                                                                                   |
| ------- | ----------------------------------------------------------- | - | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 7-12    | Check `specs/` first; create a feature file if none          | 4 | Intent                                                                                                                                                  |
| 14      | Read UX docs before frontend work                            | 4 | Intent                                                                                                                                                  |
| 16      | `HandledError` only when cause known and caller can act      | 3 | Mechanical half is L429/L432 above; "can the caller act" stays                                                                                          |
| 17-18   | "An untagged `.feature` file reports `0/0 scenarios bound` / `✓ all bound` and reads green" | 5 | `check-feature-parity.ts` L1509-1540 floors that trap: a file with scenarios and no enforced ones is reported inert and fails unless listed in `LEGACY_INERT` (`newInert`, L1790/L1849). The instruction (tag + `@scenario`) stands; the "reads green" claim is wrong |
| 94-96   | Never read `.env` for a value; never print one               | 3 | `secrets-through-source` (error) covers `process.env.<SECRET>` in source. Shell reads (`cat .env`, `. .env`) have no guard: refuse-hook on `/(cat|source|\.|grep)\s+.*\.env\b/` |
| 166     | `WORKERS_IN_PROCESS` / `START_WORKERS` are dead              | 1 | haven refuses them (`tools/thuishaven/cmd/root.go`, `root_test.go`)                                                                                     |
| 296-303 | `.integration.test.ts` is a level; declare datastores in config | 4 | Reference; contradicts L401-402 (which are the stale side)                                                                                          |
| 316-318 | Never set `CHECK_SLOTS` yourself                             | 1 | `check-queue.mjs` L25/L90 ignores a gate-off under `CLAUDECODE`                                                                                         |
| 343-347 | Prefer the observability stack for debugging                 | 4 | Advice                                                                                                                                                  |
| 461     | Read `clickhouse-queries.md` before writing ClickHouse       | 4 | Intent                                                                                                                                                  |

L20-254 (Development Environment), L255-347 (Commands, except the two rows above),
L349-378 (Structure, References) and L478-614 (RTK, 137 lines) are reference material, not
rules; out of scope. Note that the RTK block duplicates the user-global `~/.claude/RTK.md`
that every session already loads.

## Counts

| Bucket                              | Rules | Of which table rows |
| ----------------------------------- | ----- | ------------------- |
| 1 Already enforced                  | 18    | 16 (4 via unregistered rules) |
| 2 Mechanizable, not written         | 20    | 20                  |
| 3 Partially mechanizable            | 15    | 13                  |
| 4 Must stay prose                   | 34    | 29                  |
| 5 Stale or wrong                    | 3     | 2 (+ stale path in L454, stale number in L404) |
| Total                               | 90    | 80                  |

Line estimate: buckets 1 and 2 are 36 table lines and 2 prose lines, but 32,538 of the
tables' 80,369 characters (40%) and 29% of the file. Cutting bucket 1 to one-line pointers
and bucket 2 once its rules ship takes the three tables from ~80 KB to ~45 KB; merging the
four duplicate pairs (395/407, 396/408, 397/455, 401/402) and pointing the RTK block at
`~/.claude/RTK.md` takes the file to roughly 300 lines without losing a rule.

## Ten to mechanize first

1. **Register `test-description-is-an-action`, `no-inline-dynamic-import`,
   `banned-test-model-names`** (L390, 391, 417, 439). Two one-line edits each, zero new
   failures, 638 baseline entries start shrinking instead of sitting dead. Decide first
   whether L439's "anywhere" or the rule's UI exemption wins.
2. **Regenerate `dev/docs/lint-rules.md` from the plugin registry** and make
   `lint-rules-doc.test.mjs` fail on registry drift. Cheap; stops the next audit trusting
   a doc that lists three rules that never run.
3. **`_count` on `findMany`** (L472). 31 repository files carry it; the row cites a 2.3 s
   per-call production cost; one `Property` visitor.
4. **Raw `error.message` toast** (L424). 8 live hits, each a customer reading a code slug;
   one `Property` visitor scoped to toast calls.
5. **5xx `HandledError` without explicit `fault`** (L427). Unannotated 5xx logs an incident
   as customer noise; the subclass walker already exists in `codes.unit.test.ts`.
6. **`no-form-watch-in-child` to oxlint at error** (L422). 22 live hits and the ast-grep
   twin is `warning`, so today it enforces nothing.
7. **Repository/service method naming** (L435). Named-symbol rule with an obvious fix;
   naming drift is what makes the layer docs unreadable.
8. **Goose migration shape** (L473, 474) and **schema-name literal** (L467). One SQL-file
   test; the failures it prevents are irreversible in production.
9. **Hooks returning JSX** (L420). 66 `use*.tsx` files today; the return-JSX check has no
   plausible false positive.
10. **Refuse-hook for agent shells**: `npx vitest`, `--maxWorkers=1`, throwaway vitest
    configs, `gh pr edit --body`, `gh api graphql -f`, `pnpm x -- `, `cat .env` (L400, 403,
    405, 409, 416, 456, 94-96). Seven rows, one script, refuses and explains; the RAM rows
    alone justify it.

## Rules that are harmful as prose

- **L401-402.** They describe a lane split that no longer exists and tell an agent to run a
  script that exits 1. An agent following them fails, then re-reads L400 and L296-303 which
  say the opposite. Cut.
- **L17-18 "reads green".** Tells the agent the parity checker will lie to it, so agents
  distrust a green run that is now honest. Replace with "a new inert file fails parity
  unless listed in `LEGACY_INERT`".
- **L439 "anywhere".** The only rule that could enforce it exempts `apps/ui/src/**` and web
  package entries. Agents reading "anywhere" rewrite legitimate route-level lazy imports;
  the rule's exemption list, once registered, is the truth and the prose should match it.
- **L447 (1,500 characters).** Its length signals importance, but the test it cites already
  fails the build; agents spend the budget re-deriving what `frontend-boundary.unit.test.ts`
  will simply tell them. Two lines and a path.
- **L432.** States an absolute ("throw a HandledError") while 13 hand-rolled refusals sit
  under module `transport/` folders with the rule at error. Either the rule's gate is
  narrower than the prose or lint has not been run; until measured, the row over-promises.

## Verified stale (do not cut anything not on this list)

| Where   | Claim                                              | Evidence                                                                                          |
| ------- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| L401    | `pnpm test:component` runs the component lane      | Root `package.json`: `test:component` is `node -e "console.error('No component lane…')"` exit 1 |
| L402    | The datastore lane is recomputed from file source  | No `integrationLanes.ts` anywhere; L299 itself says it was deleted                                |
| L17-18  | Untagged feature file reads `0/0 · ✓ all bound`    | `check-feature-parity.ts` L1538-1545 never prints that line; new inert files fail (L1849)         |
| L454    | `src/test-utils/tsAst.ts` owns the TS API session  | Path absent; `packages/test-harness/src/ts-ast.ts` is the owner                                   |
| L404    | "515 test files set `@vitest-environment jsdom`"   | 892 today                                                                                         |

Everything else named in `CLAUDE.md` was checked and exists: every `dev/scripts/*`,
`dev/docs/best_practices/*`, ADR, spec, package and tool path in the file resolves.
