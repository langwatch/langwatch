Feature: Simulation service

  Scenario: A transport reads run history through the process service
    Given boot constructed the Simulation service with its private repository
    When a caller requests a project-scoped simulation run
    Then the caller uses app.simulations
    And the caller cannot receive the repository

  Scenario: Execution uses the same capability
    Given boot bound Simulation execution to the registered Eventing commands
    When a caller queues or finishes a run through app.simulations
    Then the canonical service validates the Zod 4 command
    And the execution port dispatches the existing durable command

  Scenario: A disabled analytical store remains a safe empty read
    Given ClickHouse is disabled at boot
    When a caller reads run history or run identifiers
    Then the Simulation service returns the empty result for that read

  Scenario: Provider-specific message fields survive validation
    Given a stored simulation message has extra provider fields
    When the Simulation service parses the run
    Then those message fields are retained
