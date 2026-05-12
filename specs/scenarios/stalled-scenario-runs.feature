Feature: Detect and display stalled scenario runs
  As a LangWatch user
  I want stalled scenario runs to be detected and clearly distinguished from active runs
  So that I understand when a run will never complete due to infrastructure issues

  # Context: When a worker dies (OOM, container kill, stalled job) the RUN_FINISHED
  # event never reaches ElasticSearch. Without detection, these runs appear as
  # "in progress" forever. This feature derives a STALLED status at read time
  # when a run has RUN_STARTED but no RUN_FINISHED and enough time has passed.
  #
  # The stall threshold is ~10 minutes (job timeout is 5 minutes, so 2x covers
  # all reasonable completion scenarios). No new events are written to ES, no
  # cron jobs, no extra infrastructure.

  # ============================================================================
  # Stall Detection Logic - Unit Tests
  # ============================================================================
  # Pure logic: given event timestamps and current time, derive the correct status.

  @unit @unimplemented
  Scenario: Run at exactly the threshold boundary becomes STALLED
    Given a scenario run has RUN_STARTED at exactly 10 minutes ago
    And no RUN_FINISHED event exists
    When the service resolves the run status
    Then the status is STALLED

  # ============================================================================
  # Batch Status Resolution - Unit Tests
  # ============================================================================
  # The batch query path must also apply stall detection consistently.

  # ============================================================================
  # UI Display - Integration Tests
  # ============================================================================
  # Verify that STALLED status renders with the correct visual treatment.

  # ============================================================================
  # End-to-End - User Workflow
  # ============================================================================
  # Full user-visible flow: user sees a stalled run and understands what happened.

  @e2e @unimplemented
  Scenario: User sees stalled indicator for a run that never completed
    Given I am logged into project "my-project"
    And scenario "Flaky Agent" had a run that started over 10 minutes ago
    And no RUN_FINISHED event was recorded for that run
    When I view the run history for "Flaky Agent"
    Then I see the run displayed with a stalled warning indicator
    And the run is not shown as actively in progress
    And I can distinguish it from runs that failed with an error
