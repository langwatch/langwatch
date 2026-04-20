Feature: Trace Name Filter and Group-By
  As a platform user
  I want to filter and group analytics dashboards by trace name
  So that I can isolate and compare metrics for specific AI agent workflows

  Trace name is derived from the root span's SpanName during trace projection
  and stored as a dedicated TraceName column (String with bloom_filter index)
  on trace_summaries. It follows the same filter and group-by patterns as
  topics and origin.

  When multiple root spans exist for a trace, the one with the earliest
  start time wins (deterministic tie-breaking).

  ES registry: TraceName is ClickHouse-only. The ES filter registry entry
  is a noop — Elasticsearch is deprecated and no longer used for analytics.

  Backfill: Existing trace_summaries rows will have empty TraceName.
  A backfill job is a planned fast-follow, not part of this iteration.

  Background:
    Given a project with traces in ClickHouse
    And each trace has a root span whose SpanName is projected as TraceName

  # ---------------------------------------------------------------------------
  # Schema: TraceName column exists on trace_summaries
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Trace projection populates TraceName from root span
    Given a trace with a root span named "OrderProcessingAgent"
    When the trace summary is projected
    Then the TraceName field equals "OrderProcessingAgent"

  @unit
  Scenario: Trace projection defaults TraceName when root span has no name
    Given a trace whose root span has an empty SpanName
    When the trace summary is projected
    Then the TraceName field equals an empty string

  @unit
  Scenario: TraceName is preserved when child spans arrive after root
    Given a trace where the root span named "OrderAgent" is processed first
    When a child span is subsequently processed
    Then the TraceName field still equals "OrderAgent"

  @unit
  Scenario: Multiple root spans use earliest start time
    Given a trace with two root spans
    And the first root span starts at T1 with name "auto-instrumented-GET"
    And the second root span starts at T2 (after T1) with name "manual-handler"
    When both spans are processed in any order
    Then the TraceName field equals "auto-instrumented-GET"

  # ---------------------------------------------------------------------------
  # Filter: trace name appears as a filter dimension
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace name is available as a filter dimension
    Given the project has traces with names "OrderAgent", "SearchAgent", and "SupportAgent"
    When a user requests available filter options for the trace name field
    Then the response lists "OrderAgent", "SearchAgent", and "SupportAgent" with counts

  # ---------------------------------------------------------------------------
  # Filter: single trace name
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Filtering a graph by a single trace name
    Given the project has traces named "OrderAgent" and "SearchAgent"
    When the user filters the analytics graph to trace name "OrderAgent"
    Then only metrics from "OrderAgent" traces appear in the results

  # ---------------------------------------------------------------------------
  # Filter: multiple trace names
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Filtering a graph by multiple trace names
    Given the project has traces named "OrderAgent", "SearchAgent", and "SupportAgent"
    When the user filters the analytics graph to trace names "OrderAgent" and "SearchAgent"
    Then metrics from both "OrderAgent" and "SearchAgent" traces appear in the results
    And metrics from "SupportAgent" traces do not appear

  # ---------------------------------------------------------------------------
  # Group-by: trace name
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Grouping a graph by trace name
    Given the project has traces named "OrderAgent" and "SearchAgent"
    When the user groups the analytics graph by trace name
    Then the graph displays separate series for "OrderAgent" and "SearchAgent"

  @integration
  Scenario: Group-by shows empty trace names as unknown
    Given the project has traces named "OrderAgent" and traces with empty TraceName
    When the user groups the analytics graph by trace name
    Then traces with empty TraceName appear under the "unknown" group

  # ---------------------------------------------------------------------------
  # Composition: date range and previous-period comparison
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace name filter composes with date range and previous-period comparison
    Given the project has "OrderAgent" traces spanning the last 30 days
    When the user filters to trace name "OrderAgent" with a 7-day date range and previous-period comparison enabled
    Then the current period shows only "OrderAgent" metrics for the last 7 days
    And the previous period shows only "OrderAgent" metrics for the 7 days before that

  # ---------------------------------------------------------------------------
  # Composition: existing label and metadata filters
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Trace name filter composes with label and metadata filters
    Given the project has traces with name "OrderAgent" and various labels and user IDs
    When the user filters to trace name "OrderAgent" combined with a label filter and a user ID filter
    Then results include only traces matching all three filter criteria

  # ---------------------------------------------------------------------------
  # Filter translator: WHERE clause generation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Filter translator generates correct WHERE clause for trace name
    Given a trace name filter with values "OrderAgent" and "SearchAgent"
    When the filter is translated to a ClickHouse WHERE clause
    Then the clause filters on the TraceName column of trace_summaries
    And the values are parameterized to prevent SQL injection

  # ---------------------------------------------------------------------------
  # Group-by expression: column resolution
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Group-by expression resolves TraceName as a direct column
    Given a group-by request for the trace name field
    When the group-by expression is resolved
    Then it uses the TraceName column on trace_summaries
    And it requires no additional table joins
    And empty TraceName values are mapped to "unknown"
