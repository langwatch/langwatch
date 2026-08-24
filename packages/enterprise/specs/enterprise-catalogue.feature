Feature: Enterprise package catalogue

  Scenario: Discover every installed Enterprise feature contract
    Given the portable Enterprise catalogue is created
    When a caller lists its features
    Then the catalogue identifies every installed contract package
    And each available server or web package is named without importing it

  Scenario: Import the catalogue without runtime registration
    When an application imports the Enterprise catalogue
    Then no feature is registered and no environment is read
