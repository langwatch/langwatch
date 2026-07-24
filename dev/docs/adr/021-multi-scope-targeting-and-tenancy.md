# ADR-021: Multi-scope targeting and single-organization tenancy enforcement

**Date:** 2026-05-28

**Status:** Accepted

## Context

Over the last several iterations we taught three features to target multiple
scopes at once (ORGANIZATION, TEAM, PROJECT): `ModelProvider` (ADR-016),
`ModelDefaultConfig` (ADR-020), and `VirtualKey`. Each one lets a single logical
row apply at several scopes via a per-feature join table (`ModelProviderScope`,
`ModelDefaultConfigScope`, `VirtualKeyScope`) carrying `(scopeType, scopeId)`.
`dev/docs/best_practices/scoped-resources.md` documents the storage shape.

The pattern works, but it grew organically and is not yet a standard:

1. **The data model is not uniform.** `VirtualKey` carries a mandatory
   `organizationId` anchor column; `ModelProvider` and `ModelDefaultConfig` carry
   none, so their tenant is inferred purely from scope rows. `GatewayBudget`
   stores its target twice: once as `(scopeType, scopeId)` and again as five
   typed nullable foreign-key columns (`organizationScopedId`, `teamScopedId`,
   `projectScopedId`, `virtualKeyScopedId`, `principalUserId`) kept consistent by
   a fifty-line CHECK constraint that the query layer never reads.

2. **There is no shared scope contract.** The `{ scopeType, scopeId }` shape is
   re-declared in every tRPC router, every SDK service (the virtual-keys SDK even
   diverges to snake_case `scope_type` / `scope_id`), and the frontend
   (`ScopeChipPickerEntry`, `VirtualKeyScopeEntry`, `ScopeSelection`). The cascade
   walk (PROJECT → TEAM → ORGANIZATION) is re-implemented per feature.

3. **Organization-level tenancy is barely enforced.** The Prisma project-id guard
   (`guardProjectId`) is strong: every query on a project-scoped model must carry
   `projectId` or it throws. The organization-id guard
   (`dbOrganizationIdProtection.ts`) protects only three models
   (`OrganizationUser`, `Team`, `OrganizationInvite`). Roughly ten org-scoped
   models (`CustomRole`, `Group`, `RoleBinding`, `ApiKey`, `RoutingPolicy`,
   `AnomalyRule`, `AnomalyAlert`, `AiToolEntry`, `GatewayBudget`,
   `GatewayBudgetLedger`) sit in `EXEMPT_MODELS` with zero SQL-layer tenancy,
   relying entirely on the service layer remembering to filter.

4. **The tRPC organization path is weaker than the project path.** The project
   path derives the tenant from the resource: `resolveProjectPermission` loads
   `project.team.organization` and checks permissions against the org it found, so
   a forged `projectId` resolves to its real owner. The organization path trusts
   the caller-supplied `organizationId` and has a set of concrete holes: a legacy
   `TeamUser` fallback that promotes any team admin to org admin, `apiKey.ts`
   disabling RBAC entirely via `skipPermissionCheck`, a no-op `requireOrgAccess`
   in `gatewayBudgets.ts` that checks only that the org exists, and TEAM-scoped
   custom roles able to claim organization-level permissions.

We also want to add multi-scope targeting to **model costs** (today
`CustomLLMModelCost` is project-only, with platform defaults coming from a global
`llmModels.json`) and to standardize **gateway budgets**, then roll the pattern
out to a dozen further project-only configuration tables over time.

A hard product constraint frames everything below: **scoping is always within a
single organization.** No row may target two organizations. A team or project
referenced by a scope always belongs to exactly one org. This constraint is what
makes an `organizationId` column on every scoped table both correct and
enforceable.

## Decision

### 1. Data model: cardinality-driven, junction or inline, never polymorphic

The storage shape is chosen by the row's scope **cardinality**, not by feature:

