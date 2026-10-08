# @langwatch/enterprise-scim-process

The server half of [scim](../README.md). SCIM provisioning: directory connections, their tokens, and syncing users from a directory.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("scim").withRepositories(scimRepositories).withApi(ScimModule).withTransports(scimTokenRest, scimTokenTrpcTransport, scimReconciliationTrpcTransport, scimOversightTrpcTransport, scimProtocolRest, scimWebhookRest).withTransportFacts(…).withEventing(scimEventing).withEventing(scimDirectoryEventing).withEventing(scimSyncEventing).withEventing(scimCostCenterEventing).withEventing(scimSsoConnectionEventing).withMigrations(…)`, `src/scim.module.ts:35`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`ScimApi`)

Peers call these through the token, declared at `../contract/src/scim.api.ts:70`; nothing else in this package is public.

#### `listTokens`

The organization's tokens, described. Never a value or a hash.

```typescript
listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]>;
```

#### `findConnections`

The organization's directory connections, as identity answers them. A token's whole write authority is the connection it names, so the page that mints one reads the choices from the module that owns them.

```typescript
findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]>;
```

#### `findDirectoryExternalIds`

The identity provider's own id for each member, across every connection the organization holds.

```typescript
findDirectoryExternalIds(input: { organizationId: string; }): Promise<{ userId: string; externalId: string }[]>;
```

#### `isDirectoryUserInactive`

Whether this organization's directory holds the person as inactive: asked by a single sign-on before it attaches an assertion to them.

```typescript
isDirectoryUserInactive(input: { organizationId: string; userId: string }): Promise<boolean>;
```

#### `findDirectoryConnectionsForUser`

The connections of this organization whose directory sync provisioned the person.

```typescript
findDirectoryConnectionsForUser(input: { organizationId: string; userId: string; }): Promise<string[]>;
```

#### `generateToken`

Mints a token for one directory connection. `connectionId` is the whole of the token's write authority, so it is named rather than defaulted.

```typescript
generateToken(input: { organizationId: string; connectionId?: string | undefined; description?: string | undefined; secret?: string | undefined; }, by: ScimTokenCaller): Promise<IssuedScimToken>;
```

#### `revokeToken`

Retires one token. Idempotent from the caller's side.

```typescript
revokeToken(input: { organizationId: string; tokenId: string }): Promise<{ success: true }>;
```

#### `isEnterpriseEntitled`

Whether the organization's plan includes directory sync. The plan source is the process's; this answers the one question every Enterprise gate on this feature asks of it.

```typescript
isEnterpriseEntitled(input: { organizationId: string }): Promise<boolean>;
```

#### `moveToConnection`

Re-homes one connection's directory sync onto the connection that replaced it: the tokens, people and external ids follow. Recorded on scim's own pipeline and moved by its worker.

```typescript
moveToConnection(input: { organizationId: string; fromConnectionId: string; toConnectionId: string; }): Promise<void>;
```

#### `recordTokenAudit`

Records a management-API write on a token. The ledger is the deployment's, composed in: only the door that has always written to it calls this, so the settings page does not start filing rows the audit never had.

```typescript
recordTokenAudit(entry: ScimTokenAuditEntry): void;
```

#### `authenticateDirectory`

The tenant behind a SCIM bearer, or the protocol's own refusal.

```typescript
authenticateDirectory(input: { authorization: string | null; /** What the provider asked for, so an attributable refusal can be filed * against the connection it was meant for (ADR-126). A door that does * not supply them refuses exactly as before and records nothing. */ method?: string | undefined; path?: string | undefined; }): Promise<ScimDirectoryScope>;
```

#### `verifyToken`

The same verification, answered rather than thrown, for the intake that owns its own refusal bodies.

```typescript
verifyToken(input: { token: string }): Promise<ScimTokenEntitlement>;
```

#### `findDirectoryRequests`

Every request one connection's directory made, newest first (ADR-126) — including the ones refused before a handler saw them, which appear in no activity feed because they decided nothing.

```typescript
findDirectoryRequests(input: ScimConnectionRequestsInput): Promise<ScimRequestEntry[]>;
```

#### `getDirectoryReconciliation`

Where every one of this organization's directory syncs stands, in words (ADR-122): what each connection is waiting for, when it last heard from the directory, how many people that directory manages, what it asked for that has not been applied, and the access it changed lately. The organization is what the read is BUILT from rather than a filter beside a connection id, so another organization's connection is not excluded — it was never in the answer to be excluded from.

```typescript
getDirectoryReconciliation(input: ScimReconciliationScope): Promise<OrganizationReconciliation>;
```

#### `findConnectionReconciliation`

One connection's sync in the same words, empty for a connection this organization does not have — another's included, which reads the same.

```typescript
findConnectionReconciliation(input: ScimConnectionRequestsInput): Promise<ConnectionReconciliation[]>;
```

#### `findDirectoryActivity`

What one connection's directory did, newest first, in words (ADR-126). Scanned in this organization's tenant, so another's connection reads empty.

```typescript
findDirectoryActivity(input: ScimConnectionRequestsInput): Promise<ScimDirectoryActivityEntry[]>;
```

#### `listOversightSyncs`

```typescript
listOversightSyncs(input: ListOversightSyncsInput, by: ScimOperator): Promise<OversightSyncList>;
```

#### `findOversightSync`

```typescript
findOversightSync(input: OversightConnectionInput, by: ScimOperator): Promise<OversightSync[]>;
```

#### `findDirectoryIdentities`

```typescript
findDirectoryIdentities(input: OversightConnectionInput, by: ScimOperator): Promise<DirectoryIdentityRow[]>;
```

#### `redriveRetiredApply`

```typescript
redriveRetiredApply(input: RedriveRetiredApplyInput, by: ScimOperator): Promise<RedriveRetiredApplyResult>;
```

#### `listUsers`

```typescript
listUsers(input: { organizationId: string; connectionId?: string | null | undefined; filter?: string | undefined; startIndex?: number | undefined; count?: number | undefined; }): Promise<ScimListResponse<ScimUser>>;
```

#### `createUser`

`body` is the posted text, read here: one that is not JSON, or not a resource we accept, is filed on the request log (ADR-126) and refused as the protocol's 400 naming only the fields.

```typescript
createUser(input: { organizationId: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimUser>;
```

#### `getUser`

```typescript
getUser(input: { organizationId: string; id: string }): Promise<ScimUser>;
```

#### `replaceUser`

```typescript
replaceUser(input: { organizationId: string; id: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimUser>;
```

#### `updateUser`

```typescript
updateUser(input: { organizationId: string; id: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimUser>;
```

#### `deleteUser`

```typescript
deleteUser(input: { organizationId: string; id: string; connectionId?: string | null | undefined; }): Promise<void>;
```

#### `listGroups`

```typescript
listGroups(input: { organizationId: string; connectionId?: string | null | undefined; filter?: string | undefined; startIndex?: number | undefined; count?: number | undefined; excludeMembers?: boolean | undefined; }): Promise<ScimListResponse<ScimGroup>>;
```

#### `createGroup`

```typescript
createGroup(input: { organizationId: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimGroup>;
```

#### `getGroup`

```typescript
getGroup(input: { organizationId: string; externalScimId: string; connectionId?: string | null | undefined; excludeMembers?: boolean | undefined; }): Promise<ScimGroup>;
```

#### `replaceGroup`

```typescript
replaceGroup(input: { organizationId: string; externalScimId: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimGroup>;
```

#### `updateGroup`

```typescript
updateGroup(input: { organizationId: string; externalScimId: string; connectionId?: string | null | undefined; body: string; }): Promise<ScimGroup>;
```

#### `deleteGroup`

```typescript
deleteGroup(input: { organizationId: string; externalScimId: string; connectionId?: string | null | undefined; }): Promise<void>;
```

#### `receiveDirectoryDelivery`

One Auth0 delivery, admitted and then provisioned into the directory its credential names, never one the payload implies. Answered rather than thrown: the intake owns its bodies, including the 404 an install with no secret gives so a probe cannot learn the path is served.

```typescript
receiveDirectoryDelivery(delivery: { body: string; signature: string | null; authorization: string | null; }): Promise<ScimDeliveryReceipt>;
```

## REST transport

### `scimProtocolRest`

|             |                                           |
| ----------- | ----------------------------------------- |
| Declared at | `src/transport/scim-protocol.rest.ts:428` |
| Base URL    | `/api/scim/v2`                            |
| Addressing  | v1-in-path                                |
| Credential  | scim_token                                |

#### `GET /ServiceProviderConfig` · `scimGetServiceProviderConfig`

Get the SCIM service provider configuration

Public: SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists. Declared at `src/transport/scim-protocol.rest.ts:436`.

Answers at `/api/scim/v2/ServiceProviderConfig`.

```typescript
// Response: inline, src/transport/scim-protocol.rest.ts:438
type Response = unknown;
```

#### `GET /ResourceTypes` · `scimListResourceTypes`

List the SCIM resource types

Public: SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists. Declared at `src/transport/scim-protocol.rest.ts:453`.

Answers at `/api/scim/v2/ResourceTypes`.

```typescript
// Response: inline, src/transport/scim-protocol.rest.ts:455
type Response = unknown;
```

#### `GET /Schemas` · `scimListSchemas`

List the SCIM resource schemas

Public: SCIM discovery metadata is served without a credential so identity providers can negotiate capabilities before a token exists. Declared at `src/transport/scim-protocol.rest.ts:470`.

Answers at `/api/scim/v2/Schemas`.

```typescript
// Response: inline, src/transport/scim-protocol.rest.ts:472
type Response = unknown;
```

#### `GET /Users` · `scimListUsers`

List provisioned users

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:489`.

Answers at `/api/scim/v2/Users`.

```typescript
// Query: listQuery, src/transport/scim-protocol.rest.ts:173
interface Query {
  filter?: string;
  startIndex?: number;
  count?: number;
}
// Response: inline, src/transport/scim-protocol.rest.ts:493
type Response = unknown;
```

#### `POST /Users` · `scimCreateUser`

Provision a user

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:521`.

Answers at `/api/scim/v2/Users`.

```typescript
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:522)
// Response: inline, src/transport/scim-protocol.rest.ts:525
type Response = unknown;
```

#### `GET /Users/:id` · `scimGetUser`

Get a provisioned user

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:558`.

Answers at `/api/scim/v2/Users/:id`.

```typescript
// Params: idParams, src/transport/scim-protocol.rest.ts:137
interface Params {
  id: string;
}
// Response: inline, src/transport/scim-protocol.rest.ts:562
type Response = unknown;
```

#### `PUT /Users/:id` · `scimReplaceUser`

Replace a provisioned user

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:577`.

Answers at `/api/scim/v2/Users/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:579)
// Response: inline, src/transport/scim-protocol.rest.ts:582
type Response = unknown;
```

#### `PATCH /Users/:id` · `scimPatchUser`

Update a provisioned user

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:606`.

Answers at `/api/scim/v2/Users/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:608)
// Response: inline, src/transport/scim-protocol.rest.ts:611
type Response = unknown;
```

#### `DELETE /Users/:id` · `scimDeleteUser`

Deprovision a user

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:635`.

Answers at `/api/scim/v2/Users/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Response: inline, src/transport/scim-protocol.rest.ts:639
type Response = unknown;
```

#### `GET /Groups` · `scimListGroups`

List provisioned groups

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:658`.

Answers at `/api/scim/v2/Groups`.

```typescript
// Query: groupListQuery, src/transport/scim-protocol.rest.ts:197
interface Query {
  filter?: string;
  startIndex?: number;
  count?: number;
  excludedAttributes?: string;
}
// Response: inline, src/transport/scim-protocol.rest.ts:662
type Response = unknown;
```

#### `POST /Groups` · `scimCreateGroup`

Provision a group

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:691`.

Answers at `/api/scim/v2/Groups`.

```typescript
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:692)
// Response: inline, src/transport/scim-protocol.rest.ts:695
type Response = unknown;
```

#### `GET /Groups/:id` · `scimGetGroup`

Get a provisioned group

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:733`.

Answers at `/api/scim/v2/Groups/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Query: excludedAttributesQuery, src/transport/scim-protocol.rest.ts:191
interface Query {
  excludedAttributes?: string;
}
// Response: inline, src/transport/scim-protocol.rest.ts:738
type Response = unknown;
```

#### `PUT /Groups/:id` · `scimReplaceGroup`

Replace a provisioned group

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:761`.

Answers at `/api/scim/v2/Groups/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:763)
// Response: inline, src/transport/scim-protocol.rest.ts:766
type Response = unknown;
```

#### `PATCH /Groups/:id` · `scimPatchGroup`

Update a provisioned group

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:790`.

Answers at `/api/scim/v2/Groups/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Rawbody: "text" (inline, src/transport/scim-protocol.rest.ts:792)
// Response: inline, src/transport/scim-protocol.rest.ts:795
type Response = unknown;
```

#### `DELETE /Groups/:id` · `scimDeleteGroup`

Deprovision a group

Authenticated: a SCIM token carries no RBAC permission: the organization it was minted for, and whether that organization still holds the plan, are the whole of what the door decides. Declared at `src/transport/scim-protocol.rest.ts:819`.

Answers at `/api/scim/v2/Groups/:id`.

```typescript
type Params = z.infer<typeof idParams>; // src/transport/scim-protocol.rest.ts:137
// Response: inline, src/transport/scim-protocol.rest.ts:823
type Response = unknown;
```

### `scimTokenRest`

|             |                                                |
| ----------- | ---------------------------------------------- |
| Declared at | `src/transport/scim-token.rest.ts:42`          |
| Base URL    | `/api/scim-tokens`, twin `/api/v1/scim-tokens` |
| Addressing  | dated                                          |
| Credential  | organization                                   |
| Versions    | `2026-08-07`                                   |

#### `GET /` · `listScimTokens`

List the organization's SCIM bearer tokens: id, description, creation time and last use. Token values and hashes are never returned; the value exists only in the create response, once.

Permission `organization:manage`. Entitlement `enterprise` (feature `SCIM`). Declared at `src/transport/scim-token.rest.ts:47`.

Answers at `/api/scim-tokens`, `/api/v1/scim-tokens`; also, undocumented, `/api/scim-tokens/2026-08-07`, `/api/v1/scim-tokens/2026-08-07`, `/api/scim-tokens/latest`, `/api/v1/scim-tokens/latest`.

```typescript
// Response: inline, src/transport/scim-token.rest.ts:50
interface Response {
  tokens: {
    id: string;
    description: string | null;
    connectionId: string | null;
    createdAt: unknown;
    lastUsedAt: unknown | null;
  }[];
}
```

#### `POST /` · `createScimToken`

Mint a SCIM bearer token for this organization's /api/scim/v2 endpoints. The token value is returned once, here, and never again; store it in the identity provider immediately.

Permission `organization:manage`. Entitlement `enterprise` (feature `SCIM`). Declared at `src/transport/scim-token.rest.ts:60`.

Answers at `/api/scim-tokens`, `/api/v1/scim-tokens`; also, undocumented, `/api/scim-tokens/2026-08-07`, `/api/v1/scim-tokens/2026-08-07`, `/api/scim-tokens/latest`, `/api/v1/scim-tokens/latest`.

```typescript
// Body: scimTokenCreateRestInputSchema, ../contract/src/scim-token.rest.ts:20
interface Body {
  description?: string;
  connectionId?: string;
}
// Response: inline, src/transport/scim-token.rest.ts:65
interface Response {
  id: string;
  token: string;
  connectionId: string;
  description: string | null;
}
```

#### `DELETE /:id` · `revokeScimToken`

Revoke a SCIM token so it stops verifying immediately. An unknown or already-revoked id answers 404 scim_token_not_found.

Permission `organization:manage`. Entitlement `enterprise` (feature `SCIM`). Declared at `src/transport/scim-token.rest.ts:112`.

Answers at `/api/scim-tokens/:id`, `/api/v1/scim-tokens/:id`; also, undocumented, `/api/scim-tokens/2026-08-07/:id`, `/api/v1/scim-tokens/2026-08-07/:id`, `/api/scim-tokens/latest/:id`, `/api/v1/scim-tokens/latest/:id`.

```typescript
// Params: scimTokenIdParamsSchema, ../contract/src/scim-token.rest.ts:15
interface Params {
  id: string;
}
// Response: inline, src/transport/scim-token.rest.ts:116
interface Response {
  success: true;
}
```

### `scimWebhookRest`

|             |                                         |
| ----------- | --------------------------------------- |
| Declared at | `src/transport/scim-webhook.rest.ts:50` |
| Base URL    | none: each route's path is its address  |
| Addressing  | literal                                 |
| Credential  | project                                 |

#### `POST /api/webhooks/auth0-scim` · `receiveAuth0ScimWebhook`

Receive an Auth0 SCIM log-stream delivery

Public: the provider signs every delivery with the deployment secret and the route verifies it over the raw bytes, then reads the tenant off the SCIM token presented; no API credential opens this door. Declared at `src/transport/scim-webhook.rest.ts:55`.

Answers at `/api/webhooks/auth0-scim`.

```typescript
// Rawbody: "text" (inline, src/transport/scim-webhook.rest.ts:58)
// Response: inline, src/transport/scim-webhook.rest.ts:69
type Response = unknown;
```

## tRPC transport

### `scimOversight`

Contract `../contract/src/scim-oversight.trpc.ts:18`, router `src/transport/scim-oversight.trpc.ts:28`.

| Procedure                           | Kind     | Gate                                                                                                                                                  | Input                            | Output                            |
| ----------------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------- | --------------------------------- |
| `scimOversight.getAll`              | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `listOversightSyncsInputSchema`  | `oversightSyncListSchema`         |
| `scimOversight.getById`             | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `oversightConnectionInputSchema` | inline                            |
| `scimOversight.directoryIdentities` | query    | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `oversightConnectionInputSchema` | inline                            |
| `scimOversight.redriveRetiredApply` | mutation | No permission: admin surface gated on the platform-operator grant (ops:* at the platform tier), not on an org RBAC permission; cross-tenant by design | `redriveRetiredApplyInputSchema` | `redriveRetiredApplyResultSchema` |

```typescript
// scimOversight.getAll
// Input: listOversightSyncsInputSchema, ../contract/src/scim-oversight.ts:60
interface Input {
  page?: number;
  pageSize?: number;
  search?: string;
}
type Output = z.infer<typeof oversightSyncListSchema>; // ../contract/src/scim-oversight.ts:43

// scimOversight.getById
// Input: oversightConnectionInputSchema, ../contract/src/scim-oversight.ts:67
interface Input {
  connectionId: string;
}
// Output: oversightSyncSchema.nullable() (inline, ../contract/src/scim-oversight.trpc.ts:25)

// scimOversight.directoryIdentities
type Input = z.infer<typeof oversightConnectionInputSchema>; // ../contract/src/scim-oversight.ts:67
// Output: inline, ../contract/src/scim-oversight.trpc.ts:29
type Output = {
  connectionId: string;
  externalId: string;
  userId: string;
  createdAtMs: number;
  updatedAtMs: number;
}[];

// scimOversight.redriveRetiredApply
// Input: redriveRetiredApplyInputSchema, ../contract/src/scim-oversight.ts:70
interface Input {
  connectionId: string;
  retiredAtMs: number;
}
// Output: redriveRetiredApplyResultSchema, ../contract/src/scim-oversight.ts:77
interface Output {
  applied: boolean;
}
```

### `scimReconciliation`

Contract `../contract/src/scim-reconciliation.trpc.ts:20`, router `src/transport/scim-reconciliation.trpc.ts:20`.

| Procedure                        | Kind  | Gate                                                             | Input                               | Output                             |
| -------------------------------- | ----- | ---------------------------------------------------------------- | ----------------------------------- | ---------------------------------- |
| `scimReconciliation.getAll`      | query | Permission `sso:view`; Entitlement `enterprise` (feature `SCIM`) | `scimReconciliationScopeSchema`     | `organizationReconciliationSchema` |
| `scimReconciliation.getActivity` | query | Permission `sso:view`; Entitlement `enterprise` (feature `SCIM`) | `scimConnectionRequestsInputSchema` | inline                             |
| `scimReconciliation.getRequests` | query | Permission `sso:view`                                            | `scimConnectionRequestsInputSchema` | inline                             |
| `scimReconciliation.getById`     | query | Permission `sso:view`; Entitlement `enterprise` (feature `SCIM`) | `scimConnectionRequestsInputSchema` | inline                             |

```typescript
// scimReconciliation.getAll
// Input: scimReconciliationScopeSchema, ../contract/src/scim-reconciliation.ts:99
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof organizationReconciliationSchema>; // ../contract/src/scim-reconciliation.ts:69

// scimReconciliation.getActivity
// Input: scimConnectionRequestsInputSchema, ../contract/src/scim-request-log.ts:73
interface Input {
  organizationId: string;
  connectionId: string;
}
// Output: inline, ../contract/src/scim-reconciliation.trpc.ts:35
type Output = {
  eventId: string;
  summary: string;
  occurredAtMs: number;
  outcome: "ok" | "refused";
}[];

// scimReconciliation.getRequests
type Input = z.infer<typeof scimConnectionRequestsInputSchema>; // ../contract/src/scim-request-log.ts:73
// Output: inline, ../contract/src/scim-reconciliation.trpc.ts:45
type Output = {
  method: string;
  resource: string;
  status: number;
  reason: "plan_not_entitled" | "forbidden" | "unauthorized" | "malformed_body" | "invalid_resource" | "not_found" | "conflict" | "rate_limited" | "unsupported" | "internal_error" | null;
  detail: string | null;
  id: string;
  occurredAt: unknown;
}[];

// scimReconciliation.getById
type Input = z.infer<typeof scimConnectionRequestsInputSchema>; // ../contract/src/scim-request-log.ts:73
// Output: connectionReconciliationSchema.nullable() (inline, ../contract/src/scim-reconciliation.trpc.ts:49)
```

### `scimToken`

Contract `../contract/src/scim-token.trpc.ts:19`, router `src/transport/scim-token.trpc.ts:21`.

| Procedure               | Kind     | Gate                                                               | Input                     | Output                   |
| ----------------------- | -------- | ------------------------------------------------------------------ | ------------------------- | ------------------------ |
| `scimToken.list`        | query    | Permission `sso:view`; Entitlement `enterprise` (feature `SCIM`)   | `scimTokenScopeSchema`    | inline                   |
| `scimToken.connections` | query    | Permission `sso:view`                                              | `scimTokenScopeSchema`    | inline                   |
| `scimToken.generate`    | mutation | Permission `sso:manage`; Entitlement `enterprise` (feature `SCIM`) | `generateScimTokenSchema` | `issuedScimTokenSchema`  |
| `scimToken.revoke`      | mutation | Permission `sso:manage`; Entitlement `enterprise` (feature `SCIM`) | `revokeScimTokenSchema`   | `scimTokenRevokedSchema` |

```typescript
// scimToken.list
// Input: scimTokenScopeSchema, ../contract/src/scim-token.ts:39
interface Input {
  organizationId: string;
}
// Output: inline, ../contract/src/scim-token.trpc.ts:23
type Output = {
  id: string;
  connectionId: string | null;
  description: string | null;
  createdAt: unknown;
  lastUsedAt: unknown | null;
}[];

// scimToken.connections
type Input = z.infer<typeof scimTokenScopeSchema>; // ../contract/src/scim-token.ts:39
// Output: inline, ../contract/src/scim-token.trpc.ts:28
type Output = {
  connectionId: string;
  displayName: string;
  type: string;
  state: string;
}[];

// scimToken.generate
// Input: generateScimTokenSchema, ../contract/src/scim-token.ts:64
interface Input {
  organizationId: string;
  description?: string;
  connectionId?: string;
  secret?: string;
}
// Output: issuedScimTokenSchema, ../contract/src/scim-token.ts:29
interface Output {
  token: string;
  tokenId: string;
  connectionId: string;
}

// scimToken.revoke
// Input: revokeScimTokenSchema, ../contract/src/scim-token.ts:73
interface Input {
  organizationId: string;
  tokenId: string;
}
// Output: scimTokenRevokedSchema, ../contract/src/scim-token.ts:36
interface Output {
  success: true;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `scim_cost_center` (aggregate `scim_member`)

Declared at `src/eventing/scim-cost-center.pipeline.ts:20`. Events: `scimCostCenterChangedEventSchema`.

| Kind    | Name                      | Handles | Declared at                                    |
| ------- | ------------------------- | ------- | ---------------------------------------------- |
| command | `recordCostCenterChanged` | –       | `src/eventing/scim-cost-center.pipeline.ts:25` |

### Pipeline `scim_directory` (aggregate `scim_directory_move`)

Declared at `src/eventing/scim-directory.pipeline.ts:21`. Events: `scimDirectoryMoveRequestedEventSchema`.

| Kind    | Name                   | Handles | Declared at                                  |
| ------- | ---------------------- | ------- | -------------------------------------------- |
| command | `requestDirectoryMove` | –       | `src/eventing/scim-directory.pipeline.ts:26` |

### Pipeline `scim_sso_connections` (aggregate `scim_sso_connection_view`)

Declared at `src/eventing/scim-sso-connection.pipeline.ts:21`.

| Kind                 | Name                                 | Handles | Declared at                                       |
| -------------------- | ------------------------------------ | ------- | ------------------------------------------------- |
| peer fold projection | `≈ scimSsoConnectionPeerFold(store)` | –       | `src/eventing/scim-sso-connection.pipeline.ts:26` |

### Pipeline `scim-sync` (aggregate `scim_sync`)

Declared at `src/eventing/scim-sync.pipeline.ts:50`. Events: `scimTokenIssuedEventSchema`, `scimUserPushedEventSchema`, `scimGroupMappedEventSchema`, `scimApplyFailedEventSchema`, `scimApplyRecoveredEventSchema`, `scimApplyRetiredEventSchema`, `scimApplyRedrivenEventSchema`, `scimTokenRevokedEventSchema`.

| Kind                | Name                                                                          | Handles | Declared at                             |
| ------------------- | ----------------------------------------------------------------------------- | ------- | --------------------------------------- |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:71` |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:76` |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:81` |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:86` |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:91` |
| command             | –                                                                             | –       | `src/eventing/scim-sync.pipeline.ts:96` |
| Postgres projection | `≈ new ScimSyncStateFoldProjection({ store: deps.scimSyncProjectionStore, })` | –       | `src/eventing/scim-sync.pipeline.ts:66` |

### Pipeline `scim_maintenance` (aggregate `global`)

Declared at `src/eventing/scim.pipeline.ts:39`.

| Kind            | Name                      | Handles                                                                                             | Declared at                        |
| --------------- | ------------------------- | --------------------------------------------------------------------------------------------------- | ---------------------------------- |
| process manager | `scimRequestLogRetention` | every 6 h (`SCIM_REQUEST_LOG_RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000`); intents `sweep` (outbox) | `src/eventing/scim.pipeline.ts:44` |

## Configuration

| Kind   | Leaf                  | Environment variable          | Declared at                               |
| ------ | --------------------- | ----------------------------- | ----------------------------------------- |
| secret | `auth0WebhookSecret`  | `AUTH0_SCIM_WEBHOOK_SECRET`   | `../contract/src/scim.config.ts:13`       |
| secret | `tokenPepper`         | `CREDENTIALS_SECRET`          | `../contract/src/scim-token-pepper.ts:10` |
| secret | `tokenPepperFallback` | `NEXTAUTH_SECRET`             | `../contract/src/scim-token-pepper.ts:11` |
| secret | `tokenPepperPrevious` | `CREDENTIALS_SECRET_PREVIOUS` | `../contract/src/scim-token-pepper.ts:13` |
| config | `provenOffboarding`   | `SCIM_V2_GRANTS`              | `../contract/src/scim.config.ts:6`        |

<!-- readme:generated:end -->
