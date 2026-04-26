@integration
Feature: Monitor Trace Mappings
  As a user
  I want to map evaluator fields to trace attributes
  So that the evaluator receives the correct data from traces

  Background:
    Given I am configuring an online evaluation
    And trace level is selected

  @unimplemented
  Scenario: Contexts field auto-inference
    Given an evaluator with required field "contexts"
    When auto-inference runs for trace level
    Then "contexts" should map to trace.contexts
    Or "contexts" should map to trace.contexts.string_list

  @unimplemented
  Scenario: Expected output infers from metadata
    Given an evaluator with required field "expected_output"
    And traces have metadata.expected_output available
    When auto-inference runs
    Then "expected_output" should map to metadata.expected_output

  @unimplemented
  Scenario: Mapping to evaluations results
    Given an evaluator with required field "previous_score"
    And traces have evaluations results available
    When I map "previous_score" to evaluations source
    Then I should see a list of available evaluator names
    When I select an evaluator
    Then I should see subkeys: passed, score, label, details

  @unimplemented
  Scenario: Mapping to annotations
    Given an evaluator with required field "human_feedback"
    When I map "human_feedback" to annotations source
    Then I should see annotation field options
    And options should include: comment, is_thumbs_up, author, score

  @unimplemented
  Scenario: Empty trace source
    Given an evaluator with required field "contexts"
    And traces do not have contexts available
    When auto-inference runs
    Then "contexts" should remain unmapped
    And the field should be marked as pending
