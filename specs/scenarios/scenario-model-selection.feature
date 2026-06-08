Feature: Scenario user-simulator and judge model selection
  As a user running agent scenario simulations
  I want to choose which models power the user-simulator and the judge
  So that I can use top-tier models for the role-play and the evaluation,
  independently of the agent under test

  # Background
  # ----------
  # Every scenario run drives three LLM roles:
  #   - the target agent under test (uses its own model / prompt config)
  #   - the user-simulator agent that role-plays the end user
  #   - the judge agent that decides whether the success criteria were met
  #
  # Historically the simulator and judge both resolved the single FAST
  # "scenarios.generator" model. They now resolve two dedicated DEFAULT-role
  # feature keys so the role-play and evaluation default to a smart model,
  # and each can be overridden per-scenario (and per run-plan, see
  # specs/suites/suite-model-selection.feature).
  #
  # Resolution precedence for a single run:
  #   scenario override -> scenarios.user_simulator / scenarios.judge default

  Background:
    Given I am logged in
    And I have access to a project with an enabled model provider

  @unit
  Scenario: User-simulator and judge are registered as DEFAULT-role features
    Given the model feature registry
    Then it contains a "scenarios.user_simulator" feature with role "DEFAULT"
    And it contains a "scenarios.judge" feature with role "DEFAULT"

  @unit
  Scenario: New scenario model features surface under the Default role expansion
    Given the model feature registry grouped by role
    When I list the DEFAULT-role features
    Then "scenarios.user_simulator" is included
    And "scenarios.judge" is included

  @unit
  Scenario: Defaults resolve to the smart Default model when the scenario has no override
    Given a scenario with no simulator or judge model configured
    When the run data is prefetched
    Then the user-simulator model resolves from "scenarios.user_simulator"
    And the judge model resolves from "scenarios.judge"

  @unit
  Scenario: A scenario-level simulator override is used for the user-simulator
    Given a scenario whose simulator model is set to a specific model
    When the run data is prefetched
    Then the user-simulator uses that model
    And the judge still resolves the default judge model

  @unit
  Scenario: A scenario-level judge override is used for the judge
    Given a scenario whose judge model is set to a specific model
    When the run data is prefetched
    Then the judge uses that model
    And the user-simulator still resolves the default simulator model

  @integration
  Scenario: Simulator and judge models are persisted on the scenario
    Given a scenario
    When I update the scenario with a simulator model and a judge model
    Then the stored scenario carries both model selections

  @integration
  Scenario: The save-and-run model dialog lets me choose simulator and judge models
    Given I am editing a scenario and have chosen a target to run against
    When the model selection dialog opens
    Then it shows a user-simulator model picker defaulting to the Default model
    And it shows a judge model picker defaulting to the Default model
    And confirming runs the scenario with the chosen models
