Feature: Spend against a budget is never quietly lost
  As someone who set a budget to cap what the gateway can spend
  I want every request's spend to count against it
  So that the cap is a cap, and not an estimate that drifts low whenever a
  worker has a bad minute

  # See dev/docs/adr/075-post-event-work-subscribers-and-process-managers.md
  #
  # Budget debits are written today by gatewayBudgetSync, a reactor. That has
  # two consequences a budget holder would not expect:
  #
  #   1. Replay does not run reactors, so a debit lost to a failed handler is
  #      lost permanently — the spend happened, the event log records it, and
  #      the budget never learns.
  #   2. The reactor also emits the BUDGET_UPDATED change the gateway consumes
  #      to evict its cached bundles. Losing that means the gateway keeps
  #      authorising against stale spend until something else evicts it.
  #
  # Both failures push spend measurements DOWN, which is the dangerous
  # direction for a control whose job is to stop spending.
  #
  # Companion: budgets.feature, budgets-principal-cascade.feature.
  # These scenarios are @unimplemented until ADR-075's Class C conversion lands.

  Background:
    Given a budget covering a virtual key
    And the gateway is serving requests against that key

  # ============================================================================
  # Spend counts, even when something fails
  # ============================================================================

  @integration @unimplemented
  Scenario: Spend recorded during a failure still counts against the budget
    Given a request that consumed budget
    When the work recording that spend fails
    Then the spend is recorded once the failure clears
    And the budget reflects it

  @integration @unimplemented
  Scenario: Total spend can be reconciled against what actually happened
    Given a period of gateway requests that consumed budget
    When the spend for that period is recomputed from what the gateway recorded
    Then it matches the spend the budget was charged

  @integration @unimplemented
  Scenario: A request counted twice does not spend the budget twice
    Given a request whose spend has already been counted
    When that same request is accounted for again
    Then the budget is charged once

  # ============================================================================
  # The cap holds
  # ============================================================================

  @integration @unimplemented
  Scenario: A budget that has been exhausted stops authorising spend
    Given spend that has reached the budget's limit
    When another request is made against the same budget
    Then it is refused

  @integration @unimplemented
  Scenario: The gateway stops serving on stale spend after a restart
    Given spend recorded while the gateway held a cached view of the budget
    When the process that would have notified the gateway dies first
    Then the gateway still stops authorising once the budget is exhausted

  # ============================================================================
  # Reporting
  # ============================================================================

  @integration @unimplemented
  Scenario: Spend reported to the budget holder matches what was charged
    Given a budget with spend recorded against it
    When the budget holder reviews their spend
    Then the figure shown is the figure the cap is enforced against
