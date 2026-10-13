Feature: The clickhouse-no-version-order-limit lint rule
  Picking the latest version of a row with `ORDER BY <version> DESC LIMIT 1`
  sorts every unmerged version with its heavy payload before LIMIT discards all
  but one (dev/docs/best_practices/clickhouse-queries.md, Anti-Pattern 1). An
  IN-tuple dedup reads key columns in the inner GROUP BY and heavy columns only
  for the rows that survive.

  @unit
  Scenario: Picking the latest version of heavy rows by sorting is reported
    Given a ClickHouse repository query selecting SpanAttributes ordered by UpdatedAt DESC LIMIT 1
    When the clickhouse-no-version-order-limit rule runs over it
    Then it reports versionOrderLimit on the query's line, naming UpdatedAt

  @unit
  Scenario: Sorting light rows by version is left alone
    Given a ClickHouse repository query selecting only SpanId ordered by Version DESC LIMIT 1
    When the clickhouse-no-version-order-limit rule runs over it
    Then it reports nothing
