Feature: Cancel queued and running suite jobs
  As a user
  I want to cancel queued or in-progress suite jobs
  So that I can stop work I no longer need without waiting for it to finish

  Background:
    Cancellation is implemented via event-sourcing. When the user requests
    cancellation, a `cancel_requested` event is written to the event log.
    A reactor broadcasts the cancellation to all worker pods via Redis pub/sub.
    Each worker checks if it owns the scenario and kills its child process.

  # ---------------------------------------------------------------------------
  # Event-sourcing: cancel_requested event lifecycle
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Cancellation reaches a worker on a different pod
    Given scenario X is running on worker pod 4
    And the cancel_requested event is processed by worker pod 1
    When the reactor publishes to Redis
    Then worker pod 4 receives the broadcast
    And terminates the child process for scenario X

  # ---------------------------------------------------------------------------
  # Pre-spawn check: cancel before execution starts
  # ---------------------------------------------------------------------------

  @integration @unimplemented
  Scenario: Batch cancel across multiple workers terminates all active runs
    Given worker A runs scenario X and worker B runs scenario Y in the same batch
    When the user cancels the entire batch
    Then both workers receive cancel broadcasts
    And both child processes are terminated
    And both runs transition to CANCELLED

  # ---------------------------------------------------------------------------
  # UI: cancel eligibility and status display
  # ---------------------------------------------------------------------------
