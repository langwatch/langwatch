# @langwatch/annotation-process

The server half of [annotation](../README.md). Annotations on traces: comments, scores and reviews, and the annotation queues reviewers work through.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("annotation").withRepositories(annotationRepositories).withApi(AnnotationModule).withTransports(annotationRest, annotationTrpcTransport, annotationScoreTrpcTransport).withEventing(annotationLifecycleEventing).withTasks(…)`, `src/annotation.module.ts:18`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AnnotationApi`)

Flat operations peers may call after the annotation app is composed.

Peers call these through the token, declared at `../contract/src/annotation.api.ts:65`; nothing else in this package is public.

#### `create`

```typescript
create(input: CreateAnnotationInput): Promise<Annotation>;
```

#### `createUnattributed`

```typescript
createUnattributed(input: CreateUnattributedAnnotationInput): Promise<Annotation>;
```

#### `createReview`

```typescript
createReview(input: AnnotationReviewCreateInput): Promise<Annotation>;
```

#### `update`

```typescript
update(input: UpdateAnnotationInput): Promise<Annotation>;
```

#### `updateReview`

```typescript
updateReview(input: AnnotationReviewUpdateInput): Promise<Annotation>;
```

#### `delete`

```typescript
delete(input: DeleteAnnotationInput): Promise<Annotation>;
```

#### `deleteReview`

```typescript
deleteReview(input: AnnotationReviewDeleteInput): Promise<Annotation>;
```

#### `getById`

```typescript
getById(input: AnnotationByIdInput): Promise<Annotation>;
```

#### `list`

```typescript
list(input: ListAnnotationsInput): Promise<Annotation[]>;
```

#### `listWithFullUsers`

```typescript
listWithFullUsers(input: ListAnnotationsInput): Promise<AnnotationWithFullUser[]>;
```

#### `listWithUserSummaries`

```typescript
listWithUserSummaries(input: ListAnnotationsInput): Promise<AnnotationWithUserSummary[]>;
```

#### `listReviewQueueItems`

```typescript
listReviewQueueItems(input: AnnotationQueueCaller): Promise<AnnotationQueueItemWithTrace[]>;
```

#### `listOptimizedQueues`

```typescript
listOptimizedQueues(input: AnnotationReviewOptimizedQueuesInput): Promise<AnnotationOptimizedQueues>;
```

#### `getQueueWalkStep`

```typescript
getQueueWalkStep(input: AnnotationQueueWalkStepInput): Promise<AnnotationQueueWalkStep>;
```

#### `listForProjection`

```typescript
listForProjection(input: ListProjectionAnnotationsInput): Promise<ProjectionAnnotation[]>;
```

#### `listScoreNames`

```typescript
listScoreNames(input: ListAnnotationScoreNamesInput): Promise<AnnotationScoreName[]>;
```

#### `upsertScore`

```typescript
upsertScore(input: UpsertAnnotationScoreInput): Promise<AnnotationScore>;
```

#### `listScores`

```typescript
listScores(input: ListAnnotationScoresInput): Promise<AnnotationScore[]>;
```

#### `getScore`

```typescript
getScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
```

#### `toggleScore`

```typescript
toggleScore(input: ToggleAnnotationScoreInput): Promise<AnnotationScore>;
```

#### `deleteScore`

```typescript
deleteScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore>;
```

#### `configure`

```typescript
configure(input: AnnotationQueueConfiguration): Promise<AnnotationQueueRecord>;
```

#### `listQueues`

```typescript
listQueues(input: AnnotationQueueScope & Readonly<{ reachableOnly?: boolean; userId?: string }>): Promise<AnnotationQueueListEntry[]>;
```

#### `getQueue`

```typescript
getQueue(input: AnnotationQueueScope & Readonly<{ slug?: string; queueId?: string }>): Promise<AnnotationQueueDetail>;
```

#### `listQueueItems`

```typescript
listQueueItems(input: AnnotationQueueScope): Promise<readonly AnnotationQueueListedItem[]>;
```

#### `countPendingItems`

