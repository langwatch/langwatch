# Capabilities that did not survive their move into a package

A pattern, found while repairing test files that could not load. Each entry is
the same shape:

1. a component or surface is moved from `platform/app` into
   `packages/features/*`, re-authored rather than renamed;
2. something it did is not carried across — usually the part with the most
   intricate state;
3. the tests that would have caught it stop loading in the same move, or
   shortly after, so nothing goes red;
4. a later sweep deletes the now-unimported leftovers, which is correct on the
   evidence available and makes the gap permanent.

Nothing here is a criticism of the sweeps. Every individual commit was right on
what it could see. The gap is that step 3 hides step 2, so by the time a scan
runs, the only witness is already gone.

## Open

### The run plan's folder grouping has no test, and its test names the wrong component

`caseFiling.integration.test.tsx` asserts that `ScenarioPicker` groups test
cases under their suite names, passing a `folders` prop. That prop has never
existed — not on the packaged `scenario-picker.tsx`, and not on the five-line
shim that preceded it. `git log -S folders` over both paths returns nothing.

The capability is real and lives elsewhere: `PlanScopeField`'s `CaseChoices`
builds one group per folder plus `PICKER_UNFILED_GROUP_NAME` for the unfiled
remainder. `PICKER_UNFILED_GROUP_NAME` is exported from the packaged picker and
used only by `PlanScopeField` — the constant travelled, the behaviour did not.

`PlanScopeField` has no tests at all.

The test is skipped rather than deleted, with the reason written at the skip.
Unskipping means driving `CaseChoices` through a `PlanEditorState`; it does not
mean adding `folders` to the picker.

## Closed

### The LangWatchQL workbench lost its granularity picker

Full write-up: [lwql-workbench-granularity-regression.md](lwql-workbench-granularity-regression.md).

The picker, the reserved-name split and the revision-keyed hook are restored,
and the five spec scenarios with them. The suite goes 21/30 to 30/30.

The vocabulary moved to `@langwatch/analytics-contract` first, which is what
made the picker portable at all — and removed the package's second copy of
`LangWatchQLGranularityStep` while it was there.

Three of the nine dark tests carried a second, independent bug: they read the
mutation mock's argument 1, which was the input while the harness stubbed an
untyped tRPC client and became the abort options once it stubbed a typed one.
Worth its own line, because it is the part that generalises — a dark test does
not merely stop guarding, it stops being maintained, so it accumulates more
than one reason to fail and the count you see on unskipping understates how
long it has been broken.

### The Langy Prisma repositories were unreachable

Three characterization suites imported
`@langwatch/langy-server/repositories/prisma/<file>`, a subpath in no exports
map. Fixed by adding the six they need to `./testing`, the surface that already
exists for test-only concrete access — not by publishing the directory, since a
repository is an implementation of a port and application code importing one
directly is how the port stops being the seam.

### `dashboardBelongsToProject` was swept while an integration suite still bound it

The suite binds the real predicate against real Postgres on purpose: a
repository whose tenancy is asserted against an in-memory fake asserts the
fake's `filter`. It looked unreferenced to a scan that reads only production
code. The predicate now lives at its one call site, which removes a
`platform/app` module rather than restoring one.

Checked at the same time: the other thirteen modules that sweep deleted break
no import.

## How to not add another

When a move re-authors rather than renames, diff the two files by *behaviour*,
not by size — the giveaway in both open cases above is a constant or a state
field that travelled while the control that drove it did not. `setGranularity`
with no caller outside its own unit tests, and `PICKER_UNFILED_GROUP_NAME`
exported from a component that never groups, are the same tell.

## Test files that still cannot load

Repaired so far: the three Langy suites, `caseFiling`, `canonical-error`, and
`savedWorkbenchChart.integration` — six of the twenty found. What each of the
rest names, and why it is not a repoint:

| suite | names | why |
| --- | --- | --- |
| `modelProvider.routingHandle.integration` | `ModelProviderService` | The concrete service is internal to `@langwatch/model-provider-server` on purpose — the package's public surface is `PostgresModelProviderAdapter`, which constructs it. Either drive the test through the adapter, or move the test into the package. |
| `seedOnboardingDefaults.merge.integration` | `ModelProviderService`, `ModelDefaultsRepository` | Same, plus `ModelDefaultsRepository` exists nowhere in the repo. |
| `modelDefaults.service.userKey.unit` | `assertCanWriteScope` | Exists nowhere. The only `assertCanWriteScope` left is data-retention's, an unrelated port method. |
| `secrets.service-boundary.unit` | `../secrets` | The router moved out of `server/api/routers`. |
| `grant-provenance.unit` | `../repositories/authz-grants.ledger.repository`, `./ledger-write-fork.harness` | Neither exists; `server/app-layer/authz/repositories/` is gone. |
| `getEvaluatorModelSettingFields.unit` | `../getEvaluator` | Deleted by 4b9a5d3eb5, which consolidated evaluator execution. |
| `runBoardSnapshot.integration` | `../experiment-run.service` | Moved under `@langwatch/experiment-*`. |
| `governance-ingestion-key-resolution.integration` | `~/server/api-key/token-resolver` | Deleted; no successor by that name. |
| `savedWorkbenchChart.integration` (was) | — | Fixed. |
| `langyProcessPipeline.prisma.integration` | `./helpers/langyEventFixtures` | The fixture went with #6051, and so did every module it imported — `process-manager/` now holds nothing but this one `__tests__`. Worth porting rather than dropping: it is the only place the exactly-once commit and the outbox dispatch are asserted against a real Postgres. The package's three process tests (`langyConversationProcess`, `pipelineShape`, `langy-process-trace-continuity`) are all unit, and none of them makes that claim. |
| `virtualKeySpend.integration`, `budgetOverviewFixture` | each other | The fixture is itself in the broken set. |
| `e2e/langy/fake-tab-*` (3) | `~/features/langy/uiActions/*` | The whole `uiActions` directory moved into the Langy package. |

The split that matters: a suite naming a symbol that still exists somewhere is
a repoint, and those are done. A suite naming a symbol that exists **nowhere**
is one of two things — coverage whose subject was absorbed into a successor
under a new name, or coverage that was silently dropped. Telling those apart is
per-suite work and is what the remainder needs. Do not delete them as orphans
without answering that question: `dashboardBelongsToProject` looked exactly
like an orphan and was not.
