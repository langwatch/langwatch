Feature: License Enforcement for Resource Creation

  Background:
    Given an organization with a valid license

  # ============================================================================
  # Workflow Agents: Compound Resource Creation (Workflow + Agent)
  # ============================================================================

  @unit
  Scenario: Creating workflow agent checks workflows limit first
    Given the organization has a license with maxWorkflows 3 and maxAgents 5
    And the organization has 3 workflows (at limit)
    And the organization has 2 agents (under limit)
    When I click "Create & Open Editor" in the WorkflowSelectorDrawer
    Then an upgrade modal is displayed
    And the modal shows "Workflows: 3 / 3"
    And no error toast is shown

  @unit
  Scenario: Creating workflow agent checks agents limit second
    Given the organization has a license with maxWorkflows 5 and maxAgents 3
    And the organization has 2 workflows (under limit)
    And the organization has 3 agents (at limit)
    When I click "Create & Open Editor" in the WorkflowSelectorDrawer
    Then an upgrade modal is displayed
    And the modal shows "Agents: 3 / 3"
    And no error toast is shown

  @unit
  Scenario: Creating workflow agent succeeds when both limits allow
    Given the organization has a license with maxWorkflows 5 and maxAgents 5
    And the organization has 2 workflows (under limit)
    And the organization has 2 agents (under limit)
    When I click "Create & Open Editor" in the WorkflowSelectorDrawer
    Then the workflow and agent are created successfully
    And no upgrade modal is shown

  # ============================================================================
  # Workflow Evaluators: Compound Resource Creation (Workflow + Evaluator)
  # ============================================================================

  @unit
  Scenario: Creating workflow evaluator checks workflows limit first
    Given the organization has a license with maxWorkflows 3 and maxEvaluators 5
    And the organization has 3 workflows (at limit)
    And the organization has 2 evaluators (under limit)
    When I click "Create & Open Editor" in the WorkflowSelectorForEvaluatorDrawer
    Then an upgrade modal is displayed
    And the modal shows "Workflows: 3 / 3"
    And no error toast is shown

  @unit
  Scenario: Creating workflow evaluator checks evaluators limit second
    Given the organization has a license with maxWorkflows 5 and maxEvaluators 3
    And the organization has 2 workflows (under limit)
    And the organization has 3 evaluators (at limit)
    When I click "Create & Open Editor" in the WorkflowSelectorForEvaluatorDrawer
    Then an upgrade modal is displayed
    And the modal shows "Evaluators: 3 / 3"
    And no error toast is shown

  @unit
  Scenario: Creating workflow evaluator succeeds when both limits allow
    Given the organization has a license with maxWorkflows 5 and maxEvaluators 5
    And the organization has 2 workflows (under limit)
    And the organization has 2 evaluators (under limit)
    When I click "Create & Open Editor" in the WorkflowSelectorForEvaluatorDrawer
    Then the workflow and evaluator are created successfully
    And no upgrade modal is shown

  # ============================================================================
  # Error Toast Suppression (Global License Handler)
  # ============================================================================

  @unit
  Scenario: Workflow creation error toast suppressed when license modal shown
    Given the organization reached the workflow limit after the form was opened
    When I submit the new workflow form
    And the server returns FORBIDDEN with limitType "workflows"
    Then an upgrade modal is displayed
    And no "Error creating workflow" toast is shown

  @unit
  Scenario: Workflow agent creation error toast suppressed when license modal shown
    Given the organization reached the workflow limit after the form was opened
    When I submit the workflow agent creation form
    And the server returns FORBIDDEN with limitType "workflows"
    Then an upgrade modal is displayed
    And no "Failed to create workflow agent" toast is shown

  @unit
  Scenario: Workflow evaluator creation error toast suppressed when license modal shown
    Given the organization reached the workflow limit after the form was opened
    When I submit the workflow evaluator creation form
    And the server returns FORBIDDEN with limitType "workflows"
    Then an upgrade modal is displayed
    And no "Failed to create workflow evaluator" toast is shown

  @unit
  Scenario: Non-license errors still show toast
    Given the server returns an error that is not a license limit error
    When I submit the new workflow form
    Then an appropriate error toast is shown
    And no upgrade modal is displayed
