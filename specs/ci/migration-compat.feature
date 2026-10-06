Feature: Migration compatibility gates
  As the team that rolls a release out while the previous one still serves
  I want CI to run old code against the new schema
  So that "migrations are never breaking" is proved by running, not only by scanning SQL

  # ADR-155 rules 1 to 4 are checked syntactically by the migration-safety
  # scanner; these gates are their direct test (ADR-155 "Still to land",
  # rethink 6.12 point 4, plan 3.3 and D7). Workflow: .github/workflows/migration-compat.yml.
  # The workflow is filtered by path, so its checks cannot be required ones
  # until it takes the always-run shape (held question D7 in held-questions.md).
  Background:
    Given a fresh Postgres, Redis and ClickHouse beside the job
    And "head" is the merge commit GitHub builds for the PR and "base" is that commit's first parent

  @unit
  Scenario: The workflow runs only on PRs that touch a migration
    Then it triggers on changes to the Prisma migrations, the Prisma schema, the goose migrations and module migration folders
    And on a change to the workflow itself
    And on no other path, and never on pull_request_target

  @unit
  Scenario: Base code passes its live api suites on the schema head migrated
    Given head's upgrade task has migrated the databases and recorded the upgrade ledger
    And the ClickHouse database is the one the base suites' fixture provisions, so base's own migrate is a no-op over it
    When base's api-executable and api-trpc-record suites run against those databases
    Then the job passes only if every suite file passed at least one test

  @unit
  Scenario: A base suite that silently skips fails the job
    Given base's live suites skip themselves when they cannot see the live stores
    When a suite file reports no passed test
    Then the job fails and names the file, because a skipped suite proves nothing

  @unit
  Scenario: Native ClickHouse mode is forced for the base suites
    Given the test harness provisions ClickHouse containers whenever CI is set
    When the base suites run
    Then CI is unset for that step, so they use the job's ClickHouse service

  @unit
  Scenario: A base without the live api suite is reported, not failed
    Given the base commit predates the live api fixture
    When the compatibility job runs
    Then it emits a warning that the base cannot be judged and skips the base suites

  @unit
  Scenario: The Prisma drift job refuses drift the PR adds
    Given the drift of migrations against schema.prisma is rendered as SQL for base and for head
    When head's drift contains a statement base's drift does not
    Then the job fails and prints the new statements

  @unit
  Scenario: Drift the base already carries does not fail the PR
    Given base's migrations already drift from its schema.prisma
    When head carries the same drift, or less
    Then the drift job passes

  @unit
  Scenario: A Prisma diff that errors fails the drift job
    When prisma migrate diff exits with its error status
    Then the drift job fails rather than reading the error as no drift

  @unit
  Scenario: The LTS floor's image boots on the schema head migrated
    Given the run is the nightly schedule or a manual dispatch
    And the floor release is read from packages/upgrade/releases/lts-floor.json
    When head's tasks have migrated the databases and the floor's langwatch/langwatch image starts against them
    Then its health route answers within the timeout
    And its log names no missing column or table
