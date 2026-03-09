Feature: Cancel queued and running suite jobs
  As a user who triggered a suite run
  I want to cancel queued or in-progress jobs
  So that I can stop a mistaken or unnecessary batch without waiting for it to finish

  Background:
    Given I am logged in
    And a suite exists with scenarios configured

  # Happy path: cancel a single job
  @e2e
  Scenario: Cancel an individual queued job from the run table
    Given a batch run is in progress with multiple jobs
    And at least one job is still queued
    When I cancel a queued job from the run table
    Then the job status changes to cancelled
    And the remaining jobs in the batch continue running

  # Happy path: cancel all remaining jobs
  @e2e
  Scenario: Cancel all remaining jobs for a batch run
    Given a batch run is in progress with multiple jobs
    When I cancel all remaining jobs for the batch
    Then all queued and in-progress jobs are marked as cancelled
    And completed jobs retain their original status

  # Integration: single job cancellation removes from BullMQ and persists status
  @integration
  Scenario: Cancelling a queued job removes it from BullMQ and prevents execution
    Given a job is queued in BullMQ
    When the cancel job endpoint is called for that job
    Then the job is removed from the BullMQ queue
    And the job status is persisted as cancelled

  # Integration: cancelling a running job signals BullMQ and persists status
  @integration
  Scenario: Cancelling a running job moves it to failed in BullMQ
    Given a job is actively running in BullMQ
    When the cancel job endpoint is called for that job
    Then the job is moved to failed state in BullMQ
    And the job status is persisted as cancelled

  # Integration: batch cancel interacts with BullMQ for each job
  @integration
  Scenario: Batch cancel removes queued jobs from BullMQ and marks running jobs
    Given a batch run has jobs in queued, running, and completed states
    When the cancel all endpoint is called for the batch
    Then queued jobs are removed from BullMQ
    And running jobs are moved to failed in BullMQ
    And all non-completed job statuses are persisted as cancelled
    And completed jobs are not modified

  # Integration: cross-project authorization
  @integration
  Scenario: Cancel job rejects requests for jobs belonging to another project
    Given a job belongs to project A
    When the cancel job endpoint is called with project B credentials
    Then the request is rejected with an authorization error

  # Integration: UI reflects cancellation immediately
  @integration
  Scenario: Cancelled status appears in the UI without manual refresh
    Given a job is displayed with a queued status
    When the job is cancelled
    Then the UI updates to show the cancelled status

  # Edge case: cancelling an already completed job
  @integration
  Scenario: Cancelling a completed job has no effect
    Given a job has already completed successfully
    When the cancel job endpoint is called for that job
    Then the job retains its completed status
    And no error is returned

  # Edge case: cancelling an already cancelled job
  @integration
  Scenario: Cancelling an already cancelled job is idempotent
    Given a job has already been cancelled
    When the cancel job endpoint is called for that job
    Then the job remains cancelled
    And no error is returned

  # Unit: status transition logic
  @unit
  Scenario: Only cancellable statuses are eligible for cancellation
    Given a job with a queued status
    When cancellation eligibility is checked
    Then the job is eligible for cancellation

  @unit
  Scenario: Completed jobs are not eligible for cancellation
    Given a job with a completed status
    When cancellation eligibility is checked
    Then the job is not eligible for cancellation

  @unit
  Scenario: Failed jobs are not eligible for cancellation
    Given a job with a failed status
    When cancellation eligibility is checked
    Then the job is not eligible for cancellation