- **Multi-scope-per-row** (one logical resource visible at several scopes at
  once) uses a **per-feature junction table** `<Resource>Scope { <resource>Id,
  scopeType, scopeId }` with a per-table `<Resource>ScopeType` enum. This is the
  existing `ModelProviderScope` shape. It applies to `ModelProvider`,
  `ModelDefaultConfig`, `VirtualKey`, and the future genuinely-1:N candidates.

- **Single-scope-per-row** (a row applies at exactly one scope) uses **inline
  `(scopeType, scopeId)` columns** on the row itself plus an `organizationId`
  anchor. This applies to `GatewayBudget`, `CustomLLMModelCost`, `RoleBinding`
  (already inline), and `LlmPromptConfig`.

We reject two alternatives the team weighed explicitly:

- **No JSON-array scope columns.** A `scopes: [{ scopeType, scopeId }]` JSON column
  forces array-contains queries this codebase does not use, is not indexable the
  way an OR-list over `(scopeType, scopeId)` is, and defeats relation typing. It
  also contradicts the principal-style one-row-per-scope convention.

- **No central polymorphic scope-assignment table.** A single
  `ScopeAssignment { resourceType, resourceId, scopeType, scopeId }` shared by all
  resources loses typed foreign keys (orphaned `resourceId` becomes
  schema-possible), loses `onDelete: Cascade` (every team or project delete must
  remember to clean up scope rows or silently leak), forces a superset scope enum
  that lets a `ModelProvider` row physically hold the `VIRTUAL_KEY` value that is
  meaningless for it, and concentrates all tenancy enforcement in one validator
  whose single bug leaks every resource at once.

### 2. A shared scope contract, with per-table storage enums

We add one value-type module, `langwatch/src/server/scopes/scope.types.ts`:

- `SCOPE_TIERS = ["ORGANIZATION", "TEAM", "PROJECT"]` and `ScopeTier`.
- `scopeAssignmentSchema` (Zod) and `ScopeAssignment` (`{ scopeType, scopeId }`).

This is the single source of truth for the wire format (tRPC input and SDK), the
UI (`ScopeChipPicker`), and resolvers. The wire format is camelCase end-to-end;
the SDK virtual-keys snake_case divergence is corrected, not preserved, and the
sync layer passes scope values through verbatim.

The **storage enums stay per-table** (`ModelProviderScopeType`,
`GatewayBudgetScopeType`, and so on). `GatewayBudget` legitimately needs
`VIRTUAL_KEY` and `PRINCIPAL`; `ModelProvider` must be physically unable to hold
them. The shared `SCOPE_TIERS` value-type is the API and UI contract (always the
three universal tiers); the storage enum is the table's own invariant. This is
the existing per-table-enum decision in `scoped-resources.md`, kept deliberately.

The cascade walk is captured once in
`langwatch/src/server/scopes/resolveScopeChain.ts`: it returns the
`PROJECT → TEAM → ORGANIZATION` chain for a project context,
most-specific-first. Junction readers apply it as
`scopes: { some: { OR: resolveScopeChain(ctx) } }`; inline readers apply it as
`{ organizationId, OR: resolveScopeChain(ctx) }`. The tie-break policy (which
matched row wins) stays in each feature's resolver, so the chain has one
definition while features keep their own resolution rules.

### 3. organizationId on every scoped table, enforced in the Prisma middleware

This is the headline tenant-leak fix. Every Prisma model belongs to exactly one
of three regimes, asserted by a partition test that fails CI if a model falls
through all three:

- **`ORG_SCOPED_MODELS`**: carries an explicit `organizationId` column.
  `guardOrganizationId` requires `organizationId` (or a tight unique key such as
  the row id) in every WHERE and every create payload, mirroring `guardProjectId`.
  This set grows from three to roughly thirteen, absorbing the org-scoped models
  that have zero SQL tenancy today.
