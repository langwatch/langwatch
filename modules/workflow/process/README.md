# @langwatch/workflow-process

The server half of [workflow](../README.md). Workflows: definitions, graph versions and the Studio DSL, and executing a workflow's components.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("workflow").withRepositories(workflowRepositories).withChannels(workflowChannels).withApi(WorkflowModule).withTransports(…, workflowTrpcTransport, workflowOptimizationTrpcTransport, workflowRunRest, workflowStudioRest, workflowExecuteSyncRest).withEventing(workflowNlpLambdaCleanupEventing).withEventing(workflowLifecycleEventing).withEventing(workflowAgentArchiveCascadeEventing).withMigrations(…).withTransportFacts(…)`, `src/workflow.module.ts:30`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`WorkflowApi`)

Callable capability exposed by the composed Workflow application.

Peers call these through the token, declared at `../contract/src/workflow.api.ts:171`; nothing else in this package is public.

#### `executeComponent`

```typescript
executeComponent(input: ExecuteWorkflowComponentInput): Promise<ExecutionState>;
```

#### `list`

```typescript
list(input: { projectId: string }): Promise<Workflow[]>;
```

#### `findEvaluatorWorkflows`

Every evaluator workflow, archived or not, each carrying only its published version.

```typescript
findEvaluatorWorkflows(input: { projectId: string; }): Promise<(Workflow & { versions: WorkflowVersion[] })[]>;
```

#### `getById`

```typescript
getById(input: { id: string; projectId: string; includeVersion?: boolean; }): Promise<WorkflowWithVersion>;
```

#### `getWithMigratedDsl`

One workflow with its current version, the graph upgraded to the current DSL.

```typescript
getWithMigratedDsl(input: { workflowId: string; projectId: string; }): Promise<WorkflowWithVersion>;
```

#### `assertInProject`

```typescript
assertInProject(input: { workflowId: string; projectId: string }): Promise<void>;
```

#### `listSummaries`

```typescript
listSummaries(input: { projectId: string; workflowIds: string[]; }): Promise<{ id: string; name: string }[]>;
```

#### `archiveLinked`

```typescript
archiveLinked(input: WorkflowReference): Promise<{ id: string }>;
```

#### `deleteUncommitted`

```typescript
deleteUncommitted(input: WorkflowReference): Promise<void>;
```

#### `create`

```typescript
create(input: Omit<CreateWorkflowCommand, "authorId">, by: WorkflowCaller): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
```

#### `copyFromPermittedSource`

Copies a workflow once the caller may create workflows in its source project too.

```typescript
copyFromPermittedSource(input: Omit<CopyWorkflowCommand, "authorId">, by: WorkflowCaller): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }>;
```

#### `update`

```typescript
update(input: UpdateWorkflowCommand): Promise<Workflow>;
```

#### `getVersionHistory`

```typescript
getVersionHistory(input: { workflowId: string; projectId: string; mode: WorkflowVersionHistoryMode; }): Promise<WorkflowVersionHistoryEntry[]>;
```

#### `restoreVersion`

```typescript
restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion>;
```

#### `publish`

```typescript
publish(input: Omit<PublishWorkflowCommand, "actorId">, by: WorkflowCaller): Promise<Workflow>;
```

#### `unpublish`

```typescript
unpublish(input: { id: string; projectId: string }): Promise<Workflow>;
```

#### `archive`

```typescript
archive(input: ArchiveWorkflowCommand): Promise<Workflow>;
```

#### `run`

Runs a workflow synchronously, on the published version unless one is named.

```typescript
run(input: RunWorkflowCommand): Promise<WorkflowRunAnswer>;
```

#### `runSynchronous`

Runs one public synchronous REST door with its named refusals.

```typescript
runSynchronous(input: RunWorkflowCommand): Promise<WorkflowRunAnswer>;
```

#### `prepareStudioEvent`

```typescript
prepareStudioEvent(input: { event: StudioClientEvent; projectId: string; /** Who the run acts as; absent, the run gets an ownerless key bound to the project. */ principal?: WorkflowRunPrincipal | undefined; }): Promise<StudioClientEvent>;
```

#### `enrichStudioEvent`

