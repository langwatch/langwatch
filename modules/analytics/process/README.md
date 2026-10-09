# @langwatch/analytics-process

The server half of [analytics](../README.md). Analytics reads: timeseries, feedback and most-used documents over trace and evaluation data, the filter options that drive them, LangWatchQL, and the evaluation analytics rows behind those reads.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("analytics").withRepositories(analyticsRepositories).withChannels(analyticsChannels).withApi(AnalyticsModule).withTransports(analyticsRest, analyticsLegacyRest, queryRest, analyticsTrpcTransport, analyticsLwqlTrpcTransport).withTransportFacts(…).withEventing(lwqlReconvergenceEventing).withMigrations(…)`, `src/analytics.module.ts:25`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AnalyticsApi`)

The callable analytics capability shared by process peers.

Peers call these through the token, declared at `../contract/src/analytics.api.ts:66`; nothing else in this package is public.

#### `getTimeseries`

```typescript
getTimeseries(input: AnalyticsTimeseriesInput, options?: AnalyticsTimeseriesReadOptions): Promise<AnalyticsTimeseriesResult>;
```

#### `getFeedbacks`

```typescript
getFeedbacks(input: AnalyticsReadInput): Promise<AnalyticsFeedbacksResult>;
```

#### `getTopUsedDocuments`

```typescript
getTopUsedDocuments(input: AnalyticsReadInput): Promise<AnalyticsTopDocumentsResult>;
```

#### `filterOptions`

```typescript
filterOptions(input: { readonly projectId: string; readonly field: string; readonly startDate: number; readonly endDate: number; readonly query?: string; readonly key?: string; readonly subkey?: string; readonly filters?: Record<string, unknown>; }): Promise<AnalyticsFilterOption[]>;
```

#### `assertCustomChartPlaygroundEnabled`

Refuses the dashboard-widget surface while its project rollout is disabled.

```typescript
assertCustomChartPlaygroundEnabled(input: { projectId: string }): Promise<void>;
```

#### `upsertEvaluationAnalytics`

```typescript
upsertEvaluationAnalytics(input: AnalyticsEvaluationUpsertInput): Promise<void>;
```

#### `upsertEvaluationAnalyticsBatch`

```typescript
upsertEvaluationAnalyticsBatch(input: AnalyticsEvaluationUpsertInput[]): Promise<void>;
```

#### `findEvaluationAnalytics`

```typescript
findEvaluationAnalytics(input: AnalyticsEvaluationReadInput): Promise<{ row: AnalyticsEvaluationRow; appliedEventIds: string[]; } | null>;
```

#### `appendEvaluationAnalyticsRollup`

```typescript
appendEvaluationAnalyticsRollup(input: AnalyticsEvaluationRollupAppendInput): Promise<void>;
```

#### `appendEvaluationAnalyticsRollupBatch`

```typescript
appendEvaluationAnalyticsRollupBatch(input: AnalyticsEvaluationRollupAppendBatchInput): Promise<void>;
```

#### `findLastOccurredAt`

When the project's newest trace or evaluation since `since` occurred, from the analytics tables this module owns; empty when none did. The graph-alert heartbeat reads it.

```typescript
findLastOccurredAt(input: { readonly projectId: string; readonly source: AnalyticsMetricSource; readonly since: Instant; }): Promise<Instant[]>;
```

#### `isLangWatchQLAvailable`

```typescript
isLangWatchQLAvailable(): boolean;
```

#### `findAppFunctionsProvisionable`

Whether the LangWatchQL app functions can be created so every replica sees them. Empty where ClickHouse did not answer the settings the probe reads.

```typescript
findAppFunctionsProvisionable(): Promise<boolean[]>;
```

#### `langWatchQLDatabase`

The database this deployment's LangWatchQL views live in, which a module writing a statement against them has to name.

```typescript
langWatchQLDatabase(): string;
```

#### `describeLangWatchQLSchema`

