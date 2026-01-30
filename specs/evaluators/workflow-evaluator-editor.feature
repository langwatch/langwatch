@integration
Feature: Workflow evaluator editor with workflow link
  As a user managing workflow evaluators
  I want to access the underlying workflow from the evaluator editor
  So that I can modify the evaluation logic

  Background:
    Given I am logged in to a project
    And I have a workflow "Custom Scorer" in the project
    And I have a workflow evaluator "My Scorer" linked to "Custom Scorer"

  # ============================================================================
  # Edit Workflow button visibility
  # ============================================================================

  Scenario: Configure button for workflow evaluator shows workflow link
    Given I am on the evaluators page
    When I click "Configure" on evaluator "My Scorer"
    Then the evaluator editor drawer should open
    And I should see an "Edit Workflow" button
    And the button should be prominently displayed

  Scenario: Built-in evaluator does not show workflow link
    Given I have a built-in evaluator "Exact Match"
    When I click "Configure" on evaluator "Exact Match"
    Then the evaluator editor drawer should open
    And I should NOT see an "Edit Workflow" button
    And I should see the settings form instead

  Scenario: Workflow evaluator shows workflow name and icon
    Given workflow "Custom Scorer" has icon "checkmark"
    When I open the evaluator editor for "My Scorer"
    Then I should see the workflow name "Custom Scorer"
    And I should see the workflow icon

  # ============================================================================
  # Navigation to workflow
  # ============================================================================

  Scenario: Click Edit Workflow navigates to studio
    Given the evaluator editor drawer is open for "My Scorer"
    When I click "Edit Workflow"
    Then I should be navigated to the workflow studio
    And the URL should be /[project]/studio/[workflow-id]

  Scenario: Edit Workflow opens in same tab by default
    Given the evaluator editor drawer is open for "My Scorer"
    When I click "Edit Workflow"
    Then the navigation should happen in the same tab
    And the drawer should close

  Scenario: Workflow link includes correct workflow ID
    Given workflow "Custom Scorer" has ID "wf_123abc"
    When I open the evaluator editor for "My Scorer"
    Then the "Edit Workflow" link should point to studio/wf_123abc

  # ============================================================================
  # Workflow evaluator editor content
  # ============================================================================

  Scenario: Workflow evaluator shows name field only
    Given I open the evaluator editor for "My Scorer"
    Then I should see the name field
    And I should see the "Edit Workflow" button
    And I should NOT see a settings form (no schema for workflows)

  Scenario: Can rename workflow evaluator
    Given I open the evaluator editor for "My Scorer"
    When I change the name to "Renamed Scorer"
    And I click Save
    Then the evaluator should be renamed
    And the linked workflow should remain unchanged

  # ============================================================================
  # Edge cases
  # ============================================================================

  Scenario: Workflow evaluator with deleted workflow shows warning
    Given workflow "Deleted Workflow" has been deleted
    And evaluator "Orphan Scorer" still references it
    When I open the evaluator editor for "Orphan Scorer"
    Then I should see a warning that the workflow was deleted
    And the "Edit Workflow" button should be disabled or hidden
