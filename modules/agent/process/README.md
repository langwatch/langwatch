# @langwatch/agent-process

The server half of [agent](../README.md). Agents a project builds and runs: their workflow configurations, the connected agent instances that register and poll, and calls made to them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("agent").withRepositories(agentRepositories).withChannels(agentChannels).withApi(AgentModule).withTransports(…, …, …, agentLegacyRest, agentTrpcTransport).withEventing(agentLifecycleEventing).withEventing(agentWorkflowFieldsEventing).withMigrations(…).provideMiddlewareContext(…)`, `src/agent.module.ts:23`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AgentApi`)

Callable capability exposed by the composed Agent application.

Peers call these through the token, declared at `../contract/src/agent.api.ts:47`; nothing else in this package is public.

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

#### `listWithPresence`

```typescript
listWithPresence(input: { projectId: string; page: number; limit: number; viewerUserId?: string | null; }): Promise<AgentOverviewPage>;
```

#### `getCopiesForActor`

```typescript
getCopiesForActor(input: { agentId: string; projectId: string; actorId: string; }): Promise<AgentCopy[]>;
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

The latest agent, or the one a `label` or `version` names; `id` also takes the `id:label` and `id:3` shorthand. A label pointing nowhere is `agent_version_not_found`.

```typescript
getById(input: { id: string; projectId: string; viewerUserId?: string | null; } & AgentVersionSelector): Promise<AgentOverview>;
```

#### `list`

```typescript
list(input: { projectId: string; page: number; limit: number }): Promise<AgentPage>;
```

#### `create`

`caller` authors version 1 and is recorded as the creator.

```typescript
create(input: CreateAgentCommand & { caller?: AgentCaller }): Promise<AgentWithFields>;
```

#### `update`

Appends a version authored by `caller`; the row stays the latest.

```typescript
update(input: UpdateAgentCommand & { caller?: AgentCaller }): Promise<AgentWithFields>;
```

#### `archive`

A labelled agent needs `agents:deploy` of `caller`; a peer's cascade names no caller.

```typescript
archive(input: ArchiveAgentCommand & { caller?: AgentCaller }): Promise<Agent>;
```

#### `cascadeArchive`

```typescript
cascadeArchive(input: ArchiveAgentCommand & { caller?: AgentCaller }): Promise<{ agent: Agent; archivedWorkflow: { id: string } | null }>;
```

#### `listVersions`

Newest first, with their authors and labels; empty for a connected agent.

```typescript
listVersions(input: { projectId: string; agentId: string }): Promise<AgentVersions>;
```

#### `assignLabel`

Points a deploy label at a version, creating the label when it is new.

```typescript
assignLabel(input: AssignAgentLabelInput & { caller?: AgentCaller }): Promise<AgentLabel>;
```

#### `removeLabel`

```typescript
removeLabel(input: RemoveAgentLabelInput): Promise<void>;
```

#### `getCopies`

```typescript
getCopies(input: { sourceAgentId: string; allowedProjectIds?: string[] }): Promise<AgentCopy[]>;
```

#### `getSourceOfCopy`

```typescript
getSourceOfCopy(input: { agentId: string; projectId: string }): Promise<Agent>;
```

#### `createCopy`

Writes the copy's row; workflow's `copyAgent` door copied a workflow agent's graph first.

```typescript
createCopy(input: CopyAgentCommand): Promise<agentQueriesModule.AgentCopyCreated>;
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
| Declared at | `src/transport/agent-connect.rest.ts:110` |
| Base URL    | `/api/v1/agents`                          |
| Addressing  | v1-only                                   |
| Credential  | project                                   |

#### `POST /connect/register` · `registerConnectedAgentInstance`

Register this process's agents

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:117`.

Answers at `/api/v1/agents/connect/register`.

```typescript
type Body = z.infer<typeof agentConnectRegisterInputSchema>; // ../contract/src/connected-agent.connection.ts:72
// Response: inline, src/transport/agent-connect.rest.ts:123
type Response = unknown;
```

#### `GET /connect/poll` · `pollConnectedAgentInstance`

Wait for call and cancel frames while refreshing this instance's presence

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:149`.

Answers at `/api/v1/agents/connect/poll`.

