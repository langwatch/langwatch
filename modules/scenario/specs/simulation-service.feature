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

  @unit
  Scenario: A disabled analytical store remains a safe empty read
    Given ClickHouse is disabled at boot
    When a caller reads run history or run identifiers
    Then the Simulation service returns the empty result for that read

  @unit
  Scenario: Provider-specific message fields survive validation
    Given a stored simulation message has extra provider fields
    When the Simulation service parses the run
    Then those message fields are retained

  # The delayed metrics retry (ruled 2026-10-05). A run whose trace is not
  # summarised yet sends its own computeRunMetrics command again, delayed and
  # deduplicated per run and trace; no separate retry job is registered.

  @unit
  Scenario: A metrics retry is the computeRunMetrics command sent after the retry delay
    Given simulation_processing has registered its senders
    When a run's metrics retry is scheduled
    Then the computeRunMetrics command is sent with that payload
    And the send is delayed by the scenario package's retry delay
    And it is deduplicated on the run and trace for the retry window

  @unit
  Scenario: Retries of one run deduplicate onto one queue entry
    Given a run whose trace summary is still missing after several attempts
    When each attempt schedules the retry again
    Then all the attempts collapse onto one queued entry for that run and trace
    And a different run of the same tenant queues separately

  @unit
  Scenario: A run whose trace is not summarised yet asks for its metrics again
    Given simulation_processing has registered its senders
    And a computeRunMetrics command whose trace has no summary yet
    When the command is handled
    Then computeRunMetrics is sent again for that run and trace with its retry count raised by one
    And no metrics are recorded for the run yet

  # Measured against main on 2026-09-21: every /api/simulation-runs read
  # answered an unattributed 503 on this branch and 200 on main, because the
  # reads waited on a collaborator no process supplied. They are derived from
  # the deployment's own ClickHouse, through scenario's live registry.
  @unit
  Scenario: Simulation reads are derived from the deployment's own ClickHouse
    Given a live process whose scenario registry reads ClickHouse
    When a caller reads the runs across all suites
    Then the read is served from ClickHouse against the caller's own tenant
    And the deployment does not refuse it as uncomposed

  @unit
  Scenario: A settled simulation trace's run metrics are sent onto simulation_processing
    Given simulation_processing has registered its senders
    When trace asks the scenario API to compute a run's metrics
    Then the computeRunMetrics command is sent with that payload and no send options

  @unit
  Scenario: Run metrics asked for before simulation_processing registers are refused by name
    Given a process where simulation_processing has not registered its senders
    When trace asks the scenario API to compute a run's metrics
    Then the call is refused naming the computeRunMetrics command
