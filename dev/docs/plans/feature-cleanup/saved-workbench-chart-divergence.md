# Saved workbench charts: two services, one of them unreachable

Status: live one now tested; dead one still standing, with the map to remove it.

## What is there

|                    | `platform/app/src/server/analytics/saved-workbench-charts/`                                         | `packages/features/dashboard/server/src/services/`                    |
| ------------------ | --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| File               | `savedWorkbenchChart.service.ts` (604 lines)                                                        | `saved-workbench-chart.service.ts` (268)                              |
| Class              | `SavedWorkbenchChartService`                                                                        | `SavedWorkbenchChartService`                                          |
| Methods            | `createChart` `updateChart` `runChart` `placeChart` `unplaceChart` `deleteChart` `getAll` `getById` | `create` `update` `run` `place` `unplace` `delete` `getAll` `getById` |
| Reached at runtime | **no** — outside its own three test files, nothing in the repo names the class                      | **yes**                                                               |
| Tests              | 3 files, 44 cases                                                                                   | 18, all added 2026-08-31                                              |

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

## What has been done (2026-08-31)

The governance half is out. `validateSavedWorkbenchChartDefinition` is live and
unchanged, so its cases did not need a service at all — they are now
`__tests__/validateSavedWorkbenchChartDefinition.unit.test.ts`, ten cases
against the function directly, sabotage-checked by disabling each governor in
turn (3 cases fail without the LangWatchQL validation, 2 without the chart
policy). The package service's net covers the other half, that a refused
definition is never written, and carries those two `@scenario` annotations.

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

**What still blocks it, exactly.** The three files bind 24 scenarios of
`specs/analytics/lwql-saved-charts.feature`; the replacements above bind 4.
Deleting today would quietly unbind these 20, and a `.feature` scenario nothing
binds enforces nothing:

    A builder chart is not readable as a workbench chart
    A placed chart round-trips with the dashboard id and grid position it was given
    A saved chart is listed among the project's workbench charts
    A saved chart reads back with its SQL, parameters and specification intact
    A saved workbench chart is not readable as a builder chart
    A stored definition that no longer matches the schema is named, not returned as data
    Another project's saved chart cannot be edited or deleted
    Another project's saved chart is not readable
    Another project's saved chart is not runnable
    Another project's saved charts are not listed
    Deleting a placed chart leaves no dangling reference on its dashboard
    Editing a saved chart runs exactly the governors that creating it ran
    Placing a chart onto a dashboard already holding builder charts does not overlap them
    Placing a chart onto another project's dashboard is refused, and nothing is written
    Placing a chart requires a dashboard id and accepts an optional grid position
    Placing a chart that does not exist in this project is refused
    Placing a saved workbench chart does not let a builder chart land on top of it
    Running a saved chart executes its stored statement with its saved values and the surface's window and step
    Running a saved chart refuses a step finer than the period's bucket budget
    Unplacing a chart clears every placement field, not just the dashboard id

Four of those are tenancy — another project's chart must not be readable,
runnable, editable or listed — so this is not bookkeeping. They belong on the
package service, where the behaviour now lives, and several of them want the
real database rather than a fake, which is why the integration file cannot
simply be dropped either.

## Why this keeps happening

Third confirmed instance after the analytics ClickHouse cluster and
`TraceIOAccumulationService` — see `analytics-clickhouse-divergence.md`. The
extraction lands a package implementation, the platform original stops being
imported, and nobody deletes it because its tests still pass. Passing tests on
unreachable code are the thing that makes it look maintained.
