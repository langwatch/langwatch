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
# A retirement note is checked against the LTS floor in
# packages/upgrade/releases/lts-floor.json (ADR-155 amendment, plan S9): the drop may ship
# only once every release the window still serves has stopped reading the thing.
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
  Scenario: Setting NOT NULL on an existing table is refused by name
    When the migration sets a column NOT NULL on a table it does not create
    Then the scanner names the migration, the table and the column
    And the fix says a backfill does not protect the image still writing nulls
    And the fix offers a NOT VALID check validated in a later release
    # This replaces the weaker "no UPDATE beside it" test for new migrations.

  @unit
  Scenario: Setting NOT NULL on a table the migration creates is accepted
    When the migration creates a table and sets a column of it NOT NULL
    Then the scanner reports nothing

  @unit
  Scenario: A retirement note above the LTS floor is refused by name
    Given the LTS floor is a release in packages/upgrade/releases/lts-floor.json
    When a drop or a ClickHouse type change carries a note naming a release above the floor
    Then the scanner names the migration, the object, the note's release and the floor
    And the fix names the first release the drop may ship in
    And a note that names no release is refused the same way

  @unit
  Scenario: A retirement note at or below the LTS floor is accepted
    When a drop carries a note naming the floor itself or an older release
    Then the scanner reports nothing

  @unit
  Scenario: Recreating or renaming an enum type is refused by name
    When the migration renames an enum type, or drops it and creates it again
    Then the scanner names the migration and the type
    And the fix says to add values, never to recreate the type
    # Removing a value recreates the type and drops what the previous image writes.

  @unit
  Scenario: Adding an enum value is accepted
    When the migration creates an enum or adds a value to an existing one
    Then the scanner reports nothing

  @unit
  Scenario: A unique index or validated constraint on an existing table is refused by name
    When the migration builds a unique index, a UNIQUE or PRIMARY KEY constraint, or a validated CHECK on a table it does not create
    Then the scanner names the migration, the object and the table
    And the fix says to pre-build the index or add the constraint NOT VALID

  @unit
  Scenario: A constraint added NOT VALID, or attached from a prebuilt index, is accepted
    When the migration adds a NOT VALID constraint, attaches one USING INDEX, or indexes a table it creates
    Then the scanner reports nothing

  @unit
  Scenario: A plain index on an existing table without the ops pre-build note is refused
    When the migration builds a non-concurrent index on a table it does not create
    And no comment above it shows the CREATE INDEX CONCURRENTLY an operator runs ahead
    Then the scanner names the migration, the index and the note to write
    # Prisma wraps a migration in a transaction, where CONCURRENTLY cannot run.

  @unit
  Scenario: A plain index carrying the ops pre-build note is accepted
    When a comment above the index names its CREATE INDEX CONCURRENTLY IF NOT EXISTS
    Then the scanner reports nothing
    # The shape of 20261006120000_process_outbox_lease_by_process_index.

  @unit
  Scenario: Changing a column type in place is refused by name
    When the migration alters the type of a column of an existing table
    Then the scanner names the migration, the column and the new type
    And the fix says to add a column, backfill, switch readers, then retire

  @unit
  Scenario: A well-formed additive migration is accepted
    When the migration creates a table with its indexes, or adds a nullable or defaulted column
    Then the scanner reports nothing
    # The data-privacy project scope migration is the live example.

  @unit
  Scenario: A new foreign key is refused by name
    When the migration adds a FOREIGN KEY or a REFERENCES clause, on a table it creates or one that exists
    Then the scanner names the migration and the table
    And the fix says to keep the reference a plain column with an index
    # Existing keys stay; no new one (Alex, 2026-10-06). Comments are not read.

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

  # ── Postgres: the api serves through the upgrade (Alex, 2026-10-09) ──

  @unit
  Scenario: An inline UPDATE or DELETE on an existing table is refused by name
    When the migration updates or deletes rows of a table it did not create
    Then the scanner names the migration and the table
    And the fix says to ship it as a batched, checkpointed background step

  @unit
  Scenario: DML on a table the migration creates, or an upsert, is accepted
    When the migration updates a table it creates, or upserts with ON CONFLICT DO UPDATE
    Then the scanner reports nothing

  @unit
  Scenario: A column added with a volatile default is refused by name
    When the migration adds a column to an existing table with gen_random_uuid(), random() or a SERIAL type
    Then the scanner names the migration, the column and the function
    And the fix says the table is rewritten under ACCESS EXCLUSIVE
    # now() and CURRENT_TIMESTAMP are stable: Postgres stores them once, no rewrite.

  @unit
  Scenario: A constant or stable default is accepted
    When the migration adds a column with a constant default, now() or CURRENT_TIMESTAMP
    Then the scanner reports nothing

  @unit
  Scenario: Two ALTER statements on one existing table are refused by name
    When the migration has two ALTER TABLE statements on a table it did not create
    Then the scanner names the migration, the table and the count
    And the fix says to write one ALTER TABLE with comma-separated actions

  @unit
  Scenario: One ALTER per existing table is accepted
    When the migration has one ALTER TABLE per existing table, or several on a table it creates
    Then the scanner reports nothing

  @unit
  Scenario: A lock_timeout above the runner's ceiling is refused by name
    When the migration sets lock_timeout above 2 seconds, or to 0
    Then the scanner names the migration and the value
    And the fix says the runner sets 2 seconds and retries
    # The runner's DEFAULT_LOCK_TIMEOUT_MS is 2 s with a bounded retry (packages/upgrade).

  @unit
  Scenario: A lock_timeout at or below the ceiling is accepted
    When the migration sets lock_timeout to 2 seconds or less
    Then the scanner reports nothing

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

  @unit
  Scenario: DDL without IF EXISTS or IF NOT EXISTS is refused by name
    When the up migration creates, adds, drops, modifies or renames without the guard
    Then the scanner names the migration, the object and the missing clause
    And the fix says goose re-runs a half-applied migration and takes no ClickHouse lock
    # CREATE OR REPLACE and MATERIALIZE need no guard.

  @unit
  Scenario: Guarded DDL is accepted
    When every create, add, drop and modify carries its IF NOT EXISTS or IF EXISTS
    Then the scanner reports nothing

  @unit
  Scenario: A view dropped and created again, or modified in place, is refused by name
    When the up migration drops a view and creates one of the same name, or modifies a view's query
    Then the scanner names the migration and the view
    And the fix says to create the view under a new name and retire the old one

  @unit
  Scenario: A changed view under a new name is accepted
    When the up migration creates a view beside the old one and drops the old under a note
    Then the scanner reports nothing

  # ── ClickHouse: no long rewrite at deploy (Alex, 2026-10-09) ─────────

  @unit
  Scenario: A ClickHouse mutation at deploy is refused unless a background step tracks it
    When the up migration runs ALTER ... UPDATE or DELETE, DELETE FROM, or MATERIALIZE a column, index, projection or TTL
    And no "-- background step: <id>" note sits above the statement
    Then the scanner names the migration, the mutation and the table
    And the fix says to track it with a background step that waits on system.mutations

  @unit
  Scenario: A mutation under a note naming its background step is accepted
    When a "-- background step: <id>" note naming a declared code step sits above the mutation
    Then the scanner reports nothing
    And a note naming no declared step is refused by name

  @unit
  Scenario: MODIFY TTL is refused unless it skips materialising
    When the up migration modifies a table TTL without SETTINGS materialize_ttl_after_modify = 0
    Then the scanner refuses it as a mutation at deploy

  @unit
  Scenario: MODIFY ORDER BY, OPTIMIZE FINAL and POPULATE are refused by name
    When the up migration changes a sort key, runs OPTIMIZE ... FINAL or creates a materialized view with POPULATE
    Then the scanner names the migration and the table
    # These run inside goose and block the upgrade; no step note accepts them.

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
  Scenario: The freeze marker names a migration on disk
    When the frozen high-water mark names no migration on disk
    Then the baseline test fails
    # A renumber moves the names and must move the mark in the same edit, visibly.

  @unit
  Scenario: The floor and lock rules start above a marker that names a migration on disk
    Given Postgres migrations written before the floor and lock rules existed
    When the marker that starts those rules names no migration on disk, or is baselined
    Then the test fails
    # They answer to the four older rules only; the baseline is never extended for them.

  @unit
  Scenario: Every baselined name still names a migration on disk
    When a baselined name matches no migration
    Then the baseline test fails and names the entry

  @unit
  Scenario: A migration merged in from main is skipped only while it matches main's bytes
    Given a migration listed in the committed from-main list with its git blob sha
    When the scanner runs
    Then that migration is not read
    And the test fails and names the entry if its migration.sql no longer hashes to that sha

  @unit
  Scenario: Floor history answers only to the older rules
    Given Postgres migrations shipped in the LTS floor's tag
    When the graceful rules scan them
    Then they report findings, and the tree scan skips them up to a marker that names a migration on disk
    # Floor history is never rewritten.

  @unit
  Scenario: ClickHouse floor history answers only to the older rules
    Given goose files shipped in the LTS floor's tag
    When the graceful rules scan them
    Then the tree scan skips them up to a marker that names a file on disk
    And every listed open finding is still reported

  @unit
  Scenario: Every open finding still occurs, so a fixed one leaves the list
    Given graceful-rule findings above the floor listed for a fix
    When one is no longer reported
    Then the test fails and names the entry