- **`SCOPED_MODELS`**: accessed via `(scopeType, scopeId)` predicates (the junction
  half). `ModelProvider` and `ModelDefaultConfig` gain a mandatory
  `organizationId` anchor so the org guard can cover them too.
- **`EXEMPT_MODELS`**: genuinely not tenancy-sensitive (`Account`, `Session`,
  `User`, `FeatureFlag`). Shrinks as models move to the first regime.

The recursive WHERE validator gains a **single-organization OR invariant**: every
OR branch on an org-scoped model must carry `organizationId`, and all branch
`organizationId` values must be identical. This closes the documented gap where
`{ OR: [{ projectId }, { organizationId: "other_org" }] }` passed the per-branch
shape check without verifying the org belonged to the caller. The middleware has
no auth context and cannot verify membership (that is the tRPC layer's job), but
it can and now does reject an OR that spans two organizations.

`organizationId` is backfilled per table: from `Project.team.organizationId` for
project-anchored rows, and by resolving scope rows to their org for the junction
parents (`ORGANIZATION` scope → `scopeId`; `TEAM` → `Team.organizationId`;
`PROJECT` → `Project.team.organizationId`). The column is added nullable, verified
to have zero nulls in production, then set `NOT NULL` in a follow-up migration.

### 4. tRPC organization-guard hardening

We bring the org path up to the project path's bar:

- A hardened `organizationProcedure` builder runs `assertOrgMembership` (the
  pattern that only `personalVirtualKeys.ts` follows today) as a **default**, not a
  per-router add-on, throwing FORBIDDEN before any permission check when the caller
  has no `OrganizationUser` row.
- `resolveOrganizationFromResource({ resourceType, resourceId })` derives the org
  from the resource row for update and delete operations, so the caller-supplied
  `organizationId` is never trusted. A forged org id becomes structurally inert.
- The legacy `TeamUser` org-permission fallback is marked deprecated now and
  removed only after every org member is backfilled an explicit
  `ORGANIZATION`-scoped `RoleBinding` mirroring their team role, with an audit-log
  row per backfilled binding. Removing it before the backfill would lock people
  out.
- `apiKey.ts` `skipPermissionCheck` and the no-op `gatewayBudgets.ts`
  `requireOrgAccess` are removed and replaced by `organizationProcedure` plus
  resource-derived permission checks.
- `validateRoleBindingPermissions` rejects organization-level permissions in a
  non-`ORGANIZATION`-scoped binding at create and update time, and the EXTERNAL
  membership boundary is evaluated before custom-role permissions so a custom role
  can never lift an EXTERNAL member above its floor.

Gateway virtual-key authentication (lookup by hashed secret or by id) stays the
narrow exemption inside `SCOPED_MODELS`; it authenticates a key principal, not a
user session, and must not use `organizationProcedure`.

### 5. Per-feature outcomes

- **Model providers, default config, virtual keys**: keep their junction tables.
  `ModelProvider` and `ModelDefaultConfig` gain the missing `organizationId`
  anchor; `VirtualKey` is already correct and is the reference implementation.
- **Model costs**: `CustomLLMModelCost` gains `organizationId` plus inline
  `(scopeType, scopeId)`. Existing project rows convert to a PROJECT-tier inline
  scope. Resolution becomes PROJECT → TEAM → ORGANIZATION → static
  `llmModels.json` default, so org admins can push a cost policy down once instead
  of every project re-entering it. The platform defaults are treated as the
  organization-level baseline.
- **Gateway budgets**: drop the five typed FK columns, their cascade foreign keys,
  and the CHECK constraint; keep `organizationId` plus inline
  `(scopeType, scopeId)` as the single source of truth. Cascade cleanup moves to
  the service layer, consistent with the no-foreign-key-constraints convention.
  Budgets have no real production usage yet, so this migration can be aggressive.

## Rationale / Trade-offs

**Why cardinality, not feature, picks the shape.** A junction table is the right
choice when a row is genuinely visible at several scopes at once: it gives a real
typed relation, a per-table enum that cannot hold an invalid value, and cascade
cleanup on the join. For a row that only ever lives at one scope, a junction is
pure ceremony and inline columns are strictly better, with no join and no
read-time regrouping. The mistake to avoid is forcing one shape onto both
cardinalities, not the existence of two shapes.

**Why reject the central table the org chart seemed to want.** Centralizing every
scope assignment into one polymorphic table is appealing because it promises one
cascade resolver, one frontend abstraction, and three-line onboarding of new
tables. Those wins are real, but they are independently capturable without the
polymorphism, which is exactly what the shared `SCOPE_TIERS` value-type and
`resolveScopeChain` helper do. The polymorphic table buys those wins by
surrendering typed relations, schema-level cascade, per-table enum honesty, and
blast-radius containment, and by turning the tenancy validator into a single point
of total failure. The properties it gives up are the ones that actually protect
tenants here, so the trade is bad.

**Why the headline is tenancy, not the data-model fork.** None of the data-model
options bind `scopeId` to the caller's organization at the SQL layer on their own;
the real boundary today is the service layer deriving the org from the resource.
Adding `organizationId` everywhere and generalizing `guardOrganizationId` is
needed regardless of whether a table is junction or inline, so it is the change
that closes the leak, and the data-model standard is what keeps the system
type-safe and bounded while we make it.

**What we accept.** Inline `scopeId` and junction `scopeId` both stay `String`
with no database foreign key, consistent with the house no-FK convention; the
service layer asserts the scope entity belongs to the caller's org at write time,
and the `organizationId` column is the SQL backstop. Moving roughly ten models out
of `EXEMPT_MODELS` requires auditing each for existing cross-org OR queries before
enforcement is turned on. The legacy `TeamUser` fallback removal is a breaking
change gated on a backfill, so it lands last.

## Consequences

**Positive.**

- A bare `findMany({})` on any org-scoped model throws synchronously instead of
  returning every tenant's rows. Cross-org reads stop being one forgotten service
  filter away.
- A forged `organizationId` in a tRPC input is inert: permission is checked against
  the org derived from the resource.
- The scope shape has one definition. Routers, SDK, UI, and resolvers share
  `ScopeAssignment`; the cascade walk has one home in `resolveScopeChain`.
- `GatewayBudget` stops storing its target twice, so the two representations can no
  longer drift.
- Adding multi-scope to a new table is a known recipe: pick junction or inline by
  cardinality, add `organizationId`, register the regime, plug in the chain.

**Negative.**

- More migrations, several of them one-way (the two `NOT NULL` steps and the
  `GatewayBudget` FK drop). Each needs a production verification gate.
- The org-scoped `EXEMPT_MODELS` audit is real work and must precede enforcement.
- Removing the legacy `TeamUser` fallback depends on a `RoleBinding` backfill
  completing first.

**Neutral.**

- The standard is intentionally two shapes, not one. Reviewers must apply the
  cardinality test rather than reaching for a single universal table.
- The frontend converges on the shared `ScopeChipPicker` and `ScopeAssignment`;
  the bespoke inline scope sections are deleted as features migrate.

## References

- ADR-016: Scoped Model Providers, the junction pattern this standardizes
- ADR-020: Cascading default models, the SCOPED_MODELS guard precedent
- ADR-019: Repository-service layering
- ADR-001: RBAC, the original principal and scope shape
- `dev/docs/best_practices/scoped-resources.md`: storage, read-grouping, UI,
  and (extended here) the cardinality rule and tenancy regimes
- `specs/security/org-level-tenancy-enforcement.feature`
- `specs/model-providers/model-cost-scoping.feature`
- `specs/ai-gateway/gateway-budget-targeting.feature`
- `langwatch/src/server/scopes/scope.types.ts`,
  `langwatch/src/server/scopes/resolveScopeChain.ts`: the shared contract
