# Upgrade states that must never wedge the planner or the runner: a first install cut part-way, a
# release whose schema landed but whose blocking step did not, a failed Prisma row the upgrade may
# not re-run, and a ledger seed cut after its run row. Inference is
# packages/upgrade/src/runner/installed-release.ts; planning is packages/upgrade/src/plan/.

Feature: The upgrade resumes from a cut run instead of refusing or skipping work
  As an operator
  I want an upgrade that stopped part-way to carry on when I run it again
  So that a crash or an outage costs a rerun, never a false floor refusal or a skipped step

  @unit
  Scenario: A partial first install resumes as a fresh install instead of refusing below the floor
    Given a first install planned fresh recorded some Prisma migrations older than every manifest
    And no upgrade has succeeded yet
    When the upgrade plans again
    Then it plans a fresh install of what is left
    And it does not refuse below the LTS floor

  @unit
  Scenario: Settled schema that no fresh run applied still refuses below the floor
    Given the ledger settles schema no manifest names
    And no upgrade run ever planned a fresh install
    When the upgrade plans
    Then it refuses below the LTS floor

  @unit
  Scenario: A released blocking step left unfinished runs on the next upgrade
    Given release 3.22.0's schema is settled but its blocking data step is failed or still running
    And no upgrade has succeeded yet
    When the upgrade plans to 3.23.0
    Then the installation reads as 3.21.0
    And the plan runs 3.22.0's blocking data step before 3.23.0

  @unit
  Scenario: A blocking step no run attempted does not lower the inferred release
    Given release 3.22.0's schema is settled and its blocking data step is pending, never attempted
    When the upgrade plans
    Then the installation reads as 3.22.0

  @integration
  Scenario: A failed Prisma migration the upgrade may not re-run stops with its repair command
    Given _prisma_migrations holds a failed row at or below the re-runnable marker
    When the upgrade runs
    Then it exits 1 with code "failed_prisma_migration" before the schema applier is called
    And its message gives the "prisma migrate resolve" command that repairs it

  @integration
  Scenario: A seed cut after its run row is seeded again, never read as a fresh install
    Given an installation with Prisma and goose history
    And a ledger seed that recorded its run, then failed before writing any step
    When the upgrade runs again
    Then it seeds the ledger from the tools' records
    And no data step is marked not-needed
