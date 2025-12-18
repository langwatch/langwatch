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

  Scenario: View dataset header with label
    Then I see the "Datasets" label with a database icon in the header
    And I see the "Test Data" tab
    And I see a "+" button to add more datasets
    And I see an edit button for the current dataset

  Scenario: Dataset tab shows database icon indicator
    Given I have both inline and saved datasets in the workbench
    Then saved dataset tabs show a blue database icon
    And inline dataset tabs show a default colored database icon

  Scenario: Active tab shows dropdown, inactive does not
    Given I have datasets "Test Data" and "Other Dataset" in the workbench
    And "Test Data" is the active dataset
    Then the active "Test Data" tab shows a dropdown arrow
    And the "Other Dataset" tab has no dropdown arrow

  # ============================================================================
  # Switching datasets
  # ============================================================================

  Scenario: Switch datasets by clicking inactive tab
    Given I have datasets "Test Data" and "Production Samples" in the workbench
    And "Test Data" is the active dataset
    When I click on the "Production Samples" tab
    Then "Production Samples" becomes the active dataset
    And the table displays columns from "Production Samples"
    And the table displays data from "Production Samples"

  # ============================================================================
  # Add dataset menu
  # ============================================================================

  Scenario: Add dataset menu shows options in correct order
    When I click the "+" button in the dataset header
    Then I see "Select existing dataset" option first
    And I see "Upload CSV" option second
    And I see "Create new" option third

  Scenario: Select existing dataset opens drawer
    When I click the "+" button in the dataset header
    And I select "Select existing dataset" from the dropdown
    Then a drawer opens with title "Choose Dataset"
    And I see a search input to filter datasets
    And I see a list of datasets with name, column count, and last edit date

  Scenario: Search datasets in drawer
    Given the "Choose Dataset" drawer is open
    And there are datasets "thread_test2", "Draft Evaluation (245)" in the project
    When I type "thread" in the search input
    Then only "thread_test2" is shown in the list

  Scenario: Add existing dataset to workbench
    Given the "Choose Dataset" drawer is open
    When I click on dataset "Production Samples"
    Then the drawer closes
    And "Production Samples" tab appears in the dataset header
    And "Production Samples" becomes the active dataset
    And the dataset columns are loaded into the workbench

  Scenario: Upload CSV opens existing modal
    When I click the "+" button in the dataset header
    And I select "Upload CSV" from the dropdown
    Then the existing Upload CSV modal opens
    And after uploading, the dataset is saved to the database
    And the saved dataset is added to the workbench

  Scenario: Create new dataset copies first dataset columns
    Given "Test Data" has columns "input", "expected_output", "context"
    When I click the "+" button in the dataset header
    And I select "Create new" from the dropdown
    Then a new "Dataset 2" tab appears
    And the new dataset has columns "input", "expected_output", "context"
    And the new dataset becomes active

  # ============================================================================
  # Active dataset dropdown menu
  # ============================================================================

  Scenario: Active tab dropdown shows save option for inline
    Given "Test Data" is an inline dataset and is active
    When I click on the active "Test Data" tab dropdown
    Then I see "Save as dataset" option
    And I do NOT see "Switch to dataset" option

  Scenario: Active tab dropdown shows remove when multiple datasets
    Given I have datasets "Test Data" and "Other Dataset" in the workbench
    And "Test Data" is the active dataset
    When I click on the active "Test Data" tab dropdown
    Then I see "Remove from workbench" option

  Scenario: Active tab dropdown hides remove for single dataset
    Given I only have "Test Data" in the workbench
    When I click on the active "Test Data" tab dropdown
    Then I do NOT see "Remove from workbench" option

  Scenario: Saved dataset dropdown has no save option
    Given "Production Samples" is a saved dataset and is active
    When I click on the active "Production Samples" tab dropdown
    Then I do NOT see "Save as dataset" option

  # ============================================================================
  # Save as dataset
  # ============================================================================

  Scenario: Save inline dataset opens AddOrEditDatasetDrawer
    Given "Test Data" has been modified with custom rows
    When I click on the active "Test Data" tab dropdown
    And I select "Save as dataset"
    Then the AddOrEditDatasetDrawer opens with current data pre-filled
    And I can edit the dataset name
    And I can review columns and data

  Scenario: After saving, tab references saved dataset
    Given I am saving "Test Data" via AddOrEditDatasetDrawer
    When the save completes successfully
    Then the "Test Data" tab is replaced with a reference to the saved dataset
    And the tab shows a blue database icon indicating saved type

  # ============================================================================
  # Remove dataset
  # ============================================================================

  Scenario: Remove dataset from workbench
    Given I have datasets "Test Data" and "Production Samples" in the workbench
    And "Production Samples" is active
    When I click on the active "Production Samples" tab dropdown
    And I select "Remove from workbench"
    Then "Production Samples" is removed from the tabs
    And "Test Data" becomes the active dataset
    And mappings pointing to "Production Samples" are cleaned up

  # ============================================================================
  # Edit dataset
  # ============================================================================

  Scenario: Edit dataset button opens panel
    When I click the edit button in the dataset header
    Then a translucent panel opens on the right side
    And I can edit the dataset name
    And I can add, remove, or rename columns
    And changes are applied to the current active dataset

  # ============================================================================
  # Execution with active dataset
  # ============================================================================

  Scenario: Active dataset used for execution
    Given I have datasets "Test Data" and "Production Samples" in the workbench
    And "Production Samples" is the active dataset
    When I run the evaluation
    Then the evaluation runs against "Production Samples" data
    And results are displayed for "Production Samples" rows

  # ============================================================================
  # Mapping integration
  # ============================================================================

  Scenario: Cleanup mappings when removing dataset
    Given agent "GPT-4o" has input mapping from "External Dataset" column "question"
    When I remove "External Dataset" from the workbench
    Then the mapping from "External Dataset.question" is removed

  Scenario: Mappings show dataset source in agent config
    Given I have multiple datasets in the workbench
    When I open the agent configuration panel
    Then the mapping dropdown shows columns grouped by dataset
    And the active dataset group is marked as "(active)"
