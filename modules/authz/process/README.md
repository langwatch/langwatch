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

`defineProcessModule("authz").withRepositories(authzRepositories).withApi(AuthzModule).withTransports(authzGrantRest, authzRoleBindingRest, authzTrpcTransport).provideMiddlewareContext(…).withEventing(authzEventing).withEventing(authzAggregateReadEventing).withEventing(authzMemberOffboardedEventing).withMigrations(…)`, `src/authz.module.ts:30`.

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

The own-only proof platform code reads its own project with (ADR-177); evaluates nothing. A project that no longer exists throws `ProjectNotFoundError`.

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

#### `listBraids`

ADR-185: the live braids out of a project and into it; a downgraded organisation lists too.

```typescript
listBraids(args: Braids.AuthzListBraidsInput): Promise<Braids.AuthzProjectBraids>;
```

#### `createBraid`

A braid from the owner (`projectId`) into the reader, its condition compiled on save.

```typescript
createBraid(args: Braids.AuthzCreateBraidInput): Promise<Braids.AuthzBraid>;
```

#### `changeBraid`

Attaches the changed braid naming the one it replaces, then revokes that one.

```typescript
changeBraid(args: Braids.AuthzChangeBraidInput): Promise<Braids.AuthzBraid>;
```

#### `removeBraid`

Revokes a braid touching `projectId` with reason `braid_removed`.

```typescript
removeBraid(args: Braids.AuthzRemoveBraidInput): Promise<Braids.AuthzBraidRemoved>;
```

#### `recordBraidedSpansView`

ADR-185 §8: one `braided_spans.viewed` audit row per actor, reader and owner per five minutes, naming the braids and never a span. Never fails the read that calls it.

```typescript
recordBraidedSpansView(args: Braids.AuthzRecordBraidedSpansViewInput): Promise<void>;
```

#### `getOrganizationPolicy`

The organisation's authz settings; one with no stored row has every setting off.

```typescript
getOrganizationPolicy(args: Braids.AuthzOrganizationInput): Promise<Braids.AuthzOrganizationPolicy>;
```

#### `setBraidsPolicy`

Keeps braids to organisation admins or opens them again; audited, and bumps the epoch.

```typescript
setBraidsPolicy(args: Braids.AuthzSetBraidsPolicyInput): Promise<Braids.AuthzOrganizationPolicy>;
```

#### `listOrganizationBraids`

Every live braid in the organisation.

```typescript
listOrganizationBraids(args: Braids.AuthzOrganizationInput): Promise<Braids.AuthzOrganizationBraids>;
```

#### `countProjectMembersHolding`

ADR-185 §7: the organisation's active members holding `permission` at the project.

```typescript
countProjectMembersHolding(args: Braids.AuthzCountProjectMembersHoldingInput): Promise<Braids.AuthzProjectMembersHolding>;
```

#### `listBraidTargets`

The braid dialog's picker: which projects the caller may braid into, one batched decision.

```typescript
listBraidTargets(args: Braids.AuthzListBraidTargetsInput): Promise<Braids.AuthzBraidTargets>;
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
// Query: grantListQuerySchema, ../contract/src/authz-grants-rest.schemas.ts:106
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
type Response = z.infer<typeof grantPageSchema>; // ../contract/src/authz-grants-rest.schemas.ts:115
```

#### `POST /` · `createGrant`

Grant a role

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:57`.

Answers at `/api/grants`, `/api/v1/grants`; also, undocumented, `/api/grants/2026-08-07`, `/api/v1/grants/2026-08-07`, `/api/grants/latest`, `/api/v1/grants/latest`.

```typescript
// Body: grantCreateSchema, ../contract/src/authz-grants-rest.schemas.ts:77
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
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:64
```

#### `GET /:grantId` · `getGrant`

Get a grant

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:81`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
// Params: grantParamsSchema, ../contract/src/authz-grants-rest.schemas.ts:120
interface Params {
  grantId: string;
}
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:64
```

#### `PATCH /:grantId` · `updateGrant`

Change a grant's role

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:97`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
type Params = z.infer<typeof grantParamsSchema>; // ../contract/src/authz-grants-rest.schemas.ts:120
// Body: grantUpdateSchema, ../contract/src/authz-grants-rest.schemas.ts:83
interface Body {
  roleId: string;
}
type Response = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:64
```

#### `DELETE /:grantId` · `revokeGrant`

Revoke a grant

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-grant.rest.ts:121`.

