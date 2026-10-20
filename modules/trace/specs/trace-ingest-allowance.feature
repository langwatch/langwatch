Feature: The ingest allowance check logs a store failure at the level it deserves
  The allowance check admits the batch when it cannot read the meter
  (specs/server/api-process-plan-allowance.feature). While an upgrade runs, the
  Postgres or ClickHouse schema behind the meter can lag the code; that failure
  is expected and logged below error. Any other failure stays at error.

  @unit
  Scenario: An allowance read that fails because the schema is behind is logged as a warning
    Given the upgrade has not finished
    And the allowance read fails with a missing Postgres table or a missing ClickHouse table
    When a batch asks the allowance
    Then the batch is admitted
    And the failure is logged as a warning, not an error

  @unit
  Scenario: An allowance read that fails for any other reason is logged as an error
    Given the allowance read fails with a connection reset
    When a batch asks the allowance
    Then the batch is admitted
    And the failure is logged as an error

  @unit
  Scenario: An allowance read a busy ClickHouse refuses is logged as a warning
    Given ClickHouse refuses the meter read as busy (clickhouse_overloaded or clickhouse_unavailable)
    When a batch asks the allowance
    Then the batch is admitted
    And the failure is logged as a warning, not an error
