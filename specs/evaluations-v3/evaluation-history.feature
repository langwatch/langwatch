@unit
Feature: Evaluation history and versioning
  As a user iterating on evaluations
  I want to see previous evaluation runs with their exact configurations
  So that I can compare results and restore previous versions

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the dataset has 3 rows with test data
    And an agent "GPT-4o" is configured and mapped
    And an evaluator "Exact Match" is configured and mapped

  # ============================================================================
  # Auto-save workflow version on run
  # ============================================================================

  Scenario: Running evaluation auto-saves a new workflow version
    When I click the "Evaluate" button
    Then a new workflow version is automatically created
    And the version has an auto-generated name like "Run 1" or timestamp
    And the version includes the current dataset, agents, and evaluators configuration

  Scenario: Each evaluation run creates a distinct version
    When I run the evaluation
    And the evaluation completes
    And I add a new evaluator "LLM as Judge"
    And I run the evaluation again
    Then 2 workflow versions exist in history
    And each version has its own results associated

  # ============================================================================
  # History panel
  # ============================================================================

  Scenario: Open history panel
    Given at least one evaluation has been run
    When I click the "History" button
    Then the history panel opens
    And I see a list of previous evaluation runs
    And each run shows the version name and timestamp

  Scenario: History panel shows run summary
    Given 2 evaluations have been run previously
    When I open the history panel
    Then I see both runs listed
    And each run shows a summary like "3 rows, 1 agent, 2 evaluators"
    And the most recent run is highlighted or at the top

  # ============================================================================
  # View historical results
  # ============================================================================

  Scenario: Select a previous version from history
    Given I ran an evaluation with evaluator "Exact Match"
    And I added evaluator "LLM as Judge" and ran again
    When I open the history panel
    And I click on the first run (with only "Exact Match")
    Then the table shows the configuration from that version
    And the table shows the results from that version
    And only "Exact Match" evaluator column is visible
    And the results display exactly as they did when that run completed

  Scenario: Current unsaved changes indicator
    Given I ran an evaluation
    And I modified the prompt after the run
    When I open the history panel
    Then the current state shows as "Unsaved changes" or similar indicator
    And the previous run shows as a distinct saved version

  # ============================================================================
  # Restore and edit from history
  # ============================================================================

  Scenario: Restore a previous version for editing
    Given I have 2 versions in history
    And I'm viewing the older version
    When I click "Restore this version" or start editing
    Then the configuration from that version becomes the current working state
    And I can modify the dataset, agents, or evaluators
    And running a new evaluation creates a new version (not overwrite the old one)

  Scenario: Edit dataset in restored version
    Given I restored a previous version
    When I double-click a dataset cell
    And I change the value
    Then the cell is editable
    And the results show as stale or clear
    And I can run a new evaluation with the modified data

  Scenario: Add evaluator to restored version
    Given I restored a previous version with 1 evaluator
    When I add a new evaluator "Semantic Similarity"
    Then the new evaluator column appears
    And the new evaluator cells show as empty (no results yet)
    And I can run a new evaluation to get results for all evaluators

  # ============================================================================
  # History state management
  # ============================================================================

  Scenario: Switching between history versions preserves current work
    Given I have unsaved changes to the current configuration
    When I view a previous version in history
    And I switch back to "Current" or "Latest"
    Then my unsaved changes are still present
    And I haven't lost any work

  Scenario: Clear indication of viewing historical version
    Given I selected a previous version from history
    Then a banner or indicator shows "Viewing version from [timestamp]"
    And it's clear this is read-only historical data
    And there's an option to "Restore" or "Edit from here"

  Scenario: History versions are immutable
    Given I'm viewing a previous version
    Then the dataset cells are read-only
    And the agent/evaluator configs show as view-only
    And I must explicitly "Restore" to make changes
