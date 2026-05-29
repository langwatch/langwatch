# Scoped Resources Pattern

How to store and surface a setting that can apply at the organization, team, or project level — and have the UI handle "one rule, many scopes" without a wall of selectors.

## When this pattern applies

Anytime a row needs to answer "who does this apply to?" with a scope (organization, team, project, sometimes principal or virtual key). Examples in the codebase:

- **`RoleBinding`** — RBAC bindings, who has what role at which scope
- **`ModelProvider` + `ModelProviderScope`** — provider credentials shared across scopes
- **`ModelDefault`** — role/feature-level default model assignments
- **`GatewayBudget`** — AI Gateway spending limits per scope

If you're adding a new setting and you've started reaching for three columns (`organizationDefault`, `teamDefault`, `projectDefault`) or three rows (one per scope per setting), stop and use this pattern instead.

## Choosing the shape: cardinality decides

There are exactly two storage shapes, and the row's scope **cardinality** picks one. Do not invent a third (no JSON-array scope columns, no central polymorphic scope-assignment table; ADR-021 explains why both lose).

- **Single-scope-per-row** (a row applies at exactly one scope): use **inline `(scopeType, scopeId)` columns** on the row, plus `organizationId`. Examples: `GatewayBudget`, `CustomLLMModelCost`, `RoleBinding`. This is the storage shape shown directly below.
- **Multi-scope-per-row** (one logical resource visible at several scopes at once): use a **per-feature junction table** `<Resource>Scope { <resource>Id, scopeType, scopeId }`. Examples: `ModelProvider` + `ModelProviderScope`, `ModelDefaultConfig` + `ModelDefaultConfigScope`, `VirtualKey` + `VirtualKeyScope`. The parent row carries `organizationId`; the junction carries `(scopeType, scopeId)`.

Both shapes share the same scope contract, the same cascade resolver, the same UI primitive, and the same tenancy regimes. Only the physical layout differs.

## Storage shape

One row per scope. Two columns identify the scope: a typed enum `scopeType` and a string `scopeId`.

```prisma
enum MyResourceScopeType {
  ORGANIZATION
  TEAM
  PROJECT
}

model MyResource {
  id        String              @id @default(nanoid())
  scopeType MyResourceScopeType
  scopeId   String
  // ...the actual setting columns
  @@index([scopeType, scopeId])
}
```

**Rules:**

1. **One enum per table.** Each scoped table declares its own `<Resource>ScopeType` enum even if the values look identical to another table's. `GatewayBudget` needs `VIRTUAL_KEY` and `PRINCIPAL`; `ModelProvider` does not. A shared enum would either grow to a superset that doesn't apply to every table, or force tables to accept invalid values. Per-table enums keep each table's invariants honest.
2. **`scopeId` stays `String`.** It points at `Organization.id`, `Team.id`, or `Project.id` depending on `scopeType`. The query layer enforces the relationship.
3. **Typed FK columns for cascade are optional.** `GatewayBudget` adds `organizationScopedId`, `teamScopedId`, `projectScopedId` nullable FKs alongside `(scopeType, scopeId)` so a `Cascade` delete works automatically when the scoping entity goes away. Use this when the scoped row holds data that must die with its parent (budgets are useless without their org). Skip it for join-table-like rows (`ModelProviderScope`) where cleanup is fine at the parent level.
4. **Every scoped table carries `organizationId` and is tenancy-guarded.** Scoping is always within one organization, so a scoped row always has exactly one owning org. Give the table (or its junction parent) a mandatory `organizationId` column and register it in a tenancy regime, never in `EXEMPT_MODELS`. See "organizationId anchor and tenancy regimes" below. The old advice to drop scoped tables into `EXEMPT_MODELS` is what ADR-021 reverses: an exemption lets a bare `findMany({})` walk every tenant.

### Multi-scope-per-row: the junction variant

When one logical resource is visible at several scopes simultaneously, the scope rows move to a junction table and the parent keeps the actual setting plus the `organizationId` anchor:

