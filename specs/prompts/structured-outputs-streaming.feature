@integration
Feature: Structured Outputs Streaming in Prompt Playground
  As a user executing prompts in the playground
  I want my custom output fields to stream correctly
  So that I can see results regardless of field name or type

  # The 1 remaining @unimplemented scenario is KEEP per AUDIT_MANIFEST.md.
  # The delta calculation now lives in `deltaFrom` in
  # platform/app/src/app/api/prompt-playground/[[...route]]/app.ts, which
  # replaced the CopilotKit service adapter; it is still unbound. Output
  # formatting (string/JSON wrapping) and identifier normalization are fully
  # covered by src/server/prompt-config/__tests__/output-formatter.test.ts and
  # identifierUtils.test.ts respectively.

  Background:
    Given I am testing in the Prompt Playground chat
    And the prompt execution streams its output back as it is produced

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
