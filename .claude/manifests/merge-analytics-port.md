# Manifest: merge-analytics-port

Objective: `modules/analytics` compiles. Main's ChartGrid and self-hosted-LWQL-provisioning files, landed by the merge at our module paths, import the monolith layout they came from; repoint them into this branch's module shape without dropping behaviour.
Owner: merge-analytics-port
Model: opus   <mapping main's free functions onto our service classes is integration judgment, not a path rewrite; the ChartGrid half is mechanical but shares the module, so one lane owns both>

**Overriding constraint (Alex, 2026-09-11): keep the LangWatchQL code SUPER
similar to `main`. Drew wrote it days ago and is still working in it.** Every
line you change that you did not have to change is a line that conflicts the
next time his work lands. Transpose; do not improve. Keep his function names,
parameter names, ordering, and doc comments verbatim - including comments that
describe the monolith, unless the sentence is made false by the move. If you
find something you think is wrong in his code, write it in the handoff and leave
it alone.
Budget: 160 tool calls or 90 minutes, whichever comes first
Handoff: .claude/handoffs/merge-analytics-port.md

## Context

The `git merge origin/main` is live and `modules/analytics` is already at **zero
unmerged paths** - every conflict is resolved and staged. Your job is not merge
resolution. It is the port that resolution deliberately left behind, exactly as
`modules/scenario` was staged with known TS2307s.

Alex's decision, already executed: **follow main.** The LangWatchQL workbench UI
is deleted (37 files). Main's replacement is landed. Do not resurrect the
workbench, and do not delete main's replacement to make errors go away - dropping
either is the one outcome that was ruled out.

Read `dev/docs/plans/main-merge-2026-09-11/what-the-merge-must-not-lose.md`,
section "The product decision: RESOLVED", before you touch anything.

## Owned paths

    modules/analytics/**

## Shared paths - stop and request

    everything outside `modules/analytics/`
    packages/architecture-lint/src/*-baseline.json
    any generated file or lockfile

## The two clusters

**1. ChartGrid / dashboard-widgets** (19 landed + 9 files where main's side was
taken). Symptoms are imports like `~/server/analytics/chartGrid`,
`~/components/analytics/useDashboardAutoRefresh`,
`~/features/custom-chart-playground/*`, `./ChartGrid`, `./DraggableGraphCard`.
This branch uses kebab-case filenames (`draggable-graph-card.tsx`), so main's
PascalCase relative imports are wrong twice over - path and case.

**2. Self-hosted LWQL provisioning** (`langwatch-ql/provisioning/`:
`selfProvisioning.ts`, `selfProvisionLock.ts`, `postgresReaderProvisioning.ts`,
`index.ts` + 3 tests). Imports `../catalog/types`, `../catalog/lwqlViews`,
`./accessModel`, `./catalogStatements`, `./productionProvisioning` - the first
two are main's layout, the last three were deleted here as superseded.

Their replacements are service **classes** - but the transposition that already
happened here is mechanical and faithful, and yours must match it. Compare
`LangWatchQLAccessModelService.keyMapTableStatement` against main's
`lwqlKeyMapTableStatement`: same body, same doc comment, `assertNames(names)`
became `this.assertNames(names)` and `qualified(...)` became `this.qualified(...)`.
That is the whole transformation. Do the same and nothing more:

    export function lwqlFoo({ names }: {...}): string {   ->   foo({ names }: {...}): string {
      assertNames(names);                                        this.assertNames(names);

The class is `export class X { static create(): X { return new X(); } private
constructor() {} }` and module-level singletons are named for the service
(`const accessModel = LangWatchQLAccessModelService.create()`).

One real difference to respect, not to copy: where main uses an optional
`sourceDatabase?: string` to straddle "test harness" and "real deploy" in one
function, this branch made that fork explicit - `sourceDatabase` is **required**
on `LangWatchQLProductionProvisioningService`, and migration 00084's table is
what production uses. Do not reintroduce the optional parameter.

The mapping, verified:

| main's free function | this branch |
| --- | --- |
| `./accessModel` KEY_MAP_COLUMNS, LangWatchQLNames | `services/langwatch-ql-access-model.service.ts` (still plain exports) |
| `lwqlRowPolicyStatement`, `lwqlKeyMapTableStatement`, ... | methods on `LangWatchQLAccessModelService` |
| `clickHouseAccessManagementConfigXml` | `LangWatchQLServerConfigService.accessManagementConfigXml` |
| `./catalogStatements` SHIPPED_LWQL_DEDUP | `services/langwatch-ql-view-statements.service.ts` (plain export) |
| `lwqlViewSetupStatements`, `lwqlViewStatement` | methods on `LangWatchQLViewStatementsService` |
| `./productionProvisioning` LWQL_KEY_MAP_TABLE, LwqlKeyMapRow | `services/langwatch-ql-production-provisioning.service.ts` (plain exports) |
| `productionClickHouseObjectStatements`, `planLwqlKeyMapBackfill`, ... | methods on `LangWatchQLProductionProvisioningService` |

`provisioning/index.ts` is a **dead barrel**: nothing in the repo imports it
(checked). Do not rebuild it as a facade around service instances - that is
re-exporting for compatibility, which this repo bans. Give the three files their
direct imports and delete the barrel, unless you find a real consumer.

## Rules

1. **Never delete a file to clear an error.** If something main shipped has no
   home here, stop and write it in the handoff. A dropped feature that nobody
   recorded is the failure mode this whole merge is guarding against.
2. **`import type` is free; a value import from `ui/` into `server/` is not.**
   `packages/architecture-lint/tests/frontend-boundary.unit.test.ts` walks the
   real graph and will refuse it.
3. Repository methods are `findAll`/`findById`; services `getAll`/`getById` -
   but that governs NEW code. Do not rename Drew's functions to fit it; the
   transposition drops the `lwql` prefix because the class supplies it, and
   stops there.
4. The reserved LWQL parameters are `dashboard_context_period_start`,
   `dashboard_context_period_end`, `dashboard_context_granularity_seconds`.
   Bare `period_*` is the pre-rename spelling and is wrong.
5. Identifier work goes through `tslsp-cli` from the package directory, never
   grep-and-sed. (The MCP `tslsp` server is failing to connect this session;
   the CLI is the one that works.)
6. Do not run `pnpm typecheck` - it is whole-tree and takes a machine slot.
   `pnpm typecheck:one modules/analytics/server` and `.../web`.

## Definition of done

- `pnpm typecheck:one modules/analytics/contract`, `.../server`, `.../web` clean,
  or every remaining error listed in the handoff with a named cause.
- No file under `modules/analytics` imports `~/components/`, `~/features/`,
  `~/server/analytics/`, `~/utils/` or `../catalog/`.
- `pnpm --filter @langwatch/analytics-web test:unit` run, result reported
  honestly - a failure named is worth more than a green you arranged.
- Handoff written even if you finish, so the next lane starts from fact.
- **A diff-similarity check on the LWQL half**: for each ported provisioning
  file, diff your result against main's original and report what changed beyond
  imports, `this.` and the class wrapper. Anything else in that list needs a
  reason in the handoff.
