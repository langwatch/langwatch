# @langwatch/topic-process

The server half of [topic](../README.md). A project's conversation topics, and what the last topic-clustering run did.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("topic").withRepositories(topicRepositories).withApi(TopicModule).withTransports(topicTrpcTransport).withEventing(topicClusteringEventing).withTasks(…)`, `src/topic.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`TopicApi`)

The project's conversation topics, and what the last clustering run did.

Peers call these through the token, declared at `../contract/src/topic.ts:106`; nothing else in this package is public.

#### `getAll`

```typescript
getAll(input: TopicProjectInput): Promise<Topic[]>;
```

#### `getNamesByIds`

```typescript
getNamesByIds(input: TopicNamesInput): Promise<Map<string, string>>;
```

#### `getClusteringStatus`

```typescript
getClusteringStatus(input: TopicProjectInput): Promise<TopicClusteringStatus>;
```

#### `getClusteringRunHistory`

```typescript
getClusteringRunHistory(input: TopicProjectInput): Promise<TopicClusteringRunHistoryEntry[]>;
```

#### `requestClustering`

Asks the project's clustering process for a run; ports main's `requestClustering`.

```typescript
requestClustering(input: TopicClusteringRequestInput): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `topics`

Contract `../contract/src/topic.trpc.ts:23`, router `src/transport/topic.trpc.ts:33`.

| Procedure                        | Kind     | Gate                        | Input                     | Output                               |
| -------------------------------- | -------- | --------------------------- | ------------------------- | ------------------------------------ |
| `topics.getAll`                  | query    | Permission `traces:view`    | `topicProjectScopeSchema` | inline                               |
| `topics.getTopicCounts`          | query    | Permission `traces:view`    | `traceFilterInputSchema`  | `namedTopicCountsSchema`             |
| `topics.getClusteringStatus`     | query    | Permission `project:view`   | `topicProjectScopeSchema` | `topicClusteringStatusSchema`        |
| `topics.getClusteringRunHistory` | query    | Permission `project:view`   | `topicProjectScopeSchema` | inline                               |
| `topics.triggerTopicClustering`  | mutation | Permission `project:update` | `topicProjectScopeSchema` | `topicClusteringTriggerResultSchema` |

```typescript
// topics.getAll
// Input: topicProjectScopeSchema, ../contract/src/topic.trpc.ts:21
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/topic.trpc.ts:26
type Output = {
  id: string;
  name: string;
  parentId: string | null;
  automaticallyGenerated: boolean;
}[];

// topics.getTopicCounts
type Input = z.infer<typeof traceFilterInputSchema>; // ../../trace/contract/src/traces.trpc.ts:90
type Output = z.infer<typeof namedTopicCountsSchema>; // ../contract/src/topic.ts:92

// topics.getClusteringStatus
type Input = z.infer<typeof topicProjectScopeSchema>; // ../contract/src/topic.trpc.ts:21
type Output = z.infer<typeof topicClusteringStatusSchema>; // ../contract/src/topic.ts:41

// topics.getClusteringRunHistory
type Input = z.infer<typeof topicProjectScopeSchema>; // ../contract/src/topic.trpc.ts:21
// Output: topicClusteringRunHistoryEntrySchema.array() (inline, ../contract/src/topic.trpc.ts:39)

// topics.triggerTopicClustering
type Input = z.infer<typeof topicProjectScopeSchema>; // ../contract/src/topic.trpc.ts:21
// Output: topicClusteringTriggerResultSchema, ../contract/src/topic.ts:85
type Output =
  | {
      started: true;
    }
  | {
      started: false;
      reason: "already_running";
    };
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `topic_clustering_processing` (aggregate `topic_clustering`)

Declared at `src/eventing/topic-clustering-processing.pipeline.ts:85`. Events: `TopicClusteringRequestedEventSchema`, `TopicClusteringRunStartedEventSchema`, `TopicClusteringRunCompletedEventSchema`, `TopicClusteringRunFailedEventSchema`, `TopicClusteringTopicsRecordedEventSchema`.

| Kind                | Name                                                                                           | Handles                                                                                                      | Declared at                                                |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| command             | `requestClustering`                                                                            | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:109` |
| command             | `recordClusteringRunStarted`                                                                   | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:110` |
| command             | `recordClusteringRunCompleted`                                                                 | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:111` |
| command             | `recordClusteringRunFailed`                                                                    | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:112` |
| command             | `recordTopics`                                                                                 | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:113` |
| process manager     | `topicClustering`                                                                              | intents `run` (outbox)                                                                                       | `src/eventing/topic-clustering-processing.pipeline.ts:123` |
| process manager     | `topicClusteringSeed`                                                                          | every 1 h (`TOPIC_CLUSTERING_SEED_INTERVAL_MS = 60 * 60 * 1000`); intents `seedSchedules`, `seedTopicModels` | `src/eventing/topic-clustering-processing.pipeline.ts:127` |
| peer subscriber     | `topicClusteringFirstTraceBootstrap`                                                           | `lw.trace.first_trace_recorded` from [trace](../../trace/README.md)                                          | `src/eventing/topic-clustering-processing.pipeline.ts:136` |
| peer subscriber     | `topicClusteringTraceReceivedBootstrap`                                                        | `lw.trace.trace_received` from [trace](../../trace/README.md)                                                | `src/eventing/topic-clustering-processing.pipeline.ts:141` |
| Postgres projection | `≈ TopicClusteringRunStatusFoldProjection.create({ store: deps.topicClusteringRunStatusStore…` | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:98`  |
| Postgres projection | `≈ TopicClusteringRunHistoryFoldProjection.create({ store: deps.topicClusteringRunHistorySto…` | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:103` |
| Postgres projection | `≈ TopicModelFoldProjection.create({ store: deps.topicModelStore })`                           | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:108` |

### Tasks

Run by the tasks process, before serve.

| Task                   | Class                    | Declared at                                 |
| ---------------------- | ------------------------ | ------------------------------------------- |
| `topic-clustering-run` | `TopicClusteringRunTask` | `src/tasks/topic-clustering-run.task.ts:10` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
