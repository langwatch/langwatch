Feature: Every new Postgres migration is re-runnable
  Prisma 7 applies a migration statement by statement, so a migration cancelled
  half-way keeps its earlier statements. Every migration newer than the named
  marker RERUNNABLE_PRISMA_FROM (packages/upgrade/src/stepping/rerunnable-migrations.ts)
  must survive a second run from its first statement, so the upgrade runner may
  mark its failed row rolled back and apply it again (round 21, S3-RETRY).
  Migrations at or below the marker are history and are not read.

  @unit @architecture
  Scenario: Guarded forms of every statement pass
    Given a migration newer than the marker using IF NOT EXISTS, IF EXISTS, a DO block, CREATE OR REPLACE and INSERT ... ON CONFLICT
    When the rerunnable-migrations policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: A bare CREATE TABLE, CREATE INDEX or ADD COLUMN is refused naming the statement
    Given a migration newer than the marker creating a table, an index and a column without IF NOT EXISTS
    When the rerunnable-migrations policy runs
    Then it reports each statement with the guarded form to write instead

  @unit @architecture
  Scenario: A constraint, a rename or a bare INSERT is refused with the DO-block or ON CONFLICT fix
    Given a migration newer than the marker adding a constraint, renaming a column and inserting without ON CONFLICT
    When the rerunnable-migrations policy runs
    Then it reports each statement, naming a DO $$ ... $$ guard or ON CONFLICT as the fix

  @unit @architecture
  Scenario: A concurrent index build is refused
    Given a migration newer than the marker creating an index CONCURRENTLY IF NOT EXISTS
    When the rerunnable-migrations policy runs
    Then it reports the statement, because a cancelled concurrent build leaves an invalid index that IF NOT EXISTS keeps

  @unit @architecture
  Scenario: A statement the policy does not recognise is refused
    Given a migration newer than the marker creating a policy with no guard
    When the rerunnable-migrations policy runs
    Then it reports the statement as not known to be re-runnable

  @unit @architecture
  Scenario: Semicolons inside strings, comments and dollar-quoted bodies do not split a statement
    Given a migration newer than the marker whose DO block and comments hold semicolons
    When the rerunnable-migrations policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: Migrations at or below the marker are not read
    Given a migration named at the marker with a bare CREATE TABLE
    When the rerunnable-migrations policy runs
    Then it reports nothing for that migration

  @unit @architecture
  Scenario: A marker that names no migration folder is refused
    Given the marker names a folder the migrations directory does not hold
    When the rerunnable-migrations policy runs
    Then it reports the marker file, naming the missing folder

  @unit @architecture
  Scenario: Today's tree holds no finding
    Given the repository's own migrations and marker
    When the rerunnable-migrations policy runs
    Then it reports nothing
