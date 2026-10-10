# @langwatch/experiment-process

The server half of [experiment](../README.md). Experiments: saved definitions, their runs, and the pages that list them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("experiment").withRepositories(experimentRepositories).withApi(ExperimentModule).withTransports(experimentV3Rest, experimentRest, experimentInitRest, experimentDspyStepsRest, experimentWorkbenchRunRest, experimentV3LegacyRest, experimentWorkbenchRunLegacyRest, experimentBatchLogRest, experimentDatasetEvaluationRest, experimentWorkflowEvaluationRest, experimentTrpcTransport, batchRecordTrpcTransport).provideMiddlewareBindings(…).withEventing(experimentRunProcessingEventing).withEventing(experimentLifecycleEventing)`, `src/experiment.module.ts:37`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ExperimentApi`)

Peers call these through the token, declared at `../contract/src/experiment.api.ts:143`; nothing else in this package is public.

#### `getById`

```typescript
getById(input: ExperimentLookup): Promise<Experiment>;
```

#### `getBySlug`

```typescript
getBySlug(input: ExperimentSlugLookup): Promise<Experiment>;
```

#### `getBySlugOrId`

```typescript
getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment>;
```

#### `findById`

```typescript
findById(input: ExperimentLookup): Promise<Experiment | null>;
```

#### `findBySlug`

```typescript
findBySlug(input: ExperimentSlugLookup): Promise<Experiment | null>;
```

#### `findBySlugAndType`

```typescript
findBySlugAndType(input: ExperimentSlugLookup & { type: ExperimentType }): Promise<Experiment | null>;
```

#### `summariseBatchEvaluations`

One row per experiment and dataset: how many batch evaluations ran, cost, mean score.

```typescript
summariseBatchEvaluations(input: { projectId: string }): Promise<BatchEvaluationSummary[]>;
```

#### `listBatchEvaluations`

Every batch-evaluation record of the experiment the slug names.

```typescript
listBatchEvaluations(input: { projectId: string; experimentSlug: string; }): Promise<BatchEvaluationRecord[]>;
```

#### `list`

```typescript
list(input: { projectId: string }): Promise<Experiment[]>;
```

#### `getPage`

```typescript
getPage(input: ExperimentPageInput): Promise<ExperimentPage>;
```

#### `findLatest`

```typescript
findLatest(input: { projectId: string }): Promise<Experiment | null>;
```

#### `findIdBySlug`

```typescript
findIdBySlug(input: ExperimentSlugLookup): Promise<{ id: string; slug: string } | null>;
```

#### `isActive`

```typescript
isActive(input: ExperimentLookup): Promise<boolean>;
```

#### `save`

```typescript
save(input: SaveExperimentInput): Promise<Experiment>;
```

#### `findOrCreateForWorkflow`

```typescript
findOrCreateForWorkflow(input: FindOrCreateWorkflowExperimentInput): Promise<{ id: string; slug: string }>;
```

#### `findNextDraftName`

```typescript
findNextDraftName(input: { projectId: string }): Promise<string>;
```

#### `triggerWorkflowEvaluation`

Refuses what it can before answering; the worker runs the evaluation itself.

```typescript
triggerWorkflowEvaluation(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted>;
```

#### `findOrCreateForRun`

The experiment an SDK's own identifier names, created if it is free. The one rule the create-or-take door and the batch result log both resolve a slug through, so repeated runs under one slug group together.

```typescript
findOrCreateForRun(input: ExperimentRunLookupInput): Promise<Experiment>;
```

#### `archive`

```typescript
archive(input: ExperimentLookup): Promise<{ success: true }>;
```

#### `listRuns`

```typescript
listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
```

#### `getRunAggregates`

```typescript
getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>>;
```

#### `getRunsPage`

```typescript
getRunsPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
```

#### `findRun`

A polling read: absent rows and disabled ClickHouse both read as null.

```typescript
findRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
```

#### `getRunsPageBySlug`

```typescript
getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{ experiment: { id: string; slug: string }; runs: ExperimentRun[]; totalHits: number; }>;
```

#### `startExperimentRun`

```typescript
startExperimentRun(input: StartExperimentRunInput): Promise<void>;
```

#### `recordTargetResult`

```typescript
recordTargetResult(input: RecordTargetResultInput): Promise<void>;
```

#### `recordEvaluatorResult`

```typescript
recordEvaluatorResult(input: RecordEvaluatorResultInput): Promise<void>;
```

#### `completeExperimentRun`

```typescript
completeExperimentRun(input: CompleteExperimentRunInput): Promise<void>;
```

#### `assertBatchLogWithinLimit`

Refuses an SDK batch body larger than the project's organization accepts in one request.

```typescript
assertBatchLogWithinLimit(input: { projectId: string; payloadBytes: number }): Promise<void>;
```

#### `logBatchEvaluation`

Records one SDK batch evaluation: its run, its rows and its verdicts.

```typescript
logBatchEvaluation(input: LogBatchEvaluationInput): Promise<void>;
```

#### `evaluateDataset`

Runs one evaluator over an entry of a saved dataset and records it against an experiment.

```typescript
evaluateDataset(input: DatasetEvaluationInput): Promise<DatasetEvaluationOutcome>;
```

#### `upsertDspyStep`

```typescript
upsertDspyStep(input: ExperimentDspyStep): Promise<void>;
```

#### `listDspySteps`

```typescript
listDspySteps(input: ExperimentDspyStepsLookup): Promise<ExperimentDspyStepSummary[]>;
```

#### `listDspyRuns`

```typescript
listDspyRuns(input: ExperimentDspyStepsLookup): Promise<DSPyRunsSummary[]>;
```

#### `getDspyStep`

```typescript
getDspyStep(input: ExperimentDspyStepLookup): Promise<ExperimentDspyStep>;
```

#### `getWorkbenchState`

```typescript
getWorkbenchState(input: GetWorkbenchStateInput): Promise<WorkbenchStateView>;
```

#### `listWorkbenchVersions`

```typescript
listWorkbenchVersions(input: ListWorkbenchVersionsInput): Promise<WorkbenchVersionsPage>;
```

