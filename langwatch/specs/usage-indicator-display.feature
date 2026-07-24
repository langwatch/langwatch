Feature: Conditional UsageIndicator by Pricing Model
  As a user
  I want the sidebar usage bar to reflect my deployment type and pricing model
  So that I see relevant usage information

  # ---------------------------------------------------------------------------
  # Self-hosted: always show, unit = "traces"
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Self-hosted deployment always shows usage bar with "traces" label
    Given the deployment is self-hosted
    When getUsageDisplay is called
    Then the result indicates the usage bar is visible
    And the unit label is "traces"

  # ---------------------------------------------------------------------------
  # SaaS + TIERED pricing model: always show, unit = "traces"
  # ---------------------------------------------------------------------------

  @unit
  Scenario: SaaS TIERED free plan shows usage bar with "traces" label
    Given the deployment is SaaS
    And the organization uses the TIERED pricing model
    And the active plan is FREE
    When getUsageDisplay is called
    Then the result indicates the usage bar is visible
    And the unit label is "traces"

  @unit
  Scenario: SaaS TIERED paid plan shows usage bar with "traces" label
    Given the deployment is SaaS
    And the organization uses the TIERED pricing model
    And the active plan is a paid plan
    When getUsageDisplay is called
    Then the result indicates the usage bar is visible
    And the unit label is "traces"

  # ---------------------------------------------------------------------------
  # SaaS + SEAT_EVENT pricing model + FREE plan: show, unit = "events"
  # ---------------------------------------------------------------------------

  @unit
  Scenario: SaaS SEAT_EVENT free plan shows usage bar with "events" label
    Given the deployment is SaaS
    And the organization uses the SEAT_EVENT pricing model
    And the active plan is FREE
    When getUsageDisplay is called
    Then the result indicates the usage bar is visible
    And the unit label is "events"

  # ---------------------------------------------------------------------------
  # SaaS + SEAT_EVENT pricing model + paid plan: hide
  # ---------------------------------------------------------------------------

  @unit
  Scenario: SaaS SEAT_EVENT paid plan hides the usage bar
    Given the deployment is SaaS
    And the organization uses the SEAT_EVENT pricing model
    And the active plan is a paid plan
    When getUsageDisplay is called
    Then the result indicates the usage bar is hidden
