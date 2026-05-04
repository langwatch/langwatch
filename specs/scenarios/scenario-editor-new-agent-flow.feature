Feature: Scenario editor new agent flow
  As a LangWatch user
  I want to create a new agent from the scenario editor
  So that I can set up agents without leaving the scenario editing workflow

  Background:
    Given I am logged into project "my-project"
    And I am on the scenario editor

  # ============================================================================
  # Core: Agent type selection from scenario editor
  # ============================================================================

  @integration @unimplemented
  Scenario: Clicking "Add New Agent" in save-and-run menu opens agent type selection
    Given the save-and-run menu is open
    When I click "Add New Agent"
    Then the AgentTypeSelectorDrawer opens
    And I see options for "HTTP Agent", "Code Agent", and "Workflow Agent"

  # Regression #1903: clicking "Add New Agent" should keep the type selection flow usable.

  # ============================================================================
  # Full create-agent-from-scenario flow
  # ============================================================================

  @integration @unimplemented
  Scenario: Selecting HTTP agent type from scenario editor opens HTTP editor
    Given the save-and-run menu is open
    And I clicked "Add New Agent"
    And the AgentTypeSelectorDrawer is open
    When I select "HTTP Agent"
    Then the AgentHttpEditorDrawer opens

  @integration @unimplemented
  Scenario: Cancelling agent type selection returns to scenario editor
    Given the save-and-run menu is open
    And I clicked "Add New Agent"
    And the AgentTypeSelectorDrawer is open
    When I close the AgentTypeSelectorDrawer
    Then I return to the scenario editor
    And no agent is created
