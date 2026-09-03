# Suite restore review

Review of the uncommitted work that restores three behaviours `origin/main` has
and `feat/strict-feature-layout-v0` lost: `SuiteService.runPlan` (find-or-create
a run plan by name), the resolved simulation models stamped on queued runs, and
the `personalDashboard` merge into `user.*`.

Compared against `origin/main`:
`platform/app/src/server/suites/suite.service.ts` (`runPlan`, `prepareRun`,
`resolvePlanByName`, `defaultPlanName`), `suite.repository.ts`
(`findPlanByName`), `plan-name-lock.ts`,
`platform/app/src/server/scenarios/run-models.resolver.ts`,
`platform/app/src/server/api/routers/suites/suite.router.ts`,
`platform/app/src/app/api/run-plans/[[...route]]/app.ts`,
`platform/app/src/app/api/shared/suite-wire.ts` and
`sdks/typescript/src/cli/commands/run-plans/run.ts`.

Tests run: `pnpm --filter @langwatch/suite-server test` (8 files, 61 passed),
`pnpm --filter @langwatch/suite-contract test` (9 files, 78 passed),
`pnpm --filter @langwatch/architecture-lint check:feature-parity` (see the
binding section).

## Verdict: approve with fixes

The shape is right: the contract gains `runPlan`, the service orchestrates and
the repository owns the locked find-or-create, the resolver calls services and
not repositories, the tRPC procedure delegates to `SuiteApp`, the `user:` merge
is correct. Fixes 1 to 4 must land before the commit; 1 fails `pnpm lint`, 2
breaks a spec scenario main honoured, 3 and 4 are claims of "dead" that the
CLI in this repo contradicts. The rest are fixes of the ordinary kind.

## Faithful lift?

Partly. What main's `runPlan` does, in order, and where the branch stands:

