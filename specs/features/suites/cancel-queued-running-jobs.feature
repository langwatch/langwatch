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

  # Integration: single job cancellation updates queue and stored status
  @integration
  Scenario: Cancelling a queued job prevents it from executing
    Given a job is queued
    When the cancel job endpoint is called for that job
    Then the job is removed from the queue
    And the job status is persisted as cancelled

  # Integration: cancelling a running job
  @integration
  Scenario: Cancelling a running job marks it as cancelled
    Given a job is actively running
    When the cancel job endpoint is called for that job
    Then the job is marked as cancelled
    And the job status is persisted as cancelled

  # Integration: batch cancel updates all pending jobs
  @integration
  Scenario: Batch cancel marks all non-completed jobs as cancelled
    Given a batch run has jobs in queued, running, and completed states
    When the cancel all endpoint is called for the batch
    Then queued and running jobs are cancelled
    And completed jobs are not modified

  # E2E: UI reflects cancellation immediately
  @e2e
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