A peer's inbound Studio event, prepared the same way before it re-enters the graph.

```typescript
enrichStudioEvent(input: { event: StudioClientEvent; projectId: string; principal?: WorkflowRunPrincipal | undefined; }): Promise<StudioClientEvent>;
```

#### `getFields`

The evaluator-fields shape a peer's guard and run read off this workflow.

```typescript
getFields(input: { workflowId: string; projectId: string }): Promise<WorkflowEvaluatorFields>;
```

#### `prepareStudioDsl`

```typescript
prepareStudioDsl(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow>;
```

#### `saveStudioVersion`

```typescript
saveStudioVersion(input: { projectId: string; workflowId: string; dsl: StudioWorkflow; autoSaved: boolean; commitMessage: string; setAsLatestVersion?: boolean; }, by: WorkflowCaller): Promise<WorkflowVersion>;
```

#### `copyStudioWorkflow`

```typescript
copyStudioWorkflow(input: CopyStudioWorkflowCommand): Promise<{ workflowId: string; dsl: StudioWorkflow }>;
```

#### `completeCode`

One Monaco completion for the editor, over whichever model answers it.

```typescript
completeCode(input: { projectId: string; body: WorkflowRestEnvelope; }): Promise<WorkflowCodeCompletionResponse>;
```

#### `streamStudioEvent`

The Studio editor's posted event, checked and prepared, answered as the engine's events. A `done` keeps the stream open one more second so a trailing frame still reaches the editor.

```typescript
streamStudioEvent(input: { body: string; /** Absent when no one is signed in, which is refused. */ userId: string | undefined; }): Promise<AsyncIterable<StudioServerEvent>>;
```

#### `postStudioEvent`

Opens one studio run and streams the engine's events back through `onEvent`.

```typescript
postStudioEvent(input: { projectId: string; event: StudioClientEvent; onEvent: (event: StudioServerEvent) => void; /** Asked before and during every read; absent means the run cannot be stopped. */ isAborted?: () => Promise<boolean>; /** Who started the run, as the engine attributes it; `workflow` when absent. */ origin?: WorkflowRunOrigin; }): Promise<void>;
```

#### `relayExecuteSync`

One scenario turn relayed to the project's own engine: its status and body verbatim, a 504 past the turn ceiling, a 408 once `signal` aborts. `projectId` is the caller's key's project.

```typescript
relayExecuteSync(input: { projectId: string; event: ExecuteSyncRelayEvent; signal: AbortSignal; }): Promise<Response>;
```

#### `hasPerProjectEngines`

True when this deployment names a per-project engine fleet, so a scenario turn must relay.

```typescript
hasPerProjectEngines(): boolean;
```

#### `reportStudioFailure`

Where an unexpected studio failure is reported. Best effort.

```typescript
reportStudioFailure(error: unknown, context: { projectId: string }): void;
```

#### `generateCommitMessage`

A short commit message for the change between two graphs.

```typescript
generateCommitMessage(input: { projectId: string; prevDsl: StudioWorkflow; newDsl: StudioWorkflow; }): Promise<string>;
```

#### `hasProjectPermission`

```typescript
hasProjectPermission(input: { userId: string; projectId: string; permission: AuthzPermission; }): Promise<boolean>;
```

#### `listWithCopyLineage`

The project's workflows, lineage redacted to what this caller may see.

```typescript
listWithCopyLineage(input: { projectId: string; viewerUserId: string; }): Promise<WorkflowListRow[]>;
```

#### `findWorkflowOwner`

```typescript
findWorkflowOwner(input: { workflowId: string; projectId: string; }): Promise<Readonly<{ projectId: string }> | null>;
```

#### `findCopiesWithPath`

```typescript
findCopiesWithPath(input: { workflowId: string; projectId: string; }): Promise<readonly WorkflowCopyWithPath[] | null>;
```

#### `findWorkflowWithSource`

```typescript
findWorkflowWithSource(input: { workflowId: string; projectId: string; }): Promise<WorkflowSourceRow | null>;
```

#### `findWorkflowWithCopies`

```typescript
findWorkflowWithCopies(input: { workflowId: string; projectId: string; }): Promise<WorkflowCopiesRow | null>;
```

