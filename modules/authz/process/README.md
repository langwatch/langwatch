# @langwatch/authz-process

The server implementation of the portable
[`@langwatch/authz-contract`](../contract/README.md). It owns the concrete
decision and grant services, private repository ports, Prisma-compatible
adapters, Eventing pipeline and projection, Redis epoch adapter, audit
subscriber, and the legacy-import system migration.

The package exports `authzProcessModule`, its installer. A process installs it
like any other module: the container builds the authz repository registry (the
`live` tier over Postgres and Redis, the `memory` tier over one in-process
store) and `AuthzModule.create` composes the decision service, the grants
service, the ledger, the Eventing pipeline and the legacy-import migration from
those rows.

`AuthzService` and `AuthzGrantsService` are the only domain capabilities.
Collectors, repositories, routing gates, caches, ledgers and projections are
implementation collaborators, not additional services for application code to
construct.

The package reads no environment variables and imports no application source.
Its stores reach it only through its repository registry, and its cache policy
and demo project through its declared config. Importing the package registers
no pipeline, subscriber or migration.

Only an application runtime composition root imports this package. Ordinary
server, transport and browser code depends on `@langwatch/authz-contract` and
receives the two service capabilities through its runtime context.

The package preserves the existing `authz_grant` Eventing wire constants,
grant/role aggregate identities, projection rows and `authz-engine` system
migration identity. Audit subscriber writes are insert-only and idempotent by
source-event identity; the tenant comes from the Eventing envelope rather than
the grant or role aggregate ID.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("authz").withRepositories(authzRepositories).withApi(AuthzModule).withTransports(authzGrantRest, authzRoleBindingRest, authzTrpcTransport).provideMiddlewareContext(…).withEventing(authzEventing).withEventing(authzAggregateReadEventing).withEventing(authzMemberOffboardedEventing)`, `src/authz.module.ts:29`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`AuthzApi`)

The complete callable authorization boundary. This is deliberately a structural interface: callers can use an installed AuthzModule without receiving its services, repositories, or transport adapters.

Peers call these through the token, declared at `../contract/src/authz.api.ts:49`; nothing else in this package is public.

#### `isDemoProject`

Whether this is the configured shared demo project.

```typescript
isDemoProject(input: { projectId: string }): boolean;
```

#### `demoProject`

The shared demo project's identity. `DEMO_PROJECT_ID`/`DEMO_PROJECT_USER_ID` have one owner, this module; a peer asks rather than redeclaring them. Blank fields mean the deployment configured no demo project.

```typescript
demoProject(): Readonly<{ projectId: string; userId: string }>;
```

#### `effectivePermissionsFor`

```typescript
effectivePermissionsFor(input: Readonly<{ projectId?: string; organizationId?: string }>, by: AuthzCaller): Promise<EffectivePermissions>;
```

#### `check`

```typescript
check(args: Queries.AuthzCheckInput): Promise<AuthzDecision>;
```

#### `checkDetailed`

```typescript
checkDetailed(args: Queries.AuthzCheckInput): Promise<Queries.AuthzCheckDetailedOutput>;
```

#### `can`

```typescript
can(args: Queries.AuthzCanInput): Promise<boolean>;
```

#### `authorize`

With `proof` on a project scope, also mints the sealed `Authorization` its reads carry (ADR-166, ADR-177 block B); `authorization` is null everywhere else.

```typescript
authorize(args: { principal: AuthzPrincipalRef; permission: Permission; scope: Extract<AuthzScopeRef, { type: Tier }>; proof?: Readonly<{ actor: Actor; purpose: AuthorizationPurpose }>; }): Promise<Authorized<Tier, Permission> & Readonly<{ authorization: Authorization | null }>>;
```

#### `authorizeInternal`

The own-only proof platform code reads its own project with (ADR-177); evaluates nothing.

```typescript
authorizeInternal(args: { actor: Extract<Actor, { type: "internal" | "system" }>; projectId: string; permission: AuthzPermission; purpose: AuthorizationPurpose; }): Promise<Authorization>;
```

#### `effectivePermissions`

```typescript
effectivePermissions(args: Queries.AuthzEffectivePermissionsInput): Promise<Queries.AuthzEffectivePermissionsOutput>;
```

#### `checkByIds`

```typescript
checkByIds(args: Queries.AuthzCheckByIdsInput): Promise<Queries.AuthzCheckByIdsOutput>;
```

#### `canAnyByIds`

```typescript
canAnyByIds(args: Queries.AuthzCanAnyByIdsInput): Promise<Queries.AuthzCanAnyByIdsOutput>;
```

#### `canBatchByIds`

```typescript
canBatchByIds(args: Queries.AuthzCanBatchByIdsInput): Promise<Queries.AuthzCanBatchByIdsOutput>;
```

#### `canBatchPermissionsByIds`

```typescript
canBatchPermissionsByIds(args: Queries.AuthzCanBatchPermissionsByIdsInput): Promise<Queries.AuthzCanBatchPermissionsByIdsOutput>;
```

#### `getScope`

Throws `AuthzScopeNotFoundError` when no id names a live scope.

```typescript
getScope(args: Queries.AuthzResolveScopeInput): Promise<AuthzScopeRef>;
```

#### `checkScopeLineage`

```typescript
checkScopeLineage(args: AuthzScopeLineageInput): Promise<AuthzScopeLineageResult>;
```

#### `explainDecision`

```typescript
explainDecision(args: Queries.AuthzExplainDecisionInput): Promise<Queries.AuthzExplainDecisionOutput>;
```

#### `getDecision`

```typescript
getDecision(args: AuthzGetDecisionInput): Promise<PermissionDecision>;
```

#### `getProjectAnyDecision`

```typescript
getProjectAnyDecision(args: AuthzGetProjectAnyDecisionInput): Promise<PermissionDecision>;
```

#### `hasPermission`

```typescript
hasPermission(check: { userId: string; permission: Permission; } & PermissionScopeArg<Permission>): Promise<boolean>;
```

#### `authorizePermission`

```typescript
authorizePermission(check: { userId: string; permission: Permission } & ScopeArg): Promise<Authorized<TierOfScopeArg<ScopeArg>, Permission>>;
```

#### `authorizeProjectPermission`

```typescript
authorizeProjectPermission(args: Queries.AuthzRequireProjectPermissionInput): Promise<void>;
```

#### `hasApiKeyPermission`

```typescript
hasApiKeyPermission(args: Queries.ApiKeyPermissionCheck): Promise<boolean>;
```

#### `getApiKeyProjectDecision`

```typescript
getApiKeyProjectDecision(args: Queries.AuthzGetApiKeyProjectDecisionInput): Promise<Queries.ApiKeyProjectDecision>;
```

#### `listUserBindings`

```typescript
listUserBindings(args: Queries.AuthzListUserBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listOrganizationBindings`

```typescript
listOrganizationBindings(args: Queries.AuthzListOrganizationBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listUserAndGroupBindings`

```typescript
listUserAndGroupBindings(args: Queries.AuthzListUserAndGroupBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listScopeBindings`

```typescript
listScopeBindings(args: Queries.AuthzListScopeBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listGroupBindings`

```typescript
listGroupBindings(args: Queries.AuthzListGroupBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listApiKeyBindings`

The grants each of these keys holds, read off the grants head.

```typescript
listApiKeyBindings(args: Queries.AuthzListApiKeyBindingsInput): Promise<Queries.AuthzAccessBindingsOutput>;
```

#### `listTeamMemberBindings`

```typescript
listTeamMemberBindings(args: Queries.AuthzListTeamMemberBindingsInput): Promise<Map<string, Queries.AuthzTeamMemberBinding[]>>;
```

#### `listBindingsForSynthesis`

```typescript
listBindingsForSynthesis(args: Queries.AuthzListBindingsForSynthesisInput): Promise<Queries.AuthzBindingForSynthesis[]>;
```

#### `listUserCreatedRoles`

```typescript
listUserCreatedRoles(args: Queries.AuthzListOrganizationBindingsInput): Promise<Queries.AuthzCustomRole[]>;
```

#### `findRolePermissions`

The permission sets of these roles in this organization, whatever their kind.

```typescript
findRolePermissions(args: Queries.AuthzFindRolePermissionsInput): Promise<Queries.AuthzRolePermissions[]>;
```

#### `wouldFirstBindingDisableLegacyAccess`

```typescript
wouldFirstBindingDisableLegacyAccess(args: Binding.AuthzLegacyAccessNoticeInput): Promise<boolean>;
```

#### `listManagedBindingsForUser`

```typescript
listManagedBindingsForUser(args: Binding.AuthzListManagedBindingsForUserInput): Promise<Binding.AuthzListManagedBindingsForUserOutput>;
```

#### `listManagedBindingsForOrganization`

```typescript
listManagedBindingsForOrganization(args: Binding.AuthzListManagedBindingsForOrganizationInput): Promise<Binding.AuthzListManagedBindingsForOrganizationOutput>;
```

#### `getAccessBreakdown`

```typescript
getAccessBreakdown(args: Binding.AuthzAccessBreakdownInput): Promise<Binding.AuthzAccessBreakdownOutput>;
```

#### `isOnEngine`

```typescript
isOnEngine(args: Queries.AuthzListOrganizationBindingsInput): Promise<boolean>;
```

#### `findEngineCutoverAt`

```typescript
findEngineCutoverAt(args: Queries.AuthzListOrganizationBindingsInput): Promise<Instant | null>;
```

#### `findActiveOrganizationAdministrators`

User ids holding organisation role ADMIN on a seat not disabled; empty for an unknown one.

```typescript
findActiveOrganizationAdministrators(args: Queries.AuthzFindActiveOrganizationAdministratorsInput): Promise<Queries.AuthzActiveOrganizationAdministrators>;
```

#### `getSessionVersion`

The caller's session version (ADR-170): 0 until first bumped; throws when unreadable.

```typescript
getSessionVersion(input: { userId: string }): Promise<number>;
```

#### `revoke`

```typescript
revoke(args: Commands.AuthzRevokeGrantInput): Promise<void>;
```

#### `offboard`

```typescript
offboard(args: Commands.AuthzOffboardInput): Promise<Commands.AuthzOffboardOutput>;
```

#### `invalidateOrganization`

```typescript
invalidateOrganization(args: { organizationId: string }): Promise<void>;
```

#### `attachBindings`

```typescript
attachBindings(args: Commands.AuthzAttachBindingsInput): Promise<Commands.AuthzAttachBindingsOutput>;
```

#### `attachResourceGrant`

```typescript
attachResourceGrant(args: Commands.AuthzAttachResourceGrantInput): Promise<Commands.AuthzAttachResourceGrantOutput>;
```

#### `revokeResourceGrants`

```typescript
revokeResourceGrants(args: Commands.AuthzRevokeResourceGrantsInput): Promise<Commands.AuthzRevokeResourceGrantsOutput>;
```

#### `findLiveSharedProjectGrants`

The live shared reads (ADR-177) one reader project holds, one per member project.

```typescript
findLiveSharedProjectGrants(args: Commands.AuthzFindLiveSharedProjectGrantsInput): Promise<Commands.AuthzSharedProjectGrant[]>;
```

#### `attachSharedProjectGrant`

A `project-reader` grant from reader to member carrying `condition`; idempotent per pair.

```typescript
attachSharedProjectGrant(args: Commands.AuthzAttachSharedProjectGrantInput): Promise<Commands.AuthzAttachSharedProjectGrantOutput>;
```

#### `awaitSharedProjectGrants`

One read-your-writes wait for shared reads attached with `awaitProjection: false`.

```typescript
awaitSharedProjectGrants(args: Commands.AuthzAwaitSharedProjectGrantsInput): Promise<void>;
```

#### `revokeSharedProjectGrants`

Revokes a reader's live shared reads (all, or those on `memberProjectIds`); answers ids.

```typescript
revokeSharedProjectGrants(args: Commands.AuthzRevokeSharedProjectGrantsInput): Promise<string[]>;
```

#### `changeBindingRole`

```typescript
changeBindingRole(args: Commands.AuthzChangeBindingRoleInput): Promise<Commands.AuthzChangeBindingRoleOutput>;
```

#### `revokeBindings`

```typescript
revokeBindings(args: Commands.AuthzRevokeBindingsInput): Promise<Commands.AuthzRevokeBindingsOutput>;
```

#### `revokeBindingsWhere`

```typescript
revokeBindingsWhere(args: Commands.AuthzRevokeBindingsWhereInput): Promise<Commands.AuthzRevokeBindingsWhereOutput>;
```

#### `retireDirectoryGrants`

Retires the grants the directory itself wrote at the organization scope for these people, leaving an administrator's own grant at the same scope where it is. Answers how many it retired.

```typescript
retireDirectoryGrants(args: Commands.AuthzRetireDirectoryGrantsInput): Promise<Commands.AuthzRetireDirectoryGrantsOutput>;
```

#### `findDirectoryCausedChanges`

What the directory has attached and removed lately, newest first — the grant side of a reconciliation view. Authz owns these rows; a peer asks.

```typescript
findDirectoryCausedChanges(args: Commands.AuthzDirectoryCausedChangesInput): Promise<Commands.AuthzDirectoryCausedChangesOutput>;
```

#### `offboardMember`

```typescript
offboardMember(args: Commands.AuthzOffboardMemberInput): Promise<Commands.AuthzOffboardMemberOutput>;
```

#### `defineRole`

```typescript
defineRole(args: Commands.AuthzDefineRoleInput): Promise<Commands.AuthzDefineRoleOutput>;
```

#### `deleteRole`

```typescript
deleteRole(args: Commands.AuthzDeleteRoleInput): Promise<Commands.AuthzDeleteRoleOutput>;
```

#### `createBinding`

```typescript
createBinding(args: Binding.AuthzCreateBindingInput): Promise<Binding.AuthzCreateBindingOutput>;
```

#### `updateBinding`

```typescript
updateBinding(args: Binding.AuthzUpdateBindingInput): Promise<Binding.AuthzCreateBindingOutput>;
```

#### `updateRoleBinding`

`PATCH /role-bindings/:id`: the update, read back as the list reports it.

```typescript
updateRoleBinding(args: Binding.AuthzUpdateBindingInput): Promise<RoleBindingRest>;
```

#### `deleteBinding`

```typescript
deleteBinding(args: Binding.AuthzDeleteBindingInput): Promise<Binding.AuthzBindingMutationSuccess>;
```

#### `listGrants`

`GET /api/grants`: filtered, one cursor page at a time.

```typescript
listGrants(args: Grants.AuthzListGrantsInput): Promise<Grants.GrantPage>;
```

#### `getGrant`

One grant; another organization's id is `grant_not_found`.

```typescript
getGrant(args: Grants.AuthzGetGrantInput): Promise<Grants.Grant>;
```

#### `createGrant`

Grants a role, never beyond what the caller holds at that scope.

```typescript
createGrant(args: Grants.AuthzCreateGrantInput): Promise<Grants.Grant>;
```

#### `changeGrantRole`

Changes only the role, under the same ceiling as a create.

```typescript
changeGrantRole(args: Grants.AuthzChangeGrantRoleInput): Promise<Grants.Grant>;
```

#### `revokeGrant`

```typescript
revokeGrant(args: Grants.AuthzRevokeGrantByIdInput): Promise<Grants.GrantRevoked>;
```

#### `grantPlatformOperator`

Grants platform-operator to a user: by an ops:manage holder, never to yourself.

```typescript
grantPlatformOperator(args: Platform.AuthzGrantPlatformOperatorInput): Promise<Platform.PlatformOperator>;
```

#### `revokePlatformOperator`

Revokes one platform-operator grant; never the last, unless user erasure asks as `system`.

```typescript
revokePlatformOperator(args: Platform.AuthzRevokePlatformOperatorInput): Promise<void>;
```

#### `listPlatformOperators`

Every live platform operator, oldest first.

```typescript
listPlatformOperators(): Promise<Platform.AuthzListPlatformOperatorsOutput>;
```

#### `findPermissionsBeyondCaller`

The escalation rule every door shares: what of these the caller lacks at that scope.

```typescript
findPermissionsBeyondCaller(args: Grants.AuthzFindPermissionsBeyondCallerInput): Promise<string[]>;
```

#### `applyMemberBindings`

```typescript
applyMemberBindings(args: Binding.AuthzApplyMemberBindingsInput): Promise<Binding.AuthzBindingMutationSuccess>;
```

#### `readPendingAdmission`

Where this membership's automatic admission stands. The marker is minted with the membership row so a process that stopped before the grant landed still has a retry signal; the state is read off the ledger.

```typescript
readPendingAdmission(args: AuthzAdmissionScope): Promise<AuthzPendingAdmissionRead>;
```

#### `completeAdmission`

Clears the marker once the grant is confirmed. False means it no longer applied.

```typescript
completeAdmission(args: AuthzResolveAdmissionInput): Promise<boolean>;
```

#### `clearPendingAdmission`

Clears a revoked marker without treating the admission as successful.

```typescript
clearPendingAdmission(args: AuthzResolveAdmissionInput): Promise<boolean>;
```

#### `hasProjectPermission`

```typescript
hasProjectPermission(input: { userId: string; projectId: string; permission: AuthzPermission; }): Promise<boolean>;
```

#### `deriveGrantId`

Deterministic grant id to deduplicate replays and prevent drift from reimplementation across modules (ADR-092 s13).

```typescript
deriveGrantId(input: { organizationId: string; principal: authzGrantEventsModule.LedgerPrincipal; scope: authzGrantEventsModule.LedgerScope; resourceToken?: string; occurredAtMs: number; }): string;
```

#### `registeredMigrations`

The ORGANIZATION-rooted migrations authz registers (the grant import), as main named it.

```typescript
registeredMigrations(): readonly SystemMigration[];
```

## REST transport

### `authzGrantRest`

|             |                                        |
| ----------- | -------------------------------------- |
| Declared at | `src/transport/authz-grant.rest.ts:36` |
| Base URL    | `/api/grants`, twin `/api/v1/grants`   |
| Addressing  | dated                                  |
| Credential  | organization                           |
| Versions    | `2026-08-07`                           |

#### `GET /` · `listGrants`

List grants

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:41`.

Answers at `/api/grants`, `/api/v1/grants`; also, undocumented, `/api/grants/2026-08-07`, `/api/v1/grants/2026-08-07`, `/api/grants/latest`, `/api/v1/grants/latest`.

```typescript
// Query: grantListQuerySchema, ../contract/src/authz-grants-rest.schemas.ts:85
interface Query {
  principalType?: "user" | "group" | "apiKey";
  principalId?: string;
  roleId?: string;
  scopeType?: "organization" | "team" | "project";
  scopeId?: string;
  status?: "active" | "expired";
  limit?: number;
  cursor?: string;
  order?: "newest" | "oldest";
}
type Response = z.infer<typeof grantPageSchema>; // ../contract/src/authz-grants-rest.schemas.ts:100
```

#### `POST /` · `createGrant`

Grant a role

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:57`.

Answers at `/api/grants`, `/api/v1/grants`; also, undocumented, `/api/grants/2026-08-07`, `/api/v1/grants/2026-08-07`, `/api/grants/latest`, `/api/v1/grants/latest`.

```typescript
// Body: grantCreateSchema, ../contract/src/authz-grants-rest.schemas.ts:64
interface Body {
  principal: {
    type: "user" | "group" | "apiKey";
    id: string;
  };
  roleId: string;
  scope: {
    type: "organization" | "team" | "project";
    id: string;
  };
  expiresAt?: unknown;
}
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:47
```

#### `GET /:grantId` · `getGrant`

Get a grant

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:79`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
// Params: grantParamsSchema, ../contract/src/authz-grants-rest.schemas.ts:107
interface Params {
  grantId: string;
}
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:47
```

#### `PATCH /:grantId` · `updateGrant`

Change a grant's role

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:95`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
type Params = z.infer<typeof grantParamsSchema>; // ../contract/src/authz-grants-rest.schemas.ts:107
// Body: grantUpdateSchema, ../contract/src/authz-grants-rest.schemas.ts:76
interface Body {
  roleId: string;
}
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:47
```

#### `DELETE /:grantId` · `revokeGrant`

Revoke a grant

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:117`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
type Params = z.infer<typeof grantParamsSchema>; // ../contract/src/authz-grants-rest.schemas.ts:107
// Response: grantRevokedSchema, ../contract/src/authz-grants-rest.schemas.ts:110
interface Response {
  id: string;
  revoked: true;
}
```

### `authzRoleBindingRest`

|             |                                                    |
| ----------- | -------------------------------------------------- |
| Declared at | `src/transport/authz-role-binding.rest.ts:66`      |
| Base URL    | `/api/role-bindings`, twin `/api/v1/role-bindings` |
| Addressing  | dated                                              |
| Credential  | organization                                       |
| Versions    | `2026-08-07`                                       |
| Deprecated  | yes                                                |

#### `GET /` · `listRoleBindings`

List the organization's role bindings, each naming its principal (user, group or API key), role, scope, and the date its access ends if one was set. Filter by principal or scope; totalCount counts the filtered set.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:78`.

Answers at `/api/role-bindings`, `/api/v1/role-bindings`; also, undocumented, `/api/role-bindings/2026-08-07`, `/api/v1/role-bindings/2026-08-07`, `/api/role-bindings/latest`, `/api/v1/role-bindings/latest`.

```typescript
// Query: roleBindingRestListQuerySchema, ../contract/src/authz-rest.schemas.ts:32
interface Query {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
  scopeType?: "PROJECT" | "TEAM" | "ORGANIZATION";
  scopeId?: string;
  offset?: number;
  limit?: number;
}
type Response = z.infer<typeof roleBindingRestListSchema>; // ../contract/src/authz-rest.schemas.ts:43
```

#### `POST /` · `createRoleBinding`

Create a role binding for exactly one principal: a user, a group, or an API key. Every reference is checked against the caller's organization; an identical binding is written again, because bindings are never unique. Pass expiresAt to time-box the access: it stops granting at that moment on its own, without being revoked, and a date that has already passed answers 422 grant_expiry_in_past. The response always carries the new binding's id; the names of its principal, role and scope may be absent on this response alone, and a follow-up read carries them.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:103`.

Answers at `/api/role-bindings`, `/api/v1/role-bindings`; also, undocumented, `/api/role-bindings/2026-08-07`, `/api/v1/role-bindings/2026-08-07`, `/api/role-bindings/latest`, `/api/v1/role-bindings/latest`.

```typescript
// Body: roleBindingRestCreateSchema, ../contract/src/authz-rest.schemas.ts:49
interface Body {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string;
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION";
  scopeId: string;
  expiresAt?: unknown;
}
type Response = z.infer<typeof roleBindingRestSchema>; // ../contract/src/authz-rest.schemas.ts:17
```

#### `PATCH /:id` · `updateRoleBinding`

Change a binding's role (and custom role). The principal and scope are the binding's identity and do not change; create a new binding instead.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:146`.

Answers at `/api/role-bindings/:id`, `/api/v1/role-bindings/:id`; also, undocumented, `/api/role-bindings/2026-08-07/:id`, `/api/v1/role-bindings/2026-08-07/:id`, `/api/role-bindings/latest/:id`, `/api/v1/role-bindings/latest/:id`.

```typescript
// Params: roleBindingRestParamsSchema, ../contract/src/authz-rest.schemas.ts:69
interface Params {
  id: string;
}
// Body: roleBindingRestUpdateSchema, ../contract/src/authz-rest.schemas.ts:63
interface Body {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string;
}
type Response = z.infer<typeof roleBindingRestSchema>; // ../contract/src/authz-rest.schemas.ts:17
```

#### `DELETE /:id` · `deleteRoleBinding`

Delete a role binding. An id that does not exist in the caller's organization answers 404 role_binding_not_found.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:170`.

Answers at `/api/role-bindings/:id`, `/api/v1/role-bindings/:id`; also, undocumented, `/api/role-bindings/2026-08-07/:id`, `/api/v1/role-bindings/2026-08-07/:id`, `/api/role-bindings/latest/:id`, `/api/v1/role-bindings/latest/:id`.

```typescript
type Params = z.infer<typeof roleBindingRestParamsSchema>; // ../contract/src/authz-rest.schemas.ts:69
// Response: roleBindingRestDeletedSchema, ../contract/src/authz-rest.schemas.ts:72
interface Response {
  success: true;
}
```

## tRPC transport

### `authz`

Contract `src/transport/authz.trpc.ts:30`, router `src/transport/authz.trpc.ts:81`.

| Procedure                    | Kind     | Gate                                                                                                                                                                       | Input                                                | Output                                                |
| ---------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `authz.effectivePermissions` | query    | Service-authorized: resolves the caller's OWN effective permissions at the project or organization scope named; a non-member resolves to the empty set (no default access) | `authzOwnStandingInputSchema`                        | `authzOwnStandingSchema`                              |
| `authz.listGrants`           | query    | Permission `organization:manage`                                                                                                                                           | `authzListGrantsInputSchema`                         | `grantPageSchema`                                     |
| `authz.createGrant`          | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `grantSchema`                                         |
| `authz.changeGrantRole`      | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `grantSchema`                                         |
| `authz.revokeGrant`          | mutation | Permission `organization:manage`                                                                                                                                           | inline                                               | `grantRevokedSchema`                                  |
| `authz.listManagedGrants`    | query    | Permission `organization:manage`                                                                                                                                           | `authzListManagedBindingsForOrganizationInputSchema` | `authzListManagedBindingsForOrganizationOutputSchema` |
| `authz.listMemberGrants`     | query    | Permission `organization:manage`                                                                                                                                           | `authzListManagedBindingsForUserInputSchema`         | `authzListManagedBindingsForUserOutputSchema`         |
| `authz.applyMemberGrants`    | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `authzBindingMutationSuccessSchema`                   |

```typescript
// authz.effectivePermissions
// Input: authzOwnStandingInputSchema, ../contract/src/authz.queries.ts:444
interface Input {
  projectId?: string;
  organizationId?: string;
}
// Output: authzOwnStandingSchema, ../contract/src/authz.queries.ts:431
interface Output {
  scope: {
    type: "project" | "team" | "organization" | "resource";
    id: string;
  } | null;
  permissions: string[];
}

// authz.listGrants
type Input = z.infer<typeof authzListGrantsInputSchema>; // ../contract/src/authz-grants-rest.schemas.ts:115
type Output = z.infer<typeof grantPageSchema>; // ../contract/src/authz-grants-rest.schemas.ts:100

// authz.createGrant
// Input: authzCreateGrantInputSchema.omit(IMPLIED_BY_SESSION) (inline, src/transport/authz.trpc.ts:40)
type Output = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:47

// authz.changeGrantRole
// Input: inline, src/transport/authz.trpc.ts:44
interface Input {
  organizationId: string;
  grantId: string;
  roleId: string;
}
type Output = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:47

// authz.revokeGrant
// Input: inline, src/transport/authz.trpc.ts:48
interface Input {
  organizationId: string;
  grantId: string;
}
type Output = z.infer<typeof grantRevokedSchema>; // ../contract/src/authz-grants-rest.schemas.ts:110

// authz.listManagedGrants
// Input: authzListManagedBindingsForOrganizationInputSchema, ../contract/src/authz.grant-management.ts:48
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof authzListManagedBindingsForOrganizationOutputSchema>; // ../contract/src/authz.grant-management.ts:81

// authz.listMemberGrants
// Input: authzListManagedBindingsForUserInputSchema, ../contract/src/authz.grant-management.ts:21
interface Input {
  organizationId: string;
  userId: string;
}
// Output: authzListManagedBindingsForUserOutputSchema, ../contract/src/authz.grant-management.ts:43
type Output = {
  id: string;
  userId: string | null;
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: "PROJECT" | "TEAM" | "ORGANIZATION";
  scopeId: string;
  scopeName: string | null;
  createdAt: unknown;
}[];

// authz.applyMemberGrants
// Input: inline, src/transport/authz.trpc.ts:60
interface Input {
  organizationId: string;
  userId: string;
  bindingIdsToDelete: string[];
  bindingsToCreate: {
    role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
    customRoleId?: string | null;
    scopeType: "PROJECT" | "TEAM" | "ORGANIZATION";
    scopeId: string;
  }[];
}
// Output: authzBindingMutationSuccessSchema, ../contract/src/authz.grant-management.ts:193
interface Output {
  success: true;
}
```

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

### Pipeline `authz_aggregate_read` (aggregate `authz_aggregate_read`)

Declared at `src/eventing/authz-aggregate-read.pipeline.ts:18`. Events: `authzAggregateReadEventSchema`.

| Kind    | Name                  | Handles | Declared at                                        |
| ------- | --------------------- | ------- | -------------------------------------------------- |
| command | `recordAggregateRead` | –       | `src/eventing/authz-aggregate-read.pipeline.ts:23` |

### Pipeline `authz_grant` (aggregate `authz_grant`)

Declared at `src/eventing/authz-grant.pipeline.ts:57`. Events: `authzGrantEventSchemas`.

The chain builds early when `!sessionVersions` (`src/eventing/authz-grant.pipeline.ts:122`); the rows built only past that return say so. The caller's arguments decide which role gets which build.

| Kind                      | Name                                                           | Handles                                                             | Declared at                                | Built                |
| ------------------------- | -------------------------------------------------------------- | ------------------------------------------------------------------- | ------------------------------------------ | -------------------- |
| command                   | `attachGrant`                                                  | –                                                                   | `src/eventing/authz-grant.pipeline.ts:73`  | always               |
| command                   | `changeGrantRole`                                              | –                                                                   | `src/eventing/authz-grant.pipeline.ts:77`  | always               |
| command                   | `revokeGrant`                                                  | –                                                                   | `src/eventing/authz-grant.pipeline.ts:81`  | always               |
| command                   | `defineRole`                                                   | –                                                                   | `src/eventing/authz-grant.pipeline.ts:85`  | always               |
| command                   | `changeRolePermissions`                                        | –                                                                   | `src/eventing/authz-grant.pipeline.ts:86`  | always               |
| command                   | `deleteRole`                                                   | –                                                                   | `src/eventing/authz-grant.pipeline.ts:87`  | always               |
| subscriber                | `auditTrail`                                                   | –                                                                   | `src/eventing/authz-grant.pipeline.ts:65`  | always               |
| peer subscriber           | `projectMoved`                                                 | `lw.project.moved` from [project](../../project/README.md)          | `src/eventing/authz-grant.pipeline.ts:92`  | always               |
| peer subscriber           | `projectArchived`                                              | `lw.project.archived` from [project](../../project/README.md)       | `src/eventing/authz-grant.pipeline.ts:97`  | always               |
| peer subscriber           | `userDeactivated`                                              | `lw.user.deactivated` from [user](../../user/README.md)             | `src/eventing/authz-grant.pipeline.ts:106` | always               |
| peer subscriber           | `userReactivated`                                              | `lw.user.reactivated` from [user](../../user/README.md)             | `src/eventing/authz-grant.pipeline.ts:111` | always               |
| peer subscriber           | `userErased`                                                   | `lw.identity.user_erased` from [identity](../../identity/README.md) | `src/eventing/authz-grant.pipeline.ts:116` | always               |
| ClickHouse map projection | `≈ AuthzGrantProjection.create(options.authzGrantsWriteStore)` | –                                                                   | `src/eventing/authz-grant.pipeline.ts:64`  | always               |
| projection subscriber     | `sessionVersion`                                               | –                                                                   | `src/eventing/authz-grant.pipeline.ts:126` | past the early build |

### Pipeline `authz_member_offboarded` (aggregate `authz_member_offboarded`)

Declared at `src/eventing/authz-member-offboarded.pipeline.ts:18`. Events: `authzMemberOffboardedEventSchema`.

| Kind    | Name                     | Handles | Declared at                                           |
| ------- | ------------------------ | ------- | ----------------------------------------------------- |
| command | `recordMemberOffboarded` | –       | `src/eventing/authz-member-offboarded.pipeline.ts:23` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                          |
| ------ | ------------------- | ---------------------- | ------------------------------------ |
| config | `epochCacheEnabled` | `AUTHZ_EPOCH_CACHE`    | `../contract/src/authz.config.ts:18` |
| config | `demoProjectId`     | `DEMO_PROJECT_ID`      | `../contract/src/authz.config.ts:25` |
| config | `demoProjectUserId` | `DEMO_PROJECT_USER_ID` | `../contract/src/authz.config.ts:27` |
| config | `demoProjectSlug`   | `DEMO_PROJECT_SLUG`    | `../contract/src/authz.config.ts:29` |

<!-- readme:generated:end -->
