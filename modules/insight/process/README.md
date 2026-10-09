# @langwatch/insight-process

The server half of [insight](../README.md). The `insight_processing` pipeline, its two Postgres projections and the doors of the inbox.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("insight").withRepositories(insightRepositories).withApi(InsightModule).withTransports(insightTrpcTransport).withEventing(insightEventing)`, `src/insight.module.ts:8`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`InsightApi`)

The project's insights inbox. Every operation refuses with `insights_not_enabled` while `release_insights` is off for the project.

Peers call these through the token, declared at `../contract/src/insight.api.ts:12`; nothing else in this package is public.

#### `findInsights`

The project's insights, newest first, each with the reader's own state.

```typescript
findInsights(input: { projectId: string } & Reader): Promise<InsightEntry[]>;
```

#### `fileInsight`

Files an insight; the answer is the entry as the inbox will show it.

```typescript
fileInsight(input: FileInsightInput & Reader): Promise<InsightEntry>;
```

#### `markInsightsSeen`

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

## REST transport

None: this module declares no REST family.

## tRPC transport

### `insights`

Contract `../contract/src/insight.trpc.ts:18`, router `src/transport/insight.trpc.ts:9`.

| Procedure           | Kind     | Gate                          | Input                         | Output               |
| ------------------- | -------- | ----------------------------- | ----------------------------- | -------------------- |
| `insights.getAll`   | query    | Permission `analytics:view`   | `insightProjectScopeSchema`   | inline               |
| `insights.file`     | mutation | Permission `analytics:manage` | `fileInsightInputSchema`      | `insightEntrySchema` |
| `insights.markSeen` | mutation | Permission `analytics:view`   | `markInsightsSeenInputSchema` | inline               |
| `insights.archive`  | mutation | Permission `analytics:view`   | `insightScopeSchema`          | inline               |
| `insights.keep`     | mutation | Permission `analytics:view`   | `insightScopeSchema`          | inline               |

```typescript
// insights.getAll
// Input: insightProjectScopeSchema, ../contract/src/insight.ts:45
interface Input {
  projectId: string;
}
// Output: insightEntrySchema.array() (inline, ../contract/src/insight.trpc.ts:21)

// insights.file
type Input = z.infer<typeof fileInsightInputSchema>; // ../contract/src/insight.ts:47
type Output = z.infer<typeof insightEntrySchema>; // ../contract/src/insight.ts:25

// insights.markSeen
// Input: markInsightsSeenInputSchema, ../contract/src/insight.ts:66
interface Input {
  projectId: string;
  insightIds: string[];
}
// Output: inline, ../contract/src/insight.trpc.ts:29
type Output = unknown;

// insights.archive
// Input: insightScopeSchema, ../contract/src/insight.ts:59
interface Input {
  projectId: string;
  insightId: string;
}
// Output: inline, ../contract/src/insight.trpc.ts:33
type Output = unknown;

// insights.keep
type Input = z.infer<typeof insightScopeSchema>; // ../contract/src/insight.ts:59
// Output: inline, ../contract/src/insight.trpc.ts:37
type Output = unknown;
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `insight_processing` (aggregate `insight`)

Declared at `src/eventing/insight.pipeline.ts:37`. Events: `INSIGHT_EVENT_SCHEMAS`.

| Kind                | Name                                                           | Handles | Declared at                           |
| ------------------- | -------------------------------------------------------------- | ------- | ------------------------------------- |
| command             | `fileInsight`                                                  | –       | `src/eventing/insight.pipeline.ts:44` |
| command             | `markInsightSeen`                                              | –       | `src/eventing/insight.pipeline.ts:45` |
| command             | `archiveInsight`                                               | –       | `src/eventing/insight.pipeline.ts:46` |
| command             | `keepInsight`                                                  | –       | `src/eventing/insight.pipeline.ts:47` |
| Postgres projection | `≈ createInsightProjection({ store: deps.insightStore })`      | –       | `src/eventing/insight.pipeline.ts:42` |
| Postgres projection | `≈ createInsightReaderProjection({ store: deps.readerStore })` | –       | `src/eventing/insight.pipeline.ts:43` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
