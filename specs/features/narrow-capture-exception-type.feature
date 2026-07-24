Feature: Narrow captureException first parameter from unknown to Error | string
  As a developer
  I want the captureException function to only accept Error or string arguments
  So that passing non-Error objects is caught at compile time instead of silently losing error details

  Background:
    Given the error capture utility

  @unit
  Scenario: Captures full details from an Error instance
    Given an Error with message "connection failed" and a stack trace
    When captureException is called with the Error
    Then the exception message is "connection failed"
    And the exception type is the Error constructor name
    And the exception stack trace is included

  @unit
  Scenario: Captures a string as the exception message
    Given a string "timeout occurred"
    When captureException is called with the string
    Then the exception message is "timeout occurred"
    And the exception type is "Error"