#### `findLatestVersionNumber`

```typescript
findLatestVersionNumber(input: { workflowId: string; projectId: string; }): Promise<Readonly<{ version: string | null }> | null>;
```

#### `listPermittedCopies`

The copies of a workflow the caller may push to.

```typescript
listPermittedCopies(input: { workflowId: string; projectId: string }, by: WorkflowCaller): Promise<WorkflowCopyRow[]>;
```

#### `syncFromSource`

Pulls the source's latest graph into this copy as its next major version.

```typescript
syncFromSource(input: { workflowId: string; projectId: string }, by: WorkflowCaller): Promise<{ workflow: WorkflowSourceRow; version: WorkflowVersion }>;
```

#### `pushToCopies`

Pushes this workflow's latest graph to the copies the caller may update.

```typescript
pushToCopies(input: { workflowId: string; projectId: string; copyIds?: string[] }, by: WorkflowCaller): Promise<WorkflowPushToCopies>;
```

#### `getRelatedEntities`

What archiving this workflow would take with it.

```typescript
getRelatedEntities(input: { workflowId: string; projectId: string; }): Promise<WorkflowRelatedEntities>;
```

#### `cascadeArchive`

```typescript
cascadeArchive(input: { projectId: string; workflowId: string; unarchive?: boolean; }): Promise<WorkflowCascadeArchive>;
```

#### `runPublished`

```typescript
runPublished(input: { workflowId: string; projectId: string; body: Readonly<Record<string, unknown>>; principal?: WorkflowRunPrincipal | undefined; }): Promise<WorkflowRunAnswer>;
```

#### `findWorkflowFlags`

```typescript
findWorkflowFlags(input: { workflowId: string; projectId: string; }): Promise<WorkflowPublicationFlags | null>;
```

#### `getPublishedWorkflow`

```typescript
getPublishedWorkflow(input: { workflowId: string; projectId: string; }): Promise<PublishedWorkflowAnswer>;
```

#### `findWorkflowVersionById`

One stored version by id, as the process's own read carries it.

```typescript
findWorkflowVersionById(input: { versionId: string; projectId: string; }): Promise<Readonly<Record<string, unknown>> | null>;
```

#### `setWorkflowFlags`

```typescript
setWorkflowFlags(input: { workflowId: string; projectId: string; isComponent?: boolean; isEvaluator?: boolean; }): Promise<void>;
```

#### `listPublishedComponents`

```typescript
listPublishedComponents(input: { projectId: string }): Promise<unknown>;
```

#### `platformUrl`

The platform's own address for one workflow resource, from the project's slug and an already-resolved path. Built by the app itself since the REST declaration is static, with no request-scoped builder.

```typescript
platformUrl(input: { projectSlug: string; path: string }): string;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<WorkflowUsageCount>;
```

## REST transport

### `workflowExecuteSyncRest`

|             |                                                  |
| ----------- | ------------------------------------------------ |
| Declared at | `src/transport/workflow-execute-sync.rest.ts:13` |
| Base URL    | none: each route's path is its address           |
| Addressing  | literal                                          |
| Credential  | project                                          |

#### `POST /api/scenario/execute-sync` · `postApiScenarioExecuteSync`

Permission `scenarios:create`. Hidden from the OpenAPI document. Declared at `src/transport/workflow-execute-sync.rest.ts:19`.

Answers at `/api/scenario/execute-sync`.

```typescript
// Body: executeSyncRelayEventSchema, ../contract/src/workflow-rest.schemas.ts:124
type Body = Record<string, unknown>;
// Response: inline, src/transport/workflow-execute-sync.rest.ts:26
type Response = unknown;
```

### `workflowRunRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/workflow-run.rest.ts:47` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/optimization/:workflowId/:versionId` · `postApiOptimizationByWorkflowIdByVersionId`

Run a workflow version (legacy path)

Permission `workflows:manage`. Declared at `src/transport/workflow-run.rest.ts:53`.

Answers at `/api/optimization/:workflowId/:versionId`, `/api/v1/optimization/:workflowId/:versionId`.

