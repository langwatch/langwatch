@unit
Feature: Evaluator Slug Generation
  As a developer
  I want evaluators to have human-readable slugs
  So that guardrails can reference them by slug instead of ID

  Background:
    Given the system supports evaluator creation with slug generation

  Scenario: Generate slug from evaluator name on creation
    Given a new evaluator with name "My Custom Evaluator"
    When the evaluator is created
    Then the slug should match pattern "my-custom-evaluator-XXXXX"
    And the slug suffix should be 5 characters from nanoid

  Scenario: Slug uniqueness within project
    Given an evaluator with name "Exact Match" exists in project "proj1"
    When creating another evaluator with name "Exact Match" in the same project
    Then the new evaluator should have a different slug due to unique nanoid suffix

  Scenario: Same name allowed in different projects
    Given an evaluator with name "Exact Match" exists in project "proj1"
    When creating an evaluator with name "Exact Match" in project "proj2"
    Then creation should succeed
    And both evaluators may have the same slug pattern

  Scenario: Handle special characters in name
    Given a new evaluator with name "LLM Judge (v2.0) - Beta!"
    When the evaluator is created
    Then the slug should contain only lowercase letters, numbers, and hyphens
    And the slug should match pattern "llm-judge-v2-0-beta-XXXXX"

  Scenario: Handle unicode characters in name
    Given a new evaluator with name "Safety Check"
    When the evaluator is created
    Then unicode should be transliterated or removed
    And the slug should be valid

  Scenario: Handle very long names
    Given a new evaluator with name that is 200 characters long
    When the evaluator is created
    Then the slug should be truncated to a reasonable length
    And the nanoid suffix should still be present

  Scenario: Handle empty or whitespace-only names
    Given a new evaluator with name "   "
    When the evaluator is created
    Then creation should fail with validation error

  Scenario: Retry on unique constraint violation
    Given an evaluator with slug "exact-match-abc12" exists
    And the nanoid generator would return "abc12" first
    When creating an evaluator that would generate the same slug
    Then the system should retry with a new nanoid suffix
    And creation should eventually succeed with a different slug
