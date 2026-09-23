# A migration is applied to the live database by a task, before the new image
# rolls (start:prepare:db, and the pre-roll gate in ADR-155). So for a window
# of minutes the OLD image is serving against the NEW schema, and if the roll
# is reverted the NEW image's schema outlives it. Both directions have to work,
# which is what makes a breaking migration a deploy outage rather than a bug.
#
# The scanner is two unit tests, each in the package that owns its migrations,
# each over a pure rules file beside it:
#   packages/prisma-client/src/__tests__/migration-safety.{rules.ts,unit.test.ts}
#   packages/clickhouse-migrations/src/__tests__/migration-safety.{rules.ts,unit.test.ts}
#
# Teaching: .claude/skills/postgres-migration, .claude/skills/clickhouse-migration.
# Ruling: dev/docs/adr/155-migrations-are-never-breaking.md.

Feature: Migration safety
  As an engineer shipping a schema change
  I want every migration to leave the previous image working
  So that deployment order, and a rollback, can never take the product down

  Background:
    Given a migration that is newer than the recorded baseline

  # ── Postgres ──────────────────────────────────────────────────────────

  @unit
  Scenario: Dropping a column without a retirement note is refused by name
    When the migration drops a column and no retirement note precedes it
    Then the scanner names the migration and the column
    And the fix says to ship the code that stopped using it one release earlier

  @unit
  Scenario: A drop retired a release earlier is accepted
    Given a "-- contract: retired in <release>" note above the statement
    When the migration drops that column
    Then the scanner reports nothing

  @unit
  Scenario: A new NOT NULL column without a default is refused by name
    When the migration adds a NOT NULL column with no DEFAULT
    Then the scanner names the migration and the column
    And the fix says an insert from the running image does not name the column

  @unit
  Scenario: A new NOT NULL column with a default is accepted
    When the migration adds a NOT NULL column carrying a DEFAULT
    Then the scanner reports nothing

  @unit
  Scenario: Setting NOT NULL without a backfill beside it is refused by name
    When the migration sets an existing column NOT NULL
    And no UPDATE fills that column earlier in the same migration folder
    Then the scanner names the migration and the column
    And the fix says to backfill first and contract in a later release

  @unit
  Scenario: Renaming a column or a table in place is refused by name
    When the migration renames a column or renames a table
    Then the scanner names the migration and both names
    And the fix states the add, backfill, switch readers, retire sequence

  @unit
  Scenario: Renaming an index or a constraint is accepted
    When the migration renames an index or a constraint
    Then the scanner reports nothing
    # No code reads either by name, so there is no old image to break.

  # ── ClickHouse ────────────────────────────────────────────────────────

  @unit
  Scenario: Dropping a ClickHouse column or table without a note is refused by name
    When the up migration drops a column, a table or a view with no retirement note
    Then the scanner names the migration and the object

  @unit
  Scenario: Changing a ClickHouse column type without a note is refused by name
    When the up migration modifies a column to a different type
    Then the scanner names the migration and the column
    And the fix says to add a new column, backfill, switch readers, then retire

  @unit
  Scenario: A settings-only MODIFY COLUMN is accepted
    When the up migration modifies only a column's TTL, CODEC or comment
    Then the scanner reports nothing

  @unit
  Scenario: A variable-size column added without a default is refused by name
    When the up migration adds an Array, Map or Tuple column with no DEFAULT
    Then the scanner names the migration and the column
    # Parts written before the ALTER hold no value for it, and a read without a
    # default decodes them as garbage (Code 173 at read, Code 241 at merge).

  @unit
  Scenario: More than one statement in a goose block is refused by name
    When a "-- +goose StatementBegin" block holds two statements
    Then the scanner names the migration and the count
    And the fix says one statement per block, because ClickHouse has no multi-statement query

  @unit
  Scenario: A down migration that is not commented out is refused by name
    When the "-- +goose Down" section holds live SQL
    Then the scanner names the migration
    And the fix says to comment it out under the roll-back-manually note

  # ── The scanner itself ────────────────────────────────────────────────

  @unit
  Scenario: Every finding carries its own fix
    When the scanner reports any finding
    Then the finding names the rule, the migration, the problem and the fix

  @unit
  Scenario: Migrations already shipped are not scanned
    Given a migration whose name is in the committed baseline
    When the scanner runs
    Then that migration is not read

  @unit
  Scenario: The baseline cannot be extended to silence a new finding
    When a name that sorts above the frozen high-water mark is added to the baseline
    Then the baseline test fails and names the entry
    # Migration names sort by time (Prisma) and by sequence (goose), so anything
    # written after the freeze sorts above it. The mark lives in the test, not
    # in the baseline file, so widening it is two deliberate edits.

  @unit
  Scenario: Every baselined name still names a migration on disk
    When a baselined name matches no migration
    Then the baseline test fails and names the entry
