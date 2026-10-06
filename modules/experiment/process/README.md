# @langwatch/experiment-process

The server half of [experiment](../README.md). Experiments: saved definitions, their runs, and the pages that list them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("experiment").withRepositories(experimentRepositories).withApi(ExperimentModule).withTransports(experimentV3Rest, experimentRest, experimentInitRest, experimentDspyStepsRest, experimentWorkbenchRunRest, experimentV3LegacyRest, experimentWorkbenchRunLegacyRest, experimentTrpcTransport).withTransportFacts(…).withEventing(experimentRunProcessingEventing).withEventing(experimentLifecycleEventing)`, `src/experiment.module.ts:25`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ExperimentApi`)

Peers call these through the token, declared at `../contract/src/experiment.api.ts:141`; nothing else in this package is public.

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

#### `computeRunMetrics`

One experiment trace's cost, sent to the run pipeline to fold into its run.

```typescript
computeRunMetrics(input: ComputeExperimentRunMetricsCommandData): Promise<void>;
```

#### `lookupExperimentId`

The experiment a run was recorded against, or that no experiment recorded it.

```typescript
lookupExperimentId(input: { tenantId: string; runId: string }): Promise<ExperimentIdLookupResult>;
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
type Response = z.infer<typeof dSPyLogStepsResponseSchema>; // ../contract/src/experiment-legacy.ts:103
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
type Body = z.infer<typeof experimentInitBodySchema>; // ../contract/src/experiment.rest.ts:54
type Response = z.infer<typeof experimentInitResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:467
```

### `experimentV3LegacyRest`

|             |                                                 |
| ----------- | ----------------------------------------------- |
| Declared at | `src/transport/experiment-v3-legacy.rest.ts:46` |
| Base URL    | `/api/evaluations/v3`                           |
| Addressing  | v1-in-path                                      |
| Credential  | project                                         |

#### `POST /:evaluationSlug/run` · `postApiEvaluationsV3BySlugRun`

Permission `evaluations:create`. Declared at `src/transport/experiment-v3-legacy.rest.ts:51`.

Answers at `/api/evaluations/v3/:evaluationSlug/run`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:38
// Rawbody: "text" (inline, src/transport/experiment-v3-legacy.rest.ts:53)
// Response: "negotiated" (inline, src/transport/experiment-v3-legacy.rest.ts:56)
```

#### `GET /runs` · `getApiEvaluationsV3Runs`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:73`.

Answers at `/api/evaluations/v3/runs`.

```typescript
type Query = z.infer<typeof listRunsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:48
```

#### `GET /runs/:runId` · `getApiEvaluationsV3RunsByRunId`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:80`.

Answers at `/api/evaluations/v3/runs/:runId`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:11
type Response = z.infer<typeof runStatusResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:258
```

#### `GET /runs/:runId/results` · `getApiEvaluationsV3RunsByRunIdResults`

Permission `evaluations:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:87`.

Answers at `/api/evaluations/v3/runs/:runId/results`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:11
type Query = z.infer<typeof runResultsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:54
type Response = z.infer<typeof runResultsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:333
```

#### `GET /:evaluationSlug/workbench-state` · `getApiEvaluationsV3BySlugWorkbenchState`

Permission `experiments:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:95`.

Answers at `/api/evaluations/v3/:evaluationSlug/workbench-state`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:38
type Query = z.infer<typeof workbenchStateQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:61
type Response = z.infer<typeof workbenchStateAnswerSchema>; // ../contract/src/experiment-workbench-rest.ts:399
```

#### `PUT /:evaluationSlug/workbench-state` · `putApiEvaluationsV3BySlugWorkbenchState`

Permission `experiments:update`. Declared at `src/transport/experiment-v3-legacy.rest.ts:109`.

Answers at `/api/evaluations/v3/:evaluationSlug/workbench-state`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:38
type Body = z.infer<typeof saveWorkbenchStateBodySchema>; // ../contract/src/experiment-workbench-rest.ts:404
type Response = z.infer<typeof saveWorkbenchStateResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:416
```

#### `GET /:evaluationSlug/versions` · `getApiEvaluationsV3BySlugVersions`

Permission `experiments:view`. Declared at `src/transport/experiment-v3-legacy.rest.ts:123`.