```typescript
// Params: workflowRunRestVersionedParamsSchema, ../contract/src/workflow-rest.schemas.ts:76
interface Params {
  workflowId: string;
  versionId: string;
}
// Body: workflowRunRestBodySchema, ../contract/src/workflow-rest.schemas.ts:68
type Body = Record<string, unknown>;
// Response: workflowRunAnswerSchema, ../contract/src/workflow.ts:41
interface Response {
  result?: Record<string, unknown> | null;
  status: "idle" | "waiting" | "running" | "success" | "error" | "skipped";
}
```

#### `POST /api/workflows/:workflowId/run` · `postApiWorkflowsByWorkflowIdRun`

Run a workflow

Permission `workflows:manage`. Declared at `src/transport/workflow-run.rest.ts:82`.

Answers at `/api/workflows/:workflowId/run`, `/api/v1/workflows/:workflowId/run`.

```typescript
// Params: workflowRunRestParamsSchema, ../contract/src/workflow-rest.schemas.ts:73
interface Params {
  workflowId: string;
}
type Body = z.infer<typeof workflowRunRestBodySchema>; // ../contract/src/workflow-rest.schemas.ts:68
type Response = z.infer<typeof workflowRunAnswerSchema>; // ../contract/src/workflow.ts:41
```

#### `POST /api/workflows/:workflowId/:versionId/run` · `postApiWorkflowsByWorkflowIdByVersionIdRun`

Run a specific workflow version

Permission `workflows:manage`. Declared at `src/transport/workflow-run.rest.ts:109`.

Answers at `/api/workflows/:workflowId/:versionId/run`, `/api/v1/workflows/:workflowId/:versionId/run`.

```typescript
type Params = z.infer<typeof workflowRunRestVersionedParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:76
type Body = z.infer<typeof workflowRunRestBodySchema>; // ../contract/src/workflow-rest.schemas.ts:68
type Response = z.infer<typeof workflowRunAnswerSchema>; // ../contract/src/workflow.ts:41
```

### `workflowStudioRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/workflow-studio.rest.ts:25` |
| Base URL    | none: each route's path is its address     |
| Addressing  | literal                                    |
| Credential  | browser                                    |

#### `POST /api/workflows/code-completion` · `completeWorkflowCode`

Permission `workflows:manage`. Declared at `src/transport/workflow-studio.rest.ts:31`.

Answers at `/api/workflows/code-completion`.

```typescript
// Query: workflowCodeCompletionQuerySchema, ../contract/src/workflow-rest.schemas.ts:89
interface Query {
  projectId: string;
}
// Body: workflowCodeCompletionBodySchema, ../contract/src/workflow-rest.schemas.ts:90
type Body = Record<string, unknown>;
// Response: workflowCodeCompletionResponseSchema, ../contract/src/workflow-rest.schemas.ts:105
interface Response {
  completion: string | null;
  error?: string;
  raw?: unknown;
}
```

#### `POST /api/workflows/post_event` · `postWorkflowStudioEvent`

Optional credential: the event door answers an invalid body 400 before it asks who is calling, as main did; the project it asks workflows:manage at is inside that body, so the app asks it after the check. Declared at `src/transport/workflow-studio.rest.ts:42`.

Answers at `/api/workflows/post_event`.

```typescript
// Rawbody: "text" (inline, src/transport/workflow-studio.rest.ts:43)
// Response: inline, src/transport/workflow-studio.rest.ts:46
type Response = unknown;
```

### `createWorkflowRest`

|             |                                            |
| ----------- | ------------------------------------------ |
| Declared at | `src/transport/workflow.rest.ts:64`        |
| Base URL    | `/api/workflows`, twin `/api/v1/workflows` |
| Addressing  | dated                                      |
| Credential  | project                                    |
| Versions    | `2026-08-07`                               |

#### `GET /` · `getApiWorkflows`

List all non-archived workflows for the project

Permission `workflows:view`. Declared at `src/transport/workflow.rest.ts:69`.

Answers at `/api/workflows`, `/api/v1/workflows`; also, undocumented, `/api/workflows/2026-08-07`, `/api/v1/workflows/2026-08-07`, `/api/workflows/latest`, `/api/v1/workflows/latest`.