#### `recordWorkbenchRunResults`

```typescript
recordWorkbenchRunResults(input: RecordWorkbenchRunResultsInput): Promise<WorkbenchSaveResult>;
```

#### `resolveWorkbenchTargetNames`

What each column of a saved workbench is called, keyed by target id; never throws.

```typescript
resolveWorkbenchTargetNames(input: { projectId: string; targets: TargetConfig[]; }): Promise<Record<string, string>>;
```

#### `startSavedRun`

Starts a run over the saved workbench, as the CLI's `experiment run` does.

```typescript
startSavedRun(input: SavedRunRequest): Promise<SavedRunAnswer>;
```

#### `projectSavedWorkbench`

The saved workbench as an agent reads it when no page is open.

```typescript
projectSavedWorkbench(input: { projectId: string; slug: string; includeResults?: boolean; }): Promise<SavedWorkbenchRead>;
```

#### `saveWorkbenchState`

```typescript
saveWorkbenchState(input: Omit<SaveWorkbenchStateInput, "actor">, by: ExperimentCaller): Promise<WorkbenchSaveResult>;
```

#### `createEvaluationsV3`

```typescript
createEvaluationsV3(input: Omit<CreateEvaluationsV3Input, "actor" | "state"> & Readonly<{ state?: CreateEvaluationsV3Input["state"] }>, by: ExperimentCaller): Promise<WorkbenchSaveResult>;
```

#### `commitWorkbenchVersion`

```typescript
commitWorkbenchVersion(input: Omit<CommitWorkbenchVersionInput, "actor">, by: ExperimentCaller): Promise<WorkbenchSaveResult>;
```

#### `restoreWorkbenchVersion`

```typescript
restoreWorkbenchVersion(input: Omit<RestoreWorkbenchVersionInput, "actor">, by: ExperimentCaller): Promise<WorkbenchSaveResult>;
```

#### `withRunAggregates`

```typescript
withRunAggregates(input: Readonly<{ projectId: string; experiments: readonly Experiment[] }>): Promise<ExperimentWithRuns[]>;
```

#### `getByIdOrSlug`

One experiment by its id when given, else by its slug; neither is a 400.

```typescript
getByIdOrSlug(input: ExperimentIdOrSlugInput): Promise<Experiment>;
```

#### `saveWithWorkflow`

Saves the wizard's setup, writing a version of its graph into the experiment's workflow.

```typescript
saveWithWorkflow(input: ExperimentWizardSaveInput, by: Readonly<{ id: string }>): Promise<Experiment>;
```

#### `saveAsMonitor`

Publishes a wizard experiment's evaluator as a monitor, refusing one not ready to be.

```typescript
saveAsMonitor(input: Readonly<{ projectId: string; experimentId: string }>): Promise<ExperimentPublishedMonitor>;
```

#### `listForEvaluations`

One page of the evaluations list, legacy online evaluations excluded, newest run first.

```typescript
listForEvaluations(input: ExperimentEvaluationsListInput): Promise<ExperimentEvaluationsListPage>;
```

#### `copyToProject`

Copies an experiment from a source project the caller may also manage evaluations in.

```typescript
copyToProject(input: ExperimentCopyInput, by: Readonly<{ id: string }>): Promise<ExperimentCopied>;
```

#### `findWorkflow`

The workflow behind an experiment, or null when it is gone.

```typescript
findWorkflow(input: Readonly<{ id: string; projectId: string; includeVersion?: boolean }>): Promise<WorkflowWithVersion | null>;
```

#### `createWorkflow`

Creates the workflow a new wizard experiment writes into, its first graph as version one.

```typescript
createWorkflow(input: Readonly<{ projectId: string; dsl: StudioWorkflow; commitMessage: string; autoSaved: boolean; }>, by: Readonly<{ id: string }>): Promise<Readonly<{ id: string }>>;
```

#### `saveWorkflowVersion`

```typescript
saveWorkflowVersion(input: ExperimentWorkflowVersionInput, by: Readonly<{ id: string }>): Promise<void>;
```

#### `copyWorkflowWithDatasets`

```typescript
copyWorkflowWithDatasets(input: ExperimentWorkflowCopyInput): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>>;
```

#### `publishAsMonitor`

Creates or replaces the monitor an experiment is published as.

```typescript
publishAsMonitor(input: Readonly<{ projectId: string; experimentId: string; monitor: Readonly<{ name: string; checkType: string; slug: string; preconditions: unknown; parameters: Record<string, unknown>; /** The wizard's stored mappings, canonicalised by the monitor side. */ mappings: unknown; sample: number; enabled: boolean; executionMode: string; }>; }>): Promise<ExperimentPublishedMonitor>;
```

#### `getDatasets`

```typescript
getDatasets(input: Readonly<{ projectId: string; datasetIds: string[] }>): Promise<Dataset[]>;
```

#### `renameDataset`

```typescript
renameDataset(input: Readonly<{ datasetId: string; projectId: string; name: string }>): Promise<Dataset>;
```

#### `copyDataset`

```typescript
copyDataset(input: Readonly<{ sourceDatasetId: string; sourceProjectId: string; targetProjectId: string; }>): Promise<Dataset>;
```

#### `slugFor`

The slug this deployment derives from a name, shared with every resource.

```typescript
slugFor(value: string): string;
```

#### `mayManageEvaluations`

Whether the caller may manage evaluations in a project the declared check never covered. `copy` reads a SECOND project - the source - so it is probed before anything is read from it.

```typescript
mayManageEvaluations(input: Readonly<{ actorId: string; projectId: string }>): Promise<boolean>;
```

#### `listModelCosts`

The project's own model cost rules, in the shape the pricing cascade reads. The optimizer log prices every call it stores against them.

```typescript
listModelCosts(input: Readonly<{ projectId: string }>): Promise<readonly ModelCostRate[]>;
```

#### `resolveAuthorNames`

The display names behind the author ids on a version history.

```typescript
resolveAuthorNames(authorIds: readonly string[]): Promise<readonly Readonly<{ id: string; name: string | null }>[]>;
```

#### `watchUpdates`

