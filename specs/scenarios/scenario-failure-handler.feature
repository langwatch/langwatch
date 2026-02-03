Feature: Scenario Failure Handler
  As a LangWatch user
  I want to see meaningful error messages when scenario jobs fail
  So that I can diagnose issues instead of seeing generic timeout messages

  # ============================================================================
  # ScenarioFailureHandler Service - Unit Tests
  # ============================================================================
  # The handler ensures failure events are emitted to Elasticsearch when
  # scenario jobs fail (child process crash, timeout, prefetch error).

  @unit
  Scenario: Emit both RUN_STARTED and RUN_FINISHED when no events exist
    Given a scenario job failed with error "Child process exited with code 1"
    And no events exist in Elasticsearch for this batchRunId
    When ScenarioFailureHandler.ensureFailureEventsEmitted is called
    Then a RUN_STARTED event is emitted with a synthetic scenarioRunId
    And a RUN_FINISHED event is emitted with status ERROR
    And the RUN_FINISHED event includes the error message
    And both events share the same scenarioRunId

  @unit
  Scenario: Emit only RUN_FINISHED when RUN_STARTED exists
    Given a scenario job failed with error "Scenario execution timed out"
    And a RUN_STARTED event exists for this batchRunId
    But no RUN_FINISHED event exists
    When ScenarioFailureHandler.ensureFailureEventsEmitted is called
    Then a RUN_FINISHED event is emitted with status ERROR
    And the RUN_FINISHED uses the existing scenarioRunId from RUN_STARTED
    And no new RUN_STARTED event is emitted

  @unit
  Scenario: Idempotent - no action when RUN_FINISHED already exists
    Given a scenario job failed
    And both RUN_STARTED and RUN_FINISHED events exist for this batchRunId
    When ScenarioFailureHandler.ensureFailureEventsEmitted is called
    Then no events are emitted
    And the handler returns successfully

  @unit
  Scenario: Generate synthetic scenarioRunId with correct format
    Given a scenario job failed
    And no events exist in Elasticsearch
    When the handler generates a synthetic scenarioRunId
    Then the ID follows the pattern "scenariorun_{nanoid}"

  @unit
  Scenario: Include job metadata in failure events
    Given a scenario job failed with:
      | projectId  | proj_123     |
      | scenarioId | scen_456     |
      | setId      | set_789      |
      | batchRunId | batch_abc    |
      | error      | Model API failed |
    When ScenarioFailureHandler.ensureFailureEventsEmitted is called
    Then the emitted events include:
      | field      | value        |
      | projectId  | proj_123     |
      | scenarioId | scen_456     |
      | setId      | set_789      |
      | batchRunId | batch_abc    |

  # ============================================================================
  # Worker Event Handler Integration - Integration Tests
  # ============================================================================
  # The processor's completed handler should call the failure handler
  # when result.success is false.

  @integration
  Scenario: Worker calls failure handler on job failure
    Given a scenario job completes with result.success = false
    And the result includes error "Prefetch failed: Scenario not found"
    When the worker's completed event fires
    Then ScenarioFailureHandler.ensureFailureEventsEmitted is called
    And the handler receives the job data and error message

  @integration
  Scenario: Worker does not call failure handler on success
    Given a scenario job completes with result.success = true
    When the worker's completed event fires
    Then ScenarioFailureHandler is not invoked

  @integration
  Scenario: Failure handler errors do not crash worker
    Given a scenario job completes with result.success = false
    And ScenarioFailureHandler throws an error
    When the worker's completed event fires
    Then the error is logged
    And the worker continues processing other jobs

  # ============================================================================
  # Polling Logic Improvements - Unit Tests
  # ============================================================================
  # Update pollForScenarioRun to return early on RUN_STARTED instead of
  # waiting for messages, and properly handle error states.

  @unit
  Scenario: Return success when RUN_STARTED exists with IN_PROGRESS status
    Given a scenario run exists with:
      | scenarioRunId | run_123      |
      | status        | IN_PROGRESS  |
      | messages      | []           |
    When pollForScenarioRun fetches the batch run data
    Then it returns success with scenarioRunId "run_123"
    And does not continue polling

  @unit
  Scenario: Return error when run has ERROR status
    Given a scenario run exists with:
      | scenarioRunId | run_123      |
      | status        | ERROR        |
    When pollForScenarioRun fetches the batch run data
    Then it returns failure with error "run_error"
    And includes scenarioRunId "run_123"

  @unit
  Scenario: Return error when run has FAILED status
    Given a scenario run exists with:
      | scenarioRunId | run_123      |
      | status        | FAILED       |
    When pollForScenarioRun fetches the batch run data
    Then it returns failure with error "run_error"
    And includes scenarioRunId "run_123"

  @unit
  Scenario: Continue polling when no runs exist yet
    Given no scenario runs exist for the batchRunId
    When pollForScenarioRun is called
    Then it continues polling until timeout
    And returns failure with error "timeout" after max attempts

  # ============================================================================
  # End-to-End Failure Visibility - E2E Tests
  # ============================================================================
  # Verify the complete flow from job failure to frontend error display.

  @e2e
  Scenario: Frontend displays error instead of timeout on job failure
    Given I am logged into project "my-project"
    And scenario "Broken Config" exists with invalid prompt configuration
    When I click "Run" on the scenario
    And the job fails during prefetch
    Then I am navigated to the run visualization page
    And I see an error message explaining the failure
    And I do not see "took too long to start"

  @e2e
  Scenario: Frontend displays error when child process crashes
    Given I am logged into project "my-project"
    And scenario "Crash Test" exists
    And the scenario target causes a child process crash
    When I click "Run" on the scenario
    Then I am navigated to the run visualization page
    And I see the error from the child process
    And the run status shows ERROR

  @e2e
  Scenario: Run history shows failed runs with error details
    Given scenario "Problematic" has a failed run
    When I view the run history
    Then I see the failed run with ERROR status
    And I can click to view the error details

  # ============================================================================
  # Worker Death Handling - Stalled Job Behavior
  # ============================================================================
  # When a worker dies mid-scenario (crash, OOM, network partition), BullMQ
  # detects the stalled job after ~30s. These scenarios ensure stalled jobs
  # fail cleanly instead of retrying indefinitely.

  @unit
  Scenario: Stalled job configuration prevents retries
    Given a scenario worker is configured with job options
    When the worker options are inspected
    Then settings.attempts equals 1
    And the job will fail after first stall detection

  @integration
  Scenario: Worker logs stalled jobs with warning level
    Given a scenario worker is processing jobs
    When a job becomes stalled
    Then the worker emits a "stalled" event
    And the event is logged at warning level
    And the log includes the job ID

  @integration
  Scenario: Stalled job triggers failure handler after detection
    Given a scenario job is being processed
    And the worker dies mid-execution
    When BullMQ detects the stalled job after ~30 seconds
    Then the job transitions to failed state
    And ScenarioFailureHandler.ensureFailureEventsEmitted is called
    And the error message indicates the job was stalled
