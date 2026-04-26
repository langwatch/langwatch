Feature: Unified run table merging queued jobs and completed runs
  As a user running a suite
  I want queued, running, and completed scenarios to appear in the same run table
  So that I can track execution progress without a separate pending banner

  Background:
    Given a project with a suite containing scenarios and targets

  # Happy path: queued jobs appear as rows immediately after triggering a suite run
  @e2e @unimplemented
  Scenario: Queued jobs appear in the run table immediately after suite run
    Given I am on the suite detail page
    When I trigger a suite run
    Then all scheduled jobs appear as rows in the run table
    And each queued row shows a "queued" status indicator

  # Happy path: row status progresses through lifecycle without page refresh
  @e2e @unimplemented
  Scenario: Row status progresses from queued to running to completed
    Given I am on the suite detail page
    And a suite run has been triggered
    When the jobs begin executing
    Then queued rows transition to "running" status
    And when jobs finish, rows show pass or fail status
    And the table updates without a page refresh

  # Pass rate reflects completion progress
  @integration @unimplemented
  Scenario: Pass rate reflects total vs completed vs pending counts
    Given a suite run is in progress with some jobs completed and others pending
    When the run table renders
    Then the pass rate shows completed results out of total jobs
    And pending jobs are reflected in the count

  # Service layer: merge and deduplicate from both data sources
  @integration @unimplemented
  Scenario: All Runs view includes queued jobs across suites
    Given multiple suites have pending jobs in BullMQ
    And completed runs exist in ES across suites
    When I fetch the All Runs unified data
    Then the result includes both queued and completed rows from all suites

  # Prerequisite: scheduling stores enough metadata for table rendering
  @unit @unimplemented
  Scenario: Scheduled suite run stores scenario metadata needed for display
    Given a suite run has been scheduled
    When I inspect the BullMQ job data
    Then each job contains scenarioId, batchRunId, and targetReferenceId
    And each job contains the scenario name for display

  # Repository layer: ScenarioJobRepository normalizes BullMQ job data
  @unit @unimplemented
  Scenario: ScenarioJobRepository normalizes waiting jobs into row format
    Given a set of raw BullMQ waiting jobs with job metadata
    When the repository normalizes the jobs
    Then each job is returned with scenarioId, batchRunId, status, and timestamps

  # Repository layer: status mapping from BullMQ state
  @unit @unimplemented
  Scenario Outline: Maps BullMQ job state to scenario run status
    Given a BullMQ job in "<bullmq_state>" state
    When the status is mapped
    Then the result is "<run_status>" status

    Examples:
      | bullmq_state | run_status |
      | waiting      | queued     |
      | active       | running    |

  # Service layer: deduplication logic
  @integration @unimplemented
  Scenario: Queued rows render with a pending visual treatment
    Given the run table contains rows with "queued" status
    When the table renders
    Then queued rows display a spinner or skeleton indicator
    And queued rows do not show a pass/fail badge

  # Frontend: QueueStatusBanner is no longer needed
