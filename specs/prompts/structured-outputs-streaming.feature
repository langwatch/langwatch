@integration
Feature: Structured Outputs Streaming in Prompt Playground
  As a user executing prompts in the playground
  I want my custom output fields to stream correctly
  So that I can see results regardless of field name or type

  # The 1 remaining @unimplemented scenario is KEEP per AUDIT_MANIFEST.md:
  # service-adapter.ts:230-236 implements current.slice(lastOutput.length)
  # delta calculation, but service-adapter.test.ts has only an it.todo placeholder
  # for the streaming case. Output formatting (string/JSON wrapping) and identifier
  # normalization are fully covered by output-formatter.test.ts and
  # identifierUtils.test.ts respectively. Aspirational pending KEEP-class delta
  # streaming test addition tracked in PR #3458.

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