The freshness signals a workbench save lands on, for as long as the caller listens. A stream, not the fan-out itself: pairing subscribe with release is the application's — a door holding the emitter could leak one.

```typescript
watchUpdates(input: Readonly<{ projectId: string; signal?: AbortSignal | undefined }>): AsyncIterable<ExperimentUpdateFrame>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number; }): Promise<ExperimentUsageCount>;
```

## REST transport

### `experimentBatchLogRest`

|             |                                                 |
| ----------- | ----------------------------------------------- |
| Declared at | `src/transport/experiment-batch-log.rest.ts:67` |
| Base URL    | none: each route's path is its address          |
| Addressing  | literal                                         |
| Credential  | project                                         |

#### `POST /api/evaluations/batch/log_results` · `postApiEvaluationsBatchLogResults`

Report batch evaluation results

Permission `evaluations:manage`. Declared at `src/transport/experiment-batch-log.rest.ts:73`.

Answers at `/api/evaluations/batch/log_results`, `/api/v1/evaluations/batch/log_results`.

```typescript
// Body: inline, src/transport/experiment-batch-log.rest.ts:74
type Body = Record<string, unknown>;
// Response: inline, src/transport/experiment-batch-log.rest.ts:77
type Response = unknown;
```

### `experimentDatasetEvaluationRest`

|             |                                                          |
| ----------- | -------------------------------------------------------- |
| Declared at | `src/transport/experiment-dataset-evaluation.rest.ts:56` |
| Base URL    | none: each route's path is its address                   |
| Addressing  | literal                                                  |
| Credential  | project                                                  |

#### `POST /api/dataset/evaluate` · `postApiDatasetEvaluate`

Evaluate a dataset

Permission `evaluations:manage`. Declared at `src/transport/experiment-dataset-evaluation.rest.ts:62`.

Answers at `/api/dataset/evaluate`, `/api/v1/dataset/evaluate`.

```typescript
// Body: inline, src/transport/experiment-dataset-evaluation.rest.ts:64
type Body = Record<string, unknown>;
// Response: inline, src/transport/experiment-dataset-evaluation.rest.ts:67
type Response = unknown;
```

### `experimentDspyStepsRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/experiment-dspy-steps.rest.ts:85` |
| Base URL    | `/api/dspy`, twin `/api/v1/dspy`                 |
| Addressing  | dated                                            |
| Credential  | project                                          |
| Versions    | `2026-08-07`                                     |

#### `POST /log_steps` · `postApiDspyLogSteps`

Report DSPy optimizer steps

Permission `experiments:manage`. Declared at `src/transport/experiment-dspy-steps.rest.ts:89`.

Answers at `/api/dspy/log_steps`, `/api/v1/dspy/log_steps`; also, undocumented, `/api/dspy/2026-08-07/log_steps`, `/api/v1/dspy/2026-08-07/log_steps`, `/api/dspy/latest/log_steps`, `/api/v1/dspy/latest/log_steps`.

```typescript
type Body = z.infer<typeof dSPyLogStepsBodySchema>; // ../contract/src/experiment-legacy.ts:101
// Response: dSPyLogStepsResponseSchema, ../contract/src/experiment-legacy.ts:103
interface Response {
  message: string;
}
```

### `experimentInitRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/experiment-init.rest.ts:13`   |
| Base URL    | `/api/experiment`, twin `/api/v1/experiment` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `POST /init` · `postApiExperimentInit`

Create an experiment

Permission `experiments:manage`. Declared at `src/transport/experiment-init.rest.ts:17`.

Answers at `/api/experiment/init`, `/api/v1/experiment/init`; also, undocumented, `/api/experiment/2026-08-07/init`, `/api/v1/experiment/2026-08-07/init`, `/api/experiment/latest/init`, `/api/v1/experiment/latest/init`.

```typescript
// Body: experimentInitBodySchema, ../contract/src/experiment.rest.ts:54
interface Body {
  experiment_id?: string | null;
  experiment_slug?: string | null;
  experiment_type: "DSPY" | "BATCH_EVALUATION" | "BATCH_EVALUATION_V2";
  experiment_name?: string;
  workflowId?: string;
}
// Response: experimentInitResponseSchema, ../contract/src/experiment-workbench-rest.ts:471
interface Response {
  slug: string;
  path: string;
}
```

### `experimentV3LegacyRest`

|             |                                                 |
| ----------- | ----------------------------------------------- |
| Declared at | `src/transport/experiment-v3-legacy.rest.ts:42` |
| Base URL    | `/api/evaluations/v3`                           |
| Addressing  | v1-in-path                                      |
| Credential  | project                                         |

#### `POST /:evaluationSlug/run` · `postApiEvaluationsV3BySlugRun`

Permission `evaluations:create`. Declared at `src/transport/experiment-v3-legacy.rest.ts:47`.

Answers at `/api/evaluations/v3/:evaluationSlug/run`.

```typescript
// Params: evaluationSlugParamsSchema, ../contract/src/experiment-workbench-rest.ts:39
interface Params {
  evaluationSlug: string;
}
// Rawbody: "text" (inline, src/transport/experiment-v3-legacy.rest.ts:49)
// Response: inline, src/transport/experiment-v3-legacy.rest.ts:52
type Response = unknown;
```

#### `GET /runs` · `getApiEvaluationsV3Runs`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:69`.

Answers at `/api/evaluations/v3/runs`.

```typescript
// Query: listRunsQuerySchema, ../contract/src/experiment-workbench-rest.ts:49
interface Query {
  experimentSlug?: string;
  page?: number;
  pageSize?: number;
}
```

#### `GET /runs/:runId` · `getApiEvaluationsV3RunsByRunId`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:76`.

Answers at `/api/evaluations/v3/runs/:runId`.

```typescript
// Params: runIdParamsSchema, ../contract/src/experiment-workbench-rest.ts:12
interface Params {
  runId: string;
}
type Response = z.infer<typeof runStatusResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:259
```

#### `GET /runs/:runId/results` · `getApiEvaluationsV3RunsByRunIdResults`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:83`.

