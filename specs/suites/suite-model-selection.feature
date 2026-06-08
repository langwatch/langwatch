Feature: Run plan user-simulator and judge model selection
  As a user configuring a run plan (suite)
  I want to set the user-simulator and judge models for the whole plan
  So that every scenario in the plan role-plays and is judged with the
  models I chose

  # A run plan (SimulationSuite) groups scenarios + targets and runs them as
  # a batch. The plan can carry its own simulator/judge model selection that
  # applies to every scenario in the run, overriding each scenario's own
  # selection. When the plan leaves a model unset, the per-scenario value (or
  # the project default) applies.
  #
  # Resolution precedence for a suite run:
  #   suite override -> scenario override -> scenarios.user_simulator /
  #   scenarios.judge default

  Background:
    Given I am logged in
    And I have access to a project with an enabled model provider

  @integration
  Scenario: Simulator and judge models are persisted on the run plan
    Given a run plan
    When I save the run plan with a simulator model and a judge model
    Then the stored run plan carries both model selections

  @unit
  Scenario: A run plan simulator model overrides the scenario default at run time
    Given a run plan whose simulator model is set to a specific model
    And a scenario in that plan with no simulator override
    When the run data is prefetched for a scenario in that plan
    Then the user-simulator uses the run plan's simulator model

  @unit
  Scenario: A run plan with no model override falls back to the scenario or project default
    Given a run plan with no simulator or judge model configured
    And a scenario in that plan with no model override
    When the run data is prefetched for a scenario in that plan
    Then the user-simulator resolves the default simulator model
    And the judge resolves the default judge model

  @integration
  Scenario: The run plan drawer exposes simulator and judge model fields
    Given I open the run plan drawer
    Then I see a user-simulator model field
    And I see a judge model field
    And both default to the project Default model

  @visual
  Scenario: The run plan model pickers fill the drawer width
    Given I open the run plan drawer
    When I open the user-simulator model dropdown
    Then the picker and its dropdown span the full width of the drawer
    And each model name reads on a single line without truncation
