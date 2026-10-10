# @langwatch/project-process

The server half of [project](../README.md). Projects: finding them, their summaries and paths, and the departments they are assigned to.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("project").withRepositories(projectRepositories).withApi(ProjectModule).withTransports(projectRest, projectTrpcTransport).provideMiddlewareContext(…).withEventing(projectLifecycleEventing).withMigrations(…).withTasks(…)`, `src/project.module.ts:17`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ProjectApi`)

Peers call these through the token, declared at `../contract/src/project.api.ts:94`; nothing else in this package is public.

#### `listPaths`

```typescript
listPaths(input: { projectIds: string[] }): Promise<ProjectPath[]>;
```

#### `findProjectsWithDepartments`

Every non-governance project with its department, less `hiddenKinds` (main `department.service.ts:126-133`; callers pass `projectKindsHiddenFrom(role)`).

```typescript
findProjectsWithDepartments(input: { organizationId: string; hiddenKinds: readonly string[]; }): Promise<{ id: string; name: string; departmentId: string | null }[]>;
```

#### `assignProjectDepartment`

Points one project at a department, or clears it; false when no such project (main `department.service.ts:334-352`).

```typescript
assignProjectDepartment(input: { organizationId: string; projectId: string; departmentId: string | null; }): Promise<boolean>;
```

#### `findOrganizationId`

```typescript
findOrganizationId(projectId: string): Promise<string | undefined>;
```

#### `isPresenceEnabled`

```typescript
isPresenceEnabled(input: { projectId: string }): Promise<boolean>;
```

#### `findSummaryById`

```typescript
findSummaryById(projectId: string): Promise<{ name: string; slug: string } | null>;
```

#### `searchByQuery`

```typescript
searchByQuery(input: { query: string; organizationId?: string; limit?: number; }): Promise<SearchProjectsResult[]>;
```

#### `findById`

```typescript
findById(id: string): Promise<Project | null>;
```

#### `getOrganizationId`

```typescript
getOrganizationId(projectId: string): Promise<string>;
```

#### `getWithTeam`

```typescript
getWithTeam(id: string): Promise<ProjectWithTeam>;
```

#### `findWithTeam`

```typescript
findWithTeam(id: string): Promise<ProjectWithTeam | null>;
```

#### `listByOrganization`

```typescript
listByOrganization(input: { organizationId: string; page: number; limit: number; projectIds?: string[]; /** The organization's hidden governance project is left out unless this is true. */ includeGovernance?: boolean; /** Kinds left out as well, e.g. `projectKindsHiddenFrom(role)` for a non-admin caller. */ hiddenKinds?: ProjectKind[]; }): Promise<PaginatedProjects>;
```

#### `listByTeam`

```typescript
listByTeam(input: { organizationId: string; teamId: string; /** The organization's hidden governance project is left out unless this is true. */ includeGovernance?: boolean; }): Promise<Project[]>;
```

#### `listNamesByIds`

```typescript
listNamesByIds(input: ProjectNamesByIdsInput): Promise<ProjectIdentity[]>;
```

#### `listIdsByOrganization`

```typescript
listIdsByOrganization(input: ProjectIdsByOrganizationInput): Promise<string[]>;
```

#### `findLiveNonGovernanceIdsByOrganization`

Unarchived, non-governance project ids, unpaged: main's `findAllByOrganization` filter.

```typescript
findLiveNonGovernanceIdsByOrganization(input: LiveProjectIdsByOrganizationInput): Promise<string[]>;
```

#### `findLiveBySlug`

Main's CLI project-key read (auth-cli.ts:2092): a live project by slug, in one org.

```typescript
findLiveBySlug(input: Readonly<{ slug: string; organizationId: string }>): Promise<Project[]>;
```

#### `findLiveByRef`

Main's `findProjectInOrg` (auth-cli.ts:2533): a live project by id, else slug, in one org.

```typescript
findLiveByRef(input: Readonly<{ projectRef: string; organizationId: string }>): Promise<Project[]>;
```

#### `create`

```typescript
create(input: Readonly<{ organizationId: string; teamId?: string | undefined; newTeamName?: string | undefined; name: string; language: string; framework: string; /** ADR-177: `"aggregate"` reads its members through grants; organisation admins only. */ kind?: "application" | "aggregate" | undefined; /** Only read for an aggregate; defaults to `AGGREGATE_DEFAULT_RULE`. */ aggregateRule?: AggregateRule | undefined; }>, by: Readonly<{ id: string }>): Promise<Project>;
```