```typescript
// Response: inline, src/transport/workflow.rest.ts:71
type Response = {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isEvaluator: boolean;
  isComponent: boolean;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}[];
```

#### `GET /:id` · `getApiWorkflowsById`

Get a workflow by its ID

Permission `workflows:view`. Declared at `src/transport/workflow.rest.ts:84`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
// Params: workflowRestParamsSchema, ../contract/src/workflow-rest.schemas.ts:31
interface Params {
  id: string;
}
// Response: workflowRestDetailSchema, ../contract/src/workflow-rest.schemas.ts:25
interface Response {
  id: string;
  name: string;
  icon: string | null;
  description: string | null;
  isEvaluator: boolean;
  isComponent: boolean;
  createdAt: string;
  updatedAt: string;
  platformUrl: string;
}
```

#### `PATCH /:id` · `patchApiWorkflowsById`

Update a workflow's metadata (name, icon, description)

Permission `workflows:update`. Declared at `src/transport/workflow.rest.ts:102`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
type Params = z.infer<typeof workflowRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:31
// Body: workflowRestUpdateSchema, ../contract/src/workflow-rest.schemas.ts:34
interface Body {
  name?: string;
  icon?: string;
  description?: string;
}
type Response = z.infer<typeof workflowRestDetailSchema>; // ../contract/src/workflow-rest.schemas.ts:25
```

#### `DELETE /:id` · `deleteApiWorkflowsById`

Archive (soft-delete) a workflow

Permission `workflows:manage`. Declared at `src/transport/workflow.rest.ts:122`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
type Params = z.infer<typeof workflowRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:31
// Response: workflowRestArchivedSchema, ../contract/src/workflow-rest.schemas.ts:41
interface Response {
  id: string;
  archived: boolean;
}
```

## tRPC transport

### `optimization`

Contract `../contract/src/workflow-optimization.trpc.ts:22`, router `src/transport/workflow-optimization.trpc.ts:14`.

| Procedure                            | Kind     | Gate                          | Input                 | Output                            |
| ------------------------------------ | -------- | ----------------------------- | --------------------- | --------------------------------- |
| `optimization.chat`                  | mutation | Permission `workflows:manage` | inline                | `processAnswerSchema`             |
| `optimization.getPublishedWorkflow`  | query    | Permission `workflows:view`   | `workflowScopeSchema` | `processAnswerSchema`             |
| `optimization.disableAsComponent`    | mutation | Permission `workflows:update` | `workflowScopeSchema` | `workflowWriteAcknowledgedSchema` |
| `optimization.toggleSaveAsComponent` | mutation | Permission `workflows:update` | inline                | `workflowWriteAcknowledgedSchema` |
| `optimization.getComponents`         | query    | Permission `workflows:view`   | inline                | `processAnswerSchema`             |

```typescript
// optimization.chat
// Input: inline, ../contract/src/workflow-optimization.trpc.ts:25
interface Input {
  workflowId: string;
  projectId: string;
  inputMessages: Record<string, string>[];
}
// Output: processAnswerSchema, ../contract/src/workflow-optimization.trpc.ts:20
type Output = unknown;

// optimization.getPublishedWorkflow
// Input: workflowScopeSchema, ../contract/src/workflow-optimization.trpc.ts:13
interface Input {
  workflowId: string;
  projectId: string;
}
type Output = z.infer<typeof processAnswerSchema>; // ../contract/src/workflow-optimization.trpc.ts:20

// optimization.disableAsComponent
type Input = z.infer<typeof workflowScopeSchema>; // ../contract/src/workflow-optimization.trpc.ts:13
// Output: workflowWriteAcknowledgedSchema, ../contract/src/workflow.trpc-schemas.ts:145
interface Output {
  success: boolean;
}

// optimization.toggleSaveAsComponent
// Input: inline, ../contract/src/workflow-optimization.trpc.ts:38
interface Input {
  workflowId: string;
  projectId: string;
  isComponent: boolean;
  isEvaluator: boolean;
}
type Output = z.infer<typeof workflowWriteAcknowledgedSchema>; // ../contract/src/workflow.trpc-schemas.ts:145

