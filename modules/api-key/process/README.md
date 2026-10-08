# @langwatch/api-key-process

The server half of [api-key](../README.md). API keys: creating and updating them, resolving a presented token to its caller, and minting the short-lived keys runs and agent sandboxes use.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("api-key").withRepositories(apiKeyRepositories).withApi(ApiKeyModule).withTransports(apiKeyRest, apiKeyProjectsRest, apiKeyTrpcTransport).withTransportFacts(…).withEventing(apiKeyEventing)`, `src/api-key.module.ts:25`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ApiKeyApi`)

Peers call these through the token, declared at `../contract/src/api-key.api.ts:84`; nothing else in this package is public.

#### `create`

```typescript
create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
```

#### `update`

```typescript
update(input: UpdateApiKeyInput): Promise<ApiKey>;
```

#### `updateAsCaller`

`update`, answering somebody else's key as not found so the id confirms nothing.

```typescript
updateAsCaller(input: UpdateApiKeyInput): Promise<ApiKey>;
```

#### `findVerifiedToken`

Authentication is an attempted lookup: invalid credentials return null.

```typescript
findVerifiedToken(input: ApiKeyVerifyInput): Promise<ApiKeyVerification | null>;
```

#### `findResolvedToken`

Resolves either a current API key or the deprecated project credential.

```typescript
findResolvedToken(input: ApiKeyTokenResolutionInput): Promise<ResolvedApiKeyCredential | null>;
```

#### `mintRunKey`

A key for one run's calls back into LangWatch, reused per (user, project, permissions) while it has `minRemainingMs` (default 5 minutes) left. With a user, refuses with `ApiKeyPermissionDeniedError` on the first permission they lack, cached key or not.

```typescript
mintRunKey(input: MintRunKeyInput): Promise<string>;
```

#### `mintAgentSandboxKey`

The key every code agent run of a project puts in its sandbox: the agent cache alone, for twelve hours, shared for eight. Nobody's in a shared project, the owner's in a personal one.

```typescript
mintAgentSandboxKey(input: MintAgentSandboxKeyInput): Promise<string>;
```

#### `resolveOrganizationToken`

Resolves organization-only credentials while keeping refusal classes apart.

```typescript
resolveOrganizationToken(input: OrganizationApiKeyResolutionInput): Promise<OrganizationApiKeyResolution>;
```

#### `resolveVisibleProjects`

```typescript
resolveVisibleProjects(input: ApiKeyVisibleProjectsInput): Promise<ApiKeyVisibleProjects>;
```

#### `markUsed`

```typescript
markUsed(input: ApiKeyIdInput): void;
```

#### `list`

```typescript
list(input: ApiKeyListInput): Promise<ApiKey[]>;
```

#### `listAll`

```typescript
listAll(input: ApiKeyListAllInput): Promise<ApiKey[]>;
```

#### `listForCaller`

The keys a credential may list: a member's own, or every key in the organization for a service key that holds `organization:manage`.

```typescript
listForCaller(input: ApiKeyCredentialCheck): Promise<ApiKey[]>;
```

#### `revoke`

```typescript
revoke(input: RevokeApiKeyInput): Promise<ApiKey>;
```

#### `ensureCallerIsOrgMember`

```typescript
ensureCallerIsOrgMember(input: ApiKeyMembershipInput): Promise<void>;
```

#### `assertSelectionWithinCeiling`

```typescript
assertSelectionWithinCeiling(input: ApiKeySelectionInput): Promise<void>;
```

#### `isOrgAdmin`

```typescript
isOrgAdmin(input: ApiKeyMembershipInput): Promise<boolean>;
```

#### `credentialCanManageOrganization`

Whether the credential a request arrived with holds `organization:manage` here. Asked of the KEY and the member it acts as together, so a narrowed key cannot borrow the reach of whoever created it.

```typescript
credentialCanManageOrganization(input: ApiKeyCredentialCheck): Promise<boolean>;
```

#### `isOrgAdminApiKey`

