# Suite restore review

Review of the work that restores three behaviours `origin/main` has and
`feat/strict-feature-layout-v0` lost: `SuiteService.runPlan` (find-or-create a
run plan by name), the resolved simulation models stamped on queued runs, and
the `personalDashboard` merge into `user.*`.

**Verdict then:** approve with fixes. **Audited 2026-09-03 against the working
tree:** the two blocking fixes landed; six of the ordinary ones are still open,
one is deferred by decision, and one landed only half-way.

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

## Deferred by decision

**Fix 4 — server-side default plan naming.** `name` stays required on
`suiteRunPlanInputSchema` (`contract/src/suite.ts:186`,
`z.string().trim().min(1).max(MAX_PLAN_NAME_LENGTH)`) until the by-name REST
route `POST /api/v1/run-plans/run` is on the branch. That route is the only
path on which the CLI omits the name
(`sdks/typescript/src/cli/commands/run-plans/run.ts:20,60`, whose own doc says
"no name lets the platform derive one"), so nothing on the branch reaches the
gap today — but the day the route mounts, the published CLI sends bodies with
no name and gets a 400.

This is **not** dead code. The pieces are already in the contract:
`derivePlanName` (`contract/src/plan-name.ts:29`) and `targetLabels`
(`contract/src/target-key.ts:305`). Restore main's `defaultPlanName` (scope
label + target labels) in the same change that mounts the route. Recorded as
decision 4 in `open-decisions-2026-09-03.md`.

## Open fixes

**Fix 3 — the `cli-ephemeral` exclusion is half-landed.**
`CLI_EPHEMERAL_LABEL = "cli-ephemeral"` was added at
`packages/features/suite/contract/src/suite.ts:22` and **has no consumer**.
`prisma.suite.repository.ts:196-203`'s `findFirst` where-clause still lacks
main's `NOT: { labels: { has: "cli-ephemeral" } }`
(`suite.repository.ts:243` on main). Nothing on main writes the label any
more, so it is a data-shape guard: rows written by older CLIs still sit in
production, and a person who names a run "CLI run" would join one. The spec
keeps the scenario (`specs/suites/run-plan-identity-by-name.feature:87`). One
`NOT` clause, using the constant that is already there.

**Fix 5 — `repeatCount` drift.**
`transport/api-trpc/suite.schemas.ts:73` still caps `repeatCount` at 100 while
the contract's `runPlanConfigSchema` caps at `MAX_REPEAT_COUNT` = 5
(`contract/src/suite.ts:166`) and the service re-parses with
`suiteRunPlanInputSchema.parse`. A `repeatCount` of 6–100 passes the door and
throws a `ZodError` in the service, which the boundary reports as an unknown
error. Import `MAX_REPEAT_COUNT` from `@langwatch/suite-contract` (as main's
`suite.router.ts:224` did), or drop the local `runPlanConfigSchema` and use the
contract's. The pre-existing `createSuiteSchema`/`updateSuiteSchema`
`max(100)` lines have the same drift and are out of scope.

**Fix 6 — the lock key is still hand-rolled.**
`prisma.suite.repository.ts:193` builds
`suite-plan-name:${projectId}:${name.trim().toLowerCase()}` and hashes it with
`hashtext`; main used `run-plan-name:${projectId}:${planNameKey(name)}` with
`hashtextextended(…, 0)`. `planNameKey` exists on the branch
(`contract/src/plan-name.ts:48`) and is what the spec calls "one definition"
for the match and the lock. During a rolling deploy the old and new pods take
different keys for the same name, so the two-writers case the lock exists for
is open for the length of the rollout. Carry main's `timeout:
PLAN_NAME_TXN_TIMEOUT_MS` on the transaction while you are there.

**Fix 7 — N+1 on the model resolve.** `suite-run-models.service.ts` still
reads scenarios one `tryGetById` at a time where main did one `findMany`. A
200-scenario `all` plan is 200 round trips at queue time. `ScenarioRunConfig`
does not carry the model fields, so the fix is a batch read on
`ScenarioService` — a `getModelChoices({ ids, projectId })` returning
`{ id, simulatorModel, judgeModel }[]` (no such method exists anywhere today),
or add the two fields to `getRunConfigs` and pass the configs the service
already fetched.

**Fix 8 — two tests promise what they do not verify.**
`services/__tests__/suite-run-plan.unit.test.ts:132` and `:148` are both
titled "refuses before touching the plan row" and both assert only
`rejects.toThrow`. Record calls to `findOrCreatePlanByName` in `buildService`
and assert the count is 0 in both. Only then tag them
`/** @scenario "A run refused for naming no target creates no plan" */` and
`/** @scenario "A run refused for covering no scenario creates no plan" */`,
and only if the second test uses an empty dynamic scope
(`SuiteScopeEmptyError`) — it currently tests archived scenarios.

**Fix 9 — `normalizePlanScope` is restored and unwired.** The function exists
at `packages/features/suite/contract/src/plan-config.ts:157` and **nothing
calls it and no test names it**. `suite.service.ts` does not normalise the
scope, so the three `@unit` scenarios at
`specs/suites/run-plan-identity-by-name.feature:170,176,182` are still unbound.
Call it from `runPlan` over `scenarios.listTestSuites` and bind the three
scenarios in a contract unit test.

**Fix 11 — the door re-declares the contract's schema.**
`suite.schemas.ts:70-78` duplicates `runPlanConfigSchema` with
`modelOverrideSchema` in place of `z.string()` and without `.strict()`. If the
tighter model check is wanted at the door, extend the contract schema rather
than re-declaring it. Lands naturally with fix 5.

**Fix 10 — comment blocks at or over five lines.** The R1 threshold change
(`793dcd22c4`) now fails these at the gate rather than leaving them to a
review pass, so they are fixed by the C-slice sweep for this root rather than
by hand here. Files the review listed:
`suite.repository.ts`, `suite-execution.service.ts`, `suite.service.ts`,
`transport/api-trpc/suite.{api,schemas}.ts`, `contract/src/suite.ts`,
`contract/src/suite.service.ts`, `app/suite.app.ts`.

## The 22 unbound integration scenarios

`specs/suites/run-plan-identity-by-name.feature` reads 11/36 bound. The 22
`@integration` scenarios need a Postgres-backed test, which is what the
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
