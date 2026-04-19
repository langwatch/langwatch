# ADR-016: Scoped Model Providers & Default Models

**Date:** 2026-04-19

**Status:** Accepted (v1 scope — shipped iter 107-108 across 9 commits: schema `83f687b1f`, repository walker `a56939520`, service `d51120a78`, DTO `e3e7d60f1`, tRPC `4f833fabc`, list badge `d3599c611`, form picker `15671dabd`, save-time alias validation `b7c880650`, ladder tests `e40600e15`)

## Context

Today, `ModelProvider` rows in LangWatch carry a single foreign key: `projectId`. Every provider credential (OpenAI, Anthropic, Azure, Bedrock, Vertex, Gemini, custom-OpenAI-compat) lives at project scope. `DefaultModel` configs follow the same shape.

This forces three frictions on enterprise dogfooding:

1. **Fan-out of credentials.** Ten projects in one org means ten copies of the same OpenAI key — rotation is a ten-page errand, and each copy drifts into its own rotation cadence in practice.
2. **No cross-project inheritance.** Creating a new project starts from "you have no provider configured" every single time, even when the org already owns a perfectly good OpenAI account that applies to every team.
3. **No team-level governance.** A team that shares a budget and a fine-tuning account today has no way to say "this team uses `team-openai-2`; other teams stay on the default." The only lever is project-level overrides.

RBAC already solved this at the principal level: `RoleBinding` rows carry a `(scopeType, scopeId)` that resolves to `ORGANIZATION | TEAM | PROJECT`, and permission checks walk org → team → project. Model providers and default model configs need the same shape.

Rchaves iter 107 dogfood feedback: the project-only shape is the single biggest structural friction for enterprise multi-project deployments. The AI Gateway's `GatewayProviderCredential` binding picker has to resolve this too, so the refactor lands on both surfaces.

## Decision

We will refactor `ModelProvider` and `DefaultModel` to use the same `(scopeType, scopeId)` principal shape that `RoleBinding` uses. Resolution walks **org → team → project, first-match-wins**, with the most-specific winning override semantics.

Concretely:

