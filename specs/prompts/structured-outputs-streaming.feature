@unit
Feature: Structured Outputs Streaming in Prompt Playground
  As a user executing prompts in the playground
  I want my custom output fields to stream correctly
  So that I can see results regardless of field name or type

  Background:
    Given I am testing in the Prompt Playground chat
    And the prompt execution streams via CopilotKit service adapter

  # Core functionality - different field names
  Scenario: Streaming string output with custom field name
    Given the output configuration has:
      | identifier | type |
      | result     | str  |
    When the execution state updates with outputs:
      | result | "Hello World" |
    Then the stream receives content "Hello World"

  Scenario: Streaming output with default "output" field name
    Given the output configuration has:
      | identifier | type |
      | output     | str  |
    When the execution state updates with outputs:
      | output | "This works too" |
    Then the stream receives content "This works too"

  # Core functionality - different types
  Scenario: Streaming float output converted to string
    Given the output configuration has:
      | identifier | type  |
      | score      | float |
    When the execution state updates with outputs:
      | score | 0.95 |
    Then the stream receives content "0.95"

  Scenario: Streaming boolean output converted to string
    Given the output configuration has:
      | identifier | type |
      | passed     | bool |
    When the execution state updates with outputs:
      | passed | true |
    Then the stream receives content "true"

  Scenario: Streaming json_schema output as formatted JSON
    Given the output configuration has:
      | identifier | type        |
      | analysis   | json_schema |
    When the execution state updates with outputs:
      | analysis | {"sentiment": "positive", "confidence": 0.9} |
    Then the stream receives formatted JSON content

  # Edge cases
  Scenario: Empty outputs configuration
    Given the output configuration is empty
    When the execution state updates with any outputs
    Then no content is streamed
    And no errors are thrown

  Scenario: Missing identifier in execution state
    Given the output configuration has:
      | identifier | type |
      | score      | str  |
    When the execution state updates with outputs:
      | other_field | "some value" |
    Then no content is streamed

  Scenario: Null value from backend
    Given the output configuration has:
      | identifier | type |
      | result     | str  |
    When the execution state updates with null value for "result"
    Then no content is streamed

  # Incremental streaming (delta calculation)
  Scenario: Incremental delta streaming for string output
    Given the output configuration has:
      | identifier | type |
      | output     | str  |
    When the execution state updates incrementally:
      | step | output_value |
      | 1    | "Hel"        |
      | 2    | "Hello"      |
      | 3    | "Hello Wor"  |
      | 4    | "Hello World"|
    Then the stream receives deltas:
      | delta   |
      | "Hel"   |
      | "lo"    |
      | " Wor"  |
      | "ld"    |

  # Multiple outputs limitation (documented behavior)
  Scenario: Multiple outputs - only first output streams
    Given the output configuration has:
      | identifier | type  |
      | summary    | str   |
      | score      | float |
    When the execution state updates with outputs:
      | summary | "Good result" |
      | score   | 0.85          |
    Then the stream receives content "Good result"
    And the "score" output is not streamed