```typescript
isOrgAdminApiKey(input: ApiKeyAdminKeyInput): Promise<boolean>;
```

#### `findById`

```typescript
findById(input: ApiKeyIdInput): Promise<ApiKey | null>;
```

#### `getByIdForCaller`

```typescript
getByIdForCaller(input: ApiKeyCallerReadInput): Promise<ApiKeyDetail>;
```

#### `findNameByIdInOrg`

```typescript
findNameByIdInOrg(input: ApiKeyOrgIdInput): Promise<ApiKeyName | null>;
```

#### `getUserBindings`

```typescript
getUserBindings(input: ApiKeyMembershipInput): Promise<ApiKeyBinding[]>;
```

#### `getOrgProjects`

```typescript
getOrgProjects(input: ApiKeyOrgInput): Promise<ApiKeyProject[]>;
```

#### `getOrgTeams`

```typescript
getOrgTeams(input: ApiKeyOrgInput): Promise<ApiKeyTeam[]>;
```

#### `getOrgMembers`

```typescript
getOrgMembers(input: ApiKeyOrgInput): Promise<ApiKeyUser[]>;
```

#### `findIngestionKey`

```typescript
findIngestionKey(input: { organizationId: string; projectId: string; sourceType: string; }): Promise<ApiKey | null>;
```

#### `listIngestionKeysForProject`

```typescript
listIngestionKeysForProject(input: { organizationId: string; projectId: string; }): Promise<ApiKey[]>;
```

#### `findIngestionKeysForUser`

The member's own live ingest keys in one organization, newest first.

```typescript
findIngestionKeysForUser(input: { organizationId: string; userId: string }): Promise<ApiKey[]>;
```

#### `findByLookupId`

One key by the lookup id embedded in its token, revoked or live.

```typescript
findByLookupId(input: { lookupId: string }): Promise<ApiKey | null>;
```

#### `validateCliSelection`

```typescript
validateCliSelection(input: { userId: string; organizationId: string; selection: CliKeySelection; }): Promise<CliKeySelection>;
```

#### `findDefaultCliSelection`

```typescript
findDefaultCliSelection(input: { userId: string; organizationId: string; }): Promise<CliKeySelection | null>;
```

#### `mintCliLoginKey`

```typescript
mintCliLoginKey(input: { userId: string; organizationId: string; deviceLabel: string; selection: CliKeySelection; /** * When the device session began, and the organization's session policy, * so the minted key's expiry tracks the session (see * `loginKeyExpiresAt`). Omitted, the key mints with no expiry. */ sessionStartedAtMs?: number; maxSessionDurationDays?: number; refreshWindowMs?: number; }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }>;
```

#### `revokeCliLoginKeysForDevice`

```typescript
revokeCliLoginKeysForDevice(input: { userId: string; organizationId: string; deviceLabel: string; exceptApiKeyId?: string; createdBefore?: Instant; }): Promise<void>;
```

#### `revokeCliSessionKey`

Retires a CLI session's login key and the keys under it: main's `revokeSessionKey`, counted. `cause` defaults to `user` (a person revoking it); auth's refused refresh passes `expired` or `offboarded`.

```typescript
revokeCliSessionKey(input: { apiKeyId: string; userId: string; organizationId: string; cause?: CliSessionRevocationCause; }): Promise<CliSessionKeyRevocation>;
```

#### `applySessionCeiling`

Main's `applySessionCeiling`: one organization's live login keys brought forward to a new max session duration, then the elapsed ones reaped with their ingest keys. Answers how many sessions were reaped.

```typescript
applySessionCeiling(input: { organizationId: string; maxSessionDurationDays: number; }): Promise<number>;
```

#### `revokeCliLoginKeyForLogout`

```typescript
revokeCliLoginKeyForLogout(input: { apiKeyId: string; userId: string; organizationId: string; }): Promise<void>;
```

#### `extendCliLoginKeyExpiry`

Moves a live login key's expiry with its session, on a successful refresh, so a session nothing keeps refreshing is still retired by the hourly sweep rather than sliding forward forever.

