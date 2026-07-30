Feature: Every defineTable declaration is checked against the deployed DDL

  `schema-catalogue.ts` describes 33 tables by hand, and a hand-kept
  description drifts from the migrations that actually create the tables —
  ADR-099 names three of its fields (`partitionColumnOf`, `tenantColumnsOf`,
  `versionColumnOf`, `partitionColumnMayMove`) with zero runtime callers, and
  the one field that IS read (`partitionColumnStability`) is only checked for
  being present, never for being true.

  `defineTable` is meant to replace that catalogue, one table at a time, but a
  `defineTable` call is exactly the same kind of claim — a column list, a sort
  key, a partition expression, a merge engine — and nothing checked it either
  until this drift test existed.

  The source of truth is a live ClickHouse, not a hand-written SQL parser. A
  `defineTable` declaration's whole job is to be exact about the wire (ADR-099,
  "The codec is positional and compiled"), and the only thing that can
  authoritatively parse ClickHouse DDL is ClickHouse itself — reimplementing
  that parser in TypeScript would be a second thing to keep in sync with the
  server's own grammar. The deployed migrations are read to find WHICH
  statements target a table (goose's own block markers, not SQL syntax), and
  those statements are replayed verbatim against a real ClickHouse — native
  where `LANGWATCH_TEST_CLICKHOUSE_URL` is set, a disposable `testcontainers`
  instance otherwise, matching this package's existing integration suite. A
  missing database is never silently skipped: `globalSetup.ts` throws before
  any test runs.

  # ---------------------------------------------------------------------------
  # The comparison — pure, no database required
  # ---------------------------------------------------------------------------

  Rule: A declaration is compared against a live table on every dimension that matters

    @unit
    Scenario: a declaration whose engine, sort key, partition and columns all match produces no drift
      Given a defineTable declaration
      And a deployed table whose engine, sort key, partition and columns all agree with it
      When the declaration is compared to the deployed table
      Then no drift is reported

    @unit
    Scenario: a mismatched ReplacingMergeTree version is reported naming both values
      Given a declaration whose ReplacingMergeTree version names one column
      And the deployed engine's version names a different column
      When the declaration is compared to the deployed table
      Then the disagreement names the table, the declared version and the deployed engine

    @unit
    Scenario: a mismatched sort key is reported naming both
      Given a declaration whose sort key differs from the deployed table's
      When the declaration is compared to the deployed table
      Then the disagreement names the table and both sort keys

    @unit
    Scenario: a mismatched partition expression is reported naming both
      Given a declaration whose partition expression differs from the deployed table's
      When the declaration is compared to the deployed table
      Then the disagreement names the table and both expressions

    @unit
    Scenario: a declared TTL anchor missing from the deployed DDL is reported
      Given a declaration with a TTL anchor
      And the deployed table's DDL carries no TTL clause on that column
      When the declaration is compared to the deployed table
      Then the disagreement names the table and the missing anchor

    @unit
    Scenario: a declared column absent from the deployed table is reported
      Given a declaration naming a column the deployed table does not have
      When the declaration is compared to the deployed table
      Then the disagreement names the table and the missing column

    @unit
    Scenario: a declared column whose type disagrees with the deployed type is reported naming both
      Given a declared column and the deployed column of the same name, with different ClickHouse types
      When the declaration is compared to the deployed table
      Then the disagreement names the table, the column and both types

    @unit
    Scenario: two declared columns whose relative order disagrees with the deployed table is reported
      Given two declared columns in one order
      And the deployed table's physical column order reverses them
      When the declaration is compared to the deployed table
      Then the later-declared column is reported as out of order

    @unit
    Scenario: a deployed table with undeclared trailing columns is not reported as drift
      Given a deployed table with columns beyond what the declaration lists
      When the declaration is compared to the deployed table
      Then no drift is reported, because a declaration need not enumerate every physical column

    @unit
    Scenario: every disagreement is reported, not just the first
      Given a declaration that disagrees with the deployed table on two separate dimensions
      When the declaration is compared to the deployed table
      Then both disagreements are reported

    @unit
    Scenario: an append table declared against a deployed aggregating engine is reported
      Given a declaration whose merge strategy is append
      And the deployed engine is AggregatingMergeTree
      When the declaration is compared to the deployed table
      Then the disagreement names the table and the deployed engine

    @unit
    Scenario: an aggregating table declared against a deployed append engine is reported
      Given a declaration whose merge strategy is aggregating
      And the deployed engine is a plain MergeTree
      When the declaration is compared to the deployed table
      Then the disagreement names the table and the deployed engine

  # ---------------------------------------------------------------------------
  # Reading the deployed DDL — goose block markers, not a SQL parser
  # ---------------------------------------------------------------------------

  Rule: The statements a real table's declaration is checked against are read from the migrations, never hand-transcribed

    A hand-transcribed copy of a migration's DDL is a second statement of the
    same fact, and it can go stale exactly like the catalogue it replaces —
    `event_log`'s deployed shape gained `_retention_days` and `_size_bytes`
    columns from migrations after the one that created it, which a one-time
    transcription would never see. Reading the migration files directly, at
    test time, means a table's replayed shape can never be older than the
    migrations themselves.

    @unit
    Scenario: a statement whose keyword and table name match is extracted
      Given a migration file with one CREATE TABLE for the target table
      When statements are extracted for that table
      Then the CREATE TABLE statement is extracted verbatim

    @unit
    Scenario: a comment mentioning the table elsewhere is not mistaken for a statement targeting it
      Given a migration file whose CREATE TABLE names a different table
      And a comment nearby mentions the target table by name
      When statements are extracted for the target table
      Then nothing is extracted

    @unit
    Scenario: a statement in a commented-out Down block is never extracted
      Given a migration file whose Down block names the target table in a commented-out statement
      When statements are extracted for that table
      Then the Down statement is never extracted

    @unit
    Scenario: a later migration's ALTER TABLE on the same table is extracted after its CREATE TABLE
      Given a CREATE TABLE for a table in one migration file
      And an ALTER TABLE for the same table in a later migration file
      When statements are extracted for that table
      Then both are extracted, in file order

    @unit
    Scenario: the unqualified stored_objects spelling is still recognised
      Given a CREATE TABLE with no database qualifier
      When statements are extracted for that table
      Then the statement is still extracted

    @unit
    Scenario: known env var placeholders resolve to their local, non-clustered defaults
      Given a statement carrying the database qualifier, the replacing-engine prefix and the storage policy placeholders
      When statements are extracted for that table
      Then every placeholder resolves to its local, non-clustered default and none remain in the statement

  # ---------------------------------------------------------------------------
  # The live check — every registered declaration, against a real ClickHouse
  # ---------------------------------------------------------------------------

  Rule: Every declaration registered for drift checking is checked against a live ClickHouse

    @integration
    Scenario: every registered table's declaration matches the deployed engine, columns, sort key and partition
      Given every defineTable declaration registered for drift checking
      And a live ClickHouse where each table was created from its deployed source — a real table from the replayed migrations, a synthetic fixture from its own DDL
      When each declaration is compared to the table it was created from
      Then no drift is reported for any of them

    @integration
    Scenario: a deliberately mismatched declaration is caught with a message naming the table and both sort keys
      Given a declaration whose sort key deliberately disagrees with the DDL that created it
      When the declaration is compared to the live table
      Then the comparison fails, naming the table and both sort keys
