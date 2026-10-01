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

  @unit
  Scenario: A consuming worker connects the executor to its pool
    Given the deployment names a telemetry endpoint and an NLP engine
    When the worker builds simulation processing
    Then the pool's runner is connected and cancellations reach it
    And the executor's drain is owned by the process

  @unit
  Scenario: A worker without a telemetry endpoint composes no executor
    Given the deployment names no telemetry endpoint
    When the worker builds simulation processing
    Then no executor is connected and a queued run stays in the outbox

  @unit
  Scenario: A workflow target's saved HTTP agents run with the credentials the agents store
    Given a Scenario workflow target has a node that runs a saved HTTP agent with its credentials blank
    When the worker prepares the run
    Then the workflow handed to the child carries the credentials the saved agent stores
    And a saved agent that no longer exists leaves its node as it is

  @unit
  Scenario: A scenario run started by a member calls LangWatch with a key that acts as them
    Given a member who holds what a scenario's target needs
    When the member's scenario run is prepared
    Then the child's key is owned by the member, bound to the project and holds only what the target needs

  @unit
  Scenario: A scenario run is refused before it starts when its starter may not do what the target needs
    Given a member who does not hold evaluations:manage
    When the member runs a scenario against a workflow with an evaluator node
    Then the run is refused naming evaluations:manage and no key is minted

  @unit
  Scenario: A scenario run started with a personal access token holds no more than that token
    Given a member who starts a suite or run plan over the REST API with a personal access token
    When the run's child key is minted
    Then the key holds only permissions the member and that token both hold
    And the run is refused before it starts when the token lacks one the target needs

  @unit
  Scenario: A scenario run started with a CLI access token is bounded by the person alone
    Given a member who starts a suite or run plan with a project-bound CLI or hosted MCP access token
    When the run's child key is minted
    Then the run names no calling key, since no key row stands behind the token
    And the key holds only permissions the member holds

  @unit
  Scenario: A scenario run nobody started acts as the system
    Given a scheduled scenario run with no starter, in any workspace
    When its child's key is minted
    Then the key has no owner, is bound to the project and holds only what the target needs

  @unit
  Scenario: The run's starter travels from the queued event to the child's key
    Given a queued run whose event records the member who started it
    When the run is submitted for execution
    Then the execution job names that member as its starter, and a run with no actor names none

  @unit
  Scenario: A scenario child never outlives the key it was started with
    Given a scenario child, which is stopped once its time bound passes
    When its key is handed out
    Then the key has at least that bound of life left

  @unit
  Scenario: A code agent's sandbox holds a per-run key reaching only the agent cache
    Given a scenario run against a code agent
    When the run is prepared
    Then the sandbox gets a key for the run's starter, or the system, holding only agentCache:manage
    And no key is shared across the project's runs or kept in Redis
    And a run whose sandbox key cannot be minted still runs without the agent cache