Answers at `/api/evaluations/v3/runs/:runId/results`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:12
// Query: runResultsQuerySchema, ../contract/src/experiment-workbench-rest.ts:55
interface Query {
  experimentSlug?: string;
}
type Response = z.infer<typeof runResultsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:334
```

#### `GET /:evaluationSlug/workbench-state` · `getApiEvaluationsV3BySlugWorkbenchState`

Permission `experiments:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:91`.

Answers at `/api/evaluations/v3/:evaluationSlug/workbench-state`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:39
// Query: workbenchStateQuerySchema, ../contract/src/experiment-workbench-rest.ts:62
interface Query {
  fields?: string;
}
// Response: workbenchStateAnswerSchema, ../contract/src/experiment-workbench-rest.ts:403
interface Response {
  id: string;
  slug: string;
  name?: string | null;
  state?: Record<string, unknown> | null;
  version: number;
  updatedAt: string;
}
```

#### `PUT /:evaluationSlug/workbench-state` · `putApiEvaluationsV3BySlugWorkbenchState`

Permission `experiments:update`. Declared at `src/transport/experiment-v3-legacy.rest.ts:105`.

Answers at `/api/evaluations/v3/:evaluationSlug/workbench-state`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:39
// Body: saveWorkbenchStateBodySchema, ../contract/src/experiment-workbench-rest.ts:408
interface Body {
  state: Record<string, unknown>;
  expectedVersion?: number;
  commitMessage?: string;
}
// Response: saveWorkbenchStateResponseSchema, ../contract/src/experiment-workbench-rest.ts:420
interface Response {
  version: number;
}
```

#### `GET /:evaluationSlug/versions` · `getApiEvaluationsV3BySlugVersions`

Permission `experiments:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:119`.

Answers at `/api/evaluations/v3/:evaluationSlug/versions`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:39
// Query: listVersionsQuerySchema, ../contract/src/experiment-workbench-rest.ts:69
interface Query {
  limit?: number;
  cursor?: number;
}
type Response = z.infer<typeof listWorkbenchVersionsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:451
```

#### `POST /:evaluationSlug/versions/:version/restore` · `postApiEvaluationsV3BySlugVersionsByVersionRestore`

Permission `experiments:update`. Declared at `src/transport/experiment-v3-legacy.rest.ts:129`.

Answers at `/api/evaluations/v3/:evaluationSlug/versions/:version/restore`.

```typescript
// Params: evaluationSlugVersionParamsSchema, ../contract/src/experiment-workbench-rest.ts:43
interface Params {
  evaluationSlug: string;
  version: number;
}
// Body: restoreWorkbenchVersionBodySchema, ../contract/src/experiment-workbench-rest.ts:461
type Body = Record<string, unknown>;
// Response: restoreWorkbenchVersionResponseSchema, ../contract/src/experiment-workbench-rest.ts:463
interface Response {
  version: number;
}
```

### `experimentWorkbenchRunLegacyRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/experiment-v3-legacy.rest.ts:151` |
| Base URL    | `/api/evaluations/v3`                            |
| Addressing  | v1-in-path                                       |
| Credential  | browser                                          |

#### `POST /execute` · `executeEvaluationsV3Experiment`

Permission `evaluations:manage`. Declared at `src/transport/experiment-v3-legacy.rest.ts:157`.

Answers at `/api/evaluations/v3/execute`.

```typescript
type Body = z.infer<typeof executionRequestSchema>; // ../contract/src/workbench/execution/types.ts:163
// Response: inline, src/transport/experiment-v3-legacy.rest.ts:160
type Response = unknown;
```

#### `POST /abort` · `abortEvaluationsV3ExperimentRun`

Permission `evaluations:manage`. Declared at `src/transport/experiment-v3-legacy.rest.ts:166`.

Answers at `/api/evaluations/v3/abort`.

```typescript
// Body: abortExperimentRunRequestSchema, ../contract/src/workbench/execution/types.ts:215
interface Body {
  projectId: string;
  runId: string;
}
// Response: abortExperimentRunResponseSchema, ../contract/src/workbench/execution/types.ts:220
interface Response {
  success: true;
  runId: string;
  message: "Abort requested";
}
```

### `experimentV3Rest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/experiment-v3.rest.ts:83`       |
| Base URL    | `/api/experiments`, twin `/api/v1/experiments` |
| Addressing  | dated                                          |
| Credential  | project                                        |
| Versions    | `2026-08-07`                                   |

#### `POST /:slug/run` · `postApiExperimentsBySlugRun`

Run an experiment

Permission `evaluations:create`. Declared at `src/transport/experiment-v3.rest.ts:88`.

Answers at `/api/experiments/:slug/run`, `/api/v1/experiments/:slug/run`; also, undocumented, `/api/experiments/2026-08-07/:slug/run`, `/api/v1/experiments/2026-08-07/:slug/run`, `/api/experiments/latest/:slug/run`, `/api/v1/experiments/latest/:slug/run`.

```typescript
// Params: slugParamsSchema, ../contract/src/experiment.rest.ts:45
interface Params {
  slug: string;
}
// Rawbody: "text" (inline, src/transport/experiment-v3.rest.ts:93)
// Response: inline, src/transport/experiment-v3.rest.ts:96
type Response = unknown;
```

#### `GET /runs` · `getApiExperimentsRuns`

List runs of an experiment

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:140`.

Answers at `/api/experiments/runs`, `/api/v1/experiments/runs`; also, undocumented, `/api/experiments/2026-08-07/runs`, `/api/v1/experiments/2026-08-07/runs`, `/api/experiments/latest/runs`, `/api/v1/experiments/latest/runs`.

```typescript
type Query = z.infer<typeof listRunsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:49
```

#### `GET /runs/:runId` · `getApiExperimentsRunsByRunId`

Poll a run

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:165`.

Answers at `/api/experiments/runs/:runId`, `/api/v1/experiments/runs/:runId`; also, undocumented, `/api/experiments/2026-08-07/runs/:runId`, `/api/v1/experiments/2026-08-07/runs/:runId`, `/api/experiments/latest/runs/:runId`, `/api/v1/experiments/latest/runs/:runId`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:12
type Response = z.infer<typeof runStatusResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:259
```

#### `GET /runs/:runId/results` · `getApiExperimentsRunsByRunIdResults`

Read run results

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:182`.

