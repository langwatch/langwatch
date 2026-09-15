Feature: Enterprise API composition

  @unit
  Scenario: Compose an optional licensing capability
    Given an API licensing service has been constructed
    When the Enterprise API composition is created with that service
    Then the composition exposes the same service without registering routes

  Scenario: Import API composition safely
    When the API composition package is imported
    Then no environment, database, worker, or web runtime is accessed
