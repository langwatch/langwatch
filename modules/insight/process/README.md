# @langwatch/insight-process

The server half of [insight](../README.md). The `insight_processing` pipeline, its two Postgres projections and the doors of the inbox; and the `insight_daily_run` pipeline, whose process carries out one daily run for a person on a board and keeps how it ended.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("insight").withRepositories(insightRepositories).withApi(InsightModule).withTransports(insightTrpcTransport).withEventing(insightEventing).withEventing(insightDailyRunEventing).withTasks(…)`, `src/insight.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InsightApi`)

Each person's own insights in a project. Every operation refuses with `insights_not_enabled` while `release_insights` is off for the project, and an insight another person owns answers `insight_not_found`, exactly as an id no insight has.

Peers call these through the token, declared at `../contract/src/insight.api.ts:14`; nothing else in this package is public.

#### `findInsights`

The reader's own insights in the project, newest first, each with their own state.

```typescript
findInsights(input: { projectId: string } & Reader): Promise<InsightEntry[]>;
```

#### `fileInsight`

Files an insight the reader owns; the answer is the entry as their inbox will show it.

```typescript
fileInsight(input: FileInsightInput & Reader): Promise<InsightEntry>;
```

#### `markInsightsSeen`

Ids the reader does not own are skipped, like ids no insight has.

```typescript
markInsightsSeen(input: { projectId: string; insightIds: readonly string[] } & Reader): Promise<void>;
```

#### `archiveInsight`

"Mark done": moves the insight to the reader's Archived folder.

```typescript
archiveInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
```

#### `keepInsight`

"Still relevant": back in the reader's inbox, whatever its validity says.

```typescript
keepInsight(input: { projectId: string; insightId: string } & Reader): Promise<void>;
```

#### `requestDailyRun`

Asks for one daily insights run now, for a person on a board. The worker carries it out as that person, as they are then, and records how it ended; the answer names the run.

```typescript
requestDailyRun(input: RequestInsightDailyRunInput): Promise<{ runId: string }>;
```

#### `findDailyRuns`

The reader's own runs in the project, one per board, each with how its last run ended.

```typescript
findDailyRuns(input: { projectId: string } & Reader): Promise<InsightDailyRun[]>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `insights`

Contract `../contract/src/insight.trpc.ts:19`, router `src/transport/insight.trpc.ts:10`.

| Procedure           | Kind     | Gate                        | Input                         | Output               |
| ------------------- | -------- | --------------------------- | ----------------------------- | -------------------- |
| `insights.getAll`   | query    | Permission `analytics:view` | `insightProjectScopeSchema`   | inline               |
| `insights.file`     | mutation | Permission `analytics:view` | `fileInsightInputSchema`      | `insightEntrySchema` |
| `insights.markSeen` | mutation | Permission `analytics:view` | `markInsightsSeenInputSchema` | inline               |
| `insights.archive`  | mutation | Permission `analytics:view` | `insightScopeSchema`          | inline               |
| `insights.keep`     | mutation | Permission `analytics:view` | `insightScopeSchema`          | inline               |

```typescript
// insights.getAll
// Input: insightProjectScopeSchema, ../contract/src/insight.ts:105
interface Input {
  projectId: string;
}
// Output: insightEntrySchema.array() (inline, ../contract/src/insight.trpc.ts:22)

// insights.file
type Input = z.infer<typeof fileInsightInputSchema>; // ../contract/src/insight.ts:107
type Output = z.infer<typeof insightEntrySchema>; // ../contract/src/insight.ts:79

// insights.markSeen
// Input: markInsightsSeenInputSchema, ../contract/src/insight.ts:133
interface Input {
  projectId: string;
  insightIds: string[];
}
// Output: inline, ../contract/src/insight.trpc.ts:30
type Output = unknown;

// insights.archive
// Input: insightScopeSchema, ../contract/src/insight.ts:126
interface Input {
  projectId: string;
  insightId: string;
}
// Output: inline, ../contract/src/insight.trpc.ts:34
type Output = unknown;

// insights.keep
type Input = z.infer<typeof insightScopeSchema>; // ../contract/src/insight.ts:126
// Output: inline, ../contract/src/insight.trpc.ts:38
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `insight_daily_run` (aggregate `insight_daily_schedule`)

Declared at `src/eventing/insight-daily-run.pipeline.ts:61`. Events: `INSIGHT_DAILY_RUN_EVENT_SCHEMAS`.

| Kind                | Name                                                                    | Handles                     | Declared at                                     |
| ------------------- | ----------------------------------------------------------------------- | --------------------------- | ----------------------------------------------- |
| command             | `requestRun`                                                            | –                           | `src/eventing/insight-daily-run.pipeline.ts:67` |
| command             | `recordRunStarted`                                                      | –                           | `src/eventing/insight-daily-run.pipeline.ts:68` |
| command             | `settleRun`                                                             | –                           | `src/eventing/insight-daily-run.pipeline.ts:69` |
| process manager     | `dailyInsightsSchedule`                                                 | intents `runBoard` (outbox) | `src/eventing/insight-daily-run.pipeline.ts:70` |
| Postgres projection | `≈ createInsightDailyScheduleProjection({ store: deps.scheduleStore })` | –                           | `src/eventing/insight-daily-run.pipeline.ts:66` |

### Pipeline `insight_processing` (aggregate `insight`)

Declared at `src/eventing/insight.pipeline.ts:39`. Events: `INSIGHT_EVENT_SCHEMAS`.

| Kind                | Name                                                           | Handles | Declared at                           |
| ------------------- | -------------------------------------------------------------- | ------- | ------------------------------------- |
| command             | `fileInsight`                                                  | –       | `src/eventing/insight.pipeline.ts:46` |
| command             | `markInsightSeen`                                              | –       | `src/eventing/insight.pipeline.ts:47` |
| command             | `archiveInsight`                                               | –       | `src/eventing/insight.pipeline.ts:48` |
| command             | `keepInsight`                                                  | –       | `src/eventing/insight.pipeline.ts:49` |
| Postgres projection | `≈ createInsightProjection({ store: deps.insightStore })`      | –       | `src/eventing/insight.pipeline.ts:44` |
| Postgres projection | `≈ createInsightReaderProjection({ store: deps.readerStore })` | –       | `src/eventing/insight.pipeline.ts:45` |

### Tasks

Run by the tasks process, before serve.

| Task                        | Class                        | Declared at                                      |
| --------------------------- | ---------------------------- | ------------------------------------------------ |
| `insight-daily-run-request` | `InsightDailyRunRequestTask` | `src/tasks/insight-daily-run-request.task.ts:16` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
