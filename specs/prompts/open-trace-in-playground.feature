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
  Scenario: Trace without max tokens specified opens in Playground
    Given the traced LLM call did not specify max tokens
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And max tokens is left unset

  @unit
  Scenario: Trace without temperature specified opens in Playground
    Given the traced LLM call did not specify temperature
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And temperature is left unset

  @unit
  Scenario: Trace with LLM config values opens in Playground with those values
    Given the traced LLM call used max tokens of 1024
    And the traced LLM call used temperature of 0.7
    When I open the trace in the Playground
    Then the Playground loads without validation errors
    And max tokens shows 1024
    And temperature shows 0.7

  @unit
  Scenario: Trace without a model specified uses the default model
    Given the traced LLM call did not specify a model
    When I open the trace in the Playground
    Then the Playground loads with the default model
