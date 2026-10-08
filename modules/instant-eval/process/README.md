# @langwatch/instant-eval-process

The server half of [instant-eval](../README.md). Instant evaluations: the opt-in, the estimate, and running or cancelling an instant evaluation over sampled data.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("instant-eval").withRepositories(instantEvalRepositories).withApi(InstantEvalModule).withTransports(instantEvalRest).withTransportFacts(…).withEventing(instantEvalEventing)`, `src/instant-eval.module.ts:14`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InstantEvalApi`)

Peers call these through the token, declared at `../contract/src/instant-eval.api.ts:96`; nothing else in this package is public.

#### `isEnabled`

Whether this project may run Instant Evals at all.

```typescript
isEnabled(input: { projectId: string }): Promise<boolean>;
```

#### `isReleased`

The product decision alone, whatever the deployment has configured: a released project with no judge still gets the "configure a model" primer.

```typescript
isReleased(input: { projectId: string }): Promise<boolean>;
```

#### `getOptInAccess`

Released or not, and what the refusal popover offers this member: the organization's own switch, a word with their admin, or a word with us.

```typescript
getOptInAccess(input: { projectId: string; userId: string }): Promise<InstantEvalOptInAccess>;
```

#### `optIn`

Throws the project's organization's switch; refused where the popover offers us instead.

```typescript
optIn(input: { projectId: string; userId: string }): Promise<InstantEvalOptInAccess>;
```

#### `createRun`

Accepts a statement, holds its price against the free budget, records the run and queues it. Everything after this is the pipeline's.

```typescript
createRun(input: { projectId: string; actor: InstantEvalActor; input: InstantEvalRunInput; }): Promise<InstantEvalRunWire>;
```

#### `estimateRun`

What the run would read and what judging it would cost, judging nothing.

```typescript
estimateRun(input: { projectId: string; actor: InstantEvalActor; input: InstantEvalRunInput; }): Promise<InstantEvalEstimateWire>;
```

#### `cancelRun`

Asks a run to stop. A run that already finished is refused by name.

```typescript
cancelRun(input: { projectId: string; runId: string; requestedByUserId?: string; }): Promise<InstantEvalRunWire>;
```

#### `getSample`

A few of a run's rows, with the text that was judged beside the verdict.

```typescript
getSample(input: { projectId: string; actor: InstantEvalActor; runId: string; rows: number; }): Promise<InstantEvalSampleWire>;
```

#### `findRuns`

The project's runs, newest first. Empty when it has none.

```typescript
findRuns(input: { projectId: string; limit: number; /** With `beforeId`: the two together are the list's cursor. */ before?: Instant; beforeId?: string; }): Promise<InstantEvalRunWire[]>;
```

#### `getRun`

```typescript
getRun(input: { projectId: string; runId: string }): Promise<InstantEvalRunWire>;
```

#### `getResultsPage`

One page of a run's judgements.

```typescript
getResultsPage(input: { projectId: string; runId: string; limit: number; questionId?: string; isMatched?: boolean; status?: InstantEvalJudgmentStatus; cursor?: string; }): Promise<InstantEvalResultsWire>;
```

#### `findRunProgress`

The counters of the runs a client named, dropping ids it may not read. Lenient by design: the read carrying them is the list the user is looking at, and a refusal there would blank the table for a chip matching nothing.

```typescript
findRunProgress(input: { projectId: string; runIds: readonly string[]; }): Promise<InstantEvalRunProgress[]>;
```

#### `findRunWindows`

The runs a reader named, dated, so a judgement read can be bounded by the window each was written in. Lenient like {@link findRunProgress}: a run this project does not own is dropped rather than refused.

```typescript
findRunWindows(input: { projectId: string; references: readonly InstantEvalRunReference[]; }): Promise<InstantEvalRunWindow[]>;
```

#### `classify`

One classification of a peer's own text rather than a run's rows, which is how the trace search bar routes a sentence. A judge that cannot answer skips, so the caller falls back instead of failing the read.

```typescript
classify(input: { projectId: string; text: string; questions: readonly InstantEvalQuestion[]; /** Aborts the judgement when the caller has gone, as a hosted call's request does. */ signal?: AbortSignal; }): Promise<InstantEvalJudgement>;
```

#### `judgeQuery`