Answers at `/api/evaluations/v3/:evaluationSlug/versions`.

```typescript
type Params = z.infer<typeof evaluationSlugParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:38
type Query = z.infer<typeof listVersionsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:68
type Response = z.infer<typeof listWorkbenchVersionsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:447
```

#### `POST /:evaluationSlug/versions/:version/restore` · `postApiEvaluationsV3BySlugVersionsByVersionRestore`

Permission `experiments:update`. Declared at `src/transport/experiment-v3-legacy.rest.ts:133`.

Answers at `/api/evaluations/v3/:evaluationSlug/versions/:version/restore`.

```typescript
type Params = z.infer<typeof evaluationSlugVersionParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:42
type Body = z.infer<typeof restoreWorkbenchVersionBodySchema>; // ../contract/src/experiment-workbench-rest.ts:457
type Response = z.infer<typeof restoreWorkbenchVersionResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:459
```

### `experimentWorkbenchRunLegacyRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/experiment-v3-legacy.rest.ts:155` |
| Base URL    | `/api/evaluations/v3`                            |
| Addressing  | v1-in-path                                       |
| Credential  | browser                                          |

#### `POST /execute` · `executeEvaluationsV3Experiment`

Permission `evaluations:manage`. Declared at `src/transport/experiment-v3-legacy.rest.ts:161`.

Answers at `/api/evaluations/v3/execute`.

```typescript
type Body = z.infer<typeof executionRequestSchema>; // ../contract/src/workbench/execution/types.ts:163
// Response: "sse" (inline, src/transport/experiment-v3-legacy.rest.ts:164)
```

#### `POST /abort` · `abortEvaluationsV3ExperimentRun`

Permission `evaluations:manage`. Declared at `src/transport/experiment-v3-legacy.rest.ts:170`.

Answers at `/api/evaluations/v3/abort`.

```typescript
type Body = z.infer<typeof abortExperimentRunRequestSchema>; // ../contract/src/workbench/execution/types.ts:215
type Response = z.infer<typeof abortExperimentRunResponseSchema>; // ../contract/src/workbench/execution/types.ts:220
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
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
// Rawbody: "text" (inline, src/transport/experiment-v3.rest.ts:93)
// Response: "negotiated" (inline, src/transport/experiment-v3.rest.ts:96)
```

#### `GET /runs` · `getApiExperimentsRuns`

List runs of an experiment

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:140`.

Answers at `/api/experiments/runs`, `/api/v1/experiments/runs`; also, undocumented, `/api/experiments/2026-08-07/runs`, `/api/v1/experiments/2026-08-07/runs`, `/api/experiments/latest/runs`, `/api/v1/experiments/latest/runs`.

```typescript
type Query = z.infer<typeof listRunsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:48
```

#### `GET /runs/:runId` · `getApiExperimentsRunsByRunId`

Poll a run

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:165`.

Answers at `/api/experiments/runs/:runId`, `/api/v1/experiments/runs/:runId`; also, undocumented, `/api/experiments/2026-08-07/runs/:runId`, `/api/v1/experiments/2026-08-07/runs/:runId`, `/api/experiments/latest/runs/:runId`, `/api/v1/experiments/latest/runs/:runId`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:11
type Response = z.infer<typeof runStatusResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:258
```

#### `GET /runs/:runId/results` · `getApiExperimentsRunsByRunIdResults`

Read run results

Permission `evaluations:view`. Declared at `src/transport/experiment-v3.rest.ts:182`.

Answers at `/api/experiments/runs/:runId/results`, `/api/v1/experiments/runs/:runId/results`; also, undocumented, `/api/experiments/2026-08-07/runs/:runId/results`, `/api/v1/experiments/2026-08-07/runs/:runId/results`, `/api/experiments/latest/runs/:runId/results`, `/api/v1/experiments/latest/runs/:runId/results`.

```typescript
type Params = z.infer<typeof runIdParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:11
type Query = z.infer<typeof runResultsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:54
type Response = z.infer<typeof runResultsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:333
```

#### `GET /:slug/workbench-state` · `getApiExperimentsBySlugWorkbenchState`

Read an experiment's setup

Permission `experiments:view`. Declared at `src/transport/experiment-v3.rest.ts:206`.

Answers at `/api/experiments/:slug/workbench-state`, `/api/v1/experiments/:slug/workbench-state`; also, undocumented, `/api/experiments/2026-08-07/:slug/workbench-state`, `/api/v1/experiments/2026-08-07/:slug/workbench-state`, `/api/experiments/latest/:slug/workbench-state`, `/api/v1/experiments/latest/:slug/workbench-state`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Query = z.infer<typeof workbenchStateQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:61
type Response = z.infer<typeof workbenchStateAnswerSchema>; // ../contract/src/experiment-workbench-rest.ts:399
```