```typescript
countPendingItems(input: AnnotationQueueCaller): Promise<number>;
```

#### `countAssignedItems`

```typescript
countAssignedItems(input: AnnotationQueueCaller): Promise<number>;
```

#### `listMemberQueuePendingCounts`

```typescript
listMemberQueuePendingCounts(input: AnnotationQueueCaller): Promise<AnnotationQueuePendingCount[]>;
```

#### `deleteQueueItems`

```typescript
deleteQueueItems(input: AnnotationQueueCaller & Readonly<{ queueItemIds: readonly string[] }>): Promise<number>;
```

#### `markQueueItemDone`

```typescript
markQueueItemDone(input: AnnotationQueueCaller & Readonly<{ queueItemId: string }>): Promise<AnnotationQueueItem>;
```

#### `queueTraces`

```typescript
queueTraces(input: QueueAnnotationTracesInput): Promise<Readonly<{ created: number; skipped: number }>>;
```

#### `countUsage`

The usage report's figures for these projects.

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number; }): Promise<AnnotationUsageCount>;
```

## REST transport

### `annotationRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/annotation.rest.ts:20`          |
| Base URL    | `/api/annotations`, twin `/api/v1/annotations` |
| Addressing  | dated                                          |
| Credential  | project                                        |
| Versions    | `2026-08-07`                                   |

#### `GET /` · `listAnnotations`

List annotations in the caller’s project

Permission `annotations:view`. Declared at `src/transport/annotation.rest.ts:24`.

Answers at `/api/annotations`, `/api/v1/annotations`; also, undocumented, `/api/annotations/2026-08-07`, `/api/v1/annotations/2026-08-07`, `/api/annotations/latest`, `/api/v1/annotations/latest`.

```typescript
// Query: annotationRestQuerySchema, ../contract/src/annotation-rest.schemas.ts:8
interface Query {
  anchor?: "trace" | "all";
}
type Response = z.infer<typeof annotationRestListResponseSchema>; // ../contract/src/annotation-rest.schemas.ts:30
```

#### `GET /:id` · `getAnnotation`

Get an annotation in the caller’s project

Permission `annotations:view`. Declared at `src/transport/annotation.rest.ts:41`.

Answers at `/api/annotations/:id`, `/api/v1/annotations/:id`; also, undocumented, `/api/annotations/2026-08-07/:id`, `/api/v1/annotations/2026-08-07/:id`, `/api/annotations/latest/:id`, `/api/v1/annotations/latest/:id`.

```typescript
// Params: annotationRestParamsSchema, ../contract/src/annotation-rest.schemas.ts:6
interface Params {
  id: string;
}
type Response = z.infer<typeof annotationRestResponseSchema>; // ../contract/src/annotation-rest.schemas.ts:29
```

#### `PATCH /:id` · `updateAnnotation`

Update an annotation in the caller’s project

Permission `annotations:manage`. Declared at `src/transport/annotation.rest.ts:58`.

Answers at `/api/annotations/:id`, `/api/v1/annotations/:id`; also, undocumented, `/api/annotations/2026-08-07/:id`, `/api/v1/annotations/2026-08-07/:id`, `/api/annotations/latest/:id`, `/api/v1/annotations/latest/:id`.

```typescript
type Params = z.infer<typeof annotationRestParamsSchema>; // ../contract/src/annotation-rest.schemas.ts:6
// Body: annotationRestWriteSchema, ../contract/src/annotation-rest.schemas.ts:12
interface Body {
  comment: string;
  isThumbsUp: boolean;
  email?: string | null;
}
type Response = z.infer<typeof annotationRestResponseSchema>; // ../contract/src/annotation-rest.schemas.ts:29
```

#### `DELETE /:id` · `deleteAnnotation`

Delete an annotation in the caller’s project

Permission `annotations:manage`. Declared at `src/transport/annotation.rest.ts:76`.

Answers at `/api/annotations/:id`, `/api/v1/annotations/:id`; also, undocumented, `/api/annotations/2026-08-07/:id`, `/api/v1/annotations/2026-08-07/:id`, `/api/annotations/latest/:id`, `/api/v1/annotations/latest/:id`.

```typescript
type Params = z.infer<typeof annotationRestParamsSchema>; // ../contract/src/annotation-rest.schemas.ts:6
// Response: annotationRestDeletedSchema, ../contract/src/annotation-rest.schemas.ts:35
interface Response {
  status: string;
  message: string;
}
```

#### `GET /trace/:id` · `listTraceAnnotations`

List annotations on a trace in the caller’s project

Permission `annotations:view`. Declared at `src/transport/annotation.rest.ts:90`.

Answers at `/api/annotations/trace/:id`, `/api/v1/annotations/trace/:id`; also, undocumented, `/api/annotations/2026-08-07/trace/:id`, `/api/v1/annotations/2026-08-07/trace/:id`, `/api/annotations/latest/trace/:id`, `/api/v1/annotations/latest/trace/:id`.

```typescript
type Params = z.infer<typeof annotationRestParamsSchema>; // ../contract/src/annotation-rest.schemas.ts:6
type Query = z.infer<typeof annotationRestQuerySchema>; // ../contract/src/annotation-rest.schemas.ts:8
type Response = z.infer<typeof annotationRestListResponseSchema>; // ../contract/src/annotation-rest.schemas.ts:30
```

#### `POST /trace/:id` · `createTraceAnnotation`

Create an unattributed annotation on a trace

Permission `annotations:create`. Declared at `src/transport/annotation.rest.ts:109`.

Answers at `/api/annotations/trace/:id`, `/api/v1/annotations/trace/:id`; also, undocumented, `/api/annotations/2026-08-07/trace/:id`, `/api/v1/annotations/2026-08-07/trace/:id`, `/api/annotations/latest/trace/:id`, `/api/v1/annotations/latest/trace/:id`.

```typescript
type Params = z.infer<typeof annotationRestParamsSchema>; // ../contract/src/annotation-rest.schemas.ts:6
type Body = z.infer<typeof annotationRestWriteSchema>; // ../contract/src/annotation-rest.schemas.ts:12
type Response = z.infer<typeof annotationRestResponseSchema>; // ../contract/src/annotation-rest.schemas.ts:29
```

## tRPC transport

### `annotationScore`

Contract `../contract/src/annotation-score.trpc.ts:43`, router `src/transport/annotation-score.trpc.ts:24`.

| Procedure                      | Kind     | Gate                            | Input                              | Output                  |
| ------------------------------ | -------- | ------------------------------- | ---------------------------------- | ----------------------- |
| `annotationScore.upsert`       | mutation | Permission `annotations:manage` | `annotationScoreUpsertInputSchema` | `annotationScoreSchema` |
| `annotationScore.getAll`       | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`  | inline                  |
| `annotationScore.getAllActive` | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`  | inline                  |
| `annotationScore.getById`      | query    | Permission `annotations:view`   | `annotationScoreScopeSchema`       | `annotationScoreSchema` |
| `annotationScore.toggle`       | mutation | Permission `annotations:update` | `annotationScoreToggleInputSchema` | `annotationScoreSchema` |
| `annotationScore.delete`       | mutation | Permission `annotations:delete` | `annotationScoreScopeSchema`       | `annotationScoreSchema` |

```typescript
// annotationScore.upsert
type Input = z.infer<typeof annotationScoreUpsertInputSchema>; // ../contract/src/annotation-score.trpc.ts:16
type Output = z.infer<typeof annotationScoreSchema>; // ../contract/src/annotation-score.schemas.ts:29