```typescript
// Query: agentConnectPollQuerySchema, ../contract/src/connected-agent.connection.ts:93
interface Query {
  inFlight?: string;
}
// Response: inline, src/transport/agent-connect.rest.ts:153
type Response = unknown;
```

#### `POST /connect/frames` · `postConnectedAgentFrames`

Accept this instance's acknowledgements, results and deregistration

Permission `scenarios:manage`. Credential `project`. Declared at `src/transport/agent-connect.rest.ts:175`.

Answers at `/api/v1/agents/connect/frames`.

```typescript
type Body = z.infer<typeof agentConnectFramesInputSchema>; // ../contract/src/connected-agent.connection.ts:112
// Response: inline, src/transport/agent-connect.rest.ts:181
type Response = unknown;
```

### `agentLegacyRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/agent-legacy.rest.ts:58` |
| Base URL    | `/api/agents`                           |
| Addressing  | dated                                   |
| Credential  | project                                 |
| Versions    | `2026-08-07`                            |
| Deprecated  | yes                                     |

#### `GET /` · `listAgents`

List agents; superseded by /api/v1/agents

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:70`.

Answers at `/api/agents`; also, undocumented, `/api/agents/2026-08-07`, `/api/agents/latest`.

```typescript
// Query: agentRestQuerySchema, ../contract/src/agent-rest.schemas.ts:34
interface Query {
  page?: number;
  limit?: number;
}
type Response = z.infer<typeof legacyListResponse>; // src/transport/agent-legacy.rest.ts:35
```

#### `POST /` · `createAgent`

Create an agent; superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:85`.

Answers at `/api/agents`; also, undocumented, `/api/agents/2026-08-07`, `/api/agents/latest`.

```typescript
type Body = z.infer<typeof createAgentRequestSchema>; // ../contract/src/agent.commands.ts:88
// Response: legacyResponse, src/transport/agent-legacy.rest.ts:26
interface Response {
  id: string;
  name: string;
  type: "signature" | "code" | "workflow" | "http" | "connected" | "voice";
  config: Record<string, unknown> | null;
  createdAt: unknown;
  updatedAt: unknown;
  platformUrl: string;
}
```

#### `GET /:id` · `getAgent`

Get an agent; superseded by /api/v1/agents

Permission `project:view`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:100`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
// Params: agentRestParamsSchema, ../contract/src/agent-rest.schemas.ts:14
interface Params {
  id: string;
}
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:26
```

#### `PATCH /:id` · `updateAgent`

Update an agent; superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:110`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
// Body: updateAgentRequestSchema, ../contract/src/agent.commands.ts:139
interface Body {
  name?: string;
  type?: "signature" | "code" | "workflow" | "http" | "connected" | "voice";
  config?: Record<string, unknown>;
  workflowId?: string | null;
  commitMessage?: string;
}
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:26
```

#### `PUT /:id` · `replaceAgent`

Update an agent (PUT keeps partial semantics); superseded by /api/v1/agents

Permission `project:update`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:123`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:139
type Response = z.infer<typeof legacyResponse>; // src/transport/agent-legacy.rest.ts:26
```

#### `DELETE /:id` · `archiveAgent`

Archive an agent; superseded by /api/v1/agents

Permission `project:delete`. Hidden from the OpenAPI document. Declared at `src/transport/agent-legacy.rest.ts:139`.

Answers at `/api/agents/:id`; also, undocumented, `/api/agents/2026-08-07/:id`, `/api/agents/latest/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
// Response: archiveResultSchema, ../contract/src/agent-rest.schemas.ts:144
interface Response {
  id: string;
  name: string;
  type: "signature" | "code" | "workflow" | "http" | "connected" | "voice";
  archivedAt: unknown | null;
}
```

### `createAgentRest`

|             |                                   |
| ----------- | --------------------------------- |
| Declared at | `src/transport/agent.rest.ts:117` |
| Base URL    | `/api/v1/agents`                  |
| Addressing  | v1-only                           |
| Credential  | project                           |

#### `GET /` · `listAgents`

List agents with their current presence and owner

Permission `project:view`. Declared at `src/transport/agent.rest.ts:125`.

Answers at `/api/v1/agents`.

