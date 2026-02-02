@integration
Feature: Create workflow evaluator via new workflow
  As a user creating a custom evaluator
  I want to create a new workflow with the evaluator template
  So that I can build my evaluation logic from scratch

  Background:
    Given I am logged in to a project

  # ============================================================================
  # Category selector UI changes
  # ============================================================================

  Scenario: Category selector shows renamed option
    When I open the evaluator category selector
    Then I should see "Create Custom Evaluator" option
    And I should NOT see "Custom (from Workflow)"
    And the description should say "Create a new workflow as custom evaluator"

  Scenario: Custom evaluator option has workflow icon
    When I open the evaluator category selector
    Then the "Create Custom Evaluator" option should have a workflow icon
    And it should be visually separated from built-in categories

  # ============================================================================
  # New workflow creation flow
  # ============================================================================

  Scenario: Custom evaluator option opens workflow creator
    Given I am on the evaluators page
    When I click "New Evaluator"
    And I click "Create Custom Evaluator"
    Then the New Workflow modal should open
    And the "Custom Evaluator" template should be pre-selected
    And I should be on step 2 (name and description)
    And I should NOT see the template selection grid

  Scenario: New workflow modal shows correct pre-filled values
    Given I clicked "Create Custom Evaluator"
    Then the modal title should say "Create new workflow"
    And the workflow name field should be empty or have placeholder
    And the workflow icon should be the evaluator template icon
    And the description field should be empty

  # ============================================================================
  # Workflow and evaluator creation
  # ============================================================================

  Scenario: After creating workflow, evaluator is auto-created
    Given I clicked "Create Custom Evaluator"
    And the New Workflow modal is open
    When I enter name "Bias Detector"
    And I enter description "Detects cognitive biases"
    And I click "Create"
    Then a workflow "Bias Detector" should be created
    And an evaluator "Bias Detector" should be auto-created
    And the evaluator should have type "workflow"
    And the evaluator should reference the new workflow
    And I should be redirected to the workflow studio

  Scenario: Evaluator inherits workflow name automatically
    Given I clicked "Create Custom Evaluator"
    When I create a workflow named "Quality Checker"
    Then the auto-created evaluator should also be named "Quality Checker"

  Scenario: Workflow is created with evaluator template structure
    Given I clicked "Create Custom Evaluator"
    When I create workflow "My Evaluator"
    Then the workflow should have the Custom Evaluator template structure
    And the workflow should have workflow_type "evaluator"
    And the entry node should have example outputs
    And the end node should behave as evaluator

  # ============================================================================
  # Cancellation and error handling
  # ============================================================================

  Scenario: Canceling workflow creation does not create evaluator
    Given I clicked "Create Custom Evaluator"
    And the New Workflow modal is open
    When I click "Cancel" or close the modal
    Then no workflow should be created
    And no evaluator should be created
    And I should return to the evaluator category selector

  Scenario: Closing modal via X button cancels creation
    Given I clicked "Create Custom Evaluator"
    And the New Workflow modal is open
    When I click the X button to close the modal
    Then no workflow should be created
    And no evaluator should be created

  Scenario: Workflow creation failure does not create orphan evaluator
    Given I clicked "Create Custom Evaluator"
    And the workflow creation will fail (e.g., network error)
    When I try to create the workflow
    Then an error message should appear
    And no evaluator should be created
    And I should remain on the modal to retry

  # ============================================================================
  # Back navigation
  # ============================================================================

  Scenario: Back button from modal returns to category selector
    Given I clicked "Create Custom Evaluator"
    And the New Workflow modal is open
    When I click the back button
    Then I should return to template selection (step 1)
    And I can select a different template or go back further

  # ============================================================================
  # Evaluator page flow
  # ============================================================================

  Scenario: New evaluator appears in list after creation
    Given I created workflow evaluator "New Scorer" via the create flow
    When I navigate to the evaluators page
    Then I should see "New Scorer" in the evaluators list
    And it should show type "Workflow"
    And clicking it should open the evaluator editor with workflow link
