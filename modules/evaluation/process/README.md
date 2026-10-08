# @langwatch/evaluation-process

The server half of [evaluation](../README.md). Evaluations: running evaluators against traces, the evaluation runs that record their results, and the evaluator lists peers read.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("evaluation").withRepositories(evaluationRepositories).withApi(EvaluationModule).withTransports(evaluationTrpcTransport, evaluationsLegacyRest).withEventing(evaluationProcessingEventing).withEventing(evaluationLifecycleEventing)`, `src/evaluation.module.ts:13`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EvaluationApi`)

The complete callable Evaluation capability shared by process peers.

Peers call these through the token, declared at `../contract/src/evaluation.api.ts:58`; nothing else in this package is public.

#### `listEvaluators`

Every evaluator, with what this install and this project are missing for it.

```typescript
listEvaluators(input: EvaluationProjectScope): Promise<EvaluatorCatalogue>;
```

#### `listCustomEvaluators`

The project's own workflow-backed evaluators.

```typescript
listCustomEvaluators(input: EvaluationProjectScope): Promise<CustomEvaluator[]>;
```

#### `runTraceEvaluation`

Scores one stored trace now, and reports the verdict onto the pipeline.

```typescript
runTraceEvaluation(input: RunTraceEvaluationInput, by: Readonly<{ id: string }>): Promise<EvaluationRunOutcome>;
```

#### `warmupEvaluators`

Nudges the evaluator runtime ahead of a run.

```typescript
warmupEvaluators(input: WarmupEvaluatorsInput): Promise<EvaluationWarmup>;
```

#### `executeForTrace`

```typescript
executeForTrace(input: ExecuteEvaluationCommand): Promise<EvaluationExecutionResult>;
```

#### `upsertRun`

```typescript
upsertRun(input: UpsertEvaluationRunCommand): Promise<void>;
```

#### `upsertRuns`

```typescript
upsertRuns(input: UpsertEvaluationRunCommand[]): Promise<void>;
```

#### `getRunByEvaluationId`

```typescript
getRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData>;
```

#### `findRunByEvaluationId`

```typescript
findRunByEvaluationId(input: EvaluationRunLookup): Promise<EvaluationRunData | null>;
```

#### `findRunsByTraceId`

```typescript
findRunsByTraceId(input: EvaluationRunsByTraceQuery): Promise<EvaluationRunData[]>;
```

#### `findSummariesByTraceIds`

```typescript
findSummariesByTraceIds(input: EvaluationSummariesByTraceIdsQuery): Promise<Record<string, EvaluationSummary[]>>;
```

#### `findTraceEvaluations`

```typescript
findTraceEvaluations(input: TraceEvaluationsQuery): Promise<Record<string, TraceEvaluationData[]>>;
```

#### `findInputs`

```typescript
findInputs(input: EvaluationInputsQuery): Promise<Record<string, unknown> | null>;
```

#### `getMonitorPerformance`

```typescript
getMonitorPerformance(input: MonitorPerformanceQuery): Promise<OnlineEvaluationPerformance[]>;
```

#### `findMonitorPerformance`

The seven-day trend of every monitor the project has; none when it has no monitors.

```typescript
findMonitorPerformance(input: MonitorPerformanceForProjectInput): Promise<OnlineEvaluationPerformance[]>;
```

#### `runEvaluator`

Runs one evaluator over one input, and never rejects for a domain reason.

```typescript
runEvaluator(input: RunEvaluatorInput): Promise<SingleEvaluationResult>;
```

#### `checkGuardrail`

Runs one guardrail's evaluator until its deadline or the caller's abort; records its cost.

```typescript
checkGuardrail(input: GuardrailCheckInput): Promise<GuardrailCheckOutcome>;
```

#### `resolveSavedEvaluator`

One saved evaluator, ready to run; throws when no evaluator answers to it.

```typescript
resolveSavedEvaluator(input: SavedEvaluatorLookup): Promise<SavedEvaluatorResolution>;
```

#### `findMonitorBySlug`

One monitor by slug, or null.

```typescript
findMonitorBySlug(input: EvaluationSlugLookup): Promise<EvaluationMonitorSummary | null>;
```

#### `findDatasetBySlug`

One dataset by slug, or null.

```typescript
findDatasetBySlug(input: EvaluationSlugLookup): Promise<EvaluationSlugMatch | null>;
```

#### `findModelForFeature`

The model the project's cascade resolves for one feature key, or null.

```typescript
findModelForFeature(input: EvaluationModelLookup): Promise<string | null>;
```

#### `recordEvaluationCost`

