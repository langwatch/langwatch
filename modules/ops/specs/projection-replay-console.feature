Feature: Projection replay from the operator console
  As an operator repairing a projection
  I want to start, watch and cancel a replay from the back office
  So that a rebuild runs to its end on a worker, never inside my request.

  # Main detached the run inside the web process. Here (Alex, 2026-09-28) the api records the run
  # and sends one command on ops' own pipeline, ops_projection_replay; a worker's process-manager
  # intent executes it, fenced by the Redis replay lock's holder. Status, history and cancel stay
  # main's Redis keys, readable from every role. The engine's own behaviour is specified in
  # packages/eventing/specs/projection-replay.feature.

  @unit @replay
  Scenario: Replay status reads idle when no run exists
    Given no replay has ever run
    When an operator reads the replay status from the api role
    Then the status is idle
    And no replay runtime is built

  @unit @replay
  Scenario: Starting a replay records it running and the worker executes it
    Given ops' projection replay pipeline is installed
    When an operator starts a replay
    Then the run is recorded running under a new run id
    And one execution is requested for that run, filed under the operator
    And the worker executes it once and records it completed in history

  @unit @replay
  Scenario: A second start while one runs is refused as already running
    Given a replay is running
    When an operator starts another replay
    Then the start is refused with replay_already_running
    And no second execution is requested

  @unit @replay
  Scenario: Starting a replay where the pipeline never connected is refused as unavailable
    Given a process that never registered the projection replay pipeline
    When an operator starts a replay
    Then the start is refused as unavailable, not as a server error
    And the replay lock is left free

  @unit @replay
  Scenario: A redelivered execute intent for a run that no longer holds the lock does nothing
    Given a finished run and a newer run holding the replay lock
    When the finished run's execute intent is delivered again
    Then no replay runtime is built
    And the newer run's status is untouched

  @unit @replay
  Scenario: Cancelling a running replay records it cancelled in history
    Given a running replay
    When an operator cancels it
    Then its worker stops it and records it cancelled in status and history
    And the replay lock is freed

  @unit @replay
  Scenario: A worker that cannot build the replay runtime records the run failed with a reason
    Given a worker whose replay runtime cannot be built
    When the run's execution is delivered
    Then the run is recorded failed with the reason
    And the replay lock is freed

  @unit @replay
  Scenario: A projection that no installed pipeline registers finishes with No matching projections found
    Given a replay naming a projection no installed pipeline registers
    When the run's execution is delivered
    Then the run is recorded failed with "No matching projections found"

  @unit @replay
  Scenario: A replay rebuilds a Redis-cached fold through its durable store
    Given a fold whose store is a Redis cache in front of its durable store
    When a replay rebuilds it
    Then the rebuilt state is written to the durable store, not the cache

  @unit @replay
  Scenario: A map projection's owner names the table a replay optimizes
    Given a map projection that declares its ClickHouse target table
    When a replay rebuilds it
    Then the replay carries that table for its post-rebuild OPTIMIZE
    And a map declaring no table names none
