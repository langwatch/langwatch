@wip
Feature: Resource Limit Enforcement (Workflows, Prompts, Evaluators, Scenarios, Teams, Experiments)
  As a LangWatch self-hosted deployment with a license
  I want resource creation limits to be enforced for workflows, prompts, evaluators, and teams
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
  # Scenarios: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows scenario creation when under limit
    Given the organization has a license with maxScenarios 5
    And the organization has 3 scenarios across all projects
    When I create a scenario in project "proj-789"
    Then the scenario is created successfully

  @integration
  Scenario: Blocks scenario creation when at limit
    Given the organization has a license with maxScenarios 3
    And the organization has 3 scenarios across all projects
    When I create a scenario in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of scenarios"

  @integration
  Scenario: Counts scenarios across all projects in organization
    Given the organization has a license with maxScenarios 3
    And project "proj-A" has 2 scenarios
    And project "proj-B" has 1 scenario
    When I create a scenario in project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Teams: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows team creation when under limit
    Given the organization has a license with maxTeams 5
    And the organization has 3 teams
    When I create a team in the organization
    Then the team is created successfully

  @integration
  Scenario: Blocks team creation when at limit
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of teams"

  @integration
  Scenario: Blocks team creation when over limit
    Given the organization has a license with maxTeams 2
    And the organization has 3 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN

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
  Scenario: Clicking Save Prompt in PromptEditorDrawer at limit shows upgrade modal
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    And I have opened the PromptEditorDrawer for a new prompt
    When I fill in the prompt details
    And I click "Save"
    Then an upgrade modal is displayed
    And the modal shows "Prompts: 3 / 3"
    And the modal includes an upgrade call-to-action
    And the API request is NOT made

  @unit
  Scenario: Creating prompt from scenario editor at limit shows upgrade modal
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    And I am in the scenario editor drawer
    When I click "+ Add New Prompt"
    Then the PromptEditorDrawer opens
    When I fill in the prompt details
    And I click "Save"
    Then an upgrade modal is displayed
    And the modal shows "Prompts: 3 / 3"
    And the API request is NOT made

  @unit
  Scenario: Editing existing prompt bypasses limit check
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    And I am editing an existing prompt in PromptEditorDrawer
    When I modify the prompt details
    And I click "Save"
    Then the prompt is updated successfully
    And no upgrade modal is shown

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

  @unit
  Scenario: Create Scenario button is always clickable
    Given the organization has a license with maxScenarios 3
    And the organization has 3 scenarios (at limit)
    When I view the scenarios page
    Then the "New Scenario" button is enabled
    And the "New Scenario" button is not visually disabled

  @unit
  Scenario: Clicking Create Scenario at limit shows upgrade modal
    Given the organization has a license with maxScenarios 3
    And the organization has 3 scenarios (at limit)
    When I click the "New Scenario" button
    Then an upgrade modal is displayed
    And the modal shows "Scenarios: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit
  Scenario: Create Team button is always clickable
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams (at limit)
    When I view the teams settings page
    Then the "Create team" button is enabled
    And the "Create team" button is not visually disabled

  @unit
  Scenario: Clicking Create Team at limit shows upgrade modal on submit
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams (at limit)
    When I click the "Create team" button
    Then the team creation form is displayed
    When I fill the team name and click save
    Then an upgrade modal is displayed
    And the modal shows "Teams: 3 / 3"
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

  @unit
  Scenario: Clicking Create Scenario when allowed opens creation form
    Given the organization has a license with maxScenarios 5
    And the organization has 3 scenarios (under limit)
    When I click the "New Scenario" button
    Then the scenario creation drawer is displayed
    And no upgrade modal is shown

  @unit
  Scenario: Clicking Create Team when allowed creates the team
    Given the organization has a license with maxTeams 5
    And the organization has 3 teams (under limit)
    When I click the "Create team" button
    And I fill the team name and click save
    Then the team is created successfully
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

  @integration
  Scenario: No license allows unlimited scenarios when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 scenarios
    When I create a scenario in project "proj-789"
    Then the scenario is created successfully

  @integration
  Scenario: No license allows unlimited teams when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 teams
    When I create a team in the organization
    Then the team is created successfully

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

  @integration
  Scenario: Expired license enforces FREE tier scenario limit
    Given the organization has an expired license
    And the organization has 5 scenarios
    When I create a scenario in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Expired license enforces FREE tier team limit
    Given the organization has an expired license
    And the organization has 2 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Experiments: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows experiment creation when under limit
    Given the organization has a license with maxExperiments 3
    And the organization has 2 experiments across all projects
    When I create an experiment in project "proj-789"
    Then the experiment is created successfully

  @integration
  Scenario: Blocks experiment creation when at limit
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments across all projects
    When I create an experiment in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of experiments"

  @integration
  Scenario: Counts experiments across all projects in organization
    Given the organization has a license with maxExperiments 3
    And project "proj-A" has 2 experiments
    And project "proj-B" has 1 experiment
    When I create an experiment in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Experiment copy enforces limit
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments across all projects
    When I copy an experiment to project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Updating existing experiment does not enforce limit
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments across all projects
    And I have an existing experiment "exp-123"
    When I update experiment "exp-123" in project "proj-789"
    Then the experiment is updated successfully

  # ============================================================================
  # Experiments: UI Enforcement
  # ============================================================================

  @unit
  Scenario: Create Experiment menu item is always clickable
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments (at limit)
    When I view the evaluations dashboard
    Then the "Create Experiment" menu item is enabled

  @unit
  Scenario: Clicking Create Experiment at limit shows upgrade modal
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments (at limit)
    When I click the "Create Experiment" menu item
    Then an upgrade modal is displayed
    And the modal shows "Experiments: 3 / 3"

  # ============================================================================
  # Experiments: No License / Enforcement Disabled
  # ============================================================================

  @integration
  Scenario: No license allows unlimited experiments when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 experiments
    When I create an experiment in project "proj-789"
    Then the experiment is created successfully

  @integration
  Scenario: Expired license enforces FREE tier experiment limit
    Given the organization has an expired license
    And the organization has 3 experiments
    When I create an experiment in project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Agents: Backend Enforcement
  # ============================================================================

  @integration
  Scenario: Allows agent creation when under limit
    Given the organization has a license with maxAgents 5
    And the organization has 3 agents across all projects
    When I create an agent in project "proj-789"
    Then the agent is created successfully

  @integration
  Scenario: Blocks agent creation when at limit
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents across all projects
    When I create an agent in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of agents"

  @integration
  Scenario: Counts agents across all projects in organization
    Given the organization has a license with maxAgents 3
    And project "proj-A" has 2 agents
    And project "proj-B" has 1 agent
    When I create an agent in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration
  Scenario: Counts only non-archived agents toward limit
    Given the organization has a license with maxAgents 3
    And the organization has 2 active agents
    And the organization has 2 archived agents
    When I create an agent in project "proj-789"
    Then the agent is created successfully

  @integration
  Scenario: Updating existing agent does not enforce limit
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents across all projects
    And I have an existing agent "agent-123"
    When I update agent "agent-123" in project "proj-789"
    Then the agent is updated successfully

  # ============================================================================
  # Agents: UI Enforcement (Save-time Modal)
  # ============================================================================

  @unit
  Scenario: Agent creation drawer opens regardless of limit
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents (at limit)
    When I click "New Agent" on the agents page
    Then the agent type selector drawer opens
    And no upgrade modal is shown yet

  @unit
  Scenario: Clicking Save Agent at limit shows upgrade modal
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents (at limit)
    And I have opened the AgentCodeEditorDrawer for a new agent
    When I fill in the agent details
    And I click "Create Agent"
    Then an upgrade modal is displayed
    And the modal shows "Agents: 3 / 3"
    And the modal includes an upgrade call-to-action
    And the API request is NOT made

  @unit
  Scenario: Clicking Save Agent when allowed creates the agent
    Given the organization has a license with maxAgents 5
    And the organization has 3 agents (under limit)
    And I have opened the AgentCodeEditorDrawer for a new agent
    When I fill in the agent details
    And I click "Create Agent"
    Then the agent is created successfully
    And no upgrade modal is shown

  @unit
  Scenario: Editing existing agent bypasses limit check
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents (at limit)
    And I am editing an existing agent
    When I modify the agent details
    And I click "Save Changes"
    Then the agent is updated successfully
    And no upgrade modal is shown

  # ============================================================================
  # Agents: No License / Enforcement Disabled
  # ============================================================================

  @integration
  Scenario: No license allows unlimited agents when enforcement disabled
    Given LICENSE_ENFORCEMENT_ENABLED is "false"
    And the organization has no license
    And the organization has 100 agents
    When I create an agent in project "proj-789"
    Then the agent is created successfully

  @integration
  Scenario: Expired license enforces FREE tier agent limit
    Given the organization has an expired license
    And the organization has 3 agents
    When I create an agent in project "proj-789"
    Then the request fails with FORBIDDEN
