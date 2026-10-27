# @langwatch/evaluator-process

The server half of [evaluator](../README.md). Evaluators: their definitions, and executing them as code or native checks with the settings a run resolves.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("evaluator").withRepositories(evaluatorRepositories).withApi(EvaluatorModule).withTransports(…, evaluatorTrpcTransport).provideMiddlewareContext(…).withEventing(evaluatorLifecycleEventing).withEventing(evaluatorWorkflowArchiveCascadeEventing).withMigrations(…)`, `src/evaluator.module.ts:18`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`EvaluatorApi`)

Peers call these through the token, declared at `../contract/src/evaluator.api.ts:75`; nothing else in this package is public.

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

One evaluator, at the latest version unless a label or a version is asked for; `id` also takes the `id:label` address. Throws `EvaluatorNotFoundError` when the project has none.

```typescript
getById(input: EvaluatorScope & EvaluatorVersionSelector): Promise<Evaluator>;
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
findByIdOrSlugWithFields(input: { idOrSlug: string; projectId: string; } & EvaluatorVersionSelector): Promise<EvaluatorWithFields | undefined>;
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

The workflow a cascade archive would take with the evaluator.

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
createWithResolvedDefaults(input: { projectId: string; name: string; config: EvaluatorConfig; id?: string; caller?: EvaluatorCaller; }): Promise<Evaluator>;
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

Soft-deletes an evaluator; a labelled one needs `evaluators:deploy` of `caller`.

```typescript
archive(input: EvaluatorScope & { caller?: EvaluatorCaller }): Promise<Evaluator>;
```

#### `cascadeArchive`

Archives the evaluator and its workflow, and records `lw.evaluator.deleted`.

```typescript
cascadeArchive(input: EvaluatorScope & { caller?: EvaluatorCaller }): Promise<EvaluatorCascadeArchive>;
```

#### `listVersions`

Every version of the evaluator, newest first, with the labels on each.

```typescript
listVersions(input: EvaluatorLineageScope): Promise<EvaluatorVersions>;
```

#### `assignLabel`

Points a deploy label at one of the evaluator's versions.

```typescript
assignLabel(input: AssignEvaluatorLabelInput & { caller?: EvaluatorCaller }): Promise<EvaluatorLabel>;
```

#### `removeLabel`

```typescript
removeLabel(input: RemoveEvaluatorLabelInput): Promise<void>;
```

#### `atLabelOrLatest`

