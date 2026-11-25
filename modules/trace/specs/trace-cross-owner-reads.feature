Feature: Trace answers other modules' reads of its trace summaries
  Trace owns trace_summaries. A module that needs spend or counts over traces asks
  TraceApi; it never names the table. Each read answers exactly what the caller's own
  query answered on the same stored rows, latest version of each trace only.

  Background:
    Given a project whose traces carry an origin marker, a user and a source attribute
    And one trace was re-projected with a higher cost after it was first stored

  @integration
  Scenario: Attributed spend comparison totals the current and previous window
    When governance asks for the attributed spend comparison of the project
    Then the current and previous spend and the distinct current users match the old governance query
    And the re-projected trace counts once at its latest cost

  @integration
  Scenario: Attributed spend by value is sorted and paged in the store
    When governance asks for spend per user sorted by spend descending with a limit and offset
    Then the rows, their order and their first model match the old governance query

  @integration
  Scenario: Attributed spend comparison by value splits each value's windows
    When governance asks for spend per source over the current and previous window
    Then each source's current spend, previous spend, current requests and last activity match the old governance query

  @integration
  Scenario: Spend by project and attribute reads one declared tenant set
    When governance asks for spend per project and user across the organisation's projects
    Then the rows match the old governance query
    And the statement binds exactly the organisation's projects as its tenant set

  @integration
  Scenario: Daily attributed spend groups by an attribute or by the first model
    When governance asks for daily spend grouped by user, and again grouped by first model
    Then each day's buckets match the old governance query

  @integration
  Scenario: Attributed trace counts by value are limited to the asked values
    When governance asks how many traces each of two sources carried since a moment
    Then the counts match the old governance query and a third source is absent

  @integration
  Scenario: Attributed traces before a cursor list the newest first
    When governance asks for one source's traces before a moment with a limit
    Then the traces, their attributes, cost, tokens and timestamps match the old governance query

  @integration
  Scenario: Attributed trace recency counts each window and the last occurrence
    When governance asks for one source's trace counts since three moments
    Then the counts and the last occurrence match the old governance query

  @integration
  Scenario: A project with no matching traces answers empty
    Given a project with no traces carrying the origin marker
    When governance asks each attributed read for that project
    Then every list is empty, every total is zero and the last occurrence is zero

  @unit
  Scenario: A read with no projects never reaches ClickHouse
    When governance asks for spend per project and user with no projects
    Then the answer is empty and no statement is issued

  @unit
  Scenario: A store failure reaches the caller instead of an empty answer
    Given the trace store refuses the statement
    When governance asks for the attributed spend comparison
    Then the read rejects with the store's error
