Feature: Simulation read service

  Scenario: A transport reads run history through the Simulation capability
    Given a Simulation service with its repository at process boot
    When a caller requests a project-scoped simulation run
    Then the caller uses SimulationService
    And the caller does not construct or receive a repository

  Scenario: A disabled analytical store remains a safe empty read
    Given the null Simulation repository
    When a caller reads run history or run identifiers
    Then it receives an empty result appropriate to that read

  Scenario: Provider-specific message fields survive a contract parse
    Given a stored simulation message with extra provider fields
    When the Simulation run contract parses it
    Then the message retains those fields
