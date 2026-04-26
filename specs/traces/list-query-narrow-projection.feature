Feature: Narrow projection for trace list and evaluation enrichment queries

  The trace list endpoint (and any paginated trace browsing) must not
  materialize multi-megabyte payload columns by default. Full payload content
  is only loaded when a caller explicitly opts in (e.g. the trigger cron or
  a single-trace detail view).

  Background:
    Given a ClickHouse `trace_summaries` row with a very large `ComputedInput`
      and `ComputedOutput` (e.g. 200 KB each)
    And matching `evaluation_runs` rows with large `Details`, `Error`, `Inputs`
    And a caller querying traces via the paginated list (default)

  Scenario: List query truncates captured input/output content
    When the caller fetches a page of traces without opting into full content
    Then the returned `input.value` is at most the preview cap (10_000 chars)
    And the returned `output.value` is at most the preview cap (10_000 chars)
    And the underlying ClickHouse query does not read the full heavy columns

  Scenario: Caller opts in for full content
    When the caller sets `includeFullContent: true` on `getAllTracesForProject`
    Then `input.value` and `output.value` return the full captured content
    And triggers (which evaluate full content) can still access the entire payload

  Scenario: Evaluation enrichment avoids SELECT *
    When the trace list enriches results with evaluation runs
    Then the ClickHouse query selects an explicit column list
    And does not include internal projection bookkeeping columns
      (`ProjectionId`, `LastProcessedEventId`, `Version`)
    And the list path does not load heavy evaluation fields
      (`Details`, `Error`, `Inputs`) — these are loaded only on the detail view

  Scenario: Behavior preserved for trigger cron
    Given the triggers cron processes a trace-based trigger
    When it reads candidate traces via `getAllTracesForProject`
    Then `includeFullContent` is set to `true`
    And the trigger action (Slack/email/dataset) receives untruncated input/output