```typescript
extendCliLoginKeyExpiry(input: { apiKeyId: string; userId: string; organizationId: string; sessionStartedAtMs: number; maxSessionDurationDays: number; refreshWindowMs: number; }): Promise<void>;
```

#### `enrichBindingsWithNames`

```typescript
enrichBindingsWithNames(input: { bindings: ApiKeyBinding[]; organizationId?: string; }): Promise<ApiKeyBindingNames>;
```

#### `enrichApiKeyList`

```typescript
enrichApiKeyList(input: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment>;
```

#### `listCallerBindings`

The caller's own bindings in one organization, each with its scope named.

```typescript
listCallerBindings(input: { organizationId: string }, by: ApiKeyManagementCaller): Promise<NamedApiKeyBinding[]>;
```

#### `findKeyName`

One key id resolved to a display name. Answers null identically for an id that does not exist and one in another organization, so it cannot enumerate.

```typescript
findKeyName(input: { organizationId: string; apiKeyId: string }, by: ApiKeyManagementCaller): Promise<ApiKeyName | null>;
```

#### `listKeys`

The organization's keys for an admin, the caller's own for everyone else.

```typescript
listKeys(input: { organizationId: string }, by: ApiKeyManagementCaller): Promise<ApiKeyListEntry[]>;
```

#### `createKey`

Mints a key and answers its plaintext token once, here and nowhere else.

```typescript
createKey(input: CreateApiKeyManagementInput, by: ApiKeyManagementCaller): Promise<{ token: string; apiKey: ApiKey; assignedToUserId: string | null }>;
```

#### `createIngestionKey`

A person's own ingestion key on their session's project; refuses a non-person, then shape.

```typescript
createIngestionKey(input: CreateIngestionKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
```

#### `updateKey`

```typescript
updateKey(input: UpdateApiKeyManagementInput, by: ApiKeyManagementCaller): Promise<ApiKey>;
```

#### `revokeKey`

```typescript
revokeKey(input: { organizationId: string; apiKeyId: string }, by: ApiKeyManagementCaller): Promise<void>;
```

#### `listOrganizationProjects`

```typescript
listOrganizationProjects(input: { organizationId: string }, by: ApiKeyManagementCaller): Promise<ApiKeyProject[]>;
```

#### `listOrganizationTeams`

```typescript
listOrganizationTeams(input: { organizationId: string }, by: ApiKeyManagementCaller): Promise<ApiKeyTeam[]>;
```

#### `listOrganizationMembers`

```typescript
listOrganizationMembers(input: { organizationId: string }, by: ApiKeyManagementCaller): Promise<ApiKeyUser[]>;
```

## REST transport

### `apiKeyProjectsRest`

|             |                                             |
| ----------- | ------------------------------------------- |
| Declared at | `src/transport/api-key-projects.rest.ts:79` |
| Base URL    | none: each route's path is its address      |
| Addressing  | literal                                     |
| Credential  | organization                                |

#### `GET /api/projects` · `listProjects`

List projects

Authenticated: the listing answers exactly the projects the presented credential already reaches, resolved per key, so authentication is the whole gate and a narrower key is filtered rather than refused. Declared at `src/transport/api-key-projects.rest.ts:85`.

Answers at `/api/projects`.

```typescript
type Query = z.infer<typeof projectRestPaginationQuerySchema>; // ../contract/src/api-key-rest.schemas.ts:118
type Response = z.infer<typeof projectRestPageSchema>; // ../contract/src/api-key.rest.ts:76
```

#### `POST /api/projects` · `createProject`

Create a project

Permission `project:create`. Declared at `src/transport/api-key-projects.rest.ts:111`.

Answers at `/api/projects`.

```typescript
type Body = z.infer<typeof projectRestCreateSchema>; // ../contract/src/api-key-rest.schemas.ts:123
type Response = z.infer<typeof projectRestCreatedSchema>; // ../contract/src/api-key.rest.ts:95
```

