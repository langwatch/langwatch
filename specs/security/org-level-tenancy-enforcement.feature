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
  # SQL-layer organization guard
  # ────────────────────────────────────────────────────────────────────────────

  @integration @unimplemented
  Scenario: A query on an org-scoped model without an organization predicate throws
    When RoleBinding.findMany is called with an empty WHERE
    Then the organization guard throws because no organizationId or row id was supplied
    # Bare findMany would return every organization's bindings.

  @integration @unimplemented
  Scenario: A single-row lookup by id passes the organization guard
    When CustomRole.findFirst is called with a row id
    Then the organization guard allows the call

  @integration @unimplemented
  Scenario: Creating an org-scoped row without an organizationId throws
    When ApiKey.create is called without an organizationId
    Then the organization guard throws because the row must declare its owning organization

  @integration @unimplemented
  Scenario: An OR predicate spanning two organizations throws
    When RoutingPolicy.findMany is called with OR branches carrying two different organizationIds
    Then the organization guard throws because the query spans more than one organization
    # The single-organization invariant: every OR branch must carry
    # organizationId and they must all be identical.

  @unit @unimplemented
  Scenario: Every Prisma model belongs to exactly one tenancy regime
    When the tenancy-regime partition is checked
    Then every model is in exactly one of ORG_SCOPED_MODELS, SCOPED_MODELS, or EXEMPT_MODELS
    And a model in none of them fails the check

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
