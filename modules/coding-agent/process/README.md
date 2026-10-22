# @langwatch/coding-agent-process

The server half of [coding-agent](../README.md). Coding-agent observability: sessions built from coding-agent traces, their transcripts, and the pull requests those sessions are linked to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("coding-agent").withRepositories(codingAgentRepositories).withApi(CodingAgentModule).withTransports(codingAgentRest, codingAgentRollupRest, codingAgentV1Rest, codingAgentTrpcTransport).withEventing(codingAgentEventing).withEventing(codingAgentProjectMilestonesEventing).provideMiddlewareContext(…).withIdIndexes(CODING_AGENT_ID_INDEXES, …)`, `src/coding-agent.module.ts:22`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`CodingAgentApi`)

Peers call these through the token, declared at `../contract/src/coding-agent.api.ts:62`; nothing else in this package is public.

#### `findBySessionId`

```typescript
findBySessionId(input: CodingAgentSessionLookupInput): Promise<CodingAgentSession | null>;
```

#### `findSessionForTrace`

```typescript
findSessionForTrace(input: { projectId: string; traceId: string; }): Promise<CodingAgentSession | null>;
```

#### `readTranscriptForViewer`

```typescript
readTranscriptForViewer(input: { projectId: string; traceId: string; occurredAtMs?: number | undefined; viewerUserId: string; authorization?: Authorization; }): Promise<CodingAgentTranscript>;
```

#### `linkTraceSessionsToPullRequests`

```typescript
linkTraceSessionsToPullRequests(input: CodingAgentTracePullRequestInput): Promise<CodingAgentTracePullRequestLink[]>;
```

#### `getSessionEvents`

```typescript
getSessionEvents(input: CodingAgentSessionEventsInput): Promise<{ events: CodingAgentSessionEvent[]; nextCursor: CodingAgentSessionCursor | null; }>;
```

#### `readSessionEventsPage`

A session's events page: the window checked, the opaque cursor decoded and re-encoded.

```typescript
readSessionEventsPage(input: CodingAgentSessionEventsPageInput): Promise<CodingAgentSessionEventsPage>;
```

#### `getUsageTotals`

```typescript
getUsageTotals(input: CodingAgentUsageTotalsInput): Promise<CodingAgentUsageTotals>;
```

#### `listRecent`

```typescript
listRecent(input: CodingAgentRecentSessionsInput): Promise<CodingAgentSession[]>;
```

#### `listForProject`

The Sessions screen's rows, cut to what this viewer may see (title under content visibility, cost under `cost:view`), read through the route's proof so an aggregate's page spans its members (ADR-177).

```typescript
listForProject(input: CodingAgentSessionsListInput & { authorization: Authorization }, by: CodingAgentViewer): Promise<CodingAgentSessionListRow[]>;
```

#### `contributeSpanFacts`

Queues one span's bounded session facts onto coding_agent_processing (ADR-056/069).

```typescript
contributeSpanFacts(data: ContributeSpanFactsCommandData): Promise<void>;
```

#### `readSessionGroupsForViewer`

The Sessions lens (main's `traces.sessions`): trace's page for the viewer, enriched here.

```typescript
readSessionGroupsForViewer(input: TraceSessionGroupsInput & { viewerUserId: string; authorization: Authorization }): Promise<TracesSessionsPage>;
```

#### `recordPullRequestUsageRead`

Records who read an answer that names people.

```typescript
recordPullRequestUsageRead(read: CodingAgentPullRequestUsageRead): Promise<void>;
```

#### `githubWebBase`

```typescript
githubWebBase(): string;
```

#### `findOrganizationForProject`

```typescript
findOrganizationForProject(projectId: string): Promise<string | undefined>;
```

#### `getPullRequestUsage`

```typescript
getPullRequestUsage(pullRequest: { projectId: string; repositoryHost: string; repositoryFullName: string; prNumber: number; }, by: CodingAgentCallerScope): Promise<{ usage: CodingAgentPullRequestUsage; organizationId: string }>;
```

#### `getOrganizationPullRequestUsage`

```typescript
getOrganizationPullRequestUsage(pullRequest: { organizationId: string; repositoryHost: string; repositoryFullName: string; prNumber: number; }, by: CodingAgentCallerScope): Promise<CodingAgentPullRequestUsage>;
```

#### `getPullRequestDetail`

```typescript
getPullRequestDetail(pullRequest: { projectId: string; repositoryHost: string; repositoryFullName: string; prNumber: number; }, by: { readonly id: string }): Promise<CodingAgentPullRequestDetail>;
```

#### `getPersonalProjectPullRequestUsage`

```typescript
getPersonalProjectPullRequestUsage(input: { projectId: string }, by: { readonly id: string }): Promise<CodingAgentPersonalPullRequestUsage & { connection: CodingAgentGithubConnection }>;
```

#### `githubConnection`

```typescript
githubConnection(organizationId: string | undefined): Promise<CodingAgentGithubConnection>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number; }): Promise<CodingAgentUsageCount>;
```

## REST transport

### `codingAgentV1Rest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/coding-agent-v1.rest.ts:39` |
| Base URL    | none: each route's path is its address     |
| Addressing  | literal                                    |
| Credential  | organization                               |

#### `GET /api/v1/coding-agent/pull-request-usage` · `getOrganizationCodingAgentPullRequestUsage`

Get pull request coding agent usage

Authenticated: authentication is the organization key; the authorization is the caller's per-project cut, resolved by the application with the key as the principal, because no single organization-scope permission describes the projects one credential may read. Declared at `src/transport/coding-agent-v1.rest.ts:47`.

Answers at `/api/v1/coding-agent/pull-request-usage`.

```typescript
// Query: pullRequestUsageQuerySchema, src/rules/pull-request-usage-wire.rules.ts:73
interface Query {
  repository: string;
  pullRequest: number;
  host?: string;
}
type Response = z.infer<typeof pullRequestUsageResponseSchema>; // src/rules/pull-request-usage-wire.rules.ts:46
```

### `codingAgentRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/coding-agent.rest.ts:64`          |
| Base URL    | `/api/coding-agent`, twin `/api/v1/coding-agent` |
| Addressing  | dated                                            |
| Credential  | project                                          |
| Versions    | `2026-08-07`                                     |

#### `GET /sessions/:sessionId/events` · `getApiCodingAgentSessionsBySessionIdEvents`

List coding agent session events

Permission `traces:view`. Declared at `src/transport/coding-agent.rest.ts:68`.

Answers at `/api/coding-agent/sessions/:sessionId/events`, `/api/v1/coding-agent/sessions/:sessionId/events`; also, undocumented, `/api/coding-agent/2026-08-07/sessions/:sessionId/events`, `/api/v1/coding-agent/2026-08-07/sessions/:sessionId/events`, `/api/coding-agent/latest/sessions/:sessionId/events`, `/api/v1/coding-agent/latest/sessions/:sessionId/events`.

```typescript
// Params: codingAgentSessionEventsRestParamsSchema, ../contract/src/coding-agent.ts:353
interface Params {
  sessionId: string;
}
// Query: codingAgentSessionEventsRestQuerySchema, ../contract/src/coding-agent.ts:398
interface Query {
  limit?: number;
  kinds?: string;
  from?: number;
  to?: number;
  cursor?: string;
}
type Response = z.infer<typeof codingAgentSessionEventsRestResponseSchema>; // ../contract/src/coding-agent.ts:408
```

### `codingAgentRollupRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/coding-agent.rest.ts:89` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `GET /api/coding-agent/pull-request-usage` · `getApiCodingAgentPullRequestUsage`

Get pull request coding agent usage

Permission `traces:view`. Declared at `src/transport/coding-agent.rest.ts:95`.

Answers at `/api/coding-agent/pull-request-usage`.

```typescript
type Query = z.infer<typeof pullRequestUsageQuerySchema>; // src/rules/pull-request-usage-wire.rules.ts:73
type Response = z.infer<typeof pullRequestUsageResponseSchema>; // src/rules/pull-request-usage-wire.rules.ts:46
```

## tRPC transport

### `codingAgents`

Contract `../contract/src/coding-agent.trpc.ts:25`, router `src/transport/coding-agent.trpc.ts:29`.

| Procedure                        | Kind  | Gate                     | Input                                         | Output                                                    |
| -------------------------------- | ----- | ------------------------ | --------------------------------------------- | --------------------------------------------------------- |
| `codingAgents.usageTotals`       | query | Permission `traces:view` | `codingAgentTrpcUsageTotalsInputSchema`       | `codingAgentUsageTotalsSchema`                            |
| `codingAgents.recentSessions`    | query | Permission `traces:view` | `codingAgentTrpcRecentSessionsInputSchema`    | inline                                                    |
| `codingAgents.sessionsList`      | query | Permission `traces:view` | `codingAgentTrpcProjectScopeSchema`           | inline                                                    |
| `codingAgents.pullRequestUsage`  | query | Permission `traces:view` | `codingAgentTrpcProjectScopeSchema`           | `codingAgentPersonalPullRequestUsageWithConnectionSchema` |
| `codingAgents.pullRequestDetail` | query | Permission `traces:view` | `codingAgentTrpcPullRequestDetailInputSchema` | `codingAgentPullRequestDetailSchema`                      |
| `codingAgents.session`           | query | Permission `traces:view` | inline                                        | inline                                                    |
| `codingAgents.transcript`        | query | Permission `traces:view` | `codingAgentTrpcTraceScopeSchema`             | `codingAgentTranscriptSchema`                             |
| `codingAgents.sessionGroups`     | query | Permission `traces:view` | `traceSessionGroupsInputSchema`               | `tracesSessionsPageSchema`                                |

```typescript
// codingAgents.usageTotals
// Input: codingAgentTrpcUsageTotalsInputSchema, ../contract/src/coding-agent-trpc.schemas.ts:39
interface Input {
  projectId: string;
  fromMs?: number;
  toMs?: number;
}
// Output: codingAgentUsageTotalsSchema, ../contract/src/coding-agent.ts:482
interface Output {
  sessionCount: number;
  costUsd: number;
  totalTokens: number;
  activeTimeSec: number;
  linesAdded: number;
  linesRemoved: number;
  commits: number;
  pullRequests: number;
}

