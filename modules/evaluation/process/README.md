# @langwatch/evaluation-process

The server half of [evaluation](../README.md). Evaluations: running evaluators against traces, the evaluation runs that record their results, and the evaluator lists peers read.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("evaluation").withRepositories(evaluationRepositories).withChannels(evaluationChannels).withApi(EvaluationModule).withTransports(evaluationTrpcTransport, evaluationsLegacyRest).withEventing(evaluationProcessingEventing).withEventing(evaluationLifecycleEventing)`, `src/evaluation.module.ts:16`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EvaluationApi`)

The complete callable Evaluation capability shared by process peers.

Peers call these through the token, declared at `../contract/src/evaluation.api.ts:52`; nothing else in this package is public.

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

#### `findInputs`

Read through the proof; null when none are stored or the viewer may not read content.

```typescript
findInputs(input: EvaluationInputsQuery & { authorization: Authorization; userId: string | null }): Promise<Record<string, unknown> | null>;
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
| Declared at | `src/transport/evaluations-legacy.rest.ts:147` |
| Base URL    | none: each route's path is its address         |
| Addressing  | literal                                        |
| Credential  | project                                        |

#### `GET /api/evaluations/list` · `getApiEvaluationsList`

List the built-in evaluators

Public: static evaluator catalogue; the same list for every caller, no project data. Declared at `src/transport/evaluations-legacy.rest.ts:155`.

Answers at `/api/evaluations/list`, `/api/v1/evaluations/list`.

```typescript
// Response: inline, src/transport/evaluations-legacy.rest.ts:162
type Response = unknown;
```

#### `POST /api/evaluations/:evaluator/evaluate` · `postApiEvaluationsByEvaluatorEvaluate`

Run an evaluator

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:183`.

Answers at `/api/evaluations/:evaluator/evaluate`, `/api/v1/evaluations/:evaluator/evaluate`.

```typescript
// Params: evaluatorParamsSchema, ../contract/src/evaluation-legacy.schemas.ts:8
interface Params {
  evaluator: string;
}
// Body: inline, src/transport/evaluations-legacy.rest.ts:186
type Body = Record<string, unknown>;
// Response: inline, src/transport/evaluations-legacy.rest.ts:189
type Response = unknown;
```

#### `POST /api/evaluations/:evaluator/:subpath/evaluate` · `postApiEvaluationsByEvaluatorBySubpathEvaluate`

Run a namespaced evaluator

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:213`.

Answers at `/api/evaluations/:evaluator/:subpath/evaluate`, `/api/v1/evaluations/:evaluator/:subpath/evaluate`.

```typescript
// Params: namespacedEvaluatorParamsSchema, ../contract/src/evaluation-legacy.schemas.ts:16
interface Params {
  evaluator: string;
  subpath: string;
}
// Body: inline, src/transport/evaluations-legacy.rest.ts:219
type Body = Record<string, unknown>;
// Response: inline, src/transport/evaluations-legacy.rest.ts:222
type Response = unknown;
```

#### `POST /api/guardrails/:evaluator/evaluate` · `postApiGuardrailsByEvaluatorEvaluate`

Run an evaluator as a guardrail

Permission `evaluations:manage`. Declared at `src/transport/evaluations-legacy.rest.ts:246`.

Answers at `/api/guardrails/:evaluator/evaluate`, `/api/v1/guardrails/:evaluator/evaluate`.

```typescript
type Params = z.infer<typeof evaluatorParamsSchema>; // ../contract/src/evaluation-legacy.schemas.ts:8
// Body: inline, src/transport/evaluations-legacy.rest.ts:248
type Body = Record<string, unknown>;
// Response: inline, src/transport/evaluations-legacy.rest.ts:251
type Response = unknown;
```

## tRPC transport

### `evaluations`

Contract `../contract/src/evaluation.trpc.ts:26`, router `src/transport/evaluation.trpc.ts:10`.

| Procedure                                     | Kind     | Gate                                            | Input                                     | Output                       |
| --------------------------------------------- | -------- | ----------------------------------------------- | ----------------------------------------- | ---------------------------- |
| `evaluations.availableEvaluators`             | query    | Permission `evaluations:view`                   | `evaluationProjectScopeSchema`            | `evaluatorCatalogueSchema`   |
| `evaluations.availableCustomEvaluators`       | query    | Permission `evaluations:view`                   | `evaluationProjectScopeSchema`            | inline                       |
| `evaluations.runEvaluation`                   | mutation | Permission `evaluations:manage`                 | `runTraceEvaluationInputSchema`           | `evaluationRunOutcomeSchema` |
| `evaluations.warmupLambda`                    | mutation | Permission `evaluations:view`                   | `warmupEvaluatorsInputSchema`             | `evaluationWarmupSchema`     |
| `evaluations.getMonitorPerformanceForProject` | query    | Permission `evaluations:view or analytics:view` | `monitorPerformanceForProjectInputSchema` | inline                       |
| `evaluations.getEvaluationInputs`             | query    | Permission `traces:view`                        | `evaluationInputsInputSchema`             | `evaluationInputsSchema`     |

```typescript
// evaluations.availableEvaluators
// Input: evaluationProjectScopeSchema, ../contract/src/evaluation-trpc.schemas.ts:9
interface Input {
  projectId: string;
}
type Output = z.infer<typeof evaluatorCatalogueSchema>; // ../contract/src/evaluation.responses.ts:33

