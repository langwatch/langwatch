Feature: OTLP parse failures are the client's error

  A malformed OTLP body is the sender's mistake, not a fault in the receiver.
  The routes already answer it with a 400, but they also logged it at error
  level and sent it to PostHog as an exception, so a sender with a broken
  exporter paged the team as if the platform were failing.

  A body that cannot be parsed is answered with a 400, logged once as a client
  warning, and kept out of exception reporting.

  Background:
    Given a project with a valid API key

  @unit
  Scenario: A malformed traces body is treated as the client's error
    When the project sends a malformed OTLP body to the traces endpoint
    Then the response status is 400
    And the response says the traces could not be parsed
    And one warning is logged, attributed to the client and the project
    And no error is logged
    And no exception is reported

  @unit
  Scenario: A malformed logs body is treated as the client's error
    When the project sends a malformed OTLP body to the logs endpoint
    Then the response status is 400
    And the response says the logs could not be parsed
    And one warning is logged, attributed to the client and the project
    And no error is logged
    And no exception is reported

  @unit
  Scenario: A malformed metrics body is treated as the client's error
    When the project sends a malformed OTLP body to the metrics endpoint
    Then the response status is 400
    And the response says the metrics could not be parsed
    And one warning is logged, attributed to the client and the project
    And no error is logged
    And no exception is reported
