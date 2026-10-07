# Console logging around an upgrade (rulings 2026-10-07, "upgrade quality bar"): an operator with
# no UI access reads the console to know what is happening and what to do next. ADR-173 is the
# model; specs/upgrade/upgrade-command.feature holds the run's behaviour, this file its narration.
#
# Every progress line names its phase, what it waits on, how long it has taken so far, and the
# next action an operator can take. Every refusal names the command or setting that fixes it.
# No line ever carries a password, a token or a connection URL with its credentials.

Feature: An upgrade tells the operator what it is doing and what to do next
  As an operator running LangWatch without the UI
  I want the console to narrate every upgrade phase and every refusal
  So that I know what is happening, how long it has taken and what to do next

  @integration
  Scenario: A first run announces itself, the number of migrations, and that serving follows
    Given a database with no LangWatch schema
    When the upgrade runs
    Then the first line says this is a first run that creates the schema
    And a line names how many schema migrations it will apply before the api and worker serve
    And the last line says the first run finished, how long it took and what to start next

  @integration
  Scenario: Each phase is logged as it starts and ends, with its elapsed time and the next action
    When an upgrade moves through preflight, both schema phases and reconcile
    Then each phase logs a start line naming what it waits on
    And each phase logs an end line with its outcome and its elapsed milliseconds
    And every one of those lines carries the next action an operator can take

  @integration
  Scenario: A blocking code step is announced and timed
    Given the next release declares a blocking data step
    When the upgrade runs it
    Then a line announces the step by id and description before it runs
    And a line reports it done with its elapsed milliseconds

  @integration
  Scenario: A second upgrader waiting for the lease says who holds it, how long it has waited and what to do
    Given another runner holds a live upgrade lease
    When a second upgrade starts
    Then it logs that it waits for the lease, naming the holder's host and image
    And the line carries how long it has waited, how long it will wait and the next action

  @unit
  Scenario: Every failed outcome names the command or setting that fixes it
    When an upgrade ends with any outcome other than done
    Then the outcome's next action names a command or an environment variable

  @unit
  Scenario: A connection URL in a log line is written without its password
    Given an error message carrying "postgresql://langwatch:s3cret@db:5432/langwatch?password=s3cret&token=abc"
    When it is redacted for the log
    Then the line reads the user, host and database but neither "s3cret" nor "abc"

  @unit
  Scenario: The upgrade task's last line names the UI and what upgrade status shows
    Given BASE_HOST is "https://langwatch.example.test"
    When the upgrade task finishes
    Then its last line names "https://langwatch.example.test" and "pnpm task upgrade status"

  @unit
  Scenario: The upgrade task with no BASE_HOST says which variable sets the UI's address
    Given BASE_HOST is not set
    When the upgrade task finishes
    Then its last line names "BASE_HOST" and "pnpm task upgrade status"

  @unit
  Scenario: The upgrade task with no ClickHouse target names CLICKHOUSE_URL before it starts
    Given no ClickHouse target is configured
    When the upgrade task starts
    Then it warns that the api and worker refuse to serve until "CLICKHOUSE_URL" is set

  @unit
  Scenario: A serving process logs that it checks the ledger, then that it serves, with how long the check took
    When an api starts and its upgrade gate admits it
    Then it logs the phase "upgrade-gate" and that it waits on the upgrade ledger
    And it logs that it serves, with the check's elapsed milliseconds

  @unit
  Scenario: A serving process that cannot read the ledger names DATABASE_URL
    Given the upgrade ledger cannot be read
    When an api starts
    Then the refusal names "DATABASE_URL" and the line carries the next action

  @unit
  Scenario: A lapsed presence is logged with what to check, and the recovery says how long serving stopped
    Given an admitted worker
    When its presence lapses and is later written again
    Then the lapse line says readiness answers 503 and names the presence write it waits on
    And the recovery line carries how many milliseconds serving stopped

  @unit
  Scenario: The api's first install says it runs the upgrade once before serving
    Given an api on an empty ledger and an empty schema
    When its upgrade gate admits it
    Then it reports that this is a first install and that it runs "pnpm task upgrade" once