Records what a run of an evaluator cost.

```typescript
recordEvaluationCost(input: EvaluationCostRecord): Promise<EvaluationSlugMatch>;
```

#### `recordDatasetEvaluationRow`

Records one row of a dataset evaluation.

```typescript
recordDatasetEvaluationRow(input: DatasetEvaluationRow): Promise<void>;
```

#### `reportEvaluation`

Reports one verdict onto the evaluation processing pipeline.

```typescript
reportEvaluation(data: ReportEvaluationCommandData): Promise<void>;
```

#### `queueTraceEvaluation`

Queues a trace's online evaluation with the trigger's delay and dedup.

```typescript
queueTraceEvaluation(data: ExecuteEvaluationCommandData): Promise<void>;
```

#### `deriveEvaluatorId`

The evaluator-id slug rule for an evaluation that names no evaluator.

```typescript
deriveEvaluatorId(name: string): string;
```

#### `matchesEvaluationFilters`

The evaluation half of a trigger's legacy filters against a trace's runs.

```typescript
matchesEvaluationFilters(input: { filters: Readonly<Record<string, unknown>>; evaluations: EvaluationRunData[]; }): boolean;
```

#### `requestTopicClustering`

One topic-clustering call to langevals, staging an oversized body; aborts with the signal.

```typescript
requestTopicClustering(input: TopicClusteringRequest): Promise<TopicClusteringOutcome>;
```

#### `detectPii`

One Presidio batch through langevals: main's `/presidio/pii_detection/evaluate` call.

```typescript
detectPii(input: PiiDetectionRequest): Promise<PiiDetectionOutcome>;
```

## REST transport

### `evaluationsLegacyRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/evaluations-legacy.rest.ts:169` |
| Base URL    | none: each route's path is its address         |
| Addressing  | literal                                        |
| Credential  | project                                        |

#### `GET /api/evaluations/list` · `getApiEvaluationsList`

List the built-in evaluators

Public: static evaluator catalogue; the same list for every caller, no project data. Declared at `src/transport/evaluations-legacy.rest.ts:177`.

Answers at `/api/evaluations/list`, `/api/v1/evaluations/list`.

```typescript
// Response: "protocol" (inline, src/transport/evaluations-legacy.rest.ts:184)
```

#### `POST /api/evaluations/:evaluator/evaluate` · `postApiEvaluationsByEvaluatorEvaluate`

Run an evaluator

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:205`.

Answers at `/api/evaluations/:evaluator/evaluate`, `/api/v1/evaluations/:evaluator/evaluate`.

```typescript
type Params = z.infer<typeof evaluatorParamsSchema>; // ../contract/src/evaluation-legacy.schemas.ts:8
// Rawbody: "text" (inline, src/transport/evaluations-legacy.rest.ts:208)
// Response: "protocol" (inline, src/transport/evaluations-legacy.rest.ts:211)
```

#### `POST /api/evaluations/:evaluator/:subpath/evaluate` · `postApiEvaluationsByEvaluatorBySubpathEvaluate`

Run a namespaced evaluator

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:236`.

Answers at `/api/evaluations/:evaluator/:subpath/evaluate`, `/api/v1/evaluations/:evaluator/:subpath/evaluate`.

```typescript
type Params = z.infer<typeof namespacedEvaluatorParamsSchema>; // ../contract/src/evaluation-legacy.schemas.ts:16
// Rawbody: "text" (inline, src/transport/evaluations-legacy.rest.ts:242)
// Response: "protocol" (inline, src/transport/evaluations-legacy.rest.ts:245)
```

#### `POST /api/guardrails/:evaluator/evaluate` · `postApiGuardrailsByEvaluatorEvaluate`