The evaluator at a label, or the latest when the label points nowhere (a monitor's pin).

```typescript
atLabelOrLatest(input: { evaluator: Evaluator; label: string }): Promise<Evaluator>;
```

#### `copy`

Replicates the evaluator, and the workflow backing it, into another project.

```typescript
copy(input: { evaluatorId: string; projectId: string; sourceProjectId: string; newEvaluatorId: string; actorId: string; /** * Copying a library evaluator counts against the plan's evaluator cap; an * online evaluation's copy brings its evaluator along uncapped, so it passes false. */ shouldCheckEvaluatorCap?: boolean; }): Promise<Evaluator>;
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
| Declared at | `src/transport/evaluator.rest.ts:196`        |
| Base URL    | `/api/evaluators`, twin `/api/v1/evaluators` |
| Addressing  | dated                                        |
| Credential  | project                                      |
| Versions    | `2026-08-07`                                 |

#### `GET /` · `getApiEvaluators`

Get all evaluators for a project

Permission `evaluations:view`. Declared at `src/transport/evaluator.rest.ts:200`.

Answers at `/api/evaluators`, `/api/v1/evaluators`; also, undocumented, `/api/evaluators/2026-08-07`, `/api/v1/evaluators/2026-08-07`, `/api/evaluators/latest`, `/api/v1/evaluators/latest`.

```typescript
// Response: z.array(evaluatorWireSchema) (inline, src/transport/evaluator.rest.ts:202)
```

#### `GET /:idOrSlug` · `getApiEvaluatorsByIdOrSlug`

Get a specific evaluator by ID or slug, at the latest version unless `label` or `version` is given. The address also takes a suffix: `toxicity:production`, `toxicity:2` or `toxicity:latest`.

Permission `evaluations:view`. Declared at `src/transport/evaluator.rest.ts:214`.

Answers at `/api/evaluators/:idOrSlug`, `/api/v1/evaluators/:idOrSlug`; also, undocumented, `/api/evaluators/2026-08-07/:idOrSlug`, `/api/v1/evaluators/2026-08-07/:idOrSlug`, `/api/evaluators/latest/:idOrSlug`, `/api/v1/evaluators/latest/:idOrSlug`.

```typescript
// Params: evaluatorIdOrSlugParamsSchema, ../contract/src/evaluator-rest.schemas.ts:68
interface Params {
  idOrSlug: string;
}
// Query: evaluatorRestGetQuerySchema, ../contract/src/evaluator-rest.schemas.ts:174
interface Query {
  label?: string;
  version?: number;
}
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:53
```

#### `POST /` · `postApiEvaluators`

Create a new evaluator

Permission `evaluations:create`. Credential `project`. Declared at `src/transport/evaluator.rest.ts:243`.

Answers at `/api/evaluators`, `/api/v1/evaluators`; also, undocumented, `/api/evaluators/2026-08-07`, `/api/v1/evaluators/2026-08-07`, `/api/evaluators/latest`, `/api/v1/evaluators/latest`.

```typescript
// Body: createEvaluatorInputSchema, ../contract/src/evaluator-rest.schemas.ts:143
interface Body {
  name: string;
  config: Record<string, unknown>;
}
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:53
```

#### `PUT /:id` · `putApiEvaluatorsById`

Update an existing evaluator

Permission `evaluations:update`. Credential `project`. Declared at `src/transport/evaluator.rest.ts:262`.

Answers at `/api/evaluators/:id`, `/api/v1/evaluators/:id`; also, undocumented, `/api/evaluators/2026-08-07/:id`, `/api/v1/evaluators/2026-08-07/:id`, `/api/evaluators/latest/:id`, `/api/v1/evaluators/latest/:id`.

```typescript
// Params: evaluatorIdParamsSchema, ../contract/src/evaluator-rest.schemas.ts:59
interface Params {
  id: string;
}
// Body: updateEvaluatorInputSchema, ../contract/src/evaluator-rest.schemas.ts:158
interface Body {
  name?: string;
  config?: Record<string, unknown>;
  commitMessage?: string;
}
type Response = z.infer<typeof evaluatorWireSchema>; // ../contract/src/evaluator-rest.schemas.ts:53
```

#### `DELETE /:id` · `deleteApiEvaluatorsById`

Archive (soft-delete) an evaluator

Permission `evaluations:manage`. Credential `project`. Declared at `src/transport/evaluator.rest.ts:286`.

Answers at `/api/evaluators/:id`, `/api/v1/evaluators/:id`; also, undocumented, `/api/evaluators/2026-08-07/:id`, `/api/v1/evaluators/2026-08-07/:id`, `/api/evaluators/latest/:id`, `/api/v1/evaluators/latest/:id`.

```typescript
type Params = z.infer<typeof evaluatorIdParamsSchema>; // ../contract/src/evaluator-rest.schemas.ts:59
// Response: archivedEvaluatorResponseSchema, ../contract/src/evaluator-rest.schemas.ts:75
interface Response {
  success: boolean;
}
```

#### `GET /:evaluatorId/versions` · `getApiEvaluatorsVersions`

List an evaluator's versions, newest first, with the labels on each

Permission `evaluations:view`. Declared at `src/transport/evaluator.rest.ts:311`.

Answers at `/api/evaluators/:evaluatorId/versions`, `/api/v1/evaluators/:evaluatorId/versions`; also, undocumented, `/api/evaluators/2026-08-07/:evaluatorId/versions`, `/api/v1/evaluators/2026-08-07/:evaluatorId/versions`, `/api/evaluators/latest/:evaluatorId/versions`, `/api/v1/evaluators/latest/:evaluatorId/versions`.

```typescript
// Params: evaluatorVersionsRestParamsSchema, ../contract/src/evaluator-rest.schemas.ts:183
interface Params {
  evaluatorId: string;
}
type Response = z.infer<typeof evaluatorVersionListResponseSchema>; // ../contract/src/evaluator-rest.schemas.ts:212
```

#### `PUT /:evaluatorId/labels/:label` · `putApiEvaluatorsLabel`

Point a deploy label, such as production, at one of the evaluator's versions

Permission `evaluators:deploy`. Credential `project`. Declared at `src/transport/evaluator.rest.ts:331`.

Answers at `/api/evaluators/:evaluatorId/labels/:label`, `/api/v1/evaluators/:evaluatorId/labels/:label`; also, undocumented, `/api/evaluators/2026-08-07/:evaluatorId/labels/:label`, `/api/v1/evaluators/2026-08-07/:evaluatorId/labels/:label`, `/api/evaluators/latest/:evaluatorId/labels/:label`, `/api/v1/evaluators/latest/:evaluatorId/labels/:label`.

```typescript
// Params: evaluatorLabelRestParamsSchema, ../contract/src/evaluator-rest.schemas.ts:193
interface Params {
  evaluatorId: string;
  label: string;
}
// Body: evaluatorLabelRestBodySchema, ../contract/src/evaluator-rest.schemas.ts:202
interface Body {
  version: number;
}
// Response: evaluatorLabelResponseSchema, ../contract/src/evaluator-rest.schemas.ts:223
interface Response {
  label: string;
  version: number;
  versionId: string;
}
```

#### `DELETE /:evaluatorId/labels/:label` · `deleteApiEvaluatorsLabel`

Remove a deploy label from an evaluator

Permission `evaluators:deploy`. Declared at `src/transport/evaluator.rest.ts:355`.

Answers at `/api/evaluators/:evaluatorId/labels/:label`, `/api/v1/evaluators/:evaluatorId/labels/:label`; also, undocumented, `/api/evaluators/2026-08-07/:evaluatorId/labels/:label`, `/api/v1/evaluators/2026-08-07/:evaluatorId/labels/:label`, `/api/evaluators/latest/:evaluatorId/labels/:label`, `/api/v1/evaluators/latest/:evaluatorId/labels/:label`.

```typescript
type Params = z.infer<typeof evaluatorLabelRestParamsSchema>; // ../contract/src/evaluator-rest.schemas.ts:193
// Response: evaluatorLabelRemovedSchema, ../contract/src/evaluator-rest.schemas.ts:233
interface Response {
  label: string;
  removed: true;
}
```

## tRPC transport

### `evaluators`

Contract `../contract/src/evaluator.trpc.ts:39`, router `src/transport/evaluator.trpc.ts:30`.

| Procedure                          | Kind     | Gate                            | Input                                   | Output                            |
| ---------------------------------- | -------- | ------------------------------- | --------------------------------------- | --------------------------------- |
| `evaluators.getAll`                | query    | Permission `evaluations:view`   | `evaluatorApiProjectInputSchema`        | inline                            |
| `evaluators.getById`               | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`    | inline                            |
| `evaluators.getBySlug`             | query    | Permission `evaluations:view`   | `evaluatorApiSlugInputSchema`           | inline                            |
| `evaluators.create`                | mutation | Permission `evaluations:manage` | `evaluatorApiCreateInputSchema`         | `evaluatorSchema`                 |
| `evaluators.update`                | mutation | Permission `evaluations:manage` | `evaluatorApiUpdateInputSchema`         | `evaluatorSchema`                 |
| `evaluators.getRelatedEntities`    | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`    | `evaluatorRelatedEntitiesSchema`  |
| `evaluators.listByWorkflow`        | query    | Permission `workflows:view`     | `evaluatorApiWorkflowInputSchema`       | inline                            |
| `evaluators.cascadeArchive`        | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorIdInputSchema`    | `evaluatorCascadeArchiveSchema`   |
| `evaluators.delete`                | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorIdInputSchema`    | `evaluatorSchema`                 |
| `evaluators.getWorkflowFields`     | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorIdInputSchema`    | `evaluatorWorkflowFieldsSchema`   |
| `evaluators.getCopies`             | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorInputSchema`      | inline                            |
| `evaluators.copy`                  | mutation | Permission `evaluations:manage` | `evaluatorApiCopyInputSchema`           | `evaluatorSchema`                 |
| `evaluators.pushToCopies`          | mutation | Permission `evaluations:manage` | `evaluatorApiPushToCopiesInputSchema`   | `evaluatorPushToCopiesSchema`     |
| `evaluators.syncFromSource`        | mutation | Permission `evaluations:manage` | `evaluatorApiEvaluatorInputSchema`      | `evaluatorSyncFromSourceSchema`   |
| `evaluators.getHistory`            | query    | Permission `evaluations:view`   | `evaluatorApiEvaluatorInputSchema`      | inline                            |
| `evaluators.disableAsEvaluator`    | mutation | Permission `workflows:update`   | `evaluatorApiWorkflowInputSchema`       | `evaluatorWorkflowSwitchedSchema` |
| `evaluators.toggleSaveAsEvaluator` | mutation | Permission `workflows:update`   | `evaluatorApiWorkflowToggleInputSchema` | `evaluatorWorkflowSwitchedSchema` |
| `evaluators.listVersions`          | query    | Permission `evaluations:view`   | `evaluatorVersionsInputSchema`          | `evaluatorVersionsSchema`         |
| `evaluators.assignLabel`           | mutation | Permission `evaluators:deploy`  | `assignEvaluatorLabelInputSchema`       | `evaluatorLabelSchema`            |
| `evaluators.removeLabel`           | mutation | Permission `evaluators:deploy`  | `removeEvaluatorLabelInputSchema`       | inline                            |

```typescript
// evaluators.getAll
// Input: evaluatorApiProjectInputSchema, ../contract/src/evaluator.schemas.ts:24
interface Input {
  projectId: string;
}
// Output: evaluatorWithFieldsSchema.array() (inline, ../contract/src/evaluator.trpc.ts:43)

// evaluators.getById
// Input: evaluatorApiEvaluatorIdInputSchema, ../contract/src/evaluator.schemas.ts:35
interface Input {
  id: string;
  projectId: string;
}
// Output: evaluatorWithFieldsSchema.nullable() (inline, ../contract/src/evaluator.trpc.ts:48)

// evaluators.getBySlug
// Input: evaluatorApiSlugInputSchema, ../contract/src/evaluator.schemas.ts:61
interface Input {
  slug: string;
  projectId: string;
}
// Output: evaluatorSchema.nullable() (inline, ../contract/src/evaluator.trpc.ts:52)

// evaluators.create
// Input: evaluatorApiCreateInputSchema, ../contract/src/evaluator.schemas.ts:104
interface Input {
  id?: string;
  projectId: string;
  name: string;
  type: "evaluator" | "code" | "workflow";
  config: Record<string, unknown>;
  workflowId?: string;
}
type Output = z.infer<typeof evaluatorSchema>; // ../contract/src/evaluator.ts:69

// evaluators.update
// Input: evaluatorApiUpdateInputSchema, ../contract/src/evaluator.schemas.ts:77
interface Input {
  id: string;
  projectId: string;
  name?: string;
  type?: "evaluator" | "code" | "workflow";
  config?: Record<string, unknown>;
  workflowId?: string | null;
  commitMessage?: string;
}
type Output = z.infer<typeof evaluatorSchema>; // ../contract/src/evaluator.ts:69

// evaluators.getRelatedEntities
type Input = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>; // ../contract/src/evaluator.schemas.ts:35
// Output: evaluatorRelatedEntitiesSchema, ../contract/src/evaluator.schemas.ts:200
interface Output {
  workflow: {
    id: string;
    name: string;
  } | null;
}

// evaluators.listByWorkflow
// Input: evaluatorApiWorkflowInputSchema, ../contract/src/evaluator.schemas.ts:249
interface Input {
  workflowId: string;
  projectId: string;
}
// Output: inline, ../contract/src/evaluator.trpc.ts:70
type Output = {
  id: string;
  name: string;
}[];

// evaluators.cascadeArchive
type Input = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>; // ../contract/src/evaluator.schemas.ts:35
type Output = z.infer<typeof evaluatorCascadeArchiveSchema>; // ../contract/src/evaluator.schemas.ts:219

// evaluators.delete
type Input = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>; // ../contract/src/evaluator.schemas.ts:35
type Output = z.infer<typeof evaluatorSchema>; // ../contract/src/evaluator.ts:69

// evaluators.getWorkflowFields
type Input = z.infer<typeof evaluatorApiEvaluatorIdInputSchema>; // ../contract/src/evaluator.schemas.ts:35
type Output = z.infer<typeof evaluatorWorkflowFieldsSchema>; // ../contract/src/evaluator.schemas.ts:190

// evaluators.getCopies
// Input: evaluatorApiEvaluatorInputSchema, ../contract/src/evaluator.schemas.ts:50
interface Input {
  projectId: string;
  evaluatorId: string;
}
// Output: inline, ../contract/src/evaluator.trpc.ts:89
type Output = {
  id: string;
  name: string;
  projectId: string;
  fullPath: string;
}[];

// evaluators.copy
// Input: evaluatorApiCopyInputSchema, ../contract/src/evaluator.schemas.ts:118
interface Input {
  evaluatorId: string;
  projectId: string;
  sourceProjectId: string;
  newEvaluatorId?: string;
}
type Output = z.infer<typeof evaluatorSchema>; // ../contract/src/evaluator.ts:69

// evaluators.pushToCopies
// Input: evaluatorApiPushToCopiesInputSchema, ../contract/src/evaluator.schemas.ts:88
interface Input {
  projectId: string;
  evaluatorId: string;
  copyIds?: string[];
}
// Output: evaluatorPushToCopiesSchema, ../contract/src/evaluator.schemas.ts:230
interface Output {
  pushedTo: number;
  selectedCopies: number;
}

// evaluators.syncFromSource
type Input = z.infer<typeof evaluatorApiEvaluatorInputSchema>; // ../contract/src/evaluator.schemas.ts:50
// Output: evaluatorSyncFromSourceSchema, ../contract/src/evaluator.schemas.ts:238
interface Output {
  ok: true;
}

// evaluators.getHistory
type Input = z.infer<typeof evaluatorApiEvaluatorInputSchema>; // ../contract/src/evaluator.schemas.ts:50
// Output: inline, ../contract/src/evaluator.trpc.ts:106
type Output = {
  id: string;
  action: string;
  createdAt: unknown;
  args: unknown;
  user: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
}[];

// evaluators.disableAsEvaluator
type Input = z.infer<typeof evaluatorApiWorkflowInputSchema>; // ../contract/src/evaluator.schemas.ts:249
// Output: evaluatorWorkflowSwitchedSchema, ../contract/src/evaluator.schemas.ts:269
interface Output {
  success: boolean;
}

// evaluators.toggleSaveAsEvaluator
// Input: evaluatorApiWorkflowToggleInputSchema, ../contract/src/evaluator.schemas.ts:261
interface Input {
  workflowId: string;
  projectId: string;
  isEvaluator: boolean;
  isComponent: boolean;
}
type Output = z.infer<typeof evaluatorWorkflowSwitchedSchema>; // ../contract/src/evaluator.schemas.ts:269

// evaluators.listVersions
// Input: evaluatorVersionsInputSchema, ../contract/src/evaluator-version.ts:155
interface Input {
  projectId: string;
  evaluatorId: string;
}
type Output = z.infer<typeof evaluatorVersionsSchema>; // ../contract/src/evaluator-version.ts:132

// evaluators.assignLabel
// Input: assignEvaluatorLabelInputSchema, ../contract/src/evaluator-version.ts:167
interface Input {
  projectId: string;
  evaluatorId: string;
  label: string;
  version: number;
}
// Output: evaluatorLabelSchema, ../contract/src/evaluator-version.ts:122
interface Output {
  label: string;
  versionId: string;
  version: number;
  updatedAt: unknown;
  updatedById: string | null;
}

// evaluators.removeLabel
// Input: removeEvaluatorLabelInputSchema, ../contract/src/evaluator-version.ts:179
interface Input {
  projectId: string;
  evaluatorId: string;
  label: string;
}
// Output: inline, ../contract/src/evaluator.trpc.ts:129
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `evaluator_lifecycle` (aggregate `evaluator`)

Declared at `src/eventing/evaluator-lifecycle.pipeline.ts:24`. Events: `evaluatorDeletedEventSchema`.

| Kind    | Name                     | Handles | Declared at                                       |
| ------- | ------------------------ | ------- | ------------------------------------------------- |
| command | `recordEvaluatorDeleted` | –       | `src/eventing/evaluator-lifecycle.pipeline.ts:29` |

### Pipeline `evaluator_workflow_archive_cascade` (aggregate `global`)

Declared at `src/eventing/evaluator-workflow-archive-cascade.pipeline.ts:35`.

| Kind            | Name                        | Handles                                                          | Declared at                                                      |
| --------------- | --------------------------- | ---------------------------------------------------------------- | ---------------------------------------------------------------- |
| peer subscriber | `evaluatorWorkflowArchived` | `lw.workflow.archived` from [workflow](../../workflow/README.md) | `src/eventing/evaluator-workflow-archive-cascade.pipeline.ts:42` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                             |
| ------ | --------------- | -------------------- | --------------------------------------- |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/evaluator.config.ts:4` |

<!-- readme:generated:end -->
