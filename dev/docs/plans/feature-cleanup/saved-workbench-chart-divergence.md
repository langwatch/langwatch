# Saved workbench charts: two services, one of them unreachable

Status: live one now tested; dead one still standing, with the map to remove it.

## What is there

| | `platform/app/src/server/analytics/saved-workbench-charts/` | `packages/features/dashboard/server/src/services/` |
|---|---|---|
| File | `savedWorkbenchChart.service.ts` (604 lines) | `saved-workbench-chart.service.ts` (268) |
| Class | `SavedWorkbenchChartService` | `SavedWorkbenchChartService` |
| Methods | `createChart` `updateChart` `runChart` `placeChart` `unplaceChart` `deleteChart` `getAll` `getById` | `create` `update` `run` `place` `unplace` `delete` `getAll` `getById` |
| Reached at runtime | **no** — outside its own three test files, nothing in the repo names the class | **yes** |
| Tests | 3 files, 44 cases | 18, all added 2026-08-31 |

The live chain:

```
tRPC analytics.savedWorkbenchCharts        platform/app/src/server/api/routers/analytics.ts:121
  -> createSavedWorkbenchChartTrpcRouter   apps/api/src/features/dashboard/dashboard-trpc.mount.ts:78
  -> SavedWorkbenchChartTrpcApi            packages/features/dashboard/server/src/transport/api-trpc/
  -> DashboardApp -> DashboardService
  -> SavedWorkbenchChartService            packages/features/dashboard/server/src/services/
```

## What is NOT dead in that file

The two exported functions at the bottom, and what they need:

- `validateSavedWorkbenchChartDefinition` — imported by `presets.ts:183`, where it
  is wired as the `SavedWorkbenchChartPolicy` port the live service calls, and by
  `analytics.ts:135`, where the transport validates with the caller's own
  protections first. It needs `workbenchChartDefinition.ts`, which therefore stays.
- `mapDashboardSavedWorkbenchChartError` — the compatibility wire shape.

`savedWorkbenchChart.repository.ts` is imported only by the dead file, for a type.

## Checked, not assumed

Two things looked like live regressions and are not:

- **The process policy discards the caller's protections** (`presets.ts:1569`
  destructures `{ projectId, definition }` and substitutes
  `getProtectionsForProject`). Deliberate: the transport validates with caller
  protections at `analytics.ts:135` before the service is reached, and the
  comment says so.
- **`runChart` forwarded `timeWindow` / `granularitySeconds` / `onBudgetOverflow`
  explicitly; the live `run` just spreads `input.execution`.** Equivalent —
  `LangWatchQLRunContext` is exactly those three plus project and protections,
  and the package transport populates all three
  (`saved-workbench-chart.api.ts:290`). Pinned by a test now.

## Removing the dead half

The 44 cases are not worthless: 23 of them are the governance specification, and
12 carry `@scenario` annotations bound to feature files. Deleting them with the
class would drop that.

The move is to point the existing helper at the **live** service, wired the way
`presets.ts` wires it — the package service with its policy bound to
`validateSavedWorkbenchChartDefinition`. Then those cases exercise the live path
end to end, keep their bindings, and the class can go.

That means, in `savedWorkbenchChart.service.unit.test.ts` (975 lines):

- `FakeStore implements SavedWorkbenchChartStore` becomes a `DashboardRepository`
  fake (different method names and shapes).
- 37 call sites move: `createChart({ projectId, protections, input: { name, definition } })`
  becomes `create({ projectId, protections, name, definition })`, and the same
  for `updateChart` `runChart` `placeChart` `unplaceChart`.

`savedWorkbenchChartCoarsening.unit.test.ts` (5 cases) and
`savedWorkbenchChart.integration.test.ts` (16, against a real Postgres through
the dead repository) go with the class — the coarsening behaviour they cover is
pinned on the live path by the forwarding case added here.

Then: delete the class (lines 160-550), the interfaces only it uses, and
`savedWorkbenchChart.repository.ts`. Keep the two functions and
`workbenchChartDefinition.ts`.

## Why this keeps happening

Third confirmed instance after the analytics ClickHouse cluster and
`TraceIOAccumulationService` — see `analytics-clickhouse-divergence.md`. The
extraction lands a package implementation, the platform original stops being
imported, and nobody deletes it because its tests still pass. Passing tests on
unreachable code are the thing that makes it look maintained.
