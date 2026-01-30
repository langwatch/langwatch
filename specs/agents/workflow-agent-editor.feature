@integration
Feature: Workflow agent editor with workflow link
  As a user managing workflow agents
  I want to access the underlying workflow from the agent editor
  So that I can modify the agent logic

  Background:
    Given I am logged in to a project
    And I have a workflow "Complex Pipeline" in the project
    And I have a workflow agent "Pipeline Agent" linked to "Complex Pipeline"

  # ============================================================================
  # Edit Workflow button visibility
  # ============================================================================

  Scenario: Configure button for workflow agent shows workflow link
    Given I am on the agents page
    When I click "Configure" on agent "Pipeline Agent"
    Then I should see the workflow selector or editor
    And I should see an "Edit Workflow" button
    And the button should link to /[project]/studio/[workflow-id]

  Scenario: Code agent does not show workflow link
    Given I have a code agent "Python Processor"
    When I click "Configure" on agent "Python Processor"
    Then I should see the code editor
    And I should NOT see an "Edit Workflow" button

  Scenario: HTTP agent does not show workflow link
    Given I have an HTTP agent "API Connector"
    When I click "Configure" on agent "API Connector"
    Then I should see the HTTP configuration form
    And I should NOT see an "Edit Workflow" button

  # ============================================================================
  # Navigation to workflow
  # ============================================================================

  Scenario: Click Edit Workflow navigates to studio
    Given I am editing workflow agent "Pipeline Agent"
    When I click "Edit Workflow"
    Then I should be navigated to the workflow studio
    And the URL should be /[project]/studio/[workflow-id]

  Scenario: Workflow link includes correct workflow ID
    Given workflow "Complex Pipeline" has ID "wf_456def"
    When I open the editor for agent "Pipeline Agent"
    Then the "Edit Workflow" link should point to studio/wf_456def

  # ============================================================================
  # Workflow agent editor content
  # ============================================================================

  Scenario: Workflow agent shows name and workflow selection
    Given I open the editor for agent "Pipeline Agent"
    Then I should see the agent name field
    And I should see the linked workflow "Complex Pipeline"
    And I should see the "Edit Workflow" button

  Scenario: Can rename workflow agent without changing workflow
    Given I open the editor for agent "Pipeline Agent"
    When I change the name to "Renamed Pipeline Agent"
    And I click Save
    Then the agent should be renamed
    And the linked workflow should remain "Complex Pipeline"

  # ============================================================================
  # Edge cases
  # ============================================================================

  Scenario: Workflow agent with deleted workflow shows warning
    Given workflow "Deleted Pipeline" has been deleted
    And agent "Orphan Agent" still references it
    When I open the editor for "Orphan Agent"
    Then I should see a warning that the workflow was deleted
    And the "Edit Workflow" button should be disabled or hidden
