Feature: Workflow Management UI
  As a LangWatch user
  I want to manage my workflows through the UI
  So that I can organize and maintain my workflow library

  Background:
    Given I am authenticated as a project member
    And the project has existing workflows

  # ============================================================================
  # Workflow Deletion
  # ============================================================================

  @unit
  Scenario: Delete confirmation dialog captures keyboard input
    Given I am on the workflows page
    And I open the workflow card menu
    When I click "Delete"
    And I type "d" in the confirmation input
    Then the input should contain "d"
    And I should remain on the workflows page
    And no navigation should occur

  @unit
  Scenario: Delete confirmation dialog allows full text entry
    Given I am on the workflows page
    And I open the workflow card menu
    And I click "Delete"
    When I type "delete" in the confirmation input
    Then the input should contain "delete"
    And the Delete button should be enabled
    And I should remain on the workflows page

  @unit
  Scenario: Delete confirmation dialog Enter key submits when valid
    Given I am on the workflows page
    And I open the workflow card menu
    And I click "Delete"
    And I have typed "delete" in the confirmation input
    When I press Enter
    Then the workflow should be deleted
    And the dialog should close

  @unit
  Scenario: Delete confirmation dialog Enter key does nothing when invalid
    Given I am on the workflows page
    And I open the workflow card menu
    And I click "Delete"
    And I have typed "del" in the confirmation input
    When I press Enter
    Then the workflow should not be deleted
    And the dialog should remain open

  @unit
  Scenario: Delete confirmation dialog keyboard events do not propagate
    Given I am on the workflows page
    And the WorkflowCard is wrapped in a navigation Link
    And I open the delete confirmation dialog
    When I interact with the confirmation input using keyboard
    Then keyboard events should not bubble to the parent Link
    And no navigation should be triggered
