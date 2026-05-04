Feature: Scenario Deferred Persistence
  As a LangWatch user
  I want the scenario to only be saved when I click "Save"
  So that I can explore the editor without creating incomplete records

  Background:
    Given I am logged into project "my-project"
    And the scenarios list has a known count

  @e2e @unimplemented
  Scenario: Editing after first save updates the existing scenario
    Given I opened the editor via "New Scenario"
    And I filled in "Name" with "Original Name"
    And I clicked "Save"
    When I change the name to "Updated Name"
    And I click "Save" again
    Then "Updated Name" appears in the scenarios list
    And "Original Name" does not appear in the scenarios list

