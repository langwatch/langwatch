Feature: Filter options read failures

  A filter picker reads its options from ClickHouse. When that read fails, the
  browser gets a generic error or the handled refusal, never the raw ClickHouse
  message, which embeds the SQL. The server log carries the cause instead.

  @unit
  Scenario: A failed filter options read logs its cause
    Given ClickHouse fails a filter options read
    When the options are fetched
    Then the server logs the whole error, with its type, code and cause
    And a raw ClickHouse error reaches the caller as "Failed to fetch filter options"
    And an overload refusal is logged as a warning and reaches the caller unchanged
