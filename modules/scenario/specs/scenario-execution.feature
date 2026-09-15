Feature: Isolated Scenario execution

  @unit
  Scenario: A worker prepares a run through canonical services
    Given a queued Scenario run identifies its project, suite, target and models
    When the worker prepares the isolated child payload
    Then Scenario uses the complete owning feature services
    And the persisted child payload is validated before execution

  @unit
  Scenario: Child startup overlaps slow preparation
    Given project telemetry and Scenario labels are ready
    And target or model preparation is still running
    When the worker prepares a Scenario run
    Then it starts the isolated child before preparation completes
    And it sends no job data until preparation succeeds
    And it aborts the child when preparation fails or the run is cancelled

  @unit
  Scenario: A child receives only its project's telemetry
    Given the worker process has ambient telemetry and trace environment variables
    When it starts a Scenario child for a project
    Then the child receives the endpoint and API key prepared for that project
    And it does not inherit parent OTLP configuration, trace context or Node preloads
    And another project's child cannot receive those values or resource attributes

  @unit
  Scenario: Child telemetry is flushed before exit
    Given a Scenario child has completed execution
    When it reports the result to the parent
    Then it flushes its separately initialised OpenTelemetry provider first

  @unit
  Scenario: Simulation execution remains durable
    Given the simulation run execution process derives an execute or cancel intent
    When the intent worker invokes Scenario execution
    Then the existing process name, key, wake, retry and terminal event semantics remain unchanged
