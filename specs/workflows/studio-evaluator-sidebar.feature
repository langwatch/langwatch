Feature: Studio Evaluator Sidebar Migration
  As a user building workflows in the optimization studio
  I want a simplified evaluator sidebar that uses the evaluator creation drawer
  So that I follow the same "create and name evaluators" pattern used everywhere else

  Background:
    Given I am on the optimization studio workflow editor
    And the left sidebar (Node Selection Panel) is visible

  # --- Sidebar Changes ---

  @integration
  Scenario: Single evaluator draggable replaces individual evaluator types
    Then the sidebar evaluator section shows a single "Evaluator" draggable item
    And the sidebar does not list individual evaluator types like "exact_match" or "faithfulness"

  @integration
  Scenario: Prompting Techniques section is removed
    Then the sidebar does not contain a "Prompting Techniques" section
    And there is no "ChainOfThought" draggable item

  # --- Evaluator Creation via Drawer ---

  @integration
  Scenario: Dragging evaluator to canvas opens the evaluator editor drawer
    When I drag the "Evaluator" item from the sidebar onto the canvas
    Then an evaluator node placeholder is created on the canvas
    And the EvaluatorEditorDrawer opens automatically

  @integration
  Scenario: Saving evaluator from drawer creates a project-level evaluator and configures the node
    Given I have dragged the "Evaluator" item onto the canvas
    And the EvaluatorEditorDrawer is open
    When I select an evaluator type and enter a name
    And I save the evaluator
    Then a project-level evaluator is created in the database
    And the evaluator node on the canvas references the created evaluator
    And the node displays the evaluator name
    And the drawer closes

  @integration
  Scenario: Cancelling evaluator drawer removes the placeholder node
    Given I have dragged the "Evaluator" item onto the canvas
    And the EvaluatorEditorDrawer is open
    When I close the drawer without saving
    Then the placeholder evaluator node is removed from the canvas

  # --- Backward Compatibility ---

  @unit
  Scenario: Existing workflows with inline evaluator config still render correctly
    Given a workflow was saved with evaluator nodes using the old inline config pattern
    When the workflow loads
    Then the evaluator nodes render correctly with their type and settings
    And the evaluator properties panel works as before

  # --- Cleanup ---

  @unit
  Scenario: Registry no longer exports prompting techniques for sidebar
    Then the node registry does not include prompting technique entries for the sidebar
    And the ALLOWED_EVALUATORS list is no longer used to populate the sidebar
