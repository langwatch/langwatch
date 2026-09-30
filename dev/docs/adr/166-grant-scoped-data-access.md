# ADR-166: Grant-scoped data access

**Date:** 2026-09-30

**Status:** Accepted (Alex, 2026-09-30)

**Builds on:** [ADR-092](092-unified-authorization-engine.md) §4 (`{ actor, subject }`) and §7 L3 (the
repository witness, never wired), [ADR-021](021-multi-scope-targeting-and-tenancy.md) (the tenancy guard),
[ADR-110](110-grant-aggregates-are-grants.md) (the grant row), [ADR-162](162-signed-authorization-passports.md)
(the signed wire passport). Alex's plan "sharing is caring" (project-to-project trace shares). Record §3.2
(a scope travels as a named parameter), §7 (operator reads, the ClickHouse tenant set), §17 (shrink-only
baselines). Review draft AR1.

## Context

Alex (2026-09-30): the guard's exceptions become a baseline; from now on every database call carries
proof of who is asking and what they may reach, the store applies it generically, and the caller says
what it expects. There is no ambient auth: the proof goes down by hand.

| Today                                                                                  | Where                                                             | Effect                                                                       |
| -------------------------------------------------------------------------------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| ❌ The org guard checks that a tenant predicate is **present**, not **whose** it is    | `organization-guard.ts` `boundsToSingleOrg`                       | Any `organizationId` literal passes, and so does a bare row `id`             |
| ❌ 40 org-bearing models skip the guard                                                | `ORG_TENANCY_EXEMPT`                                              | Notification, AuditLog, SsoCredential, ModelProvider and others go unchecked |
| ❌ The guard admits sweeps by WHERE shape                                              | `extraBound` matchers, `platformScopeActions`                     | Any module writing the shape crosses tenants (langy does, per AR1)           |
| ❌ The door's project check stops at the door                                          | `packages/api/src/access/access.ts` `decide`                      | A service can pass a different `projectId` below it                          |
| ⚠️ A witness type exists and nothing takes it                                          | `Authorized<Tier, Permission>`, `authz-contract/src/authz.ts:207` | ADR-092's L3 was never wired                                                 |
| ⚠️ Events carry `tenantId` and no actor                                                | `packages/eventing/src/domain/types.ts:34`                        | Workers act as nobody                                                        |
| ⚠️ A grant change bumps the epoch after the row, and an expiring binding bumps nothing | `authz-grant.store.ts:292`, `authz-collector.service.ts:308`      | A cached snapshot can answer for up to 30s after a revoke                    |
| ⚠️ Raw SQL bypasses the guard                                                          | 77 `-- @tenancy:` opt-outs in 36 files                            | Out of reach of any client-side check                                        |

## Decision

### 1. `Authorization`: minted at the door, sealed, per call

```
Authorization            minted at the door, sealed, per call
├─ actor      who acts      user:u_1 | apiKey:k_1 | system:retention-sweep
├─ principal  whose perms   usually = actor; fan-out job = the reader
├─ scope      organizationId (one org, always)
├─ grants[]   what it may touch
│   ├─ projectId
│   ├─ permissions   own project: full effective set
│   ├─ via           grant ids (audit: "via grant_2Xf9")
│   ├─ kind          own | shared
│   └─ condition?    shared: trace|span|log + where/from/until
├─ expiresAt  earliest grant expiry, request/job budget
└─ purpose    route | event id | operator entry
```

The type is **`Authorization`** and it travels as the explicit named parameter **`authorization`**, never
through `AsyncLocalStorage`. It replaces ADR-092's unused `Authorized` at `authz.ts:207` and lives in
`@langwatch/actor`. It is the union of many grants for one call, so it is not itself a grant. The name
shares a word with the HTTP `Authorization` header; the clash is accepted, since the header never reaches a
module and the object never reaches the wire.

