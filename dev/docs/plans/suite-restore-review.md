# Suite restore review

Review of the work that restores three behaviours `origin/main` has and
`feat/strict-feature-layout-v0` lost: `SuiteService.runPlan` (find-or-create a
run plan by name), the resolved simulation models stamped on queued runs, and
the `personalDashboard` merge into `user.*`.

**Verdict then:** approve with fixes. **Audited 2026-09-03 against the working
tree:** the two blocking fixes landed; six of the ordinary ones are still open,
one is deferred by decision, and one landed only half-way.

**Updated 2026-09-04:** fixes 3, 4, 5, 6, 7, 8, 9 and 11 are landed, each with
its own test. Decision 5 (`/api/v1/run-plans*` and `/api/v1/test-suites*`) is
resolved as option (a) — both families are built. See "Landed 2026-09-04"
below. Fix 10 (comment-block sweep) is still deferred to the C-slice pass; the
22 `@integration` scenarios still need the Postgres-backed repository suite
described below.

## Landed — `f725772083` (suite half) and `3edf367d5a` (the `user:` merge)

- **Fix 1.** `services/suite-run-models.resolver.ts` is now
  `services/suite-run-models.service.ts`, which is what
  `feature-source-layout` demands (`SERVER_PATTERNS` admits only
  `services/<name>.service.ts`). `pnpm lint` is no longer red on it.
- **Fix 2.** `suite.service.ts` calls
  `scenarios.resolveRunParametersForScenarios` (`:353`) **before**
  `repository.findOrCreatePlanByName` (`:358`), so a run refused for a missing
  secret no longer creates or overwrites the plan. That is what
  `specs/suites/run-plan-identity-by-name.feature:270-289` and the method's own
  doc promise.
- **The `user:` merge.** `app-trpc.features.ts` merges
  `createUserTrpcRouter(...)` with `governance.personalDashboard` via
  `mount.root.mergeRouters`. The two routers share no procedure name, so
  `mergeRouters` has nothing to throw on. Approved as it stands.
- The advisory-lock find-or-create, the `sortSuiteTargets` call and the
  `scheduleRun` model stamping are faithful to main and unchanged.

## Landed 2026-09-04

**Fix 4 — server-side default plan naming.** Landed with the REST mount below.
`suiteRunPlanInputSchema.name` (`contract/src/suite.ts:186`) is now
`.optional()` — the tRPC door keeps its own `min(1)`, per decision 4(a).
`SuiteService.runPlan` (`services/suite.service.ts`) derives a name via a new
private `defaultPlanName`/`scopeLabel`/`testSuiteScopeLabel`/`caseScopeLabel`/
`resolveTargetNames` chain, built from the contract's `derivePlanName` and
`targetLabels`, only when the caller sends none. Deviation from main: the
derived target labels carry no connected-agent environment or owner suffix —
`AgentService.getNamesByIds` (a package this task may not edit) exposes only
`{id, name}`, not the environment/owner metadata main's richer name read.
Covered by two new unit tests in `suite-run-plan.unit.test.ts` and bound to
`specs/suites/run-plan-identity-by-name.feature`'s "A run started with no name
is named after its scope and targets".

**Decision 5 — `/api/v1/run-plans*` and `/api/v1/test-suites*`: resolved (a),
build both.** Both families are lifted onto the existing `SuiteApp`/
`SuiteService`, in the branch's Hono style (`describeRoute`/`resolver`,
thrown `HandledError`s serialized by the family's own boundary rather than
manual `try`/`catch`):
`packages/features/suite/server/src/transport/api-rest/run-plans-v1.api.ts`,
`test-suites-v1.api.ts`, and the shared wire schemas in `suite-wire-v1.ts`
(lifted from main's `app/api/shared/suite-wire.ts`, field-for-field checked
against the frozen `openapi-document.json`). Mounted in
`apps/api/src/app-rest/app-rest.packaged-families.ts` beside the deprecated
`/api/suites` alias, reusing the SAME `services.suites` accessor — no change
was needed in `api-production.composition.ts` or the tRPC-flatten lane.
`"run-plans"` and `"test-suites"` were added to `ApiPackagedRestFamilyName`
and to the membership table in
`apps/api/src/app-rest/__tests__/api-rest.packaged-families.integration.test.ts`.
`includeArchived` (documented on both list endpoints) required threading an
optional `includeArchived?: boolean` through `SuiteRepository.list` /
`PrismaSuiteRepository.list` and `ScenarioRepository.findTestSuites` /
`PrismaScenarioRepository.findTestSuites` (all additive). The test suite
detail read (`GET /api/v1/test-suites/:id`) needed a new
`SuiteApp.resolveActiveScenarioNames`, since nothing on the branch named the
active, non-archived scenarios filed in a test suite. Fix 7's
`ScenarioService.getModelChoices` (see below) is unrelated to this REST work
but landed in the same session.

