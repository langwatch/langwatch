@regression
Feature: Studio dataset creation opens the correct form

  Background:
    Given the user is editing a workflow in Studio
    And the entry node is selected

  Scenario: New dataset button opens the dataset creation form directly
    When the user clicks "New dataset" on the entry node
    Then the dataset creation form opens
    And the user is not forced to upload a CSV file first

  Scenario: Creating a dataset sets it as the active dataset
    When the user clicks "New dataset" on the entry node
    And the user fills in the dataset name and submits
    Then the newly created dataset is set as the active dataset for the node

  Scenario: New dataset button works when a dataset already exists
    Given the entry node already has a dataset assigned
    When the user clicks "New dataset" on the entry node
    Then the dataset creation form opens
    And the user is not forced to upload a CSV file first
