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

  @unit
  Scenario: Cancel request produces a cancel_requested event
    Given a simulation run is in progress
    When the user requests cancellation
    Then a "lw.simulation_run.cancel_requested" event is stored in the event log
    And the event contains the scenarioRunId

  @unit
  Scenario: Fold projection sets CancellationRequestedAt without changing Status
    Given a simulation run has Status "IN_PROGRESS"
    When a cancel_requested event is applied to the fold projection
    Then the state has CancellationRequestedAt set to the event timestamp
    And the Status remains "IN_PROGRESS"

  @unit
  Scenario: Cancel request is idempotent
    Given a simulation run already has CancellationRequestedAt set
    When a second cancel_requested event is applied
    Then the original CancellationRequestedAt is preserved

  # ---------------------------------------------------------------------------
  # Reactor: broadcast cancel signal to workers
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Cancel reactor broadcasts to Redis on cancel_requested event
    Given the cancellation broadcast reactor is registered
    When a cancel_requested event is processed by the pipeline
    Then a message is published to the "scenario:cancel" Redis channel
    And the message contains the scenarioRunId

  # ---------------------------------------------------------------------------
  # Worker: cancel signal reaches the right worker
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Worker kills its own child process on cancel broadcast
    Given worker A is running scenario X as a child process
    And worker A is subscribed to the "scenario:cancel" Redis channel
    When a cancel broadcast arrives for scenario X
    Then worker A terminates the child process for scenario X
    And a finished event with status CANCELLED is dispatched

  @integration
  Scenario: Worker ignores cancel broadcast for scenarios it does not own
    Given worker B is running scenario Y
    When a cancel broadcast arrives for scenario X
    Then worker B takes no action
    And scenario Y continues running

  @integration
  Scenario: Cancellation reaches a worker on a different pod
    Given scenario X is running on worker pod 4
    And the cancel_requested event is processed by worker pod 1
    When the reactor publishes to Redis
    Then worker pod 4 receives the broadcast
    And terminates the child process for scenario X

  # ---------------------------------------------------------------------------
  # Pre-spawn check: cancel before execution starts
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Worker skips execution if cancel was already requested
    Given a simulation run has CancellationRequestedAt set in the projection
    When a worker picks up the job for that run
    Then the worker does not spawn a child process
    And a finished event with status CANCELLED is dispatched

  # ---------------------------------------------------------------------------
  # Queued job cancellation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Cancelling a queued run writes both cancel and finished events
    Given a simulation run has Status "QUEUED"
    When the user requests cancellation
    Then a cancel_requested event is dispatched
    And a finished event with status CANCELLED is dispatched
    And the fold projection shows Status "CANCELLED"

  # ---------------------------------------------------------------------------
  # Batch cancellation
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Batch cancel dispatches cancel events for all non-terminal runs
    Given a batch run has 3 runs: one QUEUED, one IN_PROGRESS, one SUCCESS
    When the user cancels the entire batch
    Then cancel_requested events are dispatched for the QUEUED and IN_PROGRESS runs
    And no cancel event is dispatched for the SUCCESS run

  @integration
  Scenario: Batch cancel across multiple workers terminates all active runs
    Given worker A runs scenario X and worker B runs scenario Y in the same batch
    When the user cancels the entire batch
    Then both workers receive cancel broadcasts
    And both child processes are terminated
    And both runs transition to CANCELLED

  # ---------------------------------------------------------------------------
  # UI: cancel eligibility and status display
  # ---------------------------------------------------------------------------

  @integration
  Scenario: User cancels a single running job from the run card
    Given a suite run has running jobs
    When the user clicks cancel on a running job
    Then the job status changes to cancelled
    And the UI reflects the cancelled state

  @integration
  Scenario: User cancels all remaining jobs for a batch run
    Given a suite run has multiple queued and running jobs
    When the user clicks cancel all on the batch run
    Then all non-terminal jobs are cancelled
    And the UI reflects the cancelled state for each job

  @integration
  Scenario: Cancel button is hidden for jobs that already completed
    Given a suite run has a job with a terminal status
    When the user views the run card
    Then no cancel action is available for that job

  # ---------------------------------------------------------------------------
  # Race conditions
  # ---------------------------------------------------------------------------

  @unit
  Scenario Outline: Cancellation does not overwrite terminal results
    Given a simulation run has already finished with status <status>
    When a cancel_requested event arrives
    Then CancellationRequestedAt is set on the projection
    But the Status remains <status>

    Examples:
      | status  |
      | SUCCESS |
      | FAILED  |
      | ERROR   |

  @unit
  Scenario: Late finish does not overwrite cancelled status
    Given a simulation run has been marked as CANCELLED via a finished event
    When a late finished event arrives with status SUCCESS
    Then the Status remains CANCELLED
