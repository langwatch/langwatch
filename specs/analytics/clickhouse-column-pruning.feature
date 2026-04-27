Feature: ClickHouse Analytics Column Pruning

  Analytics queries read from ClickHouse tables that contain many wide columns
  (Input/Output text blobs, SpanAttributes maps, Events arrays, etc.).
  When the query only needs a few numeric or identifier columns, reading every
  column wastes memory and I/O. This feature ensures that each analytics query
  selects only the columns it actually needs, keeping ClickHouse memory usage
  predictable under heavy concurrent load.

  Background:
    Given a project with traces stored in ClickHouse
    And the analytics query builder generates SQL for the project

  # ---------------------------------------------------------------------------
  # Trace summaries deduplication subquery
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Trace dedup subquery selects only columns required by the query
    When an analytics query requests the "trace_count" metric
    Then the trace_summaries dedup subquery does not use SELECT *
    And the dedup subquery selects the identity columns needed for deduplication
    And the dedup subquery selects only the metric columns referenced by the query

  @unit
  Scenario: Dedup subquery includes groupBy columns when grouping is active
    When an analytics query requests "total_cost" grouped by "metadata.user_id"
    Then the dedup subquery includes the column mapped to "metadata.user_id"
    And the dedup subquery includes the column mapped to "total_cost"
    And no other payload columns appear in the dedup subquery

  @unit
  Scenario: Dedup subquery includes filter columns when filters are active
    When an analytics query requests "trace_count" filtered by "metadata.labels"
    Then the dedup subquery includes the column mapped to "metadata.labels"
    And no other payload columns appear in the dedup subquery

  # ---------------------------------------------------------------------------
  # Evaluation runs subquery JOIN
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Evaluation runs subquery selects only needed evaluation columns
    When an analytics query references an evaluation metric like "evaluations.score"
    Then the evaluation_runs subquery does not use SELECT *
    And the evaluation_runs subquery selects only the columns needed for the JOIN key and the referenced metric

  @unit
  Scenario: Evaluation runs subquery adapts columns to groupBy field
    When an analytics query groups by "evaluations.evaluation_passed"
    Then the evaluation_runs subquery includes the "Passed" column
    And the evaluation_runs subquery does not include unreferenced columns like "Label" or "Score"

  # ---------------------------------------------------------------------------
  # Stored spans JOIN
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Stored spans JOIN selects only needed span columns
    When an analytics query groups by "metadata.span_type"
    Then the stored_spans source selects only the columns needed for the JOIN key and the span type attribute
    And wide columns like Input and Output are excluded from the stored_spans source

  @unit
  Scenario: Stored spans JOIN adapts columns to event-based grouping
    When an analytics query groups by "events.event_type"
    Then the stored_spans source includes the Events.Name column
    And the stored_spans source does not include SpanAttributes

  # ---------------------------------------------------------------------------
  # Query correctness after pruning
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Pruned query generates syntactically valid SQL
    When an analytics timeseries query is built for "trace_count" over a date range
    Then the generated SQL is syntactically valid

  @unit
  Scenario: Pruned query resolves all column references from pruned sources
    When an analytics timeseries query is built for "trace_count" over a date range
    Then every column alias referenced in SELECT, GROUP BY, and ORDER BY is available from the pruned sources

  @unit
  Scenario: Pruned CTE query for arrayJoin grouping preserves metric accuracy
    When an analytics query requests "trace_count" grouped by "metadata.labels"
    Then the CTE inner query selects only identity, period, date, group key, and metric columns
    And the outer query aggregates correctly over the deduplicated rows

  # ---------------------------------------------------------------------------
  # ClickHouse memory safety net
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Analytics queries include a memory spill-to-disk safety setting
    When any analytics query is executed against ClickHouse
    Then the query is sent with a max_bytes_before_external_group_by setting
    So that large GROUP BY operations spill to disk instead of exceeding memory

  @integration
  Scenario: Memory safety setting does not override explicit per-query settings
    When a query is executed with an explicit clickhouse_settings override
    Then the override takes precedence over the default memory safety setting
