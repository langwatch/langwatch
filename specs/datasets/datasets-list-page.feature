Feature: Datasets list page
  As a user with several datasets
  I want a clear overview of my datasets
  So that I can find, open, and manage them quickly

  Background:
    Given I am on the datasets page of my project

  # ============================================================================
  # Listing
  # ============================================================================

  @integration @unimplemented
  Scenario: Datasets are listed with their key facts
    Given my project has datasets
    Then I see one row per dataset
    And each row shows the dataset name, its columns, the number of entries, and when it was last updated

  @integration @unimplemented
  Scenario: Search datasets by name
    Given my project has datasets "offline evals" and "production samples"
    When I search for "offline"
    Then I see "offline evals"
    And I do not see "production samples"

  @integration @unimplemented
  Scenario: Open a dataset
    When I click a dataset row
    Then I land on that dataset's editor page

  @integration @unimplemented
  Scenario: Empty project shows a helpful empty state
    Given my project has no datasets
    Then I see an empty state explaining what datasets are for
    And I can create a dataset right from the empty state

  # ============================================================================
  # Creating
  # ============================================================================

  @integration @unimplemented
  Scenario: Create a dataset from scratch
    When I choose to create a new dataset
    And I give it a name and columns
    Then the dataset appears in the list

  @integration @unimplemented
  Scenario: Create a dataset from a CSV file
    When I upload a CSV file
    Then a dataset is created with the file's columns and rows
    And it appears in the list

  # ============================================================================
  # Managing
  # ============================================================================

  @integration @unimplemented
  Scenario: Delete a dataset with undo
    When I delete a dataset from its row menu
    Then the dataset disappears from the list
    And I can undo the deletion from the confirmation message

  @integration @unimplemented
  Scenario: Replicate a dataset to another project
    When I choose "Replicate to another project" from a dataset's row menu
    Then I can pick a target project
    And the dataset is copied there