Whether the eval functions are published as available is Analytics' own answer, read from this project's rollout — which is why the project is named and the caller never states the gate.

```typescript
describeLangWatchQLSchema(input: { projectId: string; protections: LangWatchQLProtections; }): Promise<LangWatchQLSchema>;
```

#### `describeQueryReference`

Both query languages in one document, pure apart from the caller's own reach, so the door answers it from memory. See ADR-154.

```typescript
describeQueryReference(input: { projectId: string; protections: LangWatchQLProtections; canRunLangWatchQL: boolean; }): Promise<QueryReference>;
```

#### `validateLangWatchQL`

Admits a statement, or throws the refusal. The verdict is what a caller storing or paging the statement needs from it, and nothing more.

```typescript
validateLangWatchQL(input: LangWatchQLValidationInput): LangWatchQLAcceptedStatement;
```

#### `describeLangWatchQLJudgements`

The judged columns a hydration plan asks for, in the catalogue's own vocabulary. Derived here because the catalogue is LangWatchQL's: which option of an eval function is its threshold, range or list is its answer.

```typescript
describeLangWatchQLJudgements(input: { appFunctions: readonly LangWatchQLAppFunctionCall[]; }): readonly LangWatchQLJudgementCall[];
```

#### `langWatchQLKeyCapFor`

The keys one execution of a hydration plan may hydrate, the lowest cap winning. Answered here because the caps are the catalogue's: a statement over conversations is bound far below one over traces.

```typescript
langWatchQLKeyCapFor(input: { appFunctions: readonly LangWatchQLAppFunctionCall[] }): number;
```

#### `executeLangWatchQL`

```typescript
executeLangWatchQL(input: LangWatchQLExecuteInput): Promise<LangWatchQLQueryResult>;
```

#### `executeLangWatchQLPass`

Re-validates the statement with the full policy, eval gate resolved from the project's rollout, then runs it inside the fixed wrapper its pass names: an instant-eval read.

```typescript
executeLangWatchQLPass(input: LangWatchQLPassInput): Promise<LangWatchQLQueryResult>;
```

#### `hydrateLangWatchQLTexts`

The extraction half of a judged plan: the same page with every judged column holding the text that would be judged rather than a verdict. No judge is called, so reading what a run judges costs nothing to judge.

```typescript
hydrateLangWatchQLTexts(input: LangWatchQLTextHydrationInput): Promise<readonly Record<string, unknown>[]>;
```

#### `isWorkbenchEnabled`

Whether this project's rollout admits it to the Workbench at all.

```typescript
isWorkbenchEnabled(input: { projectId: string }): Promise<boolean>;
```

#### `resolveProtections`

What one signed-in member may see of a project's content and spend.

```typescript
resolveProtections(input: { userId: string; projectId: string }): Promise<LangWatchQLProtections>;
```

#### `resolveApiKeyProtections`

What an API key may see of a project's content and spend — the same question {@link resolveProtections} answers for a signed-in member, asked of the credential instead of a session.

```typescript
resolveApiKeyProtections(input: { projectId: string; credential: RestCredentialPrincipal; }): Promise<LangWatchQLProtections>;
```

#### `resolveProjectProtections`

What the PROJECT itself may see, with nobody asking — the protections a job judging that project's own rows runs under, where there is neither a session nor a credential to resolve.

```typescript
resolveProjectProtections(input: Readonly<{ projectId: string }>): Promise<LangWatchQLProtections>;
```

#### `savedWorkbenchChartPlatformUrl`

The deep link back to the Workbench editor for a saved chart in this project.

```typescript
savedWorkbenchChartPlatformUrl(input: { projectSlug: string }): string;
```

#### `resolveRunCaller`

The restricted tenant identity a member's own statement runs as, together with their protections. Refuses with `project_not_found` when the project no longer exists.

```typescript
resolveRunCaller(input: { userId: string; projectId: string }): Promise<LangWatchQLRunCaller>;
```

#### `resolveApiKeyRunCaller`