#### `PUT /:slug/workbench-state` · `putApiExperimentsBySlugWorkbenchState`

Save an experiment's setup

Permission `experiments:update`. Declared at `src/transport/experiment-v3.rest.ts:229`.

Answers at `/api/experiments/:slug/workbench-state`, `/api/v1/experiments/:slug/workbench-state`; also, undocumented, `/api/experiments/2026-08-07/:slug/workbench-state`, `/api/v1/experiments/2026-08-07/:slug/workbench-state`, `/api/experiments/latest/:slug/workbench-state`, `/api/v1/experiments/latest/:slug/workbench-state`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Body = z.infer<typeof saveWorkbenchStateBodySchema>; // ../contract/src/experiment-workbench-rest.ts:404
type Response = z.infer<typeof saveWorkbenchStateResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:416
```

#### `GET /:slug/versions` · `getApiExperimentsBySlugVersions`

List an experiment's versions

Permission `experiments:view`. Declared at `src/transport/experiment-v3.rest.ts:261`.

Answers at `/api/experiments/:slug/versions`, `/api/v1/experiments/:slug/versions`; also, undocumented, `/api/experiments/2026-08-07/:slug/versions`, `/api/v1/experiments/2026-08-07/:slug/versions`, `/api/experiments/latest/:slug/versions`, `/api/v1/experiments/latest/:slug/versions`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Query = z.infer<typeof listVersionsQuerySchema>; // ../contract/src/experiment-workbench-rest.ts:68
type Response = z.infer<typeof listWorkbenchVersionsResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:447
```

#### `POST /:slug/versions/:version/restore` · `postApiExperimentsBySlugVersionsByVersionRestore`

Restore an experiment version

Permission `experiments:update`. Declared at `src/transport/experiment-v3.rest.ts:284`.

Answers at `/api/experiments/:slug/versions/:version/restore`, `/api/v1/experiments/:slug/versions/:version/restore`; also, undocumented, `/api/experiments/2026-08-07/:slug/versions/:version/restore`, `/api/v1/experiments/2026-08-07/:slug/versions/:version/restore`, `/api/experiments/latest/:slug/versions/:version/restore`, `/api/v1/experiments/latest/:slug/versions/:version/restore`.

```typescript
type Params = z.infer<typeof slugVersionParamsSchema>; // ../contract/src/experiment-workbench-rest.ts:30
type Body = z.infer<typeof restoreWorkbenchVersionBodySchema>; // ../contract/src/experiment-workbench-rest.ts:457
type Response = z.infer<typeof restoreWorkbenchVersionResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:459
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
// Response: "sse" (inline, src/transport/experiment-workbench-run.rest.ts:27)
```

#### `POST /abort` · `abortExperimentRun`

Permission `evaluations:manage`. Hidden from the OpenAPI document. Declared at `src/transport/experiment-workbench-run.rest.ts:34`.

Answers at `/api/experiments/abort`, `/api/v1/experiments/abort`; also, undocumented, `/api/experiments/2026-08-07/abort`, `/api/v1/experiments/2026-08-07/abort`, `/api/experiments/latest/abort`, `/api/v1/experiments/latest/abort`.

```typescript
type Body = z.infer<typeof abortExperimentRunRequestSchema>; // ../contract/src/workbench/execution/types.ts:215
type Response = z.infer<typeof abortExperimentRunResponseSchema>; // ../contract/src/workbench/execution/types.ts:220
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
type Query = z.infer<typeof listExperimentsQuerySchema>; // ../contract/src/experiment.rest.ts:38
type Response = z.infer<typeof experimentsListResponseSchema>; // ../contract/src/experiment.rest.ts:28
```

#### `GET /:slug` · `getApiExperimentsBySlug`

Read one experiment

Permission `experiments:view`. Declared at `src/transport/experiment.rest.ts:112`.

