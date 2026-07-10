Feature: Plan precedence rank behind the release flag
  # ADR-039 rollout step 5 / Decisions 1 and 12. The precedence rank
  # (ENTERPRISE license > active subscription > non-ENTERPRISE license > free)
  # is the only behavior change for existing organizations, so it ships
  # behind a feature flag that acts as a kill-switch.

  As a paying organization
  I want the plan source that reflects what I actually pay for to win
  So that a stale license can never dead-end my paid subscription

  # --- Flag disabled: today's behavior preserved ---

  @unit
  Scenario: With the flag disabled a valid license still beats an active subscription
    Given the precedence flag is disabled
    And an organization with a valid GROWTH license and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then the plan comes from the license

  # --- Flag enabled: the rank applies ---

  @unit
  Scenario: An active subscription outranks a non-ENTERPRISE license
    Given the precedence flag is enabled
    And an organization with a valid GROWTH license and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then the plan comes from the subscription

  @unit
  Scenario: An ENTERPRISE license outranks an active subscription
    Given the precedence flag is enabled
    And an organization with a valid ENTERPRISE license and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then the plan comes from the ENTERPRISE license

  @unit
  Scenario: A non-ENTERPRISE license outranks having no subscription
    Given the precedence flag is enabled
    And an organization with a valid GROWTH license and no subscription
    When the active plan is resolved
    Then the plan comes from the license

  @unit
  Scenario: An expired license never wins the rank
    Given the precedence flag is enabled
    And an organization with an expired ENTERPRISE license and an ACTIVE seat-event subscription
    When the active plan is resolved
    Then the plan comes from the subscription

  @integration @unimplemented
  Scenario: A stale GROWTH license no longer dead-ends the seat purchase flow
    Given the precedence flag is enabled
    And an organization with a valid GROWTH license and an ACTIVE seat-event subscription at its member cap
    When a member limit check runs
    Then the denial carries resolution "purchase_seat"
