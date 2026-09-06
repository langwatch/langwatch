@cli @traces
Feature: CLI trace export paging and span depth
  As an engineer or coding agent exporting traces from the terminal
  I want the export command to honor my requested limit and optionally include spans
  So that bulk analysis does not require hand-written pagination loops or the UI

  Background:
    Given I have a valid API key configured

  # The search endpoint returns a keyset cursor in pagination.scrollId and the
  # CLI is the party responsible for walking it. The server page size cap is
  # 1000; any requested limit above one page is satisfied by paging, never by
  # silently clamping.

  @unit
  Scenario: export pages with the server cursor until the requested limit is reached
    Given the search endpoint serves at most 1000 traces per page with a scrollId cursor
    When I run "langwatch trace export --limit 2500"
    Then the CLI requests successive pages passing the scrollId from the previous response
    And the exported output contains 2500 traces

  @unit
  Scenario: export keeps paging through a short page whose shortfall is skipped rows
    Given a page returns fewer traces than requested and reports the difference as skipped
    When I run "langwatch trace export" with a limit above one page
    Then the CLI continues to the next page instead of treating the short page as the end

  @unit
  Scenario: export stops paging when the server returns no further cursor
    Given the search endpoint has only 40 matching traces
    When I run "langwatch trace export --limit 1000"
    Then the exported output contains 40 traces
    And the CLI makes no further request after the page that returned no scrollId

  @unit
  Scenario: export requests one page when the limit fits in a single page
    When I run "langwatch trace export --limit 50"
    Then the CLI makes exactly one search request with pageSize 50

  @unit
  Scenario: export ends the walk on a short page without skipped rows
    Given a page returns fewer traces than requested and reports no skipped rows
    When I run "langwatch trace export" with a limit above one page
    Then the CLI treats the result set as exhausted and stops

  @unit
  Scenario: export rejects a non-numeric limit
    When I run "langwatch trace export --limit abc"
    Then the CLI exits with an error before making any request

  @unit
  Scenario: export with --include-spans requests smaller pages
    When I run "langwatch trace export --include-spans"
    Then each page request asks for at most 200 traces so span joining stays bounded

  @unit
  Scenario: export with --include-spans requests span data and preserves it in the output
    Given the search endpoint returns traces carrying spans
    When I run "langwatch trace export --include-spans"
    Then the search request body carries includeSpans true
    And each exported JSONL line preserves the trace's spans array

  @unit
  Scenario: export without --include-spans keeps the legacy request shape
    When I run "langwatch trace export"
    Then the search request body carries no includeSpans field

  @unit
  Scenario: CSV export appends token and context columns after the existing ones
    Given the search endpoint returns traces carrying token metrics
    When I run "langwatch trace export --format csv"
    Then the CSV header begins with trace_id, input, output, started_at, error in that order
    And the CSV header additionally contains prompt_tokens, completion_tokens, total_cost, context_size_tokens, cache_read_input_tokens, cache_creation_input_tokens, reasoning_tokens
    And each row carries the trace's token metric values in those columns
