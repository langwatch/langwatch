# @langwatch/role-process

The server half of [role](../README.md). Roles: the built-in roles and the custom roles an organisation defines.

<!-- readme:generated:start (tools/readmegen; edit the code, then `pnpm generate:readmes`) -->

## Installation

`defineProcessModule("role").withRepositories(roleRepositories).withApi(RoleModule).withTransports(roleRest, roleTrpcTransport).withTransportFacts(…)`, `src/role.module.ts:10`.

Installed by api, worker, tasks, from each app's generated module list (`pnpm generate:modules`).

## Module API (`RoleApi`)

Peers call these through the token, declared at `../contract/src/role.api.ts:27`; nothing else in this package is public.

#### `listRoles`

The organization's roles: the built-in ones first, then its custom ones. `builtIn` true keeps only the built-ins, false only the custom roles.

```typescript
listRoles(input: { organizationId: string; builtIn?: boolean }): Promise<Role[]>;
```

#### `getRole`

One custom role, for a caller whose standing at the role's organization is established here: the organization is a row loaded by the role id, so no declaration on the request can name it.

```typescript
getRole(input: { roleId: string }, by: RoleUserCaller): Promise<Role>;
```

#### `getRoleInOrganization`

A built-in id, or a custom role inside an organization the credential already resolved.

```typescript
getRoleInOrganization(input: { roleId: string; organizationId: string }): Promise<Role>;
```

#### `createRole`

```typescript
createRole(input: { role: RoleCreate }, by: RoleCaller): Promise<Role>;
```

#### `updateRole`

```typescript
updateRole(input: { roleId: string; changes: RoleUpdate }, by: RoleUserCaller): Promise<Role>;
```

#### `updateRoleInOrganization`

```typescript
updateRoleInOrganization(input: { roleId: string; organizationId: string; changes: RoleUpdate }, by: RoleCaller): Promise<Role>;
```

#### `deleteRole`

```typescript
deleteRole(input: { roleId: string }, by: RoleUserCaller): Promise<RoleWriteAcknowledged>;
```

#### `deleteRoleInOrganization`

```typescript
deleteRoleInOrganization(input: { roleId: string; organizationId: string }, by: RoleCaller): Promise<RoleWriteAcknowledged>;
```

#### `assignRoleToUser`

```typescript
assignRoleToUser(input: { userId: string; teamId: string; customRoleId: string }, by: RoleCaller): Promise<RoleWriteAcknowledged>;
```

#### `removeRoleFromUser`

```typescript
removeRoleFromUser(input: { userId: string; teamId: string }, by: RoleCaller): Promise<RoleWriteAcknowledged>;
```

#### `getAssignmentOrganization`

The organization a team assignment lands in; an unnamed team is a refusal.

```typescript
getAssignmentOrganization(input: { teamId: string }): Promise<string>;
```

#### `filterAssignableRoles`

The role ids of the listed set that this organization may actually assign.

```typescript
filterAssignableRoles(input: { roleIds: string[]; organizationId: string }): Promise<string[]>;
```

#### `getPermissionCatalog`

Every resource with its actions, and whether it binds at organization scope only.

```typescript
getPermissionCatalog(): Promise<RolePermissionCatalog>;
```

## REST transport

### `roleRest`

|             |                                    |
| ----------- | ---------------------------------- |
| Declared at | `src/transport/role.rest.ts:59`    |
| Base URL    | `/api/roles`, twin `/api/v1/roles` |
| Addressing  | dated                              |
| Credential  | organization                       |
| Versions    | `2026-08-07`                       |

#### `GET /` · `listRoles`

List the organization's roles with their permission sets: the built-in roles `admin`, `member` and `viewer` first (marked `builtIn`), then the custom roles. `?builtIn=true` lists only the built-in roles, `?builtIn=false` only the custom ones.

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:64`.

Answers at `/api/roles`, `/api/v1/roles`; also, undocumented, `/api/roles/2026-08-07`, `/api/v1/roles/2026-08-07`, `/api/roles/latest`, `/api/v1/roles/latest`.

```typescript
type Query = z.infer<typeof roleRestListQuerySchema>; // ../contract/src/role-rest.schemas.ts:55
type Response = z.infer<typeof roleRestListSchema>; // ../contract/src/role-rest.schemas.ts:62
```

#### `POST /` · `createRole`

Create a custom role from resource:action permission keys. The name is unique within the organization; a taken name answers 409 custom_role_name_taken.

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:84`.

Answers at `/api/roles`, `/api/v1/roles`; also, undocumented, `/api/roles/2026-08-07`, `/api/v1/roles/2026-08-07`, `/api/roles/latest`, `/api/v1/roles/latest`.

```typescript
type Body = z.infer<typeof roleRestCreateSchema>; // ../contract/src/role-rest.schemas.ts:66
type Response = z.infer<typeof roleRestSchema>; // ../contract/src/role-rest.schemas.ts:41
```

#### `GET /permissions` · `listRolePermissions`

