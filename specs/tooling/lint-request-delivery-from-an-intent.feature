Feature: requestDelivery is called only from an outbox intent (ADR-167)
  A delivery request leaves only after the producer's commit, so a destination kind's
  requestDelivery is called from an outbox intent executor, never inline in a service.

  @unit
  Scenario: A requestDelivery call outside an intent executor is reported
    Given a module's service method that calls requestDelivery directly
    When the linter checks it
    Then it reports the call, naming the receiver

  @unit
  Scenario: A requestDelivery call inside an intent executor is allowed
    Given requestDelivery called from an intent executor
    When the linter checks it
    Then it reports nothing

  @unit
  Scenario: A destination kind's requestDelivery implementation may delegate
    Given the destination kind's own requestDelivery member delegating to its service
    When the linter checks the module
    Then it reports only calls made outside that member

  @unit
  Scenario: A test may call requestDelivery directly
    Given a test that calls requestDelivery
    When the linter checks it
    Then it reports nothing
