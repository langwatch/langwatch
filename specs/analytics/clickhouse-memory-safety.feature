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

  # ---------------------------------------------------------------------------
  # Layer 3: Default dashboard on a high-volume project
  #
  # A 30-day dashboard on a project with millions of traces failed with
  # "query memory exceeded" on about a dozen panels. Every panel read the
  # newest version of each trace through an IN-tuple dedup, whose hash set
  # holds one entry per trace in range and cannot spill to disk.
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Dashboard panels on a high-volume project answer under a memory cap
    Given about a million traces over the current and previous 30 days, half of them with a second version
    When the trace, user, error, latency and thread panels run with a 150 MB per-query cap
    Then every panel answers without a memory exceeded error
    And the trace, user and error counts match the seeded data

  @integration
  Scenario: The model-grouped chart answers under a memory cap
    Given about a million traces with one LLM span each
    When the LLM calls chart grouped by model runs with a 150 MB per-query cap
    Then it answers without a memory exceeded error, spilling its join to disk
    And every current trace is counted under its model

  @integration
  Scenario: The documents panel reads only the RAG contexts attribute
    Given about a million traces whose root spans carry RAG contexts and large message attributes
    When the top documents panel runs with a 150 MB per-query cap
    Then it answers in one query with the top 10 documents and the distinct document total

  @unit
  Scenario: Dashboard panels dedup traces with a collapse that can spill to disk
    When a slim trace panel query is built
    Then it collapses each trace to its newest version with argMax grouped by trace
    And it carries only the columns the panel reads, never the whole attributes map

  @unit
  Scenario: Dashboard percentiles use a bounded-memory estimator
    When a slim trace panel asks for a median or p90
    Then the query uses a t-digest quantile, not an exact one

  @unit
  Scenario: A panel that hides the previous period does not scan it
    Given a chart that does not draw the previous period
    When it loads its data
    Then it asks to skip the previous period
    And the previous window is empty and the query reads only the current window

  @integration
  Scenario: The documents section sends one request per window
    When the documents summary and the documents table load on the analytics page
    Then both query with the same window and filters, so they share one request

  @unit
  Scenario: A dashboard load runs a bounded number of panel queries at once
    Given a project whose dashboard fires more panel queries than its concurrency limit
    When the panels load
    Then only the limit run at once in each app process and the rest wait their turn
    And other projects' queries do not wait behind them

  @unit
  Scenario: The evaluations summary reads the slim evaluation table
    When the evaluations summary asks for evaluation runs grouped by pass or fail with an empty evaluator key
    Then the query runs on the slim evaluation table instead of the full evaluation runs table

  @unit
  Scenario: A query over the memory limit is not retried in place
    When ClickHouse refuses a query for exceeding the query or user memory limit
    Then the client does not run the same statement again
    And the caller gets a query memory exceeded error with the reasons preserved