One synchronous query's judged columns, their texts in place (Alex, 2026-10-06, "Judge cycle"): holds the query token budget's price, judges, records the spend once, then drops the hold. Refuses an exhausted budget or an oversized query before anything is judged.

```typescript
judgeQuery(input: InstantEvalQueryJudgingInput): Promise<InstantEvalQueryJudging>;
```

#### `priceOf`

What judging these input tokens cost LangWatch and what the customer is charged, in USD.

```typescript
priceOf(input: { inputTokens: number }): { costUsd: number; priceUsd: number };
```

#### `recordSpendForHostedCalls`

Main's hosted-call recorder: a Connect licence's judgements, billed to the calling key. It throws where the spend spine is not registered, so the caller keeps the spend and retries.

```typescript
recordSpendForHostedCalls(input: { projectId: string; virtualKeyId: string; inputTokens: number; requests: number; costUsd: number; priceUsd: number; occurredAt: Instant; }): Promise<void>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number; }): Promise<InstantEvalUsageCount>;
```

## REST transport

### `instantEvalRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/instant-eval.rest.ts:69` |
| Base URL    | `/api/v1/instant-evals`                 |
| Addressing  | v1-only                                 |
| Credential  | project                                 |

#### `POST /` · `createInstantEvalRun`

Start a run. The statement is accepted, its questions are derived from the eval functions it projects, and the judging happens on the queue: the answer is the queued run, and its progress is read back from the run endpoint. A statement the query policy refuses, one that projects no TraceId, one that projects no eval function, and a row limit past what the plan allows are all refused before anything is judged. Instead of a statement you may send a target and your questions, and the statement is written for you and handed back on the run; sending both is refused.

Permission `analytics:manage`. Declared at `src/transport/instant-eval.rest.ts:74`.

Answers at `/api/v1/instant-evals`.

```typescript
type Body = z.infer<typeof instantEvalRunInputSchema>; // ../contract/src/instant-eval.schemas.ts:152
type Response = z.infer<typeof instantEvalRunSchema>; // ../contract/src/instant-eval.schemas.ts:318
```

#### `POST /estimate` · `estimateInstantEvalRun`

Estimate a run

Permission `analytics:manage`. Declared at `src/transport/instant-eval.rest.ts:92`.

Answers at `/api/v1/instant-evals/estimate`.

```typescript
type Body = z.infer<typeof instantEvalRunInputSchema>; // ../contract/src/instant-eval.schemas.ts:152
type Response = z.infer<typeof instantEvalEstimateSchema>; // ../contract/src/instant-eval.schemas.ts:364
```

#### `GET /` · `listInstantEvalRuns`

List the project's runs, newest first. The project comes from the credential, so a run of another project is never listed. Page through them with before, which takes the created time of the oldest run the previous page carried.

Permission `analytics:view`. Declared at `src/transport/instant-eval.rest.ts:110`.

Answers at `/api/v1/instant-evals`.

```typescript
type Query = z.infer<typeof instantEvalListQuerySchema>; // ../contract/src/instant-eval.schemas.ts:218
type Response = z.infer<typeof instantEvalRunListSchema>; // ../contract/src/instant-eval.schemas.ts:408
```

#### `GET /:id` · `getInstantEvalRun`

Read one run: its status, how many rows it found and judged, how many matched in total and per question, what it could not answer, and the tokens, cost and price the judging came to. An id this project does not hold answers 404 instant_eval_not_found.

Permission `analytics:view`. Declared at `src/transport/instant-eval.rest.ts:127`.

Answers at `/api/v1/instant-evals/:id`.

```typescript
type Params = z.infer<typeof instantEvalIdParamsSchema>; // ../contract/src/instant-eval.schemas.ts:214
type Response = z.infer<typeof instantEvalRunSchema>; // ../contract/src/instant-eval.schemas.ts:318
```

#### `POST /:id/cancel` · `cancelInstantEvalRun`

Cancel a run

Permission `analytics:manage`. Declared at `src/transport/instant-eval.rest.ts:138`.

Answers at `/api/v1/instant-evals/:id/cancel`.

```typescript
type Params = z.infer<typeof instantEvalIdParamsSchema>; // ../contract/src/instant-eval.schemas.ts:214
type Body = z.infer<typeof cancelInstantEvalRunBodySchema>; // ../contract/src/instant-eval.schemas.ts:212
type Response = z.infer<typeof instantEvalRunSchema>; // ../contract/src/instant-eval.schemas.ts:318
```