// optimization.getComponents
// Input: inline, ../contract/src/workflow-optimization.trpc.ts:42
interface Input {
  projectId: string;
}
type Output = z.infer<typeof processAnswerSchema>; // ../contract/src/workflow-optimization.trpc.ts:20
```

### `workflow`

Contract `../contract/src/workflow.trpc.ts:47`, router `src/transport/workflow.trpc.ts:39`.

| Procedure                        | Kind     | Gate                            | Input                                         | Output                          |
| -------------------------------- | -------- | ------------------------------- | --------------------------------------------- | ------------------------------- |
| `workflow.engineMode`            | query    | Permission `workflows:view`     | `workflowApiEngineModeInputSchema`            | `workflowEngineModeSchema`      |
| `workflow.create`                | mutation | Permission `workflows:create`   | `workflowApiCreateInputSchema`                | `workflowWithNewVersionSchema`  |
| `workflow.copy`                  | mutation | Permission `workflows:create`   | `workflowApiCopyInputSchema`                  | `workflowWithNewVersionSchema`  |
| `workflow.getAll`                | query    | Permission `workflows:view`     | `workflowApiProjectInputSchema`               | inline                          |
| `workflow.getCopies`             | query    | Permission `workflows:view`     | `workflowApiWorkflowInputSchema`              | inline                          |
| `workflow.getById`               | query    | Permission `workflows:view`     | `workflowApiGetByIdInputSchema`               | `workflowWithVersionSchema`     |
| `workflow.getVersions`           | query    | Permission `workflows:view`     | `workflowApiGetVersionsInputSchema`           | inline                          |
| `workflow.restoreVersion`        | mutation | Permission `workflows:update`   | `workflowApiRestoreVersionInputSchema`        | `workflowVersionSchema`         |
| `workflow.autosave`              | mutation | Permission `workflows:update`   | `workflowApiAutosaveInputSchema`              | `workflowVersionSchema`         |
| `workflow.commitVersion`         | mutation | Permission `workflows:update`   | `workflowApiCommitVersionInputSchema`         | `workflowVersionSchema`         |
| `workflow.publish`               | mutation | Permission `workflows:update`   | `workflowApiPublishInputSchema`               | `workflowSchema`                |
| `workflow.unpublish`             | mutation | Permission `workflows:update`   | `workflowApiWorkflowInputSchema`              | `workflowSchema`                |
| `workflow.syncFromSource`        | mutation | Permission `workflows:update`   | `workflowApiWorkflowInputSchema`              | `syncedFromSourceSchema`        |
| `workflow.pushToCopies`          | mutation | Permission `workflows:update`   | `workflowApiPushToCopiesInputSchema`          | `workflowPushToCopiesSchema`    |
| `workflow.getRelatedEntities`    | query    | Permission `workflows:view`     | `workflowApiWorkflowInputSchema`              | `workflowRelatedEntitiesSchema` |
| `workflow.cascadeArchive`        | mutation | Permission `workflows:delete`   | `workflowApiArchiveInputSchema`               | `workflowCascadeArchiveSchema`  |
| `workflow.archive`               | mutation | Permission `workflows:delete`   | `workflowApiArchiveInputSchema`               | `workflowSchema`                |
| `workflow.generateCommitMessage` | mutation | Permission `workflows:update`   | `workflowApiGenerateCommitMessageInputSchema` | inline                          |
| `workflow.copyAgent`             | mutation | Permission `evaluations:manage` | `agentApiCopyRequestSchema`                   | `agentCopyCreatedSchema`        |

```typescript
// workflow.engineMode
// Input: workflowApiEngineModeInputSchema, ../contract/src/workflow.trpc-schemas.ts:30
interface Input {
  projectId: string;
}
// Output: workflowEngineModeSchema, ../contract/src/workflow.trpc-schemas.ts:193
interface Output {
  engineMode: "go";
  optimizeEnabled: false;
}

// workflow.create
type Input = z.infer<typeof workflowApiCreateInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:41
type Output = z.infer<typeof workflowWithNewVersionSchema>; // ../contract/src/workflow.trpc-schemas.ts:187