// evaluations.availableCustomEvaluators
type Input = z.infer<typeof evaluationProjectScopeSchema>; // ../contract/src/evaluation-trpc.schemas.ts:9
// Output: inline, ../contract/src/evaluation.trpc.ts:39
type Output = {
  id: string;
  name: string;
  versions: Record<string, unknown>[];
  [key: string]: unknown;
}[];

// evaluations.runEvaluation
type Input = z.infer<typeof runTraceEvaluationInputSchema>; // ../contract/src/evaluation-trpc.schemas.ts:42
type Output = z.infer<typeof evaluationRunOutcomeSchema>; // ../contract/src/evaluation.responses.ts:39

// evaluations.warmupLambda
// Input: warmupEvaluatorsInputSchema, ../contract/src/evaluation-trpc.schemas.ts:51
interface Input {
  projectId: string;
  count?: number;
}
// Output: evaluationWarmupSchema, ../contract/src/evaluation.responses.ts:49
interface Output {
  success: boolean;
  count: number;
}

// evaluations.getMonitorPerformanceForProject
// Input: monitorPerformanceForProjectInputSchema, ../contract/src/evaluation.performance.ts:29
interface Input {
  projectId: string;
  timeZone?: string;
}
// Output: inline, ../contract/src/evaluation.trpc.ts:60
type Output = {
  monitorId: string;
  metric: "score" | "pass_rate";
  points: number[];
  current: number | null;
  previous: number | null;
}[];

// evaluations.getEvaluationInputs
// Input: evaluationInputsInputSchema, ../contract/src/evaluation-trpc.schemas.ts:13
interface Input {
  projectId: string;
  evaluationId: string;
  tenantId?: string;
}
// Output: evaluationInputsSchema, ../contract/src/evaluation-trpc.schemas.ts:21
type Output = Record<string, unknown> | null;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `evaluation_lifecycle` (aggregate `evaluation_lifecycle`)

Declared at `src/eventing/evaluation-lifecycle.pipeline.ts:42`. Events: `evaluationRanEventSchema`, `evaluationLifecycleCompletedEventSchema`.

| Kind      | Name                                 | Handles | Declared at                                        |
| --------- | ------------------------------------ | ------- | -------------------------------------------------- |
| command   | `recordEvaluationRan`                | –       | `src/eventing/evaluation-lifecycle.pipeline.ts:47` |
| command   | `recordEvaluationLifecycleCompleted` | –       | `src/eventing/evaluation-lifecycle.pipeline.ts:48` |
| retention | `≈ retention`                        | –       | `src/eventing/evaluation-lifecycle.pipeline.ts:49` |

### Pipeline `evaluation_processing` (aggregate `evaluation`)

