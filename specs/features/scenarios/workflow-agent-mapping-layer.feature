Feature: Workflow agent input/output mapping layer
  As a scenario author
  I want workflow agents to have their inputs and outputs mapped to the scenario contract
  So that scenario runs against workflow agents succeed without manual wiring guesswork

  Background:
    Given a project with a scenario that expects "input" and "messages" fields
    And the scenario expects "response" as the agent output

  # --- Layer 1: Auto-compute on workflow save ---

  @e2e @unimplemented
  Scenario: Scenario runs successfully after user configures mappings via drawer
    Given a workflow agent selected as the scenario target
    And the agent has empty scenarioMappings
    When the user clicks Save & Run
    And the mapping drawer opens
    And the user configures valid mappings and saves
    And the user clicks Save & Run again
    Then the scenario run executes successfully

  # --- Layer 3: Pre-run validation ---

  @integration @unimplemented
  Scenario: Create flow navigates directly to workflow studio without mapping panel
    Given the user is creating a new workflow agent from the scenario form
    When the user submits the WorkflowSelectorDrawer
    Then a blank workflow and linked agent are created
    And the user is navigated to the workflow studio
    And no mapping drawer or panel is shown during creation

  @integration @unimplemented
  Scenario: Edit flow continues to show mapping panel as before
    Given an existing workflow agent with a saved workflow
    When the user opens the agent for editing via AgentWorkflowEditorDrawer
    Then the ScenarioInputMappingSection is displayed
    And the user can view and modify the scenarioMappings

  # --- Layer 5: Agents list edit routing ---

  @integration @unimplemented
  Scenario: Editing a workflow agent from the agents list opens the editor populated with existing data
    Given an existing workflow agent with a saved workflow and configured scenarioMappings
    And the user is on the /[project]/agents page
    When the user clicks edit on the workflow agent card
    Then AgentWorkflowEditorDrawer opens with the agent id
    And the drawer is populated with the agent's name, linked workflow, and scenarioMappings
    And WorkflowSelectorDrawer is not opened
