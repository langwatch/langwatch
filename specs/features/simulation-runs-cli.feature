Feature: Simulation Run CLI Commands
  As a developer using LangWatch from the terminal
  I want to view simulation run results via CLI commands
  So that I can inspect scenario execution outcomes without using the UI

  Background:
    Given I have a valid LANGWATCH_API_KEY configured

  Scenario: List simulation runs
    Given my project has completed simulation runs
    When I run "langwatch simulation-run list"
    Then I see a list of runs with status, duration, and cost

  Scenario: List simulation runs when none exist
    Given my project has no simulation runs
    When I run "langwatch simulation-run list"
    Then I see a message indicating no simulation runs were found

  Scenario: List runs filtered by scenario set
    Given my project has runs for scenario set "set_abc"
    When I run "langwatch simulation-run list --scenario-set-id set_abc"
    Then I see only runs belonging to that scenario set

  Scenario: List runs filtered by batch
    Given my project has runs for batch "batch_xyz" in scenario set "set_abc"
    When I run "langwatch simulation-run list --scenario-set-id set_abc --batch-run-id batch_xyz"
    Then I see only runs from that specific batch

  Scenario: Get simulation run details
    Given my project has a completed simulation run "run_123"
    When I run "langwatch simulation-run get run_123"
    Then I see full run details including conversation messages, verdict, and criteria

  Scenario: Get simulation run with passed verdict
    Given my project has a simulation run that passed all criteria
    When I run "langwatch simulation-run get <run-id>"
    Then I see the verdict as "passed" with met criteria listed

  Scenario: Get simulation run with failed verdict
    Given my project has a simulation run with unmet criteria
    When I run "langwatch simulation-run get <run-id>"
    Then I see the verdict as "failed" with unmet criteria listed

  Scenario: Get simulation run that does not exist
    When I run "langwatch simulation-run get nonexistent-id"
    Then I see an error that the simulation run was not found

  Scenario: Output as JSON
    Given my project has completed simulation runs
    When I run "langwatch simulation-run list --format json"
    Then I see the runs as raw JSON including all fields

  # ============================================================================
  # Note and test case version (Agent Testing v2)
  # ============================================================================
  # The note belongs to the batch (specs/suites/run-notes.feature); the version
  # is the test case version the run used
  # (specs/scenarios/scenario-version-on-runs.feature). Both read as named
  # fields, never as raw metadata.

  @unit
  Scenario: List simulation runs shows the note and the scenario version
    Given my project has runs started with a note
    When I run "langwatch simulation-run list"
    Then each row shows the note of its batch
    And each row shows the scenario version the run used

  @unit
  Scenario: List simulation runs where a run has no note
    Given my project has runs started without a note
    When I run "langwatch simulation-run list"
    Then the note column is empty for those runs
    And no other column shifts

  @unit
  Scenario: Get simulation run shows the note and the scenario version
    Given my project has a completed simulation run started with a note
    When I run "langwatch simulation-run get <run-id>"
    Then I see the note of the batch
    And I see the scenario version the run used

  @unit
  Scenario: Get a simulation run stored before versions were recorded
    Given my project has a run stored before scenario versions were recorded
    When I run "langwatch simulation-run get <run-id>"
    Then no scenario version is shown
    And the rest of the run details are shown as before

  @unit
  Scenario: JSON output carries the note and the version as named fields
    Given my project has completed simulation runs started with a note
    When I run "langwatch simulation-run list --format json"
    Then each run carries a "note" field and a "scenarioVersion" field
    And raw run metadata is not part of the output