#### `createInOrganization`

Provisions a project for a management credential, which may be a service key acting as nobody: the actor is nullable here, unlike `create`'s.

```typescript
createInOrganization(input: Readonly<{ organizationId: string; userId: string | null; teamId?: string | undefined; newTeamName?: string | undefined; name: string; language: string; framework: string; }>): Promise<Project>;
```

#### `updateSettings`

Stored-object credentials (`s3Endpoint`, `s3AccessKeyId`, `s3SecretAccessKey`) arrive as plaintext and are sealed on write; reads answer them as stored.

```typescript
updateSettings(input: Readonly<UpdateProjectInput & { projectId: string }>, by: Readonly<{ id: string }>): Promise<Project>;
```

#### `setTraceSharing`

Switches trace sharing; switching it off records the fact share revokes links from.

```typescript
setTraceSharing(input: SetTraceSharingInput): Promise<void>;
```

#### `archive`

```typescript
archive(input: Readonly<{ projectId: string }>): Promise<{ alreadyArchived: boolean }>;
```

#### `findIdByLegacyApiKey`

The live project a legacy `apiKey` column names, or nothing.

```typescript
findIdByLegacyApiKey(input: Readonly<{ token: string }>): Promise<string | null>;
```

#### `findTraceSharingConfig`

Whether the organisation and the project both still allow trace sharing. Nothing when the project is not there to read the two switches from.

```typescript
findTraceSharingConfig(input: Readonly<{ projectId: string }>): Promise<TraceSharingConfig | null>;
```

#### `findPersonalWorkspaceOwner`

Whose personal workspace a scope is: the team's own owner, or the owner of the team a personal project hangs from. Nothing when the scope is shared.

```typescript
findPersonalWorkspaceOwner(input: Readonly<{ organizationId: string; scopeId: string }>): Promise<{ ownerUserId: string | null } | null>;
```

#### `touchCodingAgentPullRequestSeen`

```typescript
touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void>;
```

#### `touchCodingAgentSessionSeen`

Stamps a project as having just seen coding-agent session activity.

```typescript
touchCodingAgentSessionSeen(input: { projectId: string; at: Instant }): Promise<void>;
```

#### `findInternal`

The organisation's internal governance project, or nothing when it has none.

```typescript
findInternal(input: InternalProjectQuery): Promise<InternalProject | null>;
```

#### `ensureInternal`

The organisation's internal governance project, created on first ask.

```typescript
ensureInternal(input: InternalProjectQuery): Promise<InternalProject>;
```

#### `findInternalIds`

Every live internal project of this kind, across organisations: its id only.

```typescript
findInternalIds(input: { kind: InternalProjectKind }): Promise<string[]>;
```

#### `findIdentity`

Reads only who the project is — five indexed columns, no team row, because this runs once per authenticated request. Absent when missing.

```typescript
findIdentity(id: string): Promise<ProjectIdentity | null>;
```

#### `listActiveByScopes`

Lists active projects reached by the supplied organisation/team/project scopes.

```typescript
listActiveByScopes(input: ActiveProjectsByScopesInput): Promise<ActiveProjectsByScopes>;
```

#### `updateMetadata`

```typescript
updateMetadata(input: UpdateProjectMetadataInput): Promise<void>;
```

#### `resolveOrgAdmin`

The organisation and its first admin, as an ingested trace resolves them.

```typescript
resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
```

#### `resolveTraceDestination`

Where a Gateway call's traces land, given the key's own project.

```typescript
resolveTraceDestination(input: TraceDestinationInput): Promise<TraceDestinationDecision>;
```

#### `findTraceDestination`

Follows a stored Gateway trace-destination pointer, including archived projects.

```typescript
findTraceDestination(projectId: string): Promise<TraceDestinationProject | null>;
```

#### `listTraceDestinations`

Batch counterpart for Gateway listings; unknown ids are omitted.

```typescript
listTraceDestinations(projectIds: string[]): Promise<TraceDestinationProject[]>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { organizationIds: readonly string[]; since?: number; }): Promise<ProjectUsageCount>;
```

#### `countWithTraces`

Live application projects that have received a trace; internal projects excluded.

```typescript
countWithTraces(input: { organizationId: string }): Promise<number>;
```

#### `findSharedProjectSlugs`

Live shared-team projects, oldest first; with a member, only theirs (main `resolveHome`).

```typescript
findSharedProjectSlugs(input: { organizationId: string; memberUserId?: string; limit: number; }): Promise<string[]>;
```

