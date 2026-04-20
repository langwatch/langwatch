Feature: Workflow agent input/output mapping layer
  As a scenario author
  I want workflow agents to have their inputs and outputs mapped to the scenario contract
  So that scenario runs against workflow agents succeed without manual wiring guesswork

  Background:
    Given a project with a scenario that expects "input" and "messages" fields
    And the scenario expects "response" as the agent output

  # --- Layer 1: Auto-compute on workflow save ---

  @integration
  Scenario: Auto-computes mappings when workflow with conventional inputs is saved
    Given a workflow agent linked to the scenario
    And the agent has no scenarioMappings configured
    And the workflow has inputs named "query" and "history"
    And the workflow has an output named "response"
    When the workflow version is saved
    Then the agent's scenarioMappings map "query" to the scenario "input" field
    And the agent's scenarioMappings map "history" to the scenario "messages" field
    And the agent's scenarioMappings map the workflow output "response" to the scenario output

  @unit
  Scenario: Skips auto-compute when workflow still has blank-template placeholder fields
    Given a workflow agent linked to the scenario
    And the agent has no scenarioMappings configured
    And the workflow has the default blank-template inputs "question" and output "output"
    When the workflow version is saved
    Then the agent's scenarioMappings remain empty

  @unit
  Scenario: Re-computes mappings when existing mappings reference stale fields
    Given a workflow agent linked to the scenario
    And the agent has scenarioMappings referencing a field "old_query" that no longer exists
    And the workflow now has an input named "prompt"
    When the workflow version is saved
    Then the agent's scenarioMappings are re-computed against the current workflow I/O
    And the stale "old_query" mapping is replaced

  @unit
  Scenario: Auto-compute does not block the workflow save on failure
    Given a workflow agent linked to the scenario
    And the agent has no scenarioMappings configured
    And the auto-compute logic encounters an error
    When the workflow version is saved
    Then the workflow save succeeds
    And the error is logged
    And the agent's scenarioMappings remain empty

  # --- Layer 2: Client-side mapping check at Save & Run ---

  @integration
  Scenario: Opens mapping drawer when running a scenario with an unmapped workflow agent
    Given a workflow agent selected as the scenario target
    And the agent has empty scenarioMappings
    When the user clicks Save & Run
    Then the AgentWorkflowEditorDrawer opens instead of starting the run
    And the user can configure the mappings before running

  @integration
  Scenario: Opens mapping drawer when workflow agent has incomplete mappings
    Given a workflow agent selected as the scenario target
    And the agent has scenarioMappings that do not cover all required fields
    When the user clicks Save & Run
    Then the AgentWorkflowEditorDrawer opens instead of starting the run

  @e2e
  Scenario: Scenario runs successfully after user configures mappings via drawer
    Given a workflow agent selected as the scenario target
    And the agent has empty scenarioMappings
    When the user clicks Save & Run
    And the mapping drawer opens
    And the user configures valid mappings and saves
    And the user clicks Save & Run again
    Then the scenario run executes successfully

  # --- Layer 3: Pre-run validation ---

  @integration
  Scenario: Returns actionable error for multi-input workflow agent without mappings
    Given a workflow agent as the scenario target
    And the workflow has multiple declared inputs
    And the agent has no scenarioMappings configured
    When the scenario run is triggered via any entry point
    Then the run returns a structured validation error
    And the error message directs the user to configure mappings

  @unit
  Scenario: Allows single-input workflow agent to run without explicit mappings
    Given a workflow agent as the scenario target
    And the workflow has exactly one declared input
    And the agent has no scenarioMappings configured
    When the scenario run is triggered
    Then the run proceeds using the legacy single-input fallback
    And no validation error is raised

  # --- Layer 4: Existing flows unchanged ---

  @integration
  Scenario: Create flow navigates directly to workflow studio without mapping panel
    Given the user is creating a new workflow agent from the scenario form
    When the user submits the WorkflowSelectorDrawer
    Then a blank workflow and linked agent are created
    And the user is navigated to the workflow studio
    And no mapping drawer or panel is shown during creation

  @integration
  Scenario: Edit flow continues to show mapping panel as before
    Given an existing workflow agent with a saved workflow
    When the user opens the agent for editing via AgentWorkflowEditorDrawer
    Then the ScenarioInputMappingSection is displayed
    And the user can view and modify the scenarioMappings

# --- AC Coverage Map ---
# AC 1: "Auto-compute mappings on workflow save" → Scenario: Auto-computes mappings when workflow with conventional inputs is saved
# AC 1: "Auto-compute mappings on workflow save" → Scenario: Skips auto-compute when workflow still has blank-template placeholder fields
# AC 1: "Auto-compute mappings on workflow save" → Scenario: Re-computes mappings when existing mappings reference stale fields
# AC 1: "Auto-compute mappings on workflow save" → Scenario: Auto-compute does not block the workflow save on failure
# AC 2: "Auto-open mapping drawer on target selection" → Scenario: Opens mapping drawer when running a scenario with an unmapped workflow agent
# AC 2: "Auto-open mapping drawer on target selection" → Scenario: Opens mapping drawer when workflow agent has incomplete mappings
# AC 2: "Auto-open mapping drawer on target selection" → Scenario: Scenario runs successfully after user configures mappings via drawer
# AC 3: "Pre-run validation for incomplete mappings" → Scenario: Returns actionable error for multi-input workflow agent without mappings
# AC 3: "Pre-run validation for incomplete mappings" → Scenario: Allows single-input workflow agent to run without explicit mappings
# AC 4: "No change to the current create flow" → Scenario: Create flow navigates directly to workflow studio without mapping panel
# AC 5: "Existing edit path unchanged" → Scenario: Edit flow continues to show mapping panel as before
