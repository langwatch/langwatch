# Wave-4 process wiring: dashboard, then platform-health, role and suite REST

**Date:** 2026-09-08 · **Owner lane:** one Opus agent after the wave-3 lane (`882ebfa479`) · **Reviewed by:** Fable

Same rules as `wave3-process-wiring.md` (Read/Edit/Write only, no git writes, no baselines, HEAD-variant blobs for
files carrying other lanes' hunks, ONE tsc per application as oracle filtered to touched files, manual-pick list for
files whose block only exists in yesterday's uncommitted pile).

## dashboard (feature landed `56b01cb75d`)

`DashboardApp`/`SavedViewApi` → `DashboardApi` (`@langwatch/dashboard-contract`), saved views are operations on it
(`listSavedViews`, `createSavedView`, `deleteSavedView`, `renameSavedView`, `reorderSavedViews`); `installApiDashboard({
infrastructure, peers: { analytics, automation, projects }, ports })` in `apps/api/src/features/dashboard/dashboard.composition.ts`
returns `{ app, routers(mount) → { dashboards, graphs, savedViews, savedWorkbenchCharts } }`; `mountDashboardRest({
dashboard, credential })` in `dashboard-rest.mount.ts` returns both REST families (`/api/dashboards`, `/api/graphs`).
`saved-view.composition.ts`/`.types.ts` and the refusing twin are gone; `createDashboardsRestApp`, `createGraphsRestApp`,
`PostgresDashboardAdapter`, `WorkbenchAwareGraphVisibilityAdapter`, `AnalyticsSavedWorkbenchChartPolicyAdapter`,
`SavedWorkbenchChartErrorsAdapter`, `DashboardGraphAlertLookup`, `GraphTrpcPorts`, `SavedWorkbenchChartTrpcPorts`,
`createGraphTrpcRouter`, `createSavedWorkbenchChartTrpcRouter` no longer exist in `@langwatch/dashboard-server`.

- `apps/api/src/index.ts`: replace the `composeSavedViewFeature`/`refusingSavedViewFeature`/`ComposedSavedViewFeature`
  exports with `installApiDashboard`, `ComposedDashboardFeature`, `DashboardPeers`, `DashboardProcessPorts`; replace
  the two `@langwatch/dashboard-server` REST factory exports with `mountDashboardRest`.
- `apps/api/src/app/api-production.composition.ts`: import `installApiDashboard`; `ComposedDashboardFeature | undefined`
  field; where `refusingSavedViewFeature()` sat, install or leave undefined (no twin); `dashboard: this.composedAnalytics.dashboard`
  and `dashboard: () => analyticsFeature.dashboard` read the dashboard feature's `app` instead; join the
  no-refusing-twin guard.
- `apps/api/src/app-trpc/app-trpc.composed.ts`: `savedView: ComposedSavedViewFeature` → `dashboard: ComposedDashboardFeature`.
- `apps/api/src/app-trpc/app-trpc.context.ts`: `dashboard: DashboardApp` → `DashboardApi` (contract import).
- `apps/api/src/app-trpc/app-trpc.features.ts`: `createDashboardTrpcRouter(mount.runtime)`; call `composed.dashboard.routers(mount)`
  once and take `savedViews`, `graphs`, `savedWorkbenchCharts` (the last replaces analytics' own) from it.
- `apps/api/src/app-rest/app-rest.packaged-families.ts`: `mountDashboardRest({ dashboard, credential: security })` for
  both families; `dashboard?: (() => DashboardApi) | undefined`; `platformUrl` no longer passed (links are an operation).
- `apps/api/src/app-rest/app-rest.process-features.ts`: `DashboardApp` → `DashboardApi`; `dashboard: langWatchQL.dashboard` → the feature's `app`.
- `apps/api/src/features/analytics/*`: analytics no longer composes dashboard — drop the `DashboardApp.create` block and
  the adapters named above from `analytics.composition.ts`, `dashboard: DashboardApp` from `analytics.composition.types.ts`,
  the graph/saved-chart namespaces from `analytics-trpc.routers.ts` (they come from the dashboard mount now), and the
  `SavedWorkbenchChartErrorsAdapter` + `as unknown as SavedWorkbenchChartRestService` cast from `langwatch-ql-rest.mount.ts`
  (the saved-chart REST family calls `DashboardApi` directly).
- Test doubles naming `refusingSavedViewFeature`/`composeSavedViewFeature`: `api-trpc-record.test-doubles.ts`,
  `app-trpc/__tests__/support/app-trpc-features.ts`, `gateway.composition.integration.test.ts`, `trace.composition.integration.test.ts`.

Follow-ups outside this lane: five `@scenario` titles over 100 columns in `specs/analytics/lwql-saved-charts.feature` /
`lwql-langy-authoring.feature` (shorten spec and tests together); the REST scope carries only the project id, so
`getDashboardLinks` exists — delete it if the runtime ever hands the slug to a REST handler.

## platform-health — pending lane report

## role — pending lane report

## suite REST — pending lane report
