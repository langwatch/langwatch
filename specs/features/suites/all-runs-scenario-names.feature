Feature: All Runs rows display scenario names
  As a user viewing the All Runs panel
  I want each run row to show the scenario names in the collapsed header
  So that I can identify which scenarios were executed without expanding each row

  Scope: All Runs view only (AllRunsPanel). Suite-specific run history is unchanged.

  Display format:
    - Scenario names appear after the suite name in the collapsed row header (muted color)
    - Names are displayed in alphabetical order for consistency
    - Truncation format: "Name1, Name2, Name3 +N more"
    - Long individual names are truncated via CSS (text-overflow: ellipsis)
    - Pass rate percentage and status icon are right-aligned (layout concern, not tested)

  Background:
    Given a batch run with scenario runs

  @integration
  Scenario: Run row displays scenario names in the collapsed header
    Given a batch run containing scenarios "Login Flow" and "Checkout Flow"
    When the run row is rendered in collapsed state
    Then the row header displays "Checkout Flow, Login Flow" after the suite name

  @integration
  Scenario: Run row displays single scenario name without separator
    Given a batch run containing scenario "Login Flow"
    When the run row is rendered in collapsed state
    Then the row header displays "Login Flow" after the suite name

  @integration
  Scenario: Run row truncates long scenario name lists
    Given a batch run containing scenarios "Alpha", "Beta", "Gamma", "Delta", "Epsilon"
    When the run row is rendered in collapsed state
    Then the row header displays "Alpha, Beta, Delta +2 more"

  @unit
  Scenario: Extracts unique sorted scenario names from batch run data
    Given scenario runs with names ["Login Flow", "Checkout Flow", "Login Flow"]
    When unique scenario names are extracted
    Then the result is ["Checkout Flow", "Login Flow"]

  @unit
  Scenario: Falls back to scenario ID when name is null or undefined
    Given a scenario run with name null and scenarioId "scenario-abc"
    When the scenario display name is resolved
    Then the result is "scenario-abc"
