@unit
Feature: Evaluator Slug Generation
  As a developer
  I want evaluators to have human-readable slugs
  So that guardrails can reference them by slug instead of ID

  Background:
    Given the system supports evaluator creation with slug generation

  @unimplemented
  Scenario: Generate slug from evaluator name on creation
    Given a new evaluator with name "My Custom Evaluator"
    When the evaluator is created
    Then the slug should match pattern "my-custom-evaluator-XXXXX"
    And the slug suffix should be 5 characters from nanoid

  @unimplemented
  Scenario: Slug uniqueness within project
    Given an evaluator with name "Exact Match" exists in project "proj1"
    When creating another evaluator with name "Exact Match" in the same project
    Then the new evaluator should have a different slug due to unique nanoid suffix

  @unimplemented
  Scenario: Handle special characters in name
    Given a new evaluator with name "LLM Judge (v2.0) - Beta!"
    When the evaluator is created
    Then the slug should contain only lowercase letters, numbers, and hyphens
    And the slug should match pattern "llm-judge-v2-0-beta-XXXXX"

  @unimplemented
  Scenario: Handle unicode characters in name
    Given a new evaluator with name "Safety Check"
    When the evaluator is created
    Then unicode should be transliterated or removed
    And the slug should be valid

  @unimplemented
  Scenario: Handle very long names
    Given a new evaluator with name that is 200 characters long
    When the evaluator is created
    Then the slug should be truncated to a reasonable length
    And the nanoid suffix should still be present

  @unimplemented
  Scenario: Handle empty or whitespace-only names
    Given a new evaluator with name "   "
    When the evaluator is created
    Then creation should fail with validation error