```prisma
enum MyResourceScopeType {
  ORGANIZATION
  TEAM
  PROJECT
}

model MyResource {
  id             String               @id @default(nanoid())
  organizationId String                // the single owning org (tenancy anchor)
  // ...the actual setting columns
  scopes         MyResourceScope[]
  @@index([organizationId])
}

model MyResourceScope {
  id           String              @id @default(nanoid())
  myResourceId String
  myResource   MyResource          @relation(fields: [myResourceId], references: [id], onDelete: Cascade)
  scopeType    MyResourceScopeType
  scopeId      String
  @@unique([myResourceId, scopeType, scopeId])
  @@index([scopeType, scopeId])
  @@index([myResourceId])
}
```

The per-table enum still applies. The `onDelete: Cascade` on the junction is the reason a junction beats a central polymorphic table: scope rows die with their parent automatically.

## Read shape: group on read

A user wants to think in terms of "rules" — "Default model is `openai/gpt-5.5` for `Org Acme + Team Platform + Project web-app`". Don't make them think in terms of rows.

The read endpoint groups every row that shares the non-scope key (e.g. `(role, featureKey, model)` for `ModelDefault`) into one logical assignment with a `scopes: [...]` array:

```ts
type Assignment = {
  id: string;          // stable group key
  role: ModelRole;
  featureKey: string | null;
  model: string;
  scopes: Array<{ type: "ORGANIZATION" | "TEAM" | "PROJECT"; id: string; name: string }>;
};
```

The grouping is one SQL query (`SELECT ... WHERE scopeId IN (...)`) plus an in-memory `Map`. Cheap on read. The UI gets a flat list of "rules" it can render with a single primitive instead of three sections.

The grouped row's `id` is a stable hash of its non-scope keys (e.g. `${role}::${featureKey ?? ""}::${model}`) so the UI can target updates without server round-trips for an opaque cursor.

## UI shape: ScopeChipPicker

One shared primitive — `langwatch/src/components/settings/ScopeChipPicker.tsx` — renders the multi-select of scopes the caller can write at. Every settings page that touches scoped resources uses it. Don't roll a new picker.

The drawer/form that authors a new rule:

```
+ Add override
   └─ drawer: [ScopeChipPicker] → [value selector]
              [+ Add more scope]
              [Save]
```

On save, the drawer's "diff against original" logic emits one create/delete per added/removed chip, all targeting the same scoped-resource write endpoint (e.g. `setRoleAssignmentForScope({ scopeType, scopeId, ... })`). Each row's write authz is checked at its own scope (a project-level admin cannot push a default up to org).

## RBAC: filter `available` server-side

The read payload returns the universe of writable scopes alongside the assignments:

```ts
{
  available: {
    organization?: { id, name } | null,  // present if caller has organization:manage
    teams: [{ id, name }],               // teams where caller has team:manage
    projects: [{ id, name, teamId }],    // projects where caller has project:update
  }
}
```

The chip picker only offers scopes from `available`. The server still re-authz's every write — `available` is a hint for the UI, not a security boundary — but filtering up front prevents the UI from inviting a write that would 403 on save.

## The shared scope contract

The `{ scopeType, scopeId }` shape has one definition for the wire format, the UI, and resolvers: `langwatch/src/server/scopes/scope.types.ts`.

```ts
import { SCOPE_TIERS, scopeAssignmentSchema, type ScopeAssignment } from "~/server/scopes/scope.types";

// tRPC input: scopes: z.array(scopeAssignmentSchema).min(1)
// single-field input: scopeType: z.enum(SCOPE_TIERS)
```

Rules:

- **camelCase end-to-end.** `scopeType` / `scopeId` everywhere, including the TypeScript SDK. Do not introduce snake_case `scope_type` / `scope_id`. The sync layer passes scope values through verbatim and never defaults or transforms them.
- **The shared type is the three universal tiers only.** Budget-only tiers (`VIRTUAL_KEY`, `PRINCIPAL`) are NOT in `SCOPE_TIERS`; they live on `GatewayBudget`'s own storage enum. The shared value-type is the API/UI contract; the per-table enum is the storage invariant.
- **The cascade walk has one home.** `langwatch/src/server/scopes/resolveScopeChain.ts` returns the `PROJECT → TEAM → ORGANIZATION` chain (most-specific-first) for a project context. Apply it as `scopes: { some: { OR: resolveScopeChain(ctx) } }` (junction) or `{ organizationId, OR: resolveScopeChain(ctx) }` (inline). The tie-break policy (which matched row wins) stays in the feature's own resolver.