```ts
// packages/actor/src/authorization.ts (framework: zod only, beside Actor)
const grantSchema = z
  .object({
    projectId: z.string().min(1).optional(), // absent: the organization tier (members, keys, SSO)
    permissions: z.array(z.string()).readonly(), // own: the full effective set; shared: the grant's one
    via: z.array(z.string()).readonly(), // grant ids, for "read via grant_2Xf9" in the audit
    kind: z.enum(["own", "shared"]),
    condition: z
      .object({
        // shared only
        type: z.enum(["trace", "span", "log"]),
        where: z.string().optional(), // OTTL, compiled on save; absent shares everything
        from: z.number().int(),
        until: z.number().int().nullable(),
      })
      .strict()
      .optional(),
  })
  .strict();

export const authorizationSchema = z
  .object({
    actor: actorSchema,
    principal: z.discriminatedUnion("type", [
      // the code's vocabulary (authz.ts:83, :90)
      z.object({ type: z.literal("user"), id: z.string() }),
      z.object({ type: z.literal("apiKey"), id: z.string() }),
      z.object({ type: z.literal("anonymous") }),
      z.object({ type: z.literal("project"), id: z.string() }), // a fan-out job reading as the reader
      z.object({ type: z.literal("system"), name: systemActorNameSchema }), // SYSTEM_ACTORS
    ]),
    scope: z.object({ organizationId: z.string().min(1) }).strict(),
    grants: z.array(grantSchema).min(1).readonly(),
    expiresAt: z.number().int(),
    purpose: z.discriminatedUnion("kind", [
      z.object({ kind: z.literal("route"), route: z.string() }),
      z.object({ kind: z.literal("event"), eventId: z.string() }),
      z.object({ kind: z.literal("operator"), entry: z.string() }),
    ]),
  })
  .strict()
  .readonly();
export type Authorization = z.infer<typeof authorizationSchema> & {
  readonly [AUTHORIZATION_BRAND]: true;
};
```

