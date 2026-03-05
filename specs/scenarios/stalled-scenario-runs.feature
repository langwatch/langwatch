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

  @unit
  Scenario: Run without RUN_FINISHED within threshold remains IN_PROGRESS
    Given a scenario run has RUN_STARTED at 3 minutes ago
    And no RUN_FINISHED event exists
    When the service resolves the run status
    Then the status is IN_PROGRESS

  @unit
  Scenario: Run without RUN_FINISHED beyond threshold becomes STALLED
    Given a scenario run has RUN_STARTED at 15 minutes ago
    And no RUN_FINISHED event exists
    When the service resolves the run status
    Then the status is STALLED

  @unit
  Scenario: Run at exactly the threshold boundary becomes STALLED
    Given a scenario run has RUN_STARTED at exactly 10 minutes ago
    And no RUN_FINISHED event exists
    When the service resolves the run status
    Then the status is STALLED

  @unit
  Scenario: Run with RUN_FINISHED keeps its original status regardless of age
    Given a scenario run has RUN_STARTED at 30 minutes ago
    And a RUN_FINISHED event exists with status SUCCESS
    When the service resolves the run status
    Then the status is SUCCESS

  @unit
  Scenario: Failed run with RUN_FINISHED is not marked as STALLED
    Given a scenario run has RUN_STARTED at 20 minutes ago
    And a RUN_FINISHED event exists with status ERROR
    When the service resolves the run status
    Then the status is ERROR

  @unit
  Scenario: Stall detection uses the last event timestamp, not just RUN_STARTED
    Given a scenario run has RUN_STARTED at 20 minutes ago
    And a MESSAGE_SNAPSHOT event exists at 3 minutes ago
    And no RUN_FINISHED event exists
    When the service resolves the run status
    Then the status is IN_PROGRESS

  # ============================================================================
  # Batch Status Resolution - Unit Tests
  # ============================================================================
  # The batch query path must also apply stall detection consistently.

  @unit
  Scenario: Batch query marks individual stalled runs within a batch
    Given a batch run contains 3 scenario runs
    And run "A" has RUN_FINISHED with status SUCCESS at 20 minutes ago
    And run "B" has RUN_STARTED at 15 minutes ago with no RUN_FINISHED
    And run "C" has RUN_STARTED at 2 minutes ago with no RUN_FINISHED
    When the service resolves the batch run data
    Then run "A" has status SUCCESS
    And run "B" has status STALLED
    And run "C" has status IN_PROGRESS

  # ============================================================================
  # UI Display - Integration Tests
  # ============================================================================
  # Verify that STALLED status renders with the correct visual treatment.

  @integration
  Scenario: Stalled run displays with warning visual in status icon
    Given a scenario run has status STALLED
    When the ScenarioRunStatusIcon renders
    Then the icon uses a warning color distinct from error red
    And the icon is visually distinct from IN_PROGRESS

  @integration
  Scenario: Stalled run displays warning badge in previous runs list
    Given a scenario has a past run with status STALLED
    When the previous runs list renders
    Then the stalled run shows a warning-colored badge
    And the badge label indicates the run stalled

  @integration
  Scenario: Status display shows STALLED text in simulation console
    Given a scenario run has status STALLED
    When the StatusDisplay component renders
    Then the status text reads "STALLED"
    And the text uses a warning color

  @integration
  Scenario: Stalled run is treated as complete for overlay purposes
    Given a scenario run has status STALLED
    When the SimulationStatusOverlay evaluates completion
    Then the overlay treats the run as complete
    And displays an appropriate stalled indicator

  # ============================================================================
  # End-to-End - User Workflow
  # ============================================================================
  # Full user-visible flow: user sees a stalled run and understands what happened.

  @e2e
  Scenario: User sees stalled indicator for a run that never completed
    Given I am logged into project "my-project"
    And scenario "Flaky Agent" had a run that started over 10 minutes ago
    And no RUN_FINISHED event was recorded for that run
    When I view the run history for "Flaky Agent"
    Then I see the run displayed with a stalled warning indicator
    And the run is not shown as actively in progress
    And I can distinguish it from runs that failed with an error