// workflow.copy
// Input: workflowApiCopyInputSchema, ../contract/src/workflow.trpc-schemas.ts:49
interface Input {
  workflowId: string;
  projectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
}
type Output = z.infer<typeof workflowWithNewVersionSchema>; // ../contract/src/workflow.trpc-schemas.ts:187

// workflow.getAll
// Input: workflowApiProjectInputSchema, ../contract/src/workflow.trpc-schemas.ts:19
interface Input {
  projectId: string;
}
// Output: workflowListRowSchema.array() (inline, ../contract/src/workflow.trpc.ts:66)

// workflow.getCopies
// Input: workflowApiWorkflowInputSchema, ../contract/src/workflow.trpc-schemas.ts:24
interface Input {
  projectId: string;
  workflowId: string;
}
// Output: inline, ../contract/src/workflow.trpc.ts:70
type Output = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  teamName: string;
  organizationName: string;
  fullPath: string;
  hasPermission: boolean;
}[];

// workflow.getById
// Input: workflowApiGetByIdInputSchema, ../contract/src/workflow.trpc-schemas.ts:33
interface Input {
  projectId: string;
  workflowId: string;
}
type Output = z.infer<typeof workflowWithVersionSchema>; // ../contract/src/workflow.ts:113

// workflow.getVersions
// Input: workflowApiGetVersionsInputSchema, ../contract/src/workflow.trpc-schemas.ts:35
interface Input {
  projectId: string;
  workflowId: string;
  returnDSL?: boolean | "previousVersion";
}
// Output: workflowVersionHistoryEntrySchema.array() (inline, ../contract/src/workflow.trpc.ts:78)

// workflow.restoreVersion
// Input: workflowApiRestoreVersionInputSchema, ../contract/src/workflow.trpc-schemas.ts:56
interface Input {
  projectId: string;
  versionId: string;
}
type Output = z.infer<typeof workflowVersionSchema>; // ../contract/src/workflow.ts:68

// workflow.autosave
type Input = z.infer<typeof workflowApiAutosaveInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:61
type Output = z.infer<typeof workflowVersionSchema>; // ../contract/src/workflow.ts:68

// workflow.commitVersion
type Input = z.infer<typeof workflowApiCommitVersionInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:68
type Output = z.infer<typeof workflowVersionSchema>; // ../contract/src/workflow.ts:68

// workflow.publish
// Input: workflowApiPublishInputSchema, ../contract/src/workflow.trpc-schemas.ts:75
interface Input {
  projectId: string;
  workflowId: string;
  versionId: string;
}
type Output = z.infer<typeof workflowSchema>; // ../contract/src/workflow.ts:48

// workflow.unpublish
type Input = z.infer<typeof workflowApiWorkflowInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:24
type Output = z.infer<typeof workflowSchema>; // ../contract/src/workflow.ts:48

// workflow.syncFromSource
type Input = z.infer<typeof workflowApiWorkflowInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:24
// Output: syncedFromSourceSchema, ../contract/src/workflow.trpc.ts:45
type Output = unknown;

// workflow.pushToCopies
// Input: workflowApiPushToCopiesInputSchema, ../contract/src/workflow.trpc-schemas.ts:81
interface Input {
  projectId: string;
  workflowId: string;
  copyIds?: string[];
}
type Output = z.infer<typeof workflowPushToCopiesSchema>; // ../contract/src/workflow.trpc-schemas.ts:199

// workflow.getRelatedEntities
type Input = z.infer<typeof workflowApiWorkflowInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:24
// Output: workflowRelatedEntitiesSchema, ../contract/src/workflow.trpc-schemas.ts:209
interface Output {
  agents: {
    id: string;
    name: string;
  }[];
}

// workflow.cascadeArchive
// Input: workflowApiArchiveInputSchema, ../contract/src/workflow.trpc-schemas.ts:88
interface Input {
  projectId: string;
  workflowId: string;
  unarchive?: boolean;
}
type Output = z.infer<typeof workflowCascadeArchiveSchema>; // ../contract/src/workflow.trpc-schemas.ts:214