Answers at `/api/experiments/runs/:runId/results`, `/api/v1/experiments/runs/:runId/results`; also, undocumented, `/api/experiments/2026-08-07/runs/:runId/results`, `/api/v1/experiments/2026-08-07/runs/:runId/results`, `/api/experiments/latest/runs/:runId/results`, `/api/v1/experiments/latest/runs/:runId/results`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:12
type Query = z.infer<typeof runResultsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:55
type Response = z.infer<typeof runResultsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:334
```

#### `GET /:slug/workbench-state` · `getApiExperimentsBySlugWorkbenchState`

Read an experiment's setup

Permission `experiments:view`. Declared at `src/transport/experiment-v3.rest.ts:206`.

Answers at `/api/experiments/:slug/workbench-state`, `/api/v1/experiments/:slug/workbench-state`; also, undocumented, `/api/experiments/2026-08-07/:slug/workbench-state`, `/api/v1/experiments/2026-08-07/:slug/workbench-state`, `/api/experiments/latest/:slug/workbench-state`, `/api/v1/experiments/latest/:slug/workbench-state`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Query = z.infer<typeof workbenchStateQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:62
type Response = z.infer<typeof workbenchStateAnswerSchema>; // ../contract/src/experiment-workbench-rest.ts:403
```

#### `PUT /:slug/workbench-state` · `putApiExperimentsBySlugWorkbenchState`

Save an experiment's setup

Permission `experiments:update`. Declared at `src/transport/experiment-v3.rest.ts:229`.

Answers at `/api/experiments/:slug/workbench-state`, `/api/v1/experiments/:slug/workbench-state`; also, undocumented, `/api/experiments/2026-08-07/:slug/workbench-state`, `/api/v1/experiments/2026-08-07/:slug/workbench-state`, `/api/experiments/latest/:slug/workbench-state`, `/api/v1/experiments/latest/:slug/workbench-state`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Body = z.infer<typeof saveWorkbenchStateBodySchema>; // ../contract/src/experiment-workbench-rest.ts:408
type Response = z.infer<typeof saveWorkbenchStateResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:420
```

#### `GET /:slug/versions` · `getApiExperimentsBySlugVersions`

List an experiment's versions

Permission `experiments:view`. Declared at `src/transport/experiment-v3.rest.ts:261`.

Answers at `/api/experiments/:slug/versions`, `/api/v1/experiments/:slug/versions`; also, undocumented, `/api/experiments/2026-08-07/:slug/versions`, `/api/v1/experiments/2026-08-07/:slug/versions`, `/api/experiments/latest/:slug/versions`, `/api/v1/experiments/latest/:slug/versions`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Query = z.infer<typeof listVersionsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:69
type Response = z.infer<typeof listWorkbenchVersionsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:451
```

#### `POST /:slug/versions/:version/restore` · `postApiExperimentsBySlugVersionsByVersionRestore`

Restore an experiment version

Permission `experiments:update`. Declared at `src/transport/experiment-v3.rest.ts:284`.

Answers at `/api/experiments/:slug/versions/:version/restore`, `/api/v1/experiments/:slug/versions/:version/restore`; also, undocumented, `/api/experiments/2026-08-07/:slug/versions/:version/restore`, `/api/v1/experiments/2026-08-07/:slug/versions/:version/restore`, `/api/experiments/latest/:slug/versions/:version/restore`, `/api/v1/experiments/latest/:slug/versions/:version/restore`.

```typescript
// Params: slugVersionParamsSchema, ../contract/src/experiment-workbench-rest.ts:31
interface Params {
  slug: string;
  version: number;
}
type Body = z.infer<typeof restoreWorkbenchVersionBodySchema>; // ../contract/src/experiment-workbench-rest.ts:461
type Response = z.infer<typeof restoreWorkbenchVersionResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:463
```

### `experimentWorkbenchRunRest`

|             |                                                     |
| ----------- | --------------------------------------------------- |
| Declared at | `src/transport/experiment-workbench-run.rest.ts:15` |
| Base URL    | `/api/experiments`, twin `/api/v1/experiments`      |
| Addressing  | dated                                               |
| Credential  | browser                                             |
| Versions    | `2026-08-07`                                        |

#### `POST /execute` · `executeExperiment`

Permission `evaluations:manage`. Hidden from the OpenAPI document. Declared at `src/transport/experiment-workbench-run.rest.ts:24`.

Answers at `/api/experiments/execute`, `/api/v1/experiments/execute`; also, undocumented, `/api/experiments/2026-08-07/execute`, `/api/v1/experiments/2026-08-07/execute`, `/api/experiments/latest/execute`, `/api/v1/experiments/latest/execute`.

```typescript
type Body = z.infer<typeof executionRequestSchema>; // ../contract/src/workbench/execution/types.ts:163
// Response: inline, src/transport/experiment-workbench-run.rest.ts:27
type Response = unknown;
```

#### `POST /abort` · `abortExperimentRun`

Permission `evaluations:manage`. Hidden from the OpenAPI document. Declared at `src/transport/experiment-workbench-run.rest.ts:34`.

Answers at `/api/experiments/abort`, `/api/v1/experiments/abort`; also, undocumented, `/api/experiments/2026-08-07/abort`, `/api/v1/experiments/2026-08-07/abort`, `/api/experiments/latest/abort`, `/api/v1/experiments/latest/abort`.

```typescript
type Body = z.infer<typeof abortExperimentRunRequestSchema>; // ../contract/src/workbench/execution/types.ts:215
type Response = z.infer<typeof abortExperimentRunResponseSchema>; // ../contract/src/workbench/execution/types.ts:220
```

### `experimentWorkflowEvaluationRest`

|             |                                                           |
| ----------- | --------------------------------------------------------- |
| Declared at | `src/transport/experiment-workflow-evaluation.rest.ts:27` |
| Base URL    | `/api/workflows`, twin `/api/v1/workflows`                |
| Addressing  | dated                                                     |
| Credential  | project                                                   |
| Versions    | `2026-08-07`                                              |

