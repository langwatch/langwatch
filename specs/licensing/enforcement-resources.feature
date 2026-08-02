@wip
Feature: Resource Limit Enforcement (Workflows, Prompts, Evaluators, Scenarios, Teams, Experiments, Agents, Online Evaluations)

  # Five workflow scenarios are bound below to license-enforcement.service
  # and license-enforcement.repository tests. The remaining
  # @unimplemented scenarios fall in three groups:
  #   1. Per-resource-type backend variants (prompts/evaluators/scenarios/
  #      teams/agents/experiments/onlineEvaluations) — exercised at the
  #      unit level by the it.each(limitTypeTests) parameterized block in
  #      license-enforcement.service.unit.test.ts (every LimitType is
  #      verified to call the matching repository method against the
  #      matching plan field). Parameterized it.each cases cannot bind via
  #      @scenario JSDoc, so each backend variant is "covered but not
  #      bindable" until either a parity-script enhancement traverses
  #      it.each parameter sets, OR each scenario gets a dedicated
  #      single-name prose test.
  #   2. UI click-then-modal scenarios (Create-X button always clickable,
  #      shows upgrade modal at limit, opens form when allowed) — require
  #      page-level component tests against the rendered list pages,
  #      drawer-open flows, and the upgrade modal. No fixture exists yet.
  #   3. Expired-license FREE-tier fallback scenarios — require an
  #      end-to-end fixture that mounts a tRPC create-router with an
  #      expired license attached to the org. Indirectly verified by
  #      licenseHandler.integration.test.ts ("returns FREE_PLAN when
  #      license is expired") + the service test, but no scenario
  #      exists that wires both together. Aspirational pending that
  #      harness.
  As a LangWatch self-hosted deployment with a license
  I want resource creation limits to be enforced for workflows, prompts, evaluators, teams, and online evaluations
  So that organizations respect their licensed resource counts

  Background:
    Given an organization "org-123" exists
    And I am authenticated as an admin of "org-123"
    And a team "team-456" exists in the organization
    And a project "proj-789" exists in the team

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

  @integration @unimplemented
  Scenario: Workflow copy enforces limit
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows across all projects
    When I copy a workflow to project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Workflows: Database Query Compatibility
  # ============================================================================

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

  @integration @unimplemented
  Scenario: Allows evaluator creation when under limit
    Given the organization has a license with maxEvaluators 5
    And the organization has 3 evaluators across all projects
    When I create an evaluator in project "proj-789"
    Then the evaluator is created successfully

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Allows scenario creation when under limit
    Given the organization has a license with maxScenarios 5
    And the organization has 3 scenarios across all projects
    When I create a scenario in project "proj-789"
    Then the scenario is created successfully

  @integration @unimplemented
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

  @integration @unimplemented
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

  # A personal workspace is provisioned for a user, not asked for by the
  # organization, so it must never spend the organization's team allowance.
  # The same count backs enforcement, the usage page, and the license status
  # panel, so a personal team is invisible to all three or to none of them.

  @integration
  Scenario: Personal teams do not count toward the team limit
    Given the organization has a license with maxTeams 1
    And the organization has 3 personal teams
    When I create a team in the organization
    Then the team is created successfully

  @integration
  Scenario: Real teams still reach the limit alongside personal teams
    Given the organization has a license with maxTeams 1
    And the organization has 1 team
    And the organization has 1 personal team
    When I create a team in the organization
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of teams"

  @integration
  Scenario: The reported team usage excludes personal teams
    Given the organization has 1 team
    And the organization has 1 personal team
    When I view the organization usage
    Then the reported team count is 1

  # A personal team is exempt from the allowance because it holds one member,
  # its owner. Letting it take a second member would turn the exemption into a
  # way of running a team the allowance never sees.

  @integration
  Scenario: Adding a member to a personal team is refused
    Given the organization has 1 personal team
    When I add another member to the personal team
    Then the request fails with FORBIDDEN
    And the personal team still has exactly its owner
    And the reported team count is unchanged

  @integration
  Scenario: Renaming a personal team is still allowed
    Given the organization has 1 personal team
    When I rename the personal team
    Then the team is renamed successfully

  # A personal workspace stays one person's however the organization is
  # administered, and whether access is given to a person or to a group.

  @integration
  Scenario: Giving someone else access to a personal workspace is refused
    Given the organization has 1 personal team
    And another member of the organization
    When I give that member access to the personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  @integration
  Scenario: Giving a group access to a personal workspace is refused
    Given the organization has 1 personal team
    And a group in the organization
    When I give that group access to the personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  @integration
  Scenario: Taking the owner's access to their own workspace away is refused
    Given the organization has 1 personal team
    When I remove the owner from their personal workspace
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  @integration
  Scenario: Changing the owner's role on their own workspace is refused
    Given the organization has 1 personal team
    When I change the owner's role on their personal workspace
    Then the request fails with FORBIDDEN
    And the personal workspace is still only its owner's

  # Archiving a personal team cannot be undone by the owner: the uniqueness of
  # a personal team per (organization, owner) covers archived rows too, while
  # the workspace lookup skips them. The archived team keeps the slot, so
  # provisioning can neither find the workspace nor create a replacement.

  @integration
  Scenario: Archiving a personal team is refused
    Given the organization has 1 personal team
    When I archive the personal team
    Then the request fails with FORBIDDEN
    And the owner still has a personal workspace

  # Archiving a project frees its slot. A team that the whole product treats
  # as gone but the allowance still charges for leaves a customer at the limit
  # with nothing on screen to explain it.

  @integration
  Scenario: Archived teams do not count toward the team limit
    Given the organization has 1 team
    And the organization has 1 archived team
    When I view the organization usage
    Then the reported team count is 1

  # ============================================================================
  # UI: Click-then-Modal Pattern (All Resources)
  # ============================================================================

  @unit @unimplemented
  Scenario: Create Workflow button is always clickable
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows (at limit)
    When I view the workflows page
    Then the "Create Workflow" button is enabled
    And the "Create Workflow" button is not visually disabled

  @unit @unimplemented
  Scenario: Clicking Create Workflow at limit shows upgrade modal
    Given the organization has a license with maxWorkflows 3
    And the organization has 3 workflows (at limit)
    When I click the "Create Workflow" button
    Then an upgrade modal is displayed
    And the modal shows "Workflows: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit @unimplemented
  Scenario: Create Prompt button is always clickable
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    When I view the prompts page
    Then the "Create Prompt" button is enabled
    And the "Create Prompt" button is not visually disabled

  @unit @unimplemented
  Scenario: Clicking Create Prompt at limit shows upgrade modal
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    When I click the "Create Prompt" button
    Then an upgrade modal is displayed
    And the modal shows "Prompts: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit @unimplemented
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

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: Editing existing prompt bypasses limit check
    Given the organization has a license with maxPrompts 3
    And the organization has 3 prompts (at limit)
    And I am editing an existing prompt in PromptEditorDrawer
    When I modify the prompt details
    And I click "Save"
    Then the prompt is updated successfully
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Create Evaluator button is always clickable
    Given the organization has a license with maxEvaluators 3
    And the organization has 3 evaluators (at limit)
    When I view the evaluators page
    Then the "Create Evaluator" button is enabled
    And the "Create Evaluator" button is not visually disabled

  @unit @unimplemented
  Scenario: Clicking Create Evaluator at limit shows upgrade modal
    Given the organization has a license with maxEvaluators 3
    And the organization has 3 evaluators (at limit)
    When I click the "Create Evaluator" button
    Then an upgrade modal is displayed
    And the modal shows "Evaluators: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit @unimplemented
  Scenario: Create Scenario button is always clickable
    Given the organization has a license with maxScenarios 3
    And the organization has 3 scenarios (at limit)
    When I view the scenarios page
    Then the "New Scenario" button is enabled
    And the "New Scenario" button is not visually disabled

  @unit @unimplemented
  Scenario: Clicking Create Scenario at limit shows upgrade modal
    Given the organization has a license with maxScenarios 3
    And the organization has 3 scenarios (at limit)
    When I click the "New Scenario" button
    Then an upgrade modal is displayed
    And the modal shows "Scenarios: 3 / 3"
    And the modal includes an upgrade call-to-action

  @unit @unimplemented
  Scenario: Create Team button is always clickable
    Given the organization has a license with maxTeams 3
    And the organization has 3 teams (at limit)
    When I view the teams settings page
    Then the "Create team" button is enabled
    And the "Create team" button is not visually disabled

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: Clicking Create Workflow when allowed opens creation modal
    Given the organization has a license with maxWorkflows 5
    And the organization has 3 workflows (under limit)
    When I click the "Create Workflow" button
    Then the new workflow modal is displayed
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Clicking Create Prompt when allowed opens creation form
    Given the organization has a license with maxPrompts 5
    And the organization has 3 prompts (under limit)
    When I click the "Create Prompt" button
    Then the prompt creation flow starts
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Clicking Create Evaluator when allowed opens creation form
    Given the organization has a license with maxEvaluators 5
    And the organization has 3 evaluators (under limit)
    When I click the "Create Evaluator" button
    Then the evaluator creation flow starts
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Clicking Create Scenario when allowed opens creation form
    Given the organization has a license with maxScenarios 5
    And the organization has 3 scenarios (under limit)
    When I click the "New Scenario" button
    Then the scenario creation drawer is displayed
    And no upgrade modal is shown

  @unit @unimplemented
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

  # ============================================================================
  # UI: Form Error Handling (Backend FORBIDDEN Response)
  # ============================================================================

  # ============================================================================
  # Invalid/Expired License Falls to FREE Tier
  # ============================================================================

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier workflow limit
    Given the organization has an expired license
    And the organization has 3 workflows
    When I create a workflow in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier prompt limit
    Given the organization has an expired license
    And the organization has 5 prompts
    When I create a prompt in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier evaluator limit
    Given the organization has an expired license
    And the organization has 5 evaluators
    When I create an evaluator in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier scenario limit
    Given the organization has an expired license
    And the organization has 5 scenarios
    When I create a scenario in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier team limit
    Given the organization has an expired license
    And the organization has 2 teams
    When I create a team in the organization
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Experiments: Backend Enforcement
  # ============================================================================

  @integration @unimplemented
  Scenario: Allows experiment creation when under limit
    Given the organization has a license with maxExperiments 3
    And the organization has 2 experiments across all projects
    When I create an experiment in project "proj-789"
    Then the experiment is created successfully

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Experiment copy enforces limit
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments across all projects
    When I copy an experiment to project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Updating existing experiment does not enforce limit
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments across all projects
    And I have an existing experiment "exp-123"
    When I update experiment "exp-123" in project "proj-789"
    Then the experiment is updated successfully

  # ============================================================================
  # Experiments: UI Enforcement
  # ============================================================================

  @unit @unimplemented
  Scenario: Create Experiment menu item is always clickable
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments (at limit)
    When I view the evaluations dashboard
    Then the "Create Experiment" menu item is enabled

  @unit @unimplemented
  Scenario: Clicking Create Experiment at limit shows upgrade modal
    Given the organization has a license with maxExperiments 3
    And the organization has 3 experiments (at limit)
    When I click the "Create Experiment" menu item
    Then an upgrade modal is displayed
    And the modal shows "Experiments: 3 / 3"

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier experiment limit
    Given the organization has an expired license
    And the organization has 3 experiments
    When I create an experiment in project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Agents: Backend Enforcement
  # ============================================================================

  @integration @unimplemented
  Scenario: Allows agent creation when under limit
    Given the organization has a license with maxAgents 5
    And the organization has 3 agents across all projects
    When I create an agent in project "proj-789"
    Then the agent is created successfully

  @integration @unimplemented
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

  @integration @unimplemented
  Scenario: Updating existing agent does not enforce limit
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents across all projects
    And I have an existing agent "agent-123"
    When I update agent "agent-123" in project "proj-789"
    Then the agent is updated successfully

  # ============================================================================
  # Agents: UI Enforcement (Save-time Modal)
  # ============================================================================

  @unit @unimplemented
  Scenario: Agent creation drawer opens regardless of limit
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents (at limit)
    When I click "New Agent" on the agents page
    Then the agent type selector drawer opens
    And no upgrade modal is shown yet

  @unit @unimplemented
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

  @unit @unimplemented
  Scenario: Clicking Save Agent when allowed creates the agent
    Given the organization has a license with maxAgents 5
    And the organization has 3 agents (under limit)
    And I have opened the AgentCodeEditorDrawer for a new agent
    When I fill in the agent details
    And I click "Create Agent"
    Then the agent is created successfully
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Editing existing agent bypasses limit check
    Given the organization has a license with maxAgents 3
    And the organization has 3 agents (at limit)
    And I am editing an existing agent
    When I modify the agent details
    And I click "Save Changes"
    Then the agent is updated successfully
    And no upgrade modal is shown

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier agent limit
    Given the organization has an expired license
    And the organization has 3 agents
    When I create an agent in project "proj-789"
    Then the request fails with FORBIDDEN

  # ============================================================================
  # Online Evaluations: Backend Enforcement
  # ============================================================================

  @integration @unimplemented
  Scenario: Allows online evaluation creation when under limit
    Given the organization has a license with maxOnlineEvaluations 5
    And the organization has 3 online evaluations across all projects
    When I create an online evaluation in project "proj-789"
    Then the online evaluation is created successfully

  @integration @unimplemented
  Scenario: Blocks online evaluation creation when at limit
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 3 online evaluations across all projects
    When I create an online evaluation in project "proj-789"
    Then the request fails with FORBIDDEN
    And the error message contains "maximum number of online evaluations"

  @integration @unimplemented
  Scenario: Counts online evaluations across all projects in organization
    Given the organization has a license with maxOnlineEvaluations 3
    And project "proj-A" has 2 online evaluations
    And project "proj-B" has 1 online evaluation
    When I create an online evaluation in project "proj-789"
    Then the request fails with FORBIDDEN

  @integration @unimplemented
  Scenario: Counts only enabled online evaluations toward limit
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 2 enabled online evaluations
    And the organization has 2 disabled online evaluations
    When I create an online evaluation in project "proj-789"
    Then the online evaluation is created successfully

  @integration @unimplemented
  Scenario: Updating existing online evaluation does not enforce limit
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 3 online evaluations across all projects
    And I have an existing online evaluation "online-eval-123"
    When I update online evaluation "online-eval-123" in project "proj-789"
    Then the online evaluation is updated successfully

  # ============================================================================
  # Online Evaluations: UI Enforcement (Save-time Modal)
  # ============================================================================

  @unit @unimplemented
  Scenario: Online evaluation drawer opens regardless of limit
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 3 online evaluations (at limit)
    When I click "New Online Evaluation" on the evaluations page
    Then the OnlineEvaluationDrawer opens
    And no upgrade modal is shown yet

  @unit @unimplemented
  Scenario: Clicking Save Online Evaluation at limit shows upgrade modal
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 3 online evaluations (at limit)
    And I have opened the OnlineEvaluationDrawer for a new online evaluation
    When I fill in the online evaluation details
    And I click "Save"
    Then an upgrade modal is displayed
    And the modal shows "Online Evaluations: 3 / 3"
    And the modal includes an upgrade call-to-action
    And the API request is NOT made

  @unit @unimplemented
  Scenario: Clicking Save Online Evaluation when allowed creates the online evaluation
    Given the organization has a license with maxOnlineEvaluations 5
    And the organization has 3 online evaluations (under limit)
    And I have opened the OnlineEvaluationDrawer for a new online evaluation
    When I fill in the online evaluation details
    And I click "Save"
    Then the online evaluation is created successfully
    And no upgrade modal is shown

  @unit @unimplemented
  Scenario: Editing existing online evaluation bypasses limit check
    Given the organization has a license with maxOnlineEvaluations 3
    And the organization has 3 online evaluations (at limit)
    And I am editing an existing online evaluation
    When I modify the online evaluation details
    And I click "Save"
    Then the online evaluation is updated successfully
    And no upgrade modal is shown

  @integration @unimplemented
  Scenario: Expired license enforces FREE tier online evaluation limit
    Given the organization has an expired license
    And the organization has 3 online evaluations
    When I create an online evaluation in project "proj-789"
    Then the request fails with FORBIDDEN
