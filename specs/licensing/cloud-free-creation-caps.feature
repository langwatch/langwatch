Feature: Cloud Free plan caps scenarios, simulations and custom evaluators

  The cloud Free plan includes 3 scenarios, 3 simulations (distinct scenario
  sets) and 3 custom evaluators, as the pricing page says. Paid cloud plans are
  uncapped. Self-hosted deployments are uncapped with or without a license: the
  caps live on the cloud Free plan and are never read from a signed license.

  A custom evaluator is any evaluator saved in a project's evaluator library,
  whatever its kind (built-in configuration, code or workflow). Online
  evaluations (monitors) are not evaluators and stay uncapped.

  Only creating one more is refused. An organization already above a cap keeps
  everything it has and can still edit and run it. A refusal carries the limit
  type, the current count and the cap, and in the app it opens the upgrade
  modal with those numbers.

  Background:
    Given an organization with a project

  @unit
  Scenario: Cloud Free refuses a fourth scenario
    Given the organization is on the cloud Free plan
    And it has 3 active scenarios
    When a member creates another scenario
    Then the creation is refused with limit type "scenarios", current 3 and max 3

  @unit
  Scenario: Cloud Free refuses a fourth custom evaluator
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    When a member creates another custom evaluator
    Then the creation is refused with limit type "evaluators", current 3 and max 3

  @unit
  Scenario: Cloud Free allows creating below the cap
    Given the organization is on the cloud Free plan
    And it has 2 active scenarios
    When a member creates another scenario
    Then the scenario is created

  @unit
  Scenario: Cloud Free refuses a run that starts a fourth new simulation
    Given the organization is on the cloud Free plan
    And it has run 3 distinct scenario sets
    When a run starts for a new scenario set
    Then the run is refused with limit type "scenarioSets", current 3 and max 3

  @unit
  Scenario: A simulation the organization already ran keeps running over the cap
    Given the organization is on the cloud Free plan
    And it has run 5 distinct scenario sets
    When a run starts for one of those scenario sets
    Then the run is accepted

  @unit
  Scenario: An unknown simulation count does not block runs
    Given the organization is on the cloud Free plan
    And its simulation history cannot be read
    When a run starts for a new scenario set
    Then the run is accepted

  @unit
  Scenario: Platform-owned runs do not count as simulations
    Given the organization is on the cloud Free plan
    And it has run 3 distinct scenario sets
    When a run starts from the platform, an agent test or a voice call
    Then the run is accepted without counting scenario sets

  @unit
  Scenario: Paid cloud plans are not capped
    Given the organization is on a paid cloud plan
    And it has 50 scenarios, 50 custom evaluators and 50 scenario sets
    When a member creates another scenario, custom evaluator or simulation
    Then nothing is refused and nothing is counted

  @unit
  Scenario: Self-hosted without a license is not capped
    Given a self-hosted deployment with no license
    Then the active plan sets no scenario, simulation or custom evaluator cap

  @unit
  Scenario: Self-hosted with a license is not capped
    Given a self-hosted deployment with a license whose signed payload carries maxScenarios
    Then the active plan sets no scenario, simulation or custom evaluator cap

  @integration
  Scenario: Creating a fourth scenario in the app is refused with the upgrade shape
    Given the organization is on the cloud Free plan
    And it has 3 active scenarios
    When a member saves a new scenario
    Then the request fails as FORBIDDEN with limit type "scenarios", current 3 and max 3

  @integration
  Scenario: An organization over the scenario cap can still edit its scenarios
    Given the organization is on the cloud Free plan
    And it has 5 active scenarios
    When a member edits one of them
    Then the change is saved

  @integration
  Scenario: Creating a fourth custom evaluator in the app is refused with the upgrade shape
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    When a member saves a new custom evaluator
    Then the request fails as FORBIDDEN with limit type "evaluators", current 3 and max 3

  @integration
  Scenario: Copying a custom evaluator past the cap is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    When a member copies one of them into another project
    Then the request fails as FORBIDDEN with limit type "evaluators", current 3 and max 3

  @integration
  Scenario: Copying an online evaluation is not capped
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    And an online evaluation that uses one of them
    When a member copies the online evaluation into another project
    Then the online evaluation is copied with its evaluator

  @integration
  Scenario: Duplicating a scenario past the cap is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it has 3 active scenarios
    When a member duplicates one of them
    Then the request fails as FORBIDDEN with limit type "scenarios", current 3 and max 3

  @integration
  Scenario: Saving a workflow as a fourth custom evaluator is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    When a member saves a workflow as an evaluator
    Then the request fails as FORBIDDEN with limit type "evaluators", current 3 and max 3
    And the workflow is not flagged as an evaluator

  @integration
  Scenario: Creating a fourth scenario through the API is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it has 3 active scenarios
    When an API key posts a new scenario
    Then the response is 403 with limit type "scenarios", current 3 and max 3

  @integration
  Scenario: Creating a fourth custom evaluator through the API is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it has 3 active custom evaluators
    When an API key posts a new custom evaluator
    Then the response is 403 with limit type "evaluators", current 3 and max 3

  @integration
  Scenario: The upgrade modal names the cap that was reached
    Given a creation was refused with limit type "scenarios", current 3 and max 3
    When the upgrade modal opens
    Then it says "You've reached the limit of 3 scenarios on your current plan."
    And it shows "Current usage: 3 / 3"

  @unit
  Scenario: The refusal copy names the cap and keeps existing items
    Given a creation was refused with limit type "evaluators" and max 3
    When the refusal is presented outside the upgrade modal
    Then it says the plan includes 3 custom evaluators and everything already created keeps working

  @unit
  Scenario: The Free plan card matches the pricing page
    When the Free plan card is shown
    Then it lists "3 scenarios, 3 simulations, 3 custom evals"
