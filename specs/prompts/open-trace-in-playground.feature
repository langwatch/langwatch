Feature: Open trace in Playground
  As a user viewing a trace
  I want to open it in the Prompt Playground
  So that I can iterate on the prompt used in the traced LLM call

  Background:
    Given a project with traced LLM calls

  # The bridge function converts trace data (which uses null for absent values)
  # into form values (which use undefined for absent values).
  # Fix approach: null-to-undefined coercion at the bridge, matching existing
  # temperature pattern. The Zod schema and form value types stay unchanged.

  @unit
  Scenario: Trace has null maxTokens
    Given the trace has maxTokens set to null
    When I build the prompt form values from the trace
    Then the form values are created successfully
    And maxTokens is undefined in the form values

  @unit
  Scenario: Trace has null temperature
    Given the trace has temperature set to null
    When I build the prompt form values from the trace
    Then the form values are created successfully
    And temperature is undefined in the form values

  @unit
  Scenario: Trace has all LLM config values present
    Given the trace has maxTokens set to 1024
    And the trace has temperature set to 0.7
    When I build the prompt form values from the trace
    Then the form values are created successfully
    And maxTokens is set to 1024
    And temperature is set to 0.7

  @unit
  Scenario: Trace has no model specified
    Given the trace has no model specified
    When I build the prompt form values from the trace
    Then the form values use the default model