### `apiKeyRest`

|             |                                          |
| ----------- | ---------------------------------------- |
| Declared at | `src/transport/api-key.rest.ts:275`      |
| Base URL    | `/api/api-keys`, twin `/api/v1/api-keys` |
| Addressing  | dated                                    |
| Credential  | organization                             |
| Versions    | `2026-08-07`                             |

#### `GET /` · `listApiKeys`

List API keys

Permission `organization:view`. Declared at `src/transport/api-key.rest.ts:284`.

Answers at `/api/api-keys`, `/api/v1/api-keys`; also, undocumented, `/api/api-keys/2026-08-07`, `/api/v1/api-keys/2026-08-07`, `/api/api-keys/latest`, `/api/v1/api-keys/latest`.

```typescript
type Response = z.infer<typeof apiKeyRestListSchema>; // ../contract/src/api-key.rest.ts:36
```

#### `POST /` · `createApiKey`

Create an API key

Permission `organization:manage`. Declared at `src/transport/api-key.rest.ts:320`.

Answers at `/api/api-keys`, `/api/v1/api-keys`; also, undocumented, `/api/api-keys/2026-08-07`, `/api/v1/api-keys/2026-08-07`, `/api/api-keys/latest`, `/api/v1/api-keys/latest`.

```typescript
type Body = z.infer<typeof apiKeyRestCreateSchema>; // ../contract/src/api-key-rest.schemas.ts:42
type Response = z.infer<typeof apiKeyRestMintedSchema>; // ../contract/src/api-key.rest.ts:52
```

#### `GET /:id` · `getApiKey`

Get an API key

Permission `organization:view`. Declared at `src/transport/api-key.rest.ts:387`.

Answers at `/api/api-keys/:id`, `/api/v1/api-keys/:id`; also, undocumented, `/api/api-keys/2026-08-07/:id`, `/api/v1/api-keys/2026-08-07/:id`, `/api/api-keys/latest/:id`, `/api/v1/api-keys/latest/:id`.

```typescript
type Params = z.infer<typeof apiKeyRestParamsSchema>; // ../contract/src/api-key-rest.schemas.ts:40
type Response = z.infer<typeof apiKeyRestDetailSchema>; // ../contract/src/api-key.rest.ts:40
```

#### `PATCH /:id` · `updateApiKey`

Update an API key

Permission `organization:manage`. Declared at `src/transport/api-key.rest.ts:422`.

Answers at `/api/api-keys/:id`, `/api/v1/api-keys/:id`; also, undocumented, `/api/api-keys/2026-08-07/:id`, `/api/v1/api-keys/2026-08-07/:id`, `/api/api-keys/latest/:id`, `/api/v1/api-keys/latest/:id`.

```typescript
type Params = z.infer<typeof apiKeyRestParamsSchema>; // ../contract/src/api-key-rest.schemas.ts:40
type Body = z.infer<typeof apiKeyRestUpdateSchema>; // ../contract/src/api-key-rest.schemas.ts:99
type Response = z.infer<typeof apiKeyRestDetailSchema>; // ../contract/src/api-key.rest.ts:40
```

#### `DELETE /:id` · `revokeApiKey`

Revoke an API key

Permission `organization:manage`. Declared at `src/transport/api-key.rest.ts:479`.

Answers at `/api/api-keys/:id`, `/api/v1/api-keys/:id`; also, undocumented, `/api/api-keys/2026-08-07/:id`, `/api/v1/api-keys/2026-08-07/:id`, `/api/api-keys/latest/:id`, `/api/v1/api-keys/latest/:id`.

```typescript
type Params = z.infer<typeof apiKeyRestParamsSchema>; // ../contract/src/api-key-rest.schemas.ts:40
type Response = z.infer<typeof apiKeyRestRevokedSchema>; // ../contract/src/api-key.rest.ts:63
```

#### `POST /ingestion` · `createIngestionApiKey`

Create an ingestion API key

Permission `traces:create`. Credential `project`. Declared at `src/transport/api-key.rest.ts:515`.

