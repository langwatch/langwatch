@integration
Feature: Split online evaluations from experiments in project navigation
  As a LangWatch user
  I want online evaluations and experiments to live in their documented product areas
  So that production monitoring is under traces and pre-production batch testing is under simulations

  Background:
    Given I am logged in to a project

  Scenario: Sidebar places online evaluations under traces
    When I open the main project menu
    Then the Observe section shows a traces menu group
    And that traces menu group contains "Trace Explorer"
    And that traces menu group contains "Evaluations"
    And the "Evaluations" item links to /[project]/evaluations
    And the "Evaluations" item represents online evaluations only

  Scenario: Sidebar places experiments under simulations
    When I open the main project menu
    Then the Evaluate section shows a simulations menu group
    And that simulations menu group contains "Experiments"
    And the "Experiments" item links to /[project]/experiments
    And the "Experiments" item uses the experiment flask icon

  Scenario: Evaluations page lists only online evaluations and guardrails
    Given monitors and experiments exist in the current project
    When I visit /[project]/evaluations
    Then I see online evaluations monitors
    And I can create an online evaluation
    And I can set up a guardrail
    And I do not see the experiments list
    And I do not see an experiment creation action

  Scenario: Experiments page lists only experiments
    Given monitors and experiments exist in the current project
    When I visit /[project]/experiments
    Then I see the experiments table
    And I can create a new experiment
    And I can evaluate via SDK
    And I do not see online evaluation monitors
    And I do not see guardrail setup actions

  Scenario: Legacy experiment creation URLs keep redirecting to the workbench
    Given I open a legacy /[project]/evaluations/wizard URL for a workbench experiment
    Then I am redirected to the matching /[project]/experiments/workbench URL
