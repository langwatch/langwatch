# @langwatch/topic-process

The server half of [topic](../README.md). A project's conversation topics, and what the last topic-clustering run did.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("topic").withRepositories(topicRepositories).withApi(TopicModule).withTransports(topicTrpcTransport).withEventing(topicClusteringEventing).withTasks(…)`, `src/topic.module.ts:11`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`TopicApi`)

The project's conversation topics, and what the last clustering run did.

Peers call these through the token, declared at `../contract/src/topic.api.ts:13`; nothing else in this package is public.

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

#### `bootstrapClustering`

Re-asserts the project's clustering schedule, at most once per project per hour.

```typescript
bootstrapClustering(input: TopicProjectInput): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `topics`

Contract `../contract/src/topic.trpc.ts:20`, router `src/transport/topic.trpc.ts:11`.

| Procedure                        | Kind  | Gate                      | Input                     | Output                        |
| -------------------------------- | ----- | ------------------------- | ------------------------- | ----------------------------- |
| `topics.getAll`                  | query | Permission `traces:view`  | `topicProjectScopeSchema` | inline                        |
| `topics.getClusteringStatus`     | query | Permission `project:view` | `topicProjectScopeSchema` | `topicClusteringStatusSchema` |
| `topics.getClusteringRunHistory` | query | Permission `project:view` | `topicProjectScopeSchema` | inline                        |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `topic_clustering_processing` (aggregate `topic_clustering`)

Declared at `src/eventing/topic-clustering-processing.pipeline.ts:75`. Events: `TopicClusteringRequestedEventSchema`, `TopicClusteringRunStartedEventSchema`, `TopicClusteringRunCompletedEventSchema`, `TopicClusteringRunFailedEventSchema`, `TopicClusteringTopicsRecordedEventSchema`.

| Kind                | Name                                                                                           | Handles                                                                                                      | Declared at                                                |
| ------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------- |
| command             | `requestClustering`                                                                            | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:99`  |
| command             | `recordClusteringRunStarted`                                                                   | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:100` |
| command             | `recordClusteringRunCompleted`                                                                 | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:101` |
| command             | `recordClusteringRunFailed`                                                                    | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:102` |
| command             | `recordTopics`                                                                                 | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:103` |
| process manager     | `topicClustering`                                                                              | intents `run` (outbox)                                                                                       | `src/eventing/topic-clustering-processing.pipeline.ts:113` |
| process manager     | `topicClusteringSeed`                                                                          | every 1 h (`TOPIC_CLUSTERING_SEED_INTERVAL_MS = 60 * 60 * 1000`); intents `seedSchedules`, `seedTopicModels` | `src/eventing/topic-clustering-processing.pipeline.ts:114` |
| Postgres projection | `≈ TopicClusteringRunStatusFoldProjection.create({ store: deps.topicClusteringRunStatusStore…` | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:88`  |
| Postgres projection | `≈ TopicClusteringRunHistoryFoldProjection.create({ store: deps.topicClusteringRunHistorySto…` | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:93`  |
| Postgres projection | `≈ TopicModelFoldProjection.create({ store: deps.topicModelStore })`                           | –                                                                                                            | `src/eventing/topic-clustering-processing.pipeline.ts:98`  |

### Tasks

Run by the tasks process, before serve.

| Task                   | Class                    | Declared at                                 |
| ---------------------- | ------------------------ | ------------------------------------------- |
| `topic-clustering-run` | `TopicClusteringRunTask` | `src/tasks/topic-clustering-run.task.ts:10` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