// codingAgents.recentSessions
// Input: codingAgentTrpcRecentSessionsInputSchema, ../contract/src/coding-agent-trpc.schemas.ts:51
interface Input {
  projectId: string;
  fromMs?: number;
  toMs?: number;
  limit?: number;
}
// Output: codingAgentSessionSchema.array() (inline, ../contract/src/coding-agent.trpc.ts:35)

// codingAgents.sessionsList
// Input: codingAgentTrpcProjectScopeSchema, ../contract/src/coding-agent-trpc.schemas.ts:15
interface Input {
  projectId: string;
}
// Output: codingAgentSessionListRowSchema.array() (inline, ../contract/src/coding-agent.trpc.ts:41)

// codingAgents.pullRequestUsage
type Input = z.infer<typeof codingAgentTrpcProjectScopeSchema>; // ../contract/src/coding-agent-trpc.schemas.ts:15
type Output = z.infer<typeof codingAgentPersonalPullRequestUsageWithConnectionSchema>; // ../contract/src/coding-agent.ts:870

// codingAgents.pullRequestDetail
// Input: codingAgentTrpcPullRequestDetailInputSchema, ../contract/src/coding-agent-trpc.schemas.ts:63
interface Input {
  projectId: string;
  repositoryHost: string;
  repositoryFullName: string;
  prNumber: number;
}
type Output = z.infer<typeof codingAgentPullRequestDetailSchema>; // ../contract/src/coding-agent.ts:779