// annotationScore.getAll
// Input: annotationApiProjectScopeSchema, ../contract/src/annotation-trpc.schemas.ts:66
interface Input {
  projectId: string;
}
// Output: annotationScoreSchema.array() (inline, ../contract/src/annotation-score.trpc.ts:50)

// annotationScore.getAllActive
type Input = z.infer<typeof annotationApiProjectScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:66
// Output: annotationScoreSchema.array() (inline, ../contract/src/annotation-score.trpc.ts:55)

// annotationScore.getById
// Input: annotationScoreScopeSchema, ../contract/src/annotation-score.trpc.ts:31
interface Input {
  projectId: string;
  scoreId: string;
}
type Output = z.infer<typeof annotationScoreSchema>; // ../contract/src/annotation-score.schemas.ts:29

// annotationScore.toggle
// Input: annotationScoreToggleInputSchema, ../contract/src/annotation-score.trpc.ts:37
interface Input {
  scoreId: string;
  active: boolean;
  projectId: string;
}
type Output = z.infer<typeof annotationScoreSchema>; // ../contract/src/annotation-score.schemas.ts:29

// annotationScore.delete
type Input = z.infer<typeof annotationScoreScopeSchema>; // ../contract/src/annotation-score.trpc.ts:31
type Output = z.infer<typeof annotationScoreSchema>; // ../contract/src/annotation-score.schemas.ts:29
```

### `annotation`

Contract `../contract/src/annotation.trpc.ts:53`, router `src/transport/annotation.trpc.ts:10`.

| Procedure                                 | Kind     | Gate                            | Input                                        | Output                              |
| ----------------------------------------- | -------- | ------------------------------- | -------------------------------------------- | ----------------------------------- |
| `annotation.create`                       | mutation | Permission `annotations:create` | `annotationApiCreateInputSchema`             | `annotationSchema`                  |
| `annotation.updateByTraceId`              | mutation | Permission `annotations:update` | `annotationApiUpdateInputSchema`             | `annotationSchema`                  |
| `annotation.getByTraceId`                 | query    | Permission `annotations:view`   | `annotationApiByTraceIdInputSchema`          | inline                              |
| `annotation.getByTraceIds`                | query    | Permission `annotations:view`   | `annotationApiByTraceIdsInputSchema`         | inline                              |
| `annotation.getById`                      | query    | Permission `annotations:view`   | `annotationApiAnnotationScopeSchema`         | `annotationSchema`                  |
| `annotation.deleteById`                   | mutation | Permission `annotations:delete` | `annotationApiAnnotationScopeSchema`         | `annotationSchema`                  |
| `annotation.getAll`                       | query    | Permission `annotations:view`   | `annotationApiListAllInputSchema`            | inline                              |
| `annotation.createOrUpdateQueue`          | mutation | Permission `annotations:create` | `annotationApiQueueConfigurationInputSchema` | `annotationQueueRecordSchema`       |
| `annotation.getQueues`                    | query    | Permission `annotations:view`   | `annotationApiQueueListInputSchema`          | inline                              |
| `annotation.getQueueItems`                | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`            | inline                              |
| `annotation.getPendingItemsCount`         | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`            | `annotationCountSchema`             |
| `annotation.getAssignedItemsCount`        | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`            | `annotationCountSchema`             |
| `annotation.getQueueItemsCounts`          | query    | Permission `annotations:view`   | `annotationApiProjectScopeSchema`            | inline                              |
| `annotation.createQueueItem`              | mutation | Permission `annotations:create` | `annotationApiCreateQueueItemInputSchema`    | `annotationQueuedTracesSchema`      |
| `annotation.deleteQueueItems`             | mutation | Permission `annotations:update` | `annotationApiDeleteQueueItemsInputSchema`   | `annotationQueueItemsDeletedSchema` |
| `annotation.markQueueItemDone`            | mutation | Permission `annotations:update` | `annotationApiMarkQueueItemDoneInputSchema`  | `annotationQueueItemSchema`         |
| `annotation.getQueueBySlugOrId`           | query    | Permission `annotations:view`   | `annotationApiQueueBySlugOrIdInputSchema`    | `annotationQueueDetailSchema`       |
| `annotation.getOptimizedAnnotationQueues` | query    | Permission `annotations:view`   | `annotationApiOptimizedQueuesInputSchema`    | `annotationOptimizedQueuesSchema`   |
| `annotation.getQueueWalkStep`             | query    | Permission `annotations:view`   | `annotationApiQueueWalkStepInputSchema`      | `annotationQueueWalkStepSchema`     |

