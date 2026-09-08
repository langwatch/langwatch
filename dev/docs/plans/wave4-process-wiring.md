# Wave-4 process wiring: dashboard, then platform-health, role, suite REST, authz, user and evaluation

**Date:** 2026-09-08 · **Owner lane:** one Opus agent after the wave-3 lane (`882ebfa479`) · **Reviewed by:** Fable

Same rules as waves 1 to 3 (`strict-feature-layout.md` section 8: Read/Edit/Write only, no git writes, no baselines, HEAD-variant blobs for
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
  the family returns now that the organization door has landed (`5080220f88`, `strict-feature-layout.md` section 5) as
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

## suite (feature landed; REST families + web governed)

`installApiSuite({ prisma, peers: { scenarios, agents, prompts, projects }, infrastructure, rest: { credential, platformUrl,
errors } })` returns `{ app, routers(mount) → { suites }, rest: MountableRestApp[] }`; `mountSuiteRest` in
`apps/api/src/features/suite/suite-rest.mount.ts`.
- `apps/api/src/features/scenario/scenario.composition.ts`: replace the `SuiteApp.create({...})` block with the install
  (peers `scenarioApi`, `options.agents`, `promptApp`, `options.projects`; infrastructure `execution`,
  `resolveClickHouseClient`, `defaultRetentionDays`, `generateId`, optional `connectedPresence`; `database` gone);
  `scenario.composition.types.ts` `suites: SuiteApp` → `SuiteApi`; `refuse<SuiteApp>` → `refuse<SuiteApi>`.
- `apps/api/src/app-trpc/app-trpc.context.ts`: `SuiteApp` → `SuiteApi` (`@langwatch/suite-contract`).
- `apps/api/src/app-rest/app-rest.packaged-families.ts`: delete the `@langwatch/suite-server` import block (`SuiteApp`,
  `createRunPlansV1RestApp`, `createSuiteRestApp`, `createTestSuitesV1RestApp`), `suites?: (() => SuiteApp)` in
  `ApiPackagedRestServices`, the three family-name union members `"run-plans" | "suites" | "test-suites"`, and the three
  `mount(...)` calls.
- `apps/api/src/app/api-production.composition.ts`: `rest: { credential: (input) => this.composedHandlerCredentials.authenticate(input),
  platformUrl: <ports.platformUrl the packaged families used>, errors: ApiRestObservabilityComposition.create().legacyErrorHandler }`;
  beside the secret loop (~line 2368) `for (const suiteRestApp of this.composedSuite?.rest ?? []) rest.route("/", suiteRestApp);`.
- `apps/api/src/tasks/openapi-document/openapi-document.surface.ts` `mountProcessTailFamilies`: mount `mountSuiteRest({ suites:
  refuse("The suite application"), credential: refuse("The project credential door"), platformUrl: () => "", errors: refuseAtRuntime })`.
- Regenerate `apps/api/src/features/discovery/openapi-document.json` + `docs/api-reference/openapiLangWatch.json` once apps/api
  compiles: the alias family's operation ids become the declared names with version suffixes (`listSuites`, `listSuites_latest`, …).

## authz (transports landed `7540100bd5`; contract service, adapter, registry still open)

- `apps/api/src/app-trpc/app-trpc.features.ts:182`: `authz: createAuthzTrpcRouter(mount)` → `createAuthzTrpcRouter(mount.runtime)`.
- `apps/api/src/index.ts:273`: delete `export { createRoleBindingsRestApp } from "@langwatch/authz-server";`.
- `apps/api/src/app-rest/app-rest.packaged-families.ts:25,566-578`: the import and the `mount("role-bindings", …)` block go; the
  family returns as `apps/api/src/features/authz/authz-rest.mount.ts` binding `roleBindingRestFacts` once the organization
  door lands (the old check was `authz.hasApiKeyPermission` — an API-key-ceiling check the door must offer or the mount
  must perform through the AuthzApi peer).
- `apps/api/src/app-rest/__tests__/api-rest.role-bindings-family.integration.test.ts` re-points with the mount.

Queued lane (not wiring): **`AuthzService` → `AuthzApi`** across ~150 files / 356 references and `PostgresAuthzAdapter` →
repositories + registry with `installApiAuthz`/worker/tasks installers (`apps/api/src/app/api-authz.composition.ts:100`,
worker and tasks compositions, four harnesses). One lane with TS-LSP rename, run when no other lane is live (it touches
every feature). Blockers to decide first: `@langwatch/api` depends on `@langwatch/authz-contract` for the permission
vocabulary, so authz's contract cannot import `defineTrpcContract` without a package cycle (`authzTrpc` sits in the
server transport for now) — split the vocabulary out of authz-contract; `AuthzApi` has 54 operations (several
features wearing one door). `@langwatch/authz-web/surfaces/scope-picker` → `./scope-picker` has ~40 importers across
five feature webs plus tsconfig/vitest aliases (gateway, governance) — same lane.

