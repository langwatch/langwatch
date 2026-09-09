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

  # The delayed metrics retry. A run whose trace is not summarised yet
  # reschedules its own metrics command as a queue job, and that job's name and
  # deduplication id are spelled at the registration site rather than declared
  # by the pipeline — so every graph that stages the queue has to spell them the
  # same way, and the scenario package is where they are decided.

  @unit
  Scenario: The delayed metrics retry keeps one routing key across both graphs
    Given the legacy graph and the packaged worker both stage the shared job queue
    When a graph registers the delayed metrics retry
    Then it uses the routing key and delay the scenario feature decided
    And it reports the run under the same span attributes

  @unit
  Scenario: Retries of one run deduplicate onto one queue entry
    Given a run whose trace summary is still missing after several attempts
    When each attempt schedules the retry again
    Then all the attempts collapse onto one queued entry for that run and trace
    And a different run of the same tenant queues separately

  @unit
  Scenario: The worker stages the retry the scenario package decided
    Given a worker graph with a durable queue
    When the scenario feature installs
    Then the registered job carries the package's routing key and delay
    And the run's own dispatcher receives the payload the job replays