#### `POST /:id/evaluate` · `postApiWorkflowsByIdEvaluate`

Trigger an evaluation run of a workflow's committed version through the evaluations pipeline. Evaluate the workflow's attached dataset, inline data, or a platform dataset id; parameters bind as constant entry inputs on every row. Returns a run id and a results URL to poll or open in the browser.

Permission `workflows:create or evaluations:view`. Declared at `src/transport/experiment-workflow-evaluation.rest.ts:32`.

Answers at `/api/workflows/:id/evaluate`, `/api/v1/workflows/:id/evaluate`; also, undocumented, `/api/workflows/2026-08-07/:id/evaluate`, `/api/v1/workflows/2026-08-07/:id/evaluate`, `/api/workflows/latest/:id/evaluate`, `/api/v1/workflows/latest/:id/evaluate`.

```typescript
// Params: experimentWorkflowEvaluateParamsSchema, ../contract/src/experiment-workflow-evaluation-rest.ts:8
interface Params {
  id: string;
}
// Body: experimentWorkflowEvaluateSchema, ../contract/src/experiment-workflow-evaluation-rest.ts:19
interface Body {
  version_id?: string;
  data?: Record<string, unknown>[];
  dataset_id?: string;
  parameters?: Record<string, string | number | boolean>;
  row_indices?: number[];
}
// Response: experimentWorkflowEvaluationStartedSchema, ../contract/src/experiment-workflow-evaluation-rest.ts:11
interface Response {
  run_id: string;
  run_url: string;
  workflow_version_id: string;
  version: string;
}
```

### `experimentRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/experiment.rest.ts:64`          |
| Base URL    | `/api/experiments`, twin `/api/v1/experiments` |
| Addressing  | dated                                          |
| Credential  | project                                        |
| Versions    | `2026-08-07`                                   |

#### `GET /` · `getApiExperiments`

List experiments for the project

Permission `experiments:view`. Declared at `src/transport/experiment.rest.ts:70`.

Answers at `/api/experiments`, `/api/v1/experiments`; also, undocumented, `/api/experiments/2026-08-07`, `/api/v1/experiments/2026-08-07`, `/api/experiments/latest`, `/api/v1/experiments/latest`.

```typescript
// Query: listExperimentsQuerySchema, ../contract/src/experiment.rest.ts:38
interface Query {
  page?: number;
  pageSize?: number;
}
type Response = z.infer<typeof experimentsListResponseSchema>; // ../contract/src/experiment.rest.ts:28
```

#### `GET /:slug` · `getApiExperimentsBySlug`

Read one experiment

Permission `experiments:view`. Declared at `src/transport/experiment.rest.ts:112`.

Answers at `/api/experiments/:slug`, `/api/v1/experiments/:slug`; also, undocumented, `/api/experiments/2026-08-07/:slug`, `/api/v1/experiments/2026-08-07/:slug`, `/api/experiments/latest/:slug`, `/api/v1/experiments/latest/:slug`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
// Response: experimentSummarySchema, ../contract/src/experiment.rest.ts:16
interface Response {
  id: string;
  slug: string;
  name: string | null;
  type: string;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string;
  runsCount: number;
  lastRunAt: string | null;
}
```

#### `POST /` · `postApiExperiments`

Create an experiment and its setup

Permission `experiments:create`. Declared at `src/transport/experiment.rest.ts:138`.

Answers at `/api/experiments`, `/api/v1/experiments`; also, undocumented, `/api/experiments/2026-08-07`, `/api/v1/experiments/2026-08-07`, `/api/experiments/latest`, `/api/v1/experiments/latest`.

```typescript
// Body: createExperimentBodySchema, ../contract/src/experiment-workbench-rest.ts:368
interface Body {
  name?: string;
  state?: Record<string, unknown>;
}
// Response: createExperimentResponseSchema, ../contract/src/experiment-workbench-rest.ts:379
interface Response {
  id: string;
  slug: string;
  version: number;
}
```

## tRPC transport

### `batchRecord`

Contract `../contract/src/batch-record.trpc.ts:20`, router `src/transport/batch-record.trpc.ts:11`.

| Procedure                               | Kind  | Gate                        | Input                                     | Output |
| --------------------------------------- | ----- | --------------------------- | ----------------------------------------- | ------ |
| `batchRecord.getAllByexperimentIdGroup` | query | Permission `workflows:view` | `datasetApiProjectInputSchema`            | inline |
| `batchRecord.getAllByexperimentSlug`    | query | Permission `workflows:view` | `batchRecordApiExperimentSlugInputSchema` | inline |

```typescript
// batchRecord.getAllByexperimentIdGroup
// Input: datasetApiProjectInputSchema, ../../dataset/contract/src/dataset.schemas.ts:46
interface Input {
  projectId: string;
}
// Output: z.array(batchEvaluationSummarySchema) (inline, ../contract/src/batch-record.trpc.ts:24)

