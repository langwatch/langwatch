# Handoff: merge-analytics-port

Status: **partial** (stopped on coordinator instruction, ~62 tool calls of 160)
Lane: merge-analytics-port, attempt 1. Model opus, effort `unknown (as-launched)`.

## What is done

**Cluster 2 (self-hosted LWQL provisioning) is COMPLETE except `provisioning/index.ts`.**
**Cluster 1 (ChartGrid / dashboard-widgets): server half repointed, web half NOT STARTED.**

### Files changed (do not redo)

`modules/analytics/server/src/langwatch-ql/provisioning/`
- `selfProvisioning.ts` — imports repointed to `../../rules/…` + `../../services/…`; module-level
  singletons `accessModel / catalogShapes / postgresMapping / postgresViews / viewProvisioning`
  added; call sites prefixed. Two doc sentences updated because the move made them false
  (header named `accessModel.ts`/`postgresMapping.ts`/`catalogStatements.ts`; and
  `src/tasks/provisionLwql.ts` → `src/tasks/lwql-provision.task.ts`). **Nothing else changed.**
- `postgresReaderProvisioning.ts` — imports repointed; `productionPostgresReaderGrantStatements(`
  → `productionProvisioning.postgresReaderGrantStatements(`. Nothing else.
- `selfProvisionLock.ts` — **one line**: `~/generated/prisma/client` →
  `@langwatch/prisma-client/generated`. Its two `@see` targets are now dangling; left verbatim.
- `__tests__/selfProvisioning.unit.test.ts` — imports repointed, singletons added below the
  import block, 4 call sites prefixed. Nothing else.

`modules/analytics/server/src/rules/__tests__/manifestParity.unit.test.ts` — imports repointed,
`lwqlSourceTables(` → `viewProvisioning.sourceTables(`, two `@see` paths corrected.

`modules/analytics/server/src/repositories/`
- `dashboardWidgetDefinition.ts` — `./lwql/limits` → `../langwatch-ql/limits.ts`.
- `dashboard-widgets/errors.ts` — `remediation` now from `@langwatch/handled-error`; `./access.ts`.
- `customGraphPlaygroundGate.ts` — `PrismaClient` → `@langwatch/prisma-client/generated`,
  `remediation` → `@langwatch/handled-error`, access import → `./dashboard-widgets/access.ts`.
- `dashboard-widgets/dashboardWidget.service.ts` — prisma types → `@langwatch/prisma-client/generated`,
  chartGrid → `../chartGrid.ts`, `DASHBOARD_SRCDOC_CHART_KIND` → `@langwatch/analytics-contract`,
  definition → `../dashboardWidgetDefinition.ts`. **`dashboardBelongsToProject` import left broken
  on purpose** — see escalation E3.
- `dashboard-widgets/access.ts` — `NOT_TARGETED` → `@langwatch/feature-flag-contract`,
  `PrismaClient` → `@langwatch/prisma-client/generated`. **`featureFlagService` import left broken
  on purpose**, with a TODO comment pointing here — see escalation E2.

`modules/analytics/contract/src/index.ts` — now also exports `DASHBOARD_SRCDOC_CHART_KIND`.

`modules/analytics/server/package.json` — added `"@langwatch/prisma-client": "workspace:*"` and
`"nanoid": "catalog:"`. **Needs an install to link** (shared-file request below).

## Verification: BLOCKED upstream, no green claimed

`pnpm typecheck:one modules/analytics/{contract,server,web}` all fail in the shared
**declarations prebuild**, before analytics is looked at:
- `packages/clickhouse-client/src/tasks/ttl.reconciler.ts` still has 12 live conflict markers (TS1185).
- `modules/scenario/contract/src/{result-atoms,simulation.events,scenario-run-evaluators,evaluator-attachments}.ts`
  have 6 errors (TS2307/TS2304/TS7006).
