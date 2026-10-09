# Re-runnable Prisma migrations, resolved and retried by the runner: round 21, S3-RETRY
# (.claude/coordinator/held-questions.md, S3-RETRY). Prisma 7 applies a migration statement by
# statement, so a migration cancelled by `lock_timeout` keeps its earlier statements and leaves a
# failed row in _prisma_migrations. Every migration newer than the named marker
# (`RERUNNABLE_PRISMA_FROM`, packages/upgrade/src/stepping/rerunnable-migrations.ts) is re-runnable,
# which the `rerunnable-migrations` enforcer policy guarantees, so the runner may mark its failed row
# rolled back (`prisma migrate resolve --rolled-back`) and apply it again under the existing retry
# backoff. A migration at or below the marker keeps the conservative behaviour: the run stops and
# names the resolve command. Every scenario runs on its own scratch Postgres database.

Feature: Re-runnable migrations are resolved and retried by the upgrade
  As an operator
  I want a migration cancelled half-way by a lock to be retried by the upgrade itself
  So that a busy table costs a retry, not a manual `prisma migrate resolve`, and never a double apply

  Background:
    Given a scratch Postgres database at the LTS floor

  @integration
  Scenario: A re-runnable migration cancelled by lock_timeout mid-way is resolved and completes
    Given the image ships a migration newer than the marker whose first statement creates a table
    And whose second statement adds a column to a table another session holds locked
    When the upgrade runs with a lock_timeout shorter than the hold
    Then the first attempt fails with the first statement applied and the migration recorded failed
    And the console names the migration, says it is re-runnable and that it is marked rolled back
    And the second attempt applies the migration once the lock is released
    And the upgrade exits with code 0 and the ledger records the migration done
    And _prisma_migrations holds one rolled-back row and one finished row for the migration

  @integration
  Scenario: A migration at or below the marker still stops by name
    Given the image ships a migration older than the marker, cancelled by lock_timeout mid-way
    When the upgrade runs
    Then it exits with code 1 and code "failed_prisma_migration" after one attempt
    And its message gives the command "prisma migrate resolve --rolled-back" with the migration's name
    And _prisma_migrations still records the migration failed and never rolled back

  @integration
  Scenario: A failed re-runnable migration left by an earlier run is resolved before the schema is applied
    Given _prisma_migrations holds a failed row for a re-runnable migration the image ships
    When the upgrade runs
    Then the preflight marks it rolled back and logs that by the migration's name
    And the schema is applied and the upgrade exits with code 0
    And the run's report lists the migration as resolved

  @integration
  Scenario: A failed re-runnable migration the image does not ship stops by name
    Given _prisma_migrations holds a failed row for a migration newer than the marker the image does not ship
    When the upgrade runs
    Then it exits with code 1 and code "failed_prisma_migration" before the schema applier is called
    And its message gives the resolve command for that migration

  @integration
  Scenario: An applier that cannot resolve keeps the conservative behaviour
    Given the schema applier offers no way to mark a migration rolled back
    And _prisma_migrations holds a failed row for a re-runnable migration the image ships
    When the upgrade runs
    Then it exits with code 1 and code "failed_prisma_migration" naming the resolve command

  @integration
  Scenario: A resolve that fails stops the run naming the resolve command and the error
    Given the schema applier fails to mark the migration rolled back
    And _prisma_migrations holds a failed row for a re-runnable migration the image ships
    When the upgrade runs
    Then it exits with code 1 and code "failed_prisma_migration"
    And its message names the resolve error and the resolve command

  @integration
  Scenario: A re-runnable migration still failing after the last attempt names what to fix
    Given a re-runnable migration that fails on every attempt
    When the upgrade runs with three attempts
    Then it is marked rolled back and retried twice, each logged with its attempt and wait
    And it exits with code 1 and code "rerunnable_migration_failed" naming the migration and its error
    And the message says the next upgrade marks it rolled back and retries it without a resolve command
