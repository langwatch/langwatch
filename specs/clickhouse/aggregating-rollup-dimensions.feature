Feature: Rollup columns outside the sorting key state how they merge

  An AggregatingMergeTree collapses every row that shares a sorting key when it
  merges parts. A column that is neither part of the sorting key nor an
  aggregate state has no rule for that collapse, so the surviving row keeps the
  value of whichever input row the merge read last. Nothing reports this: the
  column still reads, it just holds a value the writer did not choose.

  ClickHouse 26.0 made this a create-time error. A CREATE TABLE with such a
  column is rejected with BAD_ARGUMENTS, which means an install that replays
  the migrations from the start against ClickHouse 26 or newer stops on the
  first rollup and creates no schema at all. Chart-managed ClickHouse is pinned,
  but a customer who points the chart at their own ClickHouse, or at ClickHouse
  Cloud, chooses the version, and new versions arrive there on their own.

  The fix is the same for both problems: every such column declares
  SimpleAggregateFunction(max, T), which is the merge rule the readers already
  assume and is accepted by every supported ClickHouse version. Storage is
  unchanged, so the change is metadata-only on an install that already has data.

  @unit
  Scenario: no migration creates a rollup column without a merge rule
    Given the ClickHouse migrations that create AggregatingMergeTree tables
    When each created table is read column by column
    Then every column is in the sorting key, or is an aggregate state
    And a migration that adds one without a merge rule fails the check

  @unit
  Scenario: an install created before the rule converges on the same schema
    Given the four rollup columns that were declared as plain types
    When the migration set is read
    Then a later migration modifies each one to its aggregate state
    And the type it sets matches the type the create statements declare

  @integration
  Scenario: the migrated database carries the merge rule on every rollup column
    Given a ClickHouse database the migrations have run against
    When its AggregatingMergeTree tables are read from the server
    Then every column is in the sorting key, or is an aggregate state
    And the four columns that were plain types now merge by max
