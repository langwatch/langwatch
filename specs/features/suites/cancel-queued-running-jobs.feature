Feature: Cancel queued and running suite jobs
  As a user
  I want to cancel queued or in-progress suite jobs
  So that I can stop work I no longer need without waiting for it to finish

  # ---------------------------------------------------------------------------
  # UI: cancel eligibility and status display (existing requirements)
  # ---------------------------------------------------------------------------

  @integration
  Scenario: User cancels a single queued job from the run card
    Given a suite run has queued jobs
    When the user clicks cancel on a queued job
    Then the job status changes to cancelled
    And the UI reflects the cancelled state immediately

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
  # Active job cancellation stops the child process
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Cancelling a running job terminates its child process
    Given a suite job is actively running with a spawned process
    When the job is cancelled
    Then the worker terminates the spawned process
    And the job status transitions to cancelled

  @integration
  Scenario: Worker respects the abort signal during job execution
    Given a suite job is being processed by a worker
    When the abort signal fires for that job
    Then the worker stops execution promptly
    And no further results are written for the job

  # ---------------------------------------------------------------------------
  # Distributed cancellation across worker instances
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Cancellation reaches a worker on a different instance
    Given a suite job is running on worker instance A
    When the cancellation API is called from the web server
    Then worker instance A receives the cancellation notification
    And the job is terminated on worker instance A

  @integration
  Scenario: Workers that are not running the cancelled job ignore the notification
    Given worker instance B has no active job matching the cancellation
    When a cancellation notification arrives
    Then worker instance B takes no action
    And other running jobs on instance B are unaffected

  # ---------------------------------------------------------------------------
  # Batch cancel also cancels BullMQ jobs
  # ---------------------------------------------------------------------------

  @integration
  Scenario: Batch cancel removes queued jobs from the queue
    Given a batch run has jobs still waiting in the queue
    When the user cancels the entire batch
    Then the queued jobs are removed from the job queue
    And each removed job is recorded as cancelled

  @integration
  Scenario: Batch cancel terminates actively running jobs
    Given a batch run has jobs currently being processed
    When the user cancels the entire batch
    Then the running jobs receive termination signals
    And each running job transitions to cancelled

  # ---------------------------------------------------------------------------
  # Race condition: cancellation does not overwrite real results
  # ---------------------------------------------------------------------------

  @unit
  Scenario Outline: Cancellation skips a job that already has terminal results
    Given a suite job has already completed with a <verdict> verdict
    When a cancellation event arrives for that job
    Then the existing <verdict> verdict is preserved
    And the job status remains completed

    Examples:
      | verdict |
      | pass    |
      | fail    |

  # ---------------------------------------------------------------------------
  # Race condition: job finishes after cancellation
  # ---------------------------------------------------------------------------

  @unit
  Scenario: Late results are stored but do not flip cancelled status
    Given a suite job has been marked as cancelled
    When the job finishes with actual evaluation results
    Then the evaluation results are stored and visible
    And the job status remains cancelled
