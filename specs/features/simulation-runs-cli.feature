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
