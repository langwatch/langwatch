@integration
Feature: Full Trace (AI-Readable) Mapping Source
  As a user configuring an online evaluation
  I want to map an evaluator field to "Full Trace (AI-Readable)"
  So that the evaluator receives a formatted digest of the entire trace

  # 5 of 7 scenarios bound to tracesMapping.test.ts (Trace-level source via
  # getTraceAvailableSources, span hierarchy digest + inputs/outputs via
  # formatSpansDigest, errors in digest, thread-level joining via separator).
  # Remaining 2 @unimplemented scenarios:
  # - "Thread-level formatted traces source is available": UPDATE per manifest
  #   (code label is "Full Thread (AI-Readable)" singular at tracesMapping.ts:955;
  #   scenario expects "Full Traces (AI-Readable)" plural — premise contradicts impl).
  # - "Auto-inference does not select formatted trace": KEEP per manifest
  #   (OnlineEvaluationDrawer.tsx:82 AUTO_INFER_MAPPINGS excludes formatted_trace
  #   by design; no test asserts this exclusion exists yet).
  # Aspirational pending UPDATE rewrite + KEEP test addition tracked in PR #3458.

  Background:
    Given I am configuring an online evaluation

  Scenario: Trace-level formatted trace source is available
    Given trace level is selected
    When I view the available mapping sources
    Then I should see "Full Trace (AI-Readable)" as a source option

  @unimplemented
  Scenario: Thread-level formatted traces source is available
    Given thread level is selected
    When I view the available mapping sources
    Then I should see "Full Traces (AI-Readable)" as a source option

  Scenario: Formatted trace produces a span hierarchy digest
    Given trace level is selected
    And a trace with spans: parent "agent" containing child "llm-call"
    When I map a field to "Full Trace (AI-Readable)"
    And the mapping is evaluated
    Then the result is a plain-text digest containing span names, timing, and nesting

  Scenario: Formatted trace includes inputs and outputs
    Given trace level is selected
    And a trace with an LLM span that has input messages and output text
    When the formatted trace mapping is evaluated
    Then the digest includes the input messages and output text as attributes

  Scenario: Formatted trace includes errors
    Given trace level is selected
    And a trace with a span that has an error status
    When the formatted trace mapping is evaluated
    Then the digest includes the error information

  Scenario: Thread-level formatted traces joins multiple traces
    Given thread level is selected
    And a thread with two traces, each containing spans
    When the formatted traces mapping is evaluated
    Then the result contains formatted digests for both traces separated by a delimiter

  @unimplemented
  Scenario: Auto-inference does not select formatted trace
    Given trace level is selected
    And an evaluator with required fields "input", "output"
    When auto-inference runs
    Then "input" should not map to formatted_trace
    And "output" should not map to formatted_trace
