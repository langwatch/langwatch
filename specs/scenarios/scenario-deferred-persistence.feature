Feature: Scenario Deferred Persistence
  As a LangWatch user
  I want the scenario to only be saved when I click "Save"
  So that I can explore the editor without creating incomplete records

  Background:
    Given I am logged into project "my-project"
    And the scenarios list has a known count

  @e2e
  Scenario: Create with AI opens editor without adding to the list
    Given I am on the scenarios list page
    When I click "New Scenario"
    And I generate a scenario with AI
    Then I see the scenario editor with the generated content
    And the scenarios list count is unchanged

  @e2e
  Scenario: Create blank opens editor without adding to the list
    Given I am on the scenarios list page
    When I click "New Scenario"
    And I skip AI generation
    Then I see an empty scenario editor
    And the scenarios list count is unchanged

  @e2e
  Scenario: Save persists a new scenario
    Given I opened the editor via "New Scenario"
    And I filled in "Name" with "Refund Request Test"
    And I filled in "Situation" with "User requests a refund"
    And I added criterion "Agent acknowledges the issue"
    When I click "Save"
    Then "Refund Request Test" appears in the scenarios list

  @e2e
  Scenario: Editing after first save updates the existing scenario
    Given I opened the editor via "New Scenario"
    And I filled in "Name" with "Original Name"
    And I clicked "Save"
    When I change the name to "Updated Name"
    And I click "Save" again
    Then "Updated Name" appears in the scenarios list
    And "Original Name" does not appear in the scenarios list

  @integration
  Scenario: Closing the editor before saving abandons the draft
    Given I opened the editor via "New Scenario"
    And I filled in "Name" with "Draft Scenario"
    When I close the editor without saving
    Then "Draft Scenario" does not appear in the scenarios list
    And the scenarios list count is unchanged
