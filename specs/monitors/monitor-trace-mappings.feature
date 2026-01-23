@integration
Feature: Monitor Trace Mappings
  As a user
  I want to map evaluator fields to trace attributes
  So that the evaluator receives the correct data from traces

  Background:
    Given I am configuring an online evaluation
    And trace level is selected

  Scenario: Standard fields auto-inference
    Given an evaluator with required fields "input", "output"
    When auto-inference runs for trace level
    Then "input" should map to trace.input
    And "output" should map to trace.output
    And no pending mappings should exist

  Scenario: Contexts field auto-inference
    Given an evaluator with required field "contexts"
    When auto-inference runs for trace level
    Then "contexts" should map to trace.contexts
    Or "contexts" should map to trace.contexts.string_list

  Scenario: Expected output infers from metadata
    Given an evaluator with required field "expected_output"
    And traces have metadata.expected_output available
    When auto-inference runs
    Then "expected_output" should map to metadata.expected_output

  Scenario: Custom field cannot be auto-inferred
    Given an evaluator with required field "custom_criteria"
    When auto-inference runs
    Then "custom_criteria" should remain unmapped
    And "custom_criteria" should be marked as pending

  Scenario: Nested metadata field selection
    Given an evaluator with required field "customer_type"
    And traces have metadata.customer_type available
    When I map "customer_type" to metadata source
    Then I should be able to select "customer_type" as the nested key
    And the mapping should be stored as { source: "metadata", key: "customer_type" }

  Scenario: Nested span field selection
    Given an evaluator with required field "llm_output"
    And traces have spans including "gpt-4o"
    When I map "llm_output" to spans source
    Then I should see available span names including "gpt-4o"
    When I select "gpt-4o"
    Then I should see subkey options: input, output, params
    When I select "output"
    Then the mapping should be { source: "spans", key: "gpt-4o", subkey: "output" }

  Scenario: Thread level traces mapping
    Given thread level is selected
    And an evaluator with required field "conversation"
    When I map "conversation" to traces source
    Then I should see a multi-select for trace fields
    When I select "input" and "output" fields
    Then the mapping should include selectedFields: ["input", "output"]

  Scenario: Thread level always requires manual mapping
    Given thread level is selected
    And an evaluator with required fields "input", "output"
    When the evaluator is selected
    Then auto-inference should not apply
    And the evaluator editor should open for manual configuration

  Scenario: Mapping to evaluations results
    Given an evaluator with required field "previous_score"
    And traces have evaluations results available
    When I map "previous_score" to evaluations source
    Then I should see a list of available evaluator names
    When I select an evaluator
    Then I should see subkeys: passed, score, label, details

  Scenario: Mapping to annotations
    Given an evaluator with required field "human_feedback"
    When I map "human_feedback" to annotations source
    Then I should see annotation field options
    And options should include: comment, is_thumbs_up, author, score

  Scenario: Empty trace source
    Given an evaluator with required field "contexts"
    And traces do not have contexts available
    When auto-inference runs
    Then "contexts" should remain unmapped
    And the field should be marked as pending
