# What the ledger keeps about a failing step, so its diagnostics never carry a secret.
# Plan: dev/docs/plans/upgrade-diagnostics-via-connect.md (decisions 3 and 6).
Feature: The ledger keeps a redacted error and log for each step

  @unit
  Scenario: A step's error is redacted before the ledger stores it
    Given a background step that fails with an error naming a database URL with its password
    When the worker records the failure
    Then the stored error keeps the user and host but not the password

  @unit
  Scenario: A step's error naming a secret the process holds is redacted before it is stored
    Given a worker that holds a ClickHouse URL as a secret
    And a background step that fails with an error quoting that URL
    When the worker records the failure
    Then the stored error does not contain the URL

  @unit
  Scenario: A blocking step's error naming a store URL is redacted before it is stored
    Given an upgrade run that holds the store URLs it was started with
    And a blocking step that fails with an error quoting one of them
    When the run records the failure
    Then the stored error does not contain the URL

  @unit
  Scenario: A very long step error is cut before it is stored
    Given a background step that fails with an error of 20 KB
    When the worker records the failure
    Then the stored error is at most 4 KB and says it was cut

  @unit
  Scenario: A background step's log lines are kept with its attempt
    Given a background step that logs two lines and then fails
    When the worker records the failure
    Then the step's log tail holds the start line, both lines and the failure line, redacted

  @unit
  Scenario: A step's log line is redacted before it reaches the worker's own log
    Given a step that logs a line whose message and fields name a secret
    When the line is forwarded to the worker's log
    Then neither the message nor any field, nested or an error, carries the secret

  @unit
  Scenario: A step's log tail keeps only the last lines of an attempt
    Given a background step that logs 500 lines in one attempt
    When the attempt ends
    Then the step's log tail holds the last 200 lines

  @integration
  Scenario: A blocking step's log lines are kept with its attempt
    Given a blocking data step that logs a line and then fails
    When the upgrade run records the failure
    Then the step's log tail holds that line and the failure

  @unit
  Scenario: The reader shows a step's log tail
    Given a step row with a log tail
    When the step is read
    Then the view carries the log tail, and a step without one reads an empty tail
