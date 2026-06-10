Feature: Choosing and editing datasets on the workflow dataset node
  As a user building a workflow
  I want the dataset node to use the same dataset experience as the rest of the platform
  So that picking and editing test data is familiar and reliable

  # The workflow dataset node previously opened a custom full-screen dialog
  # with its own tabs, selection list, and embedded grid. That dialog is gone:
  # choosing uses the shared dataset picker drawer, editing uses the shared
  # dataset editor.

  Background:
    Given I am editing a workflow in the studio
    And the workflow has a dataset node

  # ============================================================================
  # Choosing a dataset
  # ============================================================================

  @integration @unimplemented
  Scenario: Choose opens the shared dataset picker
    When I click "Choose dataset" on the dataset node
    Then the dataset picker drawer opens
    And I can search my datasets
    And each dataset shows its entry count, column count, and last edit date

  @integration @unimplemented
  Scenario: Picking a dataset binds it to the node
    Given the dataset picker drawer is open
    When I pick the dataset "turn 10"
    Then the dataset node now uses "turn 10"
    And the node outputs match the dataset's columns

  @integration @unimplemented
  Scenario: Upload a CSV from the node
    When I choose to upload a CSV for the dataset node
    And I upload a valid CSV file
    Then a dataset is created from the file
    And it is bound to the dataset node

  # ============================================================================
  # Editing the node's dataset
  # ============================================================================

  @integration @unimplemented
  Scenario: Editing a saved dataset opens the shared editor
    Given the dataset node uses a saved dataset
    When I open the node's dataset for editing
    Then I see the shared dataset editor with the dataset's records
    And edits autosave to the dataset

  @integration @unimplemented
  Scenario: Editing a draft dataset keeps it in the workflow
    Given the dataset node uses a draft dataset that was never saved
    When I open the node's dataset for editing and change some cells
    Then the changes live in the workflow itself
    And I am offered to save the draft as a real dataset

  @integration @unimplemented
  Scenario: Column changes propagate to the node outputs
    Given the dataset node uses a saved dataset
    When I add a column "context" to the dataset from the editor
    Then the dataset node outputs include "context"

  # ============================================================================
  # Plan limits are loud, never silent
  # ============================================================================
  # Companion: specs/workflows/studio-usage-limits.feature covers the upgrade
  # prompt rendering above the studio. These scenarios cover the dataset save
  # path itself: a blocked save must never look like a successful one.

  @integration @unimplemented
  Scenario: Creating a dataset at the plan limit is clearly blocked
    Given my organization has reached its dataset plan limit
    When I try to create a dataset from the workflow
    Then I am told the limit was reached
    And the creation form does not silently discard my input

  @integration @unimplemented
  Scenario: Saving a draft dataset at the plan limit is clearly blocked
    Given my organization has reached its dataset plan limit
    And the dataset node uses a draft dataset
    When I try to save the draft as a real dataset
    Then I am told the limit was reached
    And my draft stays intact in the workflow
