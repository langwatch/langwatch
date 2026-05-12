Feature: Simulation run status consistency

  ClickHouse ReplacingMergeTree deduplicates rows by keeping the one with
  the highest UpdatedAt after a background merge. Before merge, multiple rows
  coexist. The fold store must read the correctly merged state to prevent
  later events (like metrics_computed) from reverting a terminal status.

  Scenario: metrics_computed event does not revert terminal status
    Given a simulation run that has received started, message_snapshot, and finished events
    And the run status is SUCCESS
    When a metrics_computed event arrives after the finished event
    Then the run status remains SUCCESS
    And the metrics are applied correctly

  Scenario: concurrent metrics and finished events converge to correct state
    Given a simulation run in IN_PROGRESS status
    When finished and metrics_computed events are processed sequentially
    Then the final state has Status=SUCCESS with metrics populated
