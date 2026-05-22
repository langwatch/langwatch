@unit
Feature: Dataset management in evaluations workbench
  As a user configuring an evaluation
  I want to manage multiple datasets in the workbench
  So that I can easily switch between different test data sources

  Background:
    Given I render the EvaluationsV3 spreadsheet table
    And the default "Test Data" inline dataset is available

  # ============================================================================
  # Dataset tabs display
  # ============================================================================

  @unimplemented
  Scenario: View dataset header with label
    Then I see the "Datasets" label with a database icon in the header
    And I see the "Test Data" tab
    And I see a "+" button to add more datasets
    And I see an edit button for the current dataset

  @unimplemented
  Scenario: Dataset tab shows database icon indicator
    Given I have both inline and saved datasets in the workbench
    Then saved dataset tabs show a blue database icon
    And inline dataset tabs show a default colored database icon

  @unimplemented
  Scenario: Active tab shows dropdown, inactive does not
    Given I have datasets "Test Data" and "Other Dataset" in the workbench
    And "Test Data" is the active dataset
    Then the active "Test Data" tab shows a dropdown arrow
    And the "Other Dataset" tab has no dropdown arrow

  # ============================================================================
  # Add dataset menu
  # ============================================================================
  @unimplemented
  Scenario: Select existing dataset opens drawer
    When I click the "+" button in the dataset header
    And I select "Select existing dataset" from the dropdown
    Then a drawer opens with title "Choose Dataset"
    And I see a search input to filter datasets
    And I see a list of datasets with entry count, column count, and last edit date

  @unimplemented
  Scenario: Add existing dataset to workbench
    Given the "Choose Dataset" drawer is open
    When I click on dataset "Production Samples"
    Then the drawer closes
    And "Production Samples" tab appears in the dataset header
    And "Production Samples" becomes the active dataset
    And the dataset columns are loaded into the workbench

  @unimplemented
  Scenario: Upload CSV opens existing modal
    When I click the "+" button in the dataset header
    And I select "Upload CSV" from the dropdown
    Then the existing Upload CSV modal opens
    And after uploading, the dataset is saved to the database
    And the saved dataset is added to the workbench

  # ============================================================================
  # Active dataset dropdown menu
  # ============================================================================
  @unimplemented
  Scenario: Active tab dropdown hides remove for single dataset
    Given I only have "Test Data" in the workbench
    When I click on the active "Test Data" tab dropdown
    Then I do NOT see "Remove from workbench" option

  # ============================================================================
  # Save as dataset
  # ============================================================================

  @unimplemented
  Scenario: Save inline dataset opens AddOrEditDatasetDrawer
    Given "Test Data" has been modified with custom rows
    When I click on the active "Test Data" tab dropdown
    And I select "Save as dataset"
    Then the AddOrEditDatasetDrawer opens with current data pre-filled
    And I can edit the dataset name
    And I can review columns and data

  @unimplemented
  Scenario: After saving, tab references saved dataset
    Given I am saving "Test Data" via AddOrEditDatasetDrawer
    When the save completes successfully
    Then the "Test Data" tab is replaced with a reference to the saved dataset
    And the tab shows a blue database icon indicating saved type

  # ============================================================================
  # Edit dataset
  # ============================================================================

  @unimplemented
  Scenario: Edit dataset button opens panel
    When I click the edit button in the dataset header
    Then a translucent panel opens on the right side
    And I can edit the dataset name
    And I can add, remove, or rename columns
    And changes are applied to the current active dataset

  @unimplemented
  Scenario: Toggle column visibility in edit panel
    When I click the edit button in the dataset header
    Then each column row shows an eye icon button
    When I click the eye icon for column "metadata"
    Then the "metadata" column is hidden from the table
    And the eye icon changes to indicate hidden state

  @unimplemented
  Scenario: Column visibility is UI-only state
    Given the "metadata" column is hidden via the eye toggle
    When I save the dataset
    Then the column visibility state is NOT saved to the dataset
    And the column visibility persists only in the evaluation UI state

  @unimplemented
  Scenario: Show hidden column again
    Given the "metadata" column is hidden
    When I click the edit button in the dataset header
    And I click the eye icon for column "metadata"
    Then the "metadata" column reappears in the table

  # ============================================================================
  # Execution with active dataset
  # ============================================================================

  @unimplemented
  Scenario: Active dataset used for execution
    Given I have datasets "Test Data" and "Production Samples" in the workbench
    And "Production Samples" is the active dataset
    When I run the evaluation
    Then the evaluation runs against "Production Samples" data
    And results are displayed for "Production Samples" rows

  # ============================================================================
  # Mapping integration
  # ============================================================================

  @unimplemented
  Scenario: Cleanup mappings when removing dataset
    Given agent "GPT-4o" has input mapping from "External Dataset" column "question"
    When I remove "External Dataset" from the workbench
    Then the mapping from "External Dataset.question" is removed

  @unimplemented
  Scenario: Mappings show dataset source in agent config
    Given I have multiple datasets in the workbench
    When I open the agent configuration panel
    Then the mapping dropdown shows columns grouped by dataset
    And the active dataset group is marked as "(active)"
