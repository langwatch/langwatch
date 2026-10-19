Feature: langwatch doctor
  `langwatch doctor` runs the same checks the checkup page runs, against the
  install the CLI is pointed at, and prints the same verdicts and the same
  usage report. It exists for operators who never open the UI. The checks
  themselves live on the install: the command asks and prints, it never
  decides.

  As an operator of a self-hosted install
  I want to run the checkup from a terminal
  So that I can verify an install from a shell, a runbook or a CI job

  Background:
    Given the CLI is pointed at a self-hosted install with a project API key

  @unit
  Scenario: The cheap checks print one line per row with the verdict
    When "langwatch doctor" runs
    Then every row prints its name and PASS, FAIL or NOT CHECKED
    And a fail prints its fix under the row where the install gives one

  @unit
  Scenario: A project key reads the verdicts and its organization's figures
    Given the install answers the key verdicts only, as it answers every project key
    When "langwatch doctor" runs
    Then every row prints its name and verdict without a detail line
    And the organization's usage figures print without a destination

  @unit
  Scenario: The explicit checks run only when asked for
    When "langwatch doctor --run" runs
    Then the install is asked to run the checks that cost egress
    And without --run it is not

  @unit
  Scenario: The usage report prints after the rows
    When "langwatch doctor" runs
    Then the exact report the install sends is printed as JSON
    And the host it goes to is named where the install names it

  @unit
  Scenario: A machine reader gets the whole answer as JSON
    When "langwatch doctor --format json" runs
    Then the rows and the report print as one JSON document

  @unit
  Scenario: A refused key is reported, not retried
    Given the install answers 401 to the key
    When "langwatch doctor" runs
    Then the command fails and names the refusal

  @unit
  Scenario: The command stays off the CLI boot graph
    When the CLI starts
    Then the doctor module is loaded only when the command runs
