@integration
Feature: Structured Outputs Streaming in Prompt Playground
  As a user executing prompts in the playground
  I want my custom output fields to stream correctly
  So that I can see results regardless of field name or type

  Background:
    Given I am testing in the Prompt Playground chat
    And the prompt execution streams via CopilotKit service adapter

  # Default "output" identifier - displays value as-is
  Scenario: Default "output" identifier displays string value as-is
    Given the output configuration has:
      | identifier | type |
      | output     | str  |
    When the execution state updates with outputs:
      | output | "Hello World" |
    Then the stream receives content "Hello World"

  Scenario: Default "output" identifier displays float value as-is
    Given the output configuration has:
      | identifier | type  |
      | output     | float |
    When the execution state updates with outputs:
      | output | 0.95 |
    Then the stream receives content "0.95"

  Scenario: Default "output" identifier displays bool value as-is
    Given the output configuration has:
      | identifier | type |
      | output     | bool |
    When the execution state updates with outputs:
      | output | true |
    Then the stream receives content "true"

  Scenario: Default "output" identifier displays json_schema as formatted JSON
    Given the output configuration has:
      | identifier | type        |
      | output     | json_schema |
    When the execution state updates with outputs:
      | output | {"sentiment": "positive"} |
    Then the stream receives formatted JSON content

  # Custom identifiers - wrapped in JSON object with pretty-printing
  Scenario: Custom identifier wraps string value in JSON object
    Given the output configuration has:
      | identifier | type |
      | result     | str  |
    When the execution state updates with outputs:
      | result | "Hello World" |
    Then the stream receives JSON-wrapped content with key "result" and value "Hello World"

  Scenario: Custom identifier wraps float value in JSON object
    Given the output configuration has:
      | identifier | type  |
      | score      | float |
    When the execution state updates with outputs:
      | score | 0.95 |
    Then the stream receives JSON-wrapped content with key "score" and value 0.95

  Scenario: Custom identifier wraps boolean value in JSON object
    Given the output configuration has:
      | identifier | type |
      | passed     | bool |
    When the execution state updates with outputs:
      | passed | true |
    Then the stream receives JSON-wrapped content with key "passed" and value true

  Scenario: Custom identifier wraps json_schema value in JSON object
    Given the output configuration has:
      | identifier | type        |
      | analysis   | json_schema |
    When the execution state updates with outputs:
      | analysis | {"sentiment": "positive", "confidence": 0.9} |
    Then the stream receives JSON-wrapped content with key "analysis" containing nested object

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
  Scenario: Incremental delta streaming for default output identifier
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

  # Multiple outputs - combined into single JSON object
  Scenario: Multiple outputs are combined into single JSON object
    Given the output configuration has:
      | identifier    | type  |
      | complete_name | str   |
      | score         | float |
    When the execution state updates with outputs:
      | complete_name | "Sergio Cardenas" |
      | score         | 10                |
    Then the stream receives JSON with all outputs combined:
      """
      {
        "complete_name": "Sergio Cardenas",
        "score": 10
      }
      """

  Scenario: Multiple outputs with one null value only shows valid outputs
    Given the output configuration has:
      | identifier | type  |
      | name       | str   |
      | score      | float |
    When the execution state updates with outputs:
      | name  | "Test" |
      | score | null   |
    Then the stream receives JSON-wrapped content with key "name" and value "Test"

  # Identifier normalization (must match Python variable name rules)
  @unit
  Scenario: Identifier with dashes is normalized by removing dashes
    Given the user enters output identifier "my-custom-score"
    Then the identifier is normalized to "mycustomscore"
    And the output displays with key "mycustomscore"

  @unit
  Scenario: Identifier with spaces is normalized to underscores
    Given the user enters output identifier "my score"
    Then the identifier is normalized to "my_score"
    And the output displays with key "my_score"

  @unit
  Scenario: Identifier with special characters is normalized by removing them
    Given the user enters output identifier "my@score!test"
    Then the identifier is normalized to "myscoretest"
    And the output displays with key "myscoretest"

  @unit
  Scenario: Identifier with uppercase is normalized to lowercase
    Given the user enters output identifier "MyScore"
    Then the identifier is normalized to "myscore"
    And the output displays with key "myscore"

  @unit
  Scenario: Identifier with underscores is preserved
    Given the user enters output identifier "my_custom_score"
    Then the identifier is normalized to "my_custom_score"
    And the output displays with key "my_custom_score"
