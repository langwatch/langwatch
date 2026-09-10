Feature: The no-raw-error-output lint rule
  A raw `console.error(err)` or a `.stack` dump bypasses the structured
  logger: it has no trace id, no level filtering, and reads as an
  unhandled crash in the terminal even when the caller recovered. Log
  through `createLogger` with the error as a field instead.

  Background:
    Given a workspace whose agent feature is at strict layout version 0

  @unit
  Scenario: console.error on a caught error is a raw dump
    Given governed server code that calls console.error with a caught error identifier
    When the no-raw-error-output rule runs over it
    Then it reports rawErrorOutput
    And the message names the console call and the offending identifier

  @unit
  Scenario: console.log of error.stack is a raw dump
    Given governed server code that calls console.log with an error's stack
    When the no-raw-error-output rule runs over it
    Then it reports rawErrorOutput

  @unit
  Scenario: process.stderr.write of err.stack is a raw dump
    Given governed server code that writes an error's stack to process.stderr
    When the no-raw-error-output rule runs over it
    Then it reports rawErrorOutput

  @unit
  Scenario: console.log of an unrelated value is allowed
    Given governed server code that logs a non-error identifier
    When the no-raw-error-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: A raw error dump in a test file is not governed
    Given a test file with the same raw error dump
    When the no-raw-error-output rule runs over it
    Then it reports nothing

  @unit
  Scenario: The boot guard may dump the error it caught
    Given the boot guard file with the same raw error dump
    When the no-raw-error-output rule runs over it
    Then it reports nothing
