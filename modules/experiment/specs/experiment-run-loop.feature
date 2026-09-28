Feature: The workbench run loop is composed inside the experiment module

  The experiment module builds the loop that runs a workbench: the studio engine through the
  workflow module, prices through model-provider, evaluator results through evaluation, the
  sandbox key through project and api-key, connected agents through agent, and the personal
  agent rule through suite. Its own Redis holds a run's progress and stop signal. The api runs
  streamed and polled runs; the worker runs requested workflow evaluations.

  @unit
  Scenario: A process without Redis refuses to start a run by name
    Given a process with no Redis
    When a run is started
    Then it is refused as service_unavailable naming the progress store
    And no run loop is composed

  @unit
  Scenario: A process without a public address refuses to start a run but still answers polls
    Given a process with Redis but no public address
    When a run is started
    Then it is refused as service_unavailable naming the public address
    But a poll still reads the run's progress from Redis

  @unit
  Scenario: A run's stop signal is shared through the deployment's Redis
    Given a process with Redis and a public address
    When a stop is requested for a run
    Then the run reads the stop from Redis, and another run does not

  @unit
  Scenario: A cell is priced at the project's own cost rule before the catalogue
    Given a project with its own cost rule for a model
    When a cell of that model is priced
    Then the project's rates are handed to the price cascade as the custom rate

  @unit
  Scenario: A run lends the project's shared sandbox key to the code it executes
    Given a project whose organization can mint a sandbox key
    When a run executes code
    Then the run lends the project's sandbox key

  @unit
  Scenario: A run whose sandbox key cannot be minted still runs without one
    Given a project whose sandbox key mint refuses
    When a run executes code
    Then the run lends no key and is not stopped

  @integration @unimplemented
  Scenario: A workbench run executes to completion through the installed module
    Given the experiment module installed in the api over memory stores and a studio engine double
    When the workbench posts one row against one prompt target to execute
    Then the stream carries the cell's result and ends with done

  @integration @unimplemented
  Scenario: A polled run over the saved workbench completes and is read back
    Given a saved workbench with one row and one prompt target
    When the run is started without accepting events
    Then it answers the run id and link at once
    And polling the run reads it as completed

  @integration @unimplemented
  Scenario: The worker runs a requested workflow evaluation to completion
    Given the experiment module installed in the worker with a committed workflow
    When the worker receives the evaluation request
    Then the registered run completes for the poller to read

  @integration @unimplemented
  Scenario: Aborting a running workbench run stops it
    Given a workbench run in flight
    When its project asks to abort it
    Then the run stops and the stream ends with stopped

  @integration @unimplemented
  Scenario: A run against someone else's personal agent is refused before any cell
    Given a workbench whose target is another person's personal development agent
    When the workbench posts it to execute
    Then the run is refused as agent_owner_only before any cell runs