```typescript
type Query = z.infer<typeof agentRestQuerySchema>; // ../contract/src/agent-rest.schemas.ts:34
type Response = z.infer<typeof agentListResponseSchema>; // ../contract/src/agent-rest.schemas.ts:135
```

#### `POST /` · `createAgent`

Create an authored agent; connected agents register through the SDK

Permission `project:update`. Credential `project`. Declared at `src/transport/agent.rest.ts:144`.

Answers at `/api/v1/agents`.

```typescript
type Body = z.infer<typeof createAgentRequestSchema>; // ../contract/src/agent.commands.ts:88
// Response: agentResponseSchema, ../contract/src/agent-rest.schemas.ts:123
interface Response {
  id: string;
  name: string;
  type: "signature" | "code" | "workflow" | "http" | "connected" | "voice";
  config: Record<string, unknown> | null;
  createdAt: unknown;
  updatedAt: unknown;
  platformUrl: string;
}
```

#### `GET /:id` · `getAgent`

Get an agent in the caller's project

Permission `project:view`. Declared at `src/transport/agent.rest.ts:169`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Query = z.infer<typeof agentRestGetQuerySchema>; // ../contract/src/agent-rest.schemas.ts:27
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:123
```

#### `PATCH /:id` · `updateAgent`

Update an authored agent

Permission `project:update`. Credential `project`. Declared at `src/transport/agent.rest.ts:190`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:139
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:123
```

#### `PUT /:id` · `replaceAgent`

Update an authored agent; PUT retains partial update semantics

Permission `project:update`. Credential `project`. Declared at `src/transport/agent.rest.ts:211`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Body = z.infer<typeof updateAgentRequestSchema>; // ../contract/src/agent.commands.ts:139
type Response = z.infer<typeof agentResponseSchema>; // ../contract/src/agent-rest.schemas.ts:123
```

#### `DELETE /:id` · `archiveAgent`

Archive an agent while keeping its runs

Permission `project:delete`. Credential `project`. Declared at `src/transport/agent.rest.ts:232`.

Answers at `/api/v1/agents/:id`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Response = z.infer<typeof archiveResultSchema>; // ../contract/src/agent-rest.schemas.ts:144
```

#### `GET /:agentId/versions` · `listAgentVersions`

List an agent's versions, newest first, with the labels on each

Permission `project:view`. Declared at `src/transport/agent.rest.ts:250`.

Answers at `/api/v1/agents/:agentId/versions`.

```typescript
// Params: agentVersionsRestParamsSchema, ../contract/src/agent-version.ts:184
interface Params {
  agentId: string;
}
type Response = z.infer<typeof agentVersionListResponseSchema>; // ../contract/src/agent-rest.schemas.ts:155
```

#### `PUT /:agentId/labels/:label` · `assignAgentLabel`

Point a deploy label, such as production, at one of the agent's versions

Permission `agents:deploy`. Credential `project`. Declared at `src/transport/agent.rest.ts:266`.

Answers at `/api/v1/agents/:agentId/labels/:label`.

```typescript
// Params: agentLabelRestParamsSchema, ../contract/src/agent-version.ts:175
interface Params {
  agentId: string;
  label: string;
}
// Body: agentLabelRestBodySchema, ../contract/src/agent-version.ts:165
interface Body {
  version: number;
}
// Response: agentLabelResponseSchema, ../contract/src/agent-rest.schemas.ts:166
interface Response {
  label: string;
  version: number;
  versionId: string;
}
```

#### `DELETE /:agentId/labels/:label` · `removeAgentLabel`

Remove a deploy label from an agent

Permission `agents:deploy`. Declared at `src/transport/agent.rest.ts:289`.

Answers at `/api/v1/agents/:agentId/labels/:label`.

```typescript
type Params = z.infer<typeof agentLabelRestParamsSchema>; // ../contract/src/agent-version.ts:175
// Response: inline, src/transport/agent.rest.ts:299
interface Response {
  label: string;
  removed: true;
}
```

#### `POST /:id/call` · `callConnectedAgent`

Send one conversation turn to an online connected agent

Permission `scenarios:create`. Declared at `src/transport/agent.rest.ts:307`.

Answers at `/api/v1/agents/:id/call`.

