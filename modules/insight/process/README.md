# @langwatch/insight-process

The server half of [insight](../README.md). The `insight_processing` pipeline, its two Postgres projections and the doors of the inbox; and the `insight_daily_run` pipeline, whose process wakes each person's daily run on a board, carries it out and keeps how it ended.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("insight").withRepositories(insightRepositories).withApi(InsightModule).withTransports(insightTrpcTransport).withEventing(insightEventing).withEventing(insightDailyRunEventing).withTasks(…)`, `src/insight.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InsightApi`)

Each person's own insights in a project. Every operation refuses with `insights_not_enabled` while `release_insights` is off for the project, and an insight another person owns answers `insight_not_found`, exactly as an id no insight has.

Peers call these through the token, declared at `../contract/src/insight.api.ts:21`; nothing else in this package is public.

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

Asks for one daily insights run now, for a person on a board. The answer names the request, never a run: the worker starts none for it while a run is in flight for that board.

```typescript
requestDailyRun(input: RequestInsightDailyRunInput): Promise<{ requestId: string }>;
```

#### `findDailyRuns`

The reader's own runs in the project, one per board, each with how its last run ended.

```typescript
findDailyRuns(input: { projectId: string } & Reader): Promise<InsightDailyRun[]>;
```

#### `getDailyRunSetting`

The reader's own daily run on one board: `undecided` until they turned it on or off.

```typescript
getDailyRunSetting(input: InsightBoardDailyRunScope & Reader): Promise<InsightDailyRunSetting>;
```

#### `configureDailyRun`

Turns the reader's daily run on for a board, or changes its hour, zone or maximum. A stored board the reader cannot open answers `dashboard_not_found`, like one that does not exist.

```typescript
configureDailyRun(input: ConfigureInsightDailyRunInput & Reader): Promise<void>;
```

#### `turnOffDailyRun`

Turns the reader's daily run off for a board; "No thanks" on the offer stores the same.

```typescript
turnOffDailyRun(input: TurnOffInsightDailyRunInput & Reader): Promise<void>;
```

## REST transport

None: this module declares no REST family.

## tRPC transport

### `insights`

Contract `../contract/src/insight.trpc.ts:28`, router `src/transport/insight.trpc.ts:10`.

| Procedure                         | Kind     | Gate                        | Input                                 | Output                         |
| --------------------------------- | -------- | --------------------------- | ------------------------------------- | ------------------------------ |
| `insights.getAll`                 | query    | Permission `analytics:view` | `insightProjectScopeSchema`           | inline                         |
| `insights.file`                   | mutation | Permission `analytics:view` | `fileInsightInputSchema`              | `insightEntrySchema`           |
| `insights.markSeen`               | mutation | Permission `analytics:view` | `markInsightsSeenInputSchema`         | inline                         |
| `insights.archive`                | mutation | Permission `analytics:view` | `insightScopeSchema`                  | inline                         |
| `insights.keep`                   | mutation | Permission `analytics:view` | `insightScopeSchema`                  | inline                         |
| `insights.getBoardDailyRun`       | query    | Permission `analytics:view` | `insightBoardDailyRunScopeSchema`     | `insightDailyRunSettingSchema` |
| `insights.configureBoardDailyRun` | mutation | Permission `analytics:view` | `configureInsightDailyRunInputSchema` | inline                         |
| `insights.turnOffBoardDailyRun`   | mutation | Permission `analytics:view` | `turnOffInsightDailyRunInputSchema`   | inline                         |

```typescript
// insights.getAll
// Input: insightProjectScopeSchema, ../contract/src/insight.ts:105
interface Input {
  projectId: string;
}
// Output: insightEntrySchema.array() (inline, ../contract/src/insight.trpc.ts:31)

// insights.file
type Input = z.infer<typeof fileInsightInputSchema>; // ../contract/src/insight.ts:107
type Output = z.infer<typeof insightEntrySchema>; // ../contract/src/insight.ts:79

// insights.markSeen
// Input: markInsightsSeenInputSchema, ../contract/src/insight.ts:133
interface Input {
  projectId: string;
  insightIds: string[];
}
// Output: inline, ../contract/src/insight.trpc.ts:39
type Output = unknown;

// insights.archive
// Input: insightScopeSchema, ../contract/src/insight.ts:126
interface Input {
  projectId: string;
  insightId: string;
}
// Output: inline, ../contract/src/insight.trpc.ts:43
type Output = unknown;

// insights.keep
type Input = z.infer<typeof insightScopeSchema>; // ../contract/src/insight.ts:126
// Output: inline, ../contract/src/insight.trpc.ts:47
type Output = unknown;

// insights.getBoardDailyRun
// Input: insightBoardDailyRunScopeSchema, ../contract/src/insight-daily-run.ts:153
interface Input {
  projectId: string;
  board: {
    kind: "dashboard" | "template";
    id: string;
  };
}
type Output = z.infer<typeof insightDailyRunSettingSchema>; // ../contract/src/insight-daily-run.ts:144

// insights.configureBoardDailyRun
type Input = z.infer<typeof configureInsightDailyRunInputSchema>; // ../contract/src/insight-daily-run.ts:160
// Output: inline, ../contract/src/insight.trpc.ts:56
type Output = unknown;

// insights.turnOffBoardDailyRun
type Input = z.infer<typeof turnOffInsightDailyRunInputSchema>; // ../contract/src/insight-daily-run.ts:168
// Output: inline, ../contract/src/insight.trpc.ts:60
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `insight_daily_run` (aggregate `insight_daily_schedule`)

Declared at `src/eventing/insight-daily-run.pipeline.ts:87`. Events: `INSIGHT_DAILY_RUN_EVENT_SCHEMAS`.

| Kind                | Name                                                                    | Handles                                                                                                   | Declared at                                      |
| ------------------- | ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| command             | `configureSchedule`                                                     | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:93`  |
| command             | `turnOffSchedule`                                                       | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:94`  |
| command             | `requestScheduleRearm`                                                  | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:95`  |
| command             | `requestRun`                                                            | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:96`  |
| command             | `recordRunStarted`                                                      | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:97`  |
| command             | `settleRun`                                                             | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:98`  |
| process manager     | `dailyInsightsSchedule`                                                 | intents `runBoard` (outbox)                                                                               | `src/eventing/insight-daily-run.pipeline.ts:99`  |
| process manager     | `dailyInsightsScheduleReconcile`                                        | every 1 h (`INSIGHT_SCHEDULE_RECONCILE_INTERVAL_MS = 60 * 60_000`); intents `reconcileSchedules` (outbox) | `src/eventing/insight-daily-run.pipeline.ts:116` |
| Postgres projection | `≈ createInsightDailyScheduleProjection({ store: deps.scheduleStore })` | –                                                                                                         | `src/eventing/insight-daily-run.pipeline.ts:92`  |

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
