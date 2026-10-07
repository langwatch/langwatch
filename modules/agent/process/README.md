# @langwatch/agent-process

The server half of [agent](../README.md). Agents a project builds and runs: their workflow configurations, the connected agent instances that register and poll, and calls made to them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("agent").withRepositories(agentRepositories).withApi(AgentModule).withTransports(…, …, …, agentLegacyRest, agentTrpcTransport, httpProxyTrpcTransport).withTasks(…).withTransportFacts(…)`, `src/agent.module.ts:21`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AgentApi`)

Callable capability exposed by the composed Agent application.

Peers call these through the token, declared at `../contract/src/agent.api.ts:43`; nothing else in this package is public.

#### `listWorkflowConfigs`

```typescript
listWorkflowConfigs(input: AgentWorkflowInput): Promise<AgentWorkflowConfig[]>;
```

#### `updateWorkflowConfig`

```typescript
updateWorkflowConfig(input: UpdateAgentWorkflowConfigInput): Promise<void>;
```

#### `getPresence`

```typescript
getPresence(input: { projectId: string; agents: readonly { id: string; type: string }[]; }): Promise<Map<string, AgentPresence>>;
```

#### `call`

```typescript
call(input: AgentCallInput, context: AgentCallContext): Promise<AgentCallResult>;
```

#### `acceptConnection`

```typescript
acceptConnection(connection: AgentConnection, admission: AgentConnectAdmission): Promise<void>;
```

#### `connectRegister`

```typescript
connectRegister(body: unknown, credentials: AgentConnectCredentials): Promise<AgentConnectRegisterAnswer>;
```

#### `registerConnectedAgentInstance`

```typescript
registerConnectedAgentInstance(input: AgentConnectRegisterInput, credentials: AgentConnectCredentials): Promise<AgentConnectRegisterOutput>;
```

#### `connectPoll`

```typescript
connectPoll(input: AgentConnectPollInput, credentials: AgentConnectCredentials): Promise<AgentConnectPollAnswer>;
```

#### `connectFrames`

```typescript
connectFrames(input: AgentConnectFramesInput, credentials: AgentConnectCredentials): Promise<{ accepted: number }>;
```

#### `callConnected`

```typescript
callConnected(input: { projectId: string; agent: DispatchAgent; call: DispatchCall; signal?: AgentCallSignal; }): Promise<CallOutcome>;
```

#### `exists`

```typescript
exists(input: { id: string; projectId: string }): Promise<boolean>;
```

#### `registerConnected`

```typescript
registerConnected(input: RegisterConnectedAgentInput): Promise<Agent>;
```

#### `createVoiceAgent`