| `kind`     | Comes from                                                                      | `permissions`                                 | `condition`                                       | Accepted by                               |
| ---------- | ------------------------------------------------------------------------------- | --------------------------------------------- | ------------------------------------------------- | ----------------------------------------- |
| **own**    | The principal's bindings on the scope's lineage                                 | The full effective set (a peer call needs it) | none                                              | Postgres, ClickHouse, object storage      |
| **shared** | A grant whose audience is the reading project (ADR-110 rows, the plan's shares) | The grant's one permission                    | trace, span or log, plus `where`, `from`, `until` | ClickHouse span, trace and log reads only |

```
 route .withPermission("traces:view") ─► authz.authorize({ principal, permission, scope }) ─► Authorization
 handler({ app, authorization, input }) ─► api.op({ authorization, ... }) ─► service({ authorization, ... })
 repository   this.clickhouse.as(authorization, { reads: "traces" }).query(...)   ← says what it expects
              this.prisma.as(authorization, { reads: "annotations" }).annotationScore.findFirst(...)
                                                  ▼
 clickhouse-client: TenantId IN (own ∪ shared) AND (own OR (shared AND where AND StartTime in window))
 prisma-client:     projectId IN (own grants), or organizationId = scope.organizationId; shared never
 both:              no proof, forged, expired, or not covering the read: refused
```

### 2. The store applies it; the repository says what it expects

`PrismaRepository` loses the bare `this.prisma`: its only client is `this.prisma.as(authorization, access)`,
and the ClickHouse member's is `this.clickhouse.as(authorization, access)`. `access` is `{ reads: "<resource>" }`
or `{ writes: "<resource>" }`. The model's tenant column is a schema fact, so the repository names none.

| Check           | Rule                                                                                                                               | On failure                                                              |
| --------------- | ---------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| No proof        | Does not typecheck: `as` requires `Authorization`, whose brand has no public factory                                               | Runtime: no unbound delegate exists                                     |
| Forged, expired | Not in the minted set, or `expiresAt` has passed                                                                                   | `ForgedAuthorizationError`, `AuthorizationExpiredError`                 |
| Kind            | Postgres and object storage use `own` grants only; ClickHouse spans, traces and logs use `own` and `shared`                        | shared grants add no rows                                               |
| Access          | `reads`: a usable grant holds a permission on that resource; `writes`: a non-`view` verb (`view` is the registry's only read verb) | `AccessNotGrantedError` naming the resource                             |
| Tenant          | The client ANDs the usable grants' tenant into every WHERE; a create or upsert naming a project outside them is refused            | `TenantMismatchError`, logged `{ module, model, purpose }`, no row data |
| Nothing visible | An empty result stays empty, and the service answers its own not-found (404)                                                       | none                                                                    |

Before: `modules/annotation/process/src/repositories/prisma/prisma.annotation-score.repository.ts:82`

```ts
// transport: .withPermission("annotations:view").handle(({ app, input }) =>
//              app.getScore({ id: input.scoreId, projectId: input.projectId }))
async findScore(input: AnnotationScoreByIdInput): Promise<AnnotationScore> {
  const row = await this.prisma.annotationScore.findFirst({
    where: { id: input.id, projectId: input.projectId, deletedAt: null }, // any projectId passes
    select: annotationScoreSelect,
  });
```

After:

```ts
// transport: .withPermission("annotations:view").handle(({ app, authorization, input }) =>
//              app.getScore({ authorization, id: input.scoreId }))
async findScore({ authorization, id }: { authorization: Authorization; id: string }): Promise<AnnotationScore> {
  const row = await this.prisma.as(authorization, { reads: "annotations" }).annotationScore.findFirst({
    where: { id, deletedAt: null },               // the client adds projectId IN (own grants)
    select: annotationScoreSelect,
  });
```

The wire keeps `projectId`: the door reads it to choose the scope, and it stops travelling below. The memory
twin calls the same pure `applyAuthorization` from `@langwatch/actor`, so a memory-tier test proves each refusal.

### 3. System and cross-tenant work

A system `Authorization` exists only through a named, declared operator entry. This generalises §7's
`operatorReads` rather than adding a second mechanism.

| Work                                                                                    | Mechanism                                                             | `Authorization`                                                                                                            |
| --------------------------------------------------------------------------------------- | --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Cross-tenant read (sweeps, ops views)                                                   | §7 `OperatorRead` handle, unchanged: one model, read actions, logged  | none; the handle is the capability                                                                                         |
| The per-organization write after a sweep                                                | `handle.authorizeFor({ organizationId })` on the same declared handle | actor and principal `system:<name>` from `SYSTEM_ACTORS`, one own grant with the handle's permissions, `purpose: operator` |
| Credential lookup before a tenant is known (key `lookupId`, invite code, grant `token`) | The door's authenticate step, over AR1's declared tenancy keys        | none; those reads only                                                                                                     |
| Migrations, provisioning                                                                | apps/tasks before boot with raw clients (§7)                          | out of scope                                                                                                               |

Each operator mint is audited (`{ module, entry, organizationId }`). A module cannot mint one: the entry
is declared on its class, scoped to its own tables by `prisma-table-ownership`, and sealed after boot. A
new system caller adds one `SYSTEM_ACTORS` entry, as `@langwatch/actor` already requires. Today's
`extraBound` sweep matchers, `platformScopeActions` and `ORG_TENANCY_EXEMPT` go into a shrink-only baseline
(§7 below) and leave the guard as their owners move.

### 4. Authz as a portable library

The record's word is a **portable, framework-free library** that a module owns and other code may import
(`modules/trace/query-language`, §2 and §3). The permission registry names every feature's resources,
which is feature knowledge, so it cannot be a `packages/` framework package.

| Piece                                                                                                                                      | Home                                                                                            | Imported by                                                       |
| ------------------------------------------------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| `Authorization`, `applyAuthorization`, the brand, the mint capability type                                                                 | `@langwatch/actor` (framework; resources are strings to it)                                     | prisma-client, clickhouse-client, api, eventing, every repository |
| Registry, roles, bitset, scope chain, `AuthzEngine`, `walk`, matchers, declaration types, the OTTL grant compiler, `PermissionDeniedError` | **`modules/authz/engine`** (`@langwatch/authz-engine`, portable), moved out of `authz-contract` | authz process, api, browser `hasPermission`, token handling       |
| `AuthzApi` (`authorize`, `findReaders`), grant-ledger commands, events, REST schemas                                                       | `authz-contract`                                                                                | peers                                                             |
| Collection, epoch, grant ledger, escalation rules, administration, the mint                                                                | `authz-process`                                                                                 | nobody                                                            |

The stores never evaluate permissions: they apply an `Authorization` that authz has already evaluated. This
settles AR1 question 2 for the vocabulary edges, because `api` imports `@langwatch/authz-engine` and not
the contract. The one `AuthzApi` type in `packages/api/src/rest/browser-session.ts:1` stays as host wiring,
under AR1's proposed allowlist.

### 5. Workers and events

The command dispatcher stamps the sender once, into the event's passthrough metadata:
`metadata.access = { actor: LedgerActor, principal, organizationId }`. The durable actor shape stays frozen
(`toLedgerActor`).

| Handler                                     | Minted as                                                                                                                                                                                                                                                              | By                                              |
| ------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| Projection (a fold over its own tenant)     | One own grant for the event's tenant, the pipeline's declared resources, `purpose: event`                                                                                                                                                                              | eventing; replay works after the actor has left |
| Subscriber acting for the sender            | The stamped principal, through `authz.authorize`                                                                                                                                                                                                                       | authz                                           |
| **Fan-out subscriber** (evaluation trigger) | **Each reader**: `authz.findReaders({ tenant })` answers the tenant and its grantees, and each job runs with the reader as principal, seeing only the reader's grants. The job id carries the reader, so each reader runs once, and nothing visible means nothing runs | authz                                           |
| Event written before stamping               | The pipeline's `system` actor; organization from the tenant directory (cached)                                                                                                                                                                                         | eventing                                        |

**Escalation composes rather than repeats.** The record's rule, "nobody grants or writes into a role more
than they hold at that scope" (§7; `findPermissionsBeyondHeld`, `grant-escalation.rules.ts:35`, run by
`assertWithinCaller`, `authz-binding-writer.service.ts:460`), takes `authorization.principal` as its caller.
A subscriber writing bindings for a user is capped by that user's live grants. A `system` principal
(`scim`, `ssoAutoJoin`) is capped by its operator entry's declared permissions. The store asks "may this
proof touch these rows"; escalation asks "may this principal confer this". Both run.

### 6. Freshness: the epoch and the expiry

| Rule                                                                                                                                                                   | Effect                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| A grant change bumps the organization's epoch **before** it returns. If the bump fails, the change reports failure, and the ledger's `skip` makes the retry idempotent | No mint after an acknowledged revoke can see the old snapshot                |
| A mint that cannot read the epoch collects fresh from Postgres; if collection fails, the mint refuses (`DatabaseBusyError`, 503)                                       | Fails closed, never serves the cache blind                                   |
| `expiresAt` = the earliest contributing grant expiry, bounded by the request deadline or job budget                                                                    | An expiring binding ends access at its moment, not at the 30s snapshot bound |

### 7. Migration path

```
 step 0  framework   Authorization + as() beside the bare client; authz, eventing and operator entries mint
 step 1  baseline    take both baselines (below); the guard logs unproven calls per module
 step 2  pilot       annotation (small, clean projectId repositories), then trace with the shares
 step 3  credentials authz, api-key, organization, identity: who-may-do-what first
 step 4  by exemption  modules owning ORG_TENANCY_EXEMPT models, most rows first; then the rest
 step 5  close       the bare client is removed; exemptions and shape matchers are deleted; no proof = refused
```

| Tool                                                  | Does                                                                                                                                                                                                                                                                                                    |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Codemod (tslsp rename plus a scripted rewrite)        | Adds `authorization` to repository interfaces, twins and callers; rewrites `this.prisma.<model>` to `this.prisma.as(authorization, access)`, inferring read or write from the action and the resource from the table catalogue, and drops the tenant literal from WHERE. A human confirms each resource |
| `langwatch/store-call-carries-authorization` (oxlint) | Refuses a bare client in `repositories/**`, and a repository method with no `authorization`. A trace route that passes none fails CI, as the plan says                                                                                                                                                  |
| `authorization-mint-callers` (architecture policy)    | Only authz-process, `packages/eventing` and the operator-entry resolver reach the mint                                                                                                                                                                                                                  |
| `access-declaration-owner` (architecture policy)      | A declared resource belongs to the declaring module's catalogue subject                                                                                                                                                                                                                                 |
| Baselines, shrink-only, count per key (§17)           | `unproven-store-calls.json` (keyed by repository file); `organization-guard-hatches.json` (each `extraBound` matcher, `platformScopeActions`, each `ORG_TENANCY_EXEMPT` name)                                                                                                                           |

242 Prisma repository files move. Each module moves in one step: once it has moved, its registry offers
only `as()`.

**Performance.** The guard already walks every WHERE tree (`validateRecursive`); applying the proof adds
one predicate on indexed tenant columns. Shared conditions hit the bloom indexes already on the attribute
maps (the plan, §3). Minting reads authz's epoch-cached snapshot (16-byte bitset, ADR-162) once per request.
The budget is under 5% of p50 store time, measured on the guard test corpus before step 2 and again at step 3.

### 8. Postgres row-level security: deferred

|                                                 | `Authorization` at the store | Postgres RLS (`SET LOCAL app.tenant`)                                               |
| ----------------------------------------------- | ---------------------------- | ----------------------------------------------------------------------------------- |
| Covers raw SQL (77 opt-outs)                    | ❌ lint and `@tenancy:` only | ✅                                                                                  |
| Covers ClickHouse, shares, memory twins         | ✅ one proof                 | ❌ Postgres only                                                                    |
| Carries actor, principal, permission, condition | ✅                           | ❌ tenant only                                                                      |
| A mismatch                                      | Loud, named refusal          | Silently empty result                                                               |
| Pooling cost                                    | none                         | Every query in a transaction with `set_config`: one extra round trip                |
| Cross-tenant operator work                      | A declared entry             | A `BYPASSRLS` role and a second pool                                                |
| Schema drift                                    | none                         | 118 tenant-bearing models, one policy each; the table owner bypasses unless `FORCE` |

`Authorization` is the mechanism. RLS is deferred (Alex, 2026-09-30); it may return later as a complement
for the tables raw SQL writes, if the raw-SQL baseline does not shrink.

## Rulings (Alex, 2026-09-30)

1. `Authorization` is an explicit named parameter, `authorization`, never `AsyncLocalStorage`.
2. The name is `Authorization`; the clash with the HTTP `Authorization` header is accepted.
3. There is no `audience` field: the store rule follows from `grants[].kind`.
4. The system principal is `system`, named from `SYSTEM_ACTORS`.
5. Postgres RLS is deferred.

## Rejected alternatives

| Name or shape                            | Why not                                                                                                                      |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `AuthorizationGrant`                     | Authz can grant you many: the object is the per-call union of grants, and "grant" is the stored row (ADR-110, `/api/grants`) |
| `Authorized`                             | The working name from the plan; the ruling chose the noun `Authorization`                                                    |
| `Passport`                               | Taken by ADR-162's signed wire token. A passport may later carry an `Authorization` across a process boundary                |
| An `audience` field                      | Redundant with `kind`, and the code already uses "audience" for who a grant is given to (`authz.ts:90`)                      |
| A `share` principal type                 | The code already has `project` (a reading project) and the `anyone` grant audience                                           |
| The route's one permission on own grants | A peer call reads other resources in the same scope; the full effective set is needed                                        |

## Consequences

- ✅ Isolation is checked against the caller, not against a query's shape, all the way down; a bare row
  id cannot cross tenants, and a repository never writes a tenant again.
- ✅ Project shares need no copying and no cross-tenant writes: `TenantId` never changes, and a share cannot
  cross organizations.
- ✅ The guard holds no feature knowledge, so `prisma-client → api-key-contract` goes (AR1).
- ✅ `authorization.scope.organizationId` answers most org-from-project lookups: scenario, prompt and
  experiment call `ProjectApi.getOrganizationId`, `findOrganizationId` and `findById` only for that, and those
  calls go away as each module moves.
- ⚠️ Every `*Api` operation, service and repository method gains a named `authorization` parameter.
  Contract signatures change module by module; the wire does not.
- ❌ Raw SQL stays outside the check until its baseline empties.

## Open questions

None. The rulings above settled the draft's questions.