Answers at `/api/grants/:grantId`, `/api/v1/grants/:grantId`; also, undocumented, `/api/grants/2026-08-07/:grantId`, `/api/v1/grants/2026-08-07/:grantId`, `/api/grants/latest/:grantId`, `/api/v1/grants/latest/:grantId`.

```typescript
type Params = z.infer<typeof grantParamsSchema>; // ../contract/src/authz-grants-rest.schemas.ts:120
// Response: grantRevokedSchema, ../contract/src/authz-grants-rest.schemas.ts:125
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
// Query: roleBindingRestListQuerySchema, ../contract/src/authz-rest.schemas.ts:53
interface Query {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
  scopeType?: "PROJECT" | "TEAM" | "ORGANIZATION";
  scopeId?: string;
  offset?: number;
  limit?: number;
}
type Response = z.infer<typeof roleBindingRestListSchema>; // ../contract/src/authz-rest.schemas.ts:64
```

#### `POST /` · `createRoleBinding`

Create a role binding for exactly one principal: a user, a group, or an API key. Every reference is checked against the caller's organization; an identical binding is written again, because bindings are never unique. Pass expiresAt to time-box the access: it stops granting at that moment on its own, without being revoked, and a date that has already passed answers 422 grant_expiry_in_past. The response always carries the new binding's id; the names of its principal, role and scope may be absent on this response alone, and a follow-up read carries them.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:103`.

Answers at `/api/role-bindings`, `/api/v1/role-bindings`; also, undocumented, `/api/role-bindings/2026-08-07`, `/api/v1/role-bindings/2026-08-07`, `/api/role-bindings/latest`, `/api/v1/role-bindings/latest`.

```typescript
// Body: roleBindingRestCreateSchema, ../contract/src/authz-rest.schemas.ts:83
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
type Response = z.infer<typeof roleBindingRestSchema>; // ../contract/src/authz-rest.schemas.ts:37
```

#### `PATCH /:id` · `updateRoleBinding`

Change a binding's role (and custom role). The principal and scope are the binding's identity and do not change; create a new binding instead.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:148`.

Answers at `/api/role-bindings/:id`, `/api/v1/role-bindings/:id`; also, undocumented, `/api/role-bindings/2026-08-07/:id`, `/api/v1/role-bindings/2026-08-07/:id`, `/api/role-bindings/latest/:id`, `/api/v1/role-bindings/latest/:id`.

```typescript
// Params: roleBindingRestParamsSchema, ../contract/src/authz-rest.schemas.ts:102
interface Params {
  id: string;
}
// Body: roleBindingRestUpdateSchema, ../contract/src/authz-rest.schemas.ts:94
interface Body {
  role: "ADMIN" | "MEMBER" | "VIEWER" | "CUSTOM";
  customRoleId?: string;
}
type Response = z.infer<typeof roleBindingRestSchema>; // ../contract/src/authz-rest.schemas.ts:37
```

#### `DELETE /:id` · `deleteRoleBinding`

Delete a role binding. An id that does not exist in the caller's organization answers 404 role_binding_not_found.

Permission `organization:manage`. Entitlement `enterprise` (feature `MANAGEMENT_API`). Declared at `src/transport/authz-role-binding.rest.ts:174`.

Answers at `/api/role-bindings/:id`, `/api/v1/role-bindings/:id`; also, undocumented, `/api/role-bindings/2026-08-07/:id`, `/api/v1/role-bindings/2026-08-07/:id`, `/api/role-bindings/latest/:id`, `/api/v1/role-bindings/latest/:id`.

```typescript
type Params = z.infer<typeof roleBindingRestParamsSchema>; // ../contract/src/authz-rest.schemas.ts:102
// Response: roleBindingRestDeletedSchema, ../contract/src/authz-rest.schemas.ts:110
interface Response {
  success: true;
}
```

## tRPC transport

### `authz`

Contract `src/transport/authz.trpc.ts:45`, router `src/transport/authz.trpc.ts:137`.

