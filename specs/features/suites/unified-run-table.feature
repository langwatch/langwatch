Feature: Unified run table merging queued jobs and completed runs
  As a user running a suite
  I want queued, running, and completed scenarios to appear in the same run table
  So that I can track execution progress without a separate pending banner

  # Parity status: 4 of 12 scenarios bound to existing tests.
  # Remaining @unimplemented scenarios (#3458):
  #   8 NO_TEST: shipped behavior, no integration test yet
  # NO_TEST gaps:
  #   - "Queued jobs appear in the run table immediately after suite run"
  #   - "Row status progresses from queued to running to completed"
  #   - "Pass rate reflects total vs completed vs pending counts"
  #   - "All Runs view includes queued jobs across suites"
  #   - "Scheduled suite run stores scenario metadata needed for display"
  #   - "ScenarioJobRepository normalizes waiting jobs into row format"
  #   - "Queued rows render with a pending visual treatment"
  #   - "Maps BullMQ job state to scenario run status" (Scenario Outline)

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

  # Service layer: one source of truth covers the whole run lifecycle
  @integration
  Scenario: Service returns queued and completed runs in a unified list
    Given a batch run has scenario runs still queued
    And the same batch run has scenario runs that already completed
    When the service fetches the unified run list
    Then the result contains rows for both queued and completed runs
    And no duplicate rows exist for the same scenario run

  # A run that has progressed shows its latest state, never a stale placeholder
  @integration
  Scenario: A scenario run shows its latest state
    Given a scenario run that was queued and has since completed
    When the service fetches the unified run list
    Then only one row is returned for that scenario execution
    And the row shows the completed result

  # Edge case: nothing pending returns only completed rows
  @integration
  Scenario: Returns only completed rows when no runs are queued
    Given the suite has no queued or running scenario runs
    And completed scenario runs exist
    When the service fetches the unified run list
    Then only completed rows are returned

  # Edge case: nothing completed yet returns only queued rows
  @integration
  Scenario: Returns only queued rows when no runs have completed yet
    Given a batch run has scenario runs queued
    And none of them have reported results yet
    When the service fetches the unified run list
    Then only queued rows are returned

  # All Runs view works with unified data
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
  @unit
  Scenario: Deduplication keeps a single row per scenario execution
    Given a run list where some entries share the same scenario, target, and batch run
    When deduplication runs
    Then overlapping entries collapse to the most recent state
    And non-overlapping entries are preserved

  # Frontend: queued/running status rendering
  @integration @unimplemented
  Scenario: Queued rows render with a pending visual treatment
    Given the run table contains rows with "queued" status
    When the table renders
    Then queued rows display a spinner or skeleton indicator
    And queued rows do not show a pass/fail badge
