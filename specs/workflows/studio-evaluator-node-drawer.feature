Feature: Studio Evaluator Node Drawer
  As a user working with evaluator nodes in the optimization studio
  I want evaluator nodes to use the evaluator editor drawer with local state
  So that I can edit evaluator settings without immediately affecting the global evaluator record

  # Context:
  # After PR #1589, dragging an evaluator opens the evaluator list drawer to select/create.
  # The node then references evaluators/<id>.
  # Currently, the EvaluatorPropertiesPanel autosaves to DB — this is dangerous.
  #
  # New behavior:
  # - Clicking an evaluator node opens the evaluator editor drawer (not a properties panel)
  # - The drawer shows: name, description, settings (DynamicZodForm), and mappings
  # - Changes are stored as localConfig on the node, not saved to DB immediately
  # - Apply button closes drawer, Save button persists to DB, Discard reverts
  # - The drawer has play and expand buttons at the top for execution

  Background:
    Given I am on the optimization studio workflow editor
    And there is an evaluator node on the canvas referencing a saved DB evaluator

  # --- Opening the Drawer ---

  @integration
  Scenario: Clicking evaluator node opens evaluator editor drawer
    When I click on the evaluator node
    Then the evaluator editor drawer opens
    And the drawer shows the evaluator name
    And the drawer shows the evaluator settings form
    And the drawer does not show a right-sidebar properties panel

  @integration
  Scenario: Drawer shows correct evaluator type description
    Given the evaluator is of type "langevals/llm_boolean"
    When I open the evaluator drawer
    Then the drawer shows the evaluator type description
    And the settings form matches the evaluator type's schema

  # --- Settings Editing ---

  @integration
  Scenario: Changing evaluator settings stores local state
    When I open the evaluator drawer
    And I change a setting (e.g., "max_tokens" for an LLM-based evaluator)
    Then the change is stored as localConfig on the workflow node
    And the DB evaluator record is not modified

  @integration
  Scenario: Changing evaluator name stores local state
    When I open the evaluator drawer
    And I change the evaluator name to "My Custom Evaluator"
    Then the name change is in local state
    And the canvas node still shows the original name until applied

  # --- Mappings in Studio Context ---

  @integration
  Scenario: Evaluator drawer shows variable mappings section
    When I open the evaluator drawer
    Then the drawer shows a "Variable Mappings" section
    And the available sources include outputs from other nodes in the workflow

  @integration
  Scenario: Available mapping sources include workflow node outputs
    Given the workflow has an LLM node "Chatbot" with outputs "output" and "reasoning"
    And the workflow has an entry node with input "user_query"
    When I open the evaluator drawer
    Then the mapping sources include "Chatbot > output" and "Chatbot > reasoning"
    And the mapping sources include "Entry > user_query"

  @integration
  Scenario: Changing a mapping is stored on the workflow node
    When I open the evaluator drawer
    And I map the "input" field to "Chatbot > output"
    Then the mapping is stored on the workflow evaluator node
    And the mapping persists when I close and reopen the drawer

  # --- Workflow Evaluator Type ---

  @integration
  Scenario: Workflow-type evaluators show a link to the workflow
    Given the evaluator is of type "workflow"
    When I open the evaluator drawer
    Then the drawer shows a card linking to the workflow
    And clicking the link opens the workflow in a new tab

  # --- Backward Compatibility ---

  @unit
  Scenario: Old inline evaluator config uses legacy editing path
    Given a workflow has an evaluator node with old inline config (no evaluators/ prefix)
    When I click on the evaluator node
    Then the drawer shows the inline settings form (DynamicZodForm)
    And changes are saved directly to the workflow node parameters
    And no DB evaluator record is involved
