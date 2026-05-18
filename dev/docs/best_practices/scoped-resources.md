# Scoped Resources Pattern

How to store and surface a setting that can apply at the organization, team, or project level — and have the UI handle "one rule, many scopes" without a wall of selectors.

## When this pattern applies

Anytime a row needs to answer "who does this apply to?" with a scope (organization, team, project, sometimes principal or virtual key). Examples in the codebase:

- **`RoleBinding`** — RBAC bindings, who has what role at which scope
- **`ModelProvider` + `ModelProviderScope`** — provider credentials shared across scopes
- **`ModelDefault`** — role/feature-level default model assignments
- **`GatewayBudget`** — AI Gateway spending limits per scope

If you're adding a new setting and you've started reaching for three columns (`organizationDefault`, `teamDefault`, `projectDefault`) or three rows (one per scope per setting), stop and use this pattern instead.

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
4. **Multitenancy guard exemption.** Scoped tables are typically organization-level, so the project-id middleware (`langwatch/src/utils/dbMultiTenancyProtection.ts`) rejects queries without `projectId`. Add the new model to `EXEMPT_MODELS` with a comment explaining the access path, and re-enforce tenancy one level up in the service layer (look up the project, derive its team + org, scope the OR clauses to those specific IDs).

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

- **Storage + read grouping:** `langwatch/src/server/api/routers/modelProviders.ts` → `getDefaultModelsForProject`
- **Write per-scope:** `langwatch/src/server/modelProviders/modelDefaults.service.ts`
- **Multi-scope authz:** `langwatch/src/server/modelProviders/modelProvider.authz.ts` → `assertCanManageAllScopes`
- **UI primitive:** `langwatch/src/components/settings/ScopeChipPicker.tsx`
- **Cascade-FK variant:** `GatewayBudget` model in `prisma/schema.prisma`
- **Spec:** `specs/model-providers/role-based-default-models.feature`