Declared at `src/eventing/evaluation-processing-definition.pipeline.ts:125`. Events: `evaluationScheduledEventSchema`, `evaluationStartedEventSchema`, `evaluationCompletedEventSchema`, `evaluationReportedEventSchema`.

| Kind                       | Name                                                                                           | Handles                                                                      | Declared at                                                     |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- | --------------------------------------------------------------- |
| command                    | –                                                                                              | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:165` |
| command                    | `startEvaluation`                                                                              | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:178` |
| command                    | `completeEvaluation`                                                                           | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:181` |
| command                    | `reportEvaluation`                                                                             | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:184` |
| peer subscriber            | `traceEvaluationTrigger`                                                                       | `lw.obs.trace.span_received` from [trace](../../trace/README.md)             | `src/eventing/evaluation-processing-definition.pipeline.ts:192` |
| peer subscriber            | `traceOriginEvaluationTrigger`                                                                 | `lw.obs.trace.origin_resolved` from [trace](../../trace/README.md)           | `src/eventing/evaluation-processing-definition.pipeline.ts:210` |
| peer subscriber            | `traceCustomEvaluationSync`                                                                    | `lw.obs.trace.span_received` from [trace](../../trace/README.md)             | `src/eventing/evaluation-processing-definition.pipeline.ts:221` |
| peer subscriber            | `traceCollectorEvaluation`                                                                     | `lw.trace.collector_evaluation_received` from [trace](../../trace/README.md) | `src/eventing/evaluation-processing-definition.pipeline.ts:245` |
| ClickHouse fold projection | `≈ EvaluationRunFoldProjection.create({ store: this.deps.evalRunStore, })`                     | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:137` |
| ClickHouse fold projection | `≈ EvaluationAnalyticsFoldProjection.create({ store: this.deps.evaluationAnalyticsStore, })`   | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:142` |
| ClickHouse map projection  | `≈ EvaluationAnalyticsRollupMapProjection.create({ store: this.deps.evaluationAnalyticsRollu…` | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:147` |
| projection subscriber      | `lifecycleCompleted`                                                                           | –                                                                            | `src/eventing/evaluation-processing-definition.pipeline.ts:152` |

## Configuration

| Kind   | Leaf                             | Environment variable                 | Declared at                               |
| ------ | -------------------------------- | ------------------------------------ | ----------------------------------------- |
| secret | `openAi`                         | `OPENAI_API_KEY`                     | `src/app/evaluation.app.ts:277`           |
| secret | `azureContentSafety`             | `AZURE_CONTENT_SAFETY_KEY`           | `src/app/evaluation.app.ts:278`           |
| config | `langevalsEndpoint`              | `LANGEVALS_ENDPOINT`                 | `../contract/src/evaluation.config.ts:27` |
| config | `stagingThresholdBytes`          | `LANGEVALS_STAGING_THRESHOLD_BYTES`  | `../contract/src/evaluation.config.ts:28` |
| config | `stagingTtlSeconds`              | `LANGEVALS_STAGING_TTL_SECONDS`      | `../contract/src/evaluation.config.ts:29` |
| config | `evaluationMaxPayloadBytes`      | `EVAL_MAX_PAYLOAD_BYTES`             | `../contract/src/evaluation.config.ts:30` |
| config | `topicClusteringMaxPayloadBytes` | `TOPIC_CLUSTERING_MAX_PAYLOAD_BYTES` | `../contract/src/evaluation.config.ts:31` |
| config | `azureContentSafetyEndpoint`     | `AZURE_CONTENT_SAFETY_ENDPOINT`      | `../contract/src/evaluation.config.ts:35` |
| config | `enablePresidio`                 | `LANGWATCH_ENABLE_PRESIDIO`          | `../contract/src/evaluation.config.ts:36` |
| config | `enableLingua`                   | `LANGWATCH_ENABLE_LINGUA`            | `../contract/src/evaluation.config.ts:37` |
| config | `foldCacheTtlSeconds`            | `LANGWATCH_FOLD_CACHE_TTL_SECONDS`   | `../contract/src/evaluation.config.ts:38` |

<!-- readme:generated:end -->