Answers at `/api/experiments/:slug`, `/api/v1/experiments/:slug`; also, undocumented, `/api/experiments/2026-08-07/:slug`, `/api/v1/experiments/2026-08-07/:slug`, `/api/experiments/latest/:slug`, `/api/v1/experiments/latest/:slug`.

```typescript
type Params = z.infer<typeof slugParamsSchema>; // ../contract/src/experiment.rest.ts:45
type Response = z.infer<typeof experimentSummarySchema>; // ../contract/src/experiment.rest.ts:16
```

#### `POST /` · `postApiExperiments`

Create an experiment and its setup

Permission `experiments:create`. Declared at `src/transport/experiment.rest.ts:138`.

Answers at `/api/experiments`, `/api/v1/experiments`; also, undocumented, `/api/experiments/2026-08-07`, `/api/v1/experiments/2026-08-07`, `/api/experiments/latest`, `/api/v1/experiments/latest`.

```typescript
type Body = z.infer<typeof createExperimentBodySchema>; // ../contract/src/experiment-workbench-rest.ts:364
type Response = z.infer<typeof createExperimentResponseSchema>; // ../contract/src/experiment-workbench-rest.ts:375
```

## tRPC transport

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

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `experiment_lifecycle` (aggregate `experiment_lifecycle`)

Declared at `src/eventing/experiment-lifecycle.pipeline.ts:30`. Events: `experimentRanEventSchema`.

| Kind    | Name                  | Handles | Declared at                                        |
| ------- | --------------------- | ------- | -------------------------------------------------- |
| command | `recordExperimentRan` | –       | `src/eventing/experiment-lifecycle.pipeline.ts:35` |

### Pipeline `experiment_run_processing` (aggregate `experiment_run`)

Declared at `src/eventing/experiment-run-processing.pipeline.ts:119`. Events: `experimentRunStartedEventSchema`, `targetResultEventSchema`, `evaluatorResultEventSchema`, `traceMetricsComputedEventSchema`, `experimentRunCompletedEventSchema`, `workflowEvaluationRequestedEventSchema`, `cellFinishedEventSchema`, `abortRequestedEventSchema`.

| Kind                       | Name                                                                                           | Handles                                                | Declared at                                              |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------ | -------------------------------------------------------- |
| process manager            | `experimentRunExecution`                                                                       | intents `complete`, `failCell`, `executeCell` (outbox) | `src/eventing/experiment-run-processing.pipeline.ts:155` |
| subscriber                 | `workflowEvaluationRequested`                                                                  | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:151` |
| ClickHouse fold projection | `≈ ExperimentRunStateFoldProjection.create({ store: deps.experimentRunStateFoldStore, })`      | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:135` |
| ClickHouse fold projection | `≈ ExperimentRunPlanFoldProjection.create({ store: deps.experimentRunPlanFoldStore })`         | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:140` |
| ClickHouse fold projection | `≈ ExperimentRunProgressFoldProjection.create({ store: deps.experimentRunProgressFoldStore })` | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:143` |
| ClickHouse map projection  | `≈ ExperimentRunResultStorageMapProjection.create({ store: deps.experimentRunItemAppendStore…` | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:146` |
| projection subscriber      | `≈ deps.runFrames.name`                                                                        | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:159` |
| retention                  | `≈ deps.retention`                                                                             | –                                                      | `src/eventing/experiment-run-processing.pipeline.ts:161` |

## Configuration

| Kind   | Leaf                  | Environment variable     | Declared at                               |
| ------ | --------------------- | ------------------------ | ----------------------------------------- |
| config | `blockLocalHttpCalls` | `BLOCK_LOCAL_HTTP_CALLS` | `../contract/src/experiment.config.ts:13` |
| config | `allowedProxyHosts`   | `ALLOWED_PROXY_HOSTS`    | `../contract/src/experiment.config.ts:14` |
| config | `runConcurrency`      | `EVAL_V3_CONCURRENCY`    | `../contract/src/experiment.config.ts:16` |
| config | `publicBaseUrl`       | `BASE_HOST`              | `../contract/src/experiment.config.ts:18` |
| config | `isSaas`              | `IS_SAAS`                | `../contract/src/experiment.config.ts:20` |

<!-- readme:generated:end -->