| Procedure                        | Kind     | Gate                                                                                                                                                                       | Input                                                | Output                                                |
| -------------------------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------- |
| `authz.effectivePermissions`     | query    | Service-authorized: resolves the caller's OWN effective permissions at the project or organization scope named; a non-member resolves to the empty set (no default access) | `authzOwnStandingInputSchema`                        | `authzOwnStandingSchema`                              |
| `authz.listGrants`               | query    | Permission `organization:manage`                                                                                                                                           | `authzListGrantsInputSchema`                         | `grantPageSchema`                                     |
| `authz.createGrant`              | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `grantSchema`                                         |
| `authz.changeGrantRole`          | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `grantSchema`                                         |
| `authz.revokeGrant`              | mutation | Permission `organization:manage`                                                                                                                                           | inline                                               | `grantRevokedSchema`                                  |
| `authz.listManagedGrants`        | query    | Permission `organization:manage`                                                                                                                                           | `authzListManagedBindingsForOrganizationInputSchema` | `authzListManagedBindingsForOrganizationOutputSchema` |
| `authz.listMemberGrants`         | query    | Permission `organization:manage`                                                                                                                                           | `authzListManagedBindingsForUserInputSchema`         | `authzListManagedBindingsForUserOutputSchema`         |
| `authz.applyMemberGrants`        | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                                                                | inline                                               | `authzBindingMutationSuccessSchema`                   |
| `authz.listBraids`               | query    | Permission `project:view`                                                                                                                                                  | `authzListBraidsInputSchema`                         | `authzProjectBraidsSchema`                            |
| `authz.createBraid`              | mutation | Permission `traces:view`; Entitlement `enterprise` (feature `BRAIDS`)                                                                                                      | inline                                               | `authzBraidSchema`                                    |
| `authz.changeBraid`              | mutation | Permission `traces:view`; Entitlement `enterprise` (feature `BRAIDS`)                                                                                                      | inline                                               | `authzBraidSchema`                                    |
| `authz.removeBraid`              | mutation | Permission `braids:manage`                                                                                                                                                 | inline                                               | `authzBraidRemovedSchema`                             |
| `authz.getBraidsPolicy`          | query    | Permission `organization:view`                                                                                                                                             | `authzOrganizationInputSchema`                       | `authzOrganizationPolicySchema`                       |
| `authz.setBraidsPolicy`          | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `BRAIDS`)                                                                                              | inline                                               | `authzOrganizationPolicySchema`                       |
| `authz.listOrganizationBraids`   | query    | Permission `organization:manage`                                                                                                                                           | `authzOrganizationInputSchema`                       | `authzOrganizationBraidsSchema`                       |
| `authz.countProjectTraceViewers` | query    | Permission `traces:view`                                                                                                                                                   | inline                                               | `authzProjectMembersHoldingSchema`                    |
| `authz.listBraidTargets`         | query    | Permission `braids:manage`                                                                                                                                                 | inline                                               | `authzBraidTargetsSchema`                             |

