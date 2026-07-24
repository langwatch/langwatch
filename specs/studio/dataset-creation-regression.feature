@regression
Feature: Studio dataset creation opens the editor directly

  # Regression guard: creating a dataset from the entry node must never
  # force the user through a CSV upload first. With the shared dataset
  # experience, "New dataset" drafts an inline dataset on the node and
  # drops the user straight into the editor.

  Background:
    Given the user is editing a workflow in Studio
    And the entry node is selected

  Scenario: New dataset button opens the dataset editor directly
    When the user clicks "New dataset" on the entry node
    Then a draft dataset opens in the editor
    And the user is not forced to upload a CSV file first

  Scenario: Creating a dataset sets it as the active dataset
    When the user clicks "New dataset" on the entry node
    Then the draft dataset is attached to the node as its active dataset

  Scenario: New dataset button works when a dataset already exists
    Given the entry node already has a dataset assigned
    When the user clicks "New dataset" on the entry node
    Then a draft dataset opens in the editor
    And the user is not forced to upload a CSV file first
