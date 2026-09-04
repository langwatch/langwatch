# Implementation:
#   packages/features/evaluation/server/src/repositories/clickhouse/evaluation-run-read.repository.ts

Feature: A trace reads back with the evaluations recorded on it
  The trace evaluation read selects DateTime columns from ClickHouse. Read
  raw, they arrive as date strings, the millisecond schema refuses them and
  the whole trace answers 500 the moment its first evaluation lands. The
  read converts every timestamp to milliseconds in the query, the way the
  other evaluation reads in the same repository already do.

  @unit
  Scenario: A trace whose evaluation has landed still reads
    Given an evaluation row for a trace with scheduled, started and completed times
    When the trace's evaluations are read
    Then the query selects each time as milliseconds
    And the evaluation reads back with numeric timestamps

  The same read then answered 200 with no evaluations at all. It projects
  each DateTime onto an alias of the column's own name, and ClickHouse
  resolves an unqualified name in WHERE to the select-list alias — so the
  dedup predicate compared milliseconds against `max(UpdatedAt)` and matched
  nothing. Every read qualifies its predicate with the table.

  @integration
  Scenario: A rewritten evaluation is not hidden by the read's own column aliases
    Given an evaluation row written when it was scheduled and rewritten when it completed
    When the trace's evaluations are read
    Then the completed version of the evaluation is returned
    And reading the trace's evaluation runs directly returns the same version