## organizationId anchor and tenancy regimes

Every Prisma model sits in exactly one of three regimes (a partition test fails CI if a model falls through all three). See `langwatch/src/utils/dbMultiTenancyProtection.ts` and `dbOrganizationIdProtection.ts`.

- **`ORG_SCOPED_MODELS`**: carries an explicit `organizationId` column. The org guard requires `organizationId` (or a tight unique key like the row id) in every WHERE and every create payload. Inline scoped tables and junction parents live here.
- **`SCOPED_MODELS`**: accessed via `(scopeType, scopeId)` predicates (junction tables and their parents). Junction parents also carry `organizationId` so the org guard covers them.
- **`EXEMPT_MODELS`**: genuinely not tenancy-sensitive (`Account`, `Session`, `User`, `FeatureFlag`). A scoped table never belongs here.

The WHERE validator enforces a **single-organization OR invariant**: every OR branch on an org-scoped model must carry `organizationId`, and all branch values must be identical. A query whose OR spans two orgs throws. The middleware cannot verify membership (no auth context); that is the tRPC layer's job.

After editing the regime lists, restart `pnpm dev`: the `$use` closures do not hot-reload. A new org-scoped model without a regime entry makes every query throw, so pair the migration with the regime edit and a regression test.

## tRPC: derive the tenant from the resource

Project-level endpoints are strong because the tenant is derived from the resource (`resolveProjectPermission` loads `project.team.organization`). Organization-level endpoints must match that bar:

- Use the hardened `organizationProcedure`, which asserts `OrganizationUser` membership by default before any permission check. Do not hand-roll membership checks per router, and never disable RBAC with `skipPermissionCheck`.
- For update and delete by resource id, derive the org from the row via `resolveOrganizationFromResource({ resourceType, resourceId })` and check permission against the derived org. Never trust a caller-supplied `organizationId`.
- A non-`ORGANIZATION`-scoped `RoleBinding` may not carry organization-level permissions. The EXTERNAL membership floor is evaluated before custom-role permissions.
- Gateway virtual-key authentication (lookup by hashed secret or id) is the one exemption: it authenticates a key principal, not a user session, and must not use `organizationProcedure`.

## When NOT to use this pattern

- **Single-scope settings.** If the value only ever applies at one specific scope (e.g. `Organization.billingEmail`), put it as a column on that table. Scoped resources are for "this setting could apply at any of several levels".
- **Principal-bearing rows.** `RoleBinding` carries a principal (`userId`/`groupId`/`apiKeyId`) AND a scope. That's a different shape. Use this pattern for the scope half, but keep the principal columns separate.

## Migrations: when moving from per-scope columns

When migrating away from columns like `defaultModel` / `teamDefaultModel` / `projectDefaultModel`:

1. Create the new table with the `(scopeType, scopeId, ...)` shape.
2. `INSERT ... SELECT` from the legacy columns into the new table. One INSERT per legacy column so the migration is auditable.
3. Keep the resolver reading from the new table FIRST and the legacy columns as a fallback for one release. Code paths that write keep writing only to the new table.
4. Verify no writes hit legacy columns in production (search logs, add a tripwire if needed).
5. Drop the legacy columns in a follow-up migration.

Migrations are immutable once deployed (see `feedback_never_modify_deployed_migrations`). New migrations not yet in production CAN be edited before merging.

## Reference implementations

- **Decision record:** `dev/docs/adr/021-multi-scope-targeting-and-tenancy.md`
- **Shared contract:** `langwatch/src/server/scopes/scope.types.ts` (`ScopeAssignment`, `SCOPE_TIERS`) and `resolveScopeChain.ts`
- **Storage + read grouping:** `langwatch/src/server/api/routers/modelProviders.ts` → `getDefaultModelsForProject`
- **Write per-scope:** `langwatch/src/server/modelProviders/modelDefaults.service.ts`
- **Multi-scope authz:** `langwatch/src/server/modelProviders/modelProvider.authz.ts` → `assertCanManageAllScopes`
- **UI primitive:** `langwatch/src/components/settings/ScopeChipPicker.tsx`
- **Cascade-FK variant:** `GatewayBudget` model in `prisma/schema.prisma`
- **Spec:** `specs/model-providers/role-based-default-models.feature`
