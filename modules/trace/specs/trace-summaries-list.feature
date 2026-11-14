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

  # The updated axis windows on UpdatedAt, which is not the table's partition column, so
  # without a bound on OccurredAt (the frozen storage anchor) every read walks every weekly
  # partition, cold storage included (#9354).
  @unit
  Scenario: A summaries-only list on the updated axis can bound the partitions it reads
    Given a window on the updated axis and a floor on when its traces first occurred
    When a system reader lists trace summaries
    Then the page statement, its latest-version lookup and the summary read all carry the floor
    And none of them is a cold scan of the table

  @unit
  Scenario: A summaries-only list reads every partition when no floor is given
    Given a window on the updated axis and no floor
    When a system reader lists trace summaries
    Then no statement carries an occurrence bound, as before
