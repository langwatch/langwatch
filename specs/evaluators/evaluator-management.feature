@unit
Feature: Evaluator management
  As a user of LangWatch
  I want to create, edit, and manage reusable evaluators
  So that I can use them across evaluations and other platform features

  # ============================================================================
  # Evaluator types
  # ============================================================================

  Scenario: Evaluator types available
    When I create a new evaluator
    Then I can choose from the following types:
      | type      | description                              |
      | evaluator | Built-in evaluator with custom settings  |
      | workflow  | Custom evaluator from a workflow         |

  # ============================================================================
  # Evaluator categories (for built-in evaluators)
  # ============================================================================

  Scenario: Evaluator categories displayed
    When I start creating a built-in evaluator
    Then I see the following categories:
      | category         | description                              |
      | Expected Answer  | Compare output against expected values   |
      | LLM as Judge     | Use LLM to evaluate quality              |
      | RAG Quality      | Evaluate retrieval and generation        |
      | Safety           | Check for harmful content                |

  Scenario: Each category contains specific evaluators
    When I select category "Expected Answer"
    Then I see evaluators like:
      | evaluator           |
      | Exact Match         |
      | Contains            |
      | Levenshtein Distance|
      | Semantic Similarity |

  # ============================================================================
  # Evaluator CRUD - Create
  # ============================================================================

  Scenario: Create built-in evaluator with settings
    Given I am on the evaluators page
    When I click "New Evaluator"
    And I select category "LLM as Judge"
    And I select evaluator type "Answer Correctness"
    Then the EvaluatorEditorDrawer opens
    When I enter name "Correctness Check"
    And I configure the judge model as "openai/gpt-4o"
    And I set the evaluation criteria
    And I click "Save"
    Then the evaluator "Correctness Check" is saved to the database
    And the evaluator appears in the evaluators list

  Scenario: Create workflow-based custom evaluator
    Given I am on the evaluators page
    And workflow "Custom Scorer" exists with evaluator output
    When I click "New Evaluator"
    And I select "Custom (from Workflow)"
    Then the WorkflowSelectorDrawer opens for evaluators
    When I select workflow "Custom Scorer"
    And I enter name "Custom Score Evaluator"
    And I click "Save"
    Then the evaluator is saved with workflowId reference
    And the evaluator appears in the evaluators list

  Scenario: Evaluator settings vary by type
    When I select evaluator type "Exact Match"
    Then I see settings for case sensitivity and trimming
    When I select evaluator type "LLM as Judge"
    Then I see settings for model, prompt template, and criteria

  # ============================================================================
  # Evaluator CRUD - Read/List
  # ============================================================================

  Scenario: View evaluators list
    Given evaluators "Exact Match", "LLM Judge", and "Custom Scorer" exist
    When I navigate to the evaluators page
    Then I see a list of evaluators
    And each evaluator shows its name, type, and last updated date

  Scenario: Empty state when no evaluators
    Given no evaluators exist in the project
    When I navigate to the evaluators page
    Then I see an empty state message
    And I see a "Create your first evaluator" call to action

  Scenario: Evaluators are project-scoped
    Given I am in project "Project A"
    And evaluator "My Evaluator" exists in "Project A"
    And evaluator "Other Evaluator" exists in "Project B"
    When I navigate to the evaluators page
    Then I only see "My Evaluator"
    And I do not see "Other Evaluator"

  # ============================================================================
  # Evaluator CRUD - Update
  # ============================================================================

  Scenario: Edit evaluator settings
    Given evaluator "Exact Match" exists with case_sensitive=true
    When I click on evaluator "Exact Match"
    Then the EvaluatorEditorDrawer opens with existing settings
    When I change case_sensitive to false
    And I click "Save"
    Then the evaluator is updated in the database
    And the updatedAt timestamp is refreshed

  Scenario: Edit evaluator name
    Given evaluator "Old Name" exists
    When I click on evaluator "Old Name"
    And I change the name to "New Name"
    And I click "Save"
    Then the evaluator name is updated

  # ============================================================================
  # Evaluator CRUD - Delete (soft delete)
  # ============================================================================

  Scenario: Archive evaluator
    Given evaluator "Old Evaluator" exists
    When I click the delete button for "Old Evaluator"
    And I confirm the deletion
    Then the evaluator is soft-deleted (archivedAt is set)
    And "Old Evaluator" no longer appears in the evaluators list

  Scenario: Archived evaluators are excluded from list
    Given evaluator "Active Evaluator" exists
    And evaluator "Archived Evaluator" was archived
    When I navigate to the evaluators page
    Then I see "Active Evaluator"
    And I do not see "Archived Evaluator"

  # ============================================================================
  # Evaluator config storage
  # ============================================================================

  Scenario: Built-in evaluator config stored as JSON
    Given I create an "Exact Match" evaluator with:
      | name            | My Exact Match |
      | case_sensitive  | false          |
      | trim_whitespace | true           |
    Then the evaluator record has type "evaluator"
    And the config JSON contains the evaluator type and settings

  Scenario: Workflow evaluator has workflowId at top level
    Given I create a workflow-based evaluator referencing workflow "Scorer"
    Then the evaluator record has type "workflow"
    And the workflowId field is set at the top level (not nested in config)
    And this allows efficient database joins on workflowId

  # ============================================================================
  # Evaluator selection drawer (for use in Evaluations V3)
  # ============================================================================

  Scenario: EvaluatorListDrawer shows available evaluators
    Given evaluators "Exact Match", "LLM Judge", and "Custom Scorer" exist
    When the EvaluatorListDrawer opens
    Then I see all three evaluators listed
    And I see a "New Evaluator" button at the top

  Scenario: EvaluatorListDrawer empty state
    Given no evaluators exist
    When the EvaluatorListDrawer opens
    Then I see "Create your first evaluator" message
    And I see a "New Evaluator" button

  Scenario: Select evaluator from drawer
    Given the EvaluatorListDrawer is open
    And evaluator "Exact Match" exists
    When I click on "Exact Match"
    Then the drawer closes
    And "Exact Match" is selected for use with the agent

  # ============================================================================
  # Evaluator creation flow from drawer
  # ============================================================================

  Scenario: Create new evaluator from drawer flow
    Given the EvaluatorListDrawer is open
    When I click "New Evaluator"
    Then the EvaluatorCategorySelectorDrawer opens

  Scenario: EvaluatorCategorySelectorDrawer shows categories
    When the EvaluatorCategorySelectorDrawer opens
    Then I see all evaluator categories listed
    And each category shows its name and description
    And I see a "Custom (from Workflow)" option at the bottom

  Scenario: Select category opens type selector
    Given the EvaluatorCategorySelectorDrawer is open
    When I select category "Expected Answer"
    Then the EvaluatorTypeSelectorDrawer opens
    And it shows evaluators in the "Expected Answer" category

  Scenario: EvaluatorTypeSelectorDrawer shows evaluators in category
    Given the EvaluatorTypeSelectorDrawer is open for "Expected Answer"
    Then I see evaluators like "Exact Match", "Contains", "Semantic Similarity"
    And each evaluator shows its name and brief description

  Scenario: Select evaluator type opens editor
    Given the EvaluatorTypeSelectorDrawer is open for "Expected Answer"
    When I select "Exact Match"
    Then the EvaluatorEditorDrawer opens
    And I see the settings form for "Exact Match"

  Scenario: EvaluatorEditorDrawer renders dynamic form
    Given I am creating an "LLM as Judge" evaluator
    When the EvaluatorEditorDrawer opens
    Then I see a form generated from the evaluator's Zod schema
    And required fields are marked
    And I can enter values for all settings

  Scenario: Custom workflow evaluator skips category/type selection
    Given the EvaluatorCategorySelectorDrawer is open
    When I select "Custom (from Workflow)"
    Then the WorkflowSelectorDrawer opens
    And I can select a workflow to use as evaluator

  # ============================================================================
  # Evaluator mappings (stored in evaluation state, not evaluator DB)
  # ============================================================================

  Scenario: Evaluator input mappings are per-evaluation
    Given evaluator "Exact Match" exists in the database
    And I use "Exact Match" in evaluation A with agent "GPT-4"
    And I use "Exact Match" in evaluation B with agent "Claude"
    Then evaluation A has its own input mappings for "Exact Match"
    And evaluation B has its own input mappings for "Exact Match"
    And these mappings are NOT stored in the evaluator database record

  Scenario: Mappings stored in evaluation state only
    Given I add evaluator "Exact Match" to agent "GPT-4" in an evaluation
    When I configure the input mapping: output -> agent.response
    Then this mapping is stored in the evaluation's wizard state
    And the evaluator database record remains unchanged
