Feature: ClickHouse Query Memory Safety Regression Tests

  Analytics queries against ClickHouse can consume excessive memory when they
  pull wide columns (SpanAttributes Map), miss LIMIT clauses, or omit memory
  spill-to-disk settings. These regression tests catch structural issues that
  cause OOM in production — without requiring millions of rows.

  Two test layers:
  1. SQL structure assertions (unit, no DB) — catch regressions immediately
  2. Memory-budgeted smoke tests (integration, real ClickHouse, seeded data)

  Background:
    Given a project with traces stored in ClickHouse

  # ---------------------------------------------------------------------------
  # Layer 1: SQL structure assertions (unit tests, no DB)
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Analytics queries access SpanAttributes only via key extraction
    When any builder-generated analytics query produces SQL
    Then the outermost SELECT clause never includes a bare "SpanAttributes" column
    And SpanAttributes is only accessed via specific key extraction like SpanAttributes['key']

  @unit
  Scenario: Topic and field-discovery queries access only specific attributes
    When the topic counting query SQL is inspected
    Then the SQL does not select the full SpanAttributes Map column
    When the field discovery query SQL is inspected
    Then the SQL does not select the full SpanAttributes Map column

  @unit
  Scenario: Topic counting query includes a LIMIT clause
    When the topic counting query SQL is inspected
    Then the SQL includes a LIMIT clause

  @unit
  Scenario: Field discovery query includes a LIMIT clause
    When the field discovery query SQL is inspected
    Then the SQL includes a LIMIT clause

  @unit
  Scenario: All query execution paths include memory safety settings
    When each ClickHouse query execution call in the analytics service is inspected
    Then every call passes clickhouse_settings
    And clickhouse_settings contains max_bytes_before_external_group_by

  @unit
  Scenario: Every metric prefix in metric-translator has a column-pruning test
    Given the set of all metric prefixes registered in metric-translator
    And the set of all metric prefixes covered by column-pruning tests
    Then every registered metric prefix has at least one column-pruning test

  # ---------------------------------------------------------------------------
  # Layer 2: Memory-budgeted smoke tests (real ClickHouse, seeded data)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: All generated analytics queries are valid ClickHouse SQL
    Given a running ClickHouse test container with schema applied
    And 10000 spans seeded with 50 attribute keys per span across 1000 traces
    When each analytics query path is executed
    Then no query returns a syntax or schema error

  @integration
  Scenario: Analytics queries complete within a tight memory budget
    Given a running ClickHouse test container with schema applied
    And 10000 spans seeded with 50 attribute keys and 4KB values per span
    When each analytics query path is executed with max_memory_usage set to 50MB
    Then every query completes without a memory exceeded error

  @integration
  Scenario: Analytics queries complete within time budget on seeded data
    Given a running ClickHouse test container with schema applied
    And 10000 spans seeded with 50 attribute keys per span across 1000 traces
    When each analytics query path is executed
    Then every query completes within 5 seconds

  @integration
  Scenario: Analytics query results are correct on seeded data
    Given a running ClickHouse test container with schema applied
    And 10000 spans seeded with known attribute values across 1000 traces
    When trace_count and total_cost queries are executed
    Then trace_count returns the expected number of unique traces
    And total_cost returns the expected sum of costs
