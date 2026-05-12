@integration
Feature: Structured Outputs Streaming in Prompt Playground
  As a user executing prompts in the playground
  I want my custom output fields to stream correctly
  So that I can see results regardless of field name or type

  Background:
    Given I am testing in the Prompt Playground chat
    And the prompt execution streams via CopilotKit service adapter

  # Default "output" identifier - displays value as-is

  @unimplemented
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
