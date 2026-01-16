@unit
Feature: Autosave Status Indicator
  As a user making changes in the evaluations workbench
  I want to see the save status of my changes
  So that I know my work is being preserved and can troubleshoot issues

  Background:
    Given I render the EvaluationsV3 page

  # ============================================================================
  # Status Indicator Visibility
  # ============================================================================

  Scenario: Autosave status indicator is visible in the header
    Then I see an autosave status indicator in the header
    And it is positioned near the undo/redo buttons

  # ============================================================================
  # Idle State
  # ============================================================================

  Scenario: Status shows "Saved" when no pending changes
    Given all changes have been saved
    Then the status indicator shows "Saved" with a checkmark icon

  # ============================================================================
  # Saving State
  # ============================================================================

  Scenario: Status shows "Saving..." during evaluation state save
    Given the dataset has 3 rows
    When I edit cell at row 0, column "input" to "hello"
    And the autosave is triggered
    Then the status indicator shows "Saving..." with a spinner

  Scenario: Status shows "Saving..." during dataset record sync
    Given I have a saved dataset with records loaded
    When I edit cell at row 0, column "input" to "hello"
    And the dataset sync is triggered
    Then the status indicator shows "Saving..." with a spinner

  # ============================================================================
  # Saved State
  # ============================================================================

  Scenario: Status shows "Saved" after successful evaluation state save
    Given the dataset has 3 rows
    When I edit cell at row 0, column "input" to "hello"
    And the autosave completes successfully
    Then the status indicator shows "Saved"

  Scenario: Status shows "Saved" after successful dataset record sync
    Given I have a saved dataset with records loaded
    When I edit cell at row 0, column "input" to "hello"
    And the dataset sync completes successfully
    Then the status indicator shows "Saved"

  Scenario: Status returns to idle after displaying "Saved"
    Given the status indicator shows "Saved"
    When 2 seconds pass
    Then the status indicator returns to idle state

  # ============================================================================
  # Error State
  # ============================================================================

  Scenario: Status shows error when evaluation state save fails
    Given the dataset has 3 rows
    And the network request will fail
    When I edit cell at row 0, column "input" to "hello"
    And the autosave is triggered
    Then the status indicator shows "Failed to save" with an error icon

  Scenario: Status shows error when dataset record sync fails
    Given I have a saved dataset with records loaded
    And the network request will fail
    When I edit cell at row 0, column "input" to "hello"
    And the dataset sync is triggered
    Then the status indicator shows "Failed to save" with an error icon

  # ============================================================================
  # Combined States (Evaluation + Dataset)
  # ============================================================================

  Scenario: Status shows saving when evaluation state is saving
    Given the evaluation state save is in progress
    And the dataset sync is idle
    Then the status indicator shows "Saving..."

  Scenario: Status shows saving when dataset sync is in progress
    Given the evaluation state save is idle
    And the dataset sync is in progress
    Then the status indicator shows "Saving..."

  Scenario: Error takes priority over saving state
    Given the evaluation state save failed
    And the dataset sync is in progress
    Then the status indicator shows "Failed to save"

  Scenario: Both must succeed for "Saved" status
    Given the evaluation state save completed successfully
    And the dataset sync completed successfully
    Then the status indicator shows "Saved"

  # ============================================================================
  # Tooltip Details
  # ============================================================================

  Scenario: Hovering shows detailed status breakdown
    Given the status indicator is visible
    When I hover over the status indicator
    Then I see a tooltip with detailed status information
    And the tooltip shows the evaluation state status
    And the tooltip shows the dataset sync status

  Scenario: Tooltip shows error details when there is an error
    Given the evaluation state save failed with message "Network error"
    When I hover over the status indicator
    Then the tooltip shows "Evaluation: Network error"

  # ============================================================================
  # Undo/Redo Integration
  # ============================================================================

  Scenario: Undo triggers autosave for evaluation state
    Given the dataset has 3 rows
    And I edit cell at row 0, column "input" to "hello"
    And the autosave completes
    When I click the undo button
    Then the status indicator shows "Saving..."
    And the undone state is saved

  Scenario: Undo triggers database sync for saved dataset
    Given I have a saved dataset with records loaded
    And I edit cell at row 0, column "input" to "hello"
    And the change syncs to the database
    When I click the undo button
    Then the status indicator shows "Saving..."
    And the original value is synced to the database

  # ============================================================================
  # Results Persistence
  # ============================================================================

  Scenario: Evaluation results are persisted on autosave
    Given I run an evaluation and get results
    When the autosave is triggered
    Then the results are included in the persisted state
    And targetOutputs are saved
    And targetMetadata (cost, duration, traceId) are saved
    And evaluatorResults are saved
    And errors are saved

  Scenario: Transient execution state is NOT persisted
    Given an evaluation is currently running
    When the autosave is triggered
    Then the persisted state does NOT include:
      | field          |
      | status         |
      | progress       |
      | total          |
      | executingCells |

  Scenario: Results are restored on page reload
    Given I run an evaluation and get results for all cells
    And the autosave completes
    When I refresh the page
    Then the previous results are displayed in the cells
    And target outputs show the saved values
    And evaluator chips show their saved results
    And the status is "idle" (not running)

  Scenario: Partial results are restored correctly
    Given I ran only Target 1 and got results
    And I did NOT run Target 2
    And the autosave completes
    When I refresh the page
    Then Target 1 cells show their results
    And Target 2 cells show "No output"

  Scenario: Empty results are not persisted
    Given I have not run any evaluations
    When the autosave is triggered
    Then the persisted state has no results field
    And storage is not wasted on empty objects