What the PROJECT itself may see, with nobody asking — what a job judging that project's own rows runs under, with neither a session nor a credential.

```typescript
resolveApiKeyRunCaller(input: Readonly<{ projectId: string }>): Promise<LangWatchQLCaller>;
```

## REST transport

### `analyticsLegacyRest`

|             |                                             |
| ----------- | ------------------------------------------- |
| Declared at | `src/transport/analytics-legacy.rest.ts:52` |
| Base URL    | none: each route's path is its address      |
| Addressing  | literal                                     |
| Credential  | project                                     |

#### `POST /api/analytics` · `postApiAnalytics`

Query analytics timeseries (legacy path)

Permission `analytics:view`. Declared at `src/transport/analytics-legacy.rest.ts:57`.

Answers at `/api/analytics`, `/api/v1/analytics`.

```typescript
// Rawbody: "text" (inline, src/transport/analytics-legacy.rest.ts:59)
```

### `analyticsRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/analytics.rest.ts:27`       |
| Base URL    | `/api/analytics`, twin `/api/v1/analytics` |
| Addressing  | dated                                      |
| Credential  | project                                    |
| Versions    | `2026-08-07`                               |

#### `POST /timeseries` · `postApiAnalyticsTimeseries`

Query analytics timeseries data with metrics, aggregations, and filters

Permission `analytics:view`. Declared at `src/transport/analytics.rest.ts:31`.

Answers at `/api/analytics/timeseries`, `/api/v1/analytics/timeseries`; also, undocumented, `/api/analytics/2026-08-07/timeseries`, `/api/v1/analytics/2026-08-07/timeseries`, `/api/analytics/latest/timeseries`, `/api/v1/analytics/latest/timeseries`.

```typescript
type Body = z.infer<typeof analyticsTimeseriesRestBodySchema>; // ../contract/src/analytics.input-schemas.ts:164
// Response: analyticsTimeseriesResponseSchema, ../contract/src/analytics.input-schemas.ts:170
interface Response {
  currentPeriod: Record<string, unknown>[];
  previousPeriod: Record<string, unknown>[];
}
```

### `queryRest`

|             |                                   |
| ----------- | --------------------------------- |
| Declared at | `src/transport/query.rest.ts:106` |
| Base URL    | `/api/v1/query`                   |
| Addressing  | v1-only                           |
| Credential  | api_key                           |

#### `POST /` · `postApiV1Query`

Run a LangWatchQL query

Authenticated: Any API key reaches the projects it holds analytics:view on: the fan-out and the row policy enforce the scope, and a key that reads no project is a valid empty scope rather than a refusal. Declared at `src/transport/query.rest.ts:113`.

Answers at `/api/v1/query`.

```typescript
// Body: lwqlStatementSchema, ../contract/src/features/lwql/analytics-lwql.schemas.ts:92
interface Body {
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
  timeWindow?: {
    start: string | number | unknown;
    end: string | number | unknown;
  };
  granularitySeconds?: 1 | 60 | 3600;
}
type Response = z.infer<typeof lwqlResultSchema>; // ../contract/src/analytics.input-schemas.ts:180
```

#### `GET /schema` · `getApiV1QuerySchema`

Discover the queryable LangWatchQL schema

Authenticated: Any API key reaches the projects it holds analytics:view on: the fan-out and the row policy enforce the scope, and a key that reads no project is a valid empty scope rather than a refusal. Declared at `src/transport/query.rest.ts:143`.

Answers at `/api/v1/query/schema`.

```typescript
type Response = z.infer<typeof lwqlSchemaSchema>; // ../contract/src/analytics.input-schemas.ts:182
```

#### `GET /reference` · `getApiV1QueryReference`

Discover both query languages

Authenticated: Any credential for the project may read the reference: half of what it describes is the traces family's own filter vocabulary, so a key without analytics:view is answered with the LangWatchQL half withheld rather than refused. Declared at `src/transport/query.rest.ts:167`.

