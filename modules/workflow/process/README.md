# @langwatch/workflow-process

The server half of [workflow](../README.md). Workflows: definitions, graph versions and the Studio DSL, and executing a workflow's components.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("workflow").withRepositories(workflowRepositories).withApi(WorkflowModule).withTransports(…, workflowTrpcTransport, workflowOptimizationTrpcTransport, workflowRunRest, workflowStudioRest, workflowExecuteSyncRest).withEventing(workflowNlpLambdaCleanupEventing).withEventing(workflowLifecycleEventing).withEventing(workflowAgentArchiveCascadeEventing).withTasks(…).withMigrations(…).withTransportFacts(…)`, `src/workflow.module.ts:24`.

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
type Body = z.infer<typeof executeSyncRelayEventSchema>; // ../contract/src/workflow-rest.schemas.ts:124
// Response: "forwarded" (inline, src/transport/workflow-execute-sync.rest.ts:26)
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
type Params = z.infer<typeof workflowRunRestVersionedParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:76
type Body = z.infer<typeof workflowRunRestBodySchema>; // ../contract/src/workflow-rest.schemas.ts:68
type Response = z.infer<typeof workflowRunAnswerSchema>; // ../contract/src/workflow.ts:41
```

#### `POST /api/workflows/:workflowId/run` · `postApiWorkflowsByWorkflowIdRun`

Run a workflow

Permission `workflows:manage`. Declared at `src/transport/workflow-run.rest.ts:82`.

Answers at `/api/workflows/:workflowId/run`, `/api/v1/workflows/:workflowId/run`.

```typescript
type Params = z.infer<typeof workflowRunRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:73
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
type Query = z.infer<typeof workflowCodeCompletionQuerySchema>; // ../contract/src/workflow-rest.schemas.ts:89
type Body = z.infer<typeof workflowCodeCompletionBodySchema>; // ../contract/src/workflow-rest.schemas.ts:90
type Response = z.infer<typeof workflowCodeCompletionResponseSchema>; // ../contract/src/workflow-rest.schemas.ts:105
```

#### `POST /api/workflows/post_event` · `postWorkflowStudioEvent`

Optional credential: the event door answers an invalid body 400 before it asks who is calling, as main did; the project it asks workflows:manage at is inside that body, so the app asks it after the check. Declared at `src/transport/workflow-studio.rest.ts:42`.

Answers at `/api/workflows/post_event`.

```typescript
// Rawbody: "text" (inline, src/transport/workflow-studio.rest.ts:43)
// Response: "sse" (inline, src/transport/workflow-studio.rest.ts:46)
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
// Response: z.array(workflowRestDetailSchema) (inline, src/transport/workflow.rest.ts:71)
```

#### `GET /:id` · `getApiWorkflowsById`

Get a workflow by its ID

Permission `workflows:view`. Declared at `src/transport/workflow.rest.ts:84`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
type Params = z.infer<typeof workflowRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:31
type Response = z.infer<typeof workflowRestDetailSchema>; // ../contract/src/workflow-rest.schemas.ts:25
```

#### `PATCH /:id` · `patchApiWorkflowsById`

Update a workflow's metadata (name, icon, description)

Permission `workflows:update`. Declared at `src/transport/workflow.rest.ts:102`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
type Params = z.infer<typeof workflowRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:31
type Body = z.infer<typeof workflowRestUpdateSchema>; // ../contract/src/workflow-rest.schemas.ts:34
type Response = z.infer<typeof workflowRestDetailSchema>; // ../contract/src/workflow-rest.schemas.ts:25
```

#### `DELETE /:id` · `deleteApiWorkflowsById`

Archive (soft-delete) a workflow

Permission `workflows:manage`. Declared at `src/transport/workflow.rest.ts:122`.

Answers at `/api/workflows/:id`, `/api/v1/workflows/:id`; also, undocumented, `/api/workflows/2026-08-07/:id`, `/api/v1/workflows/2026-08-07/:id`, `/api/workflows/latest/:id`, `/api/v1/workflows/latest/:id`.

```typescript
type Params = z.infer<typeof workflowRestParamsSchema>; // ../contract/src/workflow-rest.schemas.ts:31
type Response = z.infer<typeof workflowRestArchivedSchema>; // ../contract/src/workflow-rest.schemas.ts:41
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

### Tasks

Run by the tasks process, before serve.

| Task                                   | Class                                 | Declared at                                               |
| -------------------------------------- | ------------------------------------- | --------------------------------------------------------- |
| `backfill-http-credentials-to-secrets` | `WorkflowHttpCredentialsBackfillTask` | `src/tasks/workflow-http-credentials-backfill.task.ts:27` |

## Configuration

| Kind   | Leaf                         | Environment variable                      | Declared at                             |
| ------ | ---------------------------- | ----------------------------------------- | --------------------------------------- |
| secret | `nlpLambdaFleet`             | `LANGWATCH_NLP_LAMBDA_CONFIG`             | `src/app/workflow.app.ts:601`           |
| secret | `nlpInternal`                | `LANGWATCH_NLP_INTERNAL_SECRET`           | `src/app/workflow.app.ts:602`           |
| config | `nlpServiceUrl`              | `LANGWATCH_NLP_SERVICE`                   | `../contract/src/workflow.config.ts:79` |
| config | `stagingThresholdBytes`      | `LANGEVALS_STAGING_THRESHOLD_BYTES`       | `../contract/src/workflow.config.ts:81` |
| config | `stagingTtlSeconds`          | `LANGEVALS_STAGING_TTL_SECONDS`           | `../contract/src/workflow.config.ts:82` |
| config | `relayTurnCeilingMs`         | `NLP_FETCH_MAX_TIMEOUT_MS`                | `../contract/src/workflow.config.ts:84` |
| config | `publicBaseUrl`              | `BASE_HOST`                               | `../contract/src/workflow.config.ts:86` |
| config | `nlpCodeBlockTimeoutSeconds` | `NLPGO_ENGINE_CODE_BLOCK_TIMEOUT_SECONDS` | `../contract/src/workflow.config.ts:88` |

<!-- readme:generated:end -->
