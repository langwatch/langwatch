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

  Four columns were declared that way, and the statements that create them are
  merged history that cannot be edited. So the migration runner replays that
  history with the check relaxed, only on a server that has the check, and the
  next migration converts the four columns to SimpleAggregateFunction(max, T).
  Every install ends on the same schema, whatever version it was created on.
  Migrations after that one run with the check in force, so a new rollup column
  without a merge rule fails rather than being quietly accepted.

  @unit
  Scenario: no new migration creates a rollup column without a merge rule
    Given the ClickHouse migrations that create AggregatingMergeTree tables
    When each created table is read column by column
    Then every column is in the sorting key, or is an aggregate state
    And a migration that adds one without a merge rule fails the check

  @unit
  Scenario: the list of merged statements that carry one stays exact
    Given the merged statements that declare a column without a merge rule
    When the migration set is read
    Then each one still declares the column the list names
    And an entry that no longer matches fails the check

  @unit
  Scenario: an install created before the rule converges on the same schema
    Given the four columns that were declared as plain types
    When the converge migration is read
    Then it modifies each one to merge by max
    And the type it sets is the type the create statement declared

  @unit
  Scenario: the compatibility setting covers merged history only
    Given a server that rejects a rollup column without a merge rule
    When the runner decides which migrations to relax the check for
    Then it relaxes it up to the migration before the converge migration
    And every later migration runs with the check in force

  @integration
  Scenario: the migrated database carries the merge rule on every rollup column
    Given a ClickHouse database the migrations have run against
    When its AggregatingMergeTree tables are read from the server
    Then every column is in the sorting key, or is an aggregate state
    And the four columns that were plain types now merge by max