// batchRecord.getAllByexperimentSlug
// Input: batchRecordApiExperimentSlugInputSchema, ../contract/src/batch-record.trpc.ts:15
interface Input {
  projectId: string;
  experimentSlug: string;
}
// Output: z.array(batchEvaluationRecordSchema) (inline, ../contract/src/batch-record.trpc.ts:29)
```

### `experiments`

Contract `../contract/src/experiment.trpc.ts:115`, router `src/transport/experiment.trpc.ts:41`.

| Procedure                                      | Kind         | Gate                            | Input                                  | Output                                  |
| ---------------------------------------------- | ------------ | ------------------------------- | -------------------------------------- | --------------------------------------- |
| `experiments.saveExperiment`                   | mutation     | Permission `workflows:create`   | `experimentWizardSaveInputSchema`      | `experimentSchema`                      |
| `experiments.saveEvaluationsV3`                | mutation     | Permission `experiments:update` | inline                                 | `experimentSavedWorkbenchSchema`        |
| `experiments.getEvaluationsV3BySlug`           | query        | Permission `experiments:view`   | inline                                 | `experimentWorkbenchPageSchema`         |
| `experiments.getWorkbenchVersion`              | query        | Permission `experiments:view`   | inline                                 | `experimentWorkbenchVersionProbeSchema` |
| `experiments.onExperimentUpdate`               | subscription | Permission `experiments:view`   | `projectScopeSchema`                   | `experimentUpdateFrameSchema`           |
| `experiments.listWorkbenchVersions`            | query        | Permission `experiments:view`   | inline                                 | `experimentWorkbenchVersionsPageSchema` |
| `experiments.commitWorkbenchVersion`           | mutation     | Permission `experiments:update` | inline                                 | `workbenchSaveResultSchema`             |
| `experiments.restoreWorkbenchVersion`          | mutation     | Permission `experiments:update` | inline                                 | `workbenchSaveResultSchema`             |
| `experiments.saveAsMonitor`                    | mutation     | Permission `workflows:create`   | inline                                 | `experimentPublishedMonitorSchema`      |
| `experiments.getExperimentBySlugOrId`          | query        | Permission `experiments:view`   | `experimentIdOrSlugInputSchema`        | `experimentSchema`                      |
| `experiments.getExperimentWithDSLBySlug`       | query        | Permission `experiments:view`   | inline                                 | `experimentWithDslSchema`               |
| `experiments.getAllByProjectId`                | query        | Permission `experiments:view`   | `projectScopeSchema`                   | inline                                  |
| `experiments.getAllForEvaluationsList`         | query        | Permission `experiments:view`   | `experimentEvaluationsListInputSchema` | `experimentEvaluationsListPageSchema`   |
| `experiments.getLastExperiment`                | query        | Permission `experiments:view`   | `projectScopeSchema`                   | inline                                  |
| `experiments.deleteExperiment`                 | mutation     | Permission `workflows:delete`   | inline                                 | `experimentArchivedSchema`              |
| `experiments.copy`                             | mutation     | Permission `evaluations:manage` | `experimentCopyInputSchema`            | `experimentCopiedSchema`                |
| `experiments.getExperimentDSPyRuns`            | query        | Permission `experiments:view`   | inline                                 | inline                                  |
| `experiments.getExperimentDSPyStep`            | query        | Permission `experiments:view`   | inline                                 | `dSPyStepSchema`                        |
| `experiments.getExperimentBatchEvaluationRuns` | query        | Permission `experiments:view`   | inline                                 | `experimentRunListSchema`               |
| `experiments.getExperimentBatchEvaluationRun`  | query        | Permission `experiments:view`   | inline                                 | inline                                  |

```typescript
// experiments.saveExperiment
type Input = z.infer<typeof experimentWizardSaveInputSchema>; // ../contract/src/experiment.trpc.ts:81
type Output = z.infer<typeof experimentSchema>; // ../contract/src/experiment.ts:13

// experiments.saveEvaluationsV3
// Input: z.object({ ...projectScopeSchema.shape, experimentId: z.string().optional(), state: persi… (inline, ../contract/src/experiment.trpc.ts:128)
type Output = z.infer<typeof experimentSavedWorkbenchSchema>; // ../contract/src/experiment.responses.ts:68

// experiments.getEvaluationsV3BySlug
// Input: inline, ../contract/src/experiment.trpc.ts:138
interface Input {
  projectId: string;
  experimentSlug: string;
}
type Output = z.infer<typeof experimentWorkbenchPageSchema>; // ../contract/src/experiment.responses.ts:27

// experiments.getWorkbenchVersion
// Input: inline, ../contract/src/experiment.trpc.ts:147
interface Input {
  projectId: string;
  experimentSlug: string;
}
// Output: experimentWorkbenchVersionProbeSchema, ../contract/src/experiment.responses.ts:57
interface Output {
  experimentId: string;
  version: number;
  updatedAt: unknown;
  actorLabel?: "user" | "langy" | "api";
  runId?: string;
}

// experiments.onExperimentUpdate
// Input: projectScopeSchema, ../contract/src/experiment.trpc.ts:30
interface Input {
  projectId: string;
}
// Output: experimentUpdateFrameSchema, ../contract/src/experiment.responses.ts:127
interface Output {
  event: unknown;
  timestamp?: number;
}

// experiments.listWorkbenchVersions
// Input: inline, ../contract/src/experiment.trpc.ts:160
interface Input {
  projectId: string;
  experimentId: string;
  limit?: number;
  cursor?: number;
}
type Output = z.infer<typeof experimentWorkbenchVersionsPageSchema>; // ../contract/src/experiment.responses.ts:74

// experiments.commitWorkbenchVersion
// Input: inline, ../contract/src/experiment.trpc.ts:171
interface Input {
  projectId: string;
  experimentId: string;
  commitMessage: string;
}
// Output: workbenchSaveResultSchema, ../contract/src/experiment-workbench-version.ts:116
interface Output {
  experimentId: string;
  slug: string;
  version: number;
}

// experiments.restoreWorkbenchVersion
// Input: inline, ../contract/src/experiment.trpc.ts:181
interface Input {
  projectId: string;
  experimentId: string;
  version: number;
}
type Output = z.infer<typeof workbenchSaveResultSchema>; // ../contract/src/experiment-workbench-version.ts:116

// experiments.saveAsMonitor
// Input: inline, ../contract/src/experiment.trpc.ts:191
interface Input {
  projectId: string;
  experimentId: string;
}
type Output = z.infer<typeof experimentPublishedMonitorSchema>; // ../contract/src/experiment.responses.ts:35

// experiments.getExperimentBySlugOrId
// Input: experimentIdOrSlugInputSchema, ../contract/src/experiment.trpc.ts:91
interface Input {
  projectId: string;
  experimentId?: string;
  experimentSlug?: string;
}
type Output = z.infer<typeof experimentSchema>; // ../contract/src/experiment.ts:13

// experiments.getExperimentWithDSLBySlug
// Input: inline, ../contract/src/experiment.trpc.ts:203
interface Input {
  projectId: string;
  experimentSlug: string;
  randomSeed?: number;
}
type Output = z.infer<typeof experimentWithDslSchema>; // ../contract/src/experiment.responses.ts:82

