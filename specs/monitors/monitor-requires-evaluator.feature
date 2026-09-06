@integration
Feature: Creating a monitor requires an evaluator
  As an agent or developer creating an online-evaluation monitor through the API or CLI
  I want a monitor created without an evaluator to be rejected with an actionable error
  So that I never end up with a monitor that silently evaluates nothing

  # The failure this spec pins: `langwatch monitor create "X" --check-type
  # langevals/llm_boolean` with no --evaluator-id created a monitor with
  # evaluatorId null. The app's Edit Online Evaluation drawer then showed an
  # empty "Select Evaluator" and the monitor could not evaluate anything.
  # Found while dogfooding with a customer project.
  #
  # Monitors that predate evaluators (legacy check_* rows) keep running off
  # their stored parameters, so existing rows are untouched: only creating a
  # new evaluator-less monitor, or stripping the evaluator from an existing
  # one, is gated.

  Scenario: Creating a monitor without an evaluator is rejected
    When I create a monitor without an evaluator id
    Then the request fails with code "monitor_evaluator_required"
    And the failure tells me to create or pick an evaluator first

  Scenario: Creating a monitor with an evaluator succeeds
    Given an evaluator exists in the project
    When I create a monitor referencing that evaluator
    Then the monitor is created with that evaluator attached

  Scenario: Creating a monitor with an unknown evaluator is rejected
    When I create a monitor referencing an evaluator that does not exist
    Then the request fails as not found

  Scenario: Removing the evaluator from a monitor is rejected
    Given a monitor with an evaluator exists
    When I update the monitor setting its evaluator to null
    Then the request fails with code "monitor_evaluator_required"
    And the monitor keeps its evaluator

  Scenario: Updating other fields of a legacy monitor without an evaluator still works
    Given a legacy monitor without an evaluator exists
    When I update the monitor's name without touching the evaluator
    Then the update succeeds

  @unit
  Scenario: The CLI refuses to create a monitor without --evaluator-id
    When I run "langwatch monitor create" without --evaluator-id
    Then the command fails before calling the API
    And the error tells me to create an evaluator with "langwatch evaluator create" and pass --evaluator-id
    And the error tells me I can find existing evaluators with "langwatch evaluator list"
