Feature: Organization-level multi-tenancy enforcement
  As a multi-tenant platform operator
  I want organization-scoped data guarded at the SQL layer and organization
  endpoints to derive the tenant from the resource
  So that no caller can read or write across organizations by omitting a
  filter or forging an organizationId

  # Background
  #
  # The project-id Prisma guard is strong: every query on a project-scoped
  # model must carry projectId or it throws. The organization-id guard
  # protected only three models, leaving roughly ten org-scoped models
  # (CustomRole, Group, RoleBinding, ApiKey, RoutingPolicy, AnomalyRule,
  # AnomalyAlert, AiToolEntry, GatewayBudget, GatewayBudgetLedger) with no
  # SQL-layer tenancy, relying entirely on the service layer remembering to
  # filter.
  #
  # ADR-021 generalizes the organization guard to mirror the project guard,
  # puts every model in exactly one tenancy regime, and hardens the tRPC
  # organization path to derive the tenant from the resource rather than
  # trusting caller input. Scoping is always within one organization, so no
  # row or query may span two.

  Background:
    Given an organization "acme" and a separate organization "globex"
    And a caller who is a member of "acme" but not of "globex"

  # ────────────────────────────────────────────────────────────────────────────
  # Data isolation between organizations
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: Reading org-scoped data never crosses organizations
    Given roles, api keys, and routing policies exist in both "acme" and "globex"
    When code reads any of those without naming an organization
    Then the read is refused rather than returning every organization's rows
    # The Prisma guard rejects a query on an org-scoped model that carries
    # no organizationId (or single-row id) predicate.

  @integration @unimplemented
  Scenario: A single record can still be looked up directly by its id
    When code reads one custom role by its id
    Then the read is allowed
    # A by-id lookup is its own tenancy proof; the caller already named the row.

  @integration @unimplemented
  Scenario: Saving an org-scoped record without an owner is refused
    When code saves an api key without naming an owning organization
    Then the save is refused

  @integration @unimplemented
  Scenario: A single read cannot mix two organizations
    When code reads routing policies for two different organizations in one query
    Then the read is refused
    # The single-organization invariant: a query may not span more than one
    # organization, so every alternative in it must name the same one.

  @unit @unimplemented
  Scenario: A new org-scoped table is covered by the guard or the build fails
    Given a new table that holds organization-scoped data
    When it is added without being placed under the organization guard
    Then the tenancy coverage check fails
    # Every model must fall under exactly one tenancy regime; an uncovered
    # model is a build failure, not a silent leak.

  # ────────────────────────────────────────────────────────────────────────────
  # tRPC organization guard
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A non-member is rejected before any business logic runs
    When the caller invokes an organization endpoint for "globex"
    Then the request is forbidden because the caller is not a member of "globex"
    And the rejection happens before any permission or resource check

  @integration @unimplemented
  Scenario: A forged organizationId in the input is ignored in favor of the resource owner
    Given a gateway budget that belongs to "globex"
    When the caller updates that budget while supplying organizationId "acme" in the input
    Then permission is checked against "globex", the budget's real owner
    And the update is forbidden because the caller is not a member of "globex"

  # ────────────────────────────────────────────────────────────────────────────
  # No bypasses, no escalation
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: API key endpoints enforce RBAC instead of bypassing it
    Given a caller who is a member of "acme" without api-key permissions
    When the caller lists api keys for "acme"
    Then the request is forbidden by the permission check

  @integration @unimplemented
  Scenario: A team-scoped custom role cannot claim organization-level permissions
    When a TEAM-scoped role binding is created with an organization-level permission
    Then the binding is rejected

  @integration @unimplemented
  Scenario: An EXTERNAL member cannot be elevated past its floor by a custom role
    Given an EXTERNAL member of "acme" assigned a custom role granting organization manage
    When the member's effective permissions are resolved
    Then the member does not gain organization manage
    And the member stays within the EXTERNAL permission floor