Answers at `/api/v1/query/reference`.

```typescript
type Response = z.infer<typeof queryReferenceSchema>; // ../contract/src/features/lwql/query-reference.ts:177
```

## tRPC transport

### `analytics.lwql`

Contract `../contract/src/features/lwql/analytics-lwql.trpc.ts:53`, router `src/transport/analytics-lwql.trpc.ts:68`.

| Procedure                     | Kind     | Gate                        | Input                    | Output                          |
| ----------------------------- | -------- | --------------------------- | ------------------------ | ------------------------------- |
| `analytics.lwql.availability` | query    | Permission `analytics:view` | `lwqlProjectScopeSchema` | `langWatchQLAvailabilitySchema` |
| `analytics.lwql.schema`       | query    | Permission `analytics:view` | `lwqlProjectScopeSchema` | `langWatchQLSchema`             |
| `analytics.lwql.validate`     | query    | Permission `analytics:view` | `lwqlRunRequestSchema`   | `lwqlValidationResultSchema`    |
| `analytics.lwql.query`        | mutation | Permission `analytics:view` | `lwqlRunRequestSchema`   | `langWatchQLQueryResultSchema`  |

```typescript
// analytics.lwql.availability
// Input: lwqlProjectScopeSchema, ../contract/src/features/lwql/analytics-lwql.trpc.ts:22
interface Input {
  projectId: string;
}
// Output: langWatchQLAvailabilitySchema, ../contract/src/features/lwql/analytics.lwql.ts:365
interface Output {
  available: boolean;
  reason?: "disabled" | "unprovisioned";
}

// analytics.lwql.schema
type Input = z.infer<typeof lwqlProjectScopeSchema>; // ../contract/src/features/lwql/analytics-lwql.trpc.ts:22
type Output = z.infer<typeof langWatchQLSchema>; // ../contract/src/features/lwql/analytics.lwql.ts:138

// analytics.lwql.validate
// Input: lwqlRunRequestSchema, ../contract/src/features/lwql/analytics-lwql.trpc.ts:25
interface Input {
  projectId: string;
  sql: string;
  parameters?: Record<string, string | number | boolean | null>;
  timeWindow?: {
    start: string | number | unknown;
    end: string | number | unknown;
  };
  granularitySeconds?: 1 | 60 | 3600;
}
type Output = z.infer<typeof lwqlValidationResultSchema>; // ../contract/src/features/lwql/analytics-lwql.trpc.ts:47

// analytics.lwql.query
type Input = z.infer<typeof lwqlRunRequestSchema>; // ../contract/src/features/lwql/analytics-lwql.trpc.ts:25
type Output = z.infer<typeof langWatchQLQueryResultSchema>; // ../contract/src/features/lwql/analytics.lwql.ts:55
```

### `analytics`

Contract `../contract/src/analytics.trpc.ts:34`, router `src/transport/analytics.trpc.ts:10`.

| Procedure                    | Kind  | Gate                        | Input                               | Output                               |
| ---------------------------- | ----- | --------------------------- | ----------------------------------- | ------------------------------------ |
| `analytics.getTimeseries`    | query | Permission `analytics:view` | `timeseriesInputSchema`             | `analyticsTimeseriesResultSchema`    |
| `analytics.dataForFilter`    | query | Permission `analytics:view` | `analyticsDataForFilterInputSchema` | `analyticsFilterOptionsResultSchema` |
| `analytics.topUsedDocuments` | query | Permission `cost:view`      | `sharedFiltersInputSchema`          | `analyticsTopDocumentsResultSchema`  |
| `analytics.feedbacks`        | query | Permission `cost:view`      | `sharedFiltersInputSchema`          | `analyticsFeedbacksResultSchema`     |

