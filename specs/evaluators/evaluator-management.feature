@unit
Feature: Evaluator management
  As a user of LangWatch
  I want to create, edit, and manage reusable evaluators
  So that I can use them across evaluations and other platform features

  # Drawer-component scenarios are bound to the existing component tests
  # (EvaluatorListDrawer, EvaluatorCategorySelectorDrawer,
  # EvaluatorTypeSelectorDrawer). The remaining @unimplemented scenarios
  # describe full agents/evaluators-page CRUD flows or backing-store
  # invariants (config JSON shape, project scoping, mappings storage)
  # — they need a Next.js page-level harness or a service-layer test
  # that doesn't exist for the evaluator service yet. Each is a tracked
  # gap, not an aspirational stretch goal.

  # ============================================================================
  # Evaluator types
  # ============================================================================

  Scenario: Evaluator types available
    When I create a new evaluator
    Then I can choose from the following types:
      | type      | description                              |
      | evaluator | Built-in evaluator with custom settings  |
      | code      | Custom Python code evaluator             |
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

  @unimplemented
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

  @unimplemented
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

  @unimplemented
  Scenario: Evaluator settings vary by type
    When I select evaluator type "Exact Match"
    Then I see settings for case sensitivity and trimming
    When I select evaluator type "LLM as Judge"
    Then I see settings for model, prompt template, and criteria

  # ============================================================================
  # Evaluator CRUD - Read/List
  # ============================================================================

  @unimplemented
  Scenario: View evaluators list
    Given evaluators "Exact Match", "LLM Judge", and "Custom Scorer" exist
    When I navigate to the evaluators page
    Then I see a list of evaluators
    And each evaluator shows its name, type, and last updated date

  @unimplemented
  Scenario: Empty state when no evaluators
    Given no evaluators exist in the project
    When I navigate to the evaluators page
    Then I see an empty state message
    And I see a "Create your first evaluator" call to action

  @unimplemented
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

  @unimplemented
  Scenario: Edit evaluator settings
    Given evaluator "Exact Match" exists with case_sensitive=true
    When I click on evaluator "Exact Match"
    Then the EvaluatorEditorDrawer opens with existing settings
    When I change case_sensitive to false
    And I click "Save"
    Then the evaluator is updated in the database
    And the updatedAt timestamp is refreshed

  @unimplemented
  Scenario: Edit evaluator name
    Given evaluator "Old Name" exists
    When I click on evaluator "Old Name"
    And I change the name to "New Name"
    And I click "Save"
    Then the evaluator name is updated

  # ============================================================================
  # Evaluator CRUD - Delete (soft delete)
  # ============================================================================

  @unimplemented
  Scenario: Archive evaluator
    Given evaluator "Old Evaluator" exists
    When I click the delete button for "Old Evaluator"
    And I confirm the deletion
    Then the evaluator is soft-deleted (archivedAt is set)
    And "Old Evaluator" no longer appears in the evaluators list

  @unimplemented
  Scenario: Archived evaluators are excluded from list
    Given evaluator "Active Evaluator" exists
    And evaluator "Archived Evaluator" was archived
    When I navigate to the evaluators page
    Then I see "Active Evaluator"
    And I do not see "Archived Evaluator"

  # ============================================================================
  # Evaluator config storage
  # ============================================================================

  @unimplemented
  Scenario: Built-in evaluator config stored as JSON
    Given I create an "Exact Match" evaluator with:
      | name            | My Exact Match |
      | case_sensitive  | false          |
      | trim_whitespace | true           |
    Then the evaluator record has type "evaluator"
    And the config JSON contains the evaluator type and settings

  @unimplemented
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

  @unimplemented
  Scenario: EvaluatorEditorDrawer renders dynamic form
    Given I am creating an "LLM as Judge" evaluator
    When the EvaluatorEditorDrawer opens
    Then I see a form generated from the evaluator's Zod schema
    And required fields are marked
    And I can enter values for all settings

  @unit
  Scenario: Custom workflow evaluator option is shown
    Given the EvaluatorCategorySelectorDrawer is open
    Then the option "Custom (from Workflow)" is rendered alongside the built-in evaluator categories

  # ============================================================================
  # Code evaluators: custom Python logic without creating a workflow.
  # The category drawer offers "Custom (Code)" before the workflow option;
  # picking it opens an editor with a Python code block plus its inputs and
  # outputs, exactly like the studio code component. The code is stored on the
  # evaluator itself and executes through the engine's code component at run
  # time; no workflow record is ever created.
  # ============================================================================

  Scenario: Custom code evaluator option is shown before the workflow option
    Given the EvaluatorCategorySelectorDrawer is open
    Then the option "Custom (Code)" is rendered before "Custom (from Workflow)"

  # Copy is for customers, especially first-timers; it must not leak internals
  # or compare against the other option. See dev/docs/best_practices/copywriting.md.
  Scenario: Custom code evaluator copy stays customer-facing
    Given the EvaluatorCategorySelectorDrawer is open
    Then the "Custom (Code)" option reads "Write a custom Python evaluator"
    And its description does not reference the workflow option

  Scenario: Create a code evaluator from the drawer
    Given the EvaluatorCategorySelectorDrawer is open
    When I select "Custom (Code)"
    Then a code evaluator editor opens with a Python code editor
    And it seeds a typed evaluation template with default inputs and outputs
    When I name it and save
    Then the evaluator is stored with type "code" and the code in its config
    And no workflow record is created

  # Editing must reopen the code editor (code + inputs + outputs), not the
  # generic mapping-only editor. In the workbench, the inputs and their source
  # mapping are merged into one list, like the prompt drawer.
  Scenario: Editing a code evaluator reopens the code editor
    Given a saved code evaluator
    When I edit it from the evaluators page or the workbench
    Then the code editor opens with its saved code, inputs and outputs
    And in the workbench each input shows its source mapping inline

  # Same behavior as the studio code node: the Python entrypoint is kept in
  # sync with the declared inputs, so changing the inputs keeps the evaluator
  # callable with exactly those inputs, with no missing or unexpected keyword.
  Scenario: Code evaluator input changes keep runs valid
    Given the code evaluator drawer
    When I add or remove an input field
    Then the evaluator still runs without missing or unexpected input errors

  # Outputs are the fixed evaluator contract (passed, score, label, details),
  # not user-defined, mirroring the evaluator end node.
  Scenario: Code evaluator outputs are the fixed evaluator contract
    Given the code evaluator drawer
    Then the outputs are shown as the fixed evaluator result fields
    And there is no control to add or remove output fields

  # A function returns any subset of the contract; whichever it returns become
  # the result, so an evaluator that returns only passed does not fail.
  Scenario: Code evaluator returns only the fields it computes
    Given a code evaluator that returns only passed
    When it runs against a row
    Then the result carries passed and reports no error

  Scenario: Code evaluator inputs drive the mapping UI
    Given a code evaluator whose code takes "output" and "expected_output"
    When I use it in an evaluation
    Then the mapping UI offers exactly those fields to map

  Scenario: Code evaluator executes through the engine code component
    Given a code evaluator that returns passed and score
    When it runs against a row
    Then the result carries the returned passed and score values
    And the run creates no workflow record

  Scenario: Code evaluator code errors surface per row
    Given a code evaluator whose code raises an exception
    When it runs against a row
    Then the row records an error result with the exception message

  @unimplemented
  Scenario: Custom workflow evaluator skips category/type selection
    Given the EvaluatorCategorySelectorDrawer is open
    When I select "Custom (from Workflow)"
    Then the WorkflowSelectorDrawer opens
    And I can select a workflow to use as evaluator

  # ============================================================================
  # Evaluator mappings (stored in evaluation state, not evaluator DB)
  # ============================================================================

  @unimplemented
  Scenario: Evaluator input mappings are per-evaluation
    Given evaluator "Exact Match" exists in the database
    And I use "Exact Match" in evaluation A with agent "GPT-4"
    And I use "Exact Match" in evaluation B with agent "Claude"
    Then evaluation A has its own input mappings for "Exact Match"
    And evaluation B has its own input mappings for "Exact Match"
    And these mappings are NOT stored in the evaluator database record

  @unimplemented
  Scenario: Mappings stored in evaluation state only
    Given I add evaluator "Exact Match" to agent "GPT-4" in an evaluation
    When I configure the input mapping: output -> agent.response
    Then this mapping is stored in the evaluation's workbench state
    And the evaluator database record remains unchanged