Answers at `/api/api-keys/ingestion`, `/api/v1/api-keys/ingestion`; also, undocumented, `/api/api-keys/2026-08-07/ingestion`, `/api/v1/api-keys/2026-08-07/ingestion`, `/api/api-keys/latest/ingestion`, `/api/v1/api-keys/latest/ingestion`.

```typescript
type Body = z.infer<typeof apiKeyRestCreateSchema>; // ../contract/src/api-key-rest.schemas.ts:42
type Response = z.infer<typeof apiKeyRestMintedSchema>; // ../contract/src/api-key.rest.ts:52
```

#### `POST /full-access` · `createFullAccessApiKey`

Create a full-access API key

Permission `project:manage`. Credential `project`. Declared at `src/transport/api-key.rest.ts:557`.

Answers at `/api/api-keys/full-access`, `/api/v1/api-keys/full-access`; also, undocumented, `/api/api-keys/2026-08-07/full-access`, `/api/v1/api-keys/2026-08-07/full-access`, `/api/api-keys/latest/full-access`, `/api/v1/api-keys/latest/full-access`.

```typescript
type Body = z.infer<typeof apiKeyRestCreateSchema>; // ../contract/src/api-key-rest.schemas.ts:42
type Response = z.infer<typeof apiKeyRestMintedSchema>; // ../contract/src/api-key.rest.ts:52
```

## tRPC transport

### `apiKey`

Contract `../contract/src/api-key.trpc.ts:33`, router `src/transport/api-key.trpc.ts:23`.

| Procedure            | Kind     | Gate                                                                                                                       | Input                               | Output                |
| -------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------- |
| `apiKey.myBindings`  | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcOrganizationScopeSchema` | inline                |
| `apiKey.nameById`    | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcNameByIdInputSchema`     | inline                |
| `apiKey.list`        | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcOrganizationScopeSchema` | inline                |
| `apiKey.create`      | mutation | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcCreateInputSchema`       | `apiKeyMintedSchema`  |
| `apiKey.update`      | mutation | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcUpdateInputSchema`       | `apiKeyUpdatedSchema` |
| `apiKey.revoke`      | mutation | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcRevokeInputSchema`       | `apiKeyRevokedSchema` |
| `apiKey.orgProjects` | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcOrganizationScopeSchema` | inline                |
| `apiKey.orgTeams`    | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcOrganizationScopeSchema` | inline                |
| `apiKey.orgMembers`  | query    | No permission: personal API keys are the caller's own; the application proves organization membership and ownership itself | `apiKeyTrpcOrganizationScopeSchema` | inline                |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `agent_sandbox_maintenance` (aggregate `global`)

Declared at `src/eventing/api-key.pipeline.ts:85`.

| Kind            | Name                  | Handles                                                                                    | Declared at                            |
| --------------- | --------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------- |
| process manager | `agentSandboxKeyReap` | every 1 h (`AGENT_SANDBOX_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000`); intents `reap` (outbox) | `src/eventing/api-key.pipeline.ts:94`  |
| process manager | `cliLoginKeyReap`     | every 1 h (`CLI_LOGIN_KEY_REAP_INTERVAL_MS = 60 * 60 * 1000`); intents `reap` (outbox)     | `src/eventing/api-key.pipeline.ts:104` |

## Configuration

| Kind   | Leaf                 | Environment variable          | Declared at                  |
| ------ | -------------------- | ----------------------------- | ---------------------------- |
| secret | `pepper`             | `API_KEY_PEPPER`              | `src/app/api-key.app.ts:169` |
| secret | `pepperFallback`     | `CREDENTIALS_SECRET`          | `src/app/api-key.app.ts:170` |
| secret | `pepperLastFallback` | `NEXTAUTH_SECRET`             | `src/app/api-key.app.ts:171` |
| secret | `pepperPrevious`     | `CREDENTIALS_SECRET_PREVIOUS` | `src/app/api-key.app.ts:173` |

<!-- readme:generated:end -->
