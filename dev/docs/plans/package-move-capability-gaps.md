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

Twelve of the twenty are resolved: the three Langy suites, `caseFiling`,
`canonical-error`, `savedWorkbenchChart.integration`, `virtualKeySpend` with
its `budgetOverviewFixture`, `secrets.service-boundary`, and two retired to
successors that cover them better (`getEvaluatorModelSettingFields`,
`modelDefaults.service.userKey`).

Three findings came out of the ones that were **not** repoints, which is the
argument for working through the rest rather than sweeping them:

- `dashboardBelongsToProject` looked exactly like an orphan and was not.
- `modelDefaults.service.userKey` named a deleted guard — and the handled
  error it pinned had stopped being thrown anywhere, leaving a registered code
  with customer copy that no path could reach.
- `secrets.service-boundary` loaded fine once repointed but asserted a stale
  calling convention, which is the same lesson the workbench's three gave:
  a suite that cannot load also stops being maintained.

What each of the rest names, and why it is not a repoint:

| suite | names | why |
| --- | --- | --- |
| `modelProvider.routingHandle.integration` | `ModelProviderService` | The concrete service is internal to `@langwatch/model-provider-server` on purpose — the package's public surface is `PostgresModelProviderAdapter`, which constructs it. Either drive the test through the adapter, or move the test into the package. |
| `seedOnboardingDefaults.merge.integration` | `ModelProviderService`, `ModelDefaultsRepository` | Same, plus `ModelDefaultsRepository` exists nowhere in the repo. |
| `grant-provenance.unit` | `../repositories/authz-grants.ledger.repository`, `./ledger-write-fork.harness` | Needs re-authoring, not repointing — and it names a real gap. The chain it drives is gone: `LedgerAuthzGrantsRepository` became `EventingAuthzGrantRepository` in `@langwatch/authz-server`, and `GrantsLedgerWriter`, which the harness constructs, exists nowhere. What it covered that the package does not: the emitted COMMAND's actor and source. `authz-grants.service.unit.test.ts` asserts the service's CALL (`expect.objectContaining({ source: "join-request" })`), and the eventing repository's own tests assert neither. The orphan's docblock argues exactly this — "a value that stops one layer short of the fact is indistinguishable from one that never travelled at all" — so the last layer is unguarded today. |
| `runBoardSnapshot.integration` | `../experiment-run.service` | Moved under `@langwatch/experiment-*`. |
| `governance-ingestion-key-resolution.integration` | `~/server/api-key/token-resolver` | Half addressed. `TokenResolver` became `ApiKeyTokenResolutionService` in `@langwatch/api-key-server`, and the self-scoping behaviour survived intact — but nothing tested it: every packaged case passed an explicit `projectId`, so the branch that authenticates on the bearer alone was unguarded. Two cases now cover it. What is still only here is the MINT half: that `findIngestKey` carries `organizationId`, without which the tenancy guard rejects every mint at run time. That needs a real Postgres, so it needs the suite ported rather than replaced. |
| `langyProcessPipeline.prisma.integration` | `./helpers/langyEventFixtures` | The fixture went with #6051, and so did every module it imported — `process-manager/` now holds nothing but this one `__tests__`. Worth porting rather than dropping: it is the only place the exactly-once commit and the outbox dispatch are asserted against a real Postgres. The package's three process tests (`langyConversationProcess`, `pipelineShape`, `langy-process-trace-continuity`) are all unit, and none of them makes that claim. |
| `e2e/langy/fake-tab-*` (3) | `~/features/langy/uiActions/*` | The whole `uiActions` directory moved into the Langy package. |

The split that matters: a suite naming a symbol that still exists somewhere is
a repoint, and those are done. A suite naming a symbol that exists **nowhere**
is one of two things — coverage whose subject was absorbed into a successor
under a new name, or coverage that was silently dropped. Telling those apart is
per-suite work and is what the remainder needs. Do not delete them as orphans
without answering that question: `dashboardBelongsToProject` looked exactly
like an orphan and was not.
