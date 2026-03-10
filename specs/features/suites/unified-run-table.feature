Feature: Unified run table merging queued jobs and completed runs
  As a user running a suite
  I want queued, running, and completed scenarios to appear in the same run table
  So that I can track execution progress without a separate pending banner

  Background:
    Given a project with a suite containing scenarios and targets

  # Happy path: queued jobs appear as rows immediately after triggering a suite run
  @e2e
  Scenario: Queued jobs appear in the run table immediately after suite run
    Given I am on the suite detail page
    When I trigger a suite run
    Then all scheduled jobs appear as rows in the run table
    And each queued row shows a "queued" status indicator

  # Happy path: row status progresses through lifecycle without page refresh
  @e2e
  Scenario: Row status progresses from queued to running to completed
    Given I am on the suite detail page
    And a suite run has been triggered
    When the jobs begin executing
    Then queued rows transition to "running" status
    And when jobs finish, rows show pass or fail status
    And the table updates without a page refresh

  # Pass rate reflects completion progress
  @integration
  Scenario: Pass rate reflects total vs completed vs pending counts
    Given a suite run is in progress with some jobs completed and others pending
    When the run table renders
    Then the pass rate shows completed results out of total jobs
    And pending jobs are reflected in the count

  # Service layer: merge and deduplicate from both data sources
  @integration
  Scenario: Service merges BullMQ jobs and ES scenario events into a unified list
    Given BullMQ has waiting and active jobs for a batch run
    And ES has completed scenario events for the same batch run
    When the service fetches the unified run list
    Then the result contains rows for both queued jobs and completed runs
    And no duplicate rows exist for the same scenario run

  # Deduplication: ES wins when both sources have data for the same scenario+target+batch
  @integration
  Scenario: ES data takes precedence over BullMQ job data
    Given a job exists in BullMQ as active for a scenario and target
    And an ES event exists for the same scenario, target, and batch run
    When the service merges both data sources
    Then only the ES-sourced row is returned for that scenario execution

  # Edge case: no queued jobs returns only ES data
  @integration
  Scenario: Returns only ES data when no jobs are queued
    Given BullMQ has no waiting or active jobs for the suite
    And ES has completed scenario events
    When the service fetches the unified run list
    Then only ES-sourced rows are returned

  # Edge case: no ES data returns only queued job rows
  @integration
  Scenario: Returns only queued rows when no ES events exist yet
    Given BullMQ has waiting jobs for a batch run
    And ES has no scenario events for that batch run
    When the service fetches the unified run list
    Then only queued job rows are returned

  # All Runs view works with unified data
  @integration
  Scenario: All Runs view includes queued jobs across suites
    Given multiple suites have pending jobs in BullMQ
    And completed runs exist in ES across suites
    When I fetch the All Runs unified data
    Then the result includes both queued and completed rows from all suites

  # Prerequisite: scheduling stores enough metadata for table rendering
  @unit
  Scenario: Scheduled suite run stores scenario metadata needed for display
    Given a suite run has been scheduled
    When I inspect the BullMQ job data
    Then each job contains scenarioId, batchRunId, and targetReferenceId
    And each job contains the scenario name for display

  # Repository layer: ScenarioJobRepository normalizes BullMQ job data
  @unit
  Scenario: ScenarioJobRepository normalizes waiting jobs into row format
    Given a set of raw BullMQ waiting jobs with job metadata
    When the repository normalizes the jobs
    Then each job is returned with scenarioId, batchRunId, status, and timestamps

  # Repository layer: status mapping from BullMQ state
  @unit
  Scenario Outline: Maps BullMQ job state to scenario run status
    Given a BullMQ job in "<bullmq_state>" state
    When the status is mapped
    Then the result is "<run_status>" status

    Examples:
      | bullmq_state | run_status |
      | waiting      | queued     |
      | active       | running    |

  # Service layer: deduplication logic
  @unit
  Scenario: Deduplication removes BullMQ entries that have matching ES entries
    Given a list of job rows and a list of ES rows
    And some entries share the same scenario, target, and batch run
    When deduplication runs
    Then overlapping entries use the ES version
    And non-overlapping entries from both sources are preserved

  # Frontend: queued/running status rendering
  @integration
  Scenario: Queued rows render with a pending visual treatment
    Given the run table contains rows with "queued" status
    When the table renders
    Then queued rows display a spinner or skeleton indicator
    And queued rows do not show a pass/fail badge

  # Frontend: QueueStatusBanner is no longer needed
  @integration
  Scenario: No separate pending banner is displayed
    Given a suite run is in progress with queued jobs
    When I view the suite detail page
    Then no separate pending jobs banner is visible
    And all pending jobs are visible as rows in the run table