The voice row a "Talk to it" hang-up saves, deduped by its identity key (#8020).

```typescript
createVoiceAgent(input: { id: string; projectId: string; name: string; transport: VoiceTransport; agentId: string; }): Promise<Agent>;
```

#### `hasVoiceAgentForExternalId`

```typescript
hasVoiceAgentForExternalId(input: { projectId: string; transport: VoiceTransport; agentExternalId: string; }): Promise<boolean>;
```

#### `touchLastSeenAt`

```typescript
touchLastSeenAt(input: { id: string; projectId: string; at: Instant }): Promise<void>;
```

#### `findIdsCreatedInWindow`

The ids of the agents created in a window, oldest first, archived ones included: main's candidate query for the agent audit-log id backfill (scripts/backfill-agent-audit-log-ids.ts).

```typescript
findIdsCreatedInWindow(input: AgentCreationWindowInput): Promise<string[]>;
```

#### `executeHttpTest`

```typescript
executeHttpTest(input: HttpAgentTestInput & { actorId: string }): Promise<HttpProxyResult>;
```

#### `listWithPresence`

```typescript
listWithPresence(input: { projectId: string; page: number; limit: number; viewerUserId?: string | null; }): Promise<AgentOverviewPage>;
```

#### `getCopiesForActor`

```typescript
getCopiesForActor(input: { agentId: string; projectId: string; actorId: string; }): Promise<AgentCopy[]>;
```

#### `copyForActor`

```typescript
copyForActor(input: CopyAgentCommand & { actorId: string }): Promise<agentQueriesModule.AgentCopyCreated>;
```

#### `pushToCopiesForActor`

```typescript
pushToCopiesForActor(input: { agentId: string; projectId: string; copyIds?: string[]; actorId: string; }): Promise<agentQueriesModule.AgentPushToCopies>;
```

#### `syncFromSourceForActor`

```typescript
syncFromSourceForActor(input: { agentId: string; projectId: string; actorId: string; }): Promise<{ ok: true }>;
```

#### `getAll`

```typescript
getAll(input: { projectId: string; viewerUserId?: string | null }): Promise<AgentOverview[]>;
```

#### `getById`

```typescript
getById(input: { id: string; projectId: string; viewerUserId?: string | null; }): Promise<AgentOverview>;
```

#### `list`

```typescript
list(input: { projectId: string; page: number; limit: number }): Promise<AgentPage>;
```

#### `create`

```typescript
create(input: CreateAgentCommand): Promise<AgentWithFields>;
```

#### `update`

```typescript
update(input: UpdateAgentCommand): Promise<AgentWithFields>;
```

#### `archive`

```typescript
archive(input: ArchiveAgentCommand): Promise<Agent>;
```

#### `relatedEntities`

```typescript
relatedEntities(input: { id: string; projectId: string }): Promise<RelatedAgentEntities>;
```

#### `cascadeArchive`

```typescript
cascadeArchive(input: ArchiveAgentCommand): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }>;
```

#### `getCopies`

```typescript
getCopies(input: { sourceAgentId: string; allowedProjectIds?: string[] }): Promise<AgentCopy[]>;
```

#### `getSourceOfCopy`

```typescript
getSourceOfCopy(input: { agentId: string; projectId: string }): Promise<Agent>;
```

#### `copy`

```typescript
copy(input: CopyAgentCommand): Promise<{ id: string; projectId: string; name: string; copiedFromAgentId: string; }>;
```

#### `pushToCopies`

```typescript
pushToCopies(input: { sourceAgentId: string; sourceProjectId: string; copyIds?: string[]; }): Promise<{ pushedTo: number; selectedCopies: number }>;
```

#### `syncFromSource`

```typescript
syncFromSource(input: { agentId: string; projectId: string }): Promise<{ ok: true }>;
```

#### `getHistory`

```typescript
getHistory(input: { agentId: string; projectId: string }): Promise<AgentHistoryEntry[]>;
```

#### `ownersOf`

```typescript
ownersOf(agents: readonly { ownerUserId: string | null }[]): Promise<Map<string, { userId: string; name: string | null }>>;
```

#### `getNamesByIds`

```typescript
getNamesByIds(input: { ids: string[]; projectId: string; }): Promise<{ id: string; name: string }[]>;
```

#### `getReferenceStates`

```typescript
getReferenceStates(input: { ids: string[]; projectId: string }): Promise<AgentReferenceState[]>;
```

#### `getConnectedByNameAndEnvironment`

```typescript
getConnectedByNameAndEnvironment(input: { projectId: string; name: string; environment: string; }): Promise<Agent[]>;
```

#### `getConnectedByName`

```typescript
getConnectedByName(input: { projectId: string; name: string }): Promise<Agent[]>;
```

#### `findConnectedInProjects`

Unarchived, recently seen connected agents in these projects, newest registration first.

```typescript
findConnectedInProjects(input: { projectIds: string[] }): Promise<Agent[]>;
```

#### `platformUrl`

The platform's own deep link to this agent's editor drawer.

```typescript
platformUrl(input: { projectSlug: string; agentId: string; agentType: string }): string;
```

## REST transport

### `createAgentConnectRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/agent-connect.rest.ts:101` |
| Base URL    | `/api/v1/agents`                          |
| Addressing  | v1-only                                   |
| Credential  | project                                   |

#### `POST /connect/register` · `registerConnectedAgentInstance`

Register this process's agents

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:108`.

Answers at `/api/v1/agents/connect/register`.

```typescript
type Body = z.infer<typeof agentConnectRegisterInputSchema>; // ../contract/src/connected-agent.connection.ts:51
// Response: "protocol" (inline, src/transport/agent-connect.rest.ts:112)
```

#### `GET /connect/poll` · `pollConnectedAgentInstance`

Wait for call and cancel frames while refreshing this instance's presence

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:138`.

Answers at `/api/v1/agents/connect/poll`.

```typescript
type Query = z.infer<typeof agentConnectPollQuerySchema>; // ../contract/src/connected-agent.connection.ts:56
// Response: "protocol" (inline, src/transport/agent-connect.rest.ts:142)
```

#### `POST /connect/frames` · `postConnectedAgentFrames`

Accept this instance's acknowledgements, results and deregistration

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:164`.

Answers at `/api/v1/agents/connect/frames`.

```typescript
type Body = z.infer<typeof agentConnectFramesInputSchema>; // ../contract/src/connected-agent.connection.ts:66
// Response: "protocol" (inline, src/transport/agent-connect.rest.ts:168)
```

### `agentLegacyRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/agent-legacy.rest.ts:63` |
| Base URL    | `/api/agents`                           |
| Addressing  | dated                                   |
| Credential  | project                                 |
| Versions    | `2026-08-07`                            |
| Deprecated  | yes                                     |

#### `GET /` · `listAgents`

List agents; superseded by /api/v1/agents

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:75`.

Answers at `/api/agents`; also, undocumented, `/api/agents/2026-08-07`, `/api/agents/latest`.

```typescript
type Query = z.infer<typeof agentRestQuerySchema>; // ../contract/src/agent-rest.schemas.ts:12
type Response = z.infer<typeof legacyListResponse>; // src/transport/agent-legacy.rest.ts:36
```

#### `POST /` · `createAgent`

Create an agent; superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:90`.

Answers at `/api/agents`; also, undocumented, `/api/agents/2026-08-07`, `/api/agents/latest`.

```typescript
type Body = z.infer<typeof createAgentRequestSchema>; // ../contract/src/agent.commands.ts:70
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:27
```

#### `GET /:id` · `getAgent`

Get an agent; superseded by /api/v1/agents

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:103`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:27
```

#### `PATCH /:id` · `updateAgent`

Update an agent; superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:113`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:105
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:27
```

#### `PUT /:id` · `replaceAgent`

Update an agent (PUT keeps partial semantics); superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:124`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:105
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:27
```

#### `DELETE /:id` · `archiveAgent`

Archive an agent; superseded by /api/v1/agents

Permission `project:delete`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:138`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Response = z.infer<typeof archiveResultSchema>; // ../contract/src/agent-rest.schemas.ts:93
```

### `createAgentRest`

|             |                                  |
| ----------- | -------------------------------- |
| Declared at | `src/transport/agent.rest.ts:92` |
| Base URL    | `/api/v1/agents`                 |
| Addressing  | v1-only                          |
| Credential  | project                          |

#### `GET /` · `listAgents`

List agents with their current presence and owner

Permission `project:view`. Declared at `src/transport/agent.rest.ts:100`.

Answers at `/api/v1/agents`.

```typescript
type Query = z.infer<typeof agentRestQuerySchema>; // ../contract/src/agent-rest.schemas.ts:12
type Response = z.infer<typeof agentListResponseSchema>; // ../contract/src/agent-rest.schemas.ts:83
```

#### `POST /` · `createAgent`

Create an authored agent; connected agents register through the SDK

Permission `project:update`. Declared at `src/transport/agent.rest.ts:119`.

Answers at `/api/v1/agents`.

```typescript
type Body = z.infer<typeof createAgentRequestSchema>; // ../contract/src/agent.commands.ts:70
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:17
```

#### `GET /:id` · `getAgent`

Get an agent in the caller's project

Permission `project:view`. Declared at `src/transport/agent.rest.ts:137`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:17
```

#### `PATCH /:id` · `updateAgent`

Update an authored agent

Permission `project:update`. Declared at `src/transport/agent.rest.ts:153`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:105
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:17
```

#### `PUT /:id` · `replaceAgent`

Update an authored agent; PUT retains partial update semantics

Permission `project:update`. Declared at `src/transport/agent.rest.ts:171`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:105
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:17
```

#### `DELETE /:id` · `archiveAgent`

Archive an agent while keeping its runs

Permission `project:delete`. Declared at `src/transport/agent.rest.ts:189`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Response = z.infer<typeof archiveResultSchema>; // ../contract/src/agent-rest.schemas.ts:93
```

#### `POST /:id/call` · `callConnectedAgent`

Send one conversation turn to an online connected agent

Permission `scenarios:create`. Declared at `src/transport/agent.rest.ts:200`.

Answers at `/api/v1/agents/:id/call`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:8
type Body = z.infer<typeof relayCallBodySchema>; // ../contract/src/connected-agent.call.ts:11
type Response = z.infer<typeof relayCallResponseSchema>; // ../contract/src/connected-agent.call.ts:39
```

## tRPC transport

### `agents`

Contract `../contract/src/agent.trpc.ts:28`, router `src/transport/agent.trpc.ts:16`.

| Procedure                   | Kind     | Gate                            | Input                               | Output                           |
| --------------------------- | -------- | ------------------------------- | ----------------------------------- | -------------------------------- |
| `agents.getAll`             | query    | Permission `evaluations:view`   | `agentApiProjectInputSchema`        | inline                           |
| `agents.getById`            | query    | Permission `evaluations:view`   | `agentApiAgentInputSchema`          | `agentWithLegacyCopyCountSchema` |
| `agents.create`             | mutation | Permission `evaluations:manage` | `createAgentCommandSchema`          | `agentWithFieldsSchema`          |
| `agents.update`             | mutation | Permission `evaluations:manage` | `updateAgentCommandSchema`          | `agentWithFieldsSchema`          |
| `agents.getRelatedEntities` | query    | Permission `evaluations:view`   | `agentApiAgentInputSchema`          | `relatedAgentEntitiesSchema`     |
| `agents.cascadeArchive`     | mutation | Permission `evaluations:manage` | `agentApiAgentInputSchema`          | `agentCascadeArchiveSchema`      |
| `agents.delete`             | mutation | Permission `evaluations:manage` | `agentApiAgentInputSchema`          | `agentSchema`                    |
| `agents.getCopies`          | query    | Permission `evaluations:view`   | `agentApiAgentReferenceInputSchema` | inline                           |
| `agents.copy`               | mutation | Permission `evaluations:manage` | `agentApiCopyRequestSchema`         | `agentCopyCreatedSchema`         |
| `agents.pushToCopies`       | mutation | Permission `evaluations:manage` | `agentApiPushToCopiesInputSchema`   | `agentPushToCopiesSchema`        |
| `agents.syncFromSource`     | mutation | Permission `evaluations:manage` | `agentApiAgentReferenceInputSchema` | `agentSyncFromSourceSchema`      |
| `agents.getHistory`         | query    | Permission `evaluations:view`   | `agentApiAgentReferenceInputSchema` | inline                           |

### `httpProxy`

Contract `../contract/src/agent.trpc.ts:79`, router `src/transport/http-proxy.trpc.ts:5`.

| Procedure           | Kind     | Gate                            | Input                      | Output                  |
| ------------------- | -------- | ------------------------------- | -------------------------- | ----------------------- |
| `httpProxy.execute` | mutation | Permission `evaluations:manage` | `httpAgentTestInputSchema` | `httpProxyResultSchema` |

## Sockets

| Protocol  | Paths                    | Prefixes | Declared at                            |
| --------- | ------------------------ | -------- | -------------------------------------- |
| websocket | `/api/v1/agents/connect` | –        | `src/transport/agent-connect.ws.ts:23` |

## Workers

### Tasks

Run by the tasks process, before serve.

| Task                                         | Class                              | Declared at                                            |
| -------------------------------------------- | ---------------------------------- | ------------------------------------------------------ |
| `backfill-http-agent-credentials-to-secrets` | `AgentHttpCredentialsBackfillTask` | `src/tasks/agent-http-credentials-backfill.task.ts:16` |

## Configuration

| Kind   | Leaf                | Environment variable                   | Declared at                          |
| ------ | ------------------- | -------------------------------------- | ------------------------------------ |
| config | `replicaCount`      | `LANGWATCH_APP_REPLICAS`               | `../contract/src/agent.config.ts:6`  |
| config | `relayMaxPayloadMb` | `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB` | `../contract/src/agent.config.ts:7`  |
| config | `publicBaseUrl`     | `BASE_HOST`                            | `../contract/src/agent.config.ts:11` |

<!-- readme:generated:end -->
