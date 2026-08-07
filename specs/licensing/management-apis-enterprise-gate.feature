Feature: Management APIs require an Enterprise plan

  As a LangWatch customer below the Enterprise plan
  I want the management APIs to refuse me clearly and say what to do about it
  So that I learn the feature is a plan away rather than that my request is broken

  Background:
    Given an organization on a plan below Enterprise
    And I am authenticated with an organization-scoped API key holding every permission these endpoints check

  # The refusal is on the plan, not on the request, so it comes back as 402 with
  # a stable code and the guidance a caller needs: which feature was asked for,
  # what to do next, and where to read about it. Because every permission is
  # already held, a 403 here would be a bug in the gate rather than an access
  # decision.
  #
  # The API keys family stays ungated: it is an existing public surface, and the
  # custom-role machinery it can reference is gated where roles are created.

  # ============================================================================
  # The gate, family by family
  # ============================================================================

  @integration
  Scenario: The organization API requires an Enterprise plan
    When I fetch the organization
    Then the request is refused with code enterprise_plan_required and status 402
    And the refusal names the feature that was asked for
    And it carries upgrade guidance and a documentation link

  @integration
  Scenario: The roles API requires an Enterprise plan
    When I list custom roles
    Then the request is refused with code enterprise_plan_required and status 402

  @integration
  Scenario: The role bindings API requires an Enterprise plan
    When I list role bindings
    Then the request is refused with code enterprise_plan_required and status 402

  @integration
  Scenario: The SCIM tokens API requires an Enterprise plan
    When I list SCIM tokens
    Then the request is refused with code enterprise_plan_required and status 402

  @integration
  Scenario: Group endpoints require an Enterprise plan
    When I list groups
    Then the request is refused with code enterprise_plan_required and status 402
    And no group is created, changed or disclosed

  # ============================================================================
  # Credentials minted under Enterprise do not outlive it
  # ============================================================================
  #
  # A SCIM bearer token is checked on every directory-sync call, so an
  # organization that leaves Enterprise keeps a working sync unless the plan is
  # part of that check. Directory sync then quietly outlives the entitlement it
  # was sold under.

  @integration
  Scenario: A SCIM bearer token stops working when the plan lapses
    Given a SCIM token minted while the organization was on Enterprise
    When the plan lapses and the identity provider makes a SCIM request
    Then the request is refused in the SCIM error format
    And no user or group is provisioned