1. **Schema.** Add nullable `scopeType` (`ORGANIZATION | TEAM | PROJECT`) and `scopeId` (string) columns to both `ModelProvider` and `DefaultModel`. Keep the existing `projectId` column for the migration window; it is redundant with `(scopeType=PROJECT, scopeId=projectId)` but allows rollback.
2. **Migration.** A zero-data-loss backfill: every existing row gets `scopeType='PROJECT'` and `scopeId = current projectId`. The migration is reversible by dropping the new columns; data is untouched either way.
3. **Service layer.** New `getAllAccessible({ projectId, teamIds, orgId })` replaces ad-hoc `findMany({ projectId })` calls. Returns the union of rows visible at each scope the caller can see, tagged with the scope they came from so UIs can render "Org: acme" / "Team: acme-platform" badges.
4. **Resolver semantics.** For a specific consumer (e.g. "which provider serves this request from project X"), walk `PROJECT → TEAM → ORG`, return the first match. Overrides at narrower scopes win.
5. **Permission gating.** Creating a row at a given scope requires the matching manage permission on that principal: `modelProviders:manage:organization`, `:team`, `:project`. These map onto the existing `*_admin` roles — org-admin creates at any scope, team-admin at team or their projects, project-admin at project only.
6. **Gateway integration.** `GatewayProviderCredential.modelProviderId` already references a `ModelProvider` by id — no schema change is required on the gateway side. The binding picker (control-plane React) swaps its data source from `findMany({ projectId })` to `getAllAccessible`, and each row shows its scope badge.
7. **Data plane unchanged.** The Go gateway resolves `GatewayProviderCredential` by id in its bundle resolver. It does not care about the scope of the underlying `ModelProvider` — the join is identical. Zero hot-path changes. No sub-millisecond budget regression.
8. **Litellm / langevals untouched.** The existing `findLitellmProviderForModel` path and the langevals integration continue to work against project-scoped providers. The refactor is additive — existing callsites see exactly the same data they see today.
9. **Multitenancy middleware exemption.** `ModelProvider` joins the `EXEMPT_MODELS` list in `src/utils/dbMultiTenancyProtection.ts` alongside the gateway-family tables (`GatewayBudget`, `GatewayBudgetLedger`, `GatewayChangeEvent`, `GatewayAuditLog`, `VirtualKeyProviderCredential`, `GatewayCacheRule`). Rationale: the `OR` branches in `findAllAccessibleForProject` match on `scopeType` + `scopeId` rather than on `projectId` / `organizationId`, so the default `_guardProjectId` middleware rejects the query before it reaches Prisma. The new `(scopeType, scopeId)` pair is the tenancy boundary for this model; the exemption is how we express that to the middleware. Discovered as a runtime blocker during iter 108 bugbash (finding #29).

## Rationale / Trade-offs

**Mirroring `RoleBinding` vs. inventing a new pattern.** `RoleBinding` is already load-bearing and well-understood; ripping it off keeps the mental model small, reuses the scope-resolution machinery, and makes permission-gating trivial. A new pattern would be a second source of truth and a second place to reason about scope.

**Walk vs. inline-ACL.** The spec (§4) keeps visibility tied to the user's current role on the scope, rather than an opt-in per-provider ACL ("only these teams can bind against OpenAI-ent"). Inline ACL is the next lever if a customer asks; until then, org-scoped means every team/project in the org can bind. Cheaper, fewer moving parts, matches user intuition.

**Keep `projectId` column during the migration.** We could drop `projectId` in the same migration once `(scopeType, scopeId)` is populated. We don't. Rolling back to the previous schema has to be a one-liner `DROP COLUMN scopeType, scopeId`, not a data restore. We sunset `projectId` in a follow-up migration after the feature is stable.

**Scope change semantics (§5 in the spec).** Changing a provider's scope from narrow → wide is strictly additive: new projects/teams can now bind against it. Changing scope from wide → narrow archives out-of-scope bindings rather than silently revoking them — so auditors can reconstruct exactly what happened. We pay one confirmation dialog and one batched `GatewayChangeEvent` per archived binding for that audit clarity.

**Security property: visibility follows current role.** If a user is downgraded from team-admin to member, the next `getAllAccessible` call reflects that immediately. Session-scoped snapshots would be a second source of truth (and a security smell in a platform where role changes during an incident are common). Cost: one extra RBAC check on list. Acceptable.

## Consequences

**Positive.**
- Org admins configure OpenAI once; every project in the org inherits. Rotation is one-click at the org row.
- Team admins carve out team-specific accounts (think: team X has a fine-tuning contract, everyone else defaults to the org credential).
- AI Gateway binding picker surfaces all three scopes with clear badges — operators understand at a glance where a credential came from.
- New projects start usable instead of empty.
- Non-breaking: every existing project keeps its providers, keeps its behavior, keeps its bindings.

**Negative.**
- Settings → Model Providers has more surface area. The scope picker and the badge column add columns and clicks.
- RBAC permission surface grows (three new manage permissions per resource type). Documented in the spec §4; existing roles extend naturally.
- `getAllAccessible` walks three scopes per call. For a project in an org with 1 org-scoped + 10 team-scoped + 5 project-scoped providers, the result is 16 rows. Trivial in absolute terms; worth a SQL index on `(scopeType, scopeId)`.

**Neutral.**
- `DefaultModel` inherits the same ladder. Same migration shape, same walk, same UX. Reuse of the pattern means the DX stays consistent.

## References

- Feature spec: `specs/ai-gateway/model-provider-scoping.feature`
- ADR-001: RBAC (principal shape)
- ADR-005: Feature flags (rollout pattern — the new resolver can be behind `release_platform_scoped_providers_enabled` for a staged roll)
- Rchaves iter 107 dogfood feedback: channel #langwatch-ai-gateway, 2026-04-19
- Lane split: Lane B (@alexis) Prisma + service + UI; Lane A (@sergey) verifies gateway bundle-time resolution against scope chain; Lane C (@andr) specs + ADR + docs