The permission catalog custom roles are built from: every resource with its actions, annotated with whether the resource only takes effect at organization scope (such a permission cannot be granted by a team- or project-scoped binding).

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:113`.

Answers at `/api/roles/permissions`, `/api/v1/roles/permissions`; also, undocumented, `/api/roles/2026-08-07/permissions`, `/api/v1/roles/2026-08-07/permissions`, `/api/roles/latest/permissions`, `/api/v1/roles/latest/permissions`.

```typescript
type Response = z.infer<typeof rolePermissionCatalogSchema>; // ../contract/src/role-rest.schemas.ts:81
```

#### `GET /:id` · `getRole`

Read one role: `admin`, `member` or `viewer`, or a custom role's id. A custom id from another organization answers 404 custom_role_not_found.

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:124`.

Answers at `/api/roles/:id`, `/api/v1/roles/:id`; also, undocumented, `/api/roles/2026-08-07/:id`, `/api/v1/roles/2026-08-07/:id`, `/api/roles/latest/:id`, `/api/v1/roles/latest/:id`.

```typescript
type Params = z.infer<typeof roleRestParamsSchema>; // ../contract/src/role-rest.schemas.ts:64
type Response = z.infer<typeof roleRestSchema>; // ../contract/src/role-rest.schemas.ts:41
```

#### `PATCH /:id` · `updateRole`

Update a custom role. Partial: only the fields present are written; a permissions list replaces the set outright. A built-in role answers 409 role_is_built_in; adding a permission the caller does not hold on the organization answers 403 role_exceeds_caller_permissions.

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:144`.

Answers at `/api/roles/:id`, `/api/v1/roles/:id`; also, undocumented, `/api/roles/2026-08-07/:id`, `/api/v1/roles/2026-08-07/:id`, `/api/roles/latest/:id`, `/api/v1/roles/latest/:id`.

```typescript
type Params = z.infer<typeof roleRestParamsSchema>; // ../contract/src/role-rest.schemas.ts:64
type Body = z.infer<typeof roleRestUpdateSchema>; // ../contract/src/role-rest.schemas.ts:72
type Response = z.infer<typeof roleRestSchema>; // ../contract/src/role-rest.schemas.ts:41
```

#### `DELETE /:id` · `deleteRole`

Delete a custom role. A role that anything still holds, a legacy team assignment or a role binding, answers 409 custom_role_in_use with the counts in meta. A built-in role answers 409 role_is_built_in.

Permission `organization:manage`. Entitlement `enterprise` (feature `RBAC`). Declared at `src/transport/role.rest.ts:173`.

Answers at `/api/roles/:id`, `/api/v1/roles/:id`; also, undocumented, `/api/roles/2026-08-07/:id`, `/api/v1/roles/2026-08-07/:id`, `/api/roles/latest/:id`, `/api/v1/roles/latest/:id`.

```typescript
type Params = z.infer<typeof roleRestParamsSchema>; // ../contract/src/role-rest.schemas.ts:64
type Response = z.infer<typeof roleRestDeletedSchema>; // ../contract/src/role-rest.schemas.ts:79
```

## tRPC transport

### `role`

Contract `../contract/src/role.trpc.ts:17`, router `src/transport/role.trpc.ts:12`.

| Procedure             | Kind     | Gate                                                                                                                               | Input                                  | Output                        |
| --------------------- | -------- | ---------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- | ----------------------------- |
| `role.getAll`         | query    | Permission `organization:manage`                                                                                                   | `roleApiOrganizationInputSchema`       | inline                        |
| `role.getById`        | query    | Service-authorized: organization:view; the role's organization is loaded by its id, so the check runs there rather than on input   | `roleApiRoleInputSchema`               | `roleSchema`                  |
| `role.create`         | mutation | Permission `organization:manage`; Entitlement `enterprise` (feature `RBAC`)                                                        | `roleApiCreateInputSchema`             | `roleSchema`                  |
| `role.update`         | mutation | Service-authorized: organization:manage; the role's organization is loaded by its id, so the check runs there rather than on input | `roleApiUpdateInputSchema`             | `roleSchema`                  |
| `role.delete`         | mutation | Service-authorized: organization:manage; the role's organization is loaded by its id, so the check runs there rather than on input | `roleApiRoleInputSchema`               | `roleWriteAcknowledgedSchema` |
| `role.assignToUser`   | mutation | Permission `organization:manage, via teamId`; Entitlement `enterprise` (feature `RBAC`)                                            | `roleApiUserRoleAssignmentInputSchema` | `roleWriteAcknowledgedSchema` |
| `role.removeFromUser` | mutation | Permission `organization:manage, via teamId`                                                                                       | `roleApiUserRoleAssignmentInputSchema` | `roleWriteAcknowledgedSchema` |

## Sockets

None: this module declares no websocket, rawsocket or rawhttp door.

## Workers

None: role declares no pipeline, process manager, subscriber or task.

## Configuration

None: no `static secrets` or `static config` leaf.

<!-- readme:generated:end -->