#### `GET /:id/results` · `listInstantEvalRunResults`

Read a run's results

Permission `analytics:view`. Declared at `src/transport/instant-eval.rest.ts:160`.

Answers at `/api/v1/instant-evals/:id/results`.

```typescript
type Params = z.infer<typeof instantEvalIdParamsSchema>; // ../contract/src/instant-eval.schemas.ts:214
type Query = z.infer<typeof instantEvalResultsQuerySchema>; // ../contract/src/instant-eval.schemas.ts:257
type Response = z.infer<typeof instantEvalResultsSchema>; // ../contract/src/instant-eval.schemas.ts:412
```

#### `GET /:id/sample` · `sampleInstantEvalRun`

Sample a run

Permission `analytics:view`. Declared at `src/transport/instant-eval.rest.ts:183`.

Answers at `/api/v1/instant-evals/:id/sample`.

```typescript
type Params = z.infer<typeof instantEvalIdParamsSchema>; // ../contract/src/instant-eval.schemas.ts:214
type Query = z.infer<typeof instantEvalSampleQuerySchema>; // ../contract/src/instant-eval.schemas.ts:282
type Response = z.infer<typeof instantEvalSampleSchema>; // ../contract/src/instant-eval.schemas.ts:420
```

## tRPC transport

None: this module declares no tRPC router.

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `instant_eval_processing` (aggregate `instant_eval_run`)

Declared at `src/eventing/instant-eval-processing.pipeline.ts:60`. Events: `instantEvalRequestedEventSchema`, `instantEvalPlannedEventSchema`, `instantEvalPageJudgedEventSchema`, `instantEvalCancelRequestedEventSchema`, `instantEvalFinishedEventSchema`.

| Kind                | Name                                                                    | Handles                                        | Declared at                                           |
| ------------------- | ----------------------------------------------------------------------- | ---------------------------------------------- | ----------------------------------------------------- |
| command             | `requestRun`                                                            | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:74` |
| command             | `recordPlanned`                                                         | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:75` |
| command             | `recordPageJudged`                                                      | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:76` |
| command             | `requestCancel`                                                         | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:82` |
| command             | `recordFinished`                                                        | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:83` |
| process manager     | `instantEval`                                                           | intents `finish`, `judgePage`, `plan` (outbox) | `src/eventing/instant-eval-processing.pipeline.ts:84` |
| Postgres projection | `≈ createInstantEvalRunProjection({ store: deps.instantEvalRunStore })` | –                                              | `src/eventing/instant-eval-processing.pipeline.ts:73` |

## Configuration

| Kind   | Leaf                    | Environment variable                    | Declared at                                 |
| ------ | ----------------------- | --------------------------------------- | ------------------------------------------- |
| secret | `classifierApiKey`      | `JEV_API_KEY`                           | `src/app/instant-eval.app.ts:147`           |
| config | `classifier`            | `INSTANT_EVAL_CLASSIFIER`               | `../contract/src/instant-eval.config.ts:12` |
| config | `classifierBaseUrl`     | `JEV_BASE_URL`                          | `../contract/src/instant-eval.config.ts:17` |
| config | `classifierModel`       | `JEV_MODEL`                             | `../contract/src/instant-eval.config.ts:25` |
| config | `globalTokensPerSecond` | `INSTANT_EVAL_GLOBAL_TOKENS_PER_SECOND` | `../contract/src/instant-eval.config.ts:27` |
| config | `tenantTokensPerSecond` | `INSTANT_EVAL_TENANT_TOKENS_PER_SECOND` | `../contract/src/instant-eval.config.ts:32` |
| config | `isBounded`             | `INSTANT_EVAL_BOUNDED`                  | `../contract/src/instant-eval.config.ts:41` |
| config | `queryTokenBudget`      | `INSTANT_EVAL_QUERY_TOKEN_BUDGET`       | `../contract/src/instant-eval.config.ts:43` |
| config | `isSaas`                | `IS_SAAS`                               | `../contract/src/instant-eval.config.ts:48` |
| config | `nodeEnvironment`       | `NODE_ENV`                              | `../contract/src/instant-eval.config.ts:50` |

<!-- readme:generated:end -->
