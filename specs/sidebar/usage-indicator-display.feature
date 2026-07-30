Feature: Conditional UsageIndicator by pricing model
  As a user
  I want the sidebar usage bar to appear only when my usage is the thing I pay on
  So that I am not shown a meter for something my plan does not meter

  # ---------------------------------------------------------------------------
  # Two separate decisions, and this file used to conflate them:
  #
  #   1. WHETHER the bar shows. That follows deployment type and pricing model:
  #      self-hosted always shows; SaaS shows unless the organization is on the
  #      seat+event model AND on a paid plan, where usage is no longer the meter
  #      the customer pays on.
  #   2. WHAT it counts. The unit label is read straight off the usage API's
  #      `usageUnit` and passed through untouched. It is NOT derived from the
  #      pricing model — an earlier version of this spec claimed "TIERED means
  #      traces, SEAT_EVENT means events", which the shipped function does not do.
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Self-hosted deployment always shows the usage bar
    Given the deployment is self-hosted
    When the usage display is resolved
    Then the usage bar is visible

  @unit
  Scenario: SaaS on the tiered pricing model shows the usage bar on a free plan
    Given the deployment is SaaS
    And the organization uses the TIERED pricing model
    And the active plan is FREE
    When the usage display is resolved
    Then the usage bar is visible

  @unit
  Scenario: SaaS on the tiered pricing model shows the usage bar on a paid plan
    Given the deployment is SaaS
    And the organization uses the TIERED pricing model
    And the active plan is a paid plan
    When the usage display is resolved
    Then the usage bar is visible

  @unit
  Scenario: SaaS on the seat and event pricing model shows the usage bar on a free plan
    Given the deployment is SaaS
    And the organization uses the SEAT_EVENT pricing model
    And the active plan is FREE
    When the usage display is resolved
    Then the usage bar is visible

  @unit
  Scenario: SaaS on the seat and event pricing model hides the usage bar on a paid plan
    Given the deployment is SaaS
    And the organization uses the SEAT_EVENT pricing model
    And the active plan is a paid plan
    When the usage display is resolved
    Then the usage bar is hidden

  @unit
  Scenario: An organization with no pricing model still sees its usage bar
    Given the deployment is SaaS
    And the organization has no pricing model recorded
    When the usage display is resolved
    Then the usage bar is visible

  @unit
  Scenario: The unit label is whatever the usage API reports, not what the plan implies
    Given the usage API reports its unit
    When the usage display is resolved
    Then the bar is labelled with that unit unchanged
    And the pricing model does not rewrite it
