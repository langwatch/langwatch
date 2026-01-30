@integration
Feature: Create workflow agent via new workflow
  As a user creating a workflow agent
  I want to create a new workflow with a blank template
  So that I can build my agent logic from scratch

  Background:
    Given I am logged in to a project

  # ============================================================================
  # Agent type selector UI
  # ============================================================================

  Scenario: Workflow agent option description updated
    When I open the agent type selector
    Then I should see "Workflow Agent" option
    And the description should indicate creating a new workflow
    And it should have a workflow icon

  # ============================================================================
  # New workflow creation flow
  # ============================================================================

  Scenario: Workflow agent option opens workflow creator
    Given I am on the agents page
    When I click "New Agent"
    And I select "Workflow Agent"
    Then the New Workflow modal should open
    And the "Blank" template should be pre-selected
    And I should be on step 2 (name and description)
    And I should NOT see the template selection grid

  Scenario: After creating workflow, agent is auto-created
    Given I clicked "Workflow Agent" option
    And the New Workflow modal is open with Blank template
    When I enter name "Pipeline Agent"
    And I click "Create"
    Then a workflow "Pipeline Agent" should be created
    And an agent "Pipeline Agent" should be auto-created
    And the agent should have type "workflow"
    And the agent should reference the new workflow
    And I should be redirected to the workflow studio

  Scenario: Agent inherits workflow name automatically
    Given I clicked "Workflow Agent" option
    When I create a workflow named "Data Processor"
    Then the auto-created agent should also be named "Data Processor"

  Scenario: Workflow is created with blank template structure
    Given I clicked "Workflow Agent" option
    When I create workflow "My Agent Workflow"
    Then the workflow should have the Blank template structure
    And the workflow should have workflow_type "workflow"
    And the entry node should be present
    And the end node should be present

  # ============================================================================
  # Cancellation and error handling
  # ============================================================================

  Scenario: Canceling workflow creation does not create agent
    Given I clicked "Workflow Agent" option
    And the New Workflow modal is open
    When I click "Cancel" or close the modal
    Then no workflow should be created
    And no agent should be created
    And I should return to the agent type selector

  Scenario: Workflow creation failure does not create orphan agent
    Given I clicked "Workflow Agent" option
    And the workflow creation will fail
    When I try to create the workflow
    Then an error message should appear
    And no agent should be created

  # ============================================================================
  # Code and HTTP agents unchanged
  # ============================================================================

  Scenario: Code agent flow remains unchanged
    Given I am on the agents page
    When I click "New Agent"
    And I select "Code Agent"
    Then the AgentCodeEditorDrawer should open
    And I should NOT see the New Workflow modal

  Scenario: HTTP agent flow remains unchanged
    Given I am on the agents page
    When I click "New Agent"
    And I select "HTTP Agent"
    Then the AgentHttpEditorDrawer should open
    And I should NOT see the New Workflow modal

  # ============================================================================
  # Agent page flow
  # ============================================================================

  Scenario: New agent appears in list after creation
    Given I created workflow agent "New Pipeline" via the create flow
    When I navigate to the agents page
    Then I should see "New Pipeline" in the agents list
    And it should show type "Workflow"
    And clicking it should show the workflow link