// experiments.getAllByProjectId
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/experiment.trpc.ts:30
// Output: z.array(experimentSchema) (inline, ../contract/src/experiment.trpc.ts:213)

// experiments.getAllForEvaluationsList
// Input: experimentEvaluationsListInputSchema, ../contract/src/experiment.trpc.ts:99
interface Input {
  projectId: string;
  pageOffset?: number;
  pageSize?: number;
}
type Output = z.infer<typeof experimentEvaluationsListPageSchema>; // ../contract/src/experiment.responses.ts:90

// experiments.getLastExperiment
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/experiment.trpc.ts:30
// Output: experimentSchema.nullable() (inline, ../contract/src/experiment.trpc.ts:222)

// experiments.deleteExperiment
// Input: inline, ../contract/src/experiment.trpc.ts:230
interface Input {
  projectId: string;
  experimentId: string;
}
// Output: experimentArchivedSchema, ../contract/src/experiment.responses.ts:114
interface Output {
  success: true;
}

// experiments.copy
// Input: experimentCopyInputSchema, ../contract/src/experiment.trpc.ts:107
interface Input {
  experimentId: string;
  projectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
}
type Output = z.infer<typeof experimentCopiedSchema>; // ../contract/src/experiment.responses.ts:120

// experiments.getExperimentDSPyRuns
// Input: inline, ../contract/src/experiment.trpc.ts:240
interface Input {
  projectId: string;
  experimentSlug: string;
}
// Output: z.array(dSPyRunsSummarySchema) (inline, ../contract/src/experiment.trpc.ts:241)

// experiments.getExperimentDSPyStep
// Input: inline, ../contract/src/experiment.trpc.ts:245
interface Input {
  projectId: string;
  experimentSlug: string;
  runId: string;
  index: string;
}
type Output = z.infer<typeof dSPyStepSchema>; // ../contract/src/experiment-legacy.ts:60

// experiments.getExperimentBatchEvaluationRuns
// Input: inline, ../contract/src/experiment.trpc.ts:258
interface Input {
  projectId: string;
  experimentId: string;
}
type Output = z.infer<typeof experimentRunListSchema>; // ../contract/src/experiment.responses.ts:111

// experiments.getExperimentBatchEvaluationRun
// Input: inline, ../contract/src/experiment.trpc.ts:269
interface Input {
  projectId: string;
  experimentId: string;
  runId: string;
}
// Output: experimentRunWithItemsSchema.nullable() (inline, ../contract/src/experiment.trpc.ts:270)
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `experiment_lifecycle` (aggregate `experiment_lifecycle`)

Declared at `src/eventing/experiment-lifecycle.pipeline.ts:30`. Events: `experimentRanEventSchema`.

| Kind    | Name                  | Handles | Declared at                                        |
| ------- | --------------------- | ------- | -------------------------------------------------- |
| command | `recordExperimentRan` | –       | `src/eventing/experiment-lifecycle.pipeline.ts:35` |

### Pipeline `experiment_run_processing` (aggregate `experiment_run`)

Declared at `src/eventing/experiment-run-processing.pipeline.ts:128`. Events: `experimentRunStartedEventSchema`, `targetResultEventSchema`, `evaluatorResultEventSchema`, `traceMetricsComputedEventSchema`, `experimentRunCompletedEventSchema`, `workflowEvaluationRequestedEventSchema`, `cellFinishedEventSchema`, `abortRequestedEventSchema`.

| Kind                       | Name                                                                                           | Handles                                                          | Declared at                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------- |
| process manager            | `experimentRunExecution`                                                                       | intents `complete`, `failCell`, `executeCell` (outbox)           | `src/eventing/experiment-run-processing.pipeline.ts:164` |
| subscriber                 | `workflowEvaluationRequested`                                                                  | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:160` |
| peer subscriber            | `traceSpanMetricsSync`                                                                         | `lw.obs.trace.span_received` from [trace](../../trace/README.md) | `src/eventing/experiment-run-processing.pipeline.ts:169` |
| ClickHouse fold projection | `≈ ExperimentRunStateFoldProjection.create({ store: deps.experimentRunStateFoldStore, })`      | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:144` |
| ClickHouse fold projection | `≈ ExperimentRunPlanFoldProjection.create({ store: deps.experimentRunPlanFoldStore })`         | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:149` |
| ClickHouse fold projection | `≈ ExperimentRunProgressFoldProjection.create({ store: deps.experimentRunProgressFoldStore })` | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:152` |
| ClickHouse map projection  | `≈ ExperimentRunResultStorageMapProjection.create({ store: deps.experimentRunItemAppendStore…` | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:155` |
| projection subscriber      | `≈ deps.runFrames.name`                                                                        | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:168` |
| retention                  | `≈ deps.retention`                                                                             | –                                                                | `src/eventing/experiment-run-processing.pipeline.ts:190` |

## Configuration

| Kind   | Leaf                  | Environment variable               | Declared at                               |
| ------ | --------------------- | ---------------------------------- | ----------------------------------------- |
| config | `blockLocalHttpCalls` | `BLOCK_LOCAL_HTTP_CALLS`           | `../contract/src/experiment.config.ts:14` |
| config | `allowedProxyHosts`   | `ALLOWED_PROXY_HOSTS`              | `../contract/src/experiment.config.ts:15` |
| config | `runConcurrency`      | `EVAL_V3_CONCURRENCY`              | `../contract/src/experiment.config.ts:17` |
| config | `publicBaseUrl`       | `BASE_HOST`                        | `../contract/src/experiment.config.ts:19` |
| config | `legacyPublicBaseUrl` | `NEXT_PUBLIC_BASE_URL`             | `../contract/src/experiment.config.ts:21` |
| config | `foldCacheTtlSeconds` | `LANGWATCH_FOLD_CACHE_TTL_SECONDS` | `../contract/src/experiment.config.ts:29` |
| config | `isSaas`              | `IS_SAAS`                          | `../contract/src/experiment.config.ts:30` |

<!-- readme:generated:end -->