#### `listAllIds`

Project ids on this install ordered by id, archived included, a page at a time for fleet-wide scans. No limit reads them all; `next` is null on the last page.

```typescript
listAllIds(input?: ProjectIdPageInput): Promise<ProjectIdPage>;
```

#### `listAllWithOrganization`

Every project with its organisation, paged like `listAllIds`, for the storage migration inventory (main `migrateObjectStorage.ts` `listProjectsPage`).

```typescript
listAllWithOrganization(input?: ProjectIdPageInput): Promise<ProjectOrganizationPage>;
```

#### `listAllWithPrivateS3`

Every project with whether it names its own S3 bucket, paged like `listAllIds`, for the object-storage migration inventory: a global provider move leaves those projects out.

```typescript
listAllWithPrivateS3(input?: ProjectIdPageInput): Promise<ProjectPrivateS3Page>;
```

#### `listLwqlKeys`

Every project with its LangWatchQL key, paged like `listAllIds`, for the key-map backfill.

```typescript
listLwqlKeys(input?: ProjectIdPageInput): Promise<ProjectLwqlKeyPage>;
```

#### `findAggregate`

ADR-177: the aggregate with this id, or nothing when no aggregate project has it.

```typescript
findAggregate(input: { aggregateProjectId: string }): Promise<StoredAggregateProject[]>;
```

#### `findLiveAggregateIds`

ADR-177: the organisation's live aggregates, ordered by id.

```typescript
findLiveAggregateIds(input: { organizationId: string }): Promise<string[]>;
```

#### `findAllLiveAggregates`

ADR-177: every live aggregate in every organisation, ordered by id, for the sweep.

```typescript
findAllLiveAggregates(): Promise<LiveAggregate[]>;
```

#### `findPersonalProjectIds`

ADR-177: live personal projects an aggregate may read, ordered by id; with `ownerUserIds`, only theirs (governance resolves a department to its members).

```typescript
findPersonalProjectIds(input: { organizationId: string; ownerUserIds?: readonly string[]; }): Promise<string[]>;
```

#### `findReadableProjectIds`

ADR-177: of `projectIds`, the live ones of this organisation an aggregate may read.

```typescript
findReadableProjectIds(input: { organizationId: string; projectIds: readonly string[]; }): Promise<string[]>;
```

#### `findCandidateMembers`

ADR-177: every project an explicit rule may name, with its owner, ordered by name.

```typescript
findCandidateMembers(input: { organizationId: string }): Promise<AggregateMemberCandidate[]>;
```

## REST transport

### `projectRest`

|             |                                     |
| ----------- | ----------------------------------- |
| Declared at | `src/transport/project.rest.ts:109` |
| Base URL    | `/api/projects`                     |
| Addressing  | dated                               |
| Credential  | organization                        |
| Versions    | `2026-08-07`                        |

#### `GET /:id` · `getProject`

Get a project

Permission `project:view`. Declared at `src/transport/project.rest.ts:116`.

Answers at `/api/projects/:id`; also, undocumented, `/api/projects/2026-08-07/:id`, `/api/projects/latest/:id`.

```typescript
// Params: projectRestParamsSchema, ../contract/src/project.ts:303
interface Params {
  id: string;
}
// Response: projectRestDetailSchema, ../contract/src/project.responses.ts:71
interface Response {
  id: string;
  name: string;
  slug: string;
  language: string;
  framework: string;
  teamId: string;
  createdAt: unknown;
  updatedAt: unknown;
  piiRedactionLevel: "STRICT" | "ESSENTIAL" | "DISABLED";
}
```

#### `PATCH /:id` · `updateProject`

Update a project

Permission `project:update`. Declared at `src/transport/project.rest.ts:140`.

Answers at `/api/projects/:id`; also, undocumented, `/api/projects/2026-08-07/:id`, `/api/projects/latest/:id`.

```typescript
type Params = z.infer<typeof projectRestParamsSchema>; // ../contract/src/project.ts:303
// Body: projectRestUpdateSchema, ../contract/src/project.ts:293
interface Body {
  name?: string;
  language?: string;
  framework?: string;
  teamId?: string;
  piiRedactionLevel?: "STRICT" | "ESSENTIAL" | "DISABLED";
}
type Response = z.infer<typeof projectRestDetailSchema>; // ../contract/src/project.responses.ts:71
```

#### `DELETE /:id` · `archiveProject`

Archive a project