- contract also has one of its own: `src/visualization/__tests__/vega-lite-schema-validator.unit.test.ts:12`
  imports `../../../scripts/generate-vega-lite-validator.ts`, outside `rootDir` (TS6059). Pre-existing shape
  question, not caused by this port.

`tsc --noEmit -p .` inside `modules/analytics/server` runs but only checks **test** files: the
config references its own `tsconfig.build.json`, so every `src/` non-test file is redirected to a
`dist/` that has not been built, producing a wall of TS6305. **So the source files I edited have
not been type-checked by anything.** Treat every claim above as "the import target exists and is
exported", which I did verify by grep, not as "it compiles".

`pnpm --filter @langwatch/analytics-web test:unit` was **not run** (out of time).

## Escalations — main shipped this, it has no home here

**E1 (largest). Main's `LWQL_SELF_PROVISION` capability is landed but has NO CALLER.**
Base→main added +298 lines to `platform/app/src/tasks/provisionLwql.ts`: `redactSecrets`,
`runClickHouseStatements`, `selfProvisionAll`, the explicit mode selection
(`LWQL_SELF_PROVISION` / `lwqlPostgresReaderModeFromEnv`), and the `withLwqlSelfProvisionLock`
wrapping. Our `modules/analytics/server/src/tasks/lwql-provision.task.ts` is 296 lines against
main's 462 and contains **zero** mention of `selfProvision`, `manage-role` or
`LWQL_MANAGE_POSTGRES_READER`. Nothing anywhere in `modules/ apps/ packages/ enterprise/`
imports `selfProvisioning`, `selfProvisionLock`, or `postgresReaderStatementsFor`. Issue #6635
(self-hosted LangWatchQL provisioning, default-on in the Helm chart) is therefore **dead code on
this branch**. This is a feature port, not an import repoint — it needs its own lane.

**E2. `featureFlagService` has no module-shape equivalent, and the fix is cross-lane.**
`dashboard-widgets/access.ts` reads a monolith singleton plus its own Prisma lookup. The ported
sibling on this branch, `server/src/rules/lwql-access.rules.ts`, takes injected
`FeatureFlagApi` + `ProjectApi` instead — and Drew's own comment in `access.ts` says it "mirrors
`lwql/access.ts`'s pattern exactly". But mirroring changes `customChartPlaygroundEnabled`'s
signature from `{ prisma, projectId }`, and the caller is **not in my paths**:
`modules/trace/server/src/transport/api-trpc/dashboardWidgetAccessMiddleware.ts:33` and
`.../graphs.playgroundGate.unit.test.ts` mock it. Needs a decision taken with the trace lane.

**E3. `dashboardBelongsToProject` exists only in main's monolith.** 13 lines,
`platform/app/src/server/analytics/dashboardBelongsToProject.ts`, no equivalent file on this
branch. The behaviour lives in `modules/dashboard/server/src/repositories/prisma/prisma.dashboard.repository.ts`,
which `modules/analytics/server` may not import (module boundary: contract Api tokens only).
Left as a broken import rather than inlined or dropped.

**E4. `provisioning/index.ts` — I was told to delete it and could not.** `rm` was refused by the
permission classifier ("Irreversible Local Destruction"). It is a dead barrel (verified: nothing
in the repo imports it), it re-exports five modules that no longer exist, and the manifest forbids
rebuilding it as a facade. **Coordinator action: delete
`modules/analytics/server/src/langwatch-ql/provisioning/index.ts`.**

## Shared-file requests

1. `pnpm install` at the repo root (writes `pnpm-lock.yaml`) — required for the two deps I added
   to `modules/analytics/server/package.json`. Until then `@langwatch/prisma-client/generated` and
   `nanoid` are not linked into `modules/analytics/server/node_modules` and every file touching
   Prisma still fails TS2307.
2. Delete `modules/analytics/server/src/langwatch-ql/provisioning/index.ts` (E4).

## Exact next action

