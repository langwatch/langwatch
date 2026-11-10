Feature: Cloud Free plan caps scenarios, custom evaluators and scenario runs

  The cloud Free plan includes 3 scenarios and 3 custom evaluators, as the
  pricing page says. Scenario runs have no cap for the first 14 days after the organization's first run; after
  that, Free allows 100 runs per UTC calendar month, the clock the events meter
  uses. Every run a member causes counts: Run in the app, runs reported from
  code through the Scenario SDK, agent tests and voice calls. Scenario sets
  (test suites) are not capped. Paid cloud plans are
  uncapped and bill runs as events. Self-hosted deployments are uncapped with or without a license: the
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
  Scenario: Cloud Free allows any number of runs during the grace
    Given the organization is on the cloud Free plan
    And its first scenario run was 3 days ago
    And it ran 250 scenarios this month
    When a run starts
    Then the run is accepted

  @unit
  Scenario: Cloud Free refuses the 101st run of the month after the grace
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 100 scenarios this month
    When a run starts
    Then the run is refused with limit type "scenarioRuns", current 100 and max 100

  @unit
  Scenario: Running a scenario from the app past the run cap opens the upgrade prompt
    Given the organization is on the cloud Free plan
    And it is past the month's run cap
    When a member clicks Run on a scenario or a suite
    Then the run is refused before it is queued
    And the refusal carries limit type "scenarioRuns" with status 403, which opens the upgrade prompt
    And the run dialog behind the upgrade prompt shows no error of its own

  @unit
  Scenario: A run reported through the SDK past the run cap is refused with the limit shape
    Given the organization is on the cloud Free plan
    And it is past the month's run cap
    When the SDK reports a run start for a new run
    Then the event is refused with limit type "scenarioRuns" and nothing is stored

  @unit
  Scenario: Cloud Free allows runs below the monthly cap after the grace
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 99 scenarios this month
    When a run starts
    Then the run is accepted

  @unit
  Scenario: The monthly run count starts again each UTC calendar month
    Given the organization is on the cloud Free plan
    And its first scenario run was 60 days ago
    And it ran 100 scenarios last month and none this month
    When a run starts
    Then the run is accepted

  @unit
  Scenario: The run cap counts runs, not scenario sets
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 10 runs this month
    When a run starts
    Then the run is accepted
    And the month's count before this run is 10 runs

  @unit
  Scenario: App runs, agent tests and voice calls count toward the monthly cap
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    When a run starts from the app, an agent test or a voice call
    Then each run is checked against the monthly cap and counted toward it

  @unit
  Scenario: A voice call past the run cap is refused before its run is written
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 100 runs this month
    When a "Call it myself" voice call under a scenario finishes
    Then it is refused with limit type "scenarioRuns"
    And no run is written for it

  @unit
  Scenario: A run queued from the app is counted once
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 99 scenarios this month
    When a member clicks Run and the queued run later reports its start
    Then the 100th run passes the check at queue time and when its start is reported
    And the 101st run is refused once, before it is queued

  @unit
  Scenario: A retried run start is counted once
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 98 scenarios this month
    When one run's start is reported twice and another run starts
    Then both runs pass and the month holds 100 runs
    And a start already recorded for its run passes again at the cap
    And a new run at the cap is refused

  @unit
  Scenario: An unknown run count does not block runs
    Given the organization is on the cloud Free plan
    And its scenario run history cannot be read
    When a run starts
    Then the run is accepted

  @unit
  Scenario: A paid cloud plan has no run cap
    Given the organization is on a paid cloud plan
    And its first scenario run was 60 days ago
    And it ran 5000 scenarios this month
    When a run starts
    Then the run is accepted without counting runs

  @integration
  Scenario: The month's runs are counted from the billable events meter
    Given the organization's projects metered 3 scenario run starts this month, 2 last month and 4 other events
    When the run usage is read
    Then it counts 3 runs this month
    And its first run is the earliest metered run start

  @unit
  Scenario: The usage page shows the month's runs against the cap
    Given the organization is on the cloud Free plan
    And its first scenario run was 20 days ago
    And it ran 87 scenarios this month
    When the usage is read
    Then the scenario runs read "87 of 100 runs this month"

  @unit
  Scenario: The usage page says when the grace ends
    Given the organization is on the cloud Free plan
    And its first scenario run was 3 days ago
    When the usage is read
    Then the scenario runs show no cap until the grace ends in 11 days

  @unit
  Scenario: Reaching 80 runs in a month records the threshold once
    Given the organization is on the cloud Free plan
    And its runs were counted at 80 this month
    When the runs are counted again at 120 the same month
    Then "scenario_runs_threshold_reached" was recorded once for the month

  @unit
  Scenario: The threshold is recorded during the grace too
    Given the organization is on the cloud Free plan
    And its first scenario run was 3 days ago
    When its runs are counted at 80 this month
    Then "scenario_runs_threshold_reached" is recorded with the grace still running

  @unit
  Scenario: The threshold is recorded again the next month
    Given "scenario_runs_threshold_reached" was recorded last month
    When the runs are counted at 80 this month
    Then "scenario_runs_threshold_reached" is recorded for this month

  @unit
  Scenario: The grace ends 14 days after the first run
    Given the organization is on the cloud Free plan
    And its runs were counted with its first run 14 days ago
    When the organization's grace wakes
    Then "scenario_run_grace_ended" is recorded once

  @unit
  Scenario: A grace that ended long before the count is closed without a notice
    Given the organization is on the cloud Free plan
    And its first scenario run was 90 days ago
    When its runs are counted for the first time
    Then the grace is closed and "scenario_run_grace_ended" is not recorded

  @unit
  Scenario: A paid organization records no run notices
    Given the organization is on a paid cloud plan
    When its runs are counted at 500 this month
    Then nothing is recorded

  @unit
  Scenario: The run refusal tells the caller how to upgrade
    Given a run was refused with limit type "scenarioRuns" and max 100
    When the refusal is presented outside the upgrade modal
    Then it says the plan includes 100 scenario runs a month and names the upgrade

  @unit
  Scenario: Nurturing tells Customer.io and PostHog when a Free organization nears its scenario run cap
    Given "scenario_runs_threshold_reached" was recorded for an organization
    When nurturing receives it
    Then every member is tracked "scenario_runs_threshold_reached" once with the runs, the limit and the month

  @unit
  Scenario: Nurturing tells Customer.io and PostHog when a Free organization's scenario run grace ends
    Given "scenario_run_grace_ended" was recorded for an organization
    When nurturing receives it
    Then every member is tracked "scenario_run_grace_ended" once with the grace end and the run limit

  @unit
  Scenario: Paid cloud plans are not capped
    Given the organization is on a paid cloud plan
    And it has 50 scenarios and 50 custom evaluators
    When a member creates another scenario or custom evaluator
    Then nothing is refused and nothing is counted

  @unit
  Scenario: Self-hosted without a license is not capped
    Given a self-hosted deployment with no license
    Then the active plan sets no scenario, custom evaluator or scenario run cap

  @unit
  Scenario: Self-hosted with a license is not capped
    Given a self-hosted deployment with a license whose signed payload carries maxScenarios
    Then the active plan sets no scenario, custom evaluator or scenario run cap

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
    Then it lists "3 scenarios, 3 custom evals, 100 scenario runs a month"
