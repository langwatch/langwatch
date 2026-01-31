@integration
Feature: Correct checkType for workflow evaluators in monitors
  As a user creating online evaluations
  I want workflow evaluators to save with correct checkType
  So that they execute properly at runtime

  Background:
    Given I am logged in to a project
    And I have a workflow evaluator "Custom Scorer"
    And I have a built-in evaluator "Exact Match" (langevals/exact_match)

  # ============================================================================
  # Workflow evaluator checkType
  # ============================================================================

  Scenario: Workflow evaluator saves with "workflow" checkType
    Given the online evaluation drawer is open
    When I select workflow evaluator "Custom Scorer"
    And I configure the required mappings
    And I enter a name for the monitor
    And I click Save
    Then the monitor should be created successfully
    And the monitor checkType should be "workflow"
    And the monitor evaluatorId should reference "Custom Scorer"

  Scenario: Workflow evaluator does NOT save as "langevals/basic"
    Given the online evaluation drawer is open
    When I select workflow evaluator "Custom Scorer"
    And I save the monitor
    Then the monitor checkType should NOT be "langevals/basic"
    And the monitor checkType should be "workflow"

  # ============================================================================
  # Built-in evaluator checkType (unchanged behavior)
  # ============================================================================

  Scenario: Built-in evaluator saves with correct evaluator type
    Given the online evaluation drawer is open
    When I select built-in evaluator "Exact Match"
    And I configure mappings and name
    And I click Save
    Then the monitor checkType should be "langevals/exact_match"
    And the monitor evaluatorId should reference "Exact Match"

  Scenario: Different built-in evaluators save correct types
    Given I create monitors with different evaluators:
      | evaluator          | expected_checkType        |
      | LLM Boolean        | langevals/llm_boolean     |
      | Semantic Similarity| langevals/semantic_similarity |
      | Azure Content Safety| azure/content_safety     |
    Then each monitor should have the correct checkType

  # ============================================================================
  # Editing existing monitors
  # ============================================================================

  Scenario: Editing workflow monitor preserves checkType
    Given I have an existing monitor with workflow evaluator
    And the monitor has checkType "workflow"
    When I edit the monitor and change the name
    And I click Save
    Then the checkType should still be "workflow"
    And no data should be lost

  Scenario: Editing built-in monitor preserves checkType
    Given I have an existing monitor with built-in evaluator
    And the monitor has checkType "langevals/exact_match"
    When I edit the monitor and change the sampling
    And I click Save
    Then the checkType should still be "langevals/exact_match"

  # ============================================================================
  # Monitor execution (backend consideration)
  # ============================================================================

  Scenario: Monitor with workflow checkType uses evaluatorId for execution
    Given I have a monitor with:
      | checkType   | workflow    |
      | evaluatorId | eval_123    |
    When the monitor is triggered by a trace
    Then the system should look up evaluator "eval_123"
    And execute the linked workflow

  Scenario: Monitor with built-in checkType uses checkType for execution
    Given I have a monitor with:
      | checkType   | langevals/exact_match |
      | evaluatorId | eval_456              |
    When the monitor is triggered by a trace
    Then the system should execute "langevals/exact_match" evaluator
    And use settings from evaluator "eval_456"

  # ============================================================================
  # Database integrity
  # ============================================================================

  Scenario: Workflow evaluator config remains empty
    Given I create a monitor with workflow evaluator
    Then the evaluator config should be {}
    And the workflowId should be set on the evaluator
    And the monitor checkType should be "workflow"

  Scenario: Built-in evaluator config contains evaluatorType
    Given I create a monitor with built-in evaluator "Exact Match"
    Then the evaluator config should contain evaluatorType "langevals/exact_match"
    And the evaluator config should contain settings
    And the monitor checkType should match config.evaluatorType