// codingAgents.session
// Input: inline, ../contract/src/coding-agent.trpc.ts:58
interface Input {
  projectId: string;
  traceId: string;
}
// Output: codingAgentSessionSchema.nullable() (inline, ../contract/src/coding-agent.trpc.ts:59)

// codingAgents.transcript
// Input: codingAgentTrpcTraceScopeSchema, ../contract/src/coding-agent-trpc.schemas.ts:27
interface Input {
  projectId: string;
  traceId: string;
  occurredAtMs?: number;
}
type Output = z.infer<typeof codingAgentTranscriptSchema>; // ../contract/src/coding-agent-transcript.ts:100

// codingAgents.sessionGroups
type Input = z.infer<typeof traceSessionGroupsInputSchema>; // ../../trace/contract/src/traces.trpc.ts:153
type Output = z.infer<typeof tracesSessionsPageSchema>; // ../../trace/contract/src/trace.responses.ts:148
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `coding_agent_processing` (aggregate `coding_agent_session`)

Declared at `src/eventing/coding-agent-processing.pipeline.ts:152`. Events: `spanFactsContributedEventSchema`, `logFactsContributedEventSchema`, `metricFactsContributedEventSchema`.

| Kind                       | Name                                                                                           | Handles                                                                   | Declared at                                            |
| -------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------ |
| command                    | –                                                                                              | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:250` |
| command                    | –                                                                                              | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:256` |
| command                    | –                                                                                              | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:262` |
| subscriber                 | `codingAgentCostDrift`                                                                         | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:194` |
| peer subscriber            | `codingAgentSpanFactsDispatch`                                                                 | `lw.obs.trace.span_received` from [trace](../../trace/README.md)          | `src/eventing/coding-agent-processing.pipeline.ts:202` |
| peer subscriber            | `codingAgentLogFactsDispatch`                                                                  | `lw.obs.log.record_received` from [log](../../log/README.md)              | `src/eventing/coding-agent-processing.pipeline.ts:222` |
| peer subscriber            | `codingAgentMetricFactsDispatch`                                                               | `lw.obs.metric.data_point_received` from [metric](../../metric/README.md) | `src/eventing/coding-agent-processing.pipeline.ts:234` |
| ClickHouse fold projection | `≈ CodingAgentSessionFoldProjection.create({ store: sessionStore, traceCanonicalisation: dep…` | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:163` |
| ClickHouse map projection  | `≈ CodingAgentTraceSessionsMapProjection.create({ store: EventingCodingAgentTraceSessionAppe…` | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:170` |
| ClickHouse map projection  | `≈ SessionMetricSeriesMapProjection.create({ store: EventingSessionMetricSeriesAppendService…` | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:178` |
| ClickHouse map projection  | `≈ CodingAgentSessionEventsMapProjection.create({ store: EventingCodingAgentSessionEventsApp…` | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:186` |
| lane aliases               | `≈ MAIN_FACTS_DISPATCH_ALIASES`                                                                | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:246` |
| projection subscriber      | `pullRequestMapping`                                                                           | –                                                                         | `src/eventing/coding-agent-processing.pipeline.ts:272` |

### Pipeline `coding_agent_project_milestones` (aggregate `coding_agent_project_milestone`)

Declared at `src/eventing/coding-agent-project-milestones.pipeline.ts:18`. Events: `codingAgentSessionStoredEventSchema`.

| Kind      | Name                  | Handles | Declared at                                                   |
| --------- | --------------------- | ------- | ------------------------------------------------------------- |
| command   | `recordSessionStored` | –       | `src/eventing/coding-agent-project-milestones.pipeline.ts:23` |
| retention | `≈ retention`         | –       | `src/eventing/coding-agent-project-milestones.pipeline.ts:24` |

## Configuration

| Kind   | Leaf                  | Environment variable               | Declared at                                |
| ------ | --------------------- | ---------------------------------- | ------------------------------------------ |
| config | `foldCacheTtlSeconds` | `LANGWATCH_FOLD_CACHE_TTL_SECONDS` | `../contract/src/coding-agent.config.ts:4` |

<!-- readme:generated:end -->
