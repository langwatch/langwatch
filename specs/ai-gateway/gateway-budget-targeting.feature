Feature: Gateway budget targeting via a single inline scope
  As a platform engineer
  I want a gateway budget to declare its target exactly once
  So that the target cannot drift between two stored representations and the
  tenancy of a budget is unambiguous

  # Background
  #
  # GatewayBudget used to store its target twice: once as the canonical
  # (scopeType, scopeId) the query layer actually reads, and again as five
  # typed nullable foreign-key columns (organizationScopedId, teamScopedId,
  # projectScopedId, virtualKeyScopedId, principalUserId) kept in sync by a
  # fifty-line CHECK constraint and service-layer write logic. The typed FKs
  # existed only for referential integrity and cascade-on-delete; nothing
  # queried them.
  #
  # ADR-021 collapses this to the single-scope-per-row inline shape: an
  # organizationId anchor plus one (scopeType, scopeId). The typed FKs, their
  # cascade foreign keys, and the CHECK constraint are dropped. Cascade
  # cleanup moves to the service layer, consistent with the
  # no-foreign-key-constraints convention. Budgets have no real production
  # usage yet, so the migration can be aggressive.
  #
  # A budget keeps its own five-tier storage enum
  # (ORGANIZATION, TEAM, PROJECT, VIRTUAL_KEY, PRINCIPAL); those extra tiers
  # are budget-only and are deliberately not part of the shared three-tier
  # scope contract.

  Background:
    Given an organization "acme" with a team "platform" and a project "web-app"

  # ────────────────────────────────────────────────────────────────────────────
  # Single source of truth for the target
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A budget targets exactly one scope
    When a budget is created for team "platform"
    Then the budget stores a single TEAM-tier (scopeType, scopeId) pointing at "platform"
    And the budget has no separate typed scope columns to keep in sync

  @integration @unimplemented
  Scenario: A virtual-key budget uses the budget-only VIRTUAL_KEY tier
    When a budget is created for a virtual key
    Then the budget stores a single VIRTUAL_KEY-tier scope
    And the shared three-tier scope contract still rejects VIRTUAL_KEY as a value

  @unit @unimplemented
  Scenario: Request-time and bundle-materialized budget selection agree
    Given budgets exist at organization, team, and project tiers for "web-app"
    When the applicable budgets for a "web-app" request are computed at request time
    And the applicable budgets for "web-app" are computed while materializing the gateway bundle
    Then both paths return the same set of budgets
    # One shared helper computes applicability so the two call sites cannot
    # drift apart.

  # ────────────────────────────────────────────────────────────────────────────
  # Tenancy
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Listing budgets without an organization predicate throws
    When GatewayBudget.findMany is called with an empty WHERE
    Then the tenancy guard throws because no organizationId or row id was supplied

  @integration @unimplemented
  Scenario: A budget from another organization never applies to this org's traffic
    Given another organization "globex" has a project-tier budget
    When the applicable budgets for a "web-app" request in "acme" are computed
    Then the globex budget is not considered

  # ────────────────────────────────────────────────────────────────────────────
  # Cascade cleanup without database foreign keys
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Deleting a team removes its team-tier budgets
    Given team "platform" has a team-tier budget
    When team "platform" is deleted
    Then its team-tier budget is cleaned up by the service layer
    And no orphaned budget rows remain for the deleted team