## role REST mount (door landed `5080220f88`; declaration `cccfe396b0`)

- New `apps/api/src/app-rest/app-rest.process-features.ts` port beside `handlerManagedCredential` (~line 153):
  `export type ApiOrganizationDoorPort = (input: { request: Request; permission: AuthzPermission }) => Promise<Readonly<{
  organizationId: string; apiKeyId: string; userId: string | null; markUsed: () => void }>>;` built where `ApiRestSecurity`
  is built from `authenticateOrganizationThrowing` + `authorizeOrganizationPermissionThrowing` + the class-mismatch refusal
  (`apps/api/src/api-rest.security.ts:54-130`, all four errors already exist; it throws, never returns `{ ok }`).
- New `apps/api/src/features/role/role-rest.mount.ts`: `mountRoleRest({ roles, door, enterpriseGate, errors })` →
  `createRestRuntime({ identity: { authenticate: door → { actor: userId ? { type: "user", id } : null, scope: { tier:
  "organization", id: organizationId }, markUsed } } })`, a `WeakMap<Request, string>` carrying the organization to
  `facts: [bindRestMiddleware(roleRestFacts, ctx => ({ organizationId }))]` (suite's mount is the pattern), `middleware:
  [enterpriseGate]`, `onError: errors`. Mount it where `app-rest.packaged-families.ts` used to mount `roles`; re-point
  `api-rest.roles-family.integration.test.ts`; bind the `@unimplemented` scenario "A project key presented to an
  organization route is refused with the body the family already publishes" in `packages/api/specs/transport-declaration-split.feature`
  from that test. authz's `authzRoleBindingRest` mounts the same way once its declaration gains `.withCredential("organizationKey")`
  and its API-key-ceiling check is answered by the door port (`hasApiKeyPermission`).

## user (repositories, twins and flat screens landed; transports and adapter open)

- `apps/api/src/app/api-production.composition.ts`: `composePersonFeatures` becomes `async … Promise<void>` (line ~3202),
  awaited at ~1055; `this.composedUser = await composeUserFeature({...})` (~3241); drop the dead `peers.users: session.users`.
- `apps/api/src/app-trpc/app-trpc.context.ts:211`: `users: UserApp` → `UserApi` (`@langwatch/user-contract`), drop the
  `UserApp` import.
- `apps/api/src/features/organization/__tests__/person-features.composition.integration.test.ts:156`: await the compose.
- `apps/worker/src/app/worker-user-app.composition.ts:132`: `.withFeature(userServer, { infrastructure: { credentialIssuer,
  avatarStorage, passwords } })` (`database` gone; `passwords: UserPasswordHasherPort` new — lift `BcryptPasswordHasher` from
  `apps/api/src/features/user/user.composition.ts` into a module both processes import).
- oxlint baseline keys for `web/src/screens/personal-workspace/*.screen.tsx` re-key to `web/src/ui/sections/personal-workspace/`
  (root session, after lint L2).

tRPC runtime gaps user's `user.*` family needs (round-three runtime brief): an anonymous procedure access kind (`register`),
the browser session's row id on the Actor or as a fact (`otherSessionsToRevoke`), the caller's address as a fact (register
throttle). The session's email and name are NOT gaps for user: the app reads its own row by `actor.id`. Also open: Better
Auth's directory is typed `UserService` and calls `tryFindByEmail`/`create`/`createPasskeyUser` (`api-auth.composition.ts:204`)
— decide whether it becomes `UserApi` operations or an auth-owned port; `GdprUserDataEraseRepository` walks other features'
tables (tasks catalogue) and is not a user repository.


## evaluation (door landed `ccf912e810`; legacy REST family still on the deleted builders)

- `apps/api/src/app/api-production.composition.ts:127-130`: import `installApiEvaluation` in place of `composeEvaluationFeature`
  and `refusingEvaluationFeature`. Line ~4326 `this.composedEvaluation = refusingEvaluationFeature()` goes with its branch: a
  process installs the feature or leaves `composedEvaluation` unset. Line ~4389 becomes
  `this.composedEvaluation = await installApiEvaluation({ infrastructure, peers: { workflows, traces, modelProviders },
  collaborators: { runTraceEvaluation: (input) => this.requireEvaluatorExecution().runEvaluationForTrace(input),
  probeEvaluatorRuntime, trackEvaluationRan, environment }, processName, eventing, resolveClickHouse, dataRetention })`.
  `runEvaluationForTrace` no longer takes a `ctx` first argument; the probe and the analytics callback are required.
  `~1420`/`~1458` (`evaluation: this.composedEvaluation`, `evaluations: this.composedEvaluation.app`) and `~2116`/`~4419`
  (`reportEvaluation`) stand; `.app` is now the whole `EvaluationApi`.
- `apps/api/src/app-trpc/app-trpc.features.ts:201`: `evaluations: composed.evaluation.router(mount)` →
  `...composed.evaluation.routers(mount)`.
- `apps/api/src/app-trpc/app-trpc.context.ts:80`: `evaluations: Readonly<{ reportEvaluation(...) }>` → `evaluations: EvaluationApi`
  (`@langwatch/evaluation-contract`).
- `apps/api/src/app/api-evaluator-execution.composition.ts:20`: `type EvaluationRunOutcome` now comes from
  `@langwatch/evaluation-contract`.
- `apps/worker/src/app/worker-evaluation-execution.composition.ts:14,86`: `PrismaEvaluationCostRecorderAdapter.create(database)`
  → `EvaluationCostService.create({ repository: repositories.costs })`, with `worker-evaluation-server.composition.ts:130`
  gaining `.withRepositories(evaluationRepositories)`. That file's `workerEvaluationApp` declares a second app for the
  `EvaluationApi` token and returns an `EvaluationService`, which no longer satisfies the four new operations: the end state
  boots `evaluationServer` with worker-side infrastructure instead.
- Test doubles building the refusing twin: `apps/api/src/app/__tests__/api-trpc-record.test-doubles.ts:290`,
  `apps/api/src/features/gateway/__tests__/gateway.composition.integration.test.ts:236`,
  `apps/api/src/app-trpc/__tests__/support/app-trpc-features.ts:202` → an `EvaluationApi` fixture and a `routers` that
  mounts nothing. `api-experiment-run.composition.integration.test.ts:321` and
  `workflow/__tests__/execution-features.composition.integration.test.ts:366`: `await installApiEvaluation(...)`.
- `EvaluationService` → `EvaluationApi` (type position, verbatim) in `apps/api/src/app/{api-trace-read-stack,api-evaluation-read}.composition.ts`,
  `apps/worker/src/app/worker-report-schedule.composition.ts`, `packages/features/monitor/server/src/app/monitor.app.ts`,
  `packages/features/trace/server/src/services/{trace-list-read,trace-legacy-read}.service.ts` and their tests;
  `automation-settlement-match-confirmation.service.unit.test.ts` `extends` it → `implements EvaluationApi`. That unblocks
  `contract-service` and the `tryGetRunByEvaluationId` → `findRunByEvaluationId`, `tryGetInputs` → `findInputs` renames
  (`trace-legacy-read.service.ts:338` calls the latter).
- Baseline rows to delete (root session, after lint L2): `evaluation/persistence-adapter`, `evaluation/refusing-composition`,
  `evaluation/testing-entry`, `evaluation/unregistered-repositories`.
- Not wave 4: the legacy REST family (`/api/evaluations/*`, `/api/guardrails/:evaluator/evaluate`, `/api/dataset/evaluate`) is
  bare-mounted with a `/api/v1` twin and no dated namespace. Neither `dated` nor `v1-only` fits; it needs the shared-prefix
  mode in `packages/api/specs/versioned-routing.feature` (round three). Its evaluate doors answer `400 { error }` from an
  in-handler parse and write raw bodies; `observePayloadSize` and `reportError` are ports no process supplies and should be
  deleted, not ported.

## stored-object (door landed; `/api/files` byte family still on the deleted builders)

- `apps/api/src/app/api-production.composition.ts:175-180`: import `installApiStoredObject` in place of `composeStoredObjectFeature`
  and `refusingStoredObjectFeature` (keep `DeferredPayloadStagingAdapter`, `LoggedApiStoredObjectAbsence`). Line ~1201
  `this.composedStoredObject = await this.installStoredObject(options)`; the method (~3294) becomes `async`, uses
  `this.requireDatabase().connection`, calls `await installApiStoredObject({...same arguments...})`, and the
  `if (!database) return refusingStoredObjectFeature()` guard goes: the `service_unavailable` refusal now comes from
  `ApiStoredObjectsClickHouse.resolveClient` when no ClickHouse connection was composed.
- Four doubles building the refusing twin: `apps/api/src/app/__tests__/api-trpc-record.test-doubles.ts:294`,
  `apps/api/src/app/__tests__/api-packaged-rest.usage-guard.integration.test.ts:48`,
  `apps/api/src/app-trpc/__tests__/support/app-trpc-features.ts:188`,
  `apps/api/src/features/gateway/__tests__/gateway.composition.integration.test.ts:43,222` → a booted memory installation
  (`installation().boot({ role: "api" })` over `withPersistence("memory", {})`, as
  `packages/features/stored-object/server/src/app/__tests__/stored-object-installation.unit.test.ts` does).
- New binding: `mountStoredObjectRest({ storedObjects: () => this.composedStoredObject.restServices.storedObjects(), credential })`
  from `apps/api/src/features/stored-object/stored-object-rest.mount.ts`. It publishes
  `/api/stored-objects/2026-08-22/storedObjects.{confirmUpload,get,delete}` and the dated twins; the deleted family was
  mounted nowhere, so an unmounted door regresses nothing, but mount it.
- `apps/tasks/src/platform/object-storage-migrate.composition.ts:4,59-63`: `PostgresObjectStorageMigrationInventoryAdapter` is
  deleted; the tasks process implements `ObjectStorageMigrationInventoryPort` (from `@langwatch/stored-object-server`) itself.
  The stored-object lane's report (`/Users/afr/.claude/jobs/eeb488e6/tmp` task a7de211afcf583b9e) carries the verbatim
  Prisma paging code for `listProjectsPage`, `listStoredObjectsPage`, `listDatasetsPage`. This file is in the 09-07 pile.
- `apps/api/src/app-rest/app-rest.packaged-families.ts:82,465-479` still builds the `/api/files` family from
  `createFilesRestApp`; that family cannot move until the runtime has raw responses, a HEAD twin and an in-handler owner
  resolution (round three). Leave it.
- Baseline rows removed by the root session: six `stored-object|*`; `legacy-transport-runtime` and `nested-transport` stay
  for `/api/files`.
- `StoredObjectApi.readById`, `resolveOwner` and `StoredObjectFileReadPort.tryGetById` keep their HEAD names until the user
  feature's process adapters (`apps/api/src/features/user/user-avatar-{objects,storage}.adapter.ts`) are in a lane.
