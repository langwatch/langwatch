Feature: Metric alerts can be defined by an LWQL statement

  Scenario: A statement returning one numeric value is saved as an alert
    Given LWQL is available to project "p1"
    When a member saves an alert with "SELECT avg(TotalCost) AS value FROM traces WHERE OccurredAt >= {dashboard_context_period_start:DateTime64(3)} AND OccurredAt < {dashboard_context_period_end:DateTime64(3)}", operator gt, threshold 0.5, period 15
    Then the alert is stored without a graph

  Scenario: A statement the policy refuses is refused with its violations
    When the statement reads "url('http://x')"
    Then the save is refused with trigger_metric_statement_invalid

  Scenario: A statement without a numeric value column is refused
    When the statement returns column "n" only
    Then the save is refused with trigger_metric_shape_invalid

  Scenario: A metric alert cannot be saved without LWQL
    Given the deployment has no LWQL identity
    When a member saves an alert with an LWQL statement
    Then the save is refused with lwql_unavailable
    And the alert source picker offers only a graph

  Scenario: The alert fires on breach and resolves on recovery
    Given the alert's value over the last 15 minutes is 0.7
    When the sweep evaluates it
    Then it fires once
    When the value falls to 0.2
    Then it resolves

  Scenario: No rows is no data, not zero
    Given the statement returns no rows for the window
    When the sweep evaluates it
    Then the alert is treated as no data

  Scenario: More than one row is skipped with a reason
    Given the statement returns two rows
    When the sweep evaluates it
    Then the evaluation is skipped with "metric statement returned more than one row"

  Scenario: LWQL going away skips the run, it does not fire
    Given a saved LWQL alert and LWQL becomes unavailable
    When the sweep evaluates it
    Then the evaluation is skipped and lwql_unavailable is logged

  Scenario: Graph alerts keep working beside LWQL alerts
    Given one graph alert and one LWQL alert in project "p1"
    When the sweep runs
    Then both are evaluated