| main (`suite.service.ts:1248-1350`, `prepareRun` `:975-1055`) | branch (`services/suite.service.ts:264-348`) |
| --- | --- |
| `readRequestedPlanName`: name optional, blank-only refused | name required at the contract (`z.string().trim().min(1)`); no derivation |
| `normalizePlanScope`: every suite hand-picked collapses to `all` | dropped |
| `sortSuiteTargets` | kept (`:268`) |
| `duplicateSuiteTargets` refused before any read | dropped |
| `resolveConnectedReferences` + `assertConnectedAgentsRunnable` | dropped (the branch's `run` never had them either; `assertConnectedAgentsRunnable` is exported from `connected-target.service.ts` but not called here) |
| `declaredDefaults` + `withCanonicalOverrides`, second duplicate check | dropped |
| `resolveParametersPerTarget` (secret values) BEFORE the plan row is touched | runs inside `SuiteExecutionService.execute` (`suite-execution.service.ts:141-151`), AFTER `findOrCreatePlanByName` (`suite.service.ts:311`) |
| `defaultPlanName` when the caller sent none | dropped, called "dead" |
| repository `findPlanByName` excludes `labels has cli-ephemeral` | dropped, called "dead" |
| `resolvePlanByName` under `withPlanNameLock`, retry on unique violation | kept, moved into the repository (`prisma.suite.repository.ts:167-247`) |
| `scheduleRun` with `simulatorModel`/`judgeModel` from the plan row | kept (`:345-346`) |

The lift-and-shift ruling (move keeping shape, redesign only at seams) covers
"drop what the branch's `run` never had" for the connected-agent and
canonical-override work: that machinery lives in the scenario/agent packages
and is a separate restoration. It does not cover the four rows marked in bold
below, which are this feature's own contract and are cheap.

### "Server-side default plan naming is dead" is false

The agent's reasoning was "the one web caller sends a name". That is true of
tRPC on both main and the branch (`suite.router.ts:219` on main also requires
`min(1)`), and irrelevant: the callers that omit the name are not web.

- `sdks/typescript/src/cli/commands/run-plans/run.ts:20,31-35,60` on main AND
  on this branch: `name?: string`, doc says "no name lets the platform derive
  one from the scope and the targets", body spreads
  `...(options.name ? { name } : {})`.
- `sdks/typescript/src/client-sdk/services/run-plans/run-plans-api.service.ts:23-25`
  on this branch: `RunPlanRunBody` is the OpenAPI type of
  `POST /api/v1/run-plans/run`, whose main definition
  (`suite-wire.ts:141-152`) has `name ... .optional()` with the description
  "Leave it out and the name is derived".
- `mcp/typescript/src/langwatch-api-run-plans.ts:119` posts to the same route.
- main's `runTestSuite` and `runScenario` (`suite.service.ts:1367-1470`) call
  `runPlan` with `name` optional and rely on the derivation.

The by-name REST route (`POST /run`) does not exist on the branch yet
(`transport/api-rest/suite.api.ts` has `POST /`, `/:id/duplicate`, `/:id/run`
only), so nothing on the branch reaches the gap today. That makes the naming
"not yet wired", not "dead": the day the REST route is restored, the published
CLI will send bodies without a name and get a 400 from a contract that says
`min(1)`. The contract already carries the pieces: `derivePlanName`
(`packages/features/suite/contract/src/plan-name.ts:29`) and `targetLabels`
(`target-key.ts:305`).

### "The `cli-ephemeral` exclusion is dead" is false in the way that matters

Nothing on main writes the label any more (only
`platform/app/src/server/suites/constants.ts:27` defines it and
`suite.repository.ts:243` reads it), so it is a data-shape guard: rows written
by older CLIs still sit in production, and a person who names a run "CLI run"
would join one. The spec keeps the scenario
(`specs/suites/run-plan-identity-by-name.feature:87`). It is one `NOT` clause
in the `where` at `prisma.suite.repository.ts:192-197`; dropping it changes
main's matching semantics for no saving.

## Advisory-lock find-or-create versus main

Semantically the same, with three small drifts:

- Key: branch `suite-plan-name:${projectId}:${name.trim().toLowerCase()}`
  hashed with `hashtext` (`prisma.suite.repository.ts:188-189`); main
  `run-plan-name:${projectId}:${planNameKey(name)}` hashed with
  `hashtextextended(.., 0)` (`plan-name-lock.ts:57`). `planNameKey` exists on
  the branch (`contract/src/plan-name.ts:48`) and is what the spec calls "one
  definition" for the match and the lock. During a rolling deploy the old and
  new pods take different keys for the same name, so the two-writers case the
  lock exists for is open for the length of the rollout. Reuse main's prefix
  and `planNameKey`.
- Match: `kind: "run_plan"`, `archivedAt: null`, `name equals insensitive`,
  same `orderBy` triple as main (`:190-199`). Missing the `cli-ephemeral`
  `NOT` (above).
- Update on match writes `storedConfig` only, never `name`/`slug` (`:201-206`),
  which is the rename-trap rule. Create uses `nextAvailableSlug` over a
  `startsWith` read (`:209-233`), retried once as a whole transaction on a
  unique violation (`:239-246`), identical to main's `:1720-1730`.
- main's transaction carries `timeout: PLAN_NAME_TXN_TIMEOUT_MS` so a lock
  waiter cannot hang on the interactive transaction budget; the branch's
  `$transaction` takes the default. Minor; note it or carry it over.

`resolveScopeMembership` (`:138-165`) is a faithful copy of the query in
`resolveDynamicRunMembership` minus the row lock, which is correct: there is no
row yet. Aside, pre-existing and not this change's: `resolveDynamicRunMembership`
locks `WHERE kind = 'custom'` (`:83-91`) and then reads `kind: "run_plan"`, so
the `FOR UPDATE` matches nothing.

## Layer and grammar

- `services/suite-run-models.resolver.ts` is refused by
  `feature-source-layout`: `SERVER_PATTERNS` admits only
  `services/<name>.service.ts` (`packages/architecture-lint/src/feature-layout.ts:69`),
  and `packages/features/suite/feature.json` is `layoutVersion: 0`, so
  `lintServer` runs on it (`:661-666`) and emits "Server source path ... is not
  part of strict layout version 0". `pnpm lint` is red with this file as named.
- Otherwise the resolver is in the right layer: it takes `ScenarioService` and
  `ModelProviderService` (contract services), not a repository or Prisma, and
  it is composed in the api process
  (`apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts:474-477`),
  which is the seam main used (`presets.ts:1472`).
- It does one `scenarios.tryGetById` per scenario (`:51`) where main did one
  `findMany` for the batch. A 200-scenario `all` plan is 200 round trips at
  queue time. `ScenarioRunConfig` does not carry the model fields
  (`scenario.ts:135-144`), so the fix is a batch read on `ScenarioService`
  (a `getModelChoices({ ids, projectId })`, or add the two fields to
  `getRunConfigs` and pass the configs the service already fetched).
- `prisma-containment` holds: `@langwatch/prisma-client/generated` is imported
  only in `repositories/prisma/prisma.suite.repository.ts`;
  `isUniqueConstraintError` comes from the package root, which is allowed
  everywhere (`prisma-boundaries.ts:8-9`).
- `suite/server/src/index.ts:24-27` exports the resolver factory and its type.
  `PRIVATE_SERVER_EXPORT` forbids only `projections|repositories|stores`, so
  lint accepts it, but the brief asks for adapter and service exports only and
  a bare factory function is neither. Once fix 1 makes it a service class the
  export is in bounds.
- tRPC schema drift: `transport/api-trpc/suite.schemas.ts:73` allows
  `repeatCount` up to 100 while the contract's `runPlanConfigSchema` caps at
  `MAX_REPEAT_COUNT` = 5 (`contract/src/suite.ts:72,158`) and the service
  re-parses with `suiteRunPlanInputSchema.parse` (`suite.service.ts:265`). A
  `repeatCount` of 6 to 100 passes the door and throws a `ZodError` in the
  service, which the boundary reports as an unknown error. main's procedure
  used `MAX_REPEAT_COUNT` (`suite.router.ts:224`). The pre-existing
  `createSuiteSchema`/`updateSuiteSchema` `max(100)` lines (`:34,:59`) have the
  same drift and are out of scope, but the new schema should not copy it.

## Comments five lines and over

House style here runs long, and the brief asks for under five. The added ones
at or over five:

- `services/suite-run-models.resolver.ts:1-16` (15 lines, file header)
- `repositories/suite.repository.ts:14-19` (6), `:34-46` (12)
- `services/suite-execution.service.ts:42-48` (7), `:65-70` (6), `:238-247` (9)
- `services/suite.service.ts:254-263` (9)
- `transport/api-trpc/suite.api.ts:159-169` (10)
- `transport/api-trpc/suite.schemas.ts:65-69` (5), `:80-85` (6)
- `contract/src/suite.ts:149-153` (5), `:166-171` (6)
- `contract/src/suite.service.ts:27-32` (6)
- `app/suite.app.ts:254-258` (5)

Under five and fine: `prisma.suite.repository.ts:235-238`,
`suite-execution.service.ts:190-191`, `suite-run-models.resolver.ts:63-64`.

## Tests and binding

`check:feature-parity`:

- `specs/scenarios/resolved-run-models-on-runs.feature`: 12/12 bound. The three
  `@scenario`-tagged tests in
  `services/__tests__/suite-execution-run-models.unit.test.ts` bind the three
  queue-side `@unit` scenarios and they read the queued command's reserved
  namespace, which is where the stamp lands, so they earn their place. The
  fourth test (no resolver composed) is untagged and is a real branch of the
  code (`resolveRunModels?.` at `:193`); keep it.
- `specs/suites/run-plan-identity-by-name.feature`: 11/36 bound, 25 unbound:
  22 `@integration` and 3 `@unit` (lines 170, 176, 182, the scope
  normalisation the branch dropped; they were bound on main by
  `normalizePlanScope`'s tests and are unbound now because the behaviour is
  gone, not because a tag is missing).

`services/__tests__/suite-run-plan.unit.test.ts` on `runPlan`: it covers the
one thing the service owns that the repository does not, the ordering
"validate, then write, then queue", plus the `created` flag passthrough. That
is a unit concern and it does not need a `@scenario` tag to be worth having.
Two problems: the two tests titled "refuses before touching the plan row"
(`:131`, `:147`) assert only `rejects.toThrow` and never check that
`findOrCreatePlanByName` was not called, so the title promises what the body
does not verify; and the ordering it does guard is only half of the spec's
"refused run leaves no plan" rule, because the secret-value refusal fires
after the write (fix 2).

The 22 `@integration` scenarios need a Postgres-backed test, which is what
"the name-matching and locking behaviour itself is a repository concern with
its own database" in the test header correctly says. The harness that exists
for this in feature packages is the one
`packages/features/dashboard/server/src/repositories/prisma/__tests__/dashboard-grid.persistence.integration.test.ts`
uses: a real `PrismaClient` from `@langwatch/prisma-client`
(`PrismaConnectionService` + `PrismaConfigService`, a permissive
`PrismaQueryGuard`), `cleanupTestRows` from `@langwatch/test-harness`, driven
by `LANGWATCH_TEST_DATABASE_URL` natively or testcontainers under `CI=1`. The
file would be
`packages/features/suite/server/src/repositories/prisma/__tests__/prisma.suite.repository.integration.test.ts`,
constructing `PrismaSuiteRepository` and, for the service-level scenarios,
`SuiteService` over it with in-memory `ScenarioService`/`AgentService` fakes;
the concurrency scenario (`:56`) is `Promise.all` of four `runPlan` calls and
one `count` afterwards. `packages/features/suite/server` has no
`vitest.config.ts` (its `test` script is bare `vitest run`), so that change
also adds one that names the datastore, which CLAUDE.md requires of any
package whose tests reach Postgres. The three `@unit` scope scenarios bind to
a `normalizePlanScope` unit test once fix 4 restores it.

## The `user:` merge and the mount

`apps/api/src/app-trpc/app-trpc.features.ts:778-781` merges
`createUserTrpcRouter(...)` with `governance.personalDashboard` via
`mount.root.mergeRouters`. The user router's procedures
(`packages/features/user/server/src/transport/api-trpc/user.api.ts`) include
`personalContext` and `personalBudget` and nothing named `personalUsage`,
`budgetOverview` or `cliBootstrap`
(`packages/enterprise/features/governance/server/src/transport/api-trpc/personal-dashboard.api.ts:99,132,151`),
so `mergeRouters` has no duplicate key to throw on. The mount's header rewrite
(`enterprise-governance-trpc.mount.ts:15-16,33-36`) and the added
`personalDashboard: governance.personalDashboard` (`:82`) are consistent with
it. Approved as it stands; nothing to fix here.

## Fix list

Blocking before commit:

1. `packages/features/suite/server/src/services/suite-run-models.resolver.ts:1-105`
   fails `feature-source-layout`. Rename to
   `services/suite-run-models.service.ts` and make it a class
   (`SuiteRunModelsService.create({ scenarios, modelProviders })` with a
   `resolve({ projectId, scenarioIds, plan })` method); update the import at
   `services/suite-execution.service.ts:20,71,80`, the export at
   `index.ts:24-27`, the composition at
   `apps/api/src/app/api-trpc-collaborators.agent-group.composition.ts:161,474-477`,
   and the type import in
   `services/__tests__/suite-execution-run-models.unit.test.ts:15`.
2. `packages/features/suite/server/src/services/suite.service.ts:311` writes the
   plan row before `execute` resolves run parameters
   (`services/suite-execution.service.ts:141-151`), so a run refused for a
   missing secret has already created or overwritten the plan. Spec
   `specs/suites/run-plan-identity-by-name.feature:270-289` and the method's
   own doc (`:257-259`) say otherwise; main did it in `prepareRun`. Call
   `scenarios.resolveRunParametersForScenarios({ scenarios: scenarioConfigs, values: parsed.parameters })`
   before `findOrCreatePlanByName` (move the `getRunConfigs` call at `:321`
   above it) and let a refusal there throw before the write; `execute` may
   keep its own call or take the resolved maps.
3. `packages/features/suite/server/src/repositories/prisma/prisma.suite.repository.ts:192-197`
   drops main's `NOT: { labels: { has: "cli-ephemeral" } }`
   (`suite.repository.ts:243` on main). Restore it, with the label constant in
   the contract beside `RUN_ALL_SUITE_LABEL` (`contract/src/suite.ts:13`).
   Reinstate the "dead" claim only with evidence that no such rows exist.
4. `packages/features/suite/contract/src/suite.ts:176` makes `name` required,
   and `services/suite.service.ts:264` never derives one, while
   `sdks/typescript/src/cli/commands/run-plans/run.ts:20,60` and the
   `POST /api/v1/run-plans/run` body type
   (`sdks/typescript/src/client-sdk/services/run-plans/run-plans-api.service.ts:23-25`)
   in this repo send it optionally and promise derivation. Make `name`
   optional on `suiteRunPlanInputSchema` (blank-only refused as main's
   `readRequestedPlanName`, `suite.service.ts:346-354`), and derive it after
   validation with `derivePlanName` (`contract/src/plan-name.ts:29`) and
   `targetLabels` (`contract/src/target-key.ts:305`) over a scope label and
   the target names the service already resolves in `resolveArchivedNames`.
   The tRPC door may keep `min(1)`. If this is deferred with the REST route,
   record it in `dev/docs/plans/core-application-feature-extraction-plan.md`
   as "blocked, CLI contract requires it", not as dead.

Ordinary:

5. `packages/features/suite/server/src/transport/api-trpc/suite.schemas.ts:73`
   caps `repeatCount` at 100; the contract caps at `MAX_REPEAT_COUNT` (5) and
   the service re-parses, so 6 to 100 becomes an unknown error. Import
   `MAX_REPEAT_COUNT` from `@langwatch/suite-contract` (as main's
   `suite.router.ts:224` did), or drop the local `runPlanConfigSchema`
   (`:70-78`) and use the contract's.
6. `packages/features/suite/server/src/repositories/prisma/prisma.suite.repository.ts:188-189`
   hand-rolls the lock key. Use `planNameKey` from the contract
   (`plan-name.ts:48`) and main's prefix `run-plan-name:` with
   `hashtextextended(..., 0)` (`plan-name-lock.ts:57` on main), so the lock
   and the match share one definition and old and new pods contend on the
   same key during a rollout. Consider main's transaction `timeout` too.
7. `packages/features/suite/server/src/services/suite-run-models.resolver.ts:49-61`
   reads scenarios one `tryGetById` at a time. Add a batch read to
   `ScenarioService` (`packages/features/scenario/contract/src/scenario.service.ts`,
   e.g. `getModelChoices({ ids, projectId })` returning
   `{ id, simulatorModel, judgeModel }[]`) and call it once, as main's
   `findMany` did (`run-models.resolver.ts:44-47`).
8. `packages/features/suite/server/src/services/__tests__/suite-run-plan.unit.test.ts:131,147`
   say "refuses before touching the plan row" but assert only the throw.
   Record calls to `findOrCreatePlanByName` in `buildService` and assert the
   count is 0 in both; then tag them
   `/** @scenario "A run refused for naming no target creates no plan" */`
   and `/** @scenario "A run refused for covering no scenario creates no plan" */`
   only if you also make the second test use an empty dynamic scope
   (`SuiteScopeEmptyError`), since it currently tests archived scenarios.
9. `packages/features/suite/server/src/services/suite.service.ts:270-273`
   dropped `normalizePlanScope` (main `suite.service.ts:1280-1284`), which is
   what the spec's exhaustive-suites section (`:158-186`) describes and what
   left the three `@unit` scenarios at lines 170, 176 and 182 unbound. Restore
   it as a contract function over `scenarios.listTestSuites` and bind the
   three scenarios in a contract unit test.
10. Comments at or over five lines listed in the section above; cut each to
    the one or two sentences that say something the code does not
    (`suite-run-models.resolver.ts:1-16`, `suite.repository.ts:34-46`,
    `suite-execution.service.ts:238-247` and `suite.api.ts:159-169` first).
11. `packages/features/suite/server/src/transport/api-trpc/suite.schemas.ts:70-78`
    duplicates the contract's `runPlanConfigSchema` with `modelOverrideSchema`
    in place of `z.string()` and without `.strict()`. If the tighter model
    check is wanted at the door, extend the contract schema rather than
    re-declaring it.

Out of scope, noted only: `prisma.suite.repository.ts:83-91` locks
`kind = 'custom'` and reads `kind: "run_plan"` (pre-existing); the contract
`__tests__` changes in the working tree (`plan-config`, `platform-path`,
`target-key`) and the `AgentTestService` wiring in the agent-group composition
belong to other agents and were not reviewed.


## Deferred

- Fix 4 (server-side default plan naming): `name` stays required on `suiteRunPlanInputSchema` until the by-name REST route (`POST /api/v1/run-plans/run`) is on the branch; that route is the only path on which the CLI (`sdks/typescript/src/cli/commands/run-plans/run.ts`) omits the name. Restore main's `defaultPlanName` (scope label + `targetLabels`) with that route.