Permission `project:delete`. Declared at `src/transport/project.rest.ts:168`.

Answers at `/api/projects/:id`; also, undocumented, `/api/projects/2026-08-07/:id`, `/api/projects/latest/:id`.

```typescript
type Params = z.infer<typeof projectRestParamsSchema>; // ../contract/src/project.ts:303
// Response: projectRestArchivedSchema, ../contract/src/project.responses.ts:77
interface Response {
  id: string;
  name: string;
  archivedAt: unknown;
}
```

#### `GET /:id/api-key` · `getProjectApiKey`

Get the project API key

Authenticated: the base key is never handed to an API token, so there is no permission that would grant this and the refusal is the answer for every authenticated caller. Declared at `src/transport/project.rest.ts:193`.

Answers at `/api/projects/:id/api-key`; also, undocumented, `/api/projects/2026-08-07/:id/api-key`, `/api/projects/latest/:id/api-key`.

```typescript
type Params = z.infer<typeof projectRestParamsSchema>; // ../contract/src/project.ts:303
// Response: projectApiKeyRotationSchema, ../contract/src/project.responses.ts:35
interface Response {
  apiKey: string;
}
```

#### `POST /:id/regenerate-api-key` · `regenerateProjectApiKey`

Regenerate the project API key

Authenticated: the base key is never handed to an API token, so there is no permission that would grant this and the refusal is the answer for every authenticated caller. Declared at `src/transport/project.rest.ts:212`.

Answers at `/api/projects/:id/regenerate-api-key`; also, undocumented, `/api/projects/2026-08-07/:id/regenerate-api-key`, `/api/projects/latest/:id/regenerate-api-key`.

```typescript
type Params = z.infer<typeof projectRestParamsSchema>; // ../contract/src/project.ts:303
// Body: projectRestRegenerateApiKeyInputSchema, ../contract/src/project.ts:306
type Body = Record<string, unknown>;
type Response = z.infer<typeof projectApiKeyRotationSchema>; // ../contract/src/project.responses.ts:35
```

## tRPC transport

### `project`

Contract `../contract/src/project.trpc.ts:28`, router `src/transport/project.trpc.ts:80`.

| Procedure                           | Kind     | Gate                                                                                                                                                                                                                                                                | Input                                         | Output                                   |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- | ---------------------------------------- |
| `project.create`                    | mutation | Service-authorized: project:create, organization:manage; creating INTO a team asks that team for project:create; creating a team alongside asks the organization for organization:manage, and which of the two was asked for is only known once the input is parsed | `projectCreateInputSchema`                    | `projectProvisionedSchema`               |
| `project.getHasFirstMessage`        | query    | Permission `project:view`                                                                                                                                                                                                                                           | `projectScopeSchema`                          | `projectFirstMessageSchema`              |
| `project.getLegacyKeyStatus`        | query    | Permission `project:manage`                                                                                                                                                                                                                                         | `projectScopeSchema`                          | `projectLegacyKeyStatusSchema`           |
| `project.revokeProjectApiKey`       | mutation | Permission `project:manage`                                                                                                                                                                                                                                         | `projectScopeSchema`                          | `projectApiKeyRevokedSchema`             |
| `project.update`                    | mutation | Permission `project:update`                                                                                                                                                                                                                                         | `projectUpdateInputSchema`                    | `projectSettingsSavedSchema`             |
| `project.archiveById`               | mutation | Permission `project:delete`                                                                                                                                                                                                                                         | `projectArchiveByIdInputSchema`               | `projectArchivedSchema`                  |
| `project.updateAggregateRule`       | mutation | Permission `organization:manage`                                                                                                                                                                                                                                    | `projectUpdateAggregateRuleInputSchema`       | `projectAggregateRuleUpdatedSchema`      |
| `project.aggregateMemberCandidates` | query    | Permission `organization:manage`                                                                                                                                                                                                                                    | `projectAggregateMemberCandidatesInputSchema` | `projectAggregateMemberCandidatesSchema` |