```typescript
// analytics.getTimeseries
type Input = z.infer<typeof timeseriesInputSchema>; // ../contract/src/analytics.input-schemas.ts:115
// Output: analyticsTimeseriesResultSchema, ../contract/src/analytics.timeseries.ts:77
interface Output {
  previousPeriod: {
    date: string;
    [key: string]: number | string | Record<string, Record<string, number>>;
  }[];
  currentPeriod: {
    date: string;
    [key: string]: number | string | Record<string, Record<string, number>>;
  }[];
}

// analytics.dataForFilter
type Input = z.infer<typeof analyticsDataForFilterInputSchema>; // ../contract/src/analytics.trpc.ts:29
// Output: analyticsFilterOptionsResultSchema, ../contract/src/analytics.timeseries.ts:154
interface Output {
  options: {
    field: string;
    label: string;
    count: number;
  }[];
}

// analytics.topUsedDocuments
type Input = z.infer<typeof sharedFiltersInputSchema>; // ../contract/src/analytics.input-schemas.ts:56
// Output: analyticsTopDocumentsResultSchema, ../contract/src/analytics.timeseries.ts:139
interface Output {
  topDocuments: {
    documentId: string;
    count: number;
    traceId: string;
    content?: string;
  }[];
  totalUniqueDocuments: number;
}

// analytics.feedbacks
type Input = z.infer<typeof sharedFiltersInputSchema>; // ../contract/src/analytics.input-schemas.ts:56
type Output = z.infer<typeof analyticsFeedbacksResultSchema>; // ../contract/src/analytics.timeseries.ts:126
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `lwql_reconvergence` (aggregate `global`)

Declared at `src/eventing/analytics-lwql-reconvergence.pipeline.ts:50`.

| Kind            | Name                | Handles                                                                          | Declared at                                                |
| --------------- | ------------------- | -------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| process manager | `lwqlReconvergence` | every 5 s (`LWQL_RECONVERGENCE_INITIAL_DELAY_MS`); intents `reconverge` (outbox) | `src/eventing/analytics-lwql-reconvergence.pipeline.ts:60` |
| peer subscriber | `syncLwqlKeyMapRow` | `lw.project.created` from [project](../../project/README.md)                     | `src/eventing/analytics-lwql-reconvergence.pipeline.ts:55` |

## Configuration

| Kind   | Leaf                          | Environment variable                      | Declared at                              |
| ------ | ----------------------------- | ----------------------------------------- | ---------------------------------------- |
| secret | `lwqlClickHousePassword`      | `LWQL_CLICKHOUSE_PASSWORD`                | `src/app/analytics.app.ts:352`           |
| secret | `lwqlPostgresReaderPassword`  | `LWQL_POSTGRES_READER_PASSWORD`           | `src/app/analytics.app.ts:353`           |
| config | `langwatchQl.url`             | `LWQL_CLICKHOUSE_URL`                     | `../contract/src/analytics.config.ts:11` |
| config | `langwatchQl.username`        | `LWQL_CLICKHOUSE_USER`                    | `../contract/src/analytics.config.ts:12` |
| config | `langwatchQl.database`        | `LWQL_DATABASE`                           | `../contract/src/analytics.config.ts:13` |
| config | `langwatchQl.tenantSetting`   | `LWQL_TENANT_SETTING`                     | `../contract/src/analytics.config.ts:14` |
| config | `langwatchQl.postgresHost`    | `LWQL_POSTGRES_HOST`                      | `../contract/src/analytics.config.ts:15` |
| config | `langwatchQl.accessModelMode` | `LWQL_ACCESS_MODEL_MODE`                  | `../contract/src/analytics.config.ts:16` |
| config | `langwatchQl.sqlSingleNode`   | `LWQL_ACCESS_MODEL_SQL_SINGLE_NODE`       | `../contract/src/analytics.config.ts:17` |
| config | `tenantAnalyticsConcurrency`  | `CLICKHOUSE_TENANT_ANALYTICS_CONCURRENCY` | `../contract/src/analytics.config.ts:20` |
| config | `publicBaseUrl`               | `BASE_HOST`                               | `../contract/src/analytics.config.ts:25` |

<!-- readme:generated:end -->
