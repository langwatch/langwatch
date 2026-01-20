@integration
Feature: Guardrails API Backward Compatibility
  As a developer
  I want the guardrails API to support both slug and raw settings
  So that existing integrations continue to work

  Background:
    Given the guardrails API is available
    And I have a valid API key

  Scenario: Execute with evaluator slug
    Given an evaluator "PII Check" with slug "pii-check-abc12"
    And the evaluator has settings { model: "gpt-4o" }
    When I call the guardrails API:
      | evaluator                      | input       | output      |
      | evaluators/pii-check-abc12     | user query  | llm output  |
    Then the evaluation should execute using the evaluator's settings
    And the response should include the evaluation result

  Scenario: Legacy raw settings still work
    When I call the guardrails API with raw evaluator type and settings:
      | evaluator              | settings                | input       | output      |
      | langevals/pii_detection| { threshold: 0.5 }     | user query  | llm output  |
    Then the evaluation should execute using the provided settings
    And backward compatibility should be maintained

  Scenario: Name is injected from evaluator when using slug
    Given an evaluator "PII Check" with slug "pii-check-abc12"
    When I call the guardrails API with evaluator "evaluators/pii-check-abc12"
    And I do not provide a name parameter
    Then the result should include name "PII Check"

  Scenario: Name can be overridden even with slug
    Given an evaluator "PII Check" with slug "pii-check-abc12"
    When I call the guardrails API with:
      | evaluator                  | name              |
      | evaluators/pii-check-abc12 | Custom Name       |
    Then the result should include name "Custom Name"

  Scenario: Slug lookup fails gracefully
    When I call the guardrails API with evaluator "evaluators/nonexistent-slug"
    Then the API should return a 404 error
    And the error message should indicate "Evaluator not found"

  Scenario: Legacy API without evaluators/ prefix
    When I call the guardrails API with evaluator "langevals/exact_match"
    Then the API should use the legacy behavior
    And settings should be read from the request body

  Scenario: Slug with special characters
    Given an evaluator with slug "my-eval-test-12345"
    When I call the guardrails API with evaluator "evaluators/my-eval-test-12345"
    Then the evaluation should work correctly

  Scenario: Project scoping for slug lookup
    Given an evaluator with slug "pii-check-abc12" exists in project "proj1"
    And no such evaluator exists in project "proj2"
    When I call the API from project "proj2" with evaluator "evaluators/pii-check-abc12"
    Then the API should return a 404 error
    Because evaluators are project-scoped

  Scenario: Archived evaluator slug
    Given an evaluator with slug "archived-eval-xyz99" that is archived
    When I call the guardrails API with evaluator "evaluators/archived-eval-xyz99"
    Then the API should return a 404 error
    Or the API should execute but warn about archived status

  Scenario: Response format consistency
    Given I call the API with slug-based evaluator
    And I call the API with legacy raw evaluator
    Then both responses should have the same format
    And both should include: status, score/passed, details

  Scenario: API rate limiting applies to both methods
    Given rate limiting is configured
    When I make many calls with slug-based evaluators
    And I make many calls with legacy evaluators
    Then rate limits should apply consistently to both

  Scenario: Evaluation cost tracking with slug
    Given an evaluator that incurs LLM costs
    When I call the guardrails API with the evaluator slug
    Then the cost should be tracked
    And the cost should be attributed to the project
