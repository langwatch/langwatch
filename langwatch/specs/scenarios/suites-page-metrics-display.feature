Feature: Suites Page Metrics Display

  The suites page accordion headers and list rows display pre-computed cost
  and latency metrics alongside pass/fail rates, matching the TargetSummary
  design from the evaluations page.

  Background:
    Given the user is on the suites page
    And simulation runs have pre-computed metrics (totalCost, agentLatencyMs, per-role costs)

  # ---------------------------------------------------------------------------
  # Accordion header summary pill
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Accordion header shows pass rate circle with latency and cost
    Given a run group with 6 passed and 2 failed scenario runs
    And average agent latency of 3200ms across runs
    And total cost of $0.024 across runs
    When the accordion header renders
    Then it displays a pass rate circle showing "75%"
    And a clock icon with "3.2s"
    And a cost label showing "$0.024"

  @integration
  Scenario: Accordion header tooltip shows per-role cost breakdown
    Given a run group with metrics including agent cost $0.018, judge cost $0.004, user simulator cost $0.002
    When the user hovers over the summary pill
    Then a tooltip appears with:
      | label           | value  |
      | Pass Rate       | 75%    |
      | Avg Agent Latency | 3.2s |
      | Total Cost      | $0.024 |
    And a per-role breakdown section showing Agent, Judge costs
    And the User Simulator cost since it has data

  @integration
  Scenario: Accordion header shows only pass rate when no cost/latency data
    Given a run group from before the metrics migration with null cost and latency
    When the accordion header renders
    Then it displays a pass rate circle showing the percentage
    And does not show latency or cost labels

  # ---------------------------------------------------------------------------
  # List view scenario rows
  # ---------------------------------------------------------------------------

  @integration
  Scenario: List row shows colored status circle instead of icon
    Given a scenario run with status "SUCCESS"
    When the list row renders
    Then the left side shows a green circle
    And not a checkmark icon

  @integration
  Scenario: List row shows status label with latency and cost
    Given a scenario run with status "SUCCESS", agent latency 1200ms, and total cost $0.003
    When the list row renders
    Then the right side shows "Passed" in green semibold text
    And "1.2s" for latency
    And "$0.003" for cost

  @integration
  Scenario: Failed list row shows red styling
    Given a scenario run with status "FAILED" and agent latency 5400ms
    When the list row renders
    Then the left side shows a red circle
    And the right side shows "Failed" in red semibold text
    And "5.4s" for latency

  @integration
  Scenario: List row without metrics shows only status label
    Given a scenario run with null cost and latency
    When the list row renders
    Then it shows the status label and duration only
    And does not show cost
