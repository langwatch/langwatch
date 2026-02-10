Feature: Load Span Into Playground
  As a user analyzing traces
  I want to load trace spans into the Prompt Playground
  So that I can inspect and iterate on the exact prompt configuration used

  Background:
    Given I have a trace with an LLM span
    And the Prompt Playground is available

  # Core Functionality
  @unit
  Scenario: Loading a span with complete configuration
    Given the span has model "openai/gpt-4"
    And the span has temperature 0.7
    And the span has maxTokens 1000
    When I click "Open in Playground" on the span
    Then the playground loads with model "openai/gpt-4"
    And the playground has temperature 0.7
    And the playground has maxTokens 1000

  # Bug Fix: Issue #1354
  @unit
  Scenario: Loading a span where maxTokens is null
    Given the span has model "openai/gpt-4"
    And the span has temperature 0.7
    And the span has maxTokens null (API returned null, not undefined)
    When I click "Open in Playground" on the span
    Then the playground loads successfully without validation errors
    And the playground has maxTokens undefined (using default)
    # Zod schema expects number | undefined, not null
    # The boundary layer converts null → undefined

  @unit
  Scenario: Loading a span where maxTokens is undefined
    Given the span has model "openai/gpt-4"
    And the span has maxTokens undefined
    When I click "Open in Playground" on the span
    Then the playground loads successfully
    And the playground has maxTokens undefined (using default)

  @unit  
  Scenario: Loading a span where temperature is null
    Given the span has model "openai/gpt-4"
    And the span has temperature null
    When I click "Open in Playground" on the span
    Then the playground loads successfully
    And the playground has temperature undefined (using default)
    # Consistency: temperature already handles null → undefined

  # Edge Cases
  @unit
  Scenario: Loading a span with zero maxTokens
    Given the span has maxTokens 0
    When I click "Open in Playground" on the span
    Then the playground has maxTokens 0
    # Zero is a valid value, should not be coerced to undefined
