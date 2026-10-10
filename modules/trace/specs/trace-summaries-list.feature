Feature: A system reader lists bare trace summaries under the list read's filter and cursor

  TraceApi.listTraceSummaries pages trace_summaries as the list read does (same
  window axis, keyset cursor and compiled filter) and answers each trace's latest
  summary, with no content, spans, evaluations, count or viewer protections.
  Governance pulls governance-origin traces with it.

  @unit
  Scenario: A summaries-only list reads bare summaries under the list's filter
    Given a compiled filter and a window on the updated axis
    When a system reader lists trace summaries
    Then the page statement carries the filter with its bound values
    And no count or evaluation statement runs
    And the summaries are read with their content pruned
    And each trace answers as its latest summary

  @unit
  Scenario: A summaries-only list pages by the list read's keyset cursor
    Given a page that comes back full
    When the next page is asked for with the returned scroll id
    Then it seeks past the last summary on the paged axis

  @unit
  Scenario: A summaries-only list read that fails is refused, not answered empty
    Given the trace store fails the page statement
    When a system reader lists trace summaries
    Then the read fails with the store's error
