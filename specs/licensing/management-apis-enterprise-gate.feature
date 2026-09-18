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
    Then the request is refused with status 403 in the SCIM error format
    And no user or group is provisioned

  # ============================================================================
  # The other side of the gate: a license activates it rather than refusing it
  # ============================================================================
  #
  # The Background above is deliberately the unlicensed case; this Rule is its
  # counterpart. A stored, signature-verified Enterprise license resolves the
  # Enterprise plan through the SAME entitlement peer the gate above reads
  # (`organization.server.ts`'s `requireEnterprise`), so proving the grant here
  # is proving the whole gate, not a second gate that happens to agree.

  Rule: An activated Enterprise license grants the management APIs

    Background:
      Given an organization with a valid, unexpired, correctly signed
        Enterprise license activated
      And I am authenticated with an organization-scoped API key holding
        every permission these endpoints check

    @integration
    Scenario: The organization API grants access under an activated license
      When I fetch the organization
      Then the request succeeds

    @integration
    Scenario: The roles API grants access under an activated license
      When I list custom roles
      Then the request succeeds

    @integration
    Scenario: The role bindings API grants access under an activated license
      When I list role bindings
      Then the request succeeds

    @integration
    Scenario: The SCIM tokens API grants access under an activated license
      When I list SCIM tokens
      Then the request succeeds

    @integration
    Scenario: Group endpoints grant access under an activated license
      When I list groups
      Then the request succeeds

  # ============================================================================
  # What resolves the plan behind the gate
  # ============================================================================
  #
  # The gate never checks a license directly — it asks the entitlement peer for
  # the active plan, and the plan resolves from whichever source a valid
  # signature names first. These name the resolution itself, at the boundary
  # `EntitlementApp` owns, so a plan the gate above trusts is provably the plan
  # this resolved.

  Rule: A stored license resolves the plan it grants, or degrades safely when it does not

    @unit
    Scenario: A valid signed unexpired Enterprise license resolves the Enterprise plan
      Given an organization holding a stored license that verifies as Enterprise
      When its active plan is resolved
      Then the resolved plan is Enterprise
      And its source is recorded as the license

    @unit
    Scenario: An absent license resolves the baseline plan
      Given an organization holding no stored license
      When its active plan is resolved
      Then the resolved plan is the deployment's baseline
      And no Enterprise capability is granted

    @unit
    Scenario: A license with an invalid signature resolves the baseline plan
      Given an organization holding a stored license whose signature does not verify
      When its active plan is resolved
      Then the resolved plan is the deployment's baseline
      And no Enterprise capability is granted

    @unit
    Scenario: An expired license resolves the baseline plan
      Given an organization holding a stored license whose signature verifies but whose term has lapsed
      When its active plan is resolved
      Then the resolved plan is the deployment's baseline
      And no Enterprise capability is granted

    @unit
    Scenario: Entitlement resolves licenses through its installed peer
      Given a process installing the entitlement and licensing modules
      When entitlement declares its license dependency
      Then it names the LicensingApi token provided by the licensing module
