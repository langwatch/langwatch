@wip
Feature: Resource Limit Enforcement (Workflows, Prompts, Evaluators)
  As a LangWatch self-hosted deployment with a license
  I want resource creation limits to be enforced for workflows, prompts, and evaluators
  So that organizations respect their licensed resource counts

  Background:
    Given an organization "org-123" exists
    And I am authenticated as an admin of "org-123"
    And a team "team-456" exists in the organization
    And a project "proj-789" exists in the team
    And LICENSE_ENFORCEMENT_ENABLED is "true"

  # ============================================================================
  # Workflows: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows workflow creation when under limit
    Given the organization has a license with maxWorkflows 5
    And the organization has 3 workflows across all projects
    When I create a workflow in project "proj-789"
    Then the workflow is created successfully

  @integration
  Scenario: Blocks workflow creation when at limit
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows across all projects
    When I create a workflow in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of workflows"

  @integration
  Scenario: Counts workflows across all projects in organization
    Given the organization has a license with maxWorkflows 3
    And project "proj-A" has 2 workflows
    And project "proj-B" has 1 workflow
    When I create a workflow in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Counts only non-archived workflows toward limit
    Given the organization has a license with maxWorkflows 3
    And the organization has 2 active workflows
    And the organization has 2 archived workflows
    When I create a workflow in project "proj-789"
    Then the workflow is created successfully

  @integration
  Scenario: Workflow copy enforces limit
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows across all projects
    When I copy a workflow to project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Workflows: Database Query Compatibility
  # ============================================================================

  @integration
  Scenario: Workflow count query bypasses multi-tenancy protection
    Given the organization has a license with maxWorkflows 5
    And the organization has 2 workflows in project "proj-A"
    And the organization has 1 workflow in project "proj-B"
    When the license enforcement service counts workflows for the organization
    Then the count returns 3
    And no "requires a 'projectId'" error is thrown

  # ============================================================================
  # Prompts: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows prompt creation when under limit
    Given the organization has a license with maxPrompts 5
    And the organization has 3 prompts across all projects
    When I create a prompt in project "proj-789"
    Then the prompt is created successfully

  @integration
  Scenario: Blocks prompt creation when at limit
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts across all projects
    When I create a prompt in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of prompts"

  @integration
  Scenario: Counts prompts across all projects in organization
    Given the organization has a license with maxPrompts 3
    And project "proj-A" has 2 prompts
    And project "proj-B" has 1 prompt
    When I create a prompt in project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Evaluators: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows evaluator creation when under limit
    Given the organization has a license with maxEvaluators 5
    And the organization has 3 evaluators across all projects
    When I create an evaluator in project "proj-789"
    Then the evaluator is created successfully

  @integration
  Scenario: Blocks evaluator creation when at limit
    Given the organization has a license with maxEvaluators 3
    And the organization has 3 evaluators across all projects
    When I create an evaluator in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of evaluators"

  @integration
  Scenario: Counts evaluators across all projects in organization
    Given the organization has a license with maxEvaluators 3
    And project "proj-A" has 2 evaluators
    And project "proj-B" has 1 evaluator
    When I create an evaluator in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Counts only non-archived evaluators toward limit
    Given the organization has a license with maxEvaluators 3
    And the organization has 2 active evaluators
    And the organization has 2 archived evaluators
    When I create an evaluator in project "proj-789"
    Then the evaluator is created successfully

  # ============================================================================
  # UI: Click-then-Modal Pattern (All Resources)
  # ============================================================================

  @unit
  Scenario: Create Workflow button is always clickable
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows (at limit)
    When I view the workflows page
    Then the "Create Workflow" button is enabled
    And the "Create Workflow" button is not visually disabled

  @unit
  Scenario: Clicking Create Workflow at limit shows upgrade modal
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows (at limit)
    When I click the "Create Workflow" button
    Then an upgrade modal is displayed
    And the modal shows "Workflows: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit
  Scenario: Create Prompt button is always clickable
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    When I view the prompts page
    Then the "Create Prompt" button is enabled
    And the "Create Prompt" button is not visually disabled

  @unit
  Scenario: Clicking Create Prompt at limit shows upgrade modal
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    When I click the "Create Prompt" button
    Then an upgrade modal is displayed
    And the modal shows "Prompts: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit
  Scenario: Create Evaluator button is always clickable
    Given the organization has a license with maxEvaluators 3
    And the organization has 3 evaluators (at limit)
    When I view the evaluators page
    Then the "Create Evaluator" button is enabled
    And the "Create Evaluator" button is not visually disabled

  @unit
  Scenario: Clicking Create Evaluator at limit shows upgrade modal
    Given the organization has a license with maxEvaluators 3
    And the organization has 3 evaluators (at limit)
    When I click the "Create Evaluator" button
    Then an upgrade modal is displayed
    And the modal shows "Evaluators: 3 / 3"
    And the modal includes an upgrade call-to-action

  # ============================================================================
  # UI: Allowed State Behavior
  # ============================================================================

  @unit
  Scenario: Clicking Create Workflow when allowed opens creation modal
    Given the organization has a license with maxWorkflows 5
    And the organization has 3 workflows (under limit)
    When I click the "Create Workflow" button
    Then the new workflow modal is displayed
    And no upgrade modal is shown

  @unit
  Scenario: Clicking Create Prompt when allowed opens creation form
    Given the organization has a license with maxPrompts 5
    And the organization has 3 prompts (under limit)
    When I click the "Create Prompt" button
    Then the prompt creation flow starts
    And no upgrade modal is shown

  @unit
  Scenario: Clicking Create Evaluator when allowed opens creation form
    Given the organization has a license with maxEvaluators 5
    And the organization has 3 evaluators (under limit)
    When I click the "Create Evaluator" button
    Then the evaluator creation flow starts
    And no upgrade modal is shown

  # ============================================================================
  # useLicenseEnforcement Hook Behavior
  # ============================================================================

  @unit
  Scenario: Hook returns isAllowed true when under limit
    Given the organization has a license with maxWorkflows 5
    And the organization has 3 workflows
    When useLicenseEnforcement hook checks "workflows" limit
    Then isAllowed returns true
    And checkAndProceed executes the callback

  @unit
  Scenario: Hook returns isAllowed false when at limit
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows
    When useLicenseEnforcement hook checks "workflows" limit
    Then isAllowed returns false
    And checkAndProceed does not execute the callback
    And checkAndProceed triggers the upgrade modal

  @unit
  Scenario: Hook handles loading state optimistically
    Given the license check query is still loading
    When checkAndProceed is called
    Then the callback is executed immediately
    And no modal is shown

  # ============================================================================
  # UI: Form Error Handling (Backend FORBIDDEN Response)
  # ============================================================================

  @unit
  Scenario: Workflow form shows upgrade modal on FORBIDDEN error
    Given the organization has a license with maxWorkflows 3
    And the organization reached the limit after the form was opened
    When I submit the new workflow form
    And the server returns FORBIDDEN with limitType "workflows"
    Then an upgrade modal is displayed
    And the modal shows the current and max limit from the error
    And no generic "Failed to create workflow" toast is shown

  @unit
  Scenario: Prompt creation shows upgrade modal on FORBIDDEN error
    Given the organization has a license with maxPrompts 3
    And the organization reached the limit after the action started
    When the prompt creation request returns FORBIDDEN with limitType "prompts"
    Then an upgrade modal is displayed
    And the modal shows the current and max limit from the error

  @unit
  Scenario: Evaluator creation shows upgrade modal on FORBIDDEN error
    Given the organization has a license with maxEvaluators 3
    And the organization reached the limit after the action started
    When the evaluator creation request returns FORBIDDEN with limitType "evaluators"
    Then an upgrade modal is displayed
    And the modal shows the current and max limit from the error

  @unit
  Scenario: Form handles non-limit FORBIDDEN errors normally
    Given the server returns FORBIDDEN for permission denied
    When I submit the new workflow form
    Then an appropriate error toast is shown
    And no upgrade modal is displayed

  # ============================================================================
  # No License / Enforcement Disabled
  # ============================================================================

  @integration
  Scenario: No license allows unlimited workflows when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 workflows
    When I create a workflow in project "proj-789"
    Then the workflow is created successfully

  @integration
  Scenario: No license allows unlimited prompts when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 prompts
    When I create a prompt in project "proj-789"
    Then the prompt is created successfully

  @integration
  Scenario: No license allows unlimited evaluators when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 evaluators
    When I create an evaluator in project "proj-789"
    Then the evaluator is created successfully

  # ============================================================================
  # Invalid/Expired License Falls to FREE Tier
  # ============================================================================

  @integration
  Scenario: Expired license enforces FREE tier workflow limit
    Given the organization has an expired license
    And the organization has 3 workflows
    When I create a workflow in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Expired license enforces FREE tier prompt limit
    Given the organization has an expired license
    And the organization has 5 prompts
    When I create a prompt in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Expired license enforces FREE tier evaluator limit
    Given the organization has an expired license
    And the organization has 5 evaluators
    When I create an evaluator in project "proj-789"
    Then the request fails with FORBIDDEN
