## ADR-020: Cascading default models with one policy attached to N scopes

**Date:** 2026-05-18

**Status:** Accepted (shipped on PR #4073 across the model-providers branch, tip `b9ed0f441` at the time of writing)

## Context

ADR-016 introduced scoped `ModelProvider` rows. The first cut of the `DefaultModel` companion table inherited the same row shape and walked the same `PROJECT → TEAM → ORGANIZATION` ladder, so a "default Fast model for AI search" sat at exactly one (scopeType, scopeId) and the resolver returned the most-specific hit.

Three rough edges turned up during the 2026-05-15 dogfood:

1. **Per-(role, featureKey, scope) rows.** Setting one consistent set of models for "Team Platform + Team Research + Project edge" meant writing three separate rows that all carried the same model id. Editing one without the others drifted them apart. The UI had to grow scope-pickers per row, and the storage layer had no representation of "this is one rule that applies to three places."
2. **Inheritance had no encoding.** A row either pinned a model at a scope or it didn't exist. A user who wanted "use the team default but override AI-search for THIS project only" had to know that the absence of the role row was equivalent to inheritance. Trying to make this explicit on the wire led to a sentinel-`"inherit"` string that the resolver then had to special-case at every walk step.
3. **The UI didn't map to how users actually think about defaults.** The flat per-scope-per-role-per-feature row shape forced a settings page where every cell was a separate `select` element. Users describe this surface as "we want gpt-5.5 for prompt creation across the org, except for these two teams which use claude", one policy with multiple scope attachments, not a table-row-per-scope.

The structural friction was clear: storage and UI both wanted **one policy that attaches to many scopes** and had **a single JSON payload** carrying the model-per-role mapping. Absence of a key in that JSON meant "inherit from the next scope up." Editing the policy lived in one place; scope attachments were a separate n:n join.

A second issue surfaced on 2026-05-18: the original implementation put the new tables in `EXEMPT_MODELS` (the multitenancy guard's bypass list) because neither table carries a `projectId` column. Rchaves correctly pointed out that an exemption lets a programmer accidentally walk every tenant's defaults with a bare `prisma.modelDefaultConfig.findMany({})`. The guard needed a stricter alternative, not a bypass.

## Decision

We replace the row-per-(scope, role, featureKey) `ModelDefault` shape with a cascading JSON policy attached to N scopes via a dedicated join, and we add a per-model predicate validator to the multitenancy guard so neither parent nor join can be queried without a tenancy clause.

Concretely:

1. **Schema.** `ModelDefaultConfig` is the parent row: `{ id, config: Json, authorId?, createdAt, updatedAt }`. No `projectId` column. The `config` payload maps role names (`DEFAULT` | `FAST` | `EMBEDDINGS`) and stable feature keys (`prompt.create_default`, `traces.ai_search`, `analytics.topic_clustering_llm`, ...) to model ids. **Absence of a key means inherit**, no sentinel string is stored.
2. **Join.** `ModelDefaultConfigScope` is the n:n join carrying `(configId, scopeType, scopeId)` with a unique `(configId, scopeType, scopeId)` index. `scopeType` is the `ModelDefaultScopeType` Postgres enum (`ORGANIZATION | TEAM | PROJECT`) matching `RoleBindingScopeType`, `GatewayBudgetScopeType`, and `ModelProviderScopeType` per the per-table-enum convention.
3. **Cascade resolver.** `resolveModelForFeature(featureKey, ctx)` walks `PROJECT → TEAM → ORGANIZATION`. Within each tier, configs attached at that tier are sorted by `createdAt` descending. The resolver picks the first config with the **feature key** set as `source: "feature_override"`; if none has it, the first with the **role** set as `source: "role_default"`. Feature-key match beats role-key match within a tier; lower tier always beats higher tier regardless of recency. When the cascade returns nothing, the resolver falls back to the legacy B2 scalar columns (one-release read-only compat) and finally to a baked-in role constant tagged `source: "system", scope: "system"`, never "built-in", so the UI labels match the env-var-fed model providers convention.
4. **Inherit via absence.** The drawer encodes the user picking "Inherit (from organization) [openai/gpt-5.5]" as **deletion** of the key from the in-progress config. Nothing is stored that says "inherit". The merge logic stays trivial: walk the cascade, return the first hit.
5. **Onboarding seed.** The first model provider an organization enables seeds **one** `ModelDefaultConfig` at organization scope with `DEFAULT` | `FAST` | `EMBEDDINGS` populated from `buildSeedPlanForProvider`'s latest-flagship, mini, embedding heuristic. A user-picked default from the same submit overwrites the heuristic. Subsequent provider adds don't re-seed.
6. **Multitenancy.** Drop the `EXEMPT_MODELS` bypass for both tables. Add a `SCOPED_MODELS` map in `src/utils/dbMultiTenancyProtection.ts` with per-model predicate validators. `ModelDefaultConfig` queries must carry one of (row id, scope predicate, `AND`-wrapped equivalent); `ModelDefaultConfigScope` queries must carry one of (row id, `configId`, scope predicate). Creates require nested `scopes` on the parent or `(configId, scopeType, scopeId)` on the join. Bare `findMany({})` throws with a precise error message. The same pattern applies to `ModelProvider` + `ModelProviderScope`, both moved out of `EXEMPT_MODELS` in the same refactor.
7. **UI primitive reuse.** The override drawer uses the same `ScopeChipPicker` primitive the model-provider drawer ships, so a user editing a default-models policy and a user editing a provider see identical scope-attachment ergonomics. The settings table renders one row per `ModelDefaultConfig` with all its scope chips inline.

## Rationale / Trade-offs

**Why a JSON payload instead of one row per (role, feature).** The user's mental model is "this rule pins these models across these scopes." Encoding that as one row with a JSON map mirrors the user's grouping; encoding it as N rows forces the resolver and the UI to re-aggregate on every read. The JSON shape also makes "add a new feature key" a one-line registry change with no migration. The cost is no per-key foreign-key constraints, the registry is enforced at write time by the service layer, not by the database.

**Why absence equals inherit.** A sentinel string ("INHERIT" or null) would force every reader to special-case it, every writer to know the magic value, and every migration to handle the legacy unset case. With absence-as-inherit, the merge logic is "walk the cascade, return the first hit," and the drawer's "Inherit (from X)" choice is implemented by deleting the key, which the JSON column already supports natively.

**Why one policy attaches to N scopes.** "Production models for Team Platform + Team Research + Project edge" should be one rule, not three. With the n:n join, editing the model id touches one config row; the three attachments come along for free. Removing one scope chip removes one join row. The principal-style scope-row pattern documented in `dev/docs/best_practices/scoped-resources.md` makes this the third place we've solved the same shape (`RoleBinding` first, `ModelProviderScope` second).

**Why drop EXEMPT_MODELS in favor of SCOPED_MODELS.** `EXEMPT_MODELS` is a binary switch: either the table participates in the guard or it doesn't. For tables that don't have a `projectId` column but ARE tenancy-sensitive, that binary forces the wrong choice, every query bypasses the guard. The SCOPED_MODELS map keeps the guard active but lets each table declare what equivalent-of-projectId is acceptable. The blast radius of an accidental cross-tenant query drops from "any query against this table walks every tenant" to "any query against this table without a scope predicate throws synchronously."

**Why keep the legacy B2 scalar columns for one release.** Existing call sites still read `project.defaultModel`, `team.topicClusteringModel`, etc. Removing those columns in the same PR would have either broken every caller or required wiring `resolveModelForFeature` into every existing reader at the same time. The resolver reads the legacy columns as a fallback so writes can drain off them gradually. A follow-up sweep PR replaces every reader and drops the columns.

**Why the `"system"` source name.** The baked-in constant fallback existed in the prior shape too, labelled "built-in default" in the drawer. Users have no concept of "built-in", they configure model providers, some of which are labelled `System` (env-var-fed). Naming the fallback `source: "system"` and rendering "Inherit (from System)" makes the UI consistent with the existing model-providers vocabulary.

## Consequences

**Positive.**
- Setting one model across many scopes is one storage row with N scope attachments. Editing the model id touches one place; renaming a scope or removing a chip is one delete.
- The merge logic is trivial. Absence of a key means inherit; the resolver walks PROJECT → TEAM → ORGANIZATION → legacy → system. No sentinel strings anywhere on the wire.
- The settings UI maps one-to-one onto storage. One row in the table = one `ModelDefaultConfig`. One scope chip = one join row.
- Multitenancy gets stricter, not weaker. A bare `findMany({})` on either table throws synchronously instead of returning every tenant's data.
- The principal-style scope pattern is reused, not reinvented. `ScopeChipPicker` is the shared UI primitive; the per-table-enum convention is consistent across `RoleBinding`, `GatewayBudget`, `ModelProvider`, `ModelDefaultConfig`.

**Negative.**
- The JSON config payload has no per-key foreign-key constraints. A typo in a feature key persists silently in the JSON until the resolver tries to read it. The feature registry's `featureByKey` throws on unknown keys at module load on the dev side, but a stale config can still carry an orphan key.
- Adding a fifth scope tier (a hypothetical "workspace") means touching the resolver's tier walk and the scope picker. Not a current concern but worth flagging.
- The legacy B2 scalar columns hang around for one release. New code MUST go through `resolveModelForFeature`; the sweep PR enforces this once every reader migrates.

**Neutral.**
- The cascade walk costs at most three Postgres queries per resolution (one per tier), each indexed on `(scopeType, scopeId)` via the join. In practice the resolver loads every attached config in one query and partitions client-side, so the actual cost is `1 query + O(configs)` partitioning, which is cheap.
- The default-models settings page becomes its own surface below the model-providers list, hidden when zero providers are configured. The onboarding flow seeds the org-scope config in the same submit that enables the first provider, so a fresh organization with one configured provider always has a working default.

## References

- ADR-016: Scoped Model Providers, the principal-style scope-row pattern this ADR extends
- ADR-001: RBAC, the original principal-shape decision
- `specs/model-providers/model-default-config-cascade.feature`, resolver contract
- `specs/model-providers/role-based-default-models.feature`, settings UI contract
- `specs/model-providers/missing-model-popup.feature`, toast surface when the resolver throws `ModelNotConfiguredError`
- `dev/docs/best_practices/scoped-resources.md`, storage + read-grouping + UI primitive pattern
- PR #4073: implementation, screenshots, dogfood iteration history