```typescript
type Params = z.infer<typeof agentRestParamsSchema>; // ../contract/src/agent-rest.schemas.ts:14
type Body = z.infer<typeof relayCallBodySchema>; // ../contract/src/connected-agent.call.ts:59
type Response = z.infer<typeof relayCallResponseSchema>; // ../contract/src/connected-agent.call.ts:79
```

## tRPC transport

### `agents`

Contract `../contract/src/agent.trpc.ts:27`, router `src/transport/agent.trpc.ts:18`.

| Procedure               | Kind     | Gate                            | Input                               | Output                           |
| ----------------------- | -------- | ------------------------------- | ----------------------------------- | -------------------------------- |
| `agents.getAll`         | query    | Permission `evaluations:view`   | `agentApiProjectInputSchema`        | inline                           |
| `agents.getById`        | query    | Permission `evaluations:view`   | `agentApiAgentInputSchema`          | `agentWithLegacyCopyCountSchema` |
| `agents.create`         | mutation | Permission `evaluations:manage` | `createAgentCommandSchema`          | `agentWithFieldsSchema`          |
| `agents.update`         | mutation | Permission `evaluations:manage` | `updateAgentCommandSchema`          | `agentWithFieldsSchema`          |
| `agents.cascadeArchive` | mutation | Permission `evaluations:manage` | `agentApiAgentInputSchema`          | `agentCascadeArchiveSchema`      |
| `agents.delete`         | mutation | Permission `evaluations:manage` | `agentApiAgentInputSchema`          | `agentSchema`                    |
| `agents.getCopies`      | query    | Permission `evaluations:view`   | `agentApiAgentReferenceInputSchema` | inline                           |
| `agents.pushToCopies`   | mutation | Permission `evaluations:manage` | `agentApiPushToCopiesInputSchema`   | `agentPushToCopiesSchema`        |
| `agents.syncFromSource` | mutation | Permission `evaluations:manage` | `agentApiAgentReferenceInputSchema` | `agentSyncFromSourceSchema`      |
| `agents.getHistory`     | query    | Permission `evaluations:view`   | `agentApiAgentReferenceInputSchema` | inline                           |
| `agents.listVersions`   | query    | Permission `evaluations:view`   | `agentApiAgentReferenceInputSchema` | `agentVersionsSchema`            |
| `agents.assignLabel`    | mutation | Permission `agents:deploy`      | `assignAgentLabelInputSchema`       | `agentLabelSchema`               |
| `agents.removeLabel`    | mutation | Permission `agents:deploy`      | `removeAgentLabelInputSchema`       | inline                           |