```typescript
// authz.effectivePermissions
// Input: authzOwnStandingInputSchema, ../contract/src/authz.queries.ts:670
interface Input {
  projectId?: string;
  organizationId?: string;
}
// Output: authzOwnStandingSchema, ../contract/src/authz.queries.ts:654
interface Output {
  scope: {
    type: "project" | "team" | "organization" | "resource";
    id: string;
  } | null;
  permissions: string[];
}

// authz.listGrants
type Input = z.infer<typeof authzListGrantsInputSchema>; // ../contract/src/authz-grants-rest.schemas.ts:137
type Output = z.infer<typeof grantPageSchema>; // ../contract/src/authz-grants-rest.schemas.ts:115

// authz.createGrant
// Input: authzCreateGrantInputSchema.omit(IMPLIED_BY_SESSION) (inline, src/transport/authz.trpc.ts:55)
type Output = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:64

// authz.changeGrantRole
// Input: inline, src/transport/authz.trpc.ts:59
interface Input {
  organizationId: string;
  grantId: string;
  roleId: string;
}
type Output = z.infer<typeof grantSchema>; // ../contract/src/authz-grants-rest.schemas.ts:64

// authz.revokeGrant
// Input: inline, src/transport/authz.trpc.ts:63
interface Input {
  organizationId: string;
  grantId: string;
}
type Output = z.infer<typeof grantRevokedSchema>; // ../contract/src/authz-grants-rest.schemas.ts:125

// authz.listManagedGrants
// Input: authzListManagedBindingsForOrganizationInputSchema, ../contract/src/authz.grant-management.ts:75
interface Input {
  organizationId: string;
}
type Output = z.infer<typeof authzListManagedBindingsForOrganizationOutputSchema>; // ../contract/src/authz.grant-management.ts:118

// authz.listMemberGrants
// Input: authzListManagedBindingsForUserInputSchema, ../contract/src/authz.grant-management.ts:31
interface Input {
  organizationId: string;
  userId: string;
}
// Output: authzListManagedBindingsForUserOutputSchema, ../contract/src/authz.grant-management.ts:63
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
// Input: inline, src/transport/authz.trpc.ts:75
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
// Output: authzBindingMutationSuccessSchema, ../contract/src/authz.grant-management.ts:278
interface Output {
  success: true;
}

// authz.listBraids
// Input: authzListBraidsInputSchema, ../contract/src/authz-braids.commands.ts:73
interface Input {
  projectId: string;
}
type Output = z.infer<typeof authzProjectBraidsSchema>; // ../contract/src/authz-braids.commands.ts:164

// authz.createBraid
// Input: inline, src/transport/authz.trpc.ts:83
interface Input {
  projectId: string;
  readerProjectId: string;
  where?: string;
  fromMs: number;
  expiresAtMs?: number;
}
// Output: authzBraidSchema, ../contract/src/authz-braids.commands.ts:150
interface Output {
  braidId: string;
  ownerProjectId: string;
  readerProjectId: string;
  where: string | null;
  fromMs: number;
  expiresAtMs: number | null;
  createdByUserId: string | null;
  createdAtMs: number;
}

// authz.changeBraid
// Input: inline, src/transport/authz.trpc.ts:87
interface Input {
  projectId: string;
  readerProjectId: string;
  braidId: string;
  where?: string;
  fromMs: number;
  expiresAtMs?: number;
}
type Output = z.infer<typeof authzBraidSchema>; // ../contract/src/authz-braids.commands.ts:150

// authz.removeBraid
// Input: inline, src/transport/authz.trpc.ts:91
interface Input {
  projectId: string;
  braidId: string;
}
// Output: authzBraidRemovedSchema, ../contract/src/authz-braids.commands.ts:169
interface Output {
  braidId: string;
}

// authz.getBraidsPolicy
// Input: authzOrganizationInputSchema, ../contract/src/authz-braids.commands.ts:214
interface Input {
  organizationId: string;
}
// Output: authzOrganizationPolicySchema, ../contract/src/authz-braids.commands.ts:206
interface Output {
  organizationId: string;
  braidsOrganizationAdminsOnly: boolean;
  updatedByUserId: string | null;
  updatedAtMs: number | null;
}

// authz.setBraidsPolicy
// Input: inline, src/transport/authz.trpc.ts:99
interface Input {
  organizationId: string;
  braidsOrganizationAdminsOnly: boolean;
}
type Output = z.infer<typeof authzOrganizationPolicySchema>; // ../contract/src/authz-braids.commands.ts:206

// authz.listOrganizationBraids
type Input = z.infer<typeof authzOrganizationInputSchema>; // ../contract/src/authz-braids.commands.ts:214
// Output: authzOrganizationBraidsSchema, ../contract/src/authz-braids.commands.ts:237
type Output = {
  braidId: string;
  ownerProjectId: string;
  readerProjectId: string;
  where: string | null;
  fromMs: number;
  expiresAtMs: number | null;
  createdByUserId: string | null;
  createdAtMs: number;
}[];

// authz.countProjectTraceViewers
// Input: inline, src/transport/authz.trpc.ts:107
interface Input {
  projectId: string;
}
// Output: authzProjectMembersHoldingSchema, ../contract/src/authz-braids.commands.ts:97
interface Output {
  count: number;
  exact: boolean;
}

// authz.listBraidTargets
// Input: inline, src/transport/authz.trpc.ts:111
interface Input {
  projectId: string;
  projectIds: string[];
}
// Output: authzBraidTargetsSchema, ../contract/src/authz-braids.commands.ts:133
type Output = {
  projectId: string;
  selectable: boolean;
  reason?: "this_project" | "aggregate";
}[];
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

Declared at `src/eventing/authz-grant.pipeline.ts:69`. Events: `authzGrantEventSchemas`.

The chain builds early when `!sessionVersions` (`src/eventing/authz-grant.pipeline.ts:151`); the rows built only past that return say so. The caller's arguments decide which role gets which build.

| Kind                      | Name                                                           | Handles                                                               | Declared at                                | Built                |
| ------------------------- | -------------------------------------------------------------- | --------------------------------------------------------------------- | ------------------------------------------ | -------------------- |
| command                   | `attachGrant`                                                  | –                                                                     | `src/eventing/authz-grant.pipeline.ts:86`  | always               |
| command                   | `changeGrantRole`                                              | –                                                                     | `src/eventing/authz-grant.pipeline.ts:90`  | always               |
| command                   | `revokeGrant`                                                  | –                                                                     | `src/eventing/authz-grant.pipeline.ts:94`  | always               |
| command                   | `defineRole`                                                   | –                                                                     | `src/eventing/authz-grant.pipeline.ts:98`  | always               |
| command                   | `changeRolePermissions`                                        | –                                                                     | `src/eventing/authz-grant.pipeline.ts:99`  | always               |
| command                   | `deleteRole`                                                   | –                                                                     | `src/eventing/authz-grant.pipeline.ts:100` | always               |
| subscriber                | `auditTrail`                                                   | –                                                                     | `src/eventing/authz-grant.pipeline.ts:77`  | always               |
| peer subscriber           | `engineMigrationRolledBack`                                    | `lw.ops.tenant_migration.rolled_back` from [ops](../../ops/README.md) | `src/eventing/authz-grant.pipeline.ts:104` | always               |
| peer subscriber           | `projectMoved`                                                 | `lw.project.moved` from [project](../../project/README.md)            | `src/eventing/authz-grant.pipeline.ts:121` | always               |
| peer subscriber           | `projectArchived`                                              | `lw.project.archived` from [project](../../project/README.md)         | `src/eventing/authz-grant.pipeline.ts:126` | always               |
| peer subscriber           | `userDeactivated`                                              | `lw.user.deactivated` from [user](../../user/README.md)               | `src/eventing/authz-grant.pipeline.ts:135` | always               |
| peer subscriber           | `userReactivated`                                              | `lw.user.reactivated` from [user](../../user/README.md)               | `src/eventing/authz-grant.pipeline.ts:140` | always               |
| peer subscriber           | `userErased`                                                   | `lw.identity.user_erased` from [identity](../../identity/README.md)   | `src/eventing/authz-grant.pipeline.ts:145` | always               |
| ClickHouse map projection | `≈ AuthzGrantProjection.create(options.authzGrantsWriteStore)` | –                                                                     | `src/eventing/authz-grant.pipeline.ts:76`  | always               |
| projection subscriber     | `sessionVersion`                                               | –                                                                     | `src/eventing/authz-grant.pipeline.ts:155` | past the early build |

### Pipeline `authz_member_offboarded` (aggregate `authz_member_offboarded`)

Declared at `src/eventing/authz-member-offboarded.pipeline.ts:18`. Events: `authzMemberOffboardedEventSchema`.

| Kind    | Name                     | Handles | Declared at                                           |
| ------- | ------------------------ | ------- | ----------------------------------------------------- |
| command | `recordMemberOffboarded` | –       | `src/eventing/authz-member-offboarded.pipeline.ts:23` |

## Configuration

| Kind   | Leaf                | Environment variable   | Declared at                          |
| ------ | ------------------- | ---------------------- | ------------------------------------ |
| config | `epochCacheEnabled` | `AUTHZ_EPOCH_CACHE`    | `../contract/src/authz.config.ts:19` |
| config | `demoProjectId`     | `DEMO_PROJECT_ID`      | `../contract/src/authz.config.ts:26` |
| config | `demoProjectUserId` | `DEMO_PROJECT_USER_ID` | `../contract/src/authz.config.ts:28` |
| config | `demoProjectSlug`   | `DEMO_PROJECT_SLUG`    | `../contract/src/authz.config.ts:30` |

<!-- readme:generated:end -->
