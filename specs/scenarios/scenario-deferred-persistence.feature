Feature: Scenario Deferred Persistence
  As a LangWatch user
  I want the scenario to only be saved when I click "Save"
  So that I can explore the editor without creating incomplete records

  Background:
    Given I am logged into project "my-project"
    And the scenarios list has a known count

  # Per AUDIT_MANIFEST.md: 5 scenarios → 4 DUPLICATE (now bound via @scenario
  # JSDoc against ScenarioFormDrawer.integration.test.tsx) + 1 KEEP for the
  # second-save-update-not-create case. The KEEP scenario remains @unimplemented
  # pending integration test coverage in PR #3458.

  @e2e @unimplemented
  Scenario: Editing after first save updates the existing scenario
    Given I opened the editor via "New Scenario"
    And I filled in "Name" with "Original Name"
    And I clicked "Save"
    When I change the name to "Updated Name"
    And I click "Save" again
    Then "Updated Name" appears in the scenarios list
    And "Original Name" does not appear in the scenarios list
