---
name: authorization
description: "Who may do what, and whose rows a query may touch: declared route permissions (.withPermission and its targets { at: route | grants | organization | platform }), the vocabulary (principal, scope, grant, permission, actor), what a service may still check (the loaded row), and tenancy (ClickHouse tenant guard: TenantId = {p:String}, the declared tenant set with tenantIds, SKIP_TENANT_CHECK with a linted reason, Prisma projectId middleware). Use when someone says 'add a permission', 'who can call this', 'withPermission', 'withAccess', 'anyAuthenticated', 'check the permission in the service', 'tenant guard', 'TenantScopeError', 'SKIP_TENANT_CHECK', 'skipTenantCheck', 'tenantIds', 'query across projects', 'cross-tenant read', 'projectId middleware', 'multitenancy guard', 'system actor', or a ClickHouse or Prisma statement is refused for its tenant."
user-invocable: true
---

# Authorization and tenancy

Record: `dev/docs/ARCHITECTURE.md` section 8 (the door and `target`), the "Routing is folded into the `clickhouse` member"
paragraph of section 7, section 12 (a denial explains itself). Rule 6 of `CLAUDE.md` and `.claude/rules/backend.md`
("Authorization is declared on the route") are the short form. This skill teaches the shape; it does not restate rulings.

## The words (Alex, 2026-10-01: all auth code and prose uses authz's own)

| Word       | Meaning                                                                          | Where                                                 |
| ---------- | -------------------------------------------------------------------------------- | ----------------------------------------------------- |
| principal  | who holds access: `{ type: "user" \| "apiKey", id }` (a group also holds grants) | `packages/authorization/src/principal.ts`             |
| scope      | where it applies: platform, organization, team or project                        | `packages/authorization/src/scope-tiers.ts`           |
| grant      | a principal holds a role at a scope                                              | `modules/authz/contract/src/authz-grant.events.ts`    |
| permission | `resource:action`, for example `team:manage`                                     | `packages/authorization/src/permission-vocabulary.ts` |
| actor      | who acted, for the audit trail: user, api_key, system or internal                | `packages/authorization/src/actor.ts`                 |

Do not coin a new word for a credential ("person arm", "key owner"). A person's token is the principal `user`; a key is
the principal `apiKey`. Writes made by nobody take a named system actor from `SYSTEM_ACTORS`
(`packages/authorization/src/system-actors.ts`); never invent a `"system:..."` string at a call site.

## Routes declare the permission; the door asks it

```ts
defineRestRouter(TeamApi)
  .get("/api/teams/:teamId")
  .withPermission("team:view", { at: "route", param: "teamId" })   // modules/organization/process/src/transport/team.rest.ts:143
  ...
  .procedure("createInvites")
  .withPermission("organization:manage")                           // modules/organization/process/src/transport/invite.trpc.ts:23
```

- No target means the credential's own scope. A target says where the permission is asked: `{ at: "route", param }`
  (a path parameter names the scope), `{ at: "grants" }` or `{ at: "organization" }` on the key door,
  `{ at: "platform", refusal: "hidden" }` for operator routes (`modules/ops/process/src/transport/admin.rest.ts:41`).
- The handler gets `actor`, `scope` and, when a target was declared, `target`: the scope the door authorised.
- `anyAuthenticated`, `deferredScope` and `publicRoute` are for routes that ask no permission. None of them may be
  followed by a permission check in a middleware context, a handler or an `*Api` operation. That is a bypass.
- A case the declaration cannot express is a gap in `packages/api` and the door auth binds. Extend those; do not route around.

## What a service may still check

Only what depends on the loaded row: which scopes the resource lives in, whether the caller may grant a role beyond their
own (`modules/organization/process/src/services/organization-grant-ceiling.service.ts` asks `AuthzApi`). A service asks
`AuthzApi`; it never reads grants or roles from authz's tables. A denial is a `HandledError` from authz, which attaches
the roles that would grant the permission; do not write the sentence yourself.

Permission is one of four layers (record section 3, the capability table): availability of the install, entitlement of the
organisation, permission of the principal, release flag. Never answer one with another. See `platform-primitives` for plans.

## Tenancy: ClickHouse

`packages/clickhouse-client/src/tenantGuard.ts` refuses, before any slot or retry is spent, a statement that is not
scoped to exactly one tenant. The lint `langwatch/clickhouse-tenant-id` catches the same in the repository file.

1. One tenant: put `TenantId = {tenantId:String}` in the WHERE of every table you read and pass `tenantId` on the request.
   A literal (`TenantId = 'x'`), a `TenantId` weakened by an `OR`, or one behind `NOT` is refused.
2. One organisation's projects in one statement (a budget ledger, a personal pull-request read): declare the **tenant
   set**. Pass `tenantIds` on the request and bind `TenantId IN ({ids:Array(String)})` holding exactly that set, the
   request's `tenantId` among them. The set may not span organisations; the router answers on that organisation's server.
   Exemplar: `modules/coding-agent/process/src/repositories/clickhouse/clickhouse.coding-agent-session-event.repository.ts:299`.
3. A statement that truly spans every tenant (a sweep, a platform report) sets `SKIP_TENANT_CHECK: true` with `tenantId: ""`,
   and a comment on the line directly above giving a real reason (20 characters or more; TODO, n/a, skip, temp are
   refused by `langwatch/skip-tenant-check-reason`). Every skip is counted and logged. A skip is never a way round a
   tenant-set that you could have declared (record, Alex 2026-10-10).
4. An insert names the tenant on every row; the guard checks each row.
5. `unscoped` and the `-- @tenancy:` comment are the retired spellings; the lint says so and the client refuses them.

## Tenancy: Prisma

The multitenancy middleware (`packages/prisma-client/src/multi-tenancy-guard.ts`) rejects a project-level model query
without `projectId`. Raw SQL must compare `projectId`, `organizationId` or `tenantId` with a bound parameter. The one
raw escape is `${skipTenantCheck({ SKIP_TENANT_CHECK: true })}` inside the SQL, the comment above the flag giving the
reason (`modules/webhook/process/src/repositories/prisma/prisma.webhook-retention.repository.ts:41`). Owning a table
means owning every query against it, so a skip lives in the owner's repository, never in a service.

## Traps

- Reading `Project.apiKey` or minting from it: the legacy project key is never read or rotated (record section 10).
- A query that returns a credential. A secret comes back only from a mutation (record section 10).
- Checking a permission "to be safe" after the door did. It hides a missing declaration; fix the declaration.
- Treating `tenantId: ""` without the flag as allowed. It is refused.
