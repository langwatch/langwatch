# @langwatch/prompt-process

The server half of [prompt](../README.md). Prompts: versioned prompt configurations, their tags and handles, syncing from the SDK, and the playground that runs them.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("prompt").withRepositories(promptRepositories).withApi(PromptModule).withTransports(promptRest, promptExecuteRest, promptTrpcTransport, promptTagTrpcTransport).withEventing(promptLifecycleEventing).withMigrations(…).provideMiddlewareBindings(…)`, `src/prompt.module.ts:17`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`PromptApi`)

Callable prompt operations shared by process peers after composition.

Peers call these through the token, declared at `../contract/src/prompt.api.ts:64`; nothing else in this package is public.

#### `executePlayground`

Runs one browser playground request after transport authentication and authorization.

```typescript
executePlayground(input: PromptExecuteRequest, by?: PromptApiCaller): Promise<AsyncIterable<PlaygroundStreamEvent>>;
```

#### `promptsPlatformUrl`

The deep link back into the prompt library for this project.

```typescript
promptsPlatformUrl(input: { projectSlug: string }): string;
```

#### `getAllPrompts`

```typescript
getAllPrompts(input: { projectId: string; organizationId?: string; version?: "latest" | "all"; }): Promise<VersionedPrompt[]>;
```

#### `getAllVersions`

```typescript
getAllVersions(input: { idOrHandle: string; projectId: string; organizationId?: string; }): Promise<VersionedPrompt[]>;
```

#### `createPrompt`

```typescript
createPrompt(input: CreatePromptCommand): Promise<VersionedPrompt>;
```

#### `updatePrompt`

```typescript
updatePrompt(input: UpdatePromptCommand): Promise<VersionedPrompt>;
```

#### `deletePrompt`

```typescript
deletePrompt(input: { idOrHandle: string; projectId: string; organizationId?: string; }): Promise<PromptDeleteResult>;
```

#### `syncPrompt`

```typescript
syncPrompt(input: PromptRestSyncInput): Promise<PromptSyncResult>;
```

#### `assignTag`

```typescript
assignTag(input: { configId: string; versionId: string; tag: string; projectId: string; organizationId?: string; }, by?: PromptApiCaller): Promise<PromptTagAssignment>;
```

#### `listTags`

```typescript
listTags(input: { organizationId: string }): Promise<PromptTag[]>;
```

#### `createTag`

```typescript
createTag(input: { organizationId: string; name: string; createdById?: string; }): Promise<PromptTag>;
```

#### `renameTag`

```typescript
renameTag(input: { organizationId: string; oldName: string; newName: string; }): Promise<PromptTag>;
```

#### `deleteTagByName`

```typescript
deleteTagByName(input: { organizationId: string; name: string }): Promise<PromptTag>;
```

#### `listForProject`

```typescript
listForProject(input: { projectId: string; organizationId?: string; version?: "latest" | "all"; }): Promise<VersionedPrompt[]>;
```

#### `findByIdOrHandle`

```typescript
findByIdOrHandle(input: PromptReference & { organizationId?: string }): Promise<VersionedPrompt | null>;
```

#### `getByIdOrHandle`

```typescript
getByIdOrHandle(input: PromptReference & { organizationId?: string }): Promise<VersionedPrompt>;
```

#### `listVersions`

```typescript
listVersions(input: { idOrHandle: string; projectId: string; organizationId?: string; }): Promise<VersionedPrompt[]>;
```

#### `create`

```typescript
create(input: PromptCreateInput, by: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `update`

```typescript
update(input: PromptUpdateInput, by: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `updateHandle`

```typescript
updateHandle(input: UpdatePromptHandleCommand): Promise<VersionedPrompt>;
```

#### `restoreVersion`

```typescript
restoreVersion(input: { versionId: string; projectId: string; organizationId?: string }, by?: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `delete`

```typescript
delete(input: { idOrHandle: string; projectId: string; organizationId?: string; }): Promise<PromptDeleteResult>;
```

#### `copyToProject`

```typescript
copyToProject(input: Omit<CopyPromptCommand, "authorId">, by: PromptApiCaller): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
```

#### `duplicate`

```typescript
duplicate(input: { idOrHandle: string; projectId: string }, by: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `applySourceToCopy`

```typescript
applySourceToCopy(input: { source: VersionedPrompt; targetIdOrHandle: string; targetProjectId: string; commitMessage: string; }, by: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `checkHandleUniqueness`

```typescript
checkHandleUniqueness(input: { handle: string; projectId: string; scope: "PROJECT" | "ORGANIZATION"; }): Promise<boolean>;
```

#### `checkModifyPermission`

```typescript
checkModifyPermission(input: { idOrHandle: string; projectId: string; organizationId?: string; }): Promise<PromptModifyPermission>;
```

#### `getTagsForConfig`

```typescript
getTagsForConfig(input: { configId: string; projectId: string }): Promise<PromptTagAssignment[]>;
```

#### `listTagsForProject`

```typescript
listTagsForProject(input: { projectId: string }): Promise<PromptTag[]>;
```

#### `getNamesByIds`

```typescript
getNamesByIds(input: { ids: string[]; projectId: string; organizationId: string; }): Promise<{ id: string; name: string }[]>;
```

#### `getExistingIds`

```typescript
getExistingIds(input: { ids: string[]; projectId: string; organizationId: string; }): Promise<string[]>;
```

#### `listCopies`

```typescript
listCopies(input: { sourcePromptId: string }): Promise<PromptCopySummary[]>;
```

#### `getCopySource`

```typescript
getCopySource(input: { promptId: string }): Promise<PromptCopySource>;
```

#### `createTagForProject`

```typescript
createTagForProject(input: { projectId: string; name: string }, by: PromptApiCaller): Promise<PromptTag>;
```

#### `announceCreated`

A project gained a prompt: the nurturing trail the door leaves.

```typescript
announceCreated(input: { projectId: string; promptId: string; userId?: string | null }): void;
```

#### `listCopyTargets`

```typescript
listCopyTargets(input: { idOrHandle: string; projectId: string }, by: PromptApiCaller): Promise<PromptCopyChoice[]>;
```

#### `copyFromProject`

```typescript
copyFromProject(input: { idOrHandle: string; sourceProjectId: string; targetProjectId: string }, by: PromptApiCaller): Promise<VersionedPrompt & { copiedFromPromptId: string }>;
```

#### `syncFromSource`

```typescript
syncFromSource(input: { idOrHandle: string; projectId: string }, by: PromptApiCaller): Promise<VersionedPrompt>;
```

#### `pushToCopies`

```typescript
pushToCopies(input: { idOrHandle: string; projectId: string; copyIds?: string[] }, by: PromptApiCaller): Promise<PromptPushToCopiesResult>;
```

#### `renameTagForProject`

```typescript
renameTagForProject(input: { projectId: string; oldName: string; newName: string; }): Promise<PromptTag>;
```

#### `deleteTagForProject`

```typescript
deleteTagForProject(input: { projectId: string; name: string }): Promise<PromptTag>;
```

#### `seedTagsForOrganization`

Seeds a new organization's tag catalogue with the built-in tags. Called once by the organization module's own onboarding ceremony, which is why this is the one operation on the interface no project scopes.

```typescript
seedTagsForOrganization(input: { organizationId: string }): Promise<void>;
```

#### `countUsage`

The usage report's figures (ADR-156, section 10).

```typescript
countUsage(input: { projectIds: readonly string[]; since?: number }): Promise<PromptUsageCount>;
```

#### `countVersionedPrompts`

The project's own live prompts with at least one version; the setup checklist's step.

```typescript
countVersionedPrompts(input: { projectId: string }): Promise<number>;
```

#### `getByAddress`

The `/api/prompts` REST family's operations: its refusals keep the statuses they had.

```typescript
getByAddress(input: { address: string; version?: number; tag?: string; projectId: string; organizationId: string; }): Promise<VersionedPrompt>;
```

#### `createWithTags`

```typescript
createWithTags(input: CreatePromptCommand & { organizationId: string; tags?: string[] }): Promise<ApiResponsePrompt>;
```

#### `updateWithTags`

```typescript
updateWithTags(input: UpdatePromptCommand & { organizationId: string; tags?: string[] }): Promise<ApiResponsePrompt>;
```

#### `syncAndAnnounce`

```typescript
syncAndAnnounce(input: PromptRestSyncInput): Promise<PromptSyncResult>;
```

#### `assignTagByAddress`

```typescript
assignTagByAddress(input: { idOrHandle: string; versionId: string; tag: string; projectId: string; organizationId: string; }): Promise<PromptTagAssignment>;
```

#### `createTagDefinition`

```typescript
createTagDefinition(input: { organizationId: string; name: string }): Promise<PromptTag>;
```

#### `renameTagDefinition`

```typescript
renameTagDefinition(input: { organizationId: string; oldName: string; newName: string; }): Promise<PromptTag>;
```

#### `deleteTagDefinition`

```typescript
deleteTagDefinition(input: { organizationId: string; name: string }): Promise<void>;
```

## REST transport

### `promptExecuteRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/prompt-execute.rest.ts:13` |
| Base URL    | none: each route's path is its address    |
| Addressing  | literal                                   |
| Credential  | browser                                   |

#### `POST /api/prompt-playground/2026-08-20/prompt.execute` · `promptExecute`

Streams playground execution events.

Permission `prompts:view`. Hidden from the OpenAPI document. Declared at `src/transport/prompt-execute.rest.ts:18`.

Answers at `/api/prompt-playground/2026-08-20/prompt.execute`.

```typescript
type Body = z.infer<typeof executeRequestSchema>; // ../contract/src/prompt.playground-execute.ts:29
// Response: inline, src/transport/prompt-execute.rest.ts:21
type Response = unknown;
```

### `promptRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/prompt.rest.ts:68`      |
| Base URL    | none: each route's path is its address |
| Addressing  | literal                                |
| Credential  | project                                |

#### `GET /api/prompts` · `getApiPrompts`

Get all prompts for a project

Permission `prompts:view`. Declared at `src/transport/prompt.rest.ts:73`.

Answers at `/api/prompts`, `/api/v1/prompts`.

```typescript
// Response: z.array(promptWireSchema) (inline, src/transport/prompt.rest.ts:75)
```

#### `PUT /api/prompts/:id{.+?}/tags/:tag` · `putApiPromptsByIdTagsByTag`

Assign a tag (e.g. "production", "staging") to a specific prompt version

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:104`.

Answers at `/api/prompts/:id{.+?}/tags/:tag`, `/api/v1/prompts/:id{.+?}/tags/:tag`.

```typescript
// Params: idTagParamsSchema, ../contract/src/prompt-rest.schemas.ts:143
interface Params {
  id: string;
  tag: string;
}
// Body: assignTagInputSchema, ../contract/src/prompt-rest.schemas.ts:115
interface Body {
  versionId: string;
}
// Response: assignTagResponseSchema, ../contract/src/prompt-rest.schemas.ts:109
interface Response {
  configId: string;
  versionId: string;
  tag: string;
  updatedAt: unknown;
}
```

#### `GET /api/prompts/tags` · `getApiPromptsTags`

List all prompt tag definitions for the organization

Permission `prompts:view`. Declared at `src/transport/prompt.rest.ts:141`.

Answers at `/api/prompts/tags`, `/api/v1/prompts/tags`.

```typescript
// Response: inline, src/transport/prompt.rest.ts:143
type Response = {
  id: string;
  name: string;
  createdAt: unknown;
}[];
```

#### `POST /api/prompts/tags` · `postApiPromptsTags`

Create a custom prompt tag definition for the organization

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:158`.

Answers at `/api/prompts/tags`, `/api/v1/prompts/tags`.

```typescript
// Body: createTagInputSchema, ../contract/src/prompt-rest.schemas.ts:121
interface Body {
  name: string;
}
// Response: tagDefinitionSchema, ../contract/src/prompt-rest.schemas.ts:116
interface Response {
  id: string;
  name: string;
  createdAt: unknown;
}
```

#### `PUT /api/prompts/tags/:tag` · `putApiPromptsTagsByTag`

Rename a prompt tag definition

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:180`.

Answers at `/api/prompts/tags/:tag`, `/api/v1/prompts/tags/:tag`.

```typescript
// Params: tagParamsSchema, ../contract/src/prompt-rest.schemas.ts:147
interface Params {
  tag: string;
}
// Body: renameTagInputSchema, ../contract/src/prompt-rest.schemas.ts:122
interface Body {
  name: string;
}
type Response = z.infer<typeof tagDefinitionSchema>; // ../contract/src/prompt-rest.schemas.ts:116
```

#### `DELETE /api/prompts/tags/:tag` · `deleteApiPromptsTagsByTag`

Delete a prompt tag definition and cascade to assignments

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:203`.

Answers at `/api/prompts/tags/:tag`, `/api/v1/prompts/tags/:tag`.

```typescript
type Params = z.infer<typeof tagParamsSchema>; // ../contract/src/prompt-rest.schemas.ts:147
// Response: inline, src/transport/prompt.rest.ts:206
type Response = unknown;
```

#### `GET /api/prompts/:id{.+?}/versions` · `getApiPromptsByIdVersions`

Get all versions for a prompt. Does not include base prompt data, only versioned data.

Permission `prompts:view`. Declared at `src/transport/prompt.rest.ts:216`.

Answers at `/api/prompts/:id{.+?}/versions`, `/api/v1/prompts/:id{.+?}/versions`.

```typescript
// Params: idParamsSchema, ../contract/src/prompt-rest.schemas.ts:142
interface Params {
  id: string;
}
// Response: z.array(promptWireSchema) (inline, src/transport/prompt.rest.ts:219)
```

#### `POST /api/prompts/:id{.+?}/versions/:versionId/restore` · `postApiPromptsByIdVersionsByVersionIdRestore`

Restore a prompt to a previous version. Creates a new version with the same config data as the specified version.

Permission `prompts:update`. Declared at `src/transport/prompt.rest.ts:252`.

Answers at `/api/prompts/:id{.+?}/versions/:versionId/restore`, `/api/v1/prompts/:id{.+?}/versions/:versionId/restore`.

```typescript
// Params: idVersionParamsSchema, ../contract/src/prompt-rest.schemas.ts:148
interface Params {
  id: string;
  versionId: string;
}
// Body: restorePromptVersionBodySchema, ../contract/src/prompt-rest.schemas.ts:154
type Body = Record<string, unknown>;
type Response = z.infer<typeof promptWireSchema>; // ../contract/src/prompt-rest.schemas.ts:104
```

#### `GET /api/prompts/:id{.+}` · `getApiPromptsById`

Get a specific prompt by slug, with optional shorthand syntax for tags and versions. Pass a bare slug like "pizza-prompt" to get the latest version, "pizza-prompt:production" to resolve a tagged version, or "pizza-prompt:2" to fetch version 2. Alternatively, use the tag or version query parameters with a bare slug.

Permission `prompts:view`. Declared at `src/transport/prompt.rest.ts:299`.

Answers at `/api/prompts/:id{.+}`, `/api/v1/prompts/:id{.+}`.

```typescript
type Params = z.infer<typeof idParamsSchema>; // ../contract/src/prompt-rest.schemas.ts:142
// Query: promptWindowQuerySchema, ../contract/src/prompt-rest.schemas.ts:155
interface Query {
  version?: number;
  tag?: string;
}
type Response = z.infer<typeof promptWireSchema>; // ../contract/src/prompt-rest.schemas.ts:104
```

#### `POST /api/prompts` · `postApiPrompts`

Create a new prompt with default initial version

Permission `prompts:create`. Declared at `src/transport/prompt.rest.ts:338`.

Answers at `/api/prompts`, `/api/v1/prompts`.

```typescript
type Body = z.infer<typeof createPromptInputSchema>; // ../contract/src/prompt-rest.schemas.ts:18
type Response = z.infer<typeof promptWireSchema>; // ../contract/src/prompt-rest.schemas.ts:104
```

#### `POST /api/prompts/:id{.+?}/sync` · `postApiPromptsByIdSync`

Sync/upsert a prompt with local content

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:364`.

Answers at `/api/prompts/:id{.+?}/sync`, `/api/v1/prompts/:id{.+?}/sync`.

```typescript
type Params = z.infer<typeof idParamsSchema>; // ../contract/src/prompt-rest.schemas.ts:142
type Body = z.infer<typeof syncInputSchema>; // ../contract/src/prompt-rest.schemas.ts:123
type Response = z.infer<typeof promptSyncResultSchema>; // ../contract/src/prompt.ts:187
```

#### `PUT /api/prompts/:id{.+}` · `putApiPromptsById`

Update a prompt

Permission `prompts:update`. Declared at `src/transport/prompt.rest.ts:392`.

Answers at `/api/prompts/:id{.+}`, `/api/v1/prompts/:id{.+}`.

```typescript
type Params = z.infer<typeof idParamsSchema>; // ../contract/src/prompt-rest.schemas.ts:142
type Body = z.infer<typeof updatePromptInputSchema>; // ../contract/src/prompt-rest.schemas.ts:47
type Response = z.infer<typeof promptWireSchema>; // ../contract/src/prompt-rest.schemas.ts:104
```

#### `DELETE /api/prompts/:id{.+}` · `deleteApiPromptsById`

Delete a prompt

Permission `prompts:manage`. Declared at `src/transport/prompt.rest.ts:427`.

Answers at `/api/prompts/:id{.+}`, `/api/v1/prompts/:id{.+}`.

```typescript
type Params = z.infer<typeof idParamsSchema>; // ../contract/src/prompt-rest.schemas.ts:142
// Response: successSchema, ../../../packages/api/src/rest/response.ts:249
interface Response {
  success: boolean;
}
```

## tRPC transport

### `promptTags`

Contract `../contract/src/prompt-tag.trpc.ts:27`, router `src/transport/prompt-tag.trpc.ts:8`.

| Procedure           | Kind     | Gate                        | Input                             | Output                     |
| ------------------- | -------- | --------------------------- | --------------------------------- | -------------------------- |
| `promptTags.getAll` | query    | Permission `prompts:view`   | `promptTagProjectTrpcInputSchema` | inline                     |
| `promptTags.create` | mutation | Permission `prompts:manage` | `promptTagNameTrpcInputSchema`    | `promptTagSchema`          |
| `promptTags.rename` | mutation | Permission `prompts:manage` | `promptTagRenameTrpcInputSchema`  | `promptTagSchema`          |
| `promptTags.delete` | mutation | Permission `prompts:manage` | `promptTagNameTrpcInputSchema`    | `promptDeleteResultSchema` |

```typescript
// promptTags.getAll
// Input: promptTagProjectTrpcInputSchema, ../contract/src/prompt-tag.trpc.ts:12
interface Input {
  projectId: string;
}
// Output: inline, ../contract/src/prompt-tag.trpc.ts:30
type Output = {
  id: string;
  organizationId: string;
  name: string;
  createdById?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
  updatedById?: string | null;
}[];

// promptTags.create
// Input: promptTagNameTrpcInputSchema, ../contract/src/prompt-tag.trpc.ts:15
interface Input {
  projectId: string;
  name: string;
}
// Output: promptTagSchema, ../contract/src/prompt.ts:89
interface Output {
  id: string;
  organizationId: string;
  name: string;
  createdById?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
  updatedById?: string | null;
}

// promptTags.rename
// Input: promptTagRenameTrpcInputSchema, ../contract/src/prompt-tag.trpc.ts:21
interface Input {
  projectId: string;
  oldName: string;
  newName: string;
}
type Output = z.infer<typeof promptTagSchema>; // ../contract/src/prompt.ts:89

// promptTags.delete
type Input = z.infer<typeof promptTagNameTrpcInputSchema>; // ../contract/src/prompt-tag.trpc.ts:15
// Output: promptDeleteResultSchema, ../contract/src/prompt.ts:152
interface Output {
  success: boolean;
}
```

### `prompts`

Contract `../contract/src/prompt.trpc.ts:48`, router `src/transport/prompt.trpc.ts:15`.

| Procedure                         | Kind     | Gate                        | Input                                   | Output                           |
| --------------------------------- | -------- | --------------------------- | --------------------------------------- | -------------------------------- |
| `prompts.getAllPromptsForProject` | query    | Permission `prompts:view`   | `promptProjectTrpcInputSchema`          | inline                           |
| `prompts.getCopies`               | query    | Permission `prompts:view`   | `promptIdOrHandleTrpcInputSchema`       | inline                           |
| `prompts.restoreVersion`          | mutation | Permission `prompts:update` | `promptRestoreVersionTrpcInputSchema`   | `versionedPromptSchema`          |
| `prompts.create`                  | mutation | Permission `prompts:create` | `promptCreateTrpcInputSchema`           | `versionedPromptSchema`          |
| `prompts.update`                  | mutation | Permission `prompts:update` | `promptUpdateTrpcInputSchema`           | `versionedPromptSchema`          |
| `prompts.updateHandle`            | mutation | Permission `prompts:update` | `promptUpdateHandleTrpcInputSchema`     | `versionedPromptSchema`          |
| `prompts.getByIdOrHandle`         | query    | Permission `prompts:view`   | `promptGetByIdOrHandleTrpcInputSchema`  | inline                           |
| `prompts.checkHandleUniqueness`   | query    | Permission `prompts:view`   | `promptHandleUniquenessTrpcInputSchema` | inline                           |
| `prompts.checkModifyPermission`   | query    | Permission `prompts:view`   | `promptIdOrHandleTrpcInputSchema`       | `promptModifyPermissionSchema`   |
| `prompts.getAllVersionsForPrompt` | query    | Permission `prompts:view`   | `promptIdOrHandleTrpcInputSchema`       | inline                           |
| `prompts.delete`                  | mutation | Permission `prompts:delete` | `promptIdOrHandleTrpcInputSchema`       | `promptDeleteResultSchema`       |
| `prompts.copy`                    | mutation | Permission `prompts:create` | `promptCopyTrpcInputSchema`             | `copiedPromptSchema`             |
| `prompts.duplicate`               | mutation | Permission `prompts:create` | `promptIdOrHandleTrpcInputSchema`       | `versionedPromptSchema`          |
| `prompts.syncFromSource`          | mutation | Permission `prompts:update` | `promptIdOrHandleTrpcInputSchema`       | `versionedPromptSchema`          |
| `prompts.pushToCopies`            | mutation | Permission `prompts:update` | `promptPushToCopiesTrpcInputSchema`     | `promptPushToCopiesResultSchema` |
| `prompts.getTagsForConfig`        | query    | Permission `prompts:view`   | `promptConfigTagsTrpcInputSchema`       | inline                           |
| `prompts.assignTag`               | mutation | Permission `prompts:update` | `promptAssignTagTrpcInputSchema`        | `promptTagAssignmentSchema`      |

```typescript
// prompts.getAllPromptsForProject
// Input: promptProjectTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:17
interface Input {
  projectId: string;
}
// Output: versionedPromptSchema.array() (inline, ../contract/src/prompt.trpc.ts:54)

// prompts.getCopies
// Input: promptIdOrHandleTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:24
interface Input {
  projectId: string;
  idOrHandle: string;
}
// Output: inline, ../contract/src/prompt.trpc.ts:59
type Output = {
  id: string;
  handle: string;
  projectId: string;
  projectName: string;
  teamName: string;
  organizationName: string;
  fullPath: string;
  hasPermission: boolean;
}[];

// prompts.restoreVersion
// Input: promptRestoreVersionTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:29
interface Input {
  versionId: string;
  projectId: string;
}
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.create
type Input = z.infer<typeof promptCreateTrpcInputSchema>; // ../contract/src/prompt.trpc.ts:36
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.update
type Input = z.infer<typeof promptUpdateTrpcInputSchema>; // ../contract/src/prompt.trpc.ts:41
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.updateHandle
// Input: promptUpdateHandleTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:168
interface Input {
  projectId: string;
  id: string;
  data: {
    handle: string;
    scope: "PROJECT" | "ORGANIZATION";
  };
}
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.getByIdOrHandle
// Input: promptGetByIdOrHandleTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:177
interface Input {
  idOrHandle: string;
  projectId: string;
  versionId?: string;
  version?: number;
  tag?: string;
}
// Output: versionedPromptSchema.nullable() (inline, ../contract/src/prompt.trpc.ts:83)

// prompts.checkHandleUniqueness
// Input: promptHandleUniquenessTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:188
interface Input {
  handle: string;
  projectId: string;
  scope: "PROJECT" | "ORGANIZATION";
}
// Output: inline, ../contract/src/prompt.trpc.ts:87
type Output = boolean;

// prompts.checkModifyPermission
type Input = z.infer<typeof promptIdOrHandleTrpcInputSchema>; // ../contract/src/prompt.trpc-schemas.ts:24
// Output: promptModifyPermissionSchema, ../contract/src/prompt.ts:155
interface Output {
  hasPermission: boolean;
  reason?: string;
}

// prompts.getAllVersionsForPrompt
type Input = z.infer<typeof promptIdOrHandleTrpcInputSchema>; // ../contract/src/prompt.trpc-schemas.ts:24
// Output: versionedPromptSchema.array() (inline, ../contract/src/prompt.trpc.ts:95)

// prompts.delete
type Input = z.infer<typeof promptIdOrHandleTrpcInputSchema>; // ../contract/src/prompt.trpc-schemas.ts:24
type Output = z.infer<typeof promptDeleteResultSchema>; // ../contract/src/prompt.ts:152

// prompts.copy
// Input: promptCopyTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:194
interface Input {
  idOrHandle: string;
  projectId: string;
  sourceProjectId: string;
}
type Output = z.infer<typeof copiedPromptSchema>; // ../contract/src/prompt.ts:233

// prompts.duplicate
type Input = z.infer<typeof promptIdOrHandleTrpcInputSchema>; // ../contract/src/prompt.trpc-schemas.ts:24
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.syncFromSource
type Input = z.infer<typeof promptIdOrHandleTrpcInputSchema>; // ../contract/src/prompt.trpc-schemas.ts:24
type Output = z.infer<typeof versionedPromptSchema>; // ../contract/src/prompt.ts:102

// prompts.pushToCopies
// Input: promptPushToCopiesTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:200
interface Input {
  projectId: string;
  idOrHandle: string;
  copyIds?: string[];
}
type Output = z.infer<typeof promptPushToCopiesResultSchema>; // ../contract/src/prompt.ts:243

// prompts.getTagsForConfig
// Input: promptConfigTagsTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:206
interface Input {
  projectId: string;
  configId: string;
}
// Output: promptTagAssignmentSchema.array() (inline, ../contract/src/prompt.trpc.ts:121)

// prompts.assignTag
// Input: promptAssignTagTrpcInputSchema, ../contract/src/prompt.trpc-schemas.ts:211
interface Input {
  projectId: string;
  configId: string;
  versionId: string;
  tag: string;
}
type Output = z.infer<typeof promptTagAssignmentSchema>; // ../contract/src/prompt.ts:160
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `prompt_lifecycle` (aggregate `prompt`)

Declared at `src/eventing/prompt-lifecycle.pipeline.ts:51`. Events: `promptCreatedEventSchema`.

| Kind            | Name                         | Handles                                                                     | Declared at                                    |
| --------------- | ---------------------------- | --------------------------------------------------------------------------- | ---------------------------------------------- |
| command         | `recordPromptCreated`        | –                                                                           | `src/eventing/prompt-lifecycle.pipeline.ts:56` |
| peer subscriber | `seedOrganizationPromptTags` | `lw.organization.created` from [organization](../../organization/README.md) | `src/eventing/prompt-lifecycle.pipeline.ts:57` |

## Configuration

| Kind   | Leaf            | Environment variable | Declared at                          |
| ------ | --------------- | -------------------- | ------------------------------------ |
| config | `publicBaseUrl` | `BASE_HOST`          | `../contract/src/prompt.config.ts:5` |

<!-- readme:generated:end -->