```typescript
// annotation.create
type Input = z.infer<typeof annotationApiCreateInputSchema>; // ../contract/src/annotation-trpc.schemas.ts:22
type Output = z.infer<typeof annotationSchema>; // ../contract/src/annotation.schemas.ts:31

// annotation.updateByTraceId
type Input = z.infer<typeof annotationApiUpdateInputSchema>; // ../contract/src/annotation-trpc.schemas.ts:35
type Output = z.infer<typeof annotationSchema>; // ../contract/src/annotation.schemas.ts:31

// annotation.getByTraceId
// Input: annotationApiByTraceIdInputSchema, ../contract/src/annotation-trpc.schemas.ts:46
interface Input {
  traceId: string;
  projectId: string;
  anchor?: "trace" | "all";
}
// Output: annotationWithUserSummarySchema.array() (inline, ../contract/src/annotation.trpc.ts:65)

// annotation.getByTraceIds
// Input: annotationApiByTraceIdsInputSchema, ../contract/src/annotation-trpc.schemas.ts:53
interface Input {
  traceIds: string[];
  projectId: string;
  anchor?: "trace" | "all";
}
// Output: annotationWithUserSummarySchema.array() (inline, ../contract/src/annotation.trpc.ts:70)

// annotation.getById
// Input: annotationApiAnnotationScopeSchema, ../contract/src/annotation-trpc.schemas.ts:60
interface Input {
  annotationId: string;
  projectId: string;
}
type Output = z.infer<typeof annotationSchema>; // ../contract/src/annotation.schemas.ts:31

// annotation.deleteById
type Input = z.infer<typeof annotationApiAnnotationScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:60
type Output = z.infer<typeof annotationSchema>; // ../contract/src/annotation.schemas.ts:31

// annotation.getAll
// Input: annotationApiListAllInputSchema, ../contract/src/annotation-trpc.schemas.ts:75
interface Input {
  projectId: string;
  startDate?: unknown;
  endDate?: unknown;
}
// Output: annotationWithFullUserSchema.array() (inline, ../contract/src/annotation.trpc.ts:83)

// annotation.createOrUpdateQueue
// Input: annotationApiQueueConfigurationInputSchema, ../contract/src/annotation-trpc.schemas.ts:82
interface Input {
  projectId: string;
  name: string;
  description: string;
  userIds: string[];
  scoreTypeIds: string[];
  queueId?: string;
}
// Output: annotationQueueRecordSchema, ../contract/src/annotation-response.schemas.ts:16
interface Output {
  id: string;
  name: string;
  slug: string;
  projectId: string;
  description: string | null;
  createdAt: unknown;
  updatedAt: unknown;
}

// annotation.getQueues
// Input: annotationApiQueueListInputSchema, ../contract/src/annotation-trpc.schemas.ts:68
interface Input {
  projectId: string;
  reachableOnly?: boolean;
}
// Output: inline, ../contract/src/annotation.trpc.ts:91
type Output = {
  id: string;
  name: string;
  slug: string;
}[];

// annotation.getQueueItems
type Input = z.infer<typeof annotationApiProjectScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:66
// Output: annotationQueueItemWithTraceSchema.array() (inline, ../contract/src/annotation.trpc.ts:95)

// annotation.getPendingItemsCount
type Input = z.infer<typeof annotationApiProjectScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:66
// Output: annotationCountSchema, ../contract/src/annotation.trpc.ts:45
interface Output {
  count: number;
}

// annotation.getAssignedItemsCount
type Input = z.infer<typeof annotationApiProjectScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:66
type Output = z.infer<typeof annotationCountSchema>; // ../contract/src/annotation.trpc.ts:45

// annotation.getQueueItemsCounts
type Input = z.infer<typeof annotationApiProjectScopeSchema>; // ../contract/src/annotation-trpc.schemas.ts:66
// Output: inline, ../contract/src/annotation.trpc.ts:107
type Output = {
  id: string;
  name: string;
  slug: string;
  pendingCount: number;
}[];

// annotation.createQueueItem
// Input: annotationApiCreateQueueItemInputSchema, ../contract/src/annotation-trpc.schemas.ts:94
interface Input {
  traceIds: string[];
  projectId: string;
  annotators: string[];
}
// Output: annotationQueuedTracesSchema, ../contract/src/annotation.trpc.ts:48
interface Output {
  created: number;
  skipped: number;
}

// annotation.deleteQueueItems
// Input: annotationApiDeleteQueueItemsInputSchema, ../contract/src/annotation-trpc.schemas.ts:103
interface Input {
  projectId: string;
  queueItemIds: string[];
}
// Output: annotationQueueItemsDeletedSchema, ../contract/src/annotation-response.schemas.ts:45
interface Output {
  deleted: number;
}

// annotation.markQueueItemDone
// Input: annotationApiMarkQueueItemDoneInputSchema, ../contract/src/annotation-trpc.schemas.ts:111
interface Input {
  queueItemId: string;
  projectId: string;
}
// Output: annotationQueueItemSchema, ../contract/src/annotation-queue.schemas.ts:13
interface Output {
  id: string;
  annotationQueueId: string | null;
  userId: string | null;
  createdByUserId: string | null;
  traceId: string;
  projectId: string;
  createdAt: unknown;
  updatedAt: unknown;
  doneAt: unknown | null;
  markedForDatasetAt: unknown | null;
}

// annotation.getQueueBySlugOrId
// Input: annotationApiQueueBySlugOrIdInputSchema, ../contract/src/annotation-trpc.schemas.ts:119
interface Input {
  projectId: string;
  slug?: string;
  queueId?: string;
}
type Output = z.infer<typeof annotationQueueDetailSchema>; // ../contract/src/annotation-response.schemas.ts:32

// annotation.getOptimizedAnnotationQueues
// Input: annotationApiOptimizedQueuesInputSchema, ../contract/src/annotation-trpc.schemas.ts:128
interface Input {
  projectId: string;
  selectedAnnotations: "pending" | "completed" | "all";
  pageSize?: number;
  pageOffset?: number;
  queueId?: string;
  queueIds?: string[];
  showQueueAndUser?: boolean;
  allQueueItems?: boolean;
  startDate?: unknown;
  endDate?: unknown;
}
type Output = z.infer<typeof annotationOptimizedQueuesSchema>; // ../contract/src/annotation-review.schemas.ts:36

// annotation.getQueueWalkStep
// Input: annotationApiQueueWalkStepInputSchema, ../contract/src/annotation-trpc.schemas.ts:145
interface Input {
  projectId: string;
  queueItemId?: string;
}
type Output = z.infer<typeof annotationQueueWalkStepSchema>; // ../contract/src/annotation-review.schemas.ts:42
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `annotation_lifecycle` (aggregate `annotation`)

Declared at `src/eventing/annotation-lifecycle.pipeline.ts:26`. Events: `annotationCreatedEventSchema`, `annotationUpdatedEventSchema`, `annotationDeletedEventSchema`, `annotationScoreDefinedEventSchema`, `annotationScoreRenamedEventSchema`.

| Kind    | Name                      | Handles | Declared at                                        |
| ------- | ------------------------- | ------- | -------------------------------------------------- |
| command | `recordAnnotationCreated` | –       | `src/eventing/annotation-lifecycle.pipeline.ts:37` |
| command | `recordAnnotationUpdated` | –       | `src/eventing/annotation-lifecycle.pipeline.ts:38` |
| command | `recordAnnotationDeleted` | –       | `src/eventing/annotation-lifecycle.pipeline.ts:39` |
| command | `recordScoreDefined`      | –       | `src/eventing/annotation-lifecycle.pipeline.ts:40` |
| command | `recordScoreRenamed`      | –       | `src/eventing/annotation-lifecycle.pipeline.ts:41` |

### Tasks

Run by the tasks process, before serve.

| Task                                 | Class                         | Declared at                                      |
| ------------------------------------ | ----------------------------- | ------------------------------------------------ |
| `backfill-annotations-to-clickhouse` | `AnnotationTraceBackfillTask` | `src/tasks/annotation-trace-backfill.task.ts:24` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