Run an evaluator as a guardrail

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:270`.

Answers at `/api/guardrails/:evaluator/evaluate`, `/api/v1/guardrails/:evaluator/evaluate`.

```typescript
type Params = z.infer<typeof evaluatorParamsSchema>; // ../contract/src/evaluation-legacy.schemas.ts:8
// Rawbody: "text" (inline, src/transport/evaluations-legacy.rest.ts:272)
// Response: "protocol" (inline, src/transport/evaluations-legacy.rest.ts:275)
```

## tRPC transport

### `evaluations`

Contract `../contract/src/evaluation.trpc.ts:24`, router `src/transport/evaluation.trpc.ts:10`.

| Procedure                                     | Kind     | Gate                                            | Input                                     | Output                       |
| --------------------------------------------- | -------- | ----------------------------------------------- | ----------------------------------------- | ---------------------------- |
| `evaluations.availableEvaluators`             | query    | Permission `evaluations:view`                   | `evaluationProjectScopeSchema`            | `evaluatorCatalogueSchema`   |
| `evaluations.availableCustomEvaluators`       | query    | Permission `evaluations:view`                   | `evaluationProjectScopeSchema`            | inline                       |
| `evaluations.runEvaluation`                   | mutation | Permission `evaluations:manage`                 | `runTraceEvaluationInputSchema`           | `evaluationRunOutcomeSchema` |
| `evaluations.warmupLambda`                    | mutation | Permission `evaluations:view`                   | `warmupEvaluatorsInputSchema`             | `evaluationWarmupSchema`     |
| `evaluations.getMonitorPerformanceForProject` | query    | Permission `evaluations:view or analytics:view` | `monitorPerformanceForProjectInputSchema` | inline                       |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `evaluation_lifecycle` (aggregate `evaluation_lifecycle`)

Declared at `src/eventing/evaluation-lifecycle.pipeline.ts:39`. Events: `evaluationRanEventSchema`, `evaluationLifecycleCompletedEventSchema`.

| Kind    | Name                                 | Handles | Declared at                                        |
| ------- | ------------------------------------ | ------- | -------------------------------------------------- |
| command | `recordEvaluationRan`                | –       | `src/eventing/evaluation-lifecycle.pipeline.ts:44` |
| command | `recordEvaluationLifecycleCompleted` | –       | `src/eventing/evaluation-lifecycle.pipeline.ts:45` |

### Pipeline `evaluation_processing` (aggregate `evaluation`)

Declared at `src/eventing/evaluation-processing-definition.pipeline.ts:82`. Events: `evaluationScheduledEventSchema`, `evaluationStartedEventSchema`, `evaluationCompletedEventSchema`, `evaluationReportedEventSchema`.

| Kind                       | Name                                                                                           | Handles | Declared at                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------- | --------------------------------------------------------------- |
| command                    | –                                                                                              | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:122` |
| command                    | `startEvaluation`                                                                              | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:135` |
| command                    | `completeEvaluation`                                                                           | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:138` |
| command                    | `reportEvaluation`                                                                             | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:141` |
| ClickHouse fold projection | `≈ EvaluationRunFoldProjection.create({ store: this.deps.evalRunStore, })`                     | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:94`  |
| ClickHouse fold projection | `≈ EvaluationAnalyticsFoldProjection.create({ store: this.deps.evaluationAnalyticsStore, })`   | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:99`  |
| ClickHouse map projection  | `≈ EvaluationAnalyticsRollupMapProjection.create({ store: this.deps.evaluationAnalyticsRollu…` | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:104` |
| projection subscriber      | `lifecycleCompleted`                                                                           | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:109` |
| retention                  | `≈ retention`                                                                                  | –       | `src/eventing/evaluation-processing-definition.pipeline.ts:145` |

## Configuration

| Kind   | Leaf                             | Environment variable                 | Declared at                               |
| ------ | -------------------------------- | ------------------------------------ | ----------------------------------------- |
| secret | `openAi`                         | `OPENAI_API_KEY`                     | `src/app/evaluation.app.ts:266`           |
| secret | `azureContentSafety`             | `AZURE_CONTENT_SAFETY_KEY`           | `src/app/evaluation.app.ts:267`           |
| config | `langevalsEndpoint`              | `LANGEVALS_ENDPOINT`                 | `../contract/src/evaluation.config.ts:26` |
| config | `stagingThresholdBytes`          | `LANGEVALS_STAGING_THRESHOLD_BYTES`  | `../contract/src/evaluation.config.ts:27` |
| config | `stagingTtlSeconds`              | `LANGEVALS_STAGING_TTL_SECONDS`      | `../contract/src/evaluation.config.ts:28` |
| config | `evaluationMaxPayloadBytes`      | `EVAL_MAX_PAYLOAD_BYTES`             | `../contract/src/evaluation.config.ts:29` |
| config | `topicClusteringMaxPayloadBytes` | `TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES` | `../contract/src/evaluation.config.ts:30` |
| config | `azureContentSafetyEndpoint`     | `AZURE_CONTENT_SAFETY_ENDPOINT`      | `../contract/src/evaluation.config.ts:34` |
| config | `enablePresidio`                 | `LANGWATCH_ENABLE_PRESIDIO`          | `../contract/src/evaluation.config.ts:35` |
| config | `enableLingua`                   | `LANGWATCH_ENABLE_LINGUA`            | `../contract/src/evaluation.config.ts:36` |

<!-- readme:generated:end -->
