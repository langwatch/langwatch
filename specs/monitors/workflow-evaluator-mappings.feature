@integration
Feature: Workflow evaluator mappings in Online Evaluation
  As a user creating an online evaluation
  I want to configure input mappings for workflow evaluators
  So that the workflow receives the correct trace data

  Background:
    Given I am logged in to a project
    And I have a workflow "Custom Scorer" with entry node outputs:
      | name   | type |
      | input  | str  |
      | output | str  |
      | score  | float|
    And I have a workflow evaluator "My Scorer" linked to workflow "Custom Scorer"

  # ============================================================================
  # Workflow evaluator field detection
  # ============================================================================

  Scenario: Workflow evaluator shows mapping fields from workflow entry node
    Given the online evaluation drawer is open at trace level
    When I select evaluator "My Scorer"
    Then the evaluator editor drawer should open
    And I should see mapping fields: "input", "output", "score"
    And "input" and "output" should be auto-mapped to trace fields
    And "score" should be highlighted as needing mapping

  Scenario: Workflow evaluator without entry outputs shows no mappings needed
    Given I have a workflow with no entry node outputs
    And I have a workflow evaluator "Empty Scorer" linked to it
    When I select evaluator "Empty Scorer" in the online evaluation drawer
    Then I should see "This evaluator does not require any input mappings"
    And I should be able to save immediately

  Scenario: Workflow with only optional-like fields allows saving
    Given I have a workflow with entry outputs: "input", "output"
    And I have a workflow evaluator linked to it
    When I select this evaluator at trace level
    Then both fields should be auto-mapped
    And no pending mapping warning should appear
    And the Save button should be enabled

  # ============================================================================
  # Mapping persistence
  # ============================================================================

  Scenario: Workflow evaluator mappings persist after configuration
    Given the online evaluation drawer is open at trace level
    And I selected workflow evaluator "My Scorer"
    And I configured mappings:
      | field  | source               |
      | input  | trace.input          |
      | output | trace.output         |
      | score  | trace.metadata.score |
    When I save the online evaluation
    Then the monitor should be created with the configured mappings
    And the mappings should include all three fields

  Scenario: Editing existing monitor preserves workflow mappings
    Given I have an existing monitor with workflow evaluator "My Scorer"
    And the monitor has mappings for "input", "output", "score"
    When I open the monitor for editing
    Then I should see the existing mappings preserved
    And I should be able to modify them

  # ============================================================================
  # Switching between evaluators
  # ============================================================================

  Scenario: Switching from built-in to workflow evaluator refreshes mappings
    Given the online evaluation drawer is open at trace level
    And I selected built-in evaluator "Exact Match" with auto-mapped fields
    When I change to workflow evaluator "My Scorer"
    Then the mapping fields should change to match the workflow entry outputs
    And auto-mapping should run for common fields
    And new fields like "score" should need mapping

  Scenario: Switching from workflow to built-in evaluator uses builtin fields
    Given the online evaluation drawer is open at trace level
    And I selected workflow evaluator "My Scorer"
    When I change to built-in evaluator "Exact Match"
    Then the mapping fields should change to "input", "output", "expected_output"
    And workflow-specific fields should be removed

  # ============================================================================
  # Thread level mappings
  # ============================================================================

  Scenario: Workflow evaluator at thread level uses thread sources
    Given the online evaluation drawer is open at thread level
    When I select workflow evaluator "My Scorer"
    Then the mapping sources should show thread options
    And "traces" array should be available as a source
    And auto-mapping should use thread-appropriate defaults

  Scenario: Switching levels clears and re-infers mappings
    Given I have workflow evaluator "My Scorer" selected at trace level
    And mappings are configured for trace sources
    When I switch to thread level
    Then mappings should be reset
    And auto-inference should run with thread sources
