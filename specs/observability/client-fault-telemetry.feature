Feature: A request the caller must fix is not a server error

  An exporter sending a bad key, no key, or a batch over its plan is answered
  4xx. That is the caller's fault, and it repeats many times a second until
  someone fixes the exporter. Marking each one ERROR on its span, and warning on
  each one in the logs, buries the real server errors under them.

  So a caller's fault keeps its exception on the span with no ERROR status,
  counts in a metric labelled by reason only, and logs one warning per reason
  per minute with its repeats at debug. A server fault stays loud.

  @unit
  Scenario: A refused credential leaves the request span unset
    Given a REST request is refused because its credential is invalid
    When its span is closed
    Then the span keeps the exception event
    And it carries the error code and a customer fault attribute
    And its status is not ERROR

  @unit
  Scenario: A 4xx the framework answers is the caller's fault
    Given a REST request is answered 413 by the framework
    When its span is closed
    Then its status is not ERROR

  @unit
  Scenario: A server fault marks the span ERROR with its cause
    Given a REST request fails with an unexpected error
    When its span is closed
    Then its status is ERROR
    And the status message carries the error's message

  @unit
  Scenario: A repeated caller fault warns once a minute and counts every request
    Given the same caller fault repeats inside one minute
    When each request is logged
    Then the first one logs at warn
    And the repeats log at debug
    And the next warning carries how many repeats were held back
    And the client-fault counter counts every request by family, code and status

  @unit
  Scenario: A server fault is not counted as a caller fault
    Given a REST request fails with a 500
    When it is logged
    Then the default request logging applies
    And the client-fault counter is not incremented

  @unit
  Scenario: An OTLP receiver span stays unset for a caller fault
    Given an OTLP receiver body throws a customer-fault refusal
    When the receiver span closes
    Then the span status is not ERROR
    And the span keeps the exception event
    And the refusal is rethrown to the door

  @unit
  Scenario: An OTLP receiver span still records any other failure as ERROR
    Given an OTLP receiver body throws an unexpected error
    When the receiver span closes
    Then the span status is ERROR

  @unit
  Scenario: A refused ingest export warns once a minute per caller
    Given one exporter is refused at the ingest door repeatedly inside a minute
    When each refusal is recorded
    Then the "Authentication failed" line logs at warn once
    And the repeats log at debug
    And the next warning carries how many refusals were held back
    And the door-refusal counter counts every refusal by signal, code and status
    And no counter label carries a tenant, key or token

  @unit
  Scenario: The gateway leaves a 4xx request span unset
    Given the AI gateway answers a request with a 4xx
    When its request span ends
    Then the span status is unset
    And a 5xx still marks the span ERROR
    And a success marks it OK
