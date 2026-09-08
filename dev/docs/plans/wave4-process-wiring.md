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

## platform-health (feature landed; family was mounted nowhere before)

`installApiPlatformHealth({ apiKey: config.platformHealth.apiKey, probeApiKey: config.platformHealth.probeApiKey,
probes })` in `apps/api/src/features/platform-health/platform-health.composition.ts` returns `{ app, rest }`.
- `apps/api/src/app-rest/app-rest.process-features.ts`: `ApiProcessRestServices.platformHealth?: MountableRestApp | undefined`;
  after the `healthProbes` push, `if (services.platformHealth) features.push(services.platformHealth);`.
- `apps/api/src/app/api-production.composition.ts`: field `composedPlatformHealth: ComposedPlatformHealthFeature | undefined`;
  install in the async compose phase; extract the inline `healthProbes` expression (~lines 2031–2050) into
  `composeHealthProbes(): HealthProbeRestPorts | undefined` used by both doors; pass
  `...(this.composedPlatformHealth ? { platformHealth: this.composedPlatformHealth.rest } : {})` to
  `createApiProcessRestFeatures`. The OpenAPI checker will report two ADDED operations.

Runtime follow-ups (packages/api): a credential door that establishes no tenant scope (`credential: "internalSecret"`),
so a secret-guarded family is not published as `security: []` with a `public` policy; declared non-2xx success
statuses (`responds({ 200, 503 })`) so an unhealthy report is an answer, not an error-level log per poll.

## role (feature landed)

`RoleService` → `RoleApi`; `composeRoleFeature`/`refusingRoleFeature` → `await installApiRole({ infrastructure, peers: {
permissions: this.composedAuthz.app, organizations: this.composedOrganization.app, users: <UserApi> }, plans:
this.resolvePlanProvider(options) })` (async, not optional; the enclosing block is synchronous today).
`ComposedRoleFeature` is `{ app: RoleApi, routers(mount) → { role, roleBinding } }`; it no longer carries `authzApp`
(`authzApp: this.composedRole.authzApp` → `this.composedAuthz.app`) nor `roles` (`this.composedRole.roles` → `.app`).
- `apps/api/src/app-trpc/app-trpc.features.ts`: `roleBinding: createRoleBindingTrpcRouter(mount)` → `roleRouters.roleBinding`;
  `team: roleRouters.team` → the team router now belongs to organization: move `composeTeamPorts` +
  `createTeamTrpcRouter` (old body at `git show 7c2e9ec87e:apps/api/src/features/role/role.composition.ts` lines 174–214)
  beside the identical plan gate in `apps/api/src/features/organization/organization.composition.ts:341`.
- `apps/api/src/app-trpc/app-trpc.composed.ts:85-89`: drop the doc sentence about `ctx.app.authzApp` and the role service.
- `apps/api/src/index.ts:274`: delete `export { createRolesRestApp } from "@langwatch/role-server";`.
- `apps/api/src/app-rest/app-rest.packaged-families.ts:65-66,581-593`: the `roles` family entry and `RoleService` import go;
  the family returns when the organization door lands (`dev/docs/plans/api-rest-organization-door.md`) as
  `apps/api/src/features/role/role-rest.mount.ts` binding `roleRestFacts`.
- Test doubles calling `refusingRoleFeature()`: `app-trpc/__tests__/support/app-trpc-features.ts`,
  `app/__tests__/api-packaged-rest.usage-guard.integration.test.ts`, `app/__tests__/api-trpc-record.test-doubles.ts`,
  `features/gateway/__tests__/gateway.composition.integration.test.ts`.
- organization (other feature, type only): `RoleService` → `RoleApi` and `filterAssignable` → `filterAssignableRoles` in
  `rules/invite-contracts.rules.ts`, `services/invite-{acceptance,creation,team-assignment,}.service.ts`,
  `services/__tests__/support/invite-fakes.ts` (drop the `unsupported<…>` members that no longer exist),
  `apps/api/src/app/api-organization-invites.composition.ts`, `apps/api/src/features/organization/organization.composition.ts:88`.
- `apps/api/src/app-rest/__tests__/api-rest.roles-family.integration.test.ts` (11 scenarios) re-points when the REST mount lands.

Behaviour changes to know: custom-role create/update/assign used to answer 503 everywhere (no plan gate was ever
composed) and now work under the Enterprise gate; the data-scope refusal is 403 `permission_denied`, not 401; six
uncalled operations went, including `removeExclusiveApiKeyRoles` (api-key retirement; Kimi's lane may want it back).
Follow-up in authz web: `authz-api.ts` hand-writes the role maps → `ContractApiMap<typeof roleTrpc>`.

## suite REST — pending lane report
