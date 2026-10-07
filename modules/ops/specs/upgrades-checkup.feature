Feature: The checkup's migration rows and the doctor command read the upgrade ledger
  The "Postgres migrations" and "ClickHouse migrations" rows of the checkup and
  the status block of `npx @langwatch/server doctor` answer from the same
  source as the Upgrades page and `pnpm task upgrade status`: the upgrade
  ledger, read through UpgradeReader. A row is verified when no blocking step of
  its kind is outstanding or failed, and refused with the outstanding step ids
  otherwise. The row ids, codes and the /api/checkup shape do not change.
  Plan: dev/docs/plans/upgrade-ui-2026-10-06.md section 3 and
  dev/docs/plans/migrations-blitz-2026-10-06.md section 5.2 (mig-u3-checkup).

  @unit
  Scenario: The checkup's migration rows agree with upgrade status
    Given the ledger has one pending blocking Postgres step and every ClickHouse step done
    When the checkup runs
    Then the Postgres migrations row is refused and names that step
    And the ClickHouse migrations row is verified
    And both agree with what the upgrade status reports for those steps

  @unit
  Scenario: A Postgres row with every blocking step settled is verified
    Given every blocking Postgres step is done or not needed
    When the checkup runs
    Then the Postgres migrations row is verified

  @unit
  Scenario: A pending blocking step refuses the row and names the command and the page
    Given a blocking Postgres step the ledger has not run
    When the checkup runs
    Then the Postgres migrations row is refused with the pending code and the step id
    And its fix names "pnpm task upgrade" and "/ops/upgrades"
    And the row links the upgrade docs page

  @unit
  Scenario: A failed blocking step refuses the row with the failed code
    Given a blocking Postgres step that failed
    When the checkup runs
    Then the Postgres migrations row is refused with the failed code and the step id
    And its fix names "pnpm task upgrade" and "/ops/upgrades"

  @unit
  Scenario: A failed ClickHouse step refuses the ClickHouse row with its own failed code
    Given a ClickHouse schema step that failed on one target
    When the checkup runs
    Then the ClickHouse migrations row is refused with checkup_clickhouse_migration_failed and the step id

  @unit
  Scenario: A pending ClickHouse step refuses only the ClickHouse row
    Given a blocking ClickHouse step the ledger has not run
    When the checkup runs
    Then the ClickHouse migrations row is refused and names the step
    And its fix names "pnpm task upgrade" and "/ops/upgrades"
    And the Postgres migrations row is verified

  @unit
  Scenario: A long list of outstanding steps names the first few and counts the rest
    Given forty blocking Postgres steps the ledger has not run
    When the checkup runs
    Then the Postgres migrations row is refused
    And its detail counts forty steps and names only the first few

  @unit
  Scenario: A background or operator step that is still pending does not refuse a migration row
    Given a background step and an operator step that are pending
    And every blocking step is done
    When the checkup runs
    Then both migration rows are verified

  @unit
  Scenario: A step status the checkup does not know counts as outstanding
    Given a blocking Postgres step whose status is a string this release does not know
    When the checkup runs
    Then the Postgres migrations row is refused and names that step

  @unit
  Scenario: An install whose ledger records nothing and declares no step reads as not checked
    Given the upgrade status reports that no upgrade is recorded and the image declares no step
    When the checkup runs
    Then the Postgres migrations row is not checked
    And its fix names "pnpm task upgrade"

  @unit
  Scenario: A ledger that cannot be read leaves the migration rows not checked
    Given reading the upgrade ledger throws
    When the checkup runs
    Then both migration rows are not checked and say why
    And their fix names "pnpm task upgrade status"
    And the rest of the checkup still answers

  @unit
  Scenario: A ClickHouse install that is not configured leaves its migrations row not checked
    Given ClickHouse is not configured
    When the checkup runs
    Then the ClickHouse migrations row is not checked
    And the upgrade ledger is not read for it

  @unit
  Scenario: The migration rows keep their ids and the checkup keeps its shape
    When the checkup runs
    Then the rows are the same ids in the same order as before
    And "postgres_migrations" and "clickhouse_migrations" are among them

  @integration
  Scenario: Ops reads the upgrade ledger in its own Postgres
    Given the upgrade ledger in Postgres holds a pending and a failed blocking step
    When ops reads the ledger through its repository
    Then both steps are listed with their kind, mode and status
    And the upgrade status names the failed step

  @unit
  Scenario: A step the image ships that the ledger has not recorded keeps its migrations row refused, naming the step
    Given the image ships a blocking migration step the upgrade ledger has not recorded
    When the checkup reads its migrations rows
    Then the migrations row is refused
    And the detail names the step

  @integration
  Scenario: Doctor prints the upgrade status of an installation whose database is running
    Given the local Postgres accepts connections
    When "doctor" runs
    Then it prints an "Upgrade" block with the status "upgrade status" prints
    And it changes nothing

  @integration
  Scenario: Doctor says the upgrade status is unavailable when the database is not running
    Given the local Postgres does not accept connections
    When "doctor" runs
    Then it prints an "Upgrade" block saying the status is unavailable because the database is not running
    And the predep table and the port table are still printed
    And the exit code is decided by the predeps and ports as before