```typescript
// agents.getAll
// Input: agentApiProjectInputSchema, ../contract/src/agent.schemas.ts:12
interface Input {
  projectId: string;
}
// Output: agentWithLegacyCopyCountSchema.array() (inline, ../contract/src/agent.trpc.ts:30)

// agents.getById
// Input: agentApiAgentInputSchema, ../contract/src/agent.schemas.ts:23
interface Input {
  id: string;
  projectId: string;
}
type Output = z.infer<typeof agentWithLegacyCopyCountSchema>; // ../contract/src/agent.queries.ts:190

// agents.create
type Input = z.infer<typeof createAgentCommandSchema>; // ../contract/src/agent.commands.ts:126
type Output = z.infer<typeof agentWithFieldsSchema>; // ../contract/src/agent.ts:124

// agents.update
// Input: updateAgentCommandSchema, ../contract/src/agent.commands.ts:150
interface Input {
  name?: string;
  type?: "signature" | "code" | "workflow" | "http" | "connected" | "voice";
  config?: Record<string, unknown>;
  workflowId?: string | null;
  commitMessage?: string;
  id: string;
  projectId: string;
}
type Output = z.infer<typeof agentWithFieldsSchema>; // ../contract/src/agent.ts:124

// agents.cascadeArchive
type Input = z.infer<typeof agentApiAgentInputSchema>; // ../contract/src/agent.schemas.ts:23
type Output = z.infer<typeof agentCascadeArchiveSchema>; // ../contract/src/agent.queries.ts:201

// agents.delete
type Input = z.infer<typeof agentApiAgentInputSchema>; // ../contract/src/agent.schemas.ts:23
type Output = z.infer<typeof agentSchema>; // ../contract/src/agent.ts:77

// agents.getCopies
// Input: agentApiAgentReferenceInputSchema, ../contract/src/agent.schemas.ts:38
interface Input {
  projectId: string;
  agentId: string;
}
// Output: inline, ../contract/src/agent.trpc.ts:54
type Output = {
  id: string;
  name: string;
  projectId: string;
  fullPath: string;
}[];

// agents.pushToCopies
// Input: agentApiPushToCopiesInputSchema, ../contract/src/agent.schemas.ts:61
interface Input {
  projectId: string;
  agentId: string;
  copyIds?: string[];
}
// Output: agentPushToCopiesSchema, ../contract/src/agent.queries.ts:219
interface Output {
  pushedTo: number;
  selectedCopies: number;
}

// agents.syncFromSource
type Input = z.infer<typeof agentApiAgentReferenceInputSchema>; // ../contract/src/agent.schemas.ts:38
// Output: agentSyncFromSourceSchema, ../contract/src/agent.queries.ts:227
interface Output {
  ok: true;
}

// agents.getHistory
type Input = z.infer<typeof agentApiAgentReferenceInputSchema>; // ../contract/src/agent.schemas.ts:38
// Output: inline, ../contract/src/agent.trpc.ts:66
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

// agents.listVersions
type Input = z.infer<typeof agentApiAgentReferenceInputSchema>; // ../contract/src/agent.schemas.ts:38
type Output = z.infer<typeof agentVersionsSchema>; // ../contract/src/agent-version.ts:108

// agents.assignLabel
// Input: assignAgentLabelInputSchema, ../contract/src/agent-version.ts:142
interface Input {
  projectId: string;
  agentId: string;
  label: string;
  version: number;
}
// Output: agentLabelSchema, ../contract/src/agent-version.ts:98
interface Output {
  label: string;
  versionId: string;
  version: number;
  updatedAt: unknown;
  updatedById: string | null;
}

// agents.removeLabel
// Input: removeAgentLabelInputSchema, ../contract/src/agent-version.ts:154
interface Input {
  projectId: string;
  agentId: string;
  label: string;
}
// Output: inline, ../contract/src/agent.trpc.ts:78
type Output = unknown;
```

## Sockets

| Protocol  | Paths                    | Prefixes | Declared at                            |
| --------- | ------------------------ | -------- | -------------------------------------- |
| websocket | `/api/v1/agents/connect` | –        | `src/transport/agent-connect.ws.ts:24` |

## Workers

### Pipeline `agent_lifecycle` (aggregate `agent`)

Declared at `src/eventing/agent-lifecycle.pipeline.ts:29`. Events: `agentArchivedEventSchema`.

| Kind    | Name                  | Handles | Declared at                                   |
| ------- | --------------------- | ------- | --------------------------------------------- |
| command | `recordAgentArchived` | –       | `src/eventing/agent-lifecycle.pipeline.ts:34` |

### Pipeline `agent_workflow_fields` (aggregate `global`)

Declared at `src/eventing/agent-workflow-fields.pipeline.ts:43`.

| Kind            | Name                   | Handles                                                               | Declared at                                         |
| --------------- | ---------------------- | --------------------------------------------------------------------- | --------------------------------------------------- |
| peer subscriber | `workflowVersionSaved` | `lw.workflow.version_saved` from [workflow](../../workflow/README.md) | `src/eventing/agent-workflow-fields.pipeline.ts:49` |
| peer subscriber | `workflowArchived`     | `lw.workflow.archived` from [workflow](../../workflow/README.md)      | `src/eventing/agent-workflow-fields.pipeline.ts:62` |

## Configuration

| Kind   | Leaf                | Environment variable                   | Declared at                          |
| ------ | ------------------- | -------------------------------------- | ------------------------------------ |
| config | `replicaCount`      | `LANGWATCH_APP_REPLICAS`               | `../contract/src/agent.config.ts:10` |
| config | `relayMaxPayloadMb` | `LANGWATCH_AGENT_RELAY_MAX_PAYLOAD_MB` | `../contract/src/agent.config.ts:14` |
| config | `publicBaseUrl`     | `BASE_HOST`                            | `../contract/src/agent.config.ts:18` |

<!-- readme:generated:end -->
