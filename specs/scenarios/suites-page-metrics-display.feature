Feature: Suites Page Metrics Display

  The suites page accordion headers and list rows display pre-computed cost
  and latency metrics alongside pass/fail rates, matching the TargetSummary
  design from the evaluations page.

  Two different breakdowns exist, and they are not the same shape: the
  accordion header summarises a whole run group and expands into percentile
  distributions, while an individual run row breaks its own cost and latency
  down by the roles that produced them.

  Background:
    Given the user is on the suites page
    And simulation runs have pre-computed metrics (totalCost, durations, per-role costs)

  # ---------------------------------------------------------------------------
  # Accordion header summary pill
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Accordion header shows pass rate circle with duration and cost
    Given a run group with 6 passed and 2 failed scenario runs
    And a total duration of 3200ms across runs
    And a total cost of $0.024 across runs
    When the accordion header renders
    Then it displays a pass rate of "75%"
    And a clock label showing "3.2s"
    And a cost label showing "$0.0240"

  @integration
  Scenario: Accordion header tooltip breaks the group down by pass, latency and cost
    Given a run group with average agent latency 1.6s and average agent cost $0.003
    When the user hovers over the summary pill
    Then a tooltip appears with:
      | label             | value     |
      | Pass              | 75%       |
      | Completed         | 8/8       |
      | Avg Agent Latency | 1.6s      |
      | Avg Agent Cost    | $0.003000 |
      | Total Duration    | 3.2s      |
      | Total Cost        | $0.0240   |
    And the tooltip carries no per-role breakdown, which belongs to the run rows

  @integration
  Scenario: Accordion header tooltip expands agent latency into a percentile distribution
    Given a run group whose agent latency statistics are available
    When the user hovers over the Avg Agent Latency row of the tooltip
    Then a nested breakdown appears showing the median and the 95th percentile

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
    Given a scenario run with status "SUCCESS", duration 1200ms, and total cost $0.003
    When the list row renders
    Then it shows "Passed" in green semibold text
    And "1.2s" for latency
    And "$0.003000" for cost

  @integration
  Scenario: Failed list row shows red styling
    Given a scenario run with status "FAILED" and duration 5400ms
    When the list row renders
    Then the left side shows a red circle
    And it shows "Failed" in red semibold text
    And "5.4s" for latency

  @integration
  Scenario: List row without metrics shows only status label
    Given a scenario run with null cost and no recorded duration
    When the list row renders
    Then it shows the status label only
    And does not show latency or cost

  @integration
  Scenario: List row tooltip breaks cost and latency down by role
    Given a scenario run whose cost and latency were recorded per role
    When the user hovers over the row's metrics
    Then a tooltip appears showing the total duration and total cost
    And a per-role latency and cost line for each role that contributed