**Fix 3 — the `cli-ephemeral` exclusion.** Landed:
`prisma.suite.repository.ts`'s `findOrCreatePlanByName` now carries
`NOT: { labels: { has: CLI_EPHEMERAL_LABEL } }`, using the constant already in
the contract.

**Fix 5 / Fix 11 — `repeatCount` drift and the door's duplicate schema.**
Landed together: the tRPC door's `runPlanConfigSchema`
(`transport/api-trpc/suite.schemas.ts`) now `.extend()`s the contract's
`runPlanConfigSchema` with the tighter `modelOverrideSchema` for
`simulatorModel`/`judgeModel`, rather than re-declaring the whole shape — so
`repeatCount`'s cap can never drift from `MAX_REPEAT_COUNT` again.

**Fix 6 — the lock key.** Landed: `findOrCreatePlanByName` now builds the lock
key from `PLAN_NAME_LOCK_PREFIX` + `planNameKey(name)` and hashes it with
`hashtextextended(…, 0)`, matching main, with `timeout`/`maxWait` carried on
the transaction.

**Fix 7 — N+1 on the model resolve.** Landed via a new
`ScenarioService.getModelChoices({ ids, projectId })` (batched `findMany` in
`PrismaScenarioRepository.findModelChoices`), replacing
`suite-run-models.service.ts`'s per-scenario `tryGetById` loop with one call.
Covered by a new `suite-run-models.unit.test.ts` asserting exactly one call.

**Fix 8 — the two "refuses before touching the plan row" tests.** Landed:
`buildService` now spies on `findOrCreatePlanByName` and both tests assert
zero calls; the second test now covers an empty dynamic scope
(`SuiteScopeEmptyError`) instead of archived scenarios, and both carry
`@scenario` tags.

**Fix 9 — `normalizePlanScope`.** Landed: `SuiteService.runPlan` calls a new
private `normalizeScope`, which reads `scenarios.listTestSuites` only for a
`test_suites`-mode scope and calls `normalizePlanScope`. The three `@unit`
scenarios are bound in `contract/src/__tests__/plan-config.unit.test.ts`.

## Open fixes

**Fix 10 — comment blocks at or over five lines.** The R1 threshold change
(`793dcd22c4`) now fails these at the gate rather than leaving them to a
review pass, so they are fixed by the C-slice sweep for this root rather than
by hand here. Files the review listed:
`suite.repository.ts`, `suite-execution.service.ts`, `suite.service.ts`,
`transport/api-trpc/suite.{api,schemas}.ts`, `contract/src/suite.ts`,
`contract/src/suite.service.ts`, `app/suite.app.ts`.

## The 19 unbound integration scenarios

`specs/suites/run-plan-identity-by-name.feature` reads 17/36 bound as of
2026-09-04 (up from 11/36 — fixes 8 and 9 above bound five, the new default-
naming test bound one). The 19 remaining `@integration` scenarios need a
Postgres-backed test, which is what the
existing test header correctly calls a repository concern. The harness that
exists for this in feature packages is the one
`packages/features/dashboard/server/src/repositories/prisma/__tests__/dashboard-grid.persistence.integration.test.ts`
uses: a real `PrismaClient` from `@langwatch/prisma-client`
(`PrismaConnectionService` + `PrismaConfigService`, a permissive
`PrismaQueryGuard`), `cleanupTestRows` from `@langwatch/test-harness`, driven
by `LANGWATCH_TEST_DATABASE_URL` natively. The file would be
`packages/features/suite/server/src/repositories/prisma/__tests__/prisma.suite.repository.integration.test.ts`,
constructing `PrismaSuiteRepository` and, for the service-level scenarios,
`SuiteService` over it with in-memory `ScenarioService`/`AgentService` fakes;
the concurrency scenario is `Promise.all` of four `runPlan` calls and one
`count` afterwards. `packages/features/suite/server` has no `vitest.config.ts`
(its `test` script is a bare `vitest run`), so that change also adds one
naming the datastore, which CLAUDE.md requires of any package whose tests
reach Postgres.

## Pre-existing, since closed

`resolveDynamicRunMembership` used to lock `WHERE kind = 'custom'` and then
read `kind: "run_plan"`, so its `FOR UPDATE` matched nothing. Fixed in the
bug-hunt verification pass (`restructure-bug-hunt-2026-09-03.md` item 5): the
row lock is now by id and projectId alone, with the reason recorded in the
repository at `prisma.suite.repository.ts:90-93`.