// workflow.archive
type Input = z.infer<typeof workflowApiArchiveInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:88
type Output = z.infer<typeof workflowSchema>; // ../contract/src/workflow.ts:48

// workflow.generateCommitMessage
type Input = z.infer<typeof workflowApiGenerateCommitMessageInputSchema>; // ../contract/src/workflow.trpc-schemas.ts:94
// Output: inline, ../contract/src/workflow.trpc.ts:122
type Output = string;

// workflow.copyAgent
// Input: agentApiCopyRequestSchema, ../../agent/contract/src/agent.schemas.ts:37
interface Input {
  agentId: string;
  projectId: string;
  sourceProjectId: string;
  newAgentId?: string;
}
// Output: agentCopyCreatedSchema, ../../agent/contract/src/agent.queries.ts:145
interface Output {
  id: string;
  projectId: string;
  name: string;
  copiedFromAgentId: string;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `workflow_agent_archive_cascade` (aggregate `global`)

Declared at `src/eventing/workflow-agent-archive-cascade.pipeline.ts:29`.

| Kind            | Name                    | Handles                                                 | Declared at                                                  |
| --------------- | ----------------------- | ------------------------------------------------------- | ------------------------------------------------------------ |
| peer subscriber | `workflowAgentArchived` | `lw.agent.archived` from [agent](../../agent/README.md) | `src/eventing/workflow-agent-archive-cascade.pipeline.ts:36` |

### Pipeline `workflow_lifecycle` (aggregate `workflow`)

Declared at `src/eventing/workflow-lifecycle.pipeline.ts:37`. Events: `workflowCreatedEventSchema`, `workflowVersionSavedEventSchema`, `workflowArchivedEventSchema`.

| Kind    | Name                         | Handles | Declared at                                      |
| ------- | ---------------------------- | ------- | ------------------------------------------------ |
| command | `recordWorkflowCreated`      | –       | `src/eventing/workflow-lifecycle.pipeline.ts:46` |
| command | `recordWorkflowVersionSaved` | –       | `src/eventing/workflow-lifecycle.pipeline.ts:47` |
| command | `recordWorkflowArchived`     | –       | `src/eventing/workflow-lifecycle.pipeline.ts:48` |

### Pipeline `workflow_nlp_lambda_cleanup` (aggregate `global`)

Declared at `src/eventing/workflow-nlp-lambda-cleanup.pipeline.ts:31`.

| Kind            | Name                       | Handles                                                                                      | Declared at                                               |
| --------------- | -------------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------- |
| process manager | `workflowNlpLambdaCleanup` | every 1 d (`NLP_LAMBDA_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/workflow-nlp-lambda-cleanup.pipeline.ts:36` |

## Configuration

| Kind   | Leaf                         | Environment variable                      | Declared at                             |
| ------ | ---------------------------- | ----------------------------------------- | --------------------------------------- |
| secret | `nlpLambdaFleet`             | `LANGWATCH_NLP_LAMBDA_CONFIG`             | `src/app/workflow.app.ts:498`           |
| secret | `nlpInternal`                | `LANGWATCH_NLP_INTERNAL_SECRET`           | `src/app/workflow.app.ts:499`           |
| secret | `s3KeySalt`                  | `S3_KEY_SALT`                             | `src/app/workflow.app.ts:500`           |
| config | `nlpServiceUrl`              | `LANGWATCH_NLP_SERVICE`                   | `../contract/src/workflow.config.ts:79` |
| config | `stagingThresholdBytes`      | `LANGEVALS_STAGING_THRESHOLD_BYTES`       | `../contract/src/workflow.config.ts:81` |
| config | `stagingTtlSeconds`          | `LANGEVALS_STAGING_TTL_SECONDS`           | `../contract/src/workflow.config.ts:82` |
| config | `relayTurnCeilingMs`         | `NLP_FETCH_MAX_TIMEOUT_MS`                | `../contract/src/workflow.config.ts:84` |
| config | `publicBaseUrl`              | `BASE_HOST`                               | `../contract/src/workflow.config.ts:86` |
| config | `nlpCodeBlockTimeoutSeconds` | `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` | `../contract/src/workflow.config.ts:88` |

<!-- readme:generated:end -->
