Feature: SCOPED_MODELS predicate-based tenancy guard
  As a multi-tenant platform operator
  I want every query against ModelProvider / ModelDefaultConfig and their
  scope-join tables to carry an explicit tenancy predicate
  So that no caller can ever silently walk across orgs by issuing a bare
  findMany or deleteMany

  # Background
  #
  # The original multitenancy guard in `dbMultiTenancyProtection.ts`
  # enforced one rule for every Prisma model: WHERE must include a
  # projectId. That mapped cleanly while every project-scoped table
  # carried a denormalised projectId column.
  #
  # The new ModelProvider + ModelDefaultConfig tables decoupled
  # ownership from project: a row lives at ORGANIZATION / TEAM / PROJECT
  # scope via a join table, and the projectId column is now best-effort
  # legacy compat. EXEMPT_MODELS used to opt these tables out of the
  # guard entirely, which silently re-opened the cross-tenant door.
  #
  # SCOPED_MODELS replaces the exempt path with per-shape predicate
  # validators. Every query must carry one of:
  #   1. row id (single-row lookup is its own tenancy proof);
  #   2. scope predicate (top-level scopeType+scopeId OR
  #      scopes.some.OR with each branch carrying scopeType+scopeId);
  #   3. parent FK (modelProviderId / configId for join tables); or
  #   4. legacy projectId column (best-effort compat).
  #
  # `scopeId` accepts both a string and a non-empty `{ in: string[] }`
  # so the org-admin "list across N teams + M projects" pattern stays
  # expressible. Empty in-lists are rejected; they constrain to zero
  # tenants and are indistinguishable from a missing predicate.

  Background:
    Given the SCOPED_MODELS guard is active
    And the models under guard are ModelProvider, ModelProviderScope, ModelDefaultConfig, ModelDefaultConfigScope

  # ────────────────────────────────────────────────────────────────────────────
  # ModelProvider family
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: A query without a tenancy predicate throws
    When I call ModelProvider.findMany with an empty WHERE
    Then the guard throws because no row id, scope predicate, or projectId was supplied
    # Bare findMany would return every tenant's providers; the guard
    # blocks at the Prisma middleware boundary so the call never lands.

  @integration
  Scenario: A query with scope predicate succeeds
    When I call ModelProvider.findMany with scopes.some.OR carrying { scopeType, scopeId } per branch
    Then the guard allows the call
    # This is the canonical access pattern used by the cascade resolver
    # and the listAccessibleForUser repository.

  @integration
  Scenario: A single-row lookup by id passes
    When I call ModelProvider.findFirst with { where: { id: "mp_01" } }
    Then the guard allows the call
    # The row id IS the tenancy proof for a single-row lookup; the
    # caller is asserting it already knows which row to read.

  @integration
  Scenario: A create without scopes throws
    When I call ModelProvider.create with data that has no scopes relation
    Then the guard throws
    # Every new row must carry its tenancy at creation time. Adding the
    # scope later would leave the row orphaned and queryable by anyone.

  @integration
  Scenario: A nested-create through the scopes relation passes
    When I call ModelProvider.create with data.scopes.create carrying a { scopeType, scopeId }
    Then the guard allows the call
    # The scope relation IS the tenancy declaration; the row is bound
    # to its tenant in the same transaction as its creation.

  # ────────────────────────────────────────────────────────────────────────────
  # ModelDefaultConfig family
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: List-shaped scopeId predicates pass the scope check
    Given an org admin who can read across N teams and M projects
    When ModelDefaultConfig.findMany is called with scopes.some.OR mixing { scopeId: "org_01" } and { scopeId: { in: ["t_a", "t_b"] } } and { scopeId: { in: ["p_a", "p_b"] } }
    Then the guard allows the call
    # `getDefaultModelsForProject` builds this exact predicate to fan
    # out the resolver across every team and project the caller can
    # see. The list IS the tenancy constraint; the guard accepts it
    # provided the in-array is non-empty.

  @integration
  Scenario: Empty in-lists are not a valid tenancy constraint
    When ModelDefaultConfig.findMany is called with scopes.some.OR containing only { scopeType, scopeId: { in: [] } }
    Then the guard throws
    # An empty in-list constrains to zero scopes, which is
    # indistinguishable from "no predicate" from a row-visibility
    # perspective. Forcing the caller to handle the empty case
    # explicitly keeps the safety contract honest.

  @integration
  Scenario: A single bad OR branch invalidates the whole scope predicate
    When ModelDefaultConfig.findMany is called with scopes.some.OR containing one branch missing scopeId
    Then the guard throws
    # The guard reads every OR branch; if any branch fails to
    # constrain a tenant, the union does too. We do not silently drop
    # the bad branch on the caller's behalf.

  # ────────────────────────────────────────────────────────────────────────────
  # Join tables (ModelProviderScope, ModelDefaultConfigScope)
  # ────────────────────────────────────────────────────────────────────────────

  @integration
  Scenario: Join-table bare findMany throws
    When I call ModelProviderScope.findMany with an empty WHERE
    Then the guard throws because no row id, parent FK, or scope predicate was supplied

  @integration
  Scenario: Join-table read with parent FK passes
    When I call ModelProviderScope.findMany with { modelProviderId: "mp_01" }
    Then the guard allows the call
    # The parent ModelProvider row already passed the tenancy check;
    # walking down to its scope attachments is safe.

  @integration
  Scenario: Join-table deleteMany requires a parent FK or scope predicate
    When I call ModelProviderScope.deleteMany with an empty WHERE
    Then the guard throws
    # Bare deleteMany would wipe every tenant's bindings; the guard
    # rejects the same shape it rejects on findMany.
