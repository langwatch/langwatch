# @langwatch/evaluator-process

The server half of [evaluator](../README.md). Evaluators: their definitions, and executing them as code or native checks with the settings a run resolves.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("evaluator").withRepositories(evaluatorRepositories).withApi(EvaluatorModule).withTransports(…, evaluatorTrpcTransport)`, `src/evaluator.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EvaluatorApi`)

Peers call these through the token, declared at `../contract/src/evaluator.api.ts:62`; nothing else in this package is public.

#### `executeCode`

Runs a code evaluator's program in the process's own code sandbox.

```typescript
executeCode(input: CodeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
```

#### `executeNative`

Runs a native evaluator through the NLP engine.

```typescript
executeNative(input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
```

#### `augmentResult`

Reshapes a native evaluator's raw result onto mapped data and dropped categories.

```typescript
augmentResult(input: EvaluatorResultAugmentationInput): SingleEvaluationResult;
```

#### `resolveForExecution`

Resolves an evaluator by id or slug into what running it needs.

```typescript
resolveForExecution(input: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution>;
```

#### `getAll`

Every evaluator in the project.

```typescript
getAll(input: { projectId: string }): Promise<Evaluator[]>;
```

#### `getAllWithFields`

Every evaluator in the project, with its computed input and output fields.

```typescript
getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]>;
```

#### `getById`

One evaluator. Throws `EvaluatorNotFoundError` when the project has none.

```typescript
getById(input: EvaluatorScope): Promise<Evaluator>;
```

#### `findById`

One evaluator, or `undefined` when the project has none.

```typescript
findById(input: EvaluatorScope): Promise<Evaluator | undefined>;
```

#### `getByIdWithFields`

One evaluator with its computed fields.

```typescript
getByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields>;
```

#### `findByIdWithFields`

One evaluator with its computed fields, or `undefined`.

```typescript
findByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields | undefined>;
```

#### `findBySlug`

One evaluator by its project-unique slug, or `undefined`.

```typescript
findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined>;
```

#### `getBySlug`

Evaluator by project-unique slug; throws `EvaluatorNotFoundError` if none match.

```typescript
getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator>;
```

#### `findByIdOrSlugWithFields`

One evaluator the way the public API addresses it: by id, failing that by slug.

```typescript
findByIdOrSlugWithFields(input: { idOrSlug: string; projectId: string; }): Promise<EvaluatorWithFields | undefined>;
```

#### `listByWorkflow`

The evaluator already assigned to this workflow, if there is one.

```typescript
listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]>;
```

#### `getWorkflowFields`

The entry-node fields a workflow evaluator maps trace data onto.

```typescript
getWorkflowFields(input: EvaluatorScope): Promise<EvaluatorWorkflowFields>;
```

#### `getRelatedEntities`

The workflow and monitors a cascade archive would take with the evaluator.

```typescript
getRelatedEntities(input: EvaluatorScope): Promise<EvaluatorRelatedEntities>;
```

#### `getCopies`

The replicas of this evaluator the caller may read.

```typescript
getCopies(input: EvaluatorLineageScope & { actorId: string }): Promise<EvaluatorCopy[]>;
```

#### `getCopySource`

A copy and the evaluator it was copied from.

```typescript
getCopySource(input: EvaluatorLineageScope): Promise<{ copy: Evaluator; source: Evaluator }>;
```

#### `getHistory`

Recent audit-log history for one evaluator.

```typescript
getHistory(input: EvaluatorLineageScope): Promise<EvaluatorHistoryEntry[]>;
```

#### `create`

Creates an evaluator, refusing a code evaluator that carries no program.

```typescript
create(input: EvaluatorCreateInput): Promise<Evaluator>;
```

#### `createWithResolvedDefaults`

Creates an evaluator against the project's resolved default and embeddings models.

```typescript
createWithResolvedDefaults(input: { projectId: string; name: string; config: EvaluatorConfig; id?: string; }): Promise<Evaluator>;
```

#### `createWithDefaults`

Creates an evaluator against models already resolved by the caller.

```typescript
createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator>;
```

#### `update`

Updates an evaluator, refusing a code evaluator that carries no program.

```typescript
update(input: EvaluatorUpdateInput): Promise<Evaluator>;
```

#### `archive`

Soft-deletes an evaluator.

```typescript
archive(input: EvaluatorScope): Promise<Evaluator>;
```

#### `cascadeArchive`

Archives the evaluator, archives its workflow and deletes its monitors.

```typescript
cascadeArchive(input: EvaluatorScope): Promise<EvaluatorCascadeArchive>;
```

#### `copy`

Replicates the evaluator, and the workflow backing it, into another project.

```typescript
copy(input: { evaluatorId: string; projectId: string; sourceProjectId: string; newEvaluatorId: string; actorId: string; }): Promise<Evaluator>;
```

#### `pushToCopies`

Pushes the source evaluator's config onto the replicas the caller may write.

```typescript
pushToCopies(input: EvaluatorLineageScope & { copyIds?: string[]; actorId: string }): Promise<EvaluatorPushToCopiesResult>;
```

#### `syncFromSource`

Pulls a copy back into line with the evaluator it came from.

```typescript
syncFromSource(input: EvaluatorLineageScope & { actorId: string }): Promise<EvaluatorSyncFromSourceResult>;
```

#### `platformUrl`

The platform's own address for one evaluator resource, from the project's slug and an already-resolved path. The REST declaration is static with no request-scoped builder, so the app composes the link.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `findTraceIdsPassingPreconditions`

The ids of the traces a check would run on: its required fields present and every precondition passing. `preconditions` is parsed here, as the caller cannot name its schema.

```typescript
findTraceIdsPassingPreconditions(input: { evaluatorType: string; preconditions: unknown; traces: readonly Trace[]; }): Promise<string[]>;
```

## REST transport

### `createEvaluatorRest`

|             |                                              |
| ----------- | -------------------------------------------- |
| Declared at | `src/transport/evaluator.rest.ts:168`        |
| Base URL    | `/api/evaluators`, twin `/api/v1/evaluators` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /` · `getApiEvaluators`

Get all evaluators for a project

Permission `evaluations:view`. Declared at `src/transport/evaluator.rest.ts:172`.

Answers at `/api/evaluators`, `/api/v1/evaluators`; also, undocumented, `/api/evaluators/2026-08-07`, `/api/v1/evaluators/2026-08-07`, `/api/evaluators/latest`, `/api/v1/evaluators/latest`.

```typescript
// Response: z.array(evaluatorWireSchema) (inline, src/transport/evaluator.rest.ts:174)
```

#### `GET /:idOrSlug` · `getApiEvaluatorsByIdOrSlug`

Get a specific evaluator by ID or slug

Permission `evaluations:view`. Declared at `src/transport/evaluator.rest.ts:186`.

Answers at `/api/evaluators/:idOrSlug`, `/api/v1/evaluators/:idOrSlug`; also, undocumented, `/api/evaluators/2026-08-07/:idOrSlug`, `/api/v1/evaluators/2026-08-07/:idOrSlug`, `/api/evaluators/latest/:idOrSlug`, `/api/v1/evaluators/latest/:idOrSlug`.

```typescript
type Params = z.infer<typeof evaluatorIdOrSlugParamsSchema>; // ../contract/src/evaluator-rest.schemas.ts:33
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:11
```

#### `POST /` · `postApiEvaluators`

Create a new evaluator

Permission `evaluations:create`. Declared at `src/transport/evaluator.rest.ts:207`.

Answers at `/api/evaluators`, `/api/v1/evaluators`; also, undocumented, `/api/evaluators/2026-08-07`, `/api/v1/evaluators/2026-08-07`, `/api/evaluators/latest`, `/api/v1/evaluators/latest`.

```typescript
type Body = z.infer<typeof createEvaluatorInputSchema>; // ../contract/src/evaluator-rest.schemas.ts:61
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:11
```

#### `PUT /:id` · `putApiEvaluatorsById`

Update an existing evaluator

Permission `evaluations:update`. Declared at `src/transport/evaluator.rest.ts:217`.

Answers at `/api/evaluators/:id`, `/api/v1/evaluators/:id`; also, undocumented, `/api/evaluators/2026-08-07/:id`, `/api/v1/evaluators/2026-08-07/:id`, `/api/evaluators/latest/:id`, `/api/v1/evaluators/latest/:id`.

```typescript
type Params = z.infer<typeof evaluatorIdParamsSchema>; // ../contract/src/evaluator-rest.schemas.ts:29
type Body = z.infer<typeof updateEvaluatorInputSchema>; // ../contract/src/evaluator-rest.schemas.ts:91
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:11
```

#### `DELETE /:id` · `deleteApiEvaluatorsById`

Archive (soft-delete) an evaluator

Permission `evaluations:manage`. Declared at `src/transport/evaluator.rest.ts:232`.

Answers at `/api/evaluators/:id`, `/api/v1/evaluators/:id`; also, undocumented, `/api/evaluators/2026-08-07/:id`, `/api/v1/evaluators/2026-08-07/:id`, `/api/evaluators/latest/:id`, `/api/v1/evaluators/latest/:id`.

```typescript
type Params = z.infer<typeof evaluatorIdParamsSchema>; // ../contract/src/evaluator-rest.schemas.ts:29
type Response = z.infer<typeof archivedEvaluatorResponseSchema>; // ../contract/src/evaluator-rest.schemas.ts:37
```

## tRPC transport

### `evaluators`

Contract `../contract/src/evaluator.trpc.ts:27`, router `src/transport/evaluator.trpc.ts:9`.

| Procedure                       | Kind     | Gate                            | Input                                 | Output                           |
| ------------------------------- | -------- | ------------------------------- | ------------------------------------- | -------------------------------- |
| `evaluators.getAll`             | query    | Permission `evaluations:view`   | `evaluatorApiProjectInputSchema`      | inline                           |
| `evaluators.getById`            | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`  | inline                           |
| `evaluators.getBySlug`          | query    | Permission `evaluations:view`   | `evaluatorApiSlugInputSchema`         | inline                           |
| `evaluators.create`             | mutation | Permission `evaluations:manage` | `evaluatorApiCreateInputSchema`       | `evaluatorSchema`                |
| `evaluators.update`             | mutation | Permission `evaluations:manage` | `evaluatorApiUpdateInputSchema`       | `evaluatorSchema`                |
| `evaluators.getRelatedEntities` | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`  | `evaluatorRelatedEntitiesSchema` |
| `evaluators.cascadeArchive`     | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorIdInputSchema`  | `evaluatorCascadeArchiveSchema`  |
| `evaluators.delete`             | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorIdInputSchema`  | `evaluatorSchema`                |
| `evaluators.getWorkflowFields`  | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`  | `evaluatorWorkflowFieldsSchema`  |
| `evaluators.getCopies`          | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorInputSchema`    | inline                           |
| `evaluators.copy`               | mutation | Permission `evaluations:manage` | `evaluatorApiCopyInputSchema`         | `evaluatorSchema`                |
| `evaluators.pushToCopies`       | mutation | Permission `evaluations:manage` | `evaluatorApiPushToCopiesInputSchema` | `evaluatorPushToCopiesSchema`    |
| `evaluators.syncFromSource`     | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorInputSchema`    | `evaluatorSyncFromSourceSchema`  |
| `evaluators.getHistory`         | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorInputSchema`    | inline                           |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: evaluator declares no pipeline, process manager, subscriber or task.

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                            |
| ------ | --------------- | -------------------- | -------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/evaluator.api.ts:159` |

<!-- readme:generated:end -->
