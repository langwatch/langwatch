Feature: An organization's trace usage is read per day from trace's own rollup

  Nurturing's per-email traits need an organization's trace count, failed-trace count, cost and
  active days over 30 days. Trace already appends every span to the per-minute
  trace_analytics_rollup table, so it answers from there: one query per read over the
  organization's projects, grouped by UTC day, never a per-trace scan and never a new write.
  Counts and times only. A trace counts on the day its root span started; a failed trace is one
  whose root span had an error status.

  @unit
  Scenario: An organization's traces are read per day from the rollup in one query
    Given an organization's projects have spans in the rollup on two days
    When their usage is read since a time
    Then one query bound to exactly those projects answers each day's traces, failures, cost and last times
    And a day without a failed trace has no failed-trace time