Port `modules/analytics/web/src/ui/sections/ChartGrid.tsx`: rename it to `chart-grid.tsx`
(this branch is kebab-case) and repoint its single bad import `~/server/analytics/chartGrid`.

### Mapping learned, beyond the manifest

The web package's real import vocabulary (read off `custom-graph.tsx`, `graph-card-header.tsx`,
`custom-dashboards-section.tsx`) — main's `~/…` paths map like this:

| main | analytics/web |
| --- | --- |
| `~/components/ui/menu` | `@langwatch/design-system/menu` |
| `~/components/ui/toaster` | `@langwatch/design-system/toaster` |
| `~/utils/compat/next-router` | `@langwatch/ui-host/use-router` |
| `~/server/analytics/chartKinds` | `@langwatch/analytics-contract` |
| `~/features/errors` | `../../model/describe-error.ts` |
| `~/components/PeriodSelector` | `../elements/period-selector.tsx` / `../../behavior/use-analytics-period.ts` |
| `~/server/analytics/lwql/timeWindow` | `@langwatch/analytics-contract` (`analytics.lwql-time-window.ts`) |
| `./DraggableGraphCard`, `./GraphCardHeader`, `./ChartGrid`, `./LazyLangWatchQLWidgetChart` | the kebab siblings already in `ui/sections/` |

Still unmapped and needing discovery: `~/utils/api` (tRPC client), `~/hooks/useFeatureFlag`,
`~/components/GraphsLayout`, `~/components/filters/*`, `~/prompts/components/ui/{VariableTypeIcon,FieldTypeSelect}`,
`~/features/custom-chart-playground/{DashboardWidgetInPlaceEditor,DashboardWidgetFrame,CreateDashboardWidgetDrawer}`,
`~/features/analytics-query/{components/LangWatchQLDashboardWidget,hooks/useWidgetGranularity}`,
`~/components/analytics/CustomGraph`, `~/server/db` and `~/server/filters/types`.

**Open decision the web half cannot avoid:** `chartGrid.ts` (zod placement schema +
`fitsChartGridWidth`, `CHART_GRID_DEFAULT_COL_SPAN`, `chartGridBottomRow`) landed at
`server/src/repositories/chartGrid.ts`, but it is imported by `analytics/web`
(`ChartGrid.tsx`, `report-grid.tsx`, `draggable-graph-card.tsx`, `useDraggableGraphCard.ts`,
`ChartGrid.integration.test.tsx`) **and** by `modules/trace/server/.../dashboardWidgets.ts`.
Only `@langwatch/analytics-contract` is importable by all three, so it probably belongs in the
contract — but that is a move across two lanes' consumers, so decide it rather than assume it.
Note also that `web/src/model/__tests__/chartGrid.unit.test.ts` landed with no `chartGrid.ts`
beside it, which hints main's own layout put a copy on the web side too.

## Diff-similarity check on the LWQL half (manifest requirement)

For `selfProvisioning.ts`, `postgresReaderProvisioning.ts`, `selfProvisionLock.ts` and
`__tests__/selfProvisioning.unit.test.ts`, the delta against main's originals is: **import block,
added `const <service> = …Service.create()` singletons, and a `<singleton>.` prefix on call
sites.** Three deliberate exceptions, all in `selfProvisioning.ts` / `manifestParity.unit.test.ts`,
all doc-comment only, all because the move made the sentence false: the three flat filenames in
`selfProvisioning.ts`'s header, the `provisionLwql.ts` caller reference in the same header, and
two `@see` lines in `manifestParity.unit.test.ts`. One stale reference was **left alone**
deliberately — the inline comment `// lwqlViewSetupStatements below` at `selfProvisioning.ts:210`,
because the branch's own earlier transposition left the identical stale `{@link lwqlViewSetupStatements}`
in `services/langwatch-ql-postgres-views.service.ts` and consistency beat correctness there.
No function name, parameter name, ordering or body logic was changed anywhere.

## Nothing in the working tree was reverted, staged, committed or deleted.
