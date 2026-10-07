# @langwatch/suite-process

The server half of [suite](../README.md). Suites (run plans): their definitions, the scenario references they hold and their run history.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("suite").withRepositories(suiteRepositories).withApi(SuiteModule).withTransports(…, …, …, suiteTrpcTransport, testSuiteTrpcTransport).withTransportFacts(…).withEventing(suiteRunProcessingEventing).withMigrations(…)`, `src/suite.module.ts:20`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`SuiteApi`)

Callable capability exposed by the composed Suite application.

Peers call these through the token, declared at `../contract/src/suite.api.ts:34`; nothing else in this package is public.

#### `listByIds`

```typescript
listByIds(input: { projectId: string; ids: readonly string[] }): Promise<Suite[]>;
```

#### `list`

```typescript
list(input: { projectId: string; includeArchived?: boolean }): Promise<Suite[]>;
```

#### `listRunPlans`

The project's run plans with their own evaluators and a link into the interface it reads.

```typescript
listRunPlans(input: { projectId: string; projectSlug: string; includeArchived?: boolean; }): Promise<RunPlanWire[]>;
```

#### `getRunPlan`

One run plan as `listRunPlans` answers it; a missing id or a test suite id is not found.

```typescript
getRunPlan(input: { projectId: string; projectSlug: string; id: string }): Promise<RunPlanWire>;
```

#### `listTestSuites`

```typescript
listTestSuites(input: { projectId: string; includeArchived?: boolean; }): Promise<ScenarioTestSuite[]>;
```

#### `resolveActiveScenarioNames`

```typescript
resolveActiveScenarioNames(input: { scenarioIds: string[]; projectId: string; }): Promise<{ id: string; name: string }[]>;
```

#### `getByIdOrTestSuite`

```typescript
getByIdOrTestSuite(input: SuiteIdInput): Promise< Readonly<{ kind: "suite"; suite: Suite } | { kind: "test_suite"; testSuite: ScenarioTestSuite }> >;
```

#### `resolveArchivedNames`

The organization is the application's to resolve, so no caller states it.

```typescript
resolveArchivedNames(input: Omit<SuiteArchivedNamesInput, "organizationId">): Promise<{ scenarios: Record<string, string>; targets: Record<string, string> }>;
```

#### `getInternalSuiteSummaries`

```typescript
getInternalSuiteSummaries(input: SimulationProjectDateRangeInput): Promise<SimulationExternalSetSummary[]>;
```

#### `create`

```typescript
create(input: CreateSuiteCommand): Promise<Suite>;
```

#### `createTestSuite`

```typescript
createTestSuite(input: ScenarioTestSuiteCreateInput): Promise<ScenarioTestSuite>;
```

#### `update`

```typescript
update(input: UpdateSuiteCommand): Promise< Readonly<{ kind: "suite"; suite: Suite } | { kind: "test_suite"; testSuite: ScenarioTestSuite }> >;
```

#### `duplicate`

```typescript
duplicate(input: SuiteIdInput): Promise<Suite>;
```

#### `archive`

```typescript
archive(input: SuiteIdInput): Promise<Suite>;
```

#### `archiveTestSuite`

```typescript
archiveTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite>;
```

#### `renameTestSuite`

```typescript
renameTestSuite(input: ScenarioTestSuiteIdInput & { name: string }): Promise<ScenarioTestSuite>;
```

#### `updateTestSuite`

Edits what a test suite declares: its name, the fields it declares, the evaluators attached to it. Send only what changes.

```typescript
updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite>;
```

#### `run`

```typescript
run(input: Omit<SuiteRunInput, "organizationId">): Promise<SuiteRunResult & { planSlug: string }>;
```

#### `runAll`

```typescript
runAll(input: Omit<SuiteRunAllInput, "organizationId">): Promise<SuiteRunAllResult>;
```

#### `runPlan`

```typescript
runPlan(input: Omit<SuiteRunPlanInput, "organizationId">): Promise<SuiteRunPlanResult>;
```

#### `getOrganizationId`

```typescript
getOrganizationId(projectId: string): Promise<string>;
```

#### `recordSuiteRunItemStarted`

A scenario run of a suite set started: sent on `suite_run_processing`.

```typescript
recordSuiteRunItemStarted(input: RecordSuiteRunItemStartedCommandData): Promise<void>;
```

#### `completeSuiteRunItem`

A scenario run of a suite set finished: sent on `suite_run_processing`.

```typescript
completeSuiteRunItem(input: CompleteSuiteRunItemCommandData): Promise<void>;
```

#### `regradeSuiteRunItem`

A finished run's verdict changed after the fact; `idempotencyKey` names the change.

```typescript
regradeSuiteRunItem(input: RegradeSuiteRunItemCommandData): Promise<void>;
```

#### `getRunAttachments`

The evaluators one run carries: the test suite's, then the plan's own, an evaluator on both listed once. An archived suite or plan still answers.

```typescript
getRunAttachments(input: { projectId: string; suiteId?: string | null; planId?: string | null; }): Promise<EvaluatorAttachment[]>;
```

#### `getAttachedEvaluators`

The saved evaluators the attachments name, with their fields, by id; unknown ids left out.

```typescript
getAttachedEvaluators(input: { projectId: string; attachments: readonly Pick<EvaluatorAttachment, "evaluatorId">[]; }): Promise<Map<string, EvaluatorWithFields>>;
```

#### `assertConnectedAgentsRunnable`

Refuses a run when one of its connected agents is someone else's personal development agent, throwing `AgentOwnerOnlyError` naming the owner; no actor refuses any personal agent. Main's `assertConnectedAgentsRunnable`, which the experiment run also calls.

```typescript
assertConnectedAgentsRunnable(input: { agents: readonly ConnectedTargetAgent[]; actor: RunActor | undefined; }): Promise<void>;
```

#### `platformUrl`

The platform's own address for one suite resource, from the project's slug and the path already resolved — the three suite REST declarations are static objects with no request-scoped builder, so the app composes it.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

## REST transport

### `createRunPlansRest`

|             |                                       |
| ----------- | ------------------------------------- |
| Declared at | `src/transport/run-plans.rest.ts:151` |
| Base URL    | `/api/v1/run-plans`                   |
| Addressing  | v1-only                               |
| Credential  | project                               |

#### `GET /` · `listRunPlans`

List the project's run plans. Archived plans are left out unless includeArchived is set. Test suites are not run plans and are listed by the test suites family.

Permission `scenarios:view`. Declared at `src/transport/run-plans.rest.ts:156`.

Answers at `/api/v1/run-plans`.

```typescript
type Query = z.infer<typeof runPlanListQuerySchema>; // ../contract/src/suite-rest.schemas.ts:44
// Response: z.array(runPlanWireSchema) (inline, src/transport/run-plans.rest.ts:159)
```

#### `POST /run` · `runRunPlan`

Run a configuration under a name. The name identifies the run plan: send a name already in use and that plan's configuration is replaced with this one, send a new name and the plan is created, send no name and one is derived from what the run covers and what it runs against.

Permission `scenarios:create`. Declared at `src/transport/run-plans.rest.ts:174`.

Answers at `/api/v1/run-plans/run`.

```typescript
type Body = z.infer<typeof runPlanRunInputSchema>; // src/rules/suite-wire-v1.rules.ts:111
type Response = z.infer<typeof runPlanRunResultSchema>; // src/rules/suite-wire-v1.rules.ts:171
```

#### `GET /:id` · `getRunPlan`

Read one run plan. An id the project does not hold, and a test suite id, both answer 404 suite_not_found.

Permission `scenarios:view`. Declared at `src/transport/run-plans.rest.ts:195`.

Answers at `/api/v1/run-plans/:id`.

```typescript
type Params = z.infer<typeof runPlanIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:40
type Response = z.infer<typeof runPlanWireSchema>; // ../contract/src/suite-rest.schemas.ts:330
```

#### `POST /:id/run` · `rerunRunPlan`

Run a plan again

Permission `scenarios:create`. Declared at `src/transport/run-plans.rest.ts:210`.

Answers at `/api/v1/run-plans/:id/run`.

```typescript
type Params = z.infer<typeof runPlanIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:40
type Body = z.infer<typeof rerunInputSchema>; // src/rules/suite-wire-v1.rules.ts:128
type Response = z.infer<typeof runPlanRunResultSchema>; // src/rules/suite-wire-v1.rules.ts:171
```

#### `DELETE /:id` · `archiveRunPlan`

Archive a run plan. The plan stops being listed and its run history is kept. The scenarios it referenced are left where they are.

Permission `scenarios:manage`. Declared at `src/transport/run-plans.rest.ts:234`.

Answers at `/api/v1/run-plans/:id`.

```typescript
type Params = z.infer<typeof runPlanIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:40
type Response = z.infer<typeof runPlanArchiveResultSchema>; // ../contract/src/suite-rest.schemas.ts:50
```

### `createSuitesAliasRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/suites-alias.rest.ts:407` |
| Base URL    | `/api/suites`, twin `/api/v1/suites`     |
| Addressing  | dated                                    |
| Credential  | project                                  |
| Versions    | `2026-08-07`                             |
| Deprecated  | yes                                      |

#### `GET /` · `getApiSuites`

List all non-archived suites for the project. By default only custom run plans are returned; pass kind=folder for test suites.

Permission `scenarios:view`. Declared at `src/transport/suites-alias.rest.ts:413`.

Answers at `/api/suites`, `/api/v1/suites`; also, undocumented, `/api/suites/2026-08-07`, `/api/v1/suites/2026-08-07`, `/api/suites/latest`, `/api/v1/suites/latest`.

```typescript
type Query = z.infer<typeof listSuitesQuerySchema>; // ../contract/src/suite-rest.schemas.ts:202
// Response: z.array(suiteResponseWithPlatformUrlSchema) (inline, src/transport/suites-alias.rest.ts:416)
```

#### `GET /:id` · `getApiSuitesById`

Get a suite (run plan) by its ID.

Permission `scenarios:view`. Declared at `src/transport/suites-alias.rest.ts:432`.

Answers at `/api/suites/:id`, `/api/v1/suites/:id`; also, undocumented, `/api/suites/2026-08-07/:id`, `/api/v1/suites/2026-08-07/:id`, `/api/suites/latest/:id`, `/api/v1/suites/latest/:id`.

```typescript
type Params = z.infer<typeof suiteAliasIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:294
type Response = z.infer<typeof suiteResponseWithPlatformUrlSchema>; // ../contract/src/suite-rest.schemas.ts:111
```

#### `POST /` · `postApiSuites`

Create a new suite (run plan).

Permission `scenarios:create`. Declared at `src/transport/suites-alias.rest.ts:453`.

Answers at `/api/suites`, `/api/v1/suites`; also, undocumented, `/api/suites/2026-08-07`, `/api/v1/suites/2026-08-07`, `/api/suites/latest`, `/api/v1/suites/latest`.

```typescript
type Body = z.infer<typeof createSuiteInputSchema>; // ../contract/src/suite-rest.schemas.ts:176
type Response = z.infer<typeof suiteResponseWithPlatformUrlSchema>; // ../contract/src/suite-rest.schemas.ts:111
```

#### `PATCH /:id` · `patchApiSuitesById`

Update a suite (run plan).

Permission `scenarios:update`. Declared at `src/transport/suites-alias.rest.ts:471`.

Answers at `/api/suites/:id`, `/api/v1/suites/:id`; also, undocumented, `/api/suites/2026-08-07/:id`, `/api/v1/suites/2026-08-07/:id`, `/api/suites/latest/:id`, `/api/v1/suites/latest/:id`.

```typescript
type Params = z.infer<typeof suiteAliasIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:294
type Body = z.infer<typeof updateSuiteInputSchema>; // ../contract/src/suite-rest.schemas.ts:211
type Response = z.infer<typeof suiteResponseWithPlatformUrlSchema>; // ../contract/src/suite-rest.schemas.ts:111
```

#### `POST /:id/duplicate` · `postApiSuitesByIdDuplicate`

Duplicate a suite (run plan).

Permission `scenarios:create`. Declared at `src/transport/suites-alias.rest.ts:489`.

Answers at `/api/suites/:id/duplicate`, `/api/v1/suites/:id/duplicate`; also, undocumented, `/api/suites/2026-08-07/:id/duplicate`, `/api/v1/suites/2026-08-07/:id/duplicate`, `/api/suites/latest/:id/duplicate`, `/api/v1/suites/latest/:id/duplicate`.

```typescript
type Params = z.infer<typeof suiteAliasIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:294
type Body = z.infer<typeof duplicateSuiteBodySchema>; // ../contract/src/suite-rest.schemas.ts:297
type Response = z.infer<typeof suiteResponseWithPlatformUrlSchema>; // ../contract/src/suite-rest.schemas.ts:111
```

#### `POST /:id/run` · `postApiSuitesByIdRun`

Trigger a suite run. Schedules scenario executions for all active scenarios x targets x repeatCount. When the id names a test suite, the targets, the repeat count and the models are read from the body.

Permission `scenarios:create`. Declared at `src/transport/suites-alias.rest.ts:509`.

Answers at `/api/suites/:id/run`, `/api/v1/suites/:id/run`; also, undocumented, `/api/suites/2026-08-07/:id/run`, `/api/v1/suites/2026-08-07/:id/run`, `/api/suites/latest/:id/run`, `/api/v1/suites/latest/:id/run`.

```typescript
type Params = z.infer<typeof suiteAliasIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:294
type Body = z.infer<typeof runSuiteInputSchema>; // ../contract/src/suite-rest.schemas.ts:221
type Response = z.infer<typeof suiteRunResultSchema>; // ../contract/src/suite-rest.schemas.ts:269
```

#### `DELETE /:id` · `deleteApiSuitesById`

Archive (soft-delete) a suite. Archiving a test suite also archives every scenario filed in it, in one transaction.

Permission `scenarios:manage`. Declared at `src/transport/suites-alias.rest.ts:533`.

Answers at `/api/suites/:id`, `/api/v1/suites/:id`; also, undocumented, `/api/suites/2026-08-07/:id`, `/api/v1/suites/2026-08-07/:id`, `/api/suites/latest/:id`, `/api/v1/suites/latest/:id`.

```typescript
type Params = z.infer<typeof suiteAliasIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:294
type Response = z.infer<typeof archivedSuiteSchema>; // ../contract/src/suite-rest.schemas.ts:298
```

### `createTestSuitesRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/test-suites.rest.ts:216` |
| Base URL    | `/api/v1/test-suites`                   |
| Addressing  | v1-only                                 |
| Credential  | project                                 |

#### `GET /` · `listTestSuites`

List the project's test suites. Archived suites are left out unless includeArchived is set. Run plans are not test suites and are listed by the run plans family.

Permission `scenarios:view`. Declared at `src/transport/test-suites.rest.ts:221`.

Answers at `/api/v1/test-suites`.

```typescript
type Query = z.infer<typeof testSuiteListQuerySchema>; // ../contract/src/suite-rest.schemas.ts:60
// Response: z.array(testSuiteWireSchema) (inline, src/transport/test-suites.rest.ts:224)
```

#### `POST /` · `createTestSuite`

Create a test suite. It starts empty: scenarios join it by being filed into it, and the targets a run goes against are sent with the run. It may declare fields and attach evaluators from the start.

Permission `scenarios:create`. Declared at `src/transport/test-suites.rest.ts:237`.

Answers at `/api/v1/test-suites`.

```typescript
type Body = z.infer<typeof testSuiteCreateInputSchema>; // src/rules/suite-wire-v1.rules.ts:246
type Response = z.infer<typeof testSuiteWireSchema>; // src/rules/suite-wire-v1.rules.ts:201
```

#### `GET /:id` · `getTestSuite`

Read one test suite

Permission `scenarios:view`. Declared at `src/transport/test-suites.rest.ts:261`.

Answers at `/api/v1/test-suites/:id`.

```typescript
type Params = z.infer<typeof testSuiteIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:56
type Response = z.infer<typeof testSuiteDetailWireSchema>; // src/rules/suite-wire-v1.rules.ts:234
```

#### `PATCH /:id` · `updateTestSuite`

Edit a test suite: its name, the fields it declares, the evaluators attached to it. Send only what changes. The slug is kept on a rename, so links and run history stay where they are.

Permission `scenarios:update`. Declared at `src/transport/test-suites.rest.ts:282`.

Answers at `/api/v1/test-suites/:id`.

```typescript
type Params = z.infer<typeof testSuiteIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:56
type Body = z.infer<typeof testSuiteUpdateInputSchema>; // src/rules/suite-wire-v1.rules.ts:257
type Response = z.infer<typeof testSuiteWireSchema>; // src/rules/suite-wire-v1.rules.ts:201
```

#### `DELETE /:id` · `archiveTestSuite`

Archive a test suite. The scenarios filed in it are archived with it, in one step, because the suite is where they live.

Permission `scenarios:manage`. Declared at `src/transport/test-suites.rest.ts:303`.

Answers at `/api/v1/test-suites/:id`.

```typescript
type Params = z.infer<typeof testSuiteIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:56
type Response = z.infer<typeof testSuiteArchiveResultSchema>; // ../contract/src/suite-rest.schemas.ts:66
```

#### `POST /:id/run` · `runTestSuite`

Run a test suite

Permission `scenarios:create`. Declared at `src/transport/test-suites.rest.ts:315`.

Answers at `/api/v1/test-suites/:id/run`.

```typescript
type Params = z.infer<typeof testSuiteIdParamsSchema>; // ../contract/src/suite-rest.schemas.ts:56
type Body = z.infer<typeof testSuiteRunInputSchema>; // src/rules/suite-wire-v1.rules.ts:131
type Response = z.infer<typeof runPlanRunResultSchema>; // src/rules/suite-wire-v1.rules.ts:171
```

## tRPC transport

### `suites`

Contract `../contract/src/suite.trpc.ts:35`, router `src/transport/suite.trpc.ts:15`.

| Procedure                     | Kind     | Gate                          | Input                               | Output                      |
| ----------------------------- | -------- | ----------------------------- | ----------------------------------- | --------------------------- |
| `suites.create`               | mutation | Permission `scenarios:manage` | `createSuiteTrpcInputSchema`        | `suiteSchema`               |
| `suites.getAll`               | query    | Permission `scenarios:view`   | `listSuitesTrpcInputSchema`         | inline                      |
| `suites.getById`              | query    | Permission `scenarios:view`   | `suiteTrpcIdInputSchema`            | `suiteOrTestSuiteSchema`    |
| `suites.update`               | mutation | Permission `scenarios:manage` | `updateSuiteTrpcInputSchema`        | `suiteOrTestSuiteSchema`    |
| `suites.duplicate`            | mutation | Permission `scenarios:manage` | `suiteTrpcIdInputSchema`            | `suiteSchema`               |
| `suites.archive`              | mutation | Permission `scenarios:manage` | `suiteTrpcIdInputSchema`            | `suiteSchema`               |
| `suites.resolveArchivedNames` | query    | Permission `scenarios:view`   | `suiteArchivedNamesTrpcInputSchema` | `suiteArchivedNamesSchema`  |
| `suites.run`                  | mutation | Permission `scenarios:manage` | `runSuiteTrpcInputSchema`           | `suiteRunReceiptSchema`     |
| `suites.runPlan`              | mutation | Permission `scenarios:manage` | `runPlanTrpcInputSchema`            | `suiteRunPlanReceiptSchema` |
| `suites.runAll`               | mutation | Permission `scenarios:manage` | `runAllSuitesTrpcInputSchema`       | `suiteRunAllReceiptSchema`  |
| `suites.getSummaries`         | query    | Permission `scenarios:view`   | `suiteSummariesTrpcInputSchema`     | inline                      |

### `suites.testSuites`

Contract `../contract/src/suite.trpc.ts:105`, router `src/transport/test-suite.trpc.ts:12`.

| Procedure                   | Kind     | Gate                          | Input                            | Output                    |
| --------------------------- | -------- | ----------------------------- | -------------------------------- | ------------------------- |
| `suites.testSuites.create`  | mutation | Permission `scenarios:manage` | `createTestSuiteTrpcInputSchema` | `scenarioTestSuiteSchema` |
| `suites.testSuites.getAll`  | query    | Permission `scenarios:view`   | `suiteProjectInputSchema`        | inline                    |
| `suites.testSuites.rename`  | mutation | Permission `scenarios:manage` | `renameTestSuiteTrpcInputSchema` | `scenarioTestSuiteSchema` |
| `suites.testSuites.update`  | mutation | Permission `scenarios:manage` | `updateTestSuiteTrpcInputSchema` | `scenarioTestSuiteSchema` |
| `suites.testSuites.archive` | mutation | Permission `scenarios:manage` | `testSuiteTrpcIdInputSchema`     | `scenarioTestSuiteSchema` |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `suite_run_processing` (aggregate `suite_run`)

Declared at `src/eventing/suite-run-processing.pipeline.ts:90`. Events: `SuiteRunStartedEventSchema`, `SuiteRunItemStartedEventSchema`, `SuiteRunItemCompletedEventSchema`, `SuiteRunItemRegradedEventSchema`.

| Kind                       | Name                                                                            | Handles                                                                 | Declared at                                         |
| -------------------------- | ------------------------------------------------------------------------------- | ----------------------------------------------------------------------- | --------------------------------------------------- |
| command                    | `startSuiteRun`                                                                 | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:111` |
| command                    | `recordSuiteRunItemStarted`                                                     | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:117` |
| command                    | `completeSuiteRunItem`                                                          | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:123` |
| command                    | `regradeSuiteRunItem`                                                           | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:129` |
| peer subscriber            | `scenarioRunStarted`                                                            | `lw.simulation_run.started` from [scenario](../../scenario/README.md)   | `src/eventing/suite-run-processing.pipeline.ts:135` |
| peer subscriber            | `scenarioRunFinished`                                                           | `lw.simulation_run.finished` from [scenario](../../scenario/README.md)  | `src/eventing/suite-run-processing.pipeline.ts:141` |
| peer subscriber            | `scenarioRunEvaluated`                                                          | `lw.simulation_run.evaluated` from [scenario](../../scenario/README.md) | `src/eventing/suite-run-processing.pipeline.ts:147` |
| ClickHouse fold projection | `≈ SuiteRunStateFoldProjection.create({ store: deps.suiteRunStateFoldStore, })` | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:102` |
| retention                  | `≈ deps.retention`                                                              | –                                                                       | `src/eventing/suite-run-processing.pipeline.ts:153` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                         |
| ------ | --------------- | -------------------- | ----------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/suite.config.ts:5` |

<!-- readme:generated:end -->