```typescript
// project.create
type Input = z.infer<typeof projectCreateInputSchema>; // ../contract/src/project-trpc.schemas.ts:20
// Output: projectProvisionedSchema, ../contract/src/project.responses.ts:19
interface Output {
  success: true;
  projectSlug: string;
}

// project.getHasFirstMessage
// Input: projectScopeSchema, ../contract/src/project-trpc.schemas.ts:12
interface Input {
  projectId: string;
}
// Output: projectFirstMessageSchema, ../contract/src/project.responses.ts:31
interface Output {
  firstMessage: boolean;
}

// project.getLegacyKeyStatus
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/project-trpc.schemas.ts:12
// Output: projectLegacyKeyStatusSchema, ../contract/src/project.responses.ts:39
interface Output {
  present: boolean;
}

// project.revokeProjectApiKey
type Input = z.infer<typeof projectScopeSchema>; // ../contract/src/project-trpc.schemas.ts:12
// Output: projectApiKeyRevokedSchema, ../contract/src/project.responses.ts:43
interface Output {
  revoked: true;
}

// project.update
type Input = z.infer<typeof projectUpdateInputSchema>; // ../contract/src/project-trpc.schemas.ts:37
// Output: projectSettingsSavedSchema, ../contract/src/project.responses.ts:25
interface Output {
  success: boolean;
  projectSlug: string;
}

// project.archiveById
// Input: projectArchiveByIdInputSchema, ../contract/src/project-trpc.schemas.ts:64
interface Input {
  projectId: string;
  projectToArchiveId: string;
}
// Output: projectArchivedSchema, ../contract/src/project.responses.ts:47
interface Output {
  success: true;
  alreadyArchived: boolean;
}

// project.updateAggregateRule
type Input = z.infer<typeof projectUpdateAggregateRuleInputSchema>; // ../contract/src/project-trpc.schemas.ts:71
// Output: projectAggregateRuleUpdatedSchema, ../contract/src/project.responses.ts:87
interface Output {
  success: true;
  members: {
    attached: string[];
    revoked: string[];
    unchanged: string[];
    failed: string[];
    pending: string[];
  };
}

// project.aggregateMemberCandidates
// Input: projectAggregateMemberCandidatesInputSchema, ../contract/src/project-trpc.schemas.ts:78
interface Input {
  organizationId: string;
}
// Output: projectAggregateMemberCandidatesSchema, ../contract/src/project.responses.ts:93
type Output = {
  id: string;
  name: string;
  isPersonal: boolean;
  owner: {
    name: string | null;
    email: string | null;
  } | null;
}[];
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `project_lifecycle` (aggregate `project`)

Declared at `src/eventing/project-lifecycle.pipeline.ts:51`. Events: `projectCreatedEventSchema`, `projectLegacyKeyRevokedEventSchema`, `projectPresenceSettingChangedEventSchema`, `projectMovedEventSchema`, `projectArchivedEventSchema`, `projectDepartmentAssignedEventSchema`, `projectTraceSharingDisabledEventSchema`, `projectAggregateRuleChangedEventSchema`, `projectRevivedEventSchema`.

| Kind    | Name                                | Handles | Declared at                                     |
| ------- | ----------------------------------- | ------- | ----------------------------------------------- |
| command | `recordProjectCreated`              | –       | `src/eventing/project-lifecycle.pipeline.ts:66` |
| command | `recordProjectLegacyKeyRevoked`     | –       | `src/eventing/project-lifecycle.pipeline.ts:67` |
| command | `recordPresenceSettingChanged`      | –       | `src/eventing/project-lifecycle.pipeline.ts:68` |
| command | `recordProjectMoved`                | –       | `src/eventing/project-lifecycle.pipeline.ts:69` |
| command | `recordProjectArchived`             | –       | `src/eventing/project-lifecycle.pipeline.ts:70` |
| command | `recordProjectDepartmentAssigned`   | –       | `src/eventing/project-lifecycle.pipeline.ts:71` |
| command | `recordProjectTraceSharingDisabled` | –       | `src/eventing/project-lifecycle.pipeline.ts:72` |
| command | `recordProjectAggregateRuleChanged` | –       | `src/eventing/project-lifecycle.pipeline.ts:73` |
| command | `recordProjectRevived`              | –       | `src/eventing/project-lifecycle.pipeline.ts:74` |

### Tasks

Run by the tasks process, before serve.

| Task                                   | Class                                   | Declared at                                                 |
| -------------------------------------- | --------------------------------------- | ----------------------------------------------------------- |
| `backfill-project-created`             | `ProjectCreatedBackfillTask`            | `src/tasks/project-created-backfill.task.ts:20`             |
| `backfill-project-presence-setting`    | `ProjectPresenceSettingBackfillTask`    | `src/tasks/project-presence-setting-backfill.task.ts:16`    |
| `backfill-project-department-assigned` | `ProjectDepartmentAssignedBackfillTask` | `src/tasks/project-department-assigned-backfill.task.ts:16` |

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
